package service

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"google.golang.org/grpc/codes"
	grpcstatus "google.golang.org/grpc/status"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	configv1 "github.com/xstockstrat/contracts/gen/go/config/v1"
	tradingv1 "github.com/xstockstrat/contracts/gen/go/trading/v1"
	"github.com/xstockstrat/trading/internal/broker"
	"github.com/xstockstrat/trading/internal/config"
	"github.com/xstockstrat/trading/internal/repository"
	"github.com/xstockstrat/trading/internal/telemetry"
)

const adaptiveRateLimitKey = "broker.adaptive_rate_limit_enabled"

func TestRateLimitBudget(t *testing.T) {
	for _, tc := range []struct {
		enabled  bool
		t, stale time.Duration
		want     time.Duration
	}{
		{true, 5 * time.Second, 30 * time.Second, 20 * time.Second},
		{true, 5 * time.Second, 15 * time.Second, 5 * time.Second},
		{true, 10 * time.Second, 15 * time.Second, 10 * time.Second},
		{true, time.Second, 30 * time.Second, 28 * time.Second},
		{false, 5 * time.Second, 30 * time.Second, 0},
	} {
		if got := rateLimitBudget(tc.enabled, tc.t, tc.stale); got != tc.want {
			t.Errorf("rateLimitBudget(%v, %v, %v) = %v, want %v", tc.enabled, tc.t, tc.stale, got, tc.want)
		}
	}
}

func rateLimitWatcher(timeoutMs, multiplier float64, enabled *bool) *config.Watcher {
	values := map[string]*configv1.ConfigValue{
		"broker.timeout_ms":             {Value: &configv1.ConfigValue_FloatVal{FloatVal: timeoutMs}},
		"order_intent.stale_multiplier": {Value: &configv1.ConfigValue_FloatVal{FloatVal: multiplier}},
	}
	if enabled != nil {
		values[adaptiveRateLimitKey] = &configv1.ConfigValue{Value: &configv1.ConfigValue_BoolVal{BoolVal: *enabled}}
	}
	return config.MustSnapshotWatcher("trading", values)
}

// The method the Alpaca client is wired to reads the live timeout, multiplier and kill switch.
func TestAlpacaRateLimitBudget_FollowsConfig(t *testing.T) {
	on, off := true, false
	for _, tc := range []struct {
		timeoutMs, multiplier float64
		want                  time.Duration
	}{
		{5000, 3.0, 20 * time.Second},
		{5000, 1.5, 5 * time.Second},
		{10000, 1.5, 10 * time.Second},
		{1000, 3.0, 28 * time.Second},
	} {
		svc := &TradingService{cfgW: rateLimitWatcher(tc.timeoutMs, tc.multiplier, nil)}
		if got := svc.alpacaRateLimitBudget(); got != tc.want {
			t.Errorf("key absent, %v ms x%v: budget = %v, want %v", tc.timeoutMs, tc.multiplier, got, tc.want)
		}
	}
	if got := (&TradingService{cfgW: rateLimitWatcher(5000, 3.0, &off)}).alpacaRateLimitBudget(); got != 0 {
		t.Errorf("kill switch false: budget = %v, want 0", got)
	}
	// true is the value the alpaca_adaptive_rate_limit_keys config migration seeds.
	if got := (&TradingService{cfgW: rateLimitWatcher(5000, 3.0, &on)}).alpacaRateLimitBudget(); got != 20*time.Second {
		t.Errorf("seeded true: budget = %v, want 20s", got)
	}
}

// ── real-client scenarios: a broker.NewClient built from the same closures as instantiateBrokerLocked ──

type rlRequest struct{ method, path, body string }

// rlHarness serves the Alpaca paper API from an httptest server; the script gets each request's index.
type rlHarness struct {
	svc     *TradingService
	intents *memIntentRepo
	db      *ctxCapturingDB
	ledger  *recordingLedgerClient
	bracket *fakeBracketRepo
	client  *broker.Client

	mu   sync.Mutex
	reqs []rlRequest
}

func (h *rlHarness) seen(method, pathPrefix string) []rlRequest {
	h.mu.Lock()
	defer h.mu.Unlock()
	var out []rlRequest
	for _, r := range h.reqs {
		if r.method == method && strings.HasPrefix(r.path, pathPrefix) {
			out = append(out, r)
		}
	}
	return out
}

func (h *rlHarness) execCount() int {
	h.db.mu.Lock()
	defer h.db.mu.Unlock()
	return len(h.db.calls)
}

func (h *rlHarness) intentStates() []int16 {
	h.intents.mu.Lock()
	defer h.intents.mu.Unlock()
	var out []int16
	for _, r := range h.intents.recs {
		out = append(out, r.State)
	}
	return out
}

func (h *rlHarness) order(id string) *tradingv1.Order {
	h.svc.mu.Lock()
	defer h.svc.mu.Unlock()
	return h.svc.orders[id]
}

func (h *rlHarness) hasEvent(eventType string) bool {
	for _, et := range h.ledger.eventTypes() {
		if et == eventType {
			return true
		}
	}
	return false
}

func newRateLimitHarness(t *testing.T, timeoutMs float64, orders map[string]*tradingv1.Order, script func(n int, w http.ResponseWriter, r *http.Request)) *rlHarness {
	t.Helper()
	h := &rlHarness{
		intents: &memIntentRepo{recs: map[string]*repository.OrderIntentRecord{}},
		db:      &ctxCapturingDB{}, ledger: &recordingLedgerClient{}, bracket: &fakeBracketRepo{},
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		h.mu.Lock()
		n := len(h.reqs)
		h.reqs = append(h.reqs, rlRequest{method: r.Method, path: r.URL.Path, body: string(body)})
		h.mu.Unlock()
		script(n, w, r)
	}))
	t.Cleanup(srv.Close)
	if orders == nil {
		orders = map[string]*tradingv1.Order{}
	}
	h.svc = &TradingService{
		cfg: &config.Config{}, platformCfgW: activePlatformSnapshot(),
		cfgW: config.MustSnapshotWatcher("trading", map[string]*configv1.ConfigValue{
			"risk.max_position_pct": {Value: &configv1.ConfigValue_FloatVal{FloatVal: 0}},
			"broker.timeout_ms":     {Value: &configv1.ConfigValue_FloatVal{FloatVal: timeoutMs}},
			"order.max_retries":     {Value: &configv1.ConfigValue_FloatVal{FloatVal: 3}},
		}),
		repo: repository.NewTradingRepoWithDB(h.db), orderIntentRepo: h.intents, bracketRepo: h.bracket,
		ledger: h.ledger, notify: &fakeNotifyClient{},
		orders: orders,
		halted: map[string]bool{}, haltReasons: map[string]string{}, haltedLastPolled: map[string]time.Time{},
	}
	h.client = broker.NewClient(broker.ClientConfig{
		APIKey: "k", APISecret: "s", PaperURL: srv.URL, LiveURL: "http://should-not-be-called", Paper: true,
		Timeout:         func() time.Duration { return brokerCallTimeout(h.svc.cfgW) },
		RateLimitBudget: h.svc.alpacaRateLimitBudget,
	})
	h.svc.brokers = map[string]brokerPoolEntry{
		"acct-1": {client: h.client, brokerType: int32(commonv1.BrokerType_BROKER_TYPE_ALPACA), userID: "user-1"},
	}
	return h
}

func rlResetHeader(w http.ResponseWriter, ahead time.Duration) {
	w.Header().Set("X-RateLimit-Reset", strconv.FormatInt(time.Now().Add(ahead).Unix(), 10))
}

func rlExhaustedHeaders(w http.ResponseWriter, ahead time.Duration) {
	w.Header().Set("X-RateLimit-Limit", "200")
	w.Header().Set("X-RateLimit-Remaining", "0")
	rlResetHeader(w, ahead)
}

func rlOrderJSON(w http.ResponseWriter, id string) {
	w.Header().Set("Content-Type", "application/json")
	_, _ = fmt.Fprintf(w, `{"id":%q,"status":"new"}`, id)
}

func rlPlaceReq(clientOrderID string) *tradingv1.PlaceOrderRequest {
	return &tradingv1.PlaceOrderRequest{
		Symbol: "AAPL", Side: tradingv1.OrderSide_ORDER_SIDE_BUY, Qty: 10, OrderType: tradingv1.OrderType_ORDER_TYPE_MARKET,
		TimeInForce: tradingv1.TimeInForce_TIME_IN_FORCE_DAY, ClientOrderId: clientOrderID, AccountId: "acct-1",
	}
}

func rlWorkingOrder(status tradingv1.OrderStatus) map[string]*tradingv1.Order {
	return map[string]*tradingv1.Order{"ord-1": {
		OrderId: "ord-1", UserId: "user-1", AccountId: "acct-1", BrokerOrderId: "b-1", Status: status,
		BrokerType: commonv1.BrokerType_BROKER_TYPE_ALPACA, OrderType: tradingv1.OrderType_ORDER_TYPE_LIMIT,
		Qty: 10, LimitPrice: 100, IntentState: tradingv1.IntentState_INTENT_STATE_COMPLETED,
	}}
}

func rlPlacedOrder(h *rlHarness) *tradingv1.Order {
	h.svc.mu.Lock()
	defer h.svc.mu.Unlock()
	for _, o := range h.svc.orders {
		return o
	}
	return nil
}

// The service sends the caller's id with its own prefix; what matters is that every attempt carries the same one.
func rlSameClientOrderID(t *testing.T, posts []rlRequest, want string) {
	t.Helper()
	for i, p := range posts {
		if !strings.Contains(p.body, `"client_order_id":"`) || !strings.Contains(p.body, want+`"`) || p.body != posts[0].body {
			t.Fatalf("POST %d body %s does not match the first or lacks client_order_id %s", i+1, p.body, want)
		}
	}
}

// @AC-12: a rate-limited order submit creates exactly one order (MARKET, then LIMIT).
func TestPlaceOrder_RateLimitedSubmitCreatesOneOrder_F347_AC12(t *testing.T) {
	limit := rlPlaceReq("c-42")
	limit.OrderType, limit.LimitPrice = tradingv1.OrderType_ORDER_TYPE_LIMIT, 150.00
	for name, req := range map[string]*tradingv1.PlaceOrderRequest{"market": rlPlaceReq("c-42"), "limit": limit} {
		h := newRateLimitHarness(t, 5000, nil, func(n int, w http.ResponseWriter, _ *http.Request) {
			if n == 0 {
				rlResetHeader(w, time.Second)
				w.WriteHeader(http.StatusTooManyRequests)
				return
			}
			rlOrderJSON(w, "b-1")
		})
		order, err := h.svc.PlaceOrder(ctxAsUser("user-1"), req)
		if err != nil || order.BrokerOrderId != "b-1" {
			t.Fatalf("%s: order = %+v, err = %v; want broker order id b-1", name, order, err)
		}
		posts := h.seen(http.MethodPost, "/v2/orders")
		if len(posts) != 2 {
			t.Fatalf("%s: POSTs = %d, want 2", name, len(posts))
		}
		rlSameClientOrderID(t, posts, "c-42")
		if states := h.intentStates(); len(states) != 1 || states[0] != repository.IntentStateCompleted {
			t.Fatalf("%s: intent states = %v, want exactly one Completed", name, states)
		}
	}
}

// @AC-25: a rate-limited submit is not abandoned when the caller cancels.
func TestPlaceOrder_CallerCancelDoesNotAbandonRetry_F347_AC25(t *testing.T) {
	h := newRateLimitHarness(t, 5000, nil, func(n int, w http.ResponseWriter, _ *http.Request) {
		if n == 0 {
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
		rlOrderJSON(w, "b-7")
	})
	ctx, cancel := context.WithCancel(ctxAsUser("user-1"))
	defer cancel()
	time.AfterFunc(500*time.Millisecond, cancel)
	_, _ = h.svc.PlaceOrder(ctx, rlPlaceReq("c-25"))

	posts := h.seen(http.MethodPost, "/v2/orders")
	if len(posts) != 2 {
		t.Fatalf("POSTs = %d, want 2", len(posts))
	}
	rlSameClientOrderID(t, posts, "c-25")
	order := rlPlacedOrder(h)
	if order == nil || order.BrokerOrderId != "b-7" || order.Status == tradingv1.OrderStatus_ORDER_STATUS_REJECTED {
		t.Fatalf("order = %+v, want it recorded with broker order id b-7 and not REJECTED", order)
	}
	if h.execCount() == 0 {
		t.Fatal("the order was never persisted")
	}
	if states := h.intentStates(); len(states) != 1 || states[0] != repository.IntentStateCompleted {
		t.Fatalf("intent states = %v, want one Completed", states)
	}
}

// @AC-26: a submit whose caller deadline leaves no room for a retry is rejected as rate limited.
func TestPlaceOrder_NoRoomForRetryIsRejected_F347_AC26(t *testing.T) {
	h := newRateLimitHarness(t, 5000, nil, func(_ int, w http.ResponseWriter, _ *http.Request) {
		rlResetHeader(w, 2*time.Second)
		w.WriteHeader(http.StatusTooManyRequests)
	})
	ctx, cancel := context.WithTimeout(ctxAsUser("user-1"), 3*time.Second)
	defer cancel()
	_, err := h.svc.PlaceOrder(ctx, rlPlaceReq("c-26"))
	if err == nil || !strings.Contains(err.Error(), "rate limited") {
		t.Fatalf("error = %v, want one containing \"rate limited\"", err)
	}
	if n := len(h.seen(http.MethodPost, "/v2/orders")); n != 1 {
		t.Fatalf("POSTs = %d, want exactly 1", n)
	}
	waitForLedgerEvents(t, h.ledger, 3)
	if order := rlPlacedOrder(h); order == nil || order.Status != tradingv1.OrderStatus_ORDER_STATUS_REJECTED {
		t.Fatalf("order = %+v, want REJECTED", order)
	}
	if !h.hasEvent("order.broker_rejected") {
		t.Fatalf("ledger events = %v, want order.broker_rejected", h.ledger.eventTypes())
	}
	if states := h.intentStates(); len(states) != 1 || states[0] != repository.IntentStateRejected {
		t.Fatalf("intent states = %v, want one Rejected", states)
	}
}

// @AC-27: an attempt that times out inside a retry stays uncertain.
func TestPlaceOrder_TimeoutInsideRetryStaysUncertain_F347_AC27(t *testing.T) {
	h := newRateLimitHarness(t, 1000, nil, func(n int, w http.ResponseWriter, r *http.Request) {
		if n == 0 {
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
		select {
		case <-r.Context().Done():
		case <-time.After(3 * time.Second):
		}
	})
	if _, err := h.svc.PlaceOrder(ctxAsUser("user-1"), rlPlaceReq("c-27")); err == nil {
		t.Fatal("want the timed-out attempt surfaced as an error")
	}
	if n := len(h.seen(http.MethodPost, "/v2/orders")); n != 2 {
		t.Fatalf("POSTs = %d, want 2", n)
	}
	waitForLedgerEvents(t, h.ledger, 3)
	if order := rlPlacedOrder(h); order == nil || order.Status == tradingv1.OrderStatus_ORDER_STATUS_REJECTED {
		t.Fatalf("order = %+v, want it not REJECTED", order)
	}
	if !h.hasEvent("order.broker_call_uncertain") {
		t.Fatalf("ledger events = %v, want order.broker_call_uncertain", h.ledger.eventTypes())
	}
	if states := h.intentStates(); len(states) != 1 || states[0] != repository.IntentStatePending {
		t.Fatalf("intent states = %v, want one PENDING", states)
	}
}

// @AC-34: the fill poller does not stall on a throttled Alpaca account.
func TestPollFills_ThrottledAccountDoesNotStall_F347_AC34(t *testing.T) {
	records := captureLogs(t)
	orders := map[string]*tradingv1.Order{}
	for i := 1; i <= 3; i++ {
		id := fmt.Sprintf("ord-%d", i)
		orders[id] = &tradingv1.Order{
			OrderId: id, UserId: "user-1", AccountId: "acct-1", BrokerOrderId: fmt.Sprintf("b-%d", i),
			Status: tradingv1.OrderStatus_ORDER_STATUS_NEW, BrokerType: commonv1.BrokerType_BROKER_TYPE_ALPACA,
		}
	}
	h := newRateLimitHarness(t, 5000, orders, func(_ int, w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v2/account" {
			rlExhaustedHeaders(w, 10*time.Second)
		}
		_, _ = io.WriteString(w, `{}`)
	})
	if _, err := h.client.GetAccount(context.Background()); err != nil {
		t.Fatalf("priming GetAccount: %v", err)
	}

	began := time.Now()
	h.svc.pollFills(context.Background())
	if took := time.Since(began); took > 100*time.Millisecond {
		t.Fatalf("tick took %v, want within 100 ms", took)
	}
	if got := h.seen(http.MethodGet, "/v2/orders/"); len(got) != 0 {
		t.Fatalf("GET /v2/orders/{id} requests = %+v, want none", got)
	}
	failures, ticks := 0, 0
	for _, r := range records() {
		switch {
		case r["msg"] == "fill poll: broker GetOrder failed":
			failures++
		case r["msg"] == telemetry.LoopTickOKMsg && r["loop"] == string(telemetry.LoopFillPoller):
			ticks++
		}
	}
	if failures != 3 || ticks != 0 {
		t.Fatalf("logged GetOrder failures = %d, loop tick ok records = %d; want 3 and 0", failures, ticks)
	}
}

// @AC-35: bracket-leg cancels make one bounded attempt after the cancel is recorded.
func TestCancelOrder_LegCancelsBoundedAfterCancelRecorded_F347_AC35(t *testing.T) {
	for name, status := range map[string]tradingv1.OrderStatus{
		"PARTIALLY_FILLED parent": tradingv1.OrderStatus_ORDER_STATUS_PARTIALLY_FILLED,
		"NEW parent":              tradingv1.OrderStatus_ORDER_STATUS_NEW,
	} {
		t.Run(name, func(t *testing.T) {
			records := captureLogs(t)
			var h *rlHarness
			var atFirstLeg struct {
				seen    bool
				status  tradingv1.OrderStatus
				execs   int
				intents []int16
			}
			h = newRateLimitHarness(t, 5000, rlWorkingOrder(status), func(_ int, w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/v2/orders/b-1" {
					w.WriteHeader(http.StatusNoContent)
					return
				}
				h.mu.Lock()
				first := !atFirstLeg.seen
				atFirstLeg.seen = true
				h.mu.Unlock()
				if first {
					atFirstLeg.status, atFirstLeg.execs, atFirstLeg.intents = h.order("ord-1").Status, h.execCount(), h.intentStates()
				}
				rlResetHeader(w, 10*time.Second)
				w.WriteHeader(http.StatusTooManyRequests)
			})
			rec := &repository.OrderBracketRecord{OrderID: "ord-1", AccountID: "acct-1", Status: bracketStatusSubmitting}
			if err := h.bracket.CreateBracket(context.Background(), rec); err != nil {
				t.Fatalf("CreateBracket: %v", err)
			}
			if err := h.bracket.UpdateBracketStatus(context.Background(), rec.ID, bracketStatusActive, "leg-stop", "leg-tp", ""); err != nil {
				t.Fatalf("UpdateBracketStatus: %v", err)
			}

			began := time.Now()
			resp, err := h.svc.CancelOrder(ctxAsUser("user-1"), &tradingv1.CancelOrderRequest{OrderId: "ord-1"})
			if err != nil || !resp.Success {
				t.Fatalf("resp = %+v, err = %v; want success", resp, err)
			}
			if took := time.Since(began); took > time.Second {
				t.Fatalf("CancelOrder took %v, want within 1 s", took)
			}
			for _, leg := range []string{"leg-stop", "leg-tp"} {
				if n := len(h.seen(http.MethodDelete, "/v2/orders/"+leg)); n != 1 {
					t.Fatalf("DELETEs for %s = %d, want exactly 1", leg, n)
				}
			}
			if atFirstLeg.status != tradingv1.OrderStatus_ORDER_STATUS_CANCELED || atFirstLeg.execs == 0 {
				t.Fatalf("at the first leg DELETE: status = %v, stored writes = %d; want CANCELED already written", atFirstLeg.status, atFirstLeg.execs)
			}
			if len(atFirstLeg.intents) != 1 || atFirstLeg.intents[0] != repository.IntentStateCompleted {
				t.Fatalf("at the first leg DELETE: intent states = %v, want the cancel intent Completed", atFirstLeg.intents)
			}
			waitForLedgerEvents(t, h.ledger, 2) // order.bracket_updated, order.canceled
			warned := map[string]int{}
			for _, r := range records() {
				if msg, _ := r["msg"].(string); strings.HasPrefix(msg, "cancel: bracket ") && strings.HasSuffix(msg, "leg cancel failed") {
					warned[fmt.Sprint(r["leg_id"])]++
				}
			}
			if warned["leg-stop"] != 1 || warned["leg-tp"] != 1 {
				t.Fatalf("leg WARNs = %v, want one naming each leg id", warned)
			}
		})
	}
}

// ── fake-broker scenarios: the broker refuses with a wrapped ErrRateLimited ──

var errRLRefused = fmt.Errorf("alpaca broker rate limited by paper-api.alpaca.markets: %w", broker.ErrRateLimited)

type rlFakeHarness struct {
	svc     *TradingService
	intents *memIntentRepo
	db      *ctxCapturingDB
	ledger  *recordingLedgerClient
}

func newRLFakeHarness(client broker.Broker) *rlFakeHarness {
	h := &rlFakeHarness{
		intents: &memIntentRepo{recs: map[string]*repository.OrderIntentRecord{}},
		db:      &ctxCapturingDB{}, ledger: &recordingLedgerClient{},
	}
	h.svc = auditSvc(h.db, client, h.ledger, rlWorkingOrder(tradingv1.OrderStatus_ORDER_STATUS_NEW))
	h.svc.orderIntentRepo = h.intents
	return h
}

func (h *rlFakeHarness) execCount() int {
	h.db.mu.Lock()
	defer h.db.mu.Unlock()
	return len(h.db.calls)
}

func (h *rlFakeHarness) intentCount() int {
	h.intents.mu.Lock()
	defer h.intents.mu.Unlock()
	return len(h.intents.recs)
}

func rlWantUnavailable(t *testing.T, err error, want string) {
	t.Helper()
	if grpcstatus.Code(err) != codes.Unavailable || !strings.Contains(err.Error(), want) {
		t.Fatalf("error = %v, want Unavailable containing %q", err, want)
	}
}

// @AC-29: a rate-limited cancel leaves the order unchanged and an identical retry really retries.
func TestCancelOrder_RateLimitedLeavesOrderUnchanged_F347_AC29(t *testing.T) {
	records := captureLogs(t)
	calls := 0
	fb := &fakeBroker{cancelOrderFn: func(context.Context, string) error {
		calls++
		if calls == 1 {
			return errRLRefused
		}
		return nil
	}}
	h := newRLFakeHarness(fb)
	req := &tradingv1.CancelOrderRequest{OrderId: "ord-1"}
	intentID, _, _ := deriveReplaceCancelIntentID(req)

	_, err := h.svc.CancelOrder(ctxAsUser("user-1"), req)
	rlWantUnavailable(t, err, "refused by the broker rate limit; the order is unchanged")
	order := h.svc.orders["ord-1"]
	if order.Status != tradingv1.OrderStatus_ORDER_STATUS_NEW || order.IntentState != tradingv1.IntentState_INTENT_STATE_COMPLETED {
		t.Fatalf("order = %v / %v, want still NEW with intent state COMPLETED", order.Status, order.IntentState)
	}
	if h.execCount() != 0 || len(h.ledger.eventTypes()) != 0 {
		t.Fatalf("stored writes = %d, ledger events = %v; want no CANCELED write and no order.canceled", h.execCount(), h.ledger.eventTypes())
	}
	if n := h.intentCount(); n != 0 {
		t.Fatalf("cancel intent rows = %d, want none", n)
	}
	warns := 0
	for _, r := range records() {
		if r["level"] == "WARN" && r["order_id"] == "ord-1" && r["broker_order_id"] == "b-1" && r["intent_id"] == intentID {
			warns++
		}
	}
	if warns != 1 {
		t.Fatalf("WARNs naming the order, broker order and intent id = %d, want 1", warns)
	}

	resp, err := h.svc.CancelOrder(ctxAsUser("user-1"), req)
	if err != nil || !resp.Success || calls != 2 {
		t.Fatalf("identical retry: resp = %+v, err = %v, broker cancels = %d; want a second broker cancel and success", resp, err, calls)
	}
	if got := h.svc.orders["ord-1"].Status; got != tradingv1.OrderStatus_ORDER_STATUS_CANCELED {
		t.Fatalf("status after the retry = %v, want CANCELED", got)
	}
	waitForLedgerEvents(t, h.ledger, 1)
}

// @AC-30: a rate-limited cancel whose intent was already reclaimed reports the intent as unknown.
func TestCancelOrder_RateLimitedAfterReclaimIsUnknown_F347_AC30(t *testing.T) {
	calls := 0
	var h *rlFakeHarness
	fb := &fakeBroker{cancelOrderFn: func(context.Context, string) error {
		calls++
		h.intents.mu.Lock()
		for _, r := range h.intents.recs {
			r.State = repository.IntentStateUnknown // as the sweeper does while the cancel is at the broker
		}
		h.intents.mu.Unlock()
		return errRLRefused
	}}
	h = newRLFakeHarness(fb)
	req := &tradingv1.CancelOrderRequest{OrderId: "ord-1"}

	_, err := h.svc.CancelOrder(ctxAsUser("user-1"), req)
	rlWantUnavailable(t, err, "could not be released; verify with the broker before retrying")
	order := h.svc.orders["ord-1"]
	if order.Status != tradingv1.OrderStatus_ORDER_STATUS_NEW || order.IntentState != tradingv1.IntentState_INTENT_STATE_UNKNOWN {
		t.Fatalf("order = %v / %v, want still NEW with intent state UNKNOWN", order.Status, order.IntentState)
	}

	_, err = h.svc.CancelOrder(ctxAsUser("user-1"), req)
	if grpcstatus.Code(err) != codes.FailedPrecondition || !strings.Contains(err.Error(), "outcome is unknown") {
		t.Fatalf("identical cancel: error = %v, want FailedPrecondition containing \"outcome is unknown\"", err)
	}
	if calls != 1 {
		t.Fatalf("broker cancels = %d, want no second broker call", calls)
	}
}

type rlReplaceBroker struct {
	*fakeBroker
	calls int
}

func (b *rlReplaceBroker) ReplaceOrder(context.Context, string, broker.OrderRequest) (*broker.BrokerOrder, error) {
	b.calls++
	if b.calls == 1 {
		return nil, errRLRefused
	}
	return &broker.BrokerOrder{BrokerOrderID: "b-1"}, nil
}

// @AC-31: a rate-limited replace leaves the order unchanged and an identical retry really retries.
func TestReplaceOrder_RateLimitedLeavesOrderUnchanged_F347_AC31(t *testing.T) {
	fb := &rlReplaceBroker{fakeBroker: &fakeBroker{}}
	h := newRLFakeHarness(fb)
	req := &tradingv1.ReplaceOrderRequest{OrderId: "ord-1", Qty: 7}

	_, err := h.svc.ReplaceOrder(ctxAsUser("user-1"), req)
	rlWantUnavailable(t, err, "refused by the broker rate limit; the order is unchanged")
	if got := h.svc.orders["ord-1"].Qty; got != 10 {
		t.Fatalf("qty = %v, want still 10", got)
	}
	if n := h.intentCount(); n != 0 {
		t.Fatalf("replace intent rows = %d, want none", n)
	}

	order, err := h.svc.ReplaceOrder(ctxAsUser("user-1"), req)
	if err != nil || fb.calls != 2 || order.Qty != 7 {
		t.Fatalf("identical retry: order = %+v, err = %v, broker replaces = %d; want a second broker replace and qty 7", order, err, fb.calls)
	}
}
