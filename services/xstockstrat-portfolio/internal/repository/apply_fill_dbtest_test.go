//go:build dbtest

package repository

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
)

const applyFillSymbol = "FOLD"

func execMode(c *pgxpool.Config) { c.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeExec }

func applyFillKeys(userID, orderID string) (FillKey, PositionKey) {
	account := userID + "-acct"
	return FillKey{Consumer: ConsumerOrderFill, UserID: userID, AccountID: account, OrderID: orderID},
		PositionKey{UserID: userID, Symbol: applyFillSymbol, Mode: commonv1.TradingMode_TRADING_MODE_PAPER, AccountID: account}
}

// addQty folds a buy of qty at cost 1 per share onto the locked row.
func addQty(qty float64) FoldFn {
	return func(row *LockedPosition) FoldOutcome {
		v := PositionValues{Qty: qty, CostBasis: qty}
		if row != nil {
			v = PositionValues{Qty: row.Qty + qty, CostBasis: row.CostBasis + qty,
				RealizedAccum: row.RealizedAccum, FeesAccum: row.FeesAccum}
		}
		v.AvgEntryPrice = v.CostBasis / v.Qty
		return FoldOutcome{Write: FoldUpsert, Position: v}
	}
}

func positionQty(t *testing.T, pool *pgxpool.Pool, pos PositionKey) float64 {
	t.Helper()
	var qty float64
	if err := pool.QueryRow(context.Background(),
		`SELECT qty FROM portfolio.positions WHERE user_id=$1 AND symbol=$2 AND trading_mode=$3 AND account_id=$4`,
		pos.args()...).Scan(&qty); err != nil {
		t.Fatalf("read position qty: %v", err)
	}
	return qty
}

func appliedRows(t *testing.T, pool *pgxpool.Pool, key FillKey) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM portfolio.consumer_applied_events WHERE `+appliedKeyWhere, key.args()...).Scan(&n); err != nil {
		t.Fatalf("count applied rows: %v", err)
	}
	return n
}

func TestApplyFillDB_ConcurrentSameKeyAppliesOnce(t *testing.T) {
	modes := map[string][]func(*pgxpool.Config){"default": nil, "exec": {execMode}}
	for name, opts := range modes {
		t.Run(name, func(t *testing.T) {
			pools := []*pgxpool.Pool{testPool(t, opts...), testPool(t, opts...)}
			userID := testUserID(t)
			key, pos := applyFillKeys(userID, "ord-"+userID)
			seedPosition(t, pools[0], userID, pos.Symbol, pos.Mode.String(), pos.AccountID, 10)

			errs := make([]error, len(pools))
			start := make(chan struct{})
			var wg sync.WaitGroup
			for i, pool := range pools {
				wg.Add(1)
				go func(i int, repo *PortfolioRepo) {
					defer wg.Done()
					<-start
					_, errs[i] = repo.ApplyFill(context.Background(), key, "ev-"+userID, pos, addQty(5))
				}(i, NewPortfolioRepoWithDB(pool))
			}
			close(start)
			wg.Wait()

			applied, conflicted := 0, 0
			for i, err := range errs {
				switch {
				case err == nil:
					applied++
				case errors.Is(err, ErrFillAlreadyApplied):
					conflicted++
				default:
					t.Errorf("writer %d: unexpected error %v", i, err)
				}
			}
			if applied != 1 || conflicted != 1 {
				t.Errorf("applied=%d conflicted=%d, want 1 and 1", applied, conflicted)
			}
			if got := positionQty(t, pools[0], pos); got != 15 {
				t.Errorf("qty = %v, want 15 (the fill moved the position once)", got)
			}
			if got := appliedRows(t, pools[0], key); got != 1 {
				t.Errorf("applied rows = %d, want 1", got)
			}
		})
	}
}

func TestApplyFillDB_RolledBackFoldLeavesNoAppliedRow(t *testing.T) {
	pool := testPool(t)
	repo := NewPortfolioRepoWithDB(pool)
	userID := testUserID(t)
	key, pos := applyFillKeys(userID, "ord-"+userID)
	seedPosition(t, pool, userID, pos.Symbol, pos.Mode.String(), pos.AccountID, 10)

	// A zero FoldWrite fails inside the transaction, after the applied row was inserted.
	_, err := repo.ApplyFill(context.Background(), key, "ev-"+userID, pos,
		func(*LockedPosition) FoldOutcome { return FoldOutcome{} })
	if err == nil {
		t.Fatal("ApplyFill with a failing fold returned nil")
	}
	if got := appliedRows(t, pool, key); got != 0 {
		t.Errorf("applied rows = %d, want 0 after rollback", got)
	}
	if got := positionQty(t, pool, pos); got != 10 {
		t.Errorf("qty = %v, want 10 (unchanged)", got)
	}
	if _, err := repo.ApplyFill(context.Background(), key, "ev-"+userID, pos, addQty(5)); err != nil {
		t.Fatalf("ApplyFill after rollback: %v", err)
	}
	if got := positionQty(t, pool, pos); got != 15 {
		t.Errorf("qty after retry = %v, want 15", got)
	}
}

func TestFillFloorDB_EnsureTwiceStampsOnce(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	var saved *time.Time
	var at time.Time
	err := pool.QueryRow(ctx, `SELECT floor_recorded_at FROM portfolio.consumer_floors WHERE consumer = $1`,
		ConsumerOrderFill).Scan(&at)
	switch {
	case err == nil:
		saved = &at
	case !errors.Is(err, pgx.ErrNoRows):
		t.Fatalf("read existing floor: %v", err)
	}
	t.Cleanup(func() {
		if _, err := pool.Exec(context.Background(),
			`DELETE FROM portfolio.consumer_floors WHERE consumer = $1`, ConsumerOrderFill); err != nil {
			t.Errorf("restore floor (delete): %v", err)
		}
		if saved == nil {
			return
		}
		if _, err := pool.Exec(context.Background(),
			`INSERT INTO portfolio.consumer_floors (consumer, floor_recorded_at) VALUES ($1, $2)`,
			ConsumerOrderFill, *saved); err != nil {
			t.Errorf("restore floor (insert): %v", err)
		}
	})
	if _, err := pool.Exec(ctx, `DELETE FROM portfolio.consumer_floors WHERE consumer = $1`, ConsumerOrderFill); err != nil {
		t.Fatalf("clear floor: %v", err)
	}

	repo := NewPortfolioRepoWithDB(pool)
	first, stamped, err := repo.EnsureFillFloor(ctx)
	if err != nil || !stamped {
		t.Fatalf("first EnsureFillFloor = (%v, %v, %v), want stampedNow true", first, stamped, err)
	}
	second, stamped, err := repo.EnsureFillFloor(ctx)
	if err != nil || stamped {
		t.Fatalf("second EnsureFillFloor = (%v, %v, %v), want stampedNow false", second, stamped, err)
	}
	if !second.Equal(first) {
		t.Errorf("second floor = %v, want the first %v", second, first)
	}
}
