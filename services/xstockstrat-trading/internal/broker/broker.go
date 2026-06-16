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
//
// CurrentPrice / MarketValue / UnrealizedPnl / UnrealizedPnlPct are the broker's own
// mark-to-market valuation (Alpaca and IBKR both return them on their positions endpoints).
// Carrying them through lets the portfolio card show figures that reconcile with the broker's
// authoritative equity instead of recomputing from marketdata mid-quotes, which use a
// different price basis and never tie out. Zero means the broker did not report a value.
type BrokerPosition struct {
	Symbol           string
	Quantity         float64
	AvgCost          float64
	CurrentPrice     float64
	MarketValue      float64
	UnrealizedPnl    float64
	UnrealizedPnlPct float64
	// DayPnl / DayPnlPct are the broker's intraday (today's) P&L — the change since the
	// previous trading day's close (Alpaca unrealized_intraday_pl / unrealized_intraday_plpc).
	// Distinct from UnrealizedPnl, which is total P&L since entry. Zero means the broker did
	// not report an intraday figure (e.g. IBKR's positions endpoint omits it).
	DayPnl    float64
	DayPnlPct float64
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
	// TrailPrice / TrailPercent carry the trailing-stop offset on submission.
	// Exactly one is non-zero for a trailing_stop order; both are zero otherwise.
	TrailPrice   float64
	TrailPercent float64
	// Trail is the new trailing-stop offset on a replace (Alpaca's PATCH body uses a
	// single `trail` value); zero means "leave unchanged".
	Trail float64
	// ClientOrderID is forwarded to the broker for idempotency so a retried
	// submission is de-duplicated instead of placing a second order.
	ClientOrderID string
}
