package service

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	marketdatav1 "github.com/xstockstrat/contracts/gen/go/marketdata/v1"
	notifyv1 "github.com/xstockstrat/contracts/gen/go/notify/v1"
	"github.com/xstockstrat/portfolio/internal/repository"
	"github.com/xstockstrat/portfolio/internal/telemetry"
)

const (
	alertPending    = marketdatav1.DelistingAlertState_DELISTING_ALERT_STATE_PENDING
	alertClaimed    = marketdatav1.DelistingAlertState_DELISTING_ALERT_STATE_CLAIMED
	alertRedelivery = marketdatav1.DelistingAlertState_DELISTING_ALERT_STATE_REDELIVERY
	alertReported   = marketdatav1.DelistingAlertState_DELISTING_ALERT_STATE_REPORTED

	delistedDate = "2026-11-09"
)

// rpcCall is what a recording double saw at call entry.
type rpcCall struct {
	md        metadata.MD
	remaining time.Duration
	hasDL     bool
}

func recordCall(ctx context.Context) rpcCall {
	md, _ := metadata.FromOutgoingContext(ctx)
	dl, ok := ctx.Deadline()
	return rpcCall{md: md.Copy(), remaining: time.Until(dl), hasDL: ok}
}

// delistingMarketData adds the two feature-352 RPCs to stubMarketData. syncResps is served one per
// call, the last one repeating.
type delistingMarketData struct {
	stubMarketData
	syncResps []*marketdatav1.SyncWatchlistDelistingsResponse
	syncErr   error
	syncBlock bool
	syncReqs  []*marketdatav1.SyncWatchlistDelistingsRequest
	syncCalls []rpcCall
	ackErr    error
	ackReqs   []*marketdatav1.AckDelistingAlertsRequest
	ackCalls  []rpcCall
}

func (m *delistingMarketData) SyncWatchlistDelistings(ctx context.Context, req *marketdatav1.SyncWatchlistDelistingsRequest, _ ...grpc.CallOption) (*marketdatav1.SyncWatchlistDelistingsResponse, error) {
	m.syncCalls = append(m.syncCalls, recordCall(ctx))
	m.syncReqs = append(m.syncReqs, req)
	if m.syncBlock {
		<-ctx.Done()
		return nil, ctx.Err()
	}
	if m.syncErr != nil {
		return nil, m.syncErr
	}
	if len(m.syncResps) == 0 {
		return &marketdatav1.SyncWatchlistDelistingsResponse{}, nil
	}
	i := min(len(m.syncReqs), len(m.syncResps)) - 1
	return m.syncResps[i], nil
}

func (m *delistingMarketData) AckDelistingAlerts(ctx context.Context, req *marketdatav1.AckDelistingAlertsRequest, _ ...grpc.CallOption) (*marketdatav1.AckDelistingAlertsResponse, error) {
	m.ackCalls = append(m.ackCalls, recordCall(ctx))
	m.ackReqs = append(m.ackReqs, req)
	if m.ackErr != nil {
		return nil, m.ackErr
	}
	return &marketdatav1.AckDelistingAlertsResponse{}, nil
}

// delistingNotify records each send at call entry; failAt = n fails the n-th send (1-based).
type delistingNotify struct {
	recordingNotify
	failAt int
	calls  []rpcCall
}

func (n *delistingNotify) EmitAlert(ctx context.Context, in *notifyv1.EmitAlertRequest, opts ...grpc.CallOption) (*notifyv1.EmitAlertResponse, error) {
	n.calls = append(n.calls, recordCall(ctx))
	if n.failAt == len(n.calls) {
		return nil, errors.New("notify down")
	}
	return n.recordingNotify.EmitAlert(ctx, in, opts...)
}

func flaggedSymbol(symbol string, state marketdatav1.DelistingAlertState, unservable bool) *marketdatav1.FlaggedSymbol {
	return &marketdatav1.FlaggedSymbol{
		Symbol: symbol,
		State: &commonv1.DelistedState{
			Reason:              commonv1.UnservableReason_UNSERVABLE_REASON_NOT_TRADABLE,
			FirstUnservableDate: delistedDate,
		},
		AlertState:             state,
		UnservableInCurrentSet: unservable,
	}
}

func syncResp(flagged ...*marketdatav1.FlaggedSymbol) *marketdatav1.SyncWatchlistDelistingsResponse {
	return &marketdatav1.SyncWatchlistDelistingsResponse{Flagged: flagged}
}

type delistingHarness struct {
	svc    *PortfolioService
	store  *fakeWatchlistStore
	md     *delistingMarketData
	notify *delistingNotify
	ledger *fakeLedger
}

func newDelistingHarness(resps ...*marketdatav1.SyncWatchlistDelistingsResponse) *delistingHarness {
	h := &delistingHarness{
		store:  newFakeStore(),
		md:     &delistingMarketData{syncResps: resps},
		notify: &delistingNotify{},
		ledger: &fakeLedger{},
	}
	h.svc = newSvc(h.store, &fakeConfig{vals: map[string]int64{}}, h.ledger)
	h.svc.marketdata = h.md
	h.svc.notify = h.notify
	return h
}

func (h *delistingHarness) tick() { h.svc.pruneOnce(context.Background()) }

func (h *delistingHarness) cached(symbol string) bool {
	h.svc.delisted.mu.RLock()
	defer h.svc.delisted.mu.RUnlock()
	_, ok := h.svc.delisted.m[symbol]
	return ok
}

func signalsRemoval(removed ...string) repository.DelistedRemoval {
	return repository.DelistedRemoval{WatchlistID: "wl-sig", UserID: "user-1", Name: "Signals", Removed: removed}
}

// @AC-6
func TestDelisting_AC6_ClaimedUnservableSymbolIsRemoved(t *testing.T) {
	h := newDelistingHarness(syncResp(flaggedSymbol("KPTI", alertClaimed, true)))
	h.store.allSymbols = []string{"AAPL", "KPTI"}
	h.tick()

	if !reflect.DeepEqual(h.store.delistedCalls, [][]string{{"KPTI"}}) {
		t.Fatalf("store asked to remove %v, want [[KPTI]] (servable AAPL never passed)", h.store.delistedCalls)
	}
	if got := h.md.syncReqs[0].GetSymbols(); !reflect.DeepEqual(got, []string{"AAPL", "KPTI"}) {
		t.Fatalf("sync request symbols = %v, want the unfiltered union", got)
	}
}

// @AC-17
func TestDelisting_AC17_OneWarningAlertThenAcknowledged(t *testing.T) {
	h := newDelistingHarness(
		syncResp(flaggedSymbol("KPTI", alertClaimed, true)),
		syncResp(flaggedSymbol("KPTI", alertReported, true)),
	)
	h.store.delistedResult = []repository.DelistedRemoval{signalsRemoval("KPTI")}
	h.tick()

	if len(h.notify.reqs) != 1 {
		t.Fatalf("alerts = %d, want exactly 1", len(h.notify.reqs))
	}
	a := h.notify.reqs[0]
	if a.GetSeverity() != notifyv1.AlertSeverity_ALERT_SEVERITY_WARNING || a.GetCategory() != "symbol_delisting" ||
		a.GetTargetUserId() != "" || a.GetSourceService() != "portfolio" {
		t.Fatalf("alert = %+v, want an untargeted symbol_delisting WARNING from portfolio", a)
	}
	for _, want := range []string{"KPTI", "UNSERVABLE_REASON_NOT_TRADABLE", "Signals", delistedDate} {
		if !strings.Contains(a.GetBody(), want) {
			t.Fatalf("alert body %q does not name %q", a.GetBody(), want)
		}
	}
	if len(h.md.ackReqs) != 1 || !reflect.DeepEqual(h.md.ackReqs[0].GetSymbols(), []string{"KPTI"}) {
		t.Fatalf("acknowledgements = %v, want one with [KPTI]", h.md.ackReqs)
	}

	h.store.delistedResult = nil
	h.tick()
	if len(h.notify.reqs) != 1 || len(h.md.ackReqs) != 1 {
		t.Fatalf("REPORTED tick: alerts = %d acks = %d, want no further alert or acknowledgement",
			len(h.notify.reqs), len(h.md.ackReqs))
	}
}

// @AC-18
func TestDelisting_AC18_OneAlertPerSymbolOneAcknowledgement(t *testing.T) {
	h := newDelistingHarness(syncResp(
		flaggedSymbol("ROKU", alertClaimed, true), flaggedSymbol("KPTI", alertClaimed, true)))
	h.tick()

	if len(h.notify.bodies) != 2 || !strings.Contains(h.notify.bodies[0], "KPTI") || !strings.Contains(h.notify.bodies[1], "ROKU") {
		t.Fatalf("alert bodies = %q, want one for KPTI then one for ROKU", h.notify.bodies)
	}
	if strings.Contains(h.notify.bodies[0], "ROKU") || strings.Contains(h.notify.bodies[1], "KPTI") {
		t.Fatalf("alert bodies = %q, want each naming only its own symbol", h.notify.bodies)
	}
	if len(h.md.ackReqs) != 1 || !reflect.DeepEqual(h.md.ackReqs[0].GetSymbols(), []string{"KPTI", "ROKU"}) {
		t.Fatalf("acknowledgements = %v, want one with [KPTI ROKU]", h.md.ackReqs)
	}
}

// @AC-22
func TestDelisting_AC22_RemovalWritesNoLedgerEvent(t *testing.T) {
	h := newDelistingHarness(syncResp(flaggedSymbol("KPTI", alertClaimed, true)))
	h.store.delistedResult = []repository.DelistedRemoval{signalsRemoval("KPTI")}
	h.tick()

	if len(h.ledger.reqs) != 0 {
		t.Fatalf("ledger events = %d, want 0", len(h.ledger.reqs))
	}
	if len(h.notify.reqs) != 1 {
		t.Fatalf("alerts = %d, want 1", len(h.notify.reqs))
	}
}

// @AC-5
func TestDelisting_AC5_RecoveredSymbolIsNotRemovedAgainNorReAdded(t *testing.T) {
	h := newDelistingHarness(syncResp(flaggedSymbol("ATCH", alertClaimed, true)), syncResp())
	h.tick()
	if !reflect.DeepEqual(h.store.delistedCalls, [][]string{{"ATCH"}}) {
		t.Fatalf("tick 1: store asked to remove %v, want [[ATCH]]", h.store.delistedCalls)
	}
	if !h.cached("ATCH") {
		t.Fatal("tick 1: cache does not hold ATCH")
	}

	h.tick()
	if len(h.store.delistedCalls) != 2 || len(h.store.delistedCalls[1]) != 0 {
		t.Fatalf("tick 2: removal calls = %v, want an empty second set", h.store.delistedCalls)
	}
	if h.store.addSymbolsCnt != 0 {
		t.Fatalf("AddSymbols calls = %d, want 0 (a recovered symbol is never re-added)", h.store.addSymbolsCnt)
	}
	if h.cached("ATCH") {
		t.Fatal("tick 2: cache still holds ATCH")
	}
}

func TestDelisting_RemovalSetByAlertState(t *testing.T) {
	h := newDelistingHarness(syncResp(
		flaggedSymbol("PEND", alertPending, true),
		flaggedSymbol("BACK", alertReported, false),
		flaggedSymbol("GONE", alertReported, true),
		flaggedSymbol("UNSP", marketdatav1.DelistingAlertState_DELISTING_ALERT_STATE_UNSPECIFIED, true),
	))
	h.store.delistedResult = []repository.DelistedRemoval{signalsRemoval("GONE")}
	h.tick()

	if !reflect.DeepEqual(h.store.delistedCalls, [][]string{{"GONE"}}) {
		t.Fatalf("store asked to remove %v, want only the REPORTED and unservable GONE", h.store.delistedCalls)
	}
	if len(h.notify.reqs) != 0 || len(h.md.ackReqs) != 0 {
		t.Fatalf("alerts = %d acks = %d, want none", len(h.notify.reqs), len(h.md.ackReqs))
	}
	for _, sym := range []string{"PEND", "BACK", "GONE", "UNSP"} {
		if !h.cached(sym) {
			t.Fatalf("cache does not hold %s; every response entry is cached whatever its alert state", sym)
		}
	}
}

func TestDelisting_AlertBodies(t *testing.T) {
	removals := []repository.DelistedRemoval{
		{WatchlistID: "wl-a", Name: "Signals", Removed: []string{"KPTI"}},
		{WatchlistID: "wl-b", Name: "Signals B", Left: []string{"KPTI"}, Skipped: true},
		{WatchlistID: "wl-c", Name: "Signals C", Removed: []string{"KPTI"}, Left: []string{"OTHR"}, Skipped: true},
	}
	h := newDelistingHarness(syncResp(
		flaggedSymbol("KPTI", alertClaimed, true),
		flaggedSymbol("NONE", alertClaimed, true),
		flaggedSymbol("REDO", alertRedelivery, true),
		flaggedSymbol("ROKU", alertRedelivery, true),
	))
	h.store.delistedResult = append(removals, repository.DelistedRemoval{WatchlistID: "wl-d", Name: "Signals D", Removed: []string{"ROKU"}})
	h.tick()

	if len(h.notify.bodies) != 4 {
		t.Fatalf("alerts = %d, want 4", len(h.notify.bodies))
	}
	kpti, none, redo, roku := h.notify.bodies[0], h.notify.bodies[1], h.notify.bodies[2], h.notify.bodies[3]
	if !strings.Contains(kpti, "Removed from 2 system-managed") || !strings.Contains(kpti, "Signals, Signals C") {
		t.Fatalf("CLAIMED body %q, want the two lists removed on this tick", kpti)
	}
	if !strings.Contains(kpti, "1 more system-managed") {
		t.Fatalf("CLAIMED body %q, want exactly the one list whose Left holds KPTI counted for a later refresh", kpti)
	}
	if !strings.Contains(none, "on no system-managed watchlist") {
		t.Fatalf("CLAIMED body %q, want it to say the symbol was on no system-managed list", none)
	}
	for _, body := range []string{redo, roku} {
		if !strings.HasPrefix(body, "This may repeat an earlier alert.") {
			t.Fatalf("REDELIVERY body %q, want it to start by saying it may repeat", body)
		}
		if strings.Contains(body, "later refresh") || strings.Contains(body, "on no system-managed") {
			t.Fatalf("REDELIVERY body %q, want only this tick's lists", body)
		}
	}
	if strings.Contains(redo, "Removed from") {
		t.Fatalf("REDELIVERY body %q names lists although none was removed on this tick", redo)
	}
	if !strings.Contains(roku, "Removed from 1 system-managed") || !strings.Contains(roku, "Signals D") {
		t.Fatalf("REDELIVERY body %q, want this tick's list", roku)
	}
}

func TestDelisting_SyncFailureKeepsCacheAndRemovesNothing(t *testing.T) {
	cases := []struct {
		name    string
		fail    func(*delistingMarketData)
		ctx     func() (context.Context, context.CancelFunc)
		outcome string
	}{
		{"error", func(m *delistingMarketData) { m.syncErr = errors.New("boom") }, nil, "error"},
		{"unimplemented", func(m *delistingMarketData) { m.syncErr = status.Error(codes.Unimplemented, "old marketdata") }, nil, "error"},
		{"timeout", func(m *delistingMarketData) { m.syncBlock = true },
			func() (context.Context, context.CancelFunc) {
				return context.WithTimeout(context.Background(), 20*time.Millisecond)
			}, "timeout"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			reader := installMetricReader(t)
			h := newDelistingHarness(syncResp(flaggedSymbol("KPTI", alertReported, true)))
			h.tick()
			tc.fail(h.md)
			ctx := context.Background()
			if tc.ctx != nil {
				var cancel context.CancelFunc
				ctx, cancel = tc.ctx()
				defer cancel()
			}
			h.svc.pruneOnce(ctx)

			if len(h.store.delistedCalls) != 1 {
				t.Fatalf("removal calls = %d, want only the first tick's", len(h.store.delistedCalls))
			}
			if len(h.notify.reqs) != 0 || len(h.md.ackReqs) != 0 {
				t.Fatalf("alerts = %d acks = %d, want none", len(h.notify.reqs), len(h.md.ackReqs))
			}
			if !h.cached("KPTI") {
				t.Fatal("the previous tick's cache was dropped")
			}
			if got := counterValue(t, reader, "portfolio.marketdata_fetch",
				attr(telemetry.KeyOp, "delistings"), attr(telemetry.KeyOutcome, tc.outcome)); got != 1 {
				t.Fatalf("portfolio.marketdata_fetch{op=delistings,outcome=%s} = %d, want 1", tc.outcome, got)
			}
		})
	}
}

func TestDelisting_UnionErrorSendsNoRPC(t *testing.T) {
	h := newDelistingHarness(syncResp(flaggedSymbol("KPTI", alertClaimed, true)))
	h.store.allSymbolsErr = errors.New("db down")
	h.tick()
	if len(h.md.syncReqs) != 0 || len(h.store.delistedCalls) != 0 {
		t.Fatalf("sync calls = %d removal calls = %d, want none", len(h.md.syncReqs), len(h.store.delistedCalls))
	}
}

func TestDelisting_AlertFailureStopsAndAcknowledgesOnlyWhatWasSent(t *testing.T) {
	three := syncResp(flaggedSymbol("AAA", alertClaimed, true), flaggedSymbol("BBB", alertClaimed, true), flaggedSymbol("CCC", alertClaimed, true))

	t.Run("first send fails", func(t *testing.T) {
		h := newDelistingHarness(three)
		h.notify.failAt = 1
		h.tick()
		if len(h.notify.calls) != 1 || len(h.md.ackReqs) != 0 {
			t.Fatalf("sends = %d acks = %d, want 1 attempted send and no acknowledgement", len(h.notify.calls), len(h.md.ackReqs))
		}
	})
	t.Run("second of three fails", func(t *testing.T) {
		h := newDelistingHarness(three)
		h.notify.failAt = 2
		h.tick()
		if len(h.notify.calls) != 2 {
			t.Fatalf("sends = %d, want 2 (no send after the failure)", len(h.notify.calls))
		}
		if len(h.md.ackReqs) != 1 || !reflect.DeepEqual(h.md.ackReqs[0].GetSymbols(), []string{"AAA"}) {
			t.Fatalf("acknowledgements = %v, want one with [AAA]", h.md.ackReqs)
		}
	})
}

func TestDelisting_AcknowledgementErrorDoesNotPanic(t *testing.T) {
	h := newDelistingHarness(syncResp(flaggedSymbol("KPTI", alertClaimed, true)))
	h.md.ackErr = errors.New("ack down")
	h.tick()
	if len(h.notify.reqs) != 1 || len(h.md.ackReqs) != 1 {
		t.Fatalf("alerts = %d ack attempts = %d, want 1 and 1", len(h.notify.reqs), len(h.md.ackReqs))
	}
}

func TestDelisting_CallerHeadersAndDeadlines(t *testing.T) {
	h := newDelistingHarness(syncResp(flaggedSymbol("KPTI", alertClaimed, true)))
	h.tick()
	if len(h.md.syncCalls) != 1 || len(h.md.ackCalls) != 1 || len(h.notify.calls) != 1 {
		t.Fatalf("sync = %d ack = %d sends = %d, want one each", len(h.md.syncCalls), len(h.md.ackCalls), len(h.notify.calls))
	}
	for name, c := range map[string]rpcCall{"sync": h.md.syncCalls[0], "ack": h.md.ackCalls[0]} {
		if got := c.md.Get(HeaderInternalCaller); !reflect.DeepEqual(got, []string{"portfolio"}) {
			t.Fatalf("%s x-internal-caller = %v, want [portfolio]", name, got)
		}
		if tr := c.md.Get("x-trace-id"); len(tr) != 1 || tr[0] == "" {
			t.Fatalf("%s x-trace-id = %v, want one non-empty value", name, tr)
		}
		if u := c.md.Get("x-user-id"); len(u) != 0 {
			t.Fatalf("%s x-user-id = %v, want none", name, u)
		}
	}
	for name, c := range map[string]rpcCall{"sync": h.md.syncCalls[0], "ack": h.md.ackCalls[0], "alert": h.notify.calls[0]} {
		if !c.hasDL || c.remaining > 15*time.Second || c.remaining <= 0 {
			t.Fatalf("%s deadline: has=%v remaining=%v, want at most 15s after call entry", name, c.hasDL, c.remaining)
		}
	}
}

func TestDelisting_RunsWhenTheExpiryPruneFailed(t *testing.T) {
	h := newDelistingHarness(syncResp(flaggedSymbol("KPTI", alertClaimed, true)))
	h.store.pruneErr = errors.New("prune failed")
	h.tick()
	if !reflect.DeepEqual(h.store.delistedCalls, [][]string{{"KPTI"}}) {
		t.Fatalf("store asked to remove %v, want [[KPTI]] despite the prune error", h.store.delistedCalls)
	}
}

func TestDelisting_RemovalErrorStillAlertsWithReturnedRemovals(t *testing.T) {
	h := newDelistingHarness(syncResp(flaggedSymbol("KPTI", alertClaimed, true)))
	h.store.delistedResult = []repository.DelistedRemoval{signalsRemoval("KPTI")}
	h.store.delistedErr = errors.New("one list failed")
	h.tick()
	if len(h.notify.bodies) != 1 || !strings.Contains(h.notify.bodies[0], "Signals") {
		t.Fatalf("alert bodies = %q, want one naming the committed list", h.notify.bodies)
	}
}

func TestDelisting_NilMarketdataIsNoop(t *testing.T) {
	h := newDelistingHarness()
	h.svc.marketdata = nil
	h.store.allSymbolsErr = errors.New("must not be read")
	h.tick()
	if len(h.store.delistedCalls) != 0 || len(h.notify.reqs) != 0 {
		t.Fatalf("removal calls = %d alerts = %d, want none", len(h.store.delistedCalls), len(h.notify.reqs))
	}
}

func TestDelisting_NilNotifyStillRemoves(t *testing.T) {
	h := newDelistingHarness(syncResp(flaggedSymbol("KPTI", alertClaimed, true)))
	h.svc.notify = nil
	h.tick()
	if !reflect.DeepEqual(h.store.delistedCalls, [][]string{{"KPTI"}}) {
		t.Fatalf("store asked to remove %v, want [[KPTI]]", h.store.delistedCalls)
	}
	if len(h.md.ackReqs) != 0 {
		t.Fatalf("acknowledgements = %d, want none without a notify client", len(h.md.ackReqs))
	}
}
