package service

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	grpcstatus "google.golang.org/grpc/status"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	ledgerv1 "github.com/xstockstrat/contracts/gen/go/ledger/v1"
	tradingv1 "github.com/xstockstrat/contracts/gen/go/trading/v1"
	"github.com/xstockstrat/trading/internal/broker"
	"github.com/xstockstrat/trading/internal/config"
	"github.com/xstockstrat/trading/internal/repository"
	"github.com/xstockstrat/trading/internal/telemetry"
)

// legLedger records every AppendEvent attempt; an attempt whose 0-based index is in failAt fails with
// codes.Internal (not retried by appendLedgerEvent).
type legLedger struct {
	ledgerv1.LedgerServiceClient
	mu       sync.Mutex
	failAt   map[int]bool
	attempts []*ledgerv1.AppendEventRequest
	events   []*ledgerv1.AppendEventRequest
}

func (l *legLedger) AppendEvent(_ context.Context, req *ledgerv1.AppendEventRequest, _ ...grpc.CallOption) (*ledgerv1.AppendEventResponse, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	n := len(l.attempts)
	l.attempts = append(l.attempts, req)
	if l.failAt[n] {
		return nil, grpcstatus.Error(codes.Internal, "ledger write failed")
	}
	l.events = append(l.events, req)
	return &ledgerv1.AppendEventResponse{}, nil
}

func (l *legLedger) snapshot() (attempts, events []*ledgerv1.AppendEventRequest) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return append([]*ledgerv1.AppendEventRequest(nil), l.attempts...), append([]*ledgerv1.AppendEventRequest(nil), l.events...)
}

const (
	legAcct = "acct-L"
	legUser = "user-L"
	legMode = "TRADING_MODE_PAPER"
)

var (
	alpacaType = int32(commonv1.BrokerType_BROKER_TYPE_ALPACA)
	ibkrType   = int32(commonv1.BrokerType_BROKER_TYPE_IBKR)
)

func newLegPollSvc(brokers map[string]brokerPoolEntry, repo *fakeBracketRepo, ledger ledgerv1.LedgerServiceClient) *TradingService {
	return &TradingService{
		cfgW: &config.Watcher{}, platformCfgW: &config.Watcher{},
		bracketRepo: repo, ledger: ledger, brokers: brokers, orders: map[string]*tradingv1.Order{},
	}
}

// trackLeg writes a tracked OPEN leg for the parent of a buy 10 entry (the leg sells).
func trackLeg(repo *fakeBracketRepo, accountID, legID string, adopted bool) {
	repo.mu.Lock()
	defer repo.mu.Unlock()
	repo.putLeg(&repository.BracketLegRecord{
		AccountID: accountID, LegOrderID: legID, OrderID: "ord-parent", UserID: legUser, TradingMode: legMode,
		Symbol: "AAPL", Side: tradingv1.OrderSide_ORDER_SIDE_SELL, Status: repository.LegStatusOpen, Adopted: adopted,
	})
}

func mustLegRow(t *testing.T, repo *fakeBracketRepo, accountID, legID string) repository.BracketLegRecord {
	t.Helper()
	leg := legRow(repo, accountID, legID)
	if leg == nil {
		t.Fatalf("no bracket_legs row for %s/%s", accountID, legID)
	}
	return *leg
}

// listing returns a listOrdersFn that serves the next script entry on each call, repeating the last.
func listing(script ...[]broker.BrokerOrder) func(context.Context) ([]broker.BrokerOrder, error) {
	var mu sync.Mutex
	n := 0
	return func(context.Context) ([]broker.BrokerOrder, error) {
		mu.Lock()
		defer mu.Unlock()
		out := script[min(n, len(script)-1)]
		n++
		return out, nil
	}
}

func payloadOf(e *ledgerv1.AppendEventRequest) map[string]any { return e.GetPayload().AsMap() }

// @AC-4: a take-profit leg fill reaches the ledger as order.filled under the leg id.
func TestLegPoll_AC4_TakeProfitFilledEmitsOrderFilled(t *testing.T) {
	for _, tc := range []struct {
		name       string
		brokerType int32
		status     string
	}{
		{"alpaca", alpacaType, "filled"},
		{"ibkr", ibkrType, "Filled"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			repo := &fakeBracketRepo{}
			trackLeg(repo, legAcct, "leg-tp-1", false)
			fb := &fakeBroker{listOrdersFn: listing([]broker.BrokerOrder{
				{BrokerOrderID: "other", Status: tc.status, FilledQty: 1},
				{BrokerOrderID: "leg-tp-1", Status: tc.status, FilledQty: 10, FilledAvgPrice: 110, Fees: 0.25},
			})}
			ledger := &legLedger{}
			svc := newLegPollSvc(map[string]brokerPoolEntry{legAcct: {client: fb, brokerType: tc.brokerType, userID: legUser}}, repo, ledger)

			svc.pollFills(context.Background())
			svc.pollFills(context.Background())

			_, events := ledger.snapshot()
			if len(events) != 1 {
				t.Fatalf("ledger appends = %d, want exactly 1 over two ticks", len(events))
			}
			e := events[0]
			if e.EventType != "order.filled" || e.StreamKey != "leg-tp-1" || e.UserId != legUser || e.SourceService != "xstockstrat-trading" {
				t.Errorf("event = %s stream %q user %q source %q, want order.filled leg-tp-1 %s xstockstrat-trading",
					e.EventType, e.StreamKey, e.UserId, e.SourceService, legUser)
			}
			if e.IdempotencyKey != "bracket-leg:"+legAcct+":leg-tp-1:filled:10" {
				t.Errorf("idempotency key = %q", e.IdempotencyKey)
			}
			want := map[string]any{
				"order_id": "leg-tp-1", "symbol": "AAPL", "side": "ORDER_SIDE_SELL", "qty": 10.0, "fill_price": 110.0,
				"account_id": legAcct, "trading_mode": legMode, "user_id": legUser, "fees": 0.25,
			}
			if got := payloadOf(e); fmt.Sprint(got) != fmt.Sprint(want) {
				t.Errorf("payload = %v, want %v", got, want)
			}
			row := mustLegRow(t, repo, legAcct, "leg-tp-1")
			if row.Status != repository.LegStatusFilled || row.FilledQty != 10 || row.ObservedFilledQty != 10 {
				t.Errorf("leg row = %+v, want FILLED with filled_qty 10 and observed 10", row)
			}
			if lists, _ := fb.calls(); lists != 1 {
				t.Errorf("ListOrders calls = %d, want 1: a retired leg leaves the account with no tracked legs", lists)
			}
		})
	}
}

// D-19: a leg ActivateBracket wrote that is already filled on its first observation emits once.
func TestLegPoll_FilledOnFirstObservationAfterActivation(t *testing.T) {
	repo := &fakeBracketRepo{}
	rec := &repository.OrderBracketRecord{OrderID: "ord-parent", AccountID: legAcct}
	if err := repo.CreateBracket(context.Background(), rec); err != nil {
		t.Fatal(err)
	}
	if err := repo.ActivateBracket(context.Background(), rec.ID, "leg-sl", "leg-tp", repository.BracketLegParent{
		AccountID: legAcct, OrderID: "ord-parent", UserID: legUser, TradingMode: legMode, Symbol: "AAPL", Side: tradingv1.OrderSide_ORDER_SIDE_SELL,
	}); err != nil {
		t.Fatal(err)
	}
	fb := &fakeBroker{listOrdersFn: listing([]broker.BrokerOrder{
		{BrokerOrderID: "leg-sl", Status: "canceled"},
		{BrokerOrderID: "leg-tp", Status: "filled", FilledQty: 10, FilledAvgPrice: 110},
	})}
	ledger := &legLedger{}
	svc := newLegPollSvc(map[string]brokerPoolEntry{legAcct: {client: fb, brokerType: alpacaType}}, repo, ledger)

	for range 3 {
		svc.pollFills(context.Background())
	}

	if _, events := ledger.snapshot(); len(events) != 1 || events[0].EventType != "order.filled" || events[0].StreamKey != "leg-tp" {
		t.Fatalf("events = %v, want one order.filled for leg-tp", events)
	}
	if row := mustLegRow(t, repo, legAcct, "leg-sl"); row.Status != repository.LegStatusCanceled || row.FilledQty != 0 {
		t.Errorf("stop leg = %+v, want CANCELED with no fill", row)
	}
}

// @AC-5: the leg fills in two parts; the ledger holds the partial 4, then the fill 10 at 110.
func TestLegPoll_AC5_PartialThenFilled(t *testing.T) {
	repo := &fakeBracketRepo{}
	trackLeg(repo, legAcct, "leg-tp-1", false)
	partial := []broker.BrokerOrder{{BrokerOrderID: "leg-tp-1", Status: "partially_filled", FilledQty: 4, FilledAvgPrice: 110}}
	fb := &fakeBroker{listOrdersFn: listing(partial, partial,
		[]broker.BrokerOrder{{BrokerOrderID: "leg-tp-1", Status: "filled", FilledQty: 10, FilledAvgPrice: 110}})}
	ledger := &legLedger{}
	svc := newLegPollSvc(map[string]brokerPoolEntry{legAcct: {client: fb, brokerType: alpacaType}}, repo, ledger)

	svc.pollFills(context.Background())
	if row := mustLegRow(t, repo, legAcct, "leg-tp-1"); row.Status != repository.LegStatusOpen || row.FilledQty != 4 {
		t.Fatalf("after the partial, leg row = %+v, want OPEN with filled_qty 4", row)
	}
	svc.pollFills(context.Background()) // the same partial again: no new emit
	svc.pollFills(context.Background())
	svc.pollFills(context.Background()) // third tick after the partial: the leg is retired

	_, events := ledger.snapshot()
	if len(events) != 2 {
		t.Fatalf("events = %d, want 2", len(events))
	}
	p, f := payloadOf(events[0]), payloadOf(events[1])
	if events[0].EventType != "order.partially_filled" || p["filled_qty"] != 4.0 || p["fill_price"] != 110.0 ||
		events[0].IdempotencyKey != "bracket-leg:"+legAcct+":leg-tp-1:partially_filled:4" {
		t.Errorf("first event = %s %v key %q, want order.partially_filled filled_qty 4 at 110", events[0].EventType, p, events[0].IdempotencyKey)
	}
	if _, ok := p["qty"]; ok {
		t.Errorf("partial payload carries qty: %v", p)
	}
	if events[1].EventType != "order.filled" || f["qty"] != 10.0 || f["fill_price"] != 110.0 || f["side"] != "ORDER_SIDE_SELL" {
		t.Errorf("second event = %s %v, want order.filled qty 10 at 110", events[1].EventType, f)
	}
	if row := mustLegRow(t, repo, legAcct, "leg-tp-1"); row.Status != repository.LegStatusFilled || row.FilledQty != 10 {
		t.Errorf("leg row = %+v, want FILLED with filled_qty 10", row)
	}
}

// D-28: the key carries the account, so the same leg id under two accounts appends twice.
func TestLegPoll_KeyDistinguishesAccounts(t *testing.T) {
	repo := &fakeBracketRepo{}
	trackLeg(repo, "acct-A", "leg-1", false)
	trackLeg(repo, "acct-A", "leg-2", false)
	trackLeg(repo, "acct-B", "leg-1", false)
	filled := listing([]broker.BrokerOrder{
		{BrokerOrderID: "leg-1", Status: "filled", FilledQty: 10, FilledAvgPrice: 110},
		{BrokerOrderID: "leg-2", Status: "new"},
	})
	fbA, fbB := &fakeBroker{listOrdersFn: filled}, &fakeBroker{listOrdersFn: listing([]broker.BrokerOrder{
		{BrokerOrderID: "leg-1", Status: "filled", FilledQty: 10, FilledAvgPrice: 110},
	})}
	ledger := &legLedger{}
	svc := newLegPollSvc(map[string]brokerPoolEntry{
		"acct-A": {client: fbA, brokerType: alpacaType}, "acct-B": {client: fbB, brokerType: alpacaType},
	}, repo, ledger)

	svc.pollFills(context.Background())

	_, events := ledger.snapshot()
	keys := map[string]bool{}
	for _, e := range events {
		keys[e.IdempotencyKey] = true
	}
	if len(events) != 2 || !keys["bracket-leg:acct-A:leg-1:filled:10"] || !keys["bracket-leg:acct-B:leg-1:filled:10"] {
		t.Fatalf("keys = %v, want one per account", keys)
	}
	for name, fb := range map[string]*fakeBroker{"acct-A": fbA, "acct-B": fbB} {
		if lists, gets := fb.calls(); lists != 1 || len(gets) != 0 {
			t.Errorf("%s: ListOrders = %d, GetOrder = %v; want one list per account per tick and no fallback", name, lists, gets)
		}
	}
}

// D-15: an emit failure leaves the row's cursor, still writes the observation, and stops further
// leg emits in that tick; the next tick emits with the same key.
func TestLegPoll_EmitFailureHoldsCursorAndStopsTick(t *testing.T) {
	repo := &fakeBracketRepo{}
	trackLeg(repo, legAcct, "leg-a", false)
	trackLeg(repo, legAcct, "leg-b", false)
	fb := &fakeBroker{listOrdersFn: listing([]broker.BrokerOrder{
		{BrokerOrderID: "leg-a", Status: "filled", FilledQty: 10, FilledAvgPrice: 110},
		{BrokerOrderID: "leg-b", Status: "filled", FilledQty: 5, FilledAvgPrice: 95},
	})}
	ledger := &legLedger{failAt: map[int]bool{0: true}}
	svc := newLegPollSvc(map[string]brokerPoolEntry{legAcct: {client: fb, brokerType: alpacaType}}, repo, ledger)

	svc.pollFills(context.Background())

	attempts, events := ledger.snapshot()
	if len(attempts) != 1 || len(events) != 0 {
		t.Fatalf("attempts = %d, appended = %d; want 1 failed attempt and no further emit in the tick", len(attempts), len(events))
	}
	failedKey := attempts[0].IdempotencyKey
	for _, id := range []string{"leg-a", "leg-b"} {
		row := mustLegRow(t, repo, legAcct, id)
		if row.Status != repository.LegStatusOpen || row.FilledQty != 0 || row.ObservedFilledQty == 0 {
			t.Errorf("%s after the failed tick = %+v, want OPEN, cursor 0, observation written", id, row)
		}
	}

	svc.pollFills(context.Background())

	_, events = ledger.snapshot()
	if len(events) != 2 {
		t.Fatalf("appended after tick 2 = %d, want 2", len(events))
	}
	if events[0].IdempotencyKey != failedKey {
		t.Errorf("retry key = %q, want the failed attempt's %q", events[0].IdempotencyKey, failedKey)
	}
	for _, id := range []string{"leg-a", "leg-b"} {
		if row := mustLegRow(t, repo, legAcct, id); row.Status != repository.LegStatusFilled {
			t.Errorf("%s after tick 2 = %+v, want FILLED", id, row)
		}
	}
}

func TestLegPoll_TerminalWithPartialFill(t *testing.T) {
	t.Run("canceled after a partial: partially_filled, then CANCELED", func(t *testing.T) {
		repo := &fakeBracketRepo{}
		trackLeg(repo, legAcct, "leg-1", false)
		fb := &fakeBroker{listOrdersFn: listing([]broker.BrokerOrder{{BrokerOrderID: "leg-1", Status: "canceled", FilledQty: 3, FilledAvgPrice: 108}})}
		ledger := &legLedger{}
		newLegPollSvc(map[string]brokerPoolEntry{legAcct: {client: fb, brokerType: alpacaType}}, repo, ledger).pollFills(context.Background())

		_, events := ledger.snapshot()
		if len(events) != 1 || events[0].EventType != "order.partially_filled" || payloadOf(events[0])["filled_qty"] != 3.0 {
			t.Fatalf("events = %v, want one order.partially_filled with filled_qty 3", events)
		}
		if row := mustLegRow(t, repo, legAcct, "leg-1"); row.Status != repository.LegStatusCanceled || row.FilledQty != 3 {
			t.Errorf("leg row = %+v, want CANCELED with filled_qty 3", row)
		}
	})
	t.Run("canceled after a partial whose emit fails: not retired", func(t *testing.T) {
		repo := &fakeBracketRepo{}
		trackLeg(repo, legAcct, "leg-1", false)
		fb := &fakeBroker{listOrdersFn: listing([]broker.BrokerOrder{{BrokerOrderID: "leg-1", Status: "canceled", FilledQty: 3, FilledAvgPrice: 108}})}
		ledger := &legLedger{failAt: map[int]bool{0: true}}
		newLegPollSvc(map[string]brokerPoolEntry{legAcct: {client: fb, brokerType: alpacaType}}, repo, ledger).pollFills(context.Background())

		if row := mustLegRow(t, repo, legAcct, "leg-1"); row.Status != repository.LegStatusOpen || row.FilledQty != 0 {
			t.Errorf("leg row = %+v, want OPEN with cursor 0", row)
		}
	})
	t.Run("expired with no fill: retired, nothing emitted", func(t *testing.T) {
		repo := &fakeBracketRepo{}
		trackLeg(repo, legAcct, "leg-1", false)
		fb := &fakeBroker{listOrdersFn: listing([]broker.BrokerOrder{{BrokerOrderID: "leg-1", Status: "expired"}})}
		ledger := &legLedger{}
		newLegPollSvc(map[string]brokerPoolEntry{legAcct: {client: fb, brokerType: alpacaType}}, repo, ledger).pollFills(context.Background())

		if attempts, _ := ledger.snapshot(); len(attempts) != 0 {
			t.Errorf("ledger attempts = %d, want 0", len(attempts))
		}
		if row := mustLegRow(t, repo, legAcct, "leg-1"); row.Status != repository.LegStatusExpired {
			t.Errorf("leg row = %+v, want EXPIRED", row)
		}
	})
}

// D-19: held and unrecognised statuses stay open.
func TestLegPoll_HeldAndUnrecognisedStayOpen(t *testing.T) {
	for _, status := range []string{"held", "done_for_day", "PreSubmitted", "Submitted", "new", "accepted", "something_new"} {
		t.Run(status, func(t *testing.T) {
			repo := &fakeBracketRepo{}
			trackLeg(repo, legAcct, "leg-1", false)
			fb := &fakeBroker{listOrdersFn: listing([]broker.BrokerOrder{{BrokerOrderID: "leg-1", Status: status, FilledQty: 2}})}
			ledger := &legLedger{}
			newLegPollSvc(map[string]brokerPoolEntry{legAcct: {client: fb, brokerType: alpacaType}}, repo, ledger).pollFills(context.Background())

			if attempts, _ := ledger.snapshot(); len(attempts) != 0 {
				t.Errorf("ledger attempts = %d, want 0", len(attempts))
			}
			if row := mustLegRow(t, repo, legAcct, "leg-1"); row.Status != repository.LegStatusOpen || row.FilledQty != 0 || row.ObservedFilledQty != 2 {
				t.Errorf("leg row = %+v, want OPEN, cursor 0, observed 2", row)
			}
		})
	}
}

// D-11, A-3: legs absent from a successful list get at most five GetOrder calls, activated rows first.
func TestLegPoll_GetOrderFallback(t *testing.T) {
	t.Run("one absent leg gets one GetOrder", func(t *testing.T) {
		repo := &fakeBracketRepo{}
		trackLeg(repo, legAcct, "leg-1", false)
		fb := &fakeBroker{
			listOrdersFn: listing([]broker.BrokerOrder{}),
			getOrderFn: func(_ context.Context, id string) (*broker.BrokerOrder, error) {
				return &broker.BrokerOrder{BrokerOrderID: id, Status: "filled", FilledQty: 10, FilledAvgPrice: 110}, nil
			},
		}
		ledger := &legLedger{}
		newLegPollSvc(map[string]brokerPoolEntry{legAcct: {client: fb, brokerType: alpacaType}}, repo, ledger).pollFills(context.Background())

		if _, gets := fb.calls(); fmt.Sprint(gets) != "[leg-1]" {
			t.Errorf("GetOrder calls = %v, want [leg-1]", gets)
		}
		if _, events := ledger.snapshot(); len(events) != 1 || events[0].EventType != "order.filled" {
			t.Errorf("events = %v, want one order.filled from the fallback", events)
		}
	})
	t.Run("six absent legs get five calls, activated before adopted", func(t *testing.T) {
		repo := &fakeBracketRepo{}
		trackLeg(repo, legAcct, "adopted-1", true)
		for i := 1; i <= 5; i++ {
			trackLeg(repo, legAcct, fmt.Sprintf("activated-%d", i), false)
		}
		fb := &fakeBroker{
			listOrdersFn: listing([]broker.BrokerOrder{}),
			getOrderFn: func(_ context.Context, id string) (*broker.BrokerOrder, error) {
				return &broker.BrokerOrder{BrokerOrderID: id, Status: "new"}, nil
			},
		}
		newLegPollSvc(map[string]brokerPoolEntry{legAcct: {client: fb, brokerType: alpacaType}}, repo, &legLedger{}).pollFills(context.Background())

		if _, gets := fb.calls(); fmt.Sprint(gets) != "[activated-1 activated-2 activated-3 activated-4 activated-5]" {
			t.Errorf("GetOrder calls = %v, want the five activated legs in order and not the adopted one", gets)
		}
	})
}

// D-26: Alpaca not-found on three consecutive ticks retires the leg UNKNOWN; IBKR errors never do.
func TestLegPoll_NotFound(t *testing.T) {
	notFound := fmt.Errorf("alpaca get order error (status 404): {}: %w", broker.ErrOrderNotFound)
	run := func(t *testing.T, brokerType int32, results ...error) (*fakeBracketRepo, func() []map[string]any) {
		t.Helper()
		logs := captureLogs(t)
		repo := &fakeBracketRepo{}
		trackLeg(repo, legAcct, "leg-1", false)
		n := 0
		fb := &fakeBroker{
			listOrdersFn: listing([]broker.BrokerOrder{}),
			getOrderFn: func(_ context.Context, id string) (*broker.BrokerOrder, error) {
				err := results[n]
				n++
				if err != nil {
					return nil, err
				}
				return &broker.BrokerOrder{BrokerOrderID: id, Status: "new"}, nil
			},
		}
		svc := newLegPollSvc(map[string]brokerPoolEntry{legAcct: {client: fb, brokerType: brokerType}}, repo, &legLedger{})
		for range results {
			svc.pollFills(context.Background())
		}
		return repo, logs
	}

	t.Run("three consecutive not-founds retire UNKNOWN", func(t *testing.T) {
		two, _ := run(t, alpacaType, notFound, notFound)
		if row := mustLegRow(t, two, legAcct, "leg-1"); row.Status != repository.LegStatusOpen || row.NotFoundTicks != 2 {
			t.Fatalf("after two not-founds, leg row = %+v, want OPEN with not_found_ticks 2", row)
		}
		repo, logs := run(t, alpacaType, notFound, notFound, notFound)
		if row := mustLegRow(t, repo, legAcct, "leg-1"); row.Status != repository.LegStatusUnknown {
			t.Errorf("after three not-founds, leg row = %+v, want UNKNOWN", row)
		}
		warns := 0
		for _, r := range logs() {
			if r["level"] == "WARN" && r["leg_order_id"] == "leg-1" && r["msg"] == "bracket leg poll: leg retired UNKNOWN after repeated not-found" {
				warns++
			}
		}
		if warns != 1 {
			t.Errorf("retire WARNs = %d, want 1", warns)
		}
	})
	t.Run("a success in between resets the count", func(t *testing.T) {
		repo, _ := run(t, alpacaType, notFound, notFound, nil, notFound, notFound)
		if row := mustLegRow(t, repo, legAcct, "leg-1"); row.Status != repository.LegStatusOpen || row.NotFoundTicks != 2 {
			t.Errorf("leg row = %+v, want OPEN with not_found_ticks 2", row)
		}
	})
	t.Run("an IBKR ordinary error never retires", func(t *testing.T) {
		miss := errors.New("ibkr GetOrder: order leg-1 not in response (0 orders)")
		repo, _ := run(t, ibkrType, miss, miss, miss, miss, miss)
		if row := mustLegRow(t, repo, legAcct, "leg-1"); row.Status != repository.LegStatusOpen || row.NotFoundTicks != 0 {
			t.Errorf("leg row = %+v, want OPEN with not_found_ticks 0", row)
		}
	})
}

// R-10: a failed list retires nothing and makes no fallback call.
func TestLegPoll_ListOrdersErrorSkipsAccount(t *testing.T) {
	for name, err := range map[string]error{
		"ordinary error":      errors.New("broker 503"),
		"invalid credentials": fmt.Errorf("alpaca list orders: %w", broker.ErrInvalidCredentials),
	} {
		t.Run(name, func(t *testing.T) {
			logs := captureLogs(t)
			repo := &fakeBracketRepo{}
			trackLeg(repo, legAcct, "leg-1", false)
			fb := &fakeBroker{listOrdersFn: func(context.Context) ([]broker.BrokerOrder, error) { return nil, err }}
			ledger := &legLedger{}
			newLegPollSvc(map[string]brokerPoolEntry{legAcct: {client: fb, brokerType: alpacaType}}, repo, ledger).pollFills(context.Background())

			if lists, gets := fb.calls(); lists != 1 || len(gets) != 0 {
				t.Errorf("ListOrders = %d, GetOrder = %v; want 1 and none", lists, gets)
			}
			if row := mustLegRow(t, repo, legAcct, "leg-1"); row.Status != repository.LegStatusOpen || row.NotFoundTicks != 0 {
				t.Errorf("leg row = %+v, want unchanged OPEN", row)
			}
			if attempts, _ := ledger.snapshot(); len(attempts) != 0 {
				t.Errorf("ledger attempts = %d, want 0", len(attempts))
			}
			warns := 0
			for _, r := range logs() {
				if r["level"] == "WARN" && r["account_id"] == legAcct {
					warns++
				}
			}
			if warns != 1 {
				t.Errorf("WARN records for the account = %d, want 1", warns)
			}
		})
	}
}

func TestLegPoll_ListTrackedLegsErrorEndsTick(t *testing.T) {
	logs := captureLogs(t)
	svc := newLegPollSvc(map[string]brokerPoolEntry{legAcct: {client: &fakeBroker{}, brokerType: alpacaType}}, nil, &legLedger{})
	svc.bracketRepo = failingTrackedLegs{&fakeBracketRepo{}}

	svc.pollFills(context.Background()) // fakeBroker.ListOrders panics if reached

	if n := len(logsWithMsg(logs(), "bracket leg poll: list tracked legs failed")); n != 1 {
		t.Errorf("list-failed WARNs = %d, want 1", n)
	}
}

type failingTrackedLegs struct{ *fakeBracketRepo }

func (failingTrackedLegs) ListTrackedLegs(context.Context) ([]*repository.BracketLegRecord, error) {
	return nil, errors.New("db down")
}

// A tracked leg on an account missing from the broker pool (e.g. OFFLINE) is skipped.
func TestLegPoll_AccountWithoutBrokerSkipped(t *testing.T) {
	repo := &fakeBracketRepo{}
	trackLeg(repo, "acct-gone", "leg-1", false)
	fb := &fakeBroker{} // panics if listed
	newLegPollSvc(map[string]brokerPoolEntry{legAcct: {client: fb, brokerType: alpacaType}}, repo, &legLedger{}).pollFills(context.Background())

	if lists, _ := fb.calls(); lists != 0 {
		t.Errorf("ListOrders calls = %d, want 0", lists)
	}
}

// 294 @AC-6: the fill-poller tick record and the parent poll are the same with and without tracked legs.
func TestLegPoll_AC6_TickRecordUnchangedByLegs(t *testing.T) {
	run := func(withLegs bool) (map[string]any, []string) {
		logs := captureLogs(t)
		now := time.Date(2026, 11, 27, 14, 30, 0, 0, time.UTC)
		repo := &fakeBracketRepo{}
		if withLegs {
			trackLeg(repo, "acc-6", "leg-1", false)
		}
		fb := &fakeBroker{
			getOrderFn: func(context.Context, string) (*broker.BrokerOrder, error) {
				return &broker.BrokerOrder{Status: "new"}, nil
			},
			listOrdersFn: listing([]broker.BrokerOrder{{BrokerOrderID: "leg-1", Status: "filled", FilledQty: 10, FilledAvgPrice: 110}}),
		}
		svc := &TradingService{
			now: func() time.Time { return now }, cfgW: &config.Watcher{}, bracketRepo: repo, ledger: &legLedger{},
			brokers: map[string]brokerPoolEntry{"acc-6": {client: fb, brokerType: alpacaType}},
			orders: map[string]*tradingv1.Order{"ord-6": {
				OrderId: "ord-6", AccountId: "acc-6", BrokerOrderId: "bo-6", Status: tradingv1.OrderStatus_ORDER_STATUS_NEW,
			}},
		}
		svc.pollFills(context.Background())
		ticks := logsWithMsg(logs(), telemetry.LoopTickOKMsg)
		if len(ticks) != 1 {
			t.Fatalf("withLegs=%v: tick records = %d, want 1", withLegs, len(ticks))
		}
		delete(ticks[0], "time")
		_, gets := fb.calls()
		return ticks[0], gets
	}
	base, baseGets := run(false)
	legs, legGets := run(true)
	if fmt.Sprint(base) != fmt.Sprint(legs) {
		t.Errorf("tick record with legs = %v, without = %v", legs, base)
	}
	if fmt.Sprint(baseGets) != "[bo-6]" || fmt.Sprint(legGets) != "[bo-6]" {
		t.Errorf("parent GetOrder calls without legs = %v, with legs = %v; want [bo-6] both", baseGets, legGets)
	}
}
