package service

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	configv1 "github.com/xstockstrat/contracts/gen/go/config/v1"
	tradingv1 "github.com/xstockstrat/contracts/gen/go/trading/v1"
	"github.com/xstockstrat/trading/internal/broker"
	"github.com/xstockstrat/trading/internal/config"
	"github.com/xstockstrat/trading/internal/middleware"
	"github.com/xstockstrat/trading/internal/repository"
)

// Regression suite for docs/reports/2026-10-21-trading-order-state-audit-defect.md (feature 267):
// order-state writes after a broker side effect are logged on failure and survive a cancelled caller.

type execCall struct {
	traceID string
	ctxErr  error
}

// ctxCapturingDB records the trace id and ctx error of every Exec, then returns failExec.
type ctxCapturingDB struct {
	execOnlyDB
	failExec error
	mu       sync.Mutex
	calls    []execCall
}

func (d *ctxCapturingDB) Exec(ctx context.Context, _ string, _ ...any) (pgconn.CommandTag, error) {
	d.mu.Lock()
	d.calls = append(d.calls, execCall{traceID: middleware.FromContext(ctx).TraceID, ctxErr: ctx.Err()})
	d.mu.Unlock()
	return pgconn.CommandTag{}, d.failExec
}

func (d *ctxCapturingDB) lastCall(t *testing.T) execCall {
	t.Helper()
	d.mu.Lock()
	defer d.mu.Unlock()
	if len(d.calls) == 0 {
		t.Fatal("no Exec captured")
	}
	return d.calls[len(d.calls)-1]
}

func failingExecDB() *ctxCapturingDB {
	return &ctxCapturingDB{failExec: errors.New("db unavailable")}
}

// replaceOKBroker succeeds on ReplaceOrder, which the shared fakeBroker leaves panicking.
type replaceOKBroker struct{ *fakeBroker }

func (replaceOKBroker) ReplaceOrder(context.Context, string, broker.OrderRequest) (*broker.BrokerOrder, error) {
	return &broker.BrokerOrder{}, nil
}

// tracedCancelledCtx carries x-user-id and x-trace-id on a parent that is already cancelled.
func tracedCancelledCtx(user string) context.Context {
	parent, cancel := context.WithCancel(context.Background())
	ctx := middleware.WithPropagationData(parent, middleware.PropagationData{UserID: user, TraceID: "t-267"})
	cancel()
	return ctx
}

func findLog(recs []map[string]any, msg, status string) []map[string]any {
	var out []map[string]any
	for _, r := range recs {
		if r["msg"] == msg && r["status"] == status {
			out = append(out, r)
		}
	}
	return out
}

// waitForLedgerEvents polls until n events are recorded, so no emit goroutine logs after captureLogs restores slog.
func waitForLedgerEvents(t *testing.T, l *recordingLedgerClient, n int) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if len(l.eventTypes()) >= n {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("ledger events = %v, want %d", l.eventTypes(), n)
}

func activeSnapshot() *config.Watcher {
	return config.NewSnapshotWatcher(map[string]*configv1.ConfigValue{
		"platform.trading_state":        {Value: &configv1.ConfigValue_StringVal{StringVal: "ACTIVE"}},
		"trading.risk.max_position_pct": {Value: &configv1.ConfigValue_FloatVal{FloatVal: 0}},
	})
}

func auditSvc(db *ctxCapturingDB, fb broker.Broker, ledger *recordingLedgerClient, orders map[string]*tradingv1.Order) *TradingService {
	return &TradingService{
		cfg: &config.Config{}, cfgW: activeSnapshot(),
		repo: repository.NewTradingRepoWithDB(db), orderIntentRepo: &fakeOrderIntentRepo{}, bracketRepo: &fakeBracketRepo{},
		ledger: ledger, notify: &fakeNotifyClient{},
		brokers: map[string]brokerPoolEntry{"acct-1": {client: fb, brokerType: int32(commonv1.BrokerType_BROKER_TYPE_ALPACA), userID: "u-1"}},
		orders:  orders,
		halted:  map[string]bool{}, haltReasons: map[string]string{}, haltedLastPolled: map[string]time.Time{},
	}
}

func placeReq() *tradingv1.PlaceOrderRequest {
	return &tradingv1.PlaceOrderRequest{
		Symbol: "AAPL", Side: tradingv1.OrderSide_ORDER_SIDE_BUY, Qty: 10, OrderType: tradingv1.OrderType_ORDER_TYPE_MARKET,
		TimeInForce: tradingv1.TimeInForce_TIME_IN_FORCE_DAY, ClientOrderId: "c-1", AccountId: "acct-1",
	}
}

func workingOrder(status tradingv1.OrderStatus) map[string]*tradingv1.Order {
	return map[string]*tradingv1.Order{"o-1": {
		OrderId: "o-1", UserId: "u-1", AccountId: "acct-1", BrokerOrderId: "brk-1", Status: status,
		BrokerType: commonv1.BrokerType_BROKER_TYPE_ALPACA, OrderType: tradingv1.OrderType_ORDER_TYPE_LIMIT,
		Qty: 10, LimitPrice: 100,
	}}
}

func timeoutBroker() *fakeBroker {
	return &fakeBroker{submitOrderFn: func(context.Context, broker.OrderRequest) (*broker.BrokerOrder, error) {
		return nil, context.DeadlineExceeded
	}}
}

func rejectBroker() *fakeBroker {
	return &fakeBroker{submitOrderFn: func(context.Context, broker.OrderRequest) (*broker.BrokerOrder, error) {
		return nil, errors.New("insufficient buying power")
	}}
}

func assertWriteFailureLogged(t *testing.T, recs []map[string]any, orderID, status, path string) {
	t.Helper()
	got := findLog(recs, "order state write failed", status)
	if len(got) != 1 {
		t.Fatalf("want exactly one %q record with status %s, got %d (records: %v)", "order state write failed", status, len(got), recs)
	}
	r := got[0]
	if r["level"] != "ERROR" {
		t.Errorf("level = %v, want ERROR", r["level"])
	}
	if id, _ := r["order_id"].(string); id == "" || (orderID != "" && id != orderID) {
		t.Errorf("order_id = %v, want %q (non-empty)", r["order_id"], orderID)
	}
	if r["user_id"] != "u-1" {
		t.Errorf("user_id = %v, want u-1", r["user_id"])
	}
	if r["path"] != path {
		t.Errorf("path = %v, want %s", r["path"], path)
	}
	if e, _ := r["error"].(string); !strings.Contains(e, "db unavailable") {
		t.Errorf("error = %v, want it to contain %q", r["error"], "db unavailable")
	}
}

func TestPlaceOrder_BrokerTimeout_FailedWriteLogged_AC1(t *testing.T) {
	records := captureLogs(t)
	ledger := &recordingLedgerClient{}
	svc := auditSvc(failingExecDB(), timeoutBroker(), ledger, map[string]*tradingv1.Order{})

	if _, err := svc.PlaceOrder(ctxAsUser("u-1"), placeReq()); err == nil {
		t.Fatal("want the broker timeout surfaced as an error")
	}
	waitForLedgerEvents(t, ledger, 3) // order.created, order.submitted, order.broker_call_uncertain
	assertWriteFailureLogged(t, records(), "", "ORDER_STATUS_NEW", "broker_timeout")
}

func TestPlaceOrder_BrokerReject_FailedWriteLogged_AC2(t *testing.T) {
	records := captureLogs(t)
	ledger := &recordingLedgerClient{}
	svc := auditSvc(failingExecDB(), rejectBroker(), ledger, map[string]*tradingv1.Order{})

	if _, err := svc.PlaceOrder(ctxAsUser("u-1"), placeReq()); err == nil {
		t.Fatal("want the broker rejection surfaced as an error")
	}
	waitForLedgerEvents(t, ledger, 3) // order.created, order.submitted, order.broker_rejected
	assertWriteFailureLogged(t, records(), "", "ORDER_STATUS_REJECTED", "broker_reject")
}

func runCancelWriteFailure(t *testing.T, status tradingv1.OrderStatus) {
	records := captureLogs(t)
	ledger := &recordingLedgerClient{}
	fb := &fakeBroker{cancelOrderFn: func(context.Context, string) error { return nil }}
	svc := auditSvc(failingExecDB(), fb, ledger, workingOrder(status))

	if _, err := svc.CancelOrder(ctxAsUser("u-1"), &tradingv1.CancelOrderRequest{OrderId: "o-1"}); err != nil {
		t.Fatalf("CancelOrder: %v", err)
	}
	waitForLedgerEvents(t, ledger, 1) // order.canceled
	assertWriteFailureLogged(t, records(), "o-1", "ORDER_STATUS_CANCELED", "cancel_final")
}

func TestCancelOrder_FinalWriteFailureLogged_AC3(t *testing.T) {
	runCancelWriteFailure(t, tradingv1.OrderStatus_ORDER_STATUS_NEW)
}

func TestCancelOrder_PartiallyFilled_FinalWriteFailureLogged_AC3(t *testing.T) {
	runCancelWriteFailure(t, tradingv1.OrderStatus_ORDER_STATUS_PARTIALLY_FILLED)
}

func runReplaceWriteFailure(t *testing.T, status tradingv1.OrderStatus) {
	records := captureLogs(t)
	ledger := &recordingLedgerClient{}
	svc := auditSvc(failingExecDB(), replaceOKBroker{&fakeBroker{}}, ledger, workingOrder(status))

	if _, err := svc.ReplaceOrder(ctxAsUser("u-1"), &tradingv1.ReplaceOrderRequest{OrderId: "o-1", LimitPrice: 101.00}); err != nil {
		t.Fatalf("ReplaceOrder: %v", err)
	}
	waitForLedgerEvents(t, ledger, 1) // order.replaced
	assertWriteFailureLogged(t, records(), "o-1", status.String(), "replace_final")
}

func TestReplaceOrder_FinalWriteFailureLogged_AC6(t *testing.T) {
	runReplaceWriteFailure(t, tradingv1.OrderStatus_ORDER_STATUS_NEW)
}

func TestReplaceOrder_PartiallyFilled_FinalWriteFailureLogged_AC6(t *testing.T) {
	runReplaceWriteFailure(t, tradingv1.OrderStatus_ORDER_STATUS_PARTIALLY_FILLED)
}

// assertWriteCtx checks the last Exec (the D-04 site's write) kept the trace and was not cancelled.
func assertWriteCtx(t *testing.T, db *ctxCapturingDB) {
	t.Helper()
	last := db.lastCall(t)
	if last.traceID != "t-267" {
		t.Errorf("order-state write traceID = %q, want t-267", last.traceID)
	}
	if last.ctxErr != nil {
		t.Errorf("order-state write ctx.Err() = %v, want nil (caller cancellation must not abort it)", last.ctxErr)
	}
}

func TestOrderStateWriteCtx_BrokerTimeout_AC1(t *testing.T) {
	db, ledger := &ctxCapturingDB{}, &recordingLedgerClient{}
	svc := auditSvc(db, timeoutBroker(), ledger, map[string]*tradingv1.Order{})
	_, _ = svc.PlaceOrder(tracedCancelledCtx("u-1"), placeReq())
	waitForLedgerEvents(t, ledger, 3)
	assertWriteCtx(t, db)
}

func TestOrderStateWriteCtx_BrokerReject_AC2(t *testing.T) {
	db, ledger := &ctxCapturingDB{}, &recordingLedgerClient{}
	svc := auditSvc(db, rejectBroker(), ledger, map[string]*tradingv1.Order{})
	_, _ = svc.PlaceOrder(tracedCancelledCtx("u-1"), placeReq())
	waitForLedgerEvents(t, ledger, 3)
	assertWriteCtx(t, db)
}

func TestOrderStateWriteCtx_CancelFinal_AC3(t *testing.T) {
	db, ledger := &ctxCapturingDB{}, &recordingLedgerClient{}
	fb := &fakeBroker{cancelOrderFn: func(context.Context, string) error { return nil }}
	svc := auditSvc(db, fb, ledger, workingOrder(tradingv1.OrderStatus_ORDER_STATUS_NEW))
	if _, err := svc.CancelOrder(tracedCancelledCtx("u-1"), &tradingv1.CancelOrderRequest{OrderId: "o-1"}); err != nil {
		t.Fatalf("CancelOrder: %v", err)
	}
	waitForLedgerEvents(t, ledger, 1)
	assertWriteCtx(t, db)
}

func TestOrderStateWriteCtx_ReplaceFinal_AC6(t *testing.T) {
	db, ledger := &ctxCapturingDB{}, &recordingLedgerClient{}
	svc := auditSvc(db, replaceOKBroker{&fakeBroker{}}, ledger, workingOrder(tradingv1.OrderStatus_ORDER_STATUS_NEW))
	if _, err := svc.ReplaceOrder(tracedCancelledCtx("u-1"), &tradingv1.ReplaceOrderRequest{OrderId: "o-1", LimitPrice: 101.00}); err != nil {
		t.Fatalf("ReplaceOrder: %v", err)
	}
	waitForLedgerEvents(t, ledger, 1)
	assertWriteCtx(t, db)
}
