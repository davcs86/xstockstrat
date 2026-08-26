// Package testdata holds shared test fixtures for xstockstrat-trading's repository tests
// (Constitution C-13 — Go canonical fixture home, materialized at the second consumer of a
// shared literal).
package testdata

import "time"

// OrderRowColumns is the exact positional column order TradingRepo.scanOrder expects
// (internal/repository/trading_repo.go's scanOrder Scan call) — every mocked pgxmock row built
// from NewOrderRow must match it.
var OrderRowColumns = []string{
	"order_id", "client_order_id", "broker_order_id",
	"symbol", "side", "order_type", "status",
	"qty", "filled_qty", "limit_price", "stop_price", "filled_avg_price",
	"time_in_force", "strategy_id", "user_id", "trading_mode",
	"created_at", "updated_at",
	"account_id", "broker_type", "filled_at", "state",
}

// NewOrderRow builds one fixture row (positionally matching OrderRowColumns) with a non-NULL
// intent state, proving a LATERAL-join consumer genuinely exercises that path (not
// NULL-bypassed). Shared across GetOrder/ListOrders/ListSubmittedOrders regression tests, which
// otherwise duplicate the identical 21-column literal three times.
func NewOrderRow(orderID string, updatedAt time.Time, intentState int16) []any {
	return []any{
		orderID, "client-" + orderID, "broker-" + orderID,
		"AAPL", "buy", "market", "new",
		10.0, 0.0, nil, nil, nil,
		"day", "strat-1", "user-1", "paper",
		updatedAt.Add(-time.Hour), updatedAt,
		"account-1", int32(0), nil, &intentState,
	}
}
