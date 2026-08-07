package repository

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// OrderBracketRecord is the DB representation of one order's bracket (stop-loss +
// optional take-profit) state machine (feature 030).
type OrderBracketRecord struct {
	ID                     string
	OrderID                string
	AccountID              string
	BrokerType             int32
	Status                 int32 // BracketStatus: matches the SMALLINT encoding in migration 005
	BracketStopPrice       float64
	BracketTakeProfitPrice *float64
	StopLegOrderID         string
	TakeProfitLegOrderID   string
	ProtectionDeadline     time.Time
	FailReason             string
	CreatedAt, UpdatedAt   time.Time
}

// BracketRepository persists the per-order bracket state machine (trading.order_brackets).
type BracketRepository interface {
	CreateBracket(ctx context.Context, rec *OrderBracketRecord) error
	GetBracketByOrderID(ctx context.Context, orderID string) (*OrderBracketRecord, error)
	UpdateBracketStatus(ctx context.Context, id string, status int32, stopLegID, takeProfitLegID, failReason string) error
	// ReArmProtection updates protection_deadline (called at every transition that
	// leaves ACTIVE — design.md's "re-armed... not just the initial one").
	ReArmProtection(ctx context.Context, id string, deadline time.Time) error
	// ListExpiredProtection finds non-ACTIVE, non-terminal brackets past their deadline
	// (the watchdog's scan target — order_brackets_protection_watch_idx backs this).
	ListExpiredProtection(ctx context.Context, now time.Time) ([]*OrderBracketRecord, error)
}

type pgBracketRepo struct {
	pool *pgxpool.Pool
}

// NewBracketRepo creates a new BracketRepository backed by the given pool (reused from
// TradingRepo.Pool() — no new DB_POOL_MAX, per F-06).
func NewBracketRepo(pool *pgxpool.Pool) BracketRepository {
	return &pgBracketRepo{pool: pool}
}

func (r *pgBracketRepo) CreateBracket(ctx context.Context, rec *OrderBracketRecord) error {
	return r.pool.QueryRow(ctx, `
		INSERT INTO trading.order_brackets
			(order_id, account_id, broker_type, status, bracket_stop_price,
			 bracket_take_profit_price, stop_leg_order_id, take_profit_leg_order_id,
			 protection_deadline, fail_reason)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		RETURNING id, created_at, updated_at
	`,
		rec.OrderID, rec.AccountID, rec.BrokerType, rec.Status, rec.BracketStopPrice,
		rec.BracketTakeProfitPrice, rec.StopLegOrderID, rec.TakeProfitLegOrderID,
		rec.ProtectionDeadline, rec.FailReason,
	).Scan(&rec.ID, &rec.CreatedAt, &rec.UpdatedAt)
}

func (r *pgBracketRepo) GetBracketByOrderID(ctx context.Context, orderID string) (*OrderBracketRecord, error) {
	var rec OrderBracketRecord
	err := r.pool.QueryRow(ctx, `
		SELECT id, order_id, account_id, broker_type, status, bracket_stop_price,
		       bracket_take_profit_price, COALESCE(stop_leg_order_id, ''),
		       COALESCE(take_profit_leg_order_id, ''), protection_deadline,
		       COALESCE(fail_reason, ''), created_at, updated_at
		FROM trading.order_brackets
		WHERE order_id = $1
		ORDER BY created_at DESC
		LIMIT 1
	`, orderID).Scan(
		&rec.ID, &rec.OrderID, &rec.AccountID, &rec.BrokerType, &rec.Status, &rec.BracketStopPrice,
		&rec.BracketTakeProfitPrice, &rec.StopLegOrderID, &rec.TakeProfitLegOrderID,
		&rec.ProtectionDeadline, &rec.FailReason, &rec.CreatedAt, &rec.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		// No bracket exists yet for this order — not an error, the caller's own
		// no-op branch handles it (order was never auto-sized, or hasn't reached the
		// fill-confirmed hook yet).
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &rec, nil
}

func (r *pgBracketRepo) UpdateBracketStatus(ctx context.Context, id string, status int32, stopLegID, takeProfitLegID, failReason string) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE trading.order_brackets
		SET status = $2, stop_leg_order_id = NULLIF($3, ''),
		    take_profit_leg_order_id = NULLIF($4, ''), fail_reason = NULLIF($5, ''),
		    updated_at = NOW()
		WHERE id = $1
	`, id, status, stopLegID, takeProfitLegID, failReason)
	return err
}

func (r *pgBracketRepo) ReArmProtection(ctx context.Context, id string, deadline time.Time) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE trading.order_brackets
		SET protection_deadline = $2, updated_at = NOW()
		WHERE id = $1
	`, id, deadline)
	return err
}

func (r *pgBracketRepo) ListExpiredProtection(ctx context.Context, now time.Time) ([]*OrderBracketRecord, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, order_id, account_id, broker_type, status, bracket_stop_price,
		       bracket_take_profit_price, COALESCE(stop_leg_order_id, ''),
		       COALESCE(take_profit_leg_order_id, ''), protection_deadline,
		       COALESCE(fail_reason, ''), created_at, updated_at
		FROM trading.order_brackets
		WHERE status IN (0, 1, 2, 4) AND protection_deadline < $1
	`, now)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []*OrderBracketRecord
	for rows.Next() {
		var rec OrderBracketRecord
		if err := rows.Scan(
			&rec.ID, &rec.OrderID, &rec.AccountID, &rec.BrokerType, &rec.Status, &rec.BracketStopPrice,
			&rec.BracketTakeProfitPrice, &rec.StopLegOrderID, &rec.TakeProfitLegOrderID,
			&rec.ProtectionDeadline, &rec.FailReason, &rec.CreatedAt, &rec.UpdatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, &rec)
	}
	return out, rows.Err()
}
