package service

import (
	"context"
	"encoding/hex"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	grpcstatus "google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	configv1 "github.com/xstockstrat/contracts/gen/go/config/v1"
	ledgerv1 "github.com/xstockstrat/contracts/gen/go/ledger/v1"
	notifyv1 "github.com/xstockstrat/contracts/gen/go/notify/v1"
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

type reclaimCall struct {
	traceID string
	ctxErr  error
}

// staleIntentRepo reports an existing stale PENDING intent, so every handler takes the reactive reclaim branch.
type staleIntentRepo struct {
	fakeOrderIntentRepo
	requestHash  string
	pendingSince time.Time
	reclaimed    bool
	out          *repository.OrderIntentRecord
	err          error
	sweep        []*repository.OrderIntentRecord

	mu      sync.Mutex
	called  bool
	reclaim reclaimCall
}

func newStaleIntentRepo(requestHash string) *staleIntentRepo {
	return &staleIntentRepo{requestHash: requestHash, pendingSince: time.Now().Add(-time.Hour), reclaimed: true}
}

func (r *staleIntentRepo) InsertIntent(context.Context, *repository.OrderIntentRecord) (bool, error) {
	return false, nil
}

func (r *staleIntentRepo) GetIntentByID(_ context.Context, id string) (*repository.OrderIntentRecord, error) {
	return &repository.OrderIntentRecord{
		IntentID: id, OrderID: "o-1", RequestHash: r.requestHash,
		State: repository.IntentStatePending, UpdatedAt: r.pendingSince,
	}, nil
}

func (r *staleIntentRepo) ReclaimOrphanIntent(ctx context.Context, id string, _ time.Time) (bool, *repository.OrderIntentRecord, error) {
	r.mu.Lock()
	r.called = true
	r.reclaim = reclaimCall{traceID: middleware.FromContext(ctx).TraceID, ctxErr: ctx.Err()}
	r.mu.Unlock()
	if r.err != nil {
		return false, nil, r.err
	}
	out := r.out
	if out == nil {
		out = &repository.OrderIntentRecord{IntentID: id, OrderID: "o-1", UpdatedAt: time.Now()}
	}
	return r.reclaimed, out, nil
}

func (r *staleIntentRepo) SweepStalePending(context.Context, time.Time, int) ([]*repository.OrderIntentRecord, error) {
	return r.sweep, nil
}

func (r *staleIntentRepo) snapshot() (bool, reclaimCall) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.called, r.reclaim
}

type ledgerCall struct {
	req     *ledgerv1.AppendEventRequest
	traceID string
	ctxErr  error
}

// traceCapturingLedger runs the real client interceptor, so it sees the x-trace-id a real AppendEvent would send.
type traceCapturingLedger struct {
	recordingLedgerClient
	calls []ledgerCall
}

// outgoingTraceID returns the x-trace-id the real client interceptor would put on the wire for ctx.
func outgoingTraceID(ctx context.Context, method string, req interface{}, opts ...grpc.CallOption) string {
	var traceID string
	invoker := func(ctx context.Context, _ string, _, _ interface{}, _ *grpc.ClientConn, _ ...grpc.CallOption) error {
		md, _ := metadata.FromOutgoingContext(ctx)
		if v := md.Get("x-trace-id"); len(v) > 0 {
			traceID = v[0]
		}
		return nil
	}
	_ = middleware.UnaryClientInterceptor(ctx, method, req, nil, nil, invoker, opts...)
	return traceID
}

func (l *traceCapturingLedger) AppendEvent(ctx context.Context, req *ledgerv1.AppendEventRequest, opts ...grpc.CallOption) (*ledgerv1.AppendEventResponse, error) {
	ctxErr := ctx.Err()
	traceID := outgoingTraceID(ctx, "/ledger.v1.LedgerService/AppendEvent", req, opts...)
	l.mu.Lock()
	l.events = append(l.events, req)
	l.calls = append(l.calls, ledgerCall{req: req, traceID: traceID, ctxErr: ctxErr})
	l.mu.Unlock()
	return &ledgerv1.AppendEventResponse{}, nil
}

func (l *traceCapturingLedger) callsOf(eventType string) []ledgerCall {
	l.mu.Lock()
	defer l.mu.Unlock()
	var out []ledgerCall
	for _, c := range l.calls {
		if c.req.EventType == eventType {
			out = append(out, c)
		}
	}
	return out
}

func waitForLedgerEventType(t *testing.T, l *traceCapturingLedger, eventType string) ledgerCall {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if got := l.callsOf(eventType); len(got) > 0 {
			return got[0]
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("no %q ledger event within 2s (events: %v)", eventType, l.eventTypes())
	return ledgerCall{}
}

const reclaimedUnknownEvent = "order_intent.reclaimed_unknown"

// reclaimCase drives one RPC into its stale-PENDING reclaim branch.
type reclaimCase struct {
	orders   map[string]*tradingv1.Order
	broker   broker.Broker
	hash     string
	intentID string
	wantMsg  string
	trigger  string
	call     func(*TradingService, context.Context) error
}

func placeReclaimCase(t *testing.T) reclaimCase {
	t.Helper()
	sum, err := placeOrderRequestHash(placeReq())
	if err != nil {
		t.Fatalf("placeOrderRequestHash: %v", err)
	}
	return reclaimCase{
		orders: map[string]*tradingv1.Order{}, broker: timeoutBroker(), hash: hex.EncodeToString(sum),
		intentID: "c-1", wantMsg: `order intent "c-1" is still pending`, trigger: "reactive_place",
		call: func(s *TradingService, ctx context.Context) error {
			_, err := s.PlaceOrder(ctx, placeReq())
			return err
		},
	}
}

func cancelReclaimCase(t *testing.T) reclaimCase {
	t.Helper()
	req := &tradingv1.CancelOrderRequest{OrderId: "o-1"}
	id, hash, err := deriveReplaceCancelIntentID(req)
	if err != nil {
		t.Fatalf("deriveReplaceCancelIntentID: %v", err)
	}
	return reclaimCase{
		orders: workingOrder(tradingv1.OrderStatus_ORDER_STATUS_NEW), broker: &fakeBroker{}, hash: hash,
		intentID: id, wantMsg: "cancel on order o-1 is still pending", trigger: "reactive_cancel",
		call: func(s *TradingService, ctx context.Context) error { _, err := s.CancelOrder(ctx, req); return err },
	}
}

func replaceReclaimCase(t *testing.T) reclaimCase {
	t.Helper()
	req := &tradingv1.ReplaceOrderRequest{OrderId: "o-1", LimitPrice: 101.00}
	id, hash, err := deriveReplaceCancelIntentID(req)
	if err != nil {
		t.Fatalf("deriveReplaceCancelIntentID: %v", err)
	}
	return reclaimCase{
		orders: workingOrder(tradingv1.OrderStatus_ORDER_STATUS_NEW), broker: replaceOKBroker{&fakeBroker{}}, hash: hash,
		intentID: id, wantMsg: "replace on order o-1 is still pending", trigger: "reactive_replace",
		call: func(s *TradingService, ctx context.Context) error { _, err := s.ReplaceOrder(ctx, req); return err },
	}
}

func reclaimSvc(c reclaimCase, repo *staleIntentRepo, ledger *traceCapturingLedger) *TradingService {
	svc := auditSvc(&ctxCapturingDB{}, c.broker, &recordingLedgerClient{}, c.orders)
	svc.orderIntentRepo = repo
	svc.ledger = ledger
	return svc
}

// assertReachedReclaim fails unless the RPC took the stale-PENDING reclaim branch, not a gate or hash mismatch.
func assertReachedReclaim(t *testing.T, err error, repo *staleIntentRepo, wantMsg string) {
	t.Helper()
	if called, _ := repo.snapshot(); !called {
		t.Fatalf("ReclaimOrphanIntent not called; RPC returned %v", err)
	}
	if grpcstatus.Code(err) != codes.FailedPrecondition || grpcstatus.Convert(err).Message() != wantMsg {
		t.Fatalf("err = %v, want FailedPrecondition %q", err, wantMsg)
	}
}

func runReclaimAudited(t *testing.T, c reclaimCase) {
	repo, ledger := newStaleIntentRepo(c.hash), &traceCapturingLedger{}
	err := c.call(reclaimSvc(c, repo, ledger), tracedCancelledCtx("u-1"))
	assertReachedReclaim(t, err, repo, c.wantMsg)

	if _, cas := repo.snapshot(); cas.traceID != "t-267" || cas.ctxErr != nil {
		t.Errorf("reclaim CAS ctx: traceID = %q, ctx.Err() = %v; want t-267 and nil", cas.traceID, cas.ctxErr)
	}
	ev := waitForLedgerEventType(t, ledger, reclaimedUnknownEvent)
	if ev.req.StreamKey != "order:o-1" || ev.req.UserId != "u-1" {
		t.Errorf("stream_key = %q, user_id = %q; want order:o-1 and u-1", ev.req.StreamKey, ev.req.UserId)
	}
	if ev.traceID != "t-267" || ev.ctxErr != nil {
		t.Errorf("emit ctx: x-trace-id = %q, ctx.Err() = %v; want t-267 and nil", ev.traceID, ev.ctxErr)
	}
	if ev.req.Payload == nil {
		t.Fatal("payload is nil")
	}
	want := map[string]interface{}{
		"trigger": c.trigger, "order_id": "o-1", "intent_id": c.intentID,
		"was_pending_since": repo.pendingSince.UTC().Format(time.RFC3339Nano),
	}
	got := ev.req.Payload.AsMap()
	if len(got) != len(want) {
		t.Errorf("payload = %v, want %v", got, want)
	}
	for k, v := range want {
		if got[k] != v {
			t.Errorf("payload[%s] = %v, want %v", k, got[k], v)
		}
	}
}

func TestPlaceOrder_StaleIntent_ReclaimAudited_AC4(t *testing.T) {
	runReclaimAudited(t, placeReclaimCase(t))
}

func TestCancelOrder_StaleIntent_ReclaimAudited_AC8(t *testing.T) {
	runReclaimAudited(t, cancelReclaimCase(t))
}

func TestReplaceOrder_StaleIntent_ReclaimAudited_AC9(t *testing.T) {
	runReclaimAudited(t, replaceReclaimCase(t))
}

func runReclaimFailureLogged(t *testing.T, c reclaimCase) {
	records := captureLogs(t)
	repo, ledger := newStaleIntentRepo(c.hash), &traceCapturingLedger{}
	repo.err = errors.New("db unavailable")
	err := c.call(reclaimSvc(c, repo, ledger), ctxAsUser("u-1"))
	assertReachedReclaim(t, err, repo, c.wantMsg)

	var got []map[string]any
	for _, r := range records() {
		if r["msg"] == "order intent reclaim failed" {
			got = append(got, r)
		}
	}
	if len(got) != 1 {
		t.Fatalf("want exactly one %q record, got %d (records: %v)", "order intent reclaim failed", len(got), records())
	}
	if got[0]["intent_id"] != c.intentID || got[0]["trigger"] != c.trigger {
		t.Errorf("intent_id = %v, trigger = %v; want %s and %s", got[0]["intent_id"], got[0]["trigger"], c.intentID, c.trigger)
	}
	if e, _ := got[0]["error"].(string); !strings.Contains(e, "db unavailable") {
		t.Errorf("error = %v, want it to contain %q", got[0]["error"], "db unavailable")
	}
	if evs := ledger.callsOf(reclaimedUnknownEvent); len(evs) != 0 {
		t.Errorf("got %d %s events on a failed reclaim, want 0", len(evs), reclaimedUnknownEvent)
	}
}

func TestCancelOrder_StaleIntent_ReclaimFailureLogged_AC5(t *testing.T) {
	runReclaimFailureLogged(t, cancelReclaimCase(t))
}

func TestReplaceOrder_StaleIntent_ReclaimFailureLogged_AC7(t *testing.T) {
	runReclaimFailureLogged(t, replaceReclaimCase(t))
}

func TestSweepOrderIntents_PayloadPopulated(t *testing.T) {
	t0, t1 := time.Now().Add(-time.Hour), time.Now()
	repo := &staleIntentRepo{
		reclaimed: true,
		out:       &repository.OrderIntentRecord{IntentID: "i-1", OrderID: "o-1", UpdatedAt: t1},
		sweep:     []*repository.OrderIntentRecord{{IntentID: "i-1", OrderID: "o-1", UpdatedAt: t0}},
	}
	ledger := &traceCapturingLedger{}
	svc := &TradingService{cfgW: activeSnapshot(), orderIntentRepo: repo, ledger: ledger}

	svc.sweepOrderIntents(context.Background())

	evs := ledger.callsOf(reclaimedUnknownEvent)
	if len(evs) != 1 {
		t.Fatalf("got %d %s events, want 1", len(evs), reclaimedUnknownEvent)
	}
	req := evs[0].req
	if req.UserId != "" || req.StreamKey != "order:o-1" {
		t.Errorf(`user_id = %q, stream_key = %q; want "" and order:o-1`, req.UserId, req.StreamKey)
	}
	if req.Payload == nil {
		t.Fatal("payload is nil")
	}
	got, wantSince := req.Payload.AsMap(), t0.UTC().Format(time.RFC3339Nano)
	if got["trigger"] != "sweep" || got["was_pending_since"] != wantSince {
		t.Errorf("payload = %v, want trigger sweep and was_pending_since %s", got, wantSince)
	}
}

func TestReclaimedUnknownPayload(t *testing.T) {
	t0 := time.Date(2026, 10, 28, 9, 30, 0, 123456789, time.FixedZone("EST", -5*3600))
	out := &repository.OrderIntentRecord{IntentID: "i-1", OrderID: "o-1", UpdatedAt: time.Now()}

	m := reclaimedUnknownPayload("sweep", out, t0)

	if _, err := structpb.NewStruct(m); err != nil {
		t.Fatalf("structpb.NewStruct: %v", err)
	}
	want := map[string]interface{}{
		"trigger": "sweep", "order_id": "o-1", "intent_id": "i-1",
		"was_pending_since": t0.UTC().Format(time.RFC3339Nano),
	}
	if len(m) != len(want) {
		t.Errorf("payload = %v, want exactly %v", m, want)
	}
	for k, v := range want {
		if m[k] != v {
			t.Errorf("payload[%s] = %v, want %v", k, m[k], v)
		}
	}
}

// Scope widening (feature 267 Step 5): every request-reachable ledger emit, alert, finalize and
// bracket call keeps the inbound x-trace-id and survives a cancelled caller.

// ctxCapturingIntentRepo records the trace and ctx error of each FinalizeIntent, keyed by final state.
type ctxCapturingIntentRepo struct {
	fakeOrderIntentRepo
	mu        sync.Mutex
	finalized map[int16]execCall
}

func (r *ctxCapturingIntentRepo) FinalizeIntent(ctx context.Context, _, _ string, state int16, _ []byte) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.finalized == nil {
		r.finalized = map[int16]execCall{}
	}
	r.finalized[state] = execCall{traceID: middleware.FromContext(ctx).TraceID, ctxErr: ctx.Err()}
	return nil
}

func (r *ctxCapturingIntentRepo) assertFinalizeTraced(t *testing.T, state int16) {
	t.Helper()
	r.mu.Lock()
	c, ok := r.finalized[state]
	r.mu.Unlock()
	if !ok {
		t.Fatalf("FinalizeIntent(state %d) not called", state)
	}
	assertTraced(t, "FinalizeIntent", c.traceID, c.ctxErr)
}

type alertCall struct {
	req     *notifyv1.EmitAlertRequest
	traceID string
	ctxErr  error
}

// traceCapturingNotify runs the real client interceptor, so it sees the x-trace-id a real EmitAlert would send.
type traceCapturingNotify struct {
	fakeNotifyClient
	alerts []alertCall
}

func (n *traceCapturingNotify) EmitAlert(ctx context.Context, req *notifyv1.EmitAlertRequest, opts ...grpc.CallOption) (*notifyv1.EmitAlertResponse, error) {
	ctxErr := ctx.Err()
	traceID := outgoingTraceID(ctx, "/notify.v1.NotifyService/EmitAlert", req, opts...)
	n.mu.Lock()
	n.calls = append(n.calls, req)
	n.alerts = append(n.alerts, alertCall{req: req, traceID: traceID, ctxErr: ctxErr})
	n.mu.Unlock()
	return &notifyv1.EmitAlertResponse{}, nil
}

func (n *traceCapturingNotify) assertAlertTraced(t *testing.T, category string) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		n.mu.Lock()
		for _, a := range n.alerts {
			if a.req.Category == category {
				n.mu.Unlock()
				assertTraced(t, "alert "+category, a.traceID, a.ctxErr)
				return
			}
		}
		n.mu.Unlock()
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("no %q alert within 2s", category)
}

// ctxCapturingAccountRepo records the trace and ctx error of each UpdateCredentialStatus.
type ctxCapturingAccountRepo struct {
	repository.AccountRepository
	mu    sync.Mutex
	calls []execCall
}

func (r *ctxCapturingAccountRepo) UpdateCredentialStatus(ctx context.Context, _ string, _ int32, _ time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.calls = append(r.calls, execCall{traceID: middleware.FromContext(ctx).TraceID, ctxErr: ctx.Err()})
	return nil
}

// replaceFailBroker definitively refuses ReplaceOrder (a non-timeout broker error).
type replaceFailBroker struct{ *fakeBroker }

func (replaceFailBroker) ReplaceOrder(context.Context, string, broker.OrderRequest) (*broker.BrokerOrder, error) {
	return nil, errors.New("broker refused replace")
}

func assertTraced(t *testing.T, site, traceID string, ctxErr error) {
	t.Helper()
	if traceID != "t-267" || ctxErr != nil {
		t.Errorf("%s: x-trace-id = %q, ctx.Err() = %v; want t-267 and nil", site, traceID, ctxErr)
	}
}

func assertLedgerTraced(t *testing.T, l *traceCapturingLedger, eventTypes ...string) {
	t.Helper()
	for _, et := range eventTypes {
		c := waitForLedgerEventType(t, l, et)
		assertTraced(t, "emit "+et, c.traceID, c.ctxErr)
	}
}

type traceHarness struct {
	svc     *TradingService
	db      *ctxCapturingDB
	ledger  *traceCapturingLedger
	notify  *traceCapturingNotify
	intents *ctxCapturingIntentRepo
	bracket *fakeBracketRepo
}

func newTraceHarness(fb broker.Broker, brokerType commonv1.BrokerType, orders map[string]*tradingv1.Order) *traceHarness {
	h := &traceHarness{
		db: &ctxCapturingDB{}, ledger: &traceCapturingLedger{}, notify: &traceCapturingNotify{},
		intents: &ctxCapturingIntentRepo{}, bracket: &fakeBracketRepo{},
	}
	h.svc = auditSvc(h.db, fb, &recordingLedgerClient{}, orders)
	h.svc.ledger, h.svc.notify, h.svc.orderIntentRepo, h.svc.bracketRepo = h.ledger, h.notify, h.intents, h.bracket
	entry := h.svc.brokers["acct-1"]
	entry.brokerType = int32(brokerType)
	h.svc.brokers["acct-1"] = entry
	return h
}

func (h *traceHarness) entry() brokerPoolEntry { return h.svc.brokers["acct-1"] }

func (h *traceHarness) activeBracket(t *testing.T, orderID string) {
	t.Helper()
	rec := &repository.OrderBracketRecord{OrderID: orderID, AccountID: "acct-1", Status: bracketStatusSubmitting}
	if err := h.bracket.CreateBracket(context.Background(), rec); err != nil {
		t.Fatalf("CreateBracket: %v", err)
	}
	if err := h.bracket.UpdateBracketStatus(context.Background(), rec.ID, bracketStatusActive, "leg-stop", "leg-tp", ""); err != nil {
		t.Fatalf("UpdateBracketStatus: %v", err)
	}
}

func (h *traceHarness) submit(t *testing.T, req *tradingv1.PlaceOrderRequest, requiresApproval bool) error {
	t.Helper()
	sum, err := placeOrderRequestHash(req)
	if err != nil {
		t.Fatalf("placeOrderRequestHash: %v", err)
	}
	_, err = h.svc.submitOrder(tracedCancelledCtx("u-1"), req, h.entry(), commonv1.TradingMode_TRADING_MODE_PAPER,
		"acct-1", "o-1", requiresApproval, hex.EncodeToString(sum), false, 0, 0)
	return err
}

func TestTrace_SubmitOrder_HappyPath(t *testing.T) {
	fb := &fakeBroker{submitOrderFn: func(context.Context, broker.OrderRequest) (*broker.BrokerOrder, error) {
		return &broker.BrokerOrder{BrokerOrderID: "brk-1", Status: "filled", FilledQty: 10, FilledAvgPrice: 148,
			StopLegOrderID: "s", TakeProfitLegOrderID: "t"}, nil
	}}
	h := newTraceHarness(fb, commonv1.BrokerType_BROKER_TYPE_ALPACA, map[string]*tradingv1.Order{})
	req := placeReq()
	req.StopPrice = 145

	if err := h.submit(t, req, false); err != nil {
		t.Fatalf("submitOrder: %v", err)
	}
	// #1, #4, #8 (via #27), #11
	assertLedgerTraced(t, h.ledger, "order.created", "order.submitted", "order.bracket_updated", "order.broker_submitted")
	assertWriteCtx(t, h.db)                                            // #9
	h.intents.assertFinalizeTraced(t, repository.IntentStateCompleted) // #10
}

func TestTrace_SubmitOrder_Approval(t *testing.T) {
	h := newTraceHarness(&fakeBroker{}, commonv1.BrokerType_BROKER_TYPE_ALPACA, map[string]*tradingv1.Order{})
	if err := h.submit(t, placeReq(), true); err != nil {
		t.Fatalf("submitOrder: %v", err)
	}
	assertLedgerTraced(t, h.ledger, "order.created", "order.approval_requested") // #1, #2
	h.notify.assertAlertTraced(t, "approval")                                    // #3
}

func TestTrace_SubmitOrder_Timeout(t *testing.T) {
	h := newTraceHarness(timeoutBroker(), commonv1.BrokerType_BROKER_TYPE_ALPACA, map[string]*tradingv1.Order{})
	if err := h.submit(t, placeReq(), false); err == nil {
		t.Fatal("want the broker timeout surfaced as an error")
	}
	assertLedgerTraced(t, h.ledger, "order.broker_call_uncertain") // #5
}

func TestTrace_SubmitOrder_Reject(t *testing.T) {
	h := newTraceHarness(rejectBroker(), commonv1.BrokerType_BROKER_TYPE_ALPACA, map[string]*tradingv1.Order{})
	if err := h.submit(t, placeReq(), false); err == nil {
		t.Fatal("want the broker rejection surfaced as an error")
	}
	assertLedgerTraced(t, h.ledger, "order.broker_rejected")          // #6
	h.intents.assertFinalizeTraced(t, repository.IntentStateRejected) // #7
}

func TestTrace_RecordOfflineOrder(t *testing.T) {
	h := newTraceHarness(&fakeBroker{}, commonv1.BrokerType_BROKER_TYPE_OFFLINE, map[string]*tradingv1.Order{})
	if _, err := h.svc.recordOfflineOrder(tracedCancelledCtx("u-1"), placeReq(), "acct-1", "u-1"); err != nil {
		t.Fatalf("recordOfflineOrder: %v", err)
	}
	assertLedgerTraced(t, h.ledger, "order.created") // #12
}

func TestTrace_CancelOrder(t *testing.T) {
	h := newTraceHarness(&fakeBroker{}, commonv1.BrokerType_BROKER_TYPE_ALPACA, workingOrder(tradingv1.OrderStatus_ORDER_STATUS_NEW))
	h.activeBracket(t, "o-1")

	if _, err := h.svc.CancelOrder(tracedCancelledCtx("u-1"), &tradingv1.CancelOrderRequest{OrderId: "o-1"}); err != nil {
		t.Fatalf("CancelOrder: %v", err)
	}
	assertLedgerTraced(t, h.ledger, "order.bracket_updated", "order.canceled") // #13, #14
	h.intents.assertFinalizeTraced(t, repository.IntentStateCompleted)         // #15 (CancelOrder caller)
}

func TestTrace_CancelOrder_NotCancelable_ReReadFails(t *testing.T) {
	fb := &fakeBroker{cancelOrderFn: notCancelable, getOrderFn: func(context.Context, string) (*broker.BrokerOrder, error) {
		return nil, errors.New("broker unreachable")
	}}
	h := newTraceHarness(fb, commonv1.BrokerType_BROKER_TYPE_ALPACA, workingOrder(tradingv1.OrderStatus_ORDER_STATUS_NEW))

	_, err := h.svc.CancelOrder(tracedCancelledCtx("u-1"), &tradingv1.CancelOrderRequest{OrderId: "o-1"})
	if grpcstatus.Code(err) != codes.Unavailable {
		t.Fatalf("err = %v, want Unavailable", err)
	}
	h.intents.assertFinalizeTraced(t, repository.IntentStateUnknown) // #15 (re-read failure caller)
}

func TestTrace_CancelOrder_NotCancelable_BrokerFilled(t *testing.T) {
	orders := workingOrder(tradingv1.OrderStatus_ORDER_STATUS_NEW)
	orders["o-1"].StopPrice = 145
	fb := &fakeBroker{cancelOrderFn: notCancelable, getOrderFn: func(context.Context, string) (*broker.BrokerOrder, error) {
		return &broker.BrokerOrder{BrokerOrderID: "brk-1", Status: "filled", FilledQty: 10, FilledAvgPrice: 148}, nil
	}}
	h := newTraceHarness(fb, commonv1.BrokerType_BROKER_TYPE_ALPACA, orders)

	resp, err := h.svc.CancelOrder(tracedCancelledCtx("u-1"), &tradingv1.CancelOrderRequest{OrderId: "o-1"})
	if err != nil || resp.Success {
		t.Fatalf("resp = %+v, err = %v; want Success=false (the order filled)", resp, err)
	}
	assertLedgerTraced(t, h.ledger, "order.filled", "order.bracket_updated") // #19, #21 (via #27)
	h.notify.assertAlertTraced(t, "trade")                                   // #20
	h.intents.assertFinalizeTraced(t, repository.IntentStateCompleted)       // #15 (adopted-status caller)
}

func TestTrace_ReplaceOrder(t *testing.T) {
	req := &tradingv1.ReplaceOrderRequest{OrderId: "o-1", LimitPrice: 101.00}

	t.Run("success", func(t *testing.T) {
		h := newTraceHarness(replaceOKBroker{&fakeBroker{}}, commonv1.BrokerType_BROKER_TYPE_ALPACA, workingOrder(tradingv1.OrderStatus_ORDER_STATUS_NEW))
		if _, err := h.svc.ReplaceOrder(tracedCancelledCtx("u-1"), req); err != nil {
			t.Fatalf("ReplaceOrder: %v", err)
		}
		h.intents.assertFinalizeTraced(t, repository.IntentStateCompleted) // #17
		assertLedgerTraced(t, h.ledger, "order.replaced")                  // #18
	})

	t.Run("broker error", func(t *testing.T) {
		h := newTraceHarness(replaceFailBroker{&fakeBroker{}}, commonv1.BrokerType_BROKER_TYPE_ALPACA, workingOrder(tradingv1.OrderStatus_ORDER_STATUS_NEW))
		if _, err := h.svc.ReplaceOrder(tracedCancelledCtx("u-1"), req); grpcstatus.Code(err) != codes.Internal {
			t.Fatalf("err = %v, want Internal", err)
		}
		h.intents.assertFinalizeTraced(t, repository.IntentStateRejected) // #16
	})
}

func TestTrace_ApplyBrokerOrderStatus(t *testing.T) {
	cases := []struct {
		name         string
		brokerStatus string
		legsErr      error
		withBracket  bool
		wantEvents   []string
		wantAlert    bool
	}{
		{name: "partially_filled resizes", brokerStatus: "partially_filled", withBracket: true,
			wantEvents: []string{"order.partially_filled", "order.bracket_updated"}}, // #22, #23 (via #31)
		{name: "partially_filled resize fails", brokerStatus: "partially_filled", withBracket: true, legsErr: errors.New("ibkr down"),
			wantEvents: []string{"order.partially_filled"}, wantAlert: true}, // #22, #23 (via #30)
		{name: "canceled", brokerStatus: "canceled", wantEvents: []string{"order.canceled"}}, // #24
		{name: "rejected", brokerStatus: "rejected", wantEvents: []string{"order.rejected"}}, // #25
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			fb := &fakeBroker{submitBracketLegsFn: func(context.Context, string, string, broker.BracketLegsRequest) (*broker.BracketLegsResponse, error) {
				if tc.legsErr != nil {
					return nil, tc.legsErr
				}
				return &broker.BracketLegsResponse{StopLegOrderID: "s2", TakeProfitLegOrderID: "t2"}, nil
			}}
			orders := workingOrder(tradingv1.OrderStatus_ORDER_STATUS_NEW)
			order := orders["o-1"]
			order.BrokerType, order.StopPrice = commonv1.BrokerType_BROKER_TYPE_IBKR, 145
			h := newTraceHarness(fb, commonv1.BrokerType_BROKER_TYPE_IBKR, orders)
			if tc.withBracket {
				h.activeBracket(t, "o-1")
			}

			h.svc.applyBrokerOrderStatus(tracedCancelledCtx("u-1"), order, h.entry(),
				&broker.BrokerOrder{BrokerOrderID: "brk-1", Status: tc.brokerStatus, FilledQty: 4, FilledAvgPrice: 148})

			assertLedgerTraced(t, h.ledger, tc.wantEvents...)
			if tc.wantAlert {
				h.notify.assertAlertTraced(t, "bracket")
			}
		})
	}
}

func TestTrace_CreateBracket(t *testing.T) {
	cases := []struct {
		name       string
		brokerType commonv1.BrokerType
		createErr  error
		legsErr    error
		wantEvent  string
	}{
		{name: "row creation fails", brokerType: commonv1.BrokerType_BROKER_TYPE_ALPACA, createErr: errors.New("db unavailable")}, // #26
		{name: "IBKR legs fail", brokerType: commonv1.BrokerType_BROKER_TYPE_IBKR, legsErr: errors.New("ibkr down")},              // #28
		{name: "IBKR success", brokerType: commonv1.BrokerType_BROKER_TYPE_IBKR, wantEvent: "order.bracket_updated"},              // #29
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			fb := &fakeBroker{submitBracketLegsFn: func(context.Context, string, string, broker.BracketLegsRequest) (*broker.BracketLegsResponse, error) {
				if tc.legsErr != nil {
					return nil, tc.legsErr
				}
				return &broker.BracketLegsResponse{StopLegOrderID: "s1", TakeProfitLegOrderID: "t1"}, nil
			}}
			h := newTraceHarness(fb, tc.brokerType, map[string]*tradingv1.Order{})
			h.bracket.createErr = tc.createErr
			order := newTestBracketOrder("o-1", tradingv1.OrderSide_ORDER_SIDE_BUY, tc.brokerType)
			order.UserId = "u-1"

			h.svc.maybeSubmitBracket(tracedCancelledCtx("u-1"), order, h.entry(), &broker.BrokerOrder{}, 145, 148, true)

			if tc.wantEvent != "" {
				assertLedgerTraced(t, h.ledger, tc.wantEvent)
			} else {
				h.notify.assertAlertTraced(t, "bracket")
			}
		})
	}
}

func TestTrace_ValidateAndRecordCredential(t *testing.T) {
	repo := &ctxCapturingAccountRepo{}
	svc := &TradingService{accountRepo: repo, credStatus: map[string]int32{}}

	svc.validateAndRecordCredential(tracedCancelledCtx("u-1"), "acct-1", &fakeBroker{})

	repo.mu.Lock()
	defer repo.mu.Unlock()
	if len(repo.calls) != 1 {
		t.Fatalf("UpdateCredentialStatus calls = %d, want 1", len(repo.calls))
	}
	assertTraced(t, "UpdateCredentialStatus", repo.calls[0].traceID, repo.calls[0].ctxErr) // #32
}
