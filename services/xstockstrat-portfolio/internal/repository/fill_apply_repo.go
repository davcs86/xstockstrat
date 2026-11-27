package repository

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
)

// ConsumerOrderFill is the only consumer with an applied-event key and a floor.
const ConsumerOrderFill = "order_fill"

// ErrFillAlreadyApplied means the applied-row INSERT conflicted: another delivery owns this fill.
var ErrFillAlreadyApplied = errors.New("fill already applied")

// txBeginner is asserted on r.db, never r.pool: NewPortfolioRepoWithDB leaves pool nil.
type txBeginner interface {
	Begin(ctx context.Context) (pgx.Tx, error)
}

// FillKey is the applied-event primary key; AccountID is the value after the alpaca-default fallback.
type FillKey struct {
	Consumer, UserID, AccountID, OrderID string
}

func (k FillKey) args() []any { return []any{k.Consumer, k.UserID, k.AccountID, k.OrderID} }

const appliedKeyWhere = `consumer=$1 AND user_id=$2 AND account_id=$3 AND order_id=$4`

type AppliedFill struct {
	EventID, Outcome string
	PendingClosed    *string
}

type PositionKey struct {
	UserID, Symbol string
	Mode           commonv1.TradingMode
	AccountID      string
}

func (p PositionKey) args() []any { return []any{p.UserID, p.Symbol, p.Mode.String(), p.AccountID} }

type LockedPosition struct {
	Qty, AvgEntryPrice, CostBasis, RealizedAccum, FeesAccum float64
	OpenedAt                                                time.Time
}

// PositionValues are absolute: the upsert stores them as-is and never adds to the stored accumulators.
type PositionValues struct {
	Qty, AvgEntryPrice, CostBasis, RealizedAccum, FeesAccum float64
}

type FoldWrite int

const (
	FoldUpsert FoldWrite = iota + 1
	FoldDelete
	// FoldFlip deletes the row, then inserts Position as a fresh row.
	FoldFlip
)

type FoldOutcome struct {
	Write         FoldWrite
	Position      PositionValues
	PendingClosed *string
}

// FoldFn must be pure: it runs inside the transaction while the position row is locked.
type FoldFn func(existing *LockedPosition) FoldOutcome

type FillResult struct {
	Prior   *LockedPosition
	Outcome FoldOutcome
}

func (r *PortfolioRepo) FillApplied(ctx context.Context, key FillKey) (*AppliedFill, error) {
	var a AppliedFill
	err := r.db.QueryRow(ctx,
		`SELECT event_id, outcome, pending_closed::text FROM portfolio.consumer_applied_events
		 WHERE `+appliedKeyWhere, key.args()...).Scan(&a.EventID, &a.Outcome, &a.PendingClosed)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("fill applied: %w", err)
	}
	return &a, nil
}

func (r *PortfolioRepo) ApplyFill(ctx context.Context, key FillKey, eventID string, pos PositionKey, fold FoldFn) (*FillResult, error) {
	b, ok := r.db.(txBeginner)
	if !ok {
		return nil, errors.New("apply fill: db cannot begin a transaction")
	}
	tx, err := b.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("apply fill begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	tag, err := tx.Exec(ctx,
		`INSERT INTO portfolio.consumer_applied_events (consumer, user_id, account_id, order_id, event_id, outcome)
		 VALUES ($1, $2, $3, $4, $5, 'applied') ON CONFLICT DO NOTHING`,
		append(key.args(), eventID)...)
	if err != nil {
		return nil, fmt.Errorf("apply fill insert applied: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrFillAlreadyApplied
	}
	// Transaction-scoped only: DB_PGBOUNCER transaction pooling cannot hold a session lock.
	lockKey := strings.Join([]string{pos.UserID, pos.Symbol, pos.Mode.String(), pos.AccountID}, "|")
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, lockKey); err != nil {
		return nil, fmt.Errorf("apply fill advisory lock: %w", err)
	}
	prior, err := lockPosition(ctx, tx, pos)
	if err != nil {
		return nil, err
	}
	out := fold(prior)
	if err := writePosition(ctx, tx, pos, out); err != nil {
		return nil, err
	}
	if out.PendingClosed != nil {
		// Bind as string: a []byte would be sent as bytea, not jsonb text.
		if _, err := tx.Exec(ctx,
			`UPDATE portfolio.consumer_applied_events SET pending_closed = $5::jsonb
			 WHERE `+appliedKeyWhere, append(key.args(), *out.PendingClosed)...); err != nil {
			return nil, fmt.Errorf("apply fill set pending_closed: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("apply fill commit: %w", err)
	}
	return &FillResult{Prior: prior, Outcome: out}, nil
}

func lockPosition(ctx context.Context, tx pgx.Tx, pos PositionKey) (*LockedPosition, error) {
	var p LockedPosition
	err := tx.QueryRow(ctx,
		`SELECT qty, avg_entry_price, cost_basis, realized_accum, fees_accum, opened_at
		 FROM portfolio.positions
		 WHERE user_id=$1 AND symbol=$2 AND trading_mode=$3 AND account_id=$4
		 FOR UPDATE`, pos.args()...).
		Scan(&p.Qty, &p.AvgEntryPrice, &p.CostBasis, &p.RealizedAccum, &p.FeesAccum, &p.OpenedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("apply fill lock position: %w", err)
	}
	return &p, nil
}

func writePosition(ctx context.Context, tx pgx.Tx, pos PositionKey, out FoldOutcome) error {
	switch out.Write {
	case FoldUpsert:
		return upsertAbsolute(ctx, tx, pos, out.Position)
	case FoldDelete:
		return deletePosition(ctx, tx, pos)
	case FoldFlip:
		if err := deletePosition(ctx, tx, pos); err != nil {
			return err
		}
		return upsertAbsolute(ctx, tx, pos, out.Position)
	default:
		return fmt.Errorf("apply fill: unknown fold write %d", out.Write)
	}
}

func deletePosition(ctx context.Context, tx pgx.Tx, pos PositionKey) error {
	if _, err := tx.Exec(ctx,
		`DELETE FROM portfolio.positions WHERE user_id=$1 AND symbol=$2 AND trading_mode=$3 AND account_id=$4`,
		pos.args()...); err != nil {
		return fmt.Errorf("apply fill delete position: %w", err)
	}
	return nil
}

func upsertAbsolute(ctx context.Context, tx pgx.Tx, pos PositionKey, v PositionValues) error {
	const q = `
		INSERT INTO portfolio.positions (user_id, symbol, qty, avg_entry_price, cost_basis, trading_mode, account_id, realized_accum, fees_accum, opened_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
		ON CONFLICT (user_id, symbol, trading_mode, account_id) DO UPDATE
		SET qty=$3, avg_entry_price=$4, cost_basis=$5, realized_accum=$8, fees_accum=$9, updated_at=NOW()`
	if _, err := tx.Exec(ctx, q, pos.UserID, pos.Symbol, v.Qty, v.AvgEntryPrice, v.CostBasis,
		pos.Mode.String(), pos.AccountID, v.RealizedAccum, v.FeesAccum); err != nil {
		return fmt.Errorf("apply fill upsert position: %w", err)
	}
	return nil
}

func (r *PortfolioRepo) ClearPendingClosed(ctx context.Context, key FillKey) error {
	if _, err := r.db.Exec(ctx,
		`UPDATE portfolio.consumer_applied_events SET pending_closed = NULL
		 WHERE `+appliedKeyWhere+` AND pending_closed IS NOT NULL`, key.args()...); err != nil {
		return fmt.Errorf("clear pending_closed: %w", err)
	}
	return nil
}

func (r *PortfolioRepo) ParkFill(ctx context.Context, key FillKey, eventID, reason string) (bool, error) {
	var consumer string
	err := r.db.QueryRow(ctx,
		`INSERT INTO portfolio.consumer_applied_events (consumer, user_id, account_id, order_id, event_id, outcome, parked_reason)
		 VALUES ($1, $2, $3, $4, $5, 'parked', $6) ON CONFLICT DO NOTHING RETURNING consumer`,
		append(key.args(), eventID, reason)...).Scan(&consumer)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("park fill: %w", err)
	}
	return true, nil
}

func (r *PortfolioRepo) EnsureFillFloor(ctx context.Context) (time.Time, bool, error) {
	tag, err := r.db.Exec(ctx,
		`INSERT INTO portfolio.consumer_floors (consumer, floor_recorded_at)
		 VALUES ($1, date_trunc('milliseconds', clock_timestamp())) ON CONFLICT DO NOTHING`, ConsumerOrderFill)
	if err != nil {
		return time.Time{}, false, fmt.Errorf("stamp fill floor: %w", err)
	}
	var floor time.Time
	if err := r.db.QueryRow(ctx,
		`SELECT floor_recorded_at FROM portfolio.consumer_floors WHERE consumer = $1`, ConsumerOrderFill).
		Scan(&floor); err != nil {
		return time.Time{}, false, fmt.Errorf("load fill floor: %w", err)
	}
	return floor, tag.RowsAffected() == 1, nil
}
