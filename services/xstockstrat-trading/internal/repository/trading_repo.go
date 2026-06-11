package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"google.golang.org/protobuf/types/known/timestamppb"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	tradingv1 "github.com/xstockstrat/contracts/gen/go/trading/v1"
)

// TradingRepo persists orders to the trading.orders hypertable.
type TradingRepo struct {
	pool *pgxpool.Pool
}

// NewTradingRepo opens a pgxpool connection to the given DSN.
func NewTradingRepo(connStr string) (*TradingRepo, error) {
	pool, err := pgxpool.New(context.Background(), connStr)
	if err != nil {
		return nil, fmt.Errorf("pgxpool.New: %w", err)
	}
	return &TradingRepo{pool: pool}, nil
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
			account_id, broker_type
		) VALUES (
			$1, $2, $3, $4, $5, $6,
			$7, $8, $9, $10, $11, $12,
			$13, $14, $15, $16,
			$17, $18, $19,
			$20, $21
		)
		ON CONFLICT (order_id, created_at) DO UPDATE SET
			broker_order_id   = EXCLUDED.broker_order_id,
			status            = EXCLUDED.status,
			filled_qty        = EXCLUDED.filled_qty,
			filled_avg_price  = EXCLUDED.filled_avg_price,
			updated_at        = EXCLUDED.updated_at,
			account_id        = EXCLUDED.account_id,
			broker_type       = EXCLUDED.broker_type
	`,
		o.OrderId, o.ClientOrderId, o.BrokerOrderId,
		o.Symbol, sideStr(o.Side), typeStr(o.OrderType),
		statusStr(o.Status), o.Qty, o.FilledQty,
		nullableFloat(o.LimitPrice), nullableFloat(o.StopPrice), nullableFloat(o.FilledAvgPrice),
		o.TimeInForce, o.StrategyId, o.UserId, modeStr(o.TradingMode),
		false, createdAt, updatedAt,
		o.AccountId, int32(o.BrokerType),
	)
	return err
}

// GetOrder fetches a single order by order_id. Returns nil if not found.
func (r *TradingRepo) GetOrder(ctx context.Context, orderID string) (*tradingv1.Order, error) {
	row := r.pool.QueryRow(ctx, `
		SELECT order_id, client_order_id, broker_order_id, symbol, side, order_type,
		       status, qty, filled_qty, limit_price, stop_price, filled_avg_price,
		       time_in_force, strategy_id, user_id, trading_mode, created_at, updated_at,
		       account_id, broker_type
		FROM trading.orders
		WHERE order_id = $1
		ORDER BY created_at DESC
		LIMIT 1
	`, orderID)

	return scanOrder(row)
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
) ([]*tradingv1.Order, error) {
	query := `
		SELECT order_id, client_order_id, broker_order_id, symbol, side, order_type,
		       status, qty, filled_qty, limit_price, stop_price, filled_avg_price,
		       time_in_force, strategy_id, user_id, trading_mode, created_at, updated_at,
		       account_id, broker_type
		FROM trading.orders
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
	query += " ORDER BY created_at DESC LIMIT 500"

	rows, err := r.pool.Query(ctx, query, args...)
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
	rows, err := r.pool.Query(ctx, `
		SELECT order_id, client_order_id, broker_order_id, symbol, side, order_type,
		       status, qty, filled_qty, limit_price, stop_price, filled_avg_price,
		       time_in_force, strategy_id, user_id, trading_mode, created_at, updated_at,
		       account_id, broker_type
		FROM trading.orders
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
	)
	err := row.Scan(
		&orderID, &clientOrderID, &brokerOrderID,
		&symbol, &side, &orderType, &status,
		&qty, &filledQty, &limitPrice, &stopPrice, &filledAvgPrice,
		&timeInForce, &strategyID, &userID, &mode,
		&createdAt, &updatedAt,
		&accountID, &brokerType,
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
