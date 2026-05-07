package broker

import "context"

// BrokerOrder is the normalized order representation returned by any broker.
type BrokerOrder struct {
	BrokerOrderID string
	Status        string
}

// BrokerPosition is a normalized position snapshot from a broker.
type BrokerPosition struct {
	Symbol   string
	Quantity float64
	AvgCost  float64
}

// Broker is the interface all broker clients must satisfy.
type Broker interface {
	SubmitOrder(ctx context.Context, req OrderRequest) (*BrokerOrder, error)
	CancelOrder(ctx context.Context, brokerOrderID string) error
	GetOrder(ctx context.Context, brokerOrderID string) (*BrokerOrder, error)
	GetPositions(ctx context.Context) ([]BrokerPosition, error)
	IsPaper() bool
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
