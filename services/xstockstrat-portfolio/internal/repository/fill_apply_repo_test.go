package repository

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/pashagolub/pgxmock/v4"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
)

const (
	appliedInsertSQL  = `INSERT INTO portfolio\.consumer_applied_events \(consumer, user_id, account_id, order_id, event_id, outcome\)\s+VALUES \(\$1, \$2, \$3, \$4, \$5, 'applied'\) ON CONFLICT DO NOTHING`
	advisoryLockSQL   = `SELECT pg_advisory_xact_lock\(hashtextextended\(\$1, 0\)\)`
	lockPositionSQL   = `SELECT qty, avg_entry_price, cost_basis, realized_accum, fees_accum, opened_at\s+FROM portfolio\.positions\s+WHERE user_id=\$1 AND symbol=\$2 AND trading_mode=\$3 AND account_id=\$4\s+FOR UPDATE`
	absoluteUpsertSQL = `(?s)INSERT INTO portfolio\.positions .*ON CONFLICT \(user_id, symbol, trading_mode, account_id\) DO UPDATE\s+SET qty=\$3, avg_entry_price=\$4, cost_basis=\$5, realized_accum=\$8, fees_accum=\$9, updated_at=NOW\(\)`
	deletePositionSQL = `DELETE FROM portfolio\.positions WHERE user_id=\$1 AND symbol=\$2 AND trading_mode=\$3 AND account_id=\$4`
	setPendingSQL     = `UPDATE portfolio\.consumer_applied_events SET pending_closed = \$5::jsonb\s+WHERE consumer=\$1 AND user_id=\$2 AND account_id=\$3 AND order_id=\$4`
	floorInsertSQL    = `INSERT INTO portfolio\.consumer_floors \(consumer, floor_recorded_at\)\s+VALUES \(\$1, date_trunc\('milliseconds', clock_timestamp\(\)\)\) ON CONFLICT DO NOTHING`
	floorSelectSQL    = `SELECT floor_recorded_at FROM portfolio\.consumer_floors WHERE consumer = \$1`
	lockKeyArg        = "u1|AAPL|TRADING_MODE_PAPER|acc-1"
	paperMode         = "TRADING_MODE_PAPER"
)

var lockPositionCols = []string{"qty", "avg_entry_price", "cost_basis", "realized_accum", "fees_accum", "opened_at"}

var (
	testFillKey = FillKey{Consumer: ConsumerOrderFill, UserID: "u1", AccountID: "acc-1", OrderID: "ord-1"}
	testPosKey  = PositionKey{UserID: "u1", Symbol: "AAPL", Mode: commonv1.TradingMode_TRADING_MODE_PAPER, AccountID: "acc-1"}
	keyArgs     = []any{"order_fill", "u1", "acc-1", "ord-1"}
)

func fillMock(t *testing.T) pgxmock.PgxPoolIface {
	t.Helper()
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	t.Cleanup(mock.Close)
	return mock
}

func metAll(t *testing.T, mock pgxmock.PgxPoolIface) {
	t.Helper()
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

// stringArg matches only a Go string, so a []byte bind of the same JSON fails the expectation.
type stringArg struct{ want string }

func (a stringArg) Match(v any) bool {
	s, ok := v.(string)
	return ok && s == a.want
}

// rowerOnly hides pgxmock's Begin behind the three queryRower methods.
type rowerOnly struct{ queryRower }

func expectFreshInsertAndLock(mock pgxmock.PgxPoolIface) {
	mock.ExpectBegin()
	mock.ExpectExec(appliedInsertSQL).WithArgs(append(keyArgs, "evt-1")...).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))
	mock.ExpectExec(advisoryLockSQL).WithArgs(lockKeyArg).
		WillReturnResult(pgxmock.NewResult("SELECT", 1))
}

func TestApplyFill_NewFill_RunsInOrderAndWritesAbsoluteAccumulators(t *testing.T) {
	mock := fillMock(t)
	opened := time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)
	expectFreshInsertAndLock(mock)
	mock.ExpectQuery(lockPositionSQL).WithArgs("u1", "AAPL", paperMode, "acc-1").
		WillReturnRows(mock.NewRows(lockPositionCols).AddRow(10.0, 100.0, 1000.0, 5.0, 1.0, opened))
	mock.ExpectExec(absoluteUpsertSQL).
		WithArgs("u1", "AAPL", 15.0, 110.0, 1650.0, paperMode, "acc-1", 5.0, 1.5).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))
	mock.ExpectCommit()

	var seen *LockedPosition
	want := FoldOutcome{Write: FoldUpsert, Position: PositionValues{Qty: 15, AvgEntryPrice: 110, CostBasis: 1650, RealizedAccum: 5, FeesAccum: 1.5}}
	res, err := NewPortfolioRepoWithDB(mock).ApplyFill(context.Background(), testFillKey, "evt-1", testPosKey,
		func(existing *LockedPosition) FoldOutcome { seen = existing; return want })
	if err != nil {
		t.Fatalf("ApplyFill: %v", err)
	}
	wantPrior := LockedPosition{Qty: 10, AvgEntryPrice: 100, CostBasis: 1000, RealizedAccum: 5, FeesAccum: 1, OpenedAt: opened}
	if seen == nil || *seen != wantPrior {
		t.Fatalf("fold saw %+v, want %+v", seen, wantPrior)
	}
	if res == nil || res.Prior != seen || res.Outcome != want {
		t.Fatalf("result = %+v, want prior %+v and outcome %+v", res, seen, want)
	}
	metAll(t, mock)
}

func TestApplyFill_NoPositionRow_FoldGetsNil(t *testing.T) {
	mock := fillMock(t)
	expectFreshInsertAndLock(mock)
	mock.ExpectQuery(lockPositionSQL).WithArgs("u1", "AAPL", paperMode, "acc-1").
		WillReturnRows(mock.NewRows(lockPositionCols))
	mock.ExpectExec(absoluteUpsertSQL).
		WithArgs("u1", "AAPL", 10.0, 100.0, 1000.0, paperMode, "acc-1", 0.0, 0.0).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))
	mock.ExpectCommit()

	called := false
	res, err := NewPortfolioRepoWithDB(mock).ApplyFill(context.Background(), testFillKey, "evt-1", testPosKey,
		func(existing *LockedPosition) FoldOutcome {
			called = true
			if existing != nil {
				t.Errorf("fold got %+v, want nil", existing)
			}
			return FoldOutcome{Write: FoldUpsert, Position: PositionValues{Qty: 10, AvgEntryPrice: 100, CostBasis: 1000}}
		})
	if err != nil || !called || res.Prior != nil {
		t.Fatalf("res=%+v err=%v called=%v", res, err, called)
	}
	metAll(t, mock)
}

func TestApplyFill_InsertConflict_RollsBackWithoutLockReadOrWrite(t *testing.T) {
	mock := fillMock(t)
	mock.ExpectBegin()
	mock.ExpectExec(appliedInsertSQL).WithArgs(append(keyArgs, "evt-1")...).
		WillReturnResult(pgxmock.NewResult("INSERT", 0))
	mock.ExpectRollback()

	res, err := NewPortfolioRepoWithDB(mock).ApplyFill(context.Background(), testFillKey, "evt-1", testPosKey,
		func(*LockedPosition) FoldOutcome { t.Fatal("fold must not run on a conflict"); return FoldOutcome{} })
	if !errors.Is(err, ErrFillAlreadyApplied) || res != nil {
		t.Fatalf("res=%+v err=%v, want nil, ErrFillAlreadyApplied", res, err)
	}
	metAll(t, mock)
}

func TestApplyFill_FlipWithPendingClosed_UpdatesInsideTxAsString(t *testing.T) {
	mock := fillMock(t)
	pending := `{"symbol":"AAPL","realized_pnl":40}`
	expectFreshInsertAndLock(mock)
	mock.ExpectQuery(lockPositionSQL).WithArgs("u1", "AAPL", paperMode, "acc-1").
		WillReturnRows(mock.NewRows(lockPositionCols).AddRow(10.0, 100.0, 1000.0, 0.0, 0.0, time.Now()))
	mock.ExpectExec(deletePositionSQL).WithArgs("u1", "AAPL", paperMode, "acc-1").
		WillReturnResult(pgxmock.NewResult("DELETE", 1))
	mock.ExpectExec(absoluteUpsertSQL).
		WithArgs("u1", "AAPL", -5.0, 104.0, -520.0, paperMode, "acc-1", 0.0, 0.0).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))
	mock.ExpectExec(setPendingSQL).WithArgs("order_fill", "u1", "acc-1", "ord-1", stringArg{pending}).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	mock.ExpectCommit()

	_, err := NewPortfolioRepoWithDB(mock).ApplyFill(context.Background(), testFillKey, "evt-1", testPosKey,
		func(*LockedPosition) FoldOutcome {
			return FoldOutcome{Write: FoldFlip, Position: PositionValues{Qty: -5, AvgEntryPrice: 104, CostBasis: -520}, PendingClosed: &pending}
		})
	if err != nil {
		t.Fatalf("ApplyFill: %v", err)
	}
	metAll(t, mock)
}

func TestApplyFill_WriteFails_RollsBackWithWrappedError(t *testing.T) {
	mock := fillMock(t)
	boom := errors.New("boom")
	expectFreshInsertAndLock(mock)
	mock.ExpectQuery(lockPositionSQL).WithArgs("u1", "AAPL", paperMode, "acc-1").
		WillReturnRows(mock.NewRows(lockPositionCols))
	mock.ExpectExec(deletePositionSQL).WithArgs("u1", "AAPL", paperMode, "acc-1").WillReturnError(boom)
	mock.ExpectRollback()

	_, err := NewPortfolioRepoWithDB(mock).ApplyFill(context.Background(), testFillKey, "evt-1", testPosKey,
		func(*LockedPosition) FoldOutcome { return FoldOutcome{Write: FoldDelete} })
	if !errors.Is(err, boom) || err.Error() == boom.Error() {
		t.Fatalf("err = %v, want boom wrapped", err)
	}
	metAll(t, mock)
}

func TestApplyFill_DBWithoutBegin_ReturnsError(t *testing.T) {
	mock := fillMock(t)
	_, err := NewPortfolioRepoWithDB(rowerOnly{mock}).ApplyFill(context.Background(), testFillKey, "evt-1", testPosKey,
		func(*LockedPosition) FoldOutcome { t.Fatal("fold must not run"); return FoldOutcome{} })
	if err == nil {
		t.Fatal("want an error for a db without Begin")
	}
	metAll(t, mock)
}

func TestFillApplied_HitNoRowAndError(t *testing.T) {
	const q = `SELECT event_id, outcome, pending_closed::text FROM portfolio\.consumer_applied_events\s+WHERE consumer=\$1 AND user_id=\$2 AND account_id=\$3 AND order_id=\$4`
	cols := []string{"event_id", "outcome", "pending_closed"}
	mock := fillMock(t)
	repo := NewPortfolioRepoWithDB(mock)
	ctx := context.Background()

	pending := `{"a":1}`
	mock.ExpectQuery(q).WithArgs(keyArgs...).WillReturnRows(mock.NewRows(cols).AddRow("evt-0", "applied", &pending))
	got, err := repo.FillApplied(ctx, testFillKey)
	if err != nil || got == nil || got.EventID != "evt-0" || got.Outcome != "applied" || got.PendingClosed == nil || *got.PendingClosed != pending {
		t.Fatalf("hit: got %+v, %v", got, err)
	}

	mock.ExpectQuery(q).WithArgs(keyArgs...).WillReturnRows(mock.NewRows(cols))
	if got, err := repo.FillApplied(ctx, testFillKey); got != nil || err != nil {
		t.Fatalf("no row: got %+v, %v; want nil, nil", got, err)
	}

	boom := errors.New("boom")
	mock.ExpectQuery(q).WithArgs(keyArgs...).WillReturnError(boom)
	if _, err := repo.FillApplied(ctx, testFillKey); !errors.Is(err, boom) {
		t.Fatalf("db error: err = %v, want boom", err)
	}
	metAll(t, mock)
}

func TestParkFill_InsertedConflictAndError(t *testing.T) {
	const q = `INSERT INTO portfolio\.consumer_applied_events \(consumer, user_id, account_id, order_id, event_id, outcome, parked_reason\)\s+VALUES \(\$1, \$2, \$3, \$4, \$5, 'parked', \$6\) ON CONFLICT DO NOTHING RETURNING consumer`
	args := append(keyArgs, "evt-1", "no side")
	mock := fillMock(t)
	repo := NewPortfolioRepoWithDB(mock)
	ctx := context.Background()

	mock.ExpectQuery(q).WithArgs(args...).WillReturnRows(mock.NewRows([]string{"consumer"}).AddRow("order_fill"))
	if ok, err := repo.ParkFill(ctx, testFillKey, "evt-1", "no side"); !ok || err != nil {
		t.Fatalf("returned row: got %v, %v; want true, nil", ok, err)
	}

	mock.ExpectQuery(q).WithArgs(args...).WillReturnRows(mock.NewRows([]string{"consumer"}))
	if ok, err := repo.ParkFill(ctx, testFillKey, "evt-1", "no side"); ok || err != nil {
		t.Fatalf("conflict: got %v, %v; want false, nil", ok, err)
	}

	boom := errors.New("boom")
	mock.ExpectQuery(q).WithArgs(args...).WillReturnError(boom)
	if _, err := repo.ParkFill(ctx, testFillKey, "evt-1", "no side"); !errors.Is(err, boom) {
		t.Fatalf("db error: err = %v, want boom", err)
	}
	metAll(t, mock)
}

func TestClearPendingClosed_ScopesToKeyAndNonNull(t *testing.T) {
	const q = `UPDATE portfolio\.consumer_applied_events SET pending_closed = NULL\s+WHERE consumer=\$1 AND user_id=\$2 AND account_id=\$3 AND order_id=\$4 AND pending_closed IS NOT NULL`
	mock := fillMock(t)
	mock.ExpectExec(q).WithArgs(keyArgs...).WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	if err := NewPortfolioRepoWithDB(mock).ClearPendingClosed(context.Background(), testFillKey); err != nil {
		t.Fatalf("ClearPendingClosed: %v", err)
	}
	metAll(t, mock)
}

func TestEnsureFillFloor_StampConflictAndErrors(t *testing.T) {
	stored := time.Date(2026, 11, 27, 8, 0, 0, 123000000, time.UTC)
	mock := fillMock(t)
	repo := NewPortfolioRepoWithDB(mock)
	ctx := context.Background()

	mock.ExpectExec(floorInsertSQL).WithArgs("order_fill").WillReturnResult(pgxmock.NewResult("INSERT", 1))
	mock.ExpectQuery(floorSelectSQL).WithArgs("order_fill").WillReturnRows(mock.NewRows([]string{"floor_recorded_at"}).AddRow(stored))
	if floor, stamped, err := repo.EnsureFillFloor(ctx); err != nil || !stamped || !floor.Equal(stored) {
		t.Fatalf("first call: got %v, %v, %v", floor, stamped, err)
	}

	mock.ExpectExec(floorInsertSQL).WithArgs("order_fill").WillReturnResult(pgxmock.NewResult("INSERT", 0))
	mock.ExpectQuery(floorSelectSQL).WithArgs("order_fill").WillReturnRows(mock.NewRows([]string{"floor_recorded_at"}).AddRow(stored))
	if floor, stamped, err := repo.EnsureFillFloor(ctx); err != nil || stamped || !floor.Equal(stored) {
		t.Fatalf("conflict: got %v, %v, %v", floor, stamped, err)
	}

	boom := errors.New("boom")
	mock.ExpectExec(floorInsertSQL).WithArgs("order_fill").WillReturnError(boom)
	if _, _, err := repo.EnsureFillFloor(ctx); !errors.Is(err, boom) {
		t.Fatalf("insert error: err = %v, want boom", err)
	}

	mock.ExpectExec(floorInsertSQL).WithArgs("order_fill").WillReturnResult(pgxmock.NewResult("INSERT", 0))
	mock.ExpectQuery(floorSelectSQL).WithArgs("order_fill").WillReturnError(boom)
	if _, _, err := repo.EnsureFillFloor(ctx); !errors.Is(err, boom) {
		t.Fatalf("select error: err = %v, want boom", err)
	}
	metAll(t, mock)
}
