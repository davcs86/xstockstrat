package service

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	configv1 "github.com/xstockstrat/contracts/gen/go/config/v1"
	tradingv1 "github.com/xstockstrat/contracts/gen/go/trading/v1"
	"github.com/xstockstrat/trading/internal/broker"
	"github.com/xstockstrat/trading/internal/config"
	"github.com/xstockstrat/trading/internal/repository"
)

const (
	adoptAcct      = "acct-A"
	adoptTombLog   = "bracket leg poll: adoption tombstone"
	adoptInsertLog = "bracket leg poll: insert adopted leg failed"
	adoptCandLog   = "bracket leg poll: list adoption candidates failed"
	adoptListLog   = "bracket leg poll: broker ListOrders failed"
	adoptCredLog   = "bracket leg poll: broker rejected credentials, skipping account"
)

// adoptClock is the injected s.clock(); tests advance it instead of sleeping.
type adoptClock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *adoptClock) now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *adoptClock) advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.t = c.t.Add(d)
}

// floatCfg sets namespace-relative trading keys, so the reads go through GetFloat.
func floatCfg(kv map[string]float64) *config.Watcher {
	values := make(map[string]*configv1.ConfigValue, len(kv))
	for k, v := range kv {
		values[k] = &configv1.ConfigValue{Value: &configv1.ConfigValue_FloatVal{FloatVal: v}}
	}
	return config.MustSnapshotWatcher("trading", values)
}

type adoptHarness struct {
	svc    *TradingService
	repo   *fakeBracketRepo
	ledger *legLedger
	clk    *adoptClock
}

type adoptAccount struct {
	id         string
	brokerType int32
	fb         *fakeBroker
}

// newAdoptHarness sets the broker type of every account explicitly (fails.md, feature 358).
func newAdoptHarness(cfg map[string]float64, accounts ...adoptAccount) *adoptHarness {
	repo := &fakeBracketRepo{}
	ledger := &legLedger{}
	brokers := make(map[string]brokerPoolEntry, len(accounts))
	for _, a := range accounts {
		if a.fb.getOrderFn == nil {
			a.fb.getOrderFn = func(context.Context, string) (*broker.BrokerOrder, error) {
				return nil, errors.New("unexpected GetOrder")
			}
		}
		brokers[a.id] = brokerPoolEntry{client: a.fb, brokerType: a.brokerType, userID: legUser}
	}
	clk := &adoptClock{t: time.Date(2026, 11, 27, 15, 0, 0, 0, time.UTC)}
	svc := newLegPollSvc(brokers, repo, ledger)
	svc.cfgW = floatCfg(cfg)
	svc.now = clk.now
	svc.halted = map[string]bool{}
	svc.credStatus = map[string]int32{}
	return &adoptHarness{svc: svc, repo: repo, ledger: ledger, clk: clk}
}

func (h *adoptHarness) ticks(n int) {
	for i := 0; i < n; i++ {
		h.svc.pollFills(context.Background())
	}
}

// seedCandidate writes a bracket in the given status with its parent order (a buy, so the legs sell).
func seedCandidate(repo *fakeBracketRepo, accountID, orderID string, status int32, legIDs ...string) {
	repo.mu.Lock()
	defer repo.mu.Unlock()
	if repo.byID == nil {
		repo.byID = map[string]*repository.OrderBracketRecord{}
		repo.byOrder = map[string]*repository.OrderBracketRecord{}
	}
	if repo.parents == nil {
		repo.parents = map[string]*tradingv1.Order{}
	}
	rec := &repository.OrderBracketRecord{ID: "brk-" + orderID, OrderID: orderID, AccountID: accountID, Status: status}
	rec.StopLegOrderID = legIDs[0]
	if len(legIDs) > 1 {
		rec.TakeProfitLegOrderID = legIDs[1]
	}
	repo.byID[rec.ID] = rec
	repo.byOrder[orderID] = rec
	repo.parents[orderID] = &tradingv1.Order{
		OrderId: orderID, UserId: legUser, Symbol: "AAPL", Side: tradingv1.OrderSide_ORDER_SIDE_BUY,
		TradingMode: commonv1.TradingMode_TRADING_MODE_PAPER,
	}
}

func tombstone(repo *fakeBracketRepo, accountID, legID string) {
	repo.mu.Lock()
	defer repo.mu.Unlock()
	repo.putLeg(&repository.BracketLegRecord{
		AccountID: accountID, LegOrderID: legID, OrderID: "ord-old", UserID: legUser, TradingMode: legMode,
		Symbol: "AAPL", Side: tradingv1.OrderSide_ORDER_SIDE_SELL, Status: repository.LegStatusNotOpenAtAdoption, Adopted: true,
	})
}

func candidateIDs(t *testing.T, repo *fakeBracketRepo) []string {
	t.Helper()
	cands, err := repo.ListAdoptionCandidates(context.Background(), []int32{bracketStatusActive, bracketStatusCanceling})
	if err != nil {
		t.Fatalf("ListAdoptionCandidates: %v", err)
	}
	var out []string
	for _, c := range cands {
		out = append(out, c.LegOrderID)
	}
	return out
}

// filler returns n listed orders that are not candidates.
func filler(n int) []broker.BrokerOrder {
	out := make([]broker.BrokerOrder, n)
	for i := range out {
		out[i] = broker.BrokerOrder{BrokerOrderID: fmt.Sprintf("other-%d", i), Status: "filled", FilledQty: 1}
	}
	return out
}

func assertTombstone(t *testing.T, repo *fakeBracketRepo, legID string) {
	t.Helper()
	leg := mustLegRow(t, repo, adoptAcct, legID)
	if leg.Status != repository.LegStatusNotOpenAtAdoption || leg.FilledQty != 0 || leg.ObservedFilledQty != 0 || !leg.Adopted {
		t.Errorf("row = %+v, want NOT_OPEN_AT_ADOPTION with both quantities 0 and adopted", leg)
	}
}

func TestAdoption_OpenCandidateAtZeroFillIsAdoptedTracked(t *testing.T) {
	for _, tc := range []struct {
		name, status string
		brokerType   int32
	}{
		{"alpaca new", "new", alpacaType},
		{"alpaca held", "held", alpacaType},
		{"ibkr Submitted", "Submitted", ibkrType},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fb := &fakeBroker{listOrdersFn: listing([]broker.BrokerOrder{{BrokerOrderID: "leg-s1", Status: tc.status}})}
			h := newAdoptHarness(nil, adoptAccount{adoptAcct, tc.brokerType, fb})
			seedCandidate(h.repo, adoptAcct, "ord-1", bracketStatusActive, "leg-s1")

			h.ticks(1)

			leg := mustLegRow(t, h.repo, adoptAcct, "leg-s1")
			if leg.Status != repository.LegStatusOpen || !leg.Adopted || leg.FilledQty != 0 || leg.ObservedFilledQty != 0 {
				t.Errorf("row = %+v, want OPEN, adopted, both quantities 0", leg)
			}
			if leg.OrderID != "ord-1" || leg.UserID != legUser || leg.Symbol != "AAPL" || leg.Side != tradingv1.OrderSide_ORDER_SIDE_SELL || leg.TradingMode != legMode {
				t.Errorf("row parent data = %+v", leg)
			}
			lists, gets := fb.calls()
			if lists != 1 || len(gets) != 0 {
				t.Errorf("ListOrders = %d, GetOrder = %v; want 1 and none", lists, gets)
			}
		})
	}
}

func TestAdoption_OpenCandidateWithFillIsBaselineRetired(t *testing.T) {
	fb := &fakeBroker{listOrdersFn: listing([]broker.BrokerOrder{{BrokerOrderID: "leg-s1", Status: "partially_filled", FilledQty: 4, FilledAvgPrice: 110}})}
	h := newAdoptHarness(nil, adoptAccount{adoptAcct, alpacaType, fb})
	seedCandidate(h.repo, adoptAcct, "ord-1", bracketStatusCanceling, "leg-s1")

	h.ticks(2)

	leg := mustLegRow(t, h.repo, adoptAcct, "leg-s1")
	if leg.Status != repository.LegStatusBaselineRetired || leg.FilledQty != 0 || leg.ObservedFilledQty != 4 || !leg.Adopted {
		t.Errorf("row = %+v, want BASELINE_RETIRED, filled 0, observed 4, adopted", leg)
	}
	if attempts, _ := h.ledger.snapshot(); len(attempts) != 0 {
		t.Errorf("ledger attempts = %d, want none", len(attempts))
	}
}

func TestAdoption_CanceledOrFailedBracketIsNeverACandidate(t *testing.T) {
	fb := &fakeBroker{listOrdersFn: listing([]broker.BrokerOrder{{BrokerOrderID: "leg-c", Status: "new"}, {BrokerOrderID: "leg-f", Status: "new"}})}
	h := newAdoptHarness(nil, adoptAccount{adoptAcct, alpacaType, fb})
	seedCandidate(h.repo, adoptAcct, "ord-c", bracketStatusCanceled, "leg-c")
	seedCandidate(h.repo, adoptAcct, "ord-f", bracketStatusFailed, "leg-f")

	h.ticks(1)

	if n := legCount(h.repo); n != 0 {
		t.Errorf("bracket_legs rows = %d, want 0", n)
	}
	if lists, _ := fb.calls(); lists != 0 {
		t.Errorf("ListOrders = %d, want 0", lists)
	}
}

func TestAdoption_NoCandidatesAndNoTrackedLegsMakesNoList(t *testing.T) {
	fb := &fakeBroker{listOrdersFn: listing(nil)}
	h := newAdoptHarness(nil, adoptAccount{adoptAcct, alpacaType, fb})

	h.ticks(3)

	if lists, _ := fb.calls(); lists != 0 {
		t.Errorf("ListOrders = %d, want 0", lists)
	}
}

func TestAdoption_SecondRunIsANoOp(t *testing.T) {
	fb := &fakeBroker{listOrdersFn: listing([]broker.BrokerOrder{{BrokerOrderID: "leg-s1", Status: "new"}})}
	h := newAdoptHarness(nil, adoptAccount{adoptAcct, alpacaType, fb})
	seedCandidate(h.repo, adoptAcct, "ord-1", bracketStatusActive, "leg-s1")

	h.ticks(1)
	first := mustLegRow(t, h.repo, adoptAcct, "leg-s1")
	h.ticks(1)

	if n := legCount(h.repo); n != 1 {
		t.Errorf("bracket_legs rows = %d, want 1", n)
	}
	if got := candidateIDs(t, h.repo); len(got) != 0 {
		t.Errorf("candidates after adoption = %v, want none", got)
	}
	if again := mustLegRow(t, h.repo, adoptAcct, "leg-s1"); again.Status != first.Status || again.FilledQty != first.FilledQty || !again.Adopted {
		t.Errorf("row changed: %+v then %+v", first, again)
	}
}

func TestAdoption_AdoptedLegLaterFillEmitsFullPayload(t *testing.T) {
	fb := &fakeBroker{listOrdersFn: listing(
		[]broker.BrokerOrder{{BrokerOrderID: "leg-tp", Status: "new"}},
		[]broker.BrokerOrder{{BrokerOrderID: "leg-tp", Status: "filled", FilledQty: 10, FilledAvgPrice: 110, Fees: 0.5}},
	)}
	h := newAdoptHarness(nil, adoptAccount{adoptAcct, alpacaType, fb})
	seedCandidate(h.repo, adoptAcct, "ord-1", bracketStatusActive, "leg-tp")

	h.ticks(2)

	_, events := h.ledger.snapshot()
	if len(events) != 1 {
		t.Fatalf("ledger appends = %d, want 1", len(events))
	}
	e := events[0]
	if e.EventType != "order.filled" || e.StreamKey != "leg-tp" || e.IdempotencyKey != "bracket-leg:"+adoptAcct+":leg-tp:filled:10" {
		t.Errorf("event = %s stream %q key %q", e.EventType, e.StreamKey, e.IdempotencyKey)
	}
	want := map[string]any{
		"order_id": "leg-tp", "symbol": "AAPL", "side": "ORDER_SIDE_SELL", "qty": 10.0, "fill_price": 110.0,
		"user_id": legUser, "trading_mode": legMode, "account_id": adoptAcct, "fees": 0.5,
	}
	got := payloadOf(e)
	for k, v := range want {
		if got[k] != v {
			t.Errorf("payload[%s] = %v, want %v", k, got[k], v)
		}
	}
	if leg := mustLegRow(t, h.repo, adoptAcct, "leg-tp"); leg.Status != repository.LegStatusFilled || leg.FilledQty != 10 {
		t.Errorf("row = %+v, want FILLED 10", leg)
	}
}

func TestAdoption_CandidateQueryErrorStillObservesTrackedAccounts(t *testing.T) {
	logs := captureLogs(t)
	tracked := &fakeBroker{listOrdersFn: listing([]broker.BrokerOrder{{BrokerOrderID: "leg-t", Status: "partially_filled", FilledQty: 2, FilledAvgPrice: 110}})}
	adoptOnly := &fakeBroker{listOrdersFn: listing([]broker.BrokerOrder{{BrokerOrderID: "leg-c", Status: "new"}})}
	h := newAdoptHarness(nil, adoptAccount{legAcct, alpacaType, tracked}, adoptAccount{adoptAcct, alpacaType, adoptOnly})
	trackLeg(h.repo, legAcct, "leg-t", false)
	seedCandidate(h.repo, adoptAcct, "ord-1", bracketStatusActive, "leg-c")
	h.repo.listCandidatesErr = errors.New("db down")

	h.ticks(1)

	if lists, _ := tracked.calls(); lists != 1 {
		t.Errorf("tracked account ListOrders = %d, want 1", lists)
	}
	if leg := mustLegRow(t, h.repo, legAcct, "leg-t"); leg.ObservedFilledQty != 2 || leg.FilledQty != 2 {
		t.Errorf("tracked leg = %+v, want observed and emitted at 2", leg)
	}
	if lists, _ := adoptOnly.calls(); lists != 0 {
		t.Errorf("adoption-only account ListOrders = %d, want 0", lists)
	}
	if legRow(h.repo, adoptAcct, "leg-c") != nil {
		t.Error("candidate adopted despite the query error")
	}
	if n := len(logsWithMsg(logs(), adoptCandLog)); n != 1 {
		t.Errorf("%q logs = %d, want 1", adoptCandLog, n)
	}
}

// Round-10 case 1.
func TestAdoption_ListedTerminalIsTombstoned(t *testing.T) {
	for _, status := range []string{"filled", "canceled"} {
		t.Run(status, func(t *testing.T) {
			logs := captureLogs(t)
			fb := &fakeBroker{listOrdersFn: listing([]broker.BrokerOrder{{BrokerOrderID: "leg-s1", Status: status, FilledQty: 3}})}
			h := newAdoptHarness(nil, adoptAccount{adoptAcct, alpacaType, fb})
			seedCandidate(h.repo, adoptAcct, "ord-1", bracketStatusActive, "leg-s1")

			h.ticks(1)
			assertTombstone(t, h.repo, "leg-s1")
			if attempts, _ := h.ledger.snapshot(); len(attempts) != 0 {
				t.Errorf("ledger attempts = %d, want none", len(attempts))
			}
			recs := logsWithMsg(logs(), adoptTombLog)
			if len(recs) != 1 || recs[0]["reason"] != "listed_terminal" || recs[0]["account_id"] != adoptAcct ||
				recs[0]["leg_order_id"] != "leg-s1" || recs[0]["order_id"] != "ord-1" || recs[0]["level"] != "INFO" {
				t.Errorf("tombstone logs = %v", recs)
			}

			h.ticks(1)
			lists, gets := fb.calls()
			if lists != 1 || len(gets) != 0 {
				t.Errorf("ListOrders = %d, GetOrder = %v over two ticks; want 1 and none", lists, gets)
			}
			if got := candidateIDs(t, h.repo); len(got) != 0 {
				t.Errorf("candidates = %v, want none", got)
			}
		})
	}
}

// Round-10 cases 2-5: the complete-list gate.
func TestAdoption_AbsentCandidateCompleteListGate(t *testing.T) {
	for _, tc := range []struct {
		name          string
		brokerType    int32
		list          []broker.BrokerOrder
		listErr       error
		wantTombstone bool
	}{
		{"alpaca 499 rows", alpacaType, filler(broker.ListOrdersLimit - 1), nil, true},
		{"alpaca exactly 500 rows", alpacaType, filler(broker.ListOrdersLimit), nil, false},
		{"ibkr empty 200", ibkrType, []broker.BrokerOrder{}, nil, false},
		{"ibkr 600 rows", ibkrType, filler(600), nil, true},
		{"list error", alpacaType, nil, errors.New("503"), false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			logs := captureLogs(t)
			fb := &fakeBroker{listOrdersFn: func(context.Context) ([]broker.BrokerOrder, error) { return tc.list, tc.listErr }}
			h := newAdoptHarness(nil, adoptAccount{adoptAcct, tc.brokerType, fb})
			seedCandidate(h.repo, adoptAcct, "ord-1", bracketStatusActive, "leg-s1")

			h.ticks(1)

			if tc.wantTombstone {
				assertTombstone(t, h.repo, "leg-s1")
				if recs := logsWithMsg(logs(), adoptTombLog); len(recs) != 1 || recs[0]["reason"] != "absent" {
					t.Errorf("tombstone logs = %v, want one with reason absent", recs)
				}
				return
			}
			if n := legCount(h.repo); n != 0 {
				t.Errorf("bracket_legs rows = %d, want 0", n)
			}
			if got := candidateIDs(t, h.repo); len(got) != 1 {
				t.Errorf("candidates = %v, want leg-s1 still present", got)
			}
		})
	}
}

// Round-10 case 6.
func TestAdoption_TombstoneInsertErrorWarnsOnceAndRetries(t *testing.T) {
	logs := captureLogs(t)
	fb := &fakeBroker{listOrdersFn: listing([]broker.BrokerOrder{
		{BrokerOrderID: "leg-t", Status: "partially_filled", FilledQty: 2, FilledAvgPrice: 110},
		{BrokerOrderID: "leg-c1", Status: "canceled"},
		{BrokerOrderID: "leg-c2", Status: "canceled"},
	})}
	h := newAdoptHarness(nil, adoptAccount{adoptAcct, alpacaType, fb})
	trackLeg(h.repo, adoptAcct, "leg-t", false)
	seedCandidate(h.repo, adoptAcct, "ord-1", bracketStatusActive, "leg-c1", "leg-c2")
	h.repo.insertAdoptedErr = errors.New("insert failed")

	h.ticks(1)

	if n := len(logsWithMsg(logs(), adoptInsertLog)); n != 1 {
		t.Errorf("%q logs = %d, want 1 for the tick", adoptInsertLog, n)
	}
	if leg := mustLegRow(t, h.repo, adoptAcct, "leg-t"); leg.ObservedFilledQty != 2 || leg.FilledQty != 2 {
		t.Errorf("tracked leg = %+v, want observed and emitted at 2", leg)
	}
	if legRow(h.repo, adoptAcct, "leg-c1") != nil || legRow(h.repo, adoptAcct, "leg-c2") != nil {
		t.Fatal("a candidate was inserted despite the insert error")
	}

	h.repo.mu.Lock()
	h.repo.insertAdoptedErr = nil
	h.repo.mu.Unlock()
	h.ticks(1)

	assertTombstone(t, h.repo, "leg-c1")
	assertTombstone(t, h.repo, "leg-c2")
}

// Round-10 case 7.
func TestAdoption_MixedAccountListsOnceAndTombstoneSkipsFallback(t *testing.T) {
	fb := &fakeBroker{listOrdersFn: listing([]broker.BrokerOrder{
		{BrokerOrderID: "leg-t", Status: "new"},
		{BrokerOrderID: "leg-n", Status: "new"},
	})}
	h := newAdoptHarness(nil, adoptAccount{adoptAcct, alpacaType, fb})
	trackLeg(h.repo, adoptAcct, "leg-t", false)
	tombstone(h.repo, adoptAcct, "leg-x")
	seedCandidate(h.repo, adoptAcct, "ord-1", bracketStatusActive, "leg-n")

	h.ticks(1)

	lists, gets := fb.calls()
	if lists != 1 || len(gets) != 0 {
		t.Errorf("ListOrders = %d, GetOrder = %v; want 1 and none", lists, gets)
	}
	if leg := mustLegRow(t, h.repo, adoptAcct, "leg-n"); leg.Status != repository.LegStatusOpen || !leg.Adopted {
		t.Errorf("new candidate row = %+v, want OPEN adopted", leg)
	}
}

// Round-11 cases 11, 12, 15 and 16: an adoption-only account is listed once per cooldown.
func TestAdoption_AdoptionOnlyThrottle(t *testing.T) {
	for _, tc := range []struct {
		name       string
		brokerType int32
		halted     bool
		cfg        map[string]float64
		list       []broker.BrokerOrder
		listErr    error
		step       time.Duration
		wantLists  int
	}{
		{"alpaca 500 rows", alpacaType, false, map[string]float64{"reconciliation.interval_ms": 60000}, filler(broker.ListOrdersLimit), nil, 0, 1},
		{"idle ibkr empty", ibkrType, false, map[string]float64{"reconciliation.interval_ms": 60000}, []broker.BrokerOrder{}, nil, 0, 1},
		{"halted uses halted interval", alpacaType, true, map[string]float64{"reconciliation.interval_ms": 60000, "reconciliation.halted_poll_interval_ms": 300000}, filler(broker.ListOrdersLimit), nil, 61 * time.Second, 1},
		{"failed list is throttled", alpacaType, false, nil, nil, errors.New("503"), 0, 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			logs := captureLogs(t)
			fb := &fakeBroker{listOrdersFn: func(context.Context) ([]broker.BrokerOrder, error) { return tc.list, tc.listErr }}
			h := newAdoptHarness(tc.cfg, adoptAccount{adoptAcct, tc.brokerType, fb})
			h.svc.halted[adoptAcct] = tc.halted
			seedCandidate(h.repo, adoptAcct, "ord-1", bracketStatusActive, "leg-s1")

			for i := 0; i < 3; i++ {
				h.ticks(1)
				h.clk.advance(tc.step)
			}

			if lists, _ := fb.calls(); lists != tc.wantLists {
				t.Errorf("ListOrders over 3 ticks = %d, want %d", lists, tc.wantLists)
			}
			if n := legCount(h.repo); n != 0 {
				t.Errorf("bracket_legs rows = %d, want 0", n)
			}
			if tc.listErr != nil {
				if n := len(logsWithMsg(logs(), adoptListLog)); n != 1 {
					t.Errorf("%q logs = %d, want 1", adoptListLog, n)
				}
			}
		})
	}
}

// Round-11 case 12: the cooldown ends.
func TestAdoption_AdoptionOnlyListsAgainAfterInterval(t *testing.T) {
	fb := &fakeBroker{listOrdersFn: listing([]broker.BrokerOrder{})}
	h := newAdoptHarness(map[string]float64{"reconciliation.interval_ms": 60000}, adoptAccount{adoptAcct, ibkrType, fb})
	seedCandidate(h.repo, adoptAcct, "ord-1", bracketStatusActive, "leg-s1")

	h.ticks(1)
	h.clk.advance(59 * time.Second)
	h.ticks(1)
	if lists, _ := fb.calls(); lists != 1 {
		t.Fatalf("ListOrders inside the cooldown = %d, want 1", lists)
	}
	h.clk.advance(time.Second)
	h.ticks(1)
	if lists, _ := fb.calls(); lists != 2 {
		t.Errorf("ListOrders after the interval = %d, want 2", lists)
	}
}

// Round-11 case 13.
func TestAdoption_NonPositiveIntervals(t *testing.T) {
	for _, tc := range []struct {
		name      string
		halted    bool
		cfg       map[string]float64
		wantLists int
	}{
		{"interval_ms 0 reads as 60000", false, map[string]float64{"reconciliation.interval_ms": 0}, 1},
		{"halted_poll_interval_ms 0 always lists", true, map[string]float64{"reconciliation.halted_poll_interval_ms": 0}, 3},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fb := &fakeBroker{listOrdersFn: listing([]broker.BrokerOrder{})}
			h := newAdoptHarness(tc.cfg, adoptAccount{adoptAcct, ibkrType, fb})
			h.svc.halted[adoptAcct] = tc.halted
			seedCandidate(h.repo, adoptAcct, "ord-1", bracketStatusActive, "leg-s1")

			h.ticks(3)

			if lists, _ := fb.calls(); lists != tc.wantLists {
				t.Errorf("ListOrders over 3 ticks = %d, want %d", lists, tc.wantLists)
			}
		})
	}
}

// Round-11 case 14: a tracked account is listed every tick and adoption runs on each list.
func TestAdoption_TrackedAccountAdoptsOnEveryTick(t *testing.T) {
	full := append(filler(broker.ListOrdersLimit-1), broker.BrokerOrder{BrokerOrderID: "leg-t", Status: "new"})
	fb := &fakeBroker{listOrdersFn: listing(full, full, []broker.BrokerOrder{{BrokerOrderID: "leg-t", Status: "new"}})}
	h := newAdoptHarness(map[string]float64{"reconciliation.interval_ms": 60000}, adoptAccount{adoptAcct, alpacaType, fb})
	trackLeg(h.repo, adoptAcct, "leg-t", false)
	seedCandidate(h.repo, adoptAcct, "ord-1", bracketStatusActive, "leg-c")

	h.ticks(2)
	if legRow(h.repo, adoptAcct, "leg-c") != nil {
		t.Fatal("candidate tombstoned against a 500-row list")
	}
	h.ticks(1)

	if lists, _ := fb.calls(); lists != 3 {
		t.Errorf("ListOrders over 3 ticks = %d, want 3", lists)
	}
	assertTombstone(t, h.repo, "leg-c")
}

// Round-11 case 17.
func TestAdoption_AdoptedOpenAccountIsListedNextTickInsideCooldown(t *testing.T) {
	fb := &fakeBroker{listOrdersFn: listing([]broker.BrokerOrder{{BrokerOrderID: "leg-s1", Status: "new"}})}
	h := newAdoptHarness(map[string]float64{"reconciliation.interval_ms": 60000}, adoptAccount{adoptAcct, alpacaType, fb})
	seedCandidate(h.repo, adoptAcct, "ord-1", bracketStatusActive, "leg-s1")

	h.ticks(2)

	if lists, _ := fb.calls(); lists != 2 {
		t.Errorf("ListOrders over 2 ticks = %d, want 2 (tracked from tick 2)", lists)
	}
}

// Round-11 case 19: the new-candidate bypass.
func TestAdoption_NewCandidateBypassesCooldown(t *testing.T) {
	fb := &fakeBroker{listOrdersFn: listing([]broker.BrokerOrder{})}
	h := newAdoptHarness(map[string]float64{"reconciliation.interval_ms": 60000}, adoptAccount{adoptAcct, ibkrType, fb})
	seedCandidate(h.repo, adoptAcct, "ord-1", bracketStatusActive, "leg-s1")

	h.ticks(1)
	seedCandidate(h.repo, adoptAcct, "ord-2", bracketStatusActive, "leg-s2")
	h.ticks(1)
	if lists, _ := fb.calls(); lists != 2 {
		t.Fatalf("ListOrders after a new candidate = %d, want 2", lists)
	}
	h.ticks(1)
	if lists, _ := fb.calls(); lists != 2 {
		t.Errorf("ListOrders with the same candidate set = %d, want 2", lists)
	}
}

// Round-11 case 20.
func TestAdoption_InvalidCredentials(t *testing.T) {
	t.Run("known invalid is skipped silently", func(t *testing.T) {
		logs := captureLogs(t)
		fb := &fakeBroker{listOrdersFn: listing([]broker.BrokerOrder{{BrokerOrderID: "leg-s1", Status: "new"}})}
		h := newAdoptHarness(nil, adoptAccount{adoptAcct, alpacaType, fb})
		h.svc.credStatus[adoptAcct] = int32(tradingv1.CredentialStatus_CREDENTIAL_STATUS_INVALID)
		seedCandidate(h.repo, adoptAcct, "ord-1", bracketStatusActive, "leg-s1")

		h.ticks(2)

		if lists, _ := fb.calls(); lists != 0 {
			t.Errorf("ListOrders = %d, want 0", lists)
		}
		for _, r := range logs() {
			if r["level"] == "WARN" {
				t.Errorf("unexpected WARN %v", r)
			}
		}
	})
	t.Run("rejected list warns and skips", func(t *testing.T) {
		logs := captureLogs(t)
		fb := &fakeBroker{listOrdersFn: func(context.Context) ([]broker.BrokerOrder, error) {
			return nil, fmt.Errorf("401: %w", broker.ErrInvalidCredentials)
		}}
		h := newAdoptHarness(nil, adoptAccount{adoptAcct, alpacaType, fb})
		seedCandidate(h.repo, adoptAcct, "ord-1", bracketStatusActive, "leg-s1")

		h.ticks(1)

		if n := len(logsWithMsg(logs(), adoptCredLog)); n != 1 {
			t.Errorf("%q logs = %d, want 1", adoptCredLog, n)
		}
		if n := legCount(h.repo); n != 0 {
			t.Errorf("bracket_legs rows = %d, want 0", n)
		}
	})
}
