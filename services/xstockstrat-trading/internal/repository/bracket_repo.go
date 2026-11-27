package repository

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	tradingv1 "github.com/xstockstrat/contracts/gen/go/trading/v1"
)

// OrderBracketRecord is the DB representation of one order's bracket (stop-loss +
// optional take-profit) state machine.
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
	// ReArmProtection updates protection_deadline — called at every transition that leaves ACTIVE.
	ReArmProtection(ctx context.Context, id string, deadline time.Time) error
	// ListExpiredProtection finds non-ACTIVE, non-terminal brackets past their deadline
	// (the watchdog's scan target).
	ListExpiredProtection(ctx context.Context, now time.Time) ([]*OrderBracketRecord, error)

	// ActivateBracket sets the bracket ACTIVE with its leg ids and, in the same transaction,
	// starts tracking each non-empty leg id in trading.bracket_legs (an existing row is kept).
	ActivateBracket(ctx context.Context, id string, stopLegID, takeProfitLegID string, parent BracketLegParent) error
	// ListTrackedLegs returns legs not in RetiredLegStatuses, non-adopted first, least recently updated first.
	ListTrackedLegs(ctx context.Context) ([]*BracketLegRecord, error)
	// ListAdoptionCandidates returns the non-empty leg ids of brackets in the given statuses that have
	// no bracket_legs row and whose parent order exists, with the parent's data and the closing side.
	ListAdoptionCandidates(ctx context.Context, statuses []int32) ([]*BracketLegRecord, error)
	InsertAdoptedLeg(ctx context.Context, rec *BracketLegRecord) (inserted bool, err error)
	RecordLegObservation(ctx context.Context, accountID, legID string, observedFilledQty float64, notFoundTicks int) error
	// AdvanceLegEmit moves the emit cursor; a retired status retires the leg.
	AdvanceLegEmit(ctx context.Context, accountID, legID string, filledQty float64, status string) error
}

// trading.bracket_legs.status values. The column has no CHECK; RetiredLegStatuses is the one list.
const (
	LegStatusOpen              = "OPEN"
	LegStatusFilled            = "FILLED"
	LegStatusCanceled          = "CANCELED"
	LegStatusExpired           = "EXPIRED"
	LegStatusRejected          = "REJECTED"
	LegStatusUnknown           = "UNKNOWN"
	LegStatusBaselineRetired   = "BASELINE_RETIRED"
	LegStatusNotOpenAtAdoption = "NOT_OPEN_AT_ADOPTION"
)

// RetiredLegStatuses is bound into every retired-leg predicate as status <> ALL($n); never restate it.
var RetiredLegStatuses = []string{
	LegStatusFilled, LegStatusCanceled, LegStatusExpired, LegStatusRejected,
	LegStatusUnknown, LegStatusBaselineRetired, LegStatusNotOpenAtAdoption,
}

// BracketLegRecord is one trading.bracket_legs row. FilledQty is the emit cursor;
// ObservedFilledQty is the broker's last reported fill, read by reconciliation.
type BracketLegRecord struct {
	AccountID, LegOrderID, OrderID, UserID, TradingMode, Symbol string
	Side                                                        tradingv1.OrderSide
	FilledQty, ObservedFilledQty                                float64
	Status                                                      string
	NotFoundTicks                                               int
	Adopted                                                     bool
}

// BracketLegParent is the parent order data each leg row carries. Side is the leg's own
// (closing) side, already flipped by the caller.
type BracketLegParent struct {
	AccountID, OrderID, UserID, TradingMode, Symbol string
	Side                                            tradingv1.OrderSide
}

// bracketDB is the pool subset pgBracketRepo uses; *pgxpool.Pool and pgxmock satisfy it.
type bracketDB interface {
	dbQuerier
	Begin(ctx context.Context) (pgx.Tx, error)
}

type pgBracketRepo struct {
	pool bracketDB
}

// NewBracketRepo creates a new BracketRepository backed by the given (shared) pool.
func NewBracketRepo(pool *pgxpool.Pool) BracketRepository {
	return &pgBracketRepo{pool: pool}
}

// bracketStatusActive is trading.order_brackets' ACTIVE status code (migration 005).
const bracketStatusActive int32 = 3

const updateBracketStatusSQL = `
	UPDATE trading.order_brackets
	SET status = $2, stop_leg_order_id = NULLIF($3, ''),
	    take_profit_leg_order_id = NULLIF($4, ''), fail_reason = NULLIF($5, ''),
	    updated_at = NOW()
	WHERE id = $1
`

const insertBracketLegSQL = `
	INSERT INTO trading.bracket_legs
		(account_id, leg_order_id, order_id, user_id, trading_mode, symbol, side,
		 filled_qty, observed_filled_qty, status, adopted)
	VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
	ON CONFLICT (account_id, leg_order_id) DO NOTHING
`

func insertBracketLegArgs(rec *BracketLegRecord, adopted bool) []any {
	return []any{
		rec.AccountID, rec.LegOrderID, rec.OrderID, rec.UserID, rec.TradingMode, rec.Symbol, sideStr(rec.Side),
		rec.FilledQty, rec.ObservedFilledQty, rec.Status, adopted,
	}
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
		// No bracket yet for this order — not an error; returns nil,nil for the caller's no-op branch.
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &rec, nil
}

func (r *pgBracketRepo) UpdateBracketStatus(ctx context.Context, id string, status int32, stopLegID, takeProfitLegID, failReason string) error {
	_, err := r.pool.Exec(ctx, updateBracketStatusSQL, id, status, stopLegID, takeProfitLegID, failReason)
	return err
}

func (r *pgBracketRepo) ActivateBracket(ctx context.Context, id string, stopLegID, takeProfitLegID string, parent BracketLegParent) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	if err := activateInTx(ctx, tx, id, stopLegID, takeProfitLegID, parent); err != nil {
		_ = tx.Rollback(ctx)
		return err
	}
	return tx.Commit(ctx)
}

func activateInTx(ctx context.Context, tx pgx.Tx, id, stopLegID, takeProfitLegID string, parent BracketLegParent) error {
	if _, err := tx.Exec(ctx, updateBracketStatusSQL, id, bracketStatusActive, stopLegID, takeProfitLegID, ""); err != nil {
		return err
	}
	for _, legID := range []string{stopLegID, takeProfitLegID} {
		if legID == "" {
			continue
		}
		leg := &BracketLegRecord{
			AccountID: parent.AccountID, LegOrderID: legID, OrderID: parent.OrderID, UserID: parent.UserID,
			TradingMode: parent.TradingMode, Symbol: parent.Symbol, Side: parent.Side, Status: LegStatusOpen,
		}
		if _, err := tx.Exec(ctx, insertBracketLegSQL, insertBracketLegArgs(leg, false)...); err != nil {
			return err
		}
	}
	return nil
}

func (r *pgBracketRepo) ListTrackedLegs(ctx context.Context) ([]*BracketLegRecord, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT account_id, leg_order_id, order_id::text, user_id, trading_mode, symbol, side,
		       filled_qty, observed_filled_qty, status, not_found_ticks, adopted
		FROM trading.bracket_legs
		WHERE status <> ALL($1)
		ORDER BY adopted ASC, updated_at ASC
	`, RetiredLegStatuses)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []*BracketLegRecord
	for rows.Next() {
		var (
			rec  BracketLegRecord
			side string
		)
		if err := rows.Scan(
			&rec.AccountID, &rec.LegOrderID, &rec.OrderID, &rec.UserID, &rec.TradingMode, &rec.Symbol, &side,
			&rec.FilledQty, &rec.ObservedFilledQty, &rec.Status, &rec.NotFoundTicks, &rec.Adopted,
		); err != nil {
			return nil, err
		}
		rec.Side = parseSide(side)
		out = append(out, &rec)
	}
	return out, rows.Err()
}

func (r *pgBracketRepo) ListAdoptionCandidates(ctx context.Context, statuses []int32) ([]*BracketLegRecord, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT c.account_id, c.leg_order_id, c.order_id::text, COALESCE(o.user_id, ''),
		       COALESCE(o.trading_mode, ''), o.symbol, o.side
		FROM (
			SELECT account_id, order_id, stop_leg_order_id AS leg_order_id
			FROM trading.order_brackets
			WHERE status = ANY($1)
			UNION
			SELECT account_id, order_id, take_profit_leg_order_id
			FROM trading.order_brackets
			WHERE status = ANY($1)
		) c
		JOIN (
			SELECT DISTINCT ON (order_id) order_id, user_id, trading_mode, symbol, side
			FROM trading.orders
			WHERE order_id IN (SELECT order_id FROM trading.order_brackets WHERE status = ANY($1))
			ORDER BY order_id, created_at DESC
		) o ON o.order_id = c.order_id
		WHERE c.leg_order_id <> ''
		  AND NOT EXISTS (
			SELECT 1 FROM trading.bracket_legs l
			WHERE l.account_id = c.account_id AND l.leg_order_id = c.leg_order_id
		  )
		ORDER BY c.account_id, c.leg_order_id
	`, statuses)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []*BracketLegRecord
	for rows.Next() {
		var (
			rec              BracketLegRecord
			mode, parentSide string
		)
		if err := rows.Scan(&rec.AccountID, &rec.LegOrderID, &rec.OrderID, &rec.UserID, &mode, &rec.Symbol, &parentSide); err != nil {
			return nil, err
		}
		// trading.orders stores modeStr; leg rows carry the enum name ActivateBracket writes.
		rec.TradingMode = parseMode(mode).String()
		rec.Side = tradingv1.OrderSide_ORDER_SIDE_SELL
		if parseSide(parentSide) == tradingv1.OrderSide_ORDER_SIDE_SELL {
			rec.Side = tradingv1.OrderSide_ORDER_SIDE_BUY
		}
		out = append(out, &rec)
	}
	return out, rows.Err()
}

func (r *pgBracketRepo) InsertAdoptedLeg(ctx context.Context, rec *BracketLegRecord) (bool, error) {
	tag, err := r.pool.Exec(ctx, insertBracketLegSQL, insertBracketLegArgs(rec, true)...)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

func (r *pgBracketRepo) RecordLegObservation(ctx context.Context, accountID, legID string, observedFilledQty float64, notFoundTicks int) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE trading.bracket_legs
		SET observed_filled_qty = $3, not_found_ticks = $4, updated_at = NOW()
		WHERE account_id = $1 AND leg_order_id = $2
	`, accountID, legID, observedFilledQty, notFoundTicks)
	return err
}

func (r *pgBracketRepo) AdvanceLegEmit(ctx context.Context, accountID, legID string, filledQty float64, status string) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE trading.bracket_legs
		SET filled_qty = $3, status = $4, updated_at = NOW()
		WHERE account_id = $1 AND leg_order_id = $2
	`, accountID, legID, filledQty, status)
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
