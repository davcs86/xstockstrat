package broker

import (
	"context"
	"errors"
)

// ErrInvalidCredentials is returned by ValidateCredentials on a definitive broker auth
// rejection (HTTP 401/403); transient/network failures are returned as wrapped errors instead.
var ErrInvalidCredentials = errors.New("broker rejected credentials")

// BrokerOrder is the normalized order representation returned by any broker.
type BrokerOrder struct {
	BrokerOrderID  string
	Status         string
	FilledQty      float64 // cumulative filled quantity; zero for unfilled orders
	FilledAvgPrice float64 // zero for unfilled orders
	// Fees is the cumulative broker fee for the order; 0 when the broker exposes none.
	// Both Alpaca and IBKR leave it 0 today (US equities are commission-free per-fill).
	Fees float64
	// StopLegOrderID / TakeProfitLegOrderID hold the broker's bracket child order IDs
	// (Alpaca only; empty otherwise).
	StopLegOrderID       string
	TakeProfitLegOrderID string
	// ClientOrderID is the broker's echo of the client-supplied order nonce.
	// Populated for Alpaca; always empty for IBKR (never sent a customer-order tag on submission).
	ClientOrderID string
}

// BrokerPosition is a normalized position snapshot from a broker.
// CurrentPrice/MarketValue/UnrealizedPnl/UnrealizedPnlPct are the broker's own mark-to-market
// valuation; zero means the broker did not report that value.
type BrokerPosition struct {
	Symbol           string
	Quantity         float64
	AvgCost          float64
	CurrentPrice     float64
	MarketValue      float64
	UnrealizedPnl    float64
	UnrealizedPnlPct float64
	// DayPnl / DayPnlPct are the broker's intraday (today's) P&L, distinct from UnrealizedPnl
	// (total since entry). Zero means the broker did not report it (e.g. IBKR omits it).
	DayPnl    float64
	DayPnlPct float64
}

// BrokerBalance is a normalized account-balance snapshot from a broker.
// LastEquity is the previous trading day's close equity; it equals Equity when the broker
// does not report a previous close (so derived day P&L = 0).
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
	// ReplaceOrder modifies a working order; a zero Qty/LimitPrice/StopPrice or empty
	// TimeInForce means "leave unchanged". Routing to the correct broker is the caller's job.
	ReplaceOrder(ctx context.Context, brokerOrderID string, req OrderRequest) (*BrokerOrder, error)
	GetOrder(ctx context.Context, brokerOrderID string) (*BrokerOrder, error)
	// SubmitBracketLegs submits a stop-loss + optional take-profit as a linked pair for a
	// parent order. IBKR only; Alpaca returns an error here (its bracket attaches at SubmitOrder).
	SubmitBracketLegs(ctx context.Context, parentBrokerOrderID, parentClientOrderID string, legs BracketLegsRequest) (*BracketLegsResponse, error)
	// ListOrders returns every order the broker currently knows for this account (bulk, single call).
	ListOrders(ctx context.Context) ([]BrokerOrder, error)
	GetPositions(ctx context.Context) ([]BrokerPosition, error)
	// GetAccount returns a normalized account-balance snapshot (cash, buying
	// power, equity, and previous-close equity for day-P&L derivation).
	GetAccount(ctx context.Context) (*BrokerBalance, error)
	IsPaper() bool
	// ValidateCredentials returns nil when the stored API secrets authenticate,
	// ErrInvalidCredentials when the broker rejects them, a wrapped error for transient failures.
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
	// BracketStopPrice / BracketTakeProfitPrice, when non-zero, request an Alpaca-native bracket
	// order — distinct from StopPrice, which is a STOP/STOP_LIMIT entry's real broker-trigger price.
	BracketStopPrice       float64
	BracketTakeProfitPrice float64
}

// BracketLegsRequest carries the stop-loss + optional take-profit leg parameters for
// a broker that submits bracket children as a follow-up call.
type BracketLegsRequest struct {
	Symbol          string
	Side            string // opposite of the entry side — "sell" to close a long, "buy" to close a short
	Qty             float64
	StopPrice       float64 // required
	TakeProfitPrice float64 // 0 = no take-profit leg
	TimeInForce     string
}

// BracketLegsResponse carries the broker-assigned IDs for the submitted legs.
type BracketLegsResponse struct {
	StopLegOrderID       string
	TakeProfitLegOrderID string // empty when TakeProfitPrice was 0
}
