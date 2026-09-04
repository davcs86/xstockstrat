package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"google.golang.org/protobuf/types/known/timestamppb"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	tradingv1 "github.com/xstockstrat/contracts/gen/go/trading/v1"
)

// dbQuerier is the query subset extracted so the LATERAL-join reads can be exercised with pgxmock
// (this service has no live-DB test harness). Both *pgxpool.Pool and pgxmock satisfy it.
type dbQuerier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// TradingRepo persists orders to the trading.orders hypertable.
type TradingRepo struct {
	pool *pgxpool.Pool
	db   dbQuerier
}

// NewTradingRepo opens a pgxpool connection to the given DSN.
func NewTradingRepo(connStr string) (*TradingRepo, error) {
	pool, err := newPool(context.Background(), connStr)
	if err != nil {
		return nil, fmt.Errorf("newPool: %w", err)
	}
	return &TradingRepo{pool: pool, db: pool}, nil
}

// Pool exposes the underlying connection pool so sibling repositories
// (e.g. AccountRepo) can share it instead of opening a second pool.
func (r *TradingRepo) Pool() *pgxpool.Pool {
	return r.pool
}

// UpsertOrder inserts a new order or updates an existing one.
// The primary key is (order_id, created_at) to satisfy the hypertable constraint.
func (r *TradingRepo) UpsertOrder(ctx context.Context, o *tradingv1.Order) error {
	createdAt := time.Now()
	if o.CreatedAt != nil {
		createdAt = o.CreatedAt.AsTime()
	}
	updatedAt := time.Now()
	if o.UpdatedAt != nil {
		updatedAt = o.UpdatedAt.AsTime()
	}

	_, err := r.pool.Exec(ctx, `
		INSERT INTO trading.orders (
			order_id, client_order_id, broker_order_id, symbol, side, order_type,
			status, qty, filled_qty, limit_price, stop_price, filled_avg_price,
			time_in_force, strategy_id, user_id, trading_mode,
			requires_approval, created_at, updated_at,
			account_id, broker_type, filled_at
		) VALUES (
			$1, $2, $3, $4, $5, $6,
			$7, $8, $9, $10, $11, $12,
			$13, $14, $15, $16,
			$17, $18, $19,
			$20, $21, $22
		)
		ON CONFLICT (order_id, created_at) DO UPDATE SET
			broker_order_id   = EXCLUDED.broker_order_id,
			status            = EXCLUDED.status,
			filled_qty        = EXCLUDED.filled_qty,
			filled_avg_price  = EXCLUDED.filled_avg_price,
			updated_at        = EXCLUDED.updated_at,
			account_id        = EXCLUDED.account_id,
			broker_type       = EXCLUDED.broker_type,
			filled_at         = EXCLUDED.filled_at
	`,
		o.OrderId, o.ClientOrderId, o.BrokerOrderId,
		o.Symbol, sideStr(o.Side), typeStr(o.OrderType),
		statusStr(o.Status), o.Qty, o.FilledQty,
		nullableFloat(o.LimitPrice), nullableFloat(o.StopPrice), nullableFloat(o.FilledAvgPrice),
		o.TimeInForce, o.StrategyId, o.UserId, modeStr(o.TradingMode),
		false, createdAt, updatedAt,
		o.AccountId, int32(o.BrokerType), nullableTime(o.FilledAt),
	)
	return err
}

// intentLateralJoinSQL surfaces cross-intent precedence: the intent with the latest updated_at
// for an order_id determines the intent_state shown on that Order (a read-time join, no writes).
const intentLateralJoinSQL = `
	LEFT JOIN LATERAL (
	    SELECT state, updated_at AS intent_updated_at FROM trading.order_intents
	    WHERE order_id = trading.orders.order_id
	    ORDER BY updated_at DESC LIMIT 1
	) li ON true`

// GetOrder fetches a single order by order_id. Returns nil if not found.
func (r *TradingRepo) GetOrder(ctx context.Context, orderID string) (*tradingv1.Order, error) {
	row := r.db.QueryRow(ctx, `
		SELECT order_id, client_order_id, broker_order_id, symbol, side, order_type,
		       status, qty, filled_qty, limit_price, stop_price, filled_avg_price,
		       time_in_force, strategy_id, user_id, trading_mode, created_at, updated_at,
		       account_id, broker_type, filled_at, li.state
		FROM trading.orders
		`+intentLateralJoinSQL+`
		WHERE order_id = $1
		ORDER BY created_at DESC
		LIMIT 1
	`, orderID)

	return scanOrder(row)
}

// KnownBrokerOrderIDs returns the subset of brokerOrderIDs this account has a persisted record of
// in trading.orders — the reconciliation poller's DB-grounding check so a platform-placed order now
// terminal (evicted from memory) is not misclassified as foreign. Empty input returns empty, no query.
func (r *TradingRepo) KnownBrokerOrderIDs(ctx context.Context, accountID string, brokerOrderIDs []string) (map[string]bool, error) {
	known := make(map[string]bool, len(brokerOrderIDs))
	if len(brokerOrderIDs) == 0 {
		return known, nil
	}
	rows, err := r.db.Query(ctx, `
		SELECT DISTINCT broker_order_id
		FROM trading.orders
		WHERE account_id = $1
		  AND broker_order_id = ANY($2)
	`, accountID, brokerOrderIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		known[id] = true
	}
	return known, rows.Err()
}

// ListOrders returns orders filtered by optional userID, status, tradingMode, and strategyID.
func (r *TradingRepo) ListOrders(
	ctx context.Context,
	userID string,
	status tradingv1.OrderStatus,
	mode commonv1.TradingMode,
	strategyID string,
	symbol string,
	side tradingv1.OrderSide,
	orderType tradingv1.OrderType,
	accountID string,
	rng *commonv1.TimeRange,
) ([]*tradingv1.Order, error) {
	query := `
		SELECT order_id, client_order_id, broker_order_id, symbol, side, order_type,
		       status, qty, filled_qty, limit_price, stop_price, filled_avg_price,
		       time_in_force, strategy_id, user_id, trading_mode, created_at, updated_at,
		       account_id, broker_type, filled_at, li.state
		FROM trading.orders
		` + intentLateralJoinSQL + `
		WHERE 1=1
	`
	args := []interface{}{}
	i := 1
	if userID != "" {
		query += fmt.Sprintf(" AND user_id = $%d", i)
		args = append(args, userID)
		i++
	}
	if status != tradingv1.OrderStatus_ORDER_STATUS_UNSPECIFIED {
		query += fmt.Sprintf(" AND status = $%d", i)
		args = append(args, statusStr(status))
		i++
	}
	if mode != commonv1.TradingMode_TRADING_MODE_UNSPECIFIED {
		query += fmt.Sprintf(" AND trading_mode = $%d", i)
		args = append(args, modeStr(mode))
		i++
	}
	if strategyID != "" {
		query += fmt.Sprintf(" AND strategy_id = $%d", i)
		args = append(args, strategyID)
		i++
	}
	if symbol != "" {
		query += fmt.Sprintf(" AND symbol = $%d", i)
		args = append(args, symbol)
		i++
	}
	if side != tradingv1.OrderSide_ORDER_SIDE_UNSPECIFIED {
		query += fmt.Sprintf(" AND side = $%d", i)
		args = append(args, sideStr(side))
		i++
	}
	if orderType != tradingv1.OrderType_ORDER_TYPE_UNSPECIFIED {
		query += fmt.Sprintf(" AND order_type = $%d", i)
		args = append(args, typeStr(orderType))
		i++
	}
	if accountID != "" {
		query += fmt.Sprintf(" AND account_id = $%d", i)
		args = append(args, accountID)
		i++
	}
	if rng != nil {
		if rng.Start != nil {
			query += fmt.Sprintf(" AND created_at >= $%d", i)
			args = append(args, rng.Start.AsTime())
			i++
		}
		if rng.End != nil {
			query += fmt.Sprintf(" AND created_at <= $%d", i)
			args = append(args, rng.End.AsTime())
			// created_at <= is the last optional clause; no further i++ needed (ineffassign).
		}
	}
	query += " ORDER BY created_at DESC LIMIT 500"

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var orders []*tradingv1.Order
	for rows.Next() {
		o, err := scanOrder(rows)
		if err != nil {
			return nil, err
		}
		orders = append(orders, o)
	}
	return orders, rows.Err()
}

// ListSubmittedOrders returns orders that are in-flight at the broker
// (status NEW or PARTIALLY_FILLED with a broker_order_id set).
// Used by the fill poller to detect fills.
func (r *TradingRepo) ListSubmittedOrders(ctx context.Context) ([]*tradingv1.Order, error) {
	rows, err := r.db.Query(ctx, `
		SELECT order_id, client_order_id, broker_order_id, symbol, side, order_type,
		       status, qty, filled_qty, limit_price, stop_price, filled_avg_price,
		       time_in_force, strategy_id, user_id, trading_mode, created_at, updated_at,
		       account_id, broker_type, filled_at, li.state
		FROM trading.orders
		`+intentLateralJoinSQL+`
		WHERE status IN ('new', 'partially_filled')
		  AND broker_order_id IS NOT NULL
		  AND broker_order_id != ''
		ORDER BY created_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var orders []*tradingv1.Order
	for rows.Next() {
		o, err := scanOrder(rows)
		if err != nil {
			return nil, err
		}
		orders = append(orders, o)
	}
	return orders, rows.Err()
}

// ListConfirmedOfflineOrdersByAccount returns an offline account's confirmed orders (PARTIALLY_FILLED
// or FILLED, filled_qty > 0), ordered by fill time — the set ConfirmOrder folds into net positions
// (idempotent: re-editing one fill yields the same fold).
func (r *TradingRepo) ListConfirmedOfflineOrdersByAccount(ctx context.Context, accountID string) ([]*tradingv1.Order, error) {
	rows, err := r.db.Query(ctx, `
		SELECT order_id, client_order_id, broker_order_id, symbol, side, order_type,
		       status, qty, filled_qty, limit_price, stop_price, filled_avg_price,
		       time_in_force, strategy_id, user_id, trading_mode, created_at, updated_at,
		       account_id, broker_type, filled_at, li.state
		FROM trading.orders
		`+intentLateralJoinSQL+`
		WHERE account_id = $1
		  AND status IN ('partially_filled', 'filled')
		  AND filled_qty > 0
		ORDER BY filled_at ASC NULLS LAST, created_at ASC
	`, accountID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var orders []*tradingv1.Order
	for rows.Next() {
		o, err := scanOrder(rows)
		if err != nil {
			return nil, err
		}
		orders = append(orders, o)
	}
	return orders, rows.Err()
}

// scanner abstracts pgx.Row and pgx.Rows so scanOrder works on both.
type scanner interface {
	Scan(dest ...interface{}) error
}

func scanOrder(row scanner) (*tradingv1.Order, error) {
	var (
		orderID, clientOrderID, brokerOrderID string
		symbol, side, orderType, status       string
		qty, filledQty                        float64
		limitPrice, stopPrice, filledAvgPrice *float64
		timeInForce, strategyID, userID, mode string
		createdAt, updatedAt                  time.Time
		accountID                             string
		brokerType                            int32
		filledAt                              *time.Time // NULL for a NEW/unconfirmed or historical order
		intentState                           *int16     // NULL when the order has no intents yet
	)
	err := row.Scan(
		&orderID, &clientOrderID, &brokerOrderID,
		&symbol, &side, &orderType, &status,
		&qty, &filledQty, &limitPrice, &stopPrice, &filledAvgPrice,
		&timeInForce, &strategyID, &userID, &mode,
		&createdAt, &updatedAt,
		&accountID, &brokerType, &filledAt, &intentState,
	)
	if err != nil {
		return nil, err
	}

	o := &tradingv1.Order{
		OrderId:       orderID,
		ClientOrderId: clientOrderID,
		BrokerOrderId: brokerOrderID,
		Symbol:        symbol,
		Side:          parseSide(side),
		OrderType:     parseType(orderType),
		Status:        parseStatus(status),
		Qty:           qty,
		FilledQty:     filledQty,
		TimeInForce:   timeInForce,
		StrategyId:    strategyID,
		UserId:        userID,
		TradingMode:   parseMode(mode),
		CreatedAt:     timestamppb.New(createdAt),
		UpdatedAt:     timestamppb.New(updatedAt),
		AccountId:     accountID,
		BrokerType:    commonv1.BrokerType(brokerType),
	}
	if filledAt != nil {
		o.FilledAt = timestamppb.New(*filledAt)
	}
	if intentState != nil {
		o.IntentState = tradingv1.IntentState(*intentState)
	}
	if limitPrice != nil {
		o.LimitPrice = *limitPrice
	}
	if stopPrice != nil {
		o.StopPrice = *stopPrice
	}
	if filledAvgPrice != nil {
		o.FilledAvgPrice = *filledAvgPrice
	}
	return o, nil
}

// ── string helpers ────────────────────────────────────────────────────────────

func sideStr(s tradingv1.OrderSide) string {
	if s == tradingv1.OrderSide_ORDER_SIDE_SELL {
		return "sell"
	}
	return "buy"
}

func typeStr(t tradingv1.OrderType) string {
	switch t {
	case tradingv1.OrderType_ORDER_TYPE_LIMIT:
		return "limit"
	case tradingv1.OrderType_ORDER_TYPE_STOP:
		return "stop"
	case tradingv1.OrderType_ORDER_TYPE_STOP_LIMIT:
		return "stop_limit"
	case tradingv1.OrderType_ORDER_TYPE_TRAILING_STOP:
		return "trailing_stop"
	default:
		return "market"
	}
}

func statusStr(s tradingv1.OrderStatus) string {
	switch s {
	case tradingv1.OrderStatus_ORDER_STATUS_PARTIALLY_FILLED:
		return "partially_filled"
	case tradingv1.OrderStatus_ORDER_STATUS_FILLED:
		return "filled"
	case tradingv1.OrderStatus_ORDER_STATUS_CANCELED:
		return "canceled"
	case tradingv1.OrderStatus_ORDER_STATUS_EXPIRED:
		return "expired"
	case tradingv1.OrderStatus_ORDER_STATUS_REJECTED:
		return "rejected"
	case tradingv1.OrderStatus_ORDER_STATUS_PENDING_APPROVAL:
		return "pending_approval"
	default:
		return "new"
	}
}

func modeStr(m commonv1.TradingMode) string {
	if m == commonv1.TradingMode_TRADING_MODE_LIVE {
		return "live"
	}
	return "paper"
}

func nullableFloat(f float64) interface{} {
	if f == 0 {
		return nil
	}
	return f
}

// nullableTime maps a proto Timestamp to a nullable SQL TIMESTAMPTZ arg: nil (SQL NULL) when
// unset, else the Go time. Offline orders carry filled_at only after ConfirmOrder.
func nullableTime(ts *timestamppb.Timestamp) interface{} {
	if ts == nil {
		return nil
	}
	return ts.AsTime()
}

func parseSide(s string) tradingv1.OrderSide {
	if s == "sell" {
		return tradingv1.OrderSide_ORDER_SIDE_SELL
	}
	return tradingv1.OrderSide_ORDER_SIDE_BUY
}

func parseType(s string) tradingv1.OrderType {
	switch s {
	case "limit":
		return tradingv1.OrderType_ORDER_TYPE_LIMIT
	case "stop":
		return tradingv1.OrderType_ORDER_TYPE_STOP
	case "stop_limit":
		return tradingv1.OrderType_ORDER_TYPE_STOP_LIMIT
	case "trailing_stop":
		return tradingv1.OrderType_ORDER_TYPE_TRAILING_STOP
	default:
		return tradingv1.OrderType_ORDER_TYPE_MARKET
	}
}

func parseStatus(s string) tradingv1.OrderStatus {
	switch s {
	case "partially_filled":
		return tradingv1.OrderStatus_ORDER_STATUS_PARTIALLY_FILLED
	case "filled":
		return tradingv1.OrderStatus_ORDER_STATUS_FILLED
	case "canceled":
		return tradingv1.OrderStatus_ORDER_STATUS_CANCELED
	case "expired":
		return tradingv1.OrderStatus_ORDER_STATUS_EXPIRED
	case "rejected":
		return tradingv1.OrderStatus_ORDER_STATUS_REJECTED
	case "pending_approval":
		return tradingv1.OrderStatus_ORDER_STATUS_PENDING_APPROVAL
	default:
		return tradingv1.OrderStatus_ORDER_STATUS_NEW
	}
}

func parseMode(s string) commonv1.TradingMode {
	if s == "live" {
		return commonv1.TradingMode_TRADING_MODE_LIVE
	}
	return commonv1.TradingMode_TRADING_MODE_PAPER
}
