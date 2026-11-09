package testdata

import (
	"context"
	"strconv"
	"sync"
	"sync/atomic"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	ledgerv1 "github.com/xstockstrat/contracts/gen/go/ledger/v1"
)

// TradingSourceService is the source_service the trading producer stamps on every order event.
const TradingSourceService = "xstockstrat-trading"

const (
	ledgerDefaultPage = 100
	ledgerMaxPage     = 1000
)

// Ledger is an in-memory LedgerServiceClient that mimics QueryEvents filtering and offset paging.
// It rejects the time_range and from_sequence filters it does not implement, so a caller cannot pass silently.
type Ledger struct {
	ledgerv1.LedgerServiceClient
	Events []*ledgerv1.LedgerEvent
	// OnQuery runs before filtering; a non-nil error is returned to the caller as-is.
	OnQuery func(ctx context.Context, req *ledgerv1.QueryEventsRequest) error

	calls atomic.Int64
	mu    sync.Mutex
	reqs  []*ledgerv1.QueryEventsRequest
}

// Calls is the number of QueryEvents calls received.
func (l *Ledger) Calls() int64 { return l.calls.Load() }

// Requests returns a copy of the received requests, in order.
func (l *Ledger) Requests() []*ledgerv1.QueryEventsRequest {
	l.mu.Lock()
	defer l.mu.Unlock()
	return append([]*ledgerv1.QueryEventsRequest(nil), l.reqs...)
}

func (l *Ledger) AppendEvent(context.Context, *ledgerv1.AppendEventRequest, ...grpc.CallOption) (*ledgerv1.AppendEventResponse, error) {
	return &ledgerv1.AppendEventResponse{}, nil
}

func (l *Ledger) QueryEvents(ctx context.Context, req *ledgerv1.QueryEventsRequest, _ ...grpc.CallOption) (*ledgerv1.QueryEventsResponse, error) {
	l.calls.Add(1)
	l.mu.Lock()
	l.reqs = append(l.reqs, req)
	l.mu.Unlock()
	if req.TimeRange != nil || req.FromSequence != 0 {
		return nil, status.Error(codes.Unimplemented, "testdata.Ledger: time_range / from_sequence unsupported")
	}
	if l.OnQuery != nil {
		if err := l.OnQuery(ctx, req); err != nil {
			return nil, err
		}
	}
	if ctx.Err() != nil {
		return nil, status.FromContextError(ctx.Err()).Err()
	}
	var matched []*ledgerv1.LedgerEvent
	for _, ev := range l.Events {
		if (req.EventType != "" && ev.EventType != req.EventType) ||
			(req.SourceService != "" && ev.SourceService != req.SourceService) ||
			(req.StreamKey != "" && ev.StreamKey != req.StreamKey) {
			continue
		}
		matched = append(matched, ev)
	}
	size := int(req.GetPage().GetPageSize())
	if size <= 0 {
		size = ledgerDefaultPage
	}
	size = min(size, ledgerMaxPage)
	start := 0
	if tok := req.GetPage().GetPageToken(); tok != "" {
		n, err := strconv.Atoi(tok)
		if err != nil || n < 0 {
			return nil, status.Error(codes.InvalidArgument, "malformed page token")
		}
		start = min(n, len(matched))
	}
	end := min(start+size, len(matched))
	next := ""
	if end < len(matched) {
		next = strconv.Itoa(end)
	}
	return &ledgerv1.QueryEventsResponse{Events: matched[start:end], Page: &commonv1.PageResponse{NextPageToken: next}}, nil
}

func orderEvent(seq int64, eventType, orderID string, payload map[string]any) *ledgerv1.LedgerEvent {
	p, err := structpb.NewStruct(payload)
	if err != nil {
		panic(err)
	}
	return &ledgerv1.LedgerEvent{
		EventId: "ev-" + strconv.FormatInt(seq, 10), EventType: eventType, SourceService: TradingSourceService,
		StreamKey: orderID, Sequence: seq, Payload: p,
	}
}

func fillPayload(orderID, userID, symbol, accountID, mode string, price float64, side string) map[string]any {
	p := map[string]any{
		"order_id": orderID, "user_id": userID, "symbol": symbol, "account_id": accountID,
		"trading_mode": mode, "fill_price": price,
	}
	if side != "" {
		p["side"] = side
	}
	return p
}

// FilledEvent mirrors a trading order.filled event; side "" omits the payload key, as pre-feature-251 events do.
func FilledEvent(seq int64, orderID, userID, symbol, accountID, mode string, qty, price float64, side string) *ledgerv1.LedgerEvent {
	p := fillPayload(orderID, userID, symbol, accountID, mode, price, side)
	p["qty"] = qty
	return orderEvent(seq, "order.filled", orderID, p)
}

// PartialEvent mirrors a trading order.partially_filled event carrying the cumulative filled_qty.
func PartialEvent(seq int64, orderID, userID, symbol, accountID, mode string, filledQty, price float64, side string) *ledgerv1.LedgerEvent {
	p := fillPayload(orderID, userID, symbol, accountID, mode, price, side)
	p["filled_qty"] = filledQty
	return orderEvent(seq, "order.partially_filled", orderID, p)
}

// CreatedEvent mirrors trading's order.created: it carries side but no order_id or user_id key.
func CreatedEvent(seq int64, orderID, symbol, side string, qty float64) *ledgerv1.LedgerEvent {
	return orderEvent(seq, "order.created", orderID, map[string]any{
		"symbol": symbol, "side": side, "qty": qty, "status": "ORDER_STATUS_PENDING", "trading_mode": "TRADING_MODE_PAPER",
	})
}
