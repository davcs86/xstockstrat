package broker

import (
	"context"
	"errors"
)

// ErrInvalidCredentials is returned by ValidateCredentials when the broker
// actively rejects the stored API secrets (HTTP 401/403). Callers use it to
// distinguish a definitive auth failure from a transient/network error, which
// is reported as a wrapped error instead.
var ErrInvalidCredentials = errors.New("broker rejected credentials")

// BrokerOrder is the normalized order representation returned by any broker.
type BrokerOrder struct {
	BrokerOrderID  string
	Status         string
	FilledQty      float64 // cumulative filled quantity; zero for unfilled orders
	FilledAvgPrice float64 // zero for unfilled orders
}

// BrokerPosition is a normalized position snapshot from a broker.
type BrokerPosition struct {
	Symbol   string
	Quantity float64
	AvgCost  float64
}

// BrokerBalance is a normalized account-balance snapshot from a broker.
// LastEquity is the account equity at the previous trading day's close; it is
// used to derive intraday (day) P&L as Equity - LastEquity. When a broker does
// not report a previous-close equity, LastEquity equals Equity (day P&L = 0).
type BrokerBalance struct {
	Cash        float64
	BuyingPower float64
	Equity      float64
	LastEquity  float64
}

// Broker is the interface all broker clients must satisfy.
type Broker interface {
	SubmitOrder(ctx context.Context, req OrderRequest) (*BrokerOrder, error)
	CancelOrder(ctx context.Context, brokerOrderID string) error
	// ReplaceOrder modifies a working order at the broker. req carries only the
	// fields to change; a zero Qty/LimitPrice/StopPrice or empty TimeInForce means
	// "leave unchanged". Routing to the correct broker is the caller's job (per the
	// persisted order's broker_type).
	ReplaceOrder(ctx context.Context, brokerOrderID string, req OrderRequest) (*BrokerOrder, error)
	GetOrder(ctx context.Context, brokerOrderID string) (*BrokerOrder, error)
	GetPositions(ctx context.Context) ([]BrokerPosition, error)
	// GetAccount returns a normalized account-balance snapshot (cash, buying
	// power, equity, and previous-close equity for day-P&L derivation).
	GetAccount(ctx context.Context) (*BrokerBalance, error)
	IsPaper() bool
	// ValidateCredentials performs a lightweight authenticated request to confirm
	// the stored API secrets still work. It returns nil when valid,
	// ErrInvalidCredentials when the broker rejects the credentials, and a wrapped
	// error for transient/network failures.
	ValidateCredentials(ctx context.Context) error
}

// OrderRequest is the normalized order placement request.
type OrderRequest struct {
	Symbol      string
	Side        string
	OrderType   string
	Qty         float64
	LimitPrice  float64
	StopPrice   float64
	TimeInForce string
}
