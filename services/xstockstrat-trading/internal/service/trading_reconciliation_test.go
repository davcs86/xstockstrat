package service

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	grpcstatus "google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	configv1 "github.com/xstockstrat/contracts/gen/go/config/v1"
	ledgerv1 "github.com/xstockstrat/contracts/gen/go/ledger/v1"
	notifyv1 "github.com/xstockstrat/contracts/gen/go/notify/v1"
	portfoliov1 "github.com/xstockstrat/contracts/gen/go/portfolio/v1"
	tradingv1 "github.com/xstockstrat/contracts/gen/go/trading/v1"
	"github.com/xstockstrat/trading/internal/broker"
	"github.com/xstockstrat/trading/internal/config"
	"github.com/xstockstrat/trading/internal/repository"
	"github.com/xstockstrat/trading/internal/telemetry"
	"github.com/xstockstrat/trading/internal/testdata"
)

// TestRecordToProtoAccount_MapsHaltFields proves recordToProtoAccount (feature 030) now also
// maps the halt_source discriminator this feature (102) added.
func TestRecordToProtoAccount_MapsHaltFields(t *testing.T) {
	haltedAt := time.Date(2026, 8, 7, 12, 0, 0, 0, time.UTC)
	rec := &repository.BrokerAccountRecord{
		ID:         "acct-1",
		Halted:     true,
		HaltReason: "reconciliation mismatch",
		HaltSource: 2, // HALT_SOURCE_RECONCILIATION
		HaltedAt:   &haltedAt,
	}

	acct := recordToProtoAccount(rec)

	if !acct.Halted {
		t.Error("expected Halted = true")
	}
	if acct.HaltReason != "reconciliation mismatch" {
		t.Errorf("HaltReason = %q, want %q", acct.HaltReason, "reconciliation mismatch")
	}
	if acct.HaltSource != tradingv1.HaltSource_HALT_SOURCE_RECONCILIATION {
		t.Errorf("HaltSource = %v, want HALT_SOURCE_RECONCILIATION", acct.HaltSource)
	}
	if acct.HaltedAt == nil || !acct.HaltedAt.AsTime().Equal(haltedAt) {
		t.Errorf("HaltedAt = %v, want %v", acct.HaltedAt, haltedAt)
	}
}

// TestRecordToProtoAccount_UnhaltedLeavesHaltSourceUnspecified proves an unhalted record maps
// to the zero-value enum and a nil HaltedAt — never a fabricated zero-value Timestamp.
func TestRecordToProtoAccount_UnhaltedLeavesHaltSourceUnspecified(t *testing.T) {
	rec := &repository.BrokerAccountRecord{
		ID:         "acct-2",
		Halted:     false,
		HaltSource: 0,
	}

	acct := recordToProtoAccount(rec)

	if acct.Halted {
		t.Error("expected Halted = false")
	}
	if acct.HaltSource != tradingv1.HaltSource_HALT_SOURCE_UNSPECIFIED {
		t.Errorf("HaltSource = %v, want HALT_SOURCE_UNSPECIFIED", acct.HaltSource)
	}
	if acct.HaltedAt != nil {
		t.Errorf("HaltedAt = %v, want nil (nil-time must not convert to a zero-value Timestamp)", acct.HaltedAt)
	}
}

// ── Steps 17-18: reconcileTick classification / self-heal / ordinary halt ─────────────────

// fakeReconciliationBroker implements broker.Broker, overriding only ListOrders/GetPositions/
// IsPaper (the three this feature's poller calls) — every other method panics if called,
// mirroring fakeBroker's (030's) established convention in trading_bracket_test.go.
type fakeReconciliationBroker struct {
	listOrdersFn   func(ctx context.Context) ([]broker.BrokerOrder, error)
	getPositionsFn func(ctx context.Context) ([]broker.BrokerPosition, error)
	isPaper        bool
}

func (f *fakeReconciliationBroker) SubmitOrder(ctx context.Context, req broker.OrderRequest) (*broker.BrokerOrder, error) {
	panic("fakeReconciliationBroker.SubmitOrder not implemented")
}
func (f *fakeReconciliationBroker) CancelOrder(ctx context.Context, brokerOrderID string) error {
	panic("fakeReconciliationBroker.CancelOrder not implemented")
}
func (f *fakeReconciliationBroker) ReplaceOrder(ctx context.Context, brokerOrderID string, req broker.OrderRequest) (*broker.BrokerOrder, error) {
	panic("fakeReconciliationBroker.ReplaceOrder not implemented")
}
func (f *fakeReconciliationBroker) GetOrder(ctx context.Context, brokerOrderID string) (*broker.BrokerOrder, error) {
	panic("fakeReconciliationBroker.GetOrder not implemented")
}
func (f *fakeReconciliationBroker) SubmitBracketLegs(ctx context.Context, parentBrokerOrderID, parentClientOrderID string, legs broker.BracketLegsRequest) (*broker.BracketLegsResponse, error) {
	panic("fakeReconciliationBroker.SubmitBracketLegs not implemented")
}
func (f *fakeReconciliationBroker) ListOrders(ctx context.Context) ([]broker.BrokerOrder, error) {
	if f.listOrdersFn != nil {
		return f.listOrdersFn(ctx)
	}
	return nil, nil
}
func (f *fakeReconciliationBroker) GetPositions(ctx context.Context) ([]broker.BrokerPosition, error) {
	if f.getPositionsFn != nil {
		return f.getPositionsFn(ctx)
	}
	return nil, nil
}
func (f *fakeReconciliationBroker) GetAccount(ctx context.Context) (*broker.BrokerBalance, error) {
	panic("fakeReconciliationBroker.GetAccount not implemented")
}
func (f *fakeReconciliationBroker) IsPaper() bool                                 { return f.isPaper }
func (f *fakeReconciliationBroker) ValidateCredentials(ctx context.Context) error { return nil }

var _ broker.Broker = (*fakeReconciliationBroker)(nil)

// fakeReconciliationPortfolioClient implements portfoliov1.PortfolioServiceClient, overriding
// only ListPositions.
type fakeReconciliationPortfolioClient struct {
	portfoliov1.PortfolioServiceClient
	listPositionsFn func(ctx context.Context, req *portfoliov1.ListPositionsRequest, opts ...grpc.CallOption) (*portfoliov1.ListPositionsResponse, error)
}

func (f *fakeReconciliationPortfolioClient) ListPositions(ctx context.Context, req *portfoliov1.ListPositionsRequest, opts ...grpc.CallOption) (*portfoliov1.ListPositionsResponse, error) {
	if f.listPositionsFn != nil {
		return f.listPositionsFn(ctx, req, opts...)
	}
	return &portfoliov1.ListPositionsResponse{}, nil
}

// recordingLedgerClient captures every AppendEvent call — needed here (unlike 030's
// fakeLedgerClient, a pure no-op) because these tests assert on the emitted
// reconciliation.mismatch_found payload, not just that an emit occurred.
type recordingLedgerClient struct {
	ledgerv1.LedgerServiceClient
	mu            sync.Mutex
	events        []*ledgerv1.AppendEventRequest
	queryEventsFn func(ctx context.Context, req *ledgerv1.QueryEventsRequest) (*ledgerv1.QueryEventsResponse, error)
}

func (f *recordingLedgerClient) AppendEvent(_ context.Context, req *ledgerv1.AppendEventRequest, _ ...grpc.CallOption) (*ledgerv1.AppendEventResponse, error) {
	f.mu.Lock()
	f.events = append(f.events, req)
	f.mu.Unlock()
	return &ledgerv1.AppendEventResponse{}, nil
}

func (f *recordingLedgerClient) QueryEvents(ctx context.Context, req *ledgerv1.QueryEventsRequest, _ ...grpc.CallOption) (*ledgerv1.QueryEventsResponse, error) {
	if f.queryEventsFn != nil {
		return f.queryEventsFn(ctx, req)
	}
	return &ledgerv1.QueryEventsResponse{}, nil
}

func (f *recordingLedgerClient) eventTypes() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	types := make([]string, len(f.events))
	for i, e := range f.events {
		types[i] = e.EventType
	}
	return types
}

func newTestReconciliationService(brokers map[string]brokerPoolEntry, portfolio portfoliov1.PortfolioServiceClient, ledger ledgerv1.LedgerServiceClient, notify notifyv1.NotifyServiceClient, accountRepo repository.AccountRepository) *TradingService {
	return newTestReconciliationServiceWithIntents(brokers, portfolio, ledger, notify, accountRepo, nil)
}

// newTestReconciliationServiceWithIntents is newTestReconciliationService plus an
// orderIntentRepo — split out rather than widening every existing call site, since only
// Step 22's FR-6 tests need an order-intent repo (resolveUnknownIntents no-ops on a nil one,
// so every other reconcileTick test is unaffected either way).
func newTestReconciliationServiceWithIntents(brokers map[string]brokerPoolEntry, portfolio portfoliov1.PortfolioServiceClient, ledger ledgerv1.LedgerServiceClient, notify notifyv1.NotifyServiceClient, accountRepo repository.AccountRepository, orderIntentRepo repository.OrderIntentRepository) *TradingService {
	return &TradingService{
		cfg:                     &config.Config{},
		cfgW:                    &config.Watcher{},
		platformCfgW:            &config.Watcher{},
		brokers:                 brokers,
		portfolio:               portfolio,
		ledger:                  ledger,
		notify:                  notify,
		accountRepo:             accountRepo,
		orderIntentRepo:         orderIntentRepo,
		reconcileOrderLookup:    &fakeBrokerOrderLookup{},
		reconcilePositionLookup: &fakePositionQtyLookup{},
		orders:                  make(map[string]*tradingv1.Order),
		credStatus:              make(map[string]int32),
		halted:                  make(map[string]bool),
		haltReasons:             make(map[string]string),
		haltedLastPolled:        make(map[string]time.Time),
		reconcileCandidates:     make(map[string]int),
	}
}

// fakeBrokerOrderLookup implements brokerOrderIDLookup for reconcileTick tests. By default it
// reports NOTHING as persisted (empty known set), which is the pre-DB-grounding behavior every
// existing unknown_broker_order test relies on (an unmatched broker order is genuinely foreign).
// Tests exercising the DB-grounding set `known` (broker order IDs the platform DOES have on record,
// e.g. a legitimate order the platform placed that has since gone terminal) or `err` (to prove the
// fail-safe skip on a lookup error).
type fakeBrokerOrderLookup struct {
	known map[string]bool
	err   error
}

func (f *fakeBrokerOrderLookup) KnownBrokerOrderIDs(ctx context.Context, accountID string, brokerOrderIDs []string) (map[string]bool, error) {
	if f.err != nil {
		return nil, f.err
	}
	out := make(map[string]bool, len(brokerOrderIDs))
	for _, id := range brokerOrderIDs {
		if f.known[id] {
			out[id] = true
		}
	}
	return out, nil
}

var _ brokerOrderIDLookup = (*fakeBrokerOrderLookup)(nil)

// fakePositionQtyLookup implements positionQtyLookup for reconcileTick tests. By default it reports
// no platform fills (empty net), so a diverging broker position is treated as genuinely foreign —
// the pre-grounding behavior every existing position-side halt test relies on. Tests exercising the
// DB-grounding set `net` (the platform's own net filled qty per symbol) or `err` (fail-safe skip).
type fakePositionQtyLookup struct {
	net map[string]float64
	err error
}

func (f *fakePositionQtyLookup) NetFilledQtyBySymbol(ctx context.Context, accountID string, symbols []string) (map[string]float64, error) {
	if f.err != nil {
		return nil, f.err
	}
	out := make(map[string]float64, len(symbols))
	for _, s := range symbols {
		if v, ok := f.net[s]; ok {
			out[s] = v
		}
	}
	return out, nil
}

var _ positionQtyLookup = (*fakePositionQtyLookup)(nil)

// noopAccountRepo satisfies repository.AccountRepository for tests that don't care about the
// halt write itself (only whether haltAccount was invoked, observed via notify/ledger).
type noopAccountRepo struct {
	repository.AccountRepository
}

func (noopAccountRepo) UpdateHaltStatus(ctx context.Context, id string, halted bool, reason string, haltedAt *time.Time, haltSource int32) error {
	return nil
}

// alertByCategory returns the one recorded alert of the given category; it fails the test unless exactly one exists.
func alertByCategory(t *testing.T, notify *fakeNotifyClient, category string) *notifyv1.EmitAlertRequest {
	t.Helper()
	notify.mu.Lock()
	defer notify.mu.Unlock()
	var found []*notifyv1.EmitAlertRequest
	for _, c := range notify.calls {
		if c.Category == category {
			found = append(found, c)
		}
	}
	if len(found) != 1 {
		t.Fatalf("recorded %d %q alerts, want exactly 1 (all calls: %v)", len(found), category, notify.calls)
	}
	return found[0]
}

func TestReconcileTick_UnknownBrokerOrder_DetectedRegardlessOfFillState(t *testing.T) {
	for _, status := range []string{"filled", "new"} {
		t.Run(status, func(t *testing.T) {
			fb := &fakeReconciliationBroker{
				listOrdersFn: func(ctx context.Context) ([]broker.BrokerOrder, error) {
					return []broker.BrokerOrder{{BrokerOrderID: "bo-unknown", Status: status, FilledQty: 5}}, nil
				},
			}
			ledger := &recordingLedgerClient{}
			svc := newTestReconciliationService(
				map[string]brokerPoolEntry{"acct-1": {client: fb, userID: "u-1"}},
				&fakeReconciliationPortfolioClient{}, ledger, &fakeNotifyClient{}, noopAccountRepo{},
			)

			// graceTicks=0 → 1+0=1 observation is enough to become a real finding immediately.
			systemicCount, total := svc.reconcileTick(context.Background(), 0, 1.1)

			if total != 1 {
				t.Errorf("totalAccounts = %d, want 1", total)
			}
			if systemicCount != 0 {
				t.Errorf("systemicCount = %d, want 0 (this is an ordinary finding, not an error)", systemicCount)
			}
			found := false
			for _, e := range ledger.eventTypes() {
				if e == "reconciliation.mismatch_found" {
					found = true
				}
			}
			if !found {
				t.Errorf("expected a reconciliation.mismatch_found event for status %q, got %v", status, ledger.eventTypes())
			}
			notify := svc.notify.(*fakeNotifyClient)
			for _, category := range []string{"halt", "reconciliation"} {
				if got := alertByCategory(t, notify, category).TargetUserId; got != "u-1" {
					t.Errorf("%s alert TargetUserId = %q, want %q", category, got, "u-1")
				}
			}
		})
	}
}

// TestReconcileTick_TerminalPlatformOrder_AbsentFromMemory_NotFlaggedUnknown is the regression
// test for the observed production false halt: a legitimate order the platform itself placed that
// has since reached a terminal state (filled) and is no longer in the in-memory order map after a
// restart (LoadInflightOrders only hydrates NEW/PARTIALLY_FILLED). The broker still lists it
// (status=all), but trading.orders still has it — so the DB-grounded check must NOT flag it as
// unknown_broker_order and must NOT halt the account, no matter how many ticks observe it.
func TestReconcileTick_TerminalPlatformOrder_AbsentFromMemory_NotFlaggedUnknown(t *testing.T) {
	fb := &fakeReconciliationBroker{
		listOrdersFn: func(ctx context.Context) ([]broker.BrokerOrder, error) {
			return []broker.BrokerOrder{{BrokerOrderID: "bo-platform-terminal", Status: "filled", FilledQty: 10}}, nil
		},
	}
	ledger := &recordingLedgerClient{}
	notify := &fakeNotifyClient{}
	svc := newTestReconciliationService(
		map[string]brokerPoolEntry{"acct-1": {client: fb, userID: "u-1"}},
		&fakeReconciliationPortfolioClient{}, ledger, notify, noopAccountRepo{},
	)
	// The platform has this order on record in trading.orders — it is simply absent from the
	// in-memory map. This is exactly the distinction the DB lookup adds.
	svc.reconcileOrderLookup = &fakeBrokerOrderLookup{known: map[string]bool{"bo-platform-terminal": true}}

	// graceTicks=0 → any real finding would fire immediately; run several ticks to prove it never does.
	for i := 0; i < 3; i++ {
		svc.reconcileTick(context.Background(), 0, 1.1)
	}

	if svc.isAccountHalted("acct-1") {
		t.Fatal("account must NOT be halted for a platform-placed order the DB still knows about (the false-halt regression)")
	}
	for _, e := range ledger.eventTypes() {
		if e == "reconciliation.mismatch_found" {
			t.Fatalf("no reconciliation.mismatch_found expected for a DB-known order, got %v", ledger.eventTypes())
		}
	}
	notify.mu.Lock()
	alertCount := len(notify.calls)
	notify.mu.Unlock()
	if alertCount != 0 {
		t.Errorf("EmitAlert called %d times, want 0 (no false-halt/finding alert)", alertCount)
	}
}

// TestReconcileTick_UnknownOrderLookupError_SkipsClassification proves the fail-safe: a DB lookup
// error must never cause a false unknown_broker_order halt. The unknown-order classification is
// skipped for the account this tick (and re-evaluated next tick), so no finding and no halt.
func TestReconcileTick_UnknownOrderLookupError_SkipsClassification(t *testing.T) {
	fb := &fakeReconciliationBroker{
		listOrdersFn: func(ctx context.Context) ([]broker.BrokerOrder, error) {
			return []broker.BrokerOrder{{BrokerOrderID: "bo-unknown", Status: "filled", FilledQty: 5}}, nil
		},
	}
	ledger := &recordingLedgerClient{}
	notify := &fakeNotifyClient{}
	svc := newTestReconciliationService(
		map[string]brokerPoolEntry{"acct-1": {client: fb, userID: "u-1"}},
		&fakeReconciliationPortfolioClient{}, ledger, notify, noopAccountRepo{},
	)
	svc.reconcileOrderLookup = &fakeBrokerOrderLookup{err: errors.New("db unavailable")}

	svc.reconcileTick(context.Background(), 0, 1.1)

	if svc.isAccountHalted("acct-1") {
		t.Fatal("a DB lookup error must not halt the account (fail-safe skip)")
	}
	for _, e := range ledger.eventTypes() {
		if e == "reconciliation.mismatch_found" {
			t.Fatalf("no finding expected when the lookup errors, got %v", ledger.eventTypes())
		}
	}
}

// TestReconcileTick_UnknownBrokerOrder_AlreadyHaltedAccount_DoesNotRefire is a regression test
// for the observed production bug: a broker order the platform can never learn about (see
// LoadInflightOrders, which only hydrates NEW/PARTIALLY_FILLED orders) keeps showing up in every
// ListOrders call, so with no dedup, every tick re-emitted a ledger event, a CRITICAL alert, and
// an ERROR "account halted" log for an account already halted from the previous tick — forever.
// After the first tick halts the account, later ticks observing the exact same unknown order
// must be no-ops.
func TestReconcileTick_UnknownBrokerOrder_AlreadyHaltedAccount_DoesNotRefire(t *testing.T) {
	fb := &fakeReconciliationBroker{
		listOrdersFn: func(ctx context.Context) ([]broker.BrokerOrder, error) {
			// Same broker order ID every tick — mirrors a pre-existing order the platform's
			// in-memory state never learns about.
			return []broker.BrokerOrder{{BrokerOrderID: "bo-perpetually-unknown", Status: "filled", FilledQty: 5}}, nil
		},
	}
	ledger := &recordingLedgerClient{}
	notify := &fakeNotifyClient{}
	svc := newTestReconciliationService(
		map[string]brokerPoolEntry{"acct-1": {client: fb, userID: "u-1"}},
		&fakeReconciliationPortfolioClient{}, ledger, notify, noopAccountRepo{},
	)

	// graceTicks=0 → every tick's first observation is immediately a real finding.
	for i := 0; i < 3; i++ {
		svc.reconcileTick(context.Background(), 0, 1.1)
	}

	if !svc.isAccountHalted("acct-1") {
		t.Fatal("expected the account to be halted after the first tick")
	}
	mismatchCount := 0
	for _, e := range ledger.eventTypes() {
		if e == "reconciliation.mismatch_found" {
			mismatchCount++
		}
	}
	if mismatchCount != 1 {
		t.Errorf("reconciliation.mismatch_found emitted %d times across 3 ticks, want exactly 1 (no re-fire for an already-halted account)", mismatchCount)
	}
	notify.mu.Lock()
	alertCount := len(notify.calls)
	notify.mu.Unlock()
	// The first tick's halt legitimately fires two distinct alerts — haltAccount's own
	// "Account halted" CRITICAL alert, plus emitReconciliationFinding's "Broker state
	// mismatch" CRITICAL alert — but neither must repeat on the 2nd/3rd tick.
	if alertCount != 2 {
		t.Errorf("EmitAlert called %d times across 3 ticks, want exactly 2 (both from the first tick only)", alertCount)
	}
}

// TestReconcileTick_HaltedAccount_SkipsListOrdersWithinCooldown proves reconcileTick itself
// (not just the finding/alert layer) stops calling the broker for an already-halted account
// once shouldPollHaltedAccount's cooldown is active — the default
// trading.reconciliation.halted_poll_interval_ms (5 min) means the 2nd tick, run immediately
// after the 1st halts the account, must not poll again.
func TestReconcileTick_HaltedAccount_SkipsListOrdersWithinCooldown(t *testing.T) {
	var listOrdersCalls int
	fb := &fakeReconciliationBroker{
		listOrdersFn: func(ctx context.Context) ([]broker.BrokerOrder, error) {
			listOrdersCalls++
			return []broker.BrokerOrder{{BrokerOrderID: "bo-unknown", Status: "filled", FilledQty: 5}}, nil
		},
	}
	svc := newTestReconciliationService(
		map[string]brokerPoolEntry{"acct-1": {client: fb, userID: "u-1"}},
		&fakeReconciliationPortfolioClient{}, &recordingLedgerClient{}, &fakeNotifyClient{}, noopAccountRepo{},
	)

	svc.reconcileTick(context.Background(), 0, 1.1) // halts the account
	svc.reconcileTick(context.Background(), 0, 1.1) // run immediately after — still in cooldown

	if !svc.isAccountHalted("acct-1") {
		t.Fatal("expected the account to be halted after the first tick")
	}
	if listOrdersCalls != 1 {
		t.Errorf("ListOrders called %d times across 2 ticks, want exactly 1 (2nd tick must skip a halted account within the cooldown)", listOrdersCalls)
	}
}

// TestReconcileTick_HaltedAccount_PollsAgainAfterCooldownElapses proves the cooldown is a
// throttle, not a permanent stop — once halted_poll_interval_ms has elapsed, the poller must
// resume observing the account (e.g. to eventually notice a manual broker-dashboard order).
func TestReconcileTick_HaltedAccount_PollsAgainAfterCooldownElapses(t *testing.T) {
	var listOrdersCalls int
	fb := &fakeReconciliationBroker{
		listOrdersFn: func(ctx context.Context) ([]broker.BrokerOrder, error) {
			listOrdersCalls++
			return []broker.BrokerOrder{{BrokerOrderID: "bo-unknown", Status: "filled", FilledQty: 5}}, nil
		},
	}
	svc := newTestReconciliationService(
		map[string]brokerPoolEntry{"acct-1": {client: fb, userID: "u-1"}},
		&fakeReconciliationPortfolioClient{}, &recordingLedgerClient{}, &fakeNotifyClient{}, noopAccountRepo{},
	)

	svc.reconcileTick(context.Background(), 0, 1.1) // halts the account, 1st poll
	if listOrdersCalls != 1 {
		t.Fatalf("ListOrders called %d times after the halting tick, want 1", listOrdersCalls)
	}

	// Backdate the last-polled timestamp past the default 300000ms (5 min) cooldown —
	// simulates real time elapsing without a real sleep in the test.
	svc.haltedMu.Lock()
	svc.haltedLastPolled["acct-1"] = time.Now().Add(-6 * time.Minute)
	svc.haltedMu.Unlock()

	svc.reconcileTick(context.Background(), 0, 1.1)

	if listOrdersCalls != 2 {
		t.Errorf("ListOrders called %d times after the cooldown elapsed, want 2 (poller must resume)", listOrdersCalls)
	}
}

// TestShouldPollHaltedAccount_ThrottlesAndRecovers unit-tests the throttle helper directly,
// including the intervalMs<=0 "always poll" edge case (mirrors interval_ms's own convention
// elsewhere in this poller) that reconcileTick's use of the live-read default can't easily
// exercise (config.Watcher has no exported snapshot setter to inject 0 through).
func TestShouldPollHaltedAccount_ThrottlesAndRecovers(t *testing.T) {
	svc := &TradingService{halted: map[string]bool{}, haltedLastPolled: map[string]time.Time{}}

	if !svc.shouldPollHaltedAccount("acct-1", 300000) {
		t.Error("expected the first observation to poll")
	}
	if svc.shouldPollHaltedAccount("acct-1", 300000) {
		t.Error("expected an immediate re-check to be throttled")
	}

	svc.haltedMu.Lock()
	svc.haltedLastPolled["acct-1"] = time.Now().Add(-time.Hour)
	svc.haltedMu.Unlock()
	if !svc.shouldPollHaltedAccount("acct-1", 300000) {
		t.Error("expected a poll once the interval has elapsed")
	}

	if !svc.shouldPollHaltedAccount("acct-2", 0) {
		t.Error("expected intervalMs<=0 to always poll (1st call)")
	}
	if !svc.shouldPollHaltedAccount("acct-2", 0) {
		t.Error("expected intervalMs<=0 to always poll (2nd call, no throttling)")
	}
}

// TestHaltedAndAdoptionThrottles_Independent: an adoption list does not consume the halted
// reconcile slot, and a reconcile poll does not consume the adoption slot (feature 311, R-40).
func TestHaltedAndAdoptionThrottles_Independent(t *testing.T) {
	for _, order := range []string{"adoption first", "reconcile first"} {
		t.Run(order, func(t *testing.T) {
			var listOrdersCalls int
			fb := &fakeReconciliationBroker{listOrdersFn: func(ctx context.Context) ([]broker.BrokerOrder, error) {
				listOrdersCalls++
				return []broker.BrokerOrder{}, nil
			}}
			svc := newTestReconciliationService(
				map[string]brokerPoolEntry{adoptAcct: {client: fb, brokerType: ibkrType, userID: legUser}},
				&fakeReconciliationPortfolioClient{}, &recordingLedgerClient{}, &fakeNotifyClient{}, noopAccountRepo{},
			)
			repo := &fakeBracketRepo{}
			seedCandidate(repo, adoptAcct, "ord-1", bracketStatusActive, "leg-s1")
			svc.bracketRepo = repo
			svc.halted[adoptAcct] = true
			clk := &adoptClock{t: time.Now()}
			svc.now = clk.now

			adopt := func() { svc.pollFills(context.Background()) }
			reconcile := func() { svc.reconcileTick(context.Background(), 0, 1.1) }
			first, second := adopt, reconcile
			if order == "reconcile first" {
				first, second = reconcile, adopt
			}
			first()
			second()

			if listOrdersCalls != 2 {
				t.Errorf("ListOrders = %d, want 2 (each throttle allows its own first poll)", listOrdersCalls)
			}
		})
	}
}

func TestReconcileTick_PartialFillWithinGraceWindow_NoFindingNoHalt(t *testing.T) {
	svc := newTestReconciliationService(
		map[string]brokerPoolEntry{"acct-1": {client: &fakeReconciliationBroker{
			listOrdersFn: func(ctx context.Context) ([]broker.BrokerOrder, error) {
				return []broker.BrokerOrder{{BrokerOrderID: "bo-1", Status: "partially_filled", FilledQty: 5}}, nil
			},
		}, userID: "u-1"}},
		&fakeReconciliationPortfolioClient{}, &recordingLedgerClient{}, &fakeNotifyClient{}, noopAccountRepo{},
	)
	svc.orders["order-1"] = &tradingv1.Order{
		OrderId: "order-1", AccountId: "acct-1", BrokerOrderId: "bo-1",
		Status: tradingv1.OrderStatus_ORDER_STATUS_PARTIALLY_FILLED, Qty: 10, FilledQty: 3,
	}

	ledger := svc.ledger.(*recordingLedgerClient)
	notify := svc.notify.(*fakeNotifyClient)

	// graceTicks=1 → needs 2 observations; this is the first, so it must not fire yet.
	svc.reconcileTick(context.Background(), 1, 1.1)

	if len(ledger.eventTypes()) != 0 {
		t.Errorf("expected zero ledger emits within the grace window, got %v", ledger.eventTypes())
	}
	if len(notify.calls) != 0 {
		t.Errorf("expected zero alerts within the grace window, got %d", len(notify.calls))
	}
	if svc.isAccountHalted("acct-1") {
		t.Error("expected the account to remain unhalted within the grace window")
	}
}

func TestReconcileTick_QuantityDiscrepancy_PastGraceWindow_HaltsAndEmits(t *testing.T) {
	notify := &fakeNotifyClient{}
	svc := newTestReconciliationService(
		map[string]brokerPoolEntry{"acct-1": {client: &fakeReconciliationBroker{
			listOrdersFn: func(ctx context.Context) ([]broker.BrokerOrder, error) {
				return []broker.BrokerOrder{{BrokerOrderID: "bo-1", Status: "partially_filled", FilledQty: 5}}, nil
			},
		}, userID: "u-1"}},
		&fakeReconciliationPortfolioClient{}, &recordingLedgerClient{}, notify, noopAccountRepo{},
	)
	svc.orders["order-1"] = &tradingv1.Order{
		OrderId: "order-1", AccountId: "acct-1", BrokerOrderId: "bo-1",
		Status: tradingv1.OrderStatus_ORDER_STATUS_PARTIALLY_FILLED, Qty: 10, FilledQty: 3,
	}

	// 1 + graceTicks(1) = 2 consecutive observations of the same disagreement.
	svc.reconcileTick(context.Background(), 1, 1.1)
	svc.reconcileTick(context.Background(), 1, 1.1)

	ledger := svc.ledger.(*recordingLedgerClient)
	foundMismatch := false
	for _, e := range ledger.events {
		if e.EventType == "reconciliation.mismatch_found" {
			foundMismatch = true
			cls := e.Payload.Fields["mismatch_class"].GetStringValue()
			if cls != mismatchClassQuantityDiscrepancy {
				t.Errorf("mismatch_class = %q, want %q", cls, mismatchClassQuantityDiscrepancy)
			}
		}
	}
	if !foundMismatch {
		t.Fatalf("expected a reconciliation.mismatch_found event, got %v", ledger.eventTypes())
	}
	if !svc.isAccountHalted("acct-1") {
		t.Error("expected the account to be halted after the grace window passed")
	}
	assertOwnerTargetedFindingAlerts(t, notify, "u-1")
}

// assertOwnerTargetedFindingAlerts pins the accepted double push: exactly the halt and the
// reconciliation alert, both CRITICAL and both targeted at owner.
func assertOwnerTargetedFindingAlerts(t *testing.T, notify *fakeNotifyClient, owner string) {
	t.Helper()
	notify.mu.Lock()
	n := len(notify.calls)
	notify.mu.Unlock()
	if n != 2 {
		t.Fatalf("EmitAlert called %d times, want 2 (halt + reconciliation)", n)
	}
	for _, category := range []string{"halt", "reconciliation"} {
		a := alertByCategory(t, notify, category)
		if a.Severity != notifyv1.AlertSeverity_ALERT_SEVERITY_CRITICAL {
			t.Errorf("%s alert severity = %v, want CRITICAL", category, a.Severity)
		}
		if a.TargetUserId != owner {
			t.Errorf("%s alert TargetUserId = %q, want %q", category, a.TargetUserId, owner)
		}
	}
}

func TestReconcileTick_MissingBrokerOrder_HaltsAndEmits(t *testing.T) {
	notify := &fakeNotifyClient{}
	svc := newTestReconciliationService(
		map[string]brokerPoolEntry{"acct-1": {client: &fakeReconciliationBroker{
			listOrdersFn: func(ctx context.Context) ([]broker.BrokerOrder, error) {
				return nil, nil // broker reports no orders at all
			},
		}, userID: "u-1"}},
		&fakeReconciliationPortfolioClient{}, &recordingLedgerClient{}, notify, noopAccountRepo{},
	)
	svc.orders["order-1"] = &tradingv1.Order{
		OrderId: "order-1", AccountId: "acct-1", BrokerOrderId: "bo-missing",
		Status: tradingv1.OrderStatus_ORDER_STATUS_NEW, Qty: 10, FilledQty: 0,
	}

	svc.reconcileTick(context.Background(), 0, 1.1)

	ledger := svc.ledger.(*recordingLedgerClient)
	found := false
	for _, e := range ledger.events {
		if e.EventType == "reconciliation.mismatch_found" &&
			e.Payload.Fields["mismatch_class"].GetStringValue() == mismatchClassMissingBrokerOrder {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected a missing_broker_order finding, got %v", ledger.eventTypes())
	}
	if !svc.isAccountHalted("acct-1") {
		t.Error("expected the account to be halted")
	}
	assertOwnerTargetedFindingAlerts(t, notify, "u-1")
}

// TestReconcileTick_EmptyOwner_WarnsAndAlertsUntargeted: an empty pool owner blocks nothing
// (feature-206 @AC-2) — the halt, the event and both alerts still fire, untargeted, with a WARN.
func TestReconcileTick_EmptyOwner_WarnsAndAlertsUntargeted(t *testing.T) {
	logs := captureLogs(t)
	notify := &fakeNotifyClient{}
	ledger := &recordingLedgerClient{}
	svc := newTestReconciliationService(
		map[string]brokerPoolEntry{"acct-1": {client: &fakeReconciliationBroker{
			listOrdersFn: func(ctx context.Context) ([]broker.BrokerOrder, error) {
				return nil, nil
			},
		}, userID: ""}},
		&fakeReconciliationPortfolioClient{}, ledger, notify, noopAccountRepo{},
	)
	svc.orders["order-1"] = &tradingv1.Order{
		OrderId: "order-1", AccountId: "acct-1", BrokerOrderId: "bo-missing",
		Status: tradingv1.OrderStatus_ORDER_STATUS_NEW, Qty: 10, FilledQty: 0,
	}

	svc.reconcileTick(context.Background(), 0, 1.1)

	if !svc.isAccountHalted("acct-1") {
		t.Error("expected the account to be halted despite the empty owner")
	}
	mismatches := 0
	for _, e := range ledger.eventTypes() {
		if e == "reconciliation.mismatch_found" {
			mismatches++
		}
	}
	if mismatches != 1 {
		t.Errorf("reconciliation.mismatch_found events = %d, want 1", mismatches)
	}
	for _, category := range []string{"halt", "reconciliation"} {
		if got := alertByCategory(t, notify, category).TargetUserId; got != "" {
			t.Errorf("%s alert TargetUserId = %q, want untargeted", category, got)
		}
	}
	warned := map[string]bool{}
	for _, r := range logs() {
		if r["level"] == "WARN" && r["msg"] == "alert owner unresolved" && r["account_id"] == "acct-1" {
			if kind, ok := r["alert_kind"].(string); ok {
				warned[kind] = true
			}
		}
	}
	for _, kind := range []string{"halt", "reconciliation"} {
		if !warned[kind] {
			t.Errorf("missing WARN \"alert owner unresolved\" for alert_kind %q (got %v)", kind, warned)
		}
	}
}

func TestReconcileTick_PositionQuantityDiscrepancy_CaughtViaPositionSide(t *testing.T) {
	svc := newTestReconciliationService(
		map[string]brokerPoolEntry{"acct-1": {client: &fakeReconciliationBroker{
			listOrdersFn: func(ctx context.Context) ([]broker.BrokerOrder, error) { return nil, nil },
			getPositionsFn: func(ctx context.Context) ([]broker.BrokerPosition, error) {
				return []broker.BrokerPosition{{Symbol: "AAPL", Quantity: 10}}, nil
			},
		}, userID: "u-1"}},
		&fakeReconciliationPortfolioClient{
			listPositionsFn: func(ctx context.Context, req *portfoliov1.ListPositionsRequest, opts ...grpc.CallOption) (*portfoliov1.ListPositionsResponse, error) {
				// Platform believes the position is flat (0) — the FILLED order that opened
				// it already dropped out of the order-side loop.
				return &portfoliov1.ListPositionsResponse{Positions: []*portfoliov1.Position{}}, nil
			},
		},
		&recordingLedgerClient{}, &fakeNotifyClient{}, noopAccountRepo{},
	)

	svc.reconcileTick(context.Background(), 0, 1.1)

	ledger := svc.ledger.(*recordingLedgerClient)
	found := false
	for _, e := range ledger.events {
		if e.EventType == "reconciliation.mismatch_found" &&
			e.Payload.Fields["order_id"].GetStringValue() == "AAPL" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected a position-side quantity_discrepancy finding for AAPL, got %v", ledger.eventTypes())
	}
	notify := svc.notify.(*fakeNotifyClient)
	for _, category := range []string{"halt", "reconciliation"} {
		if got := alertByCategory(t, notify, category).TargetUserId; got != "u-1" {
			t.Errorf("%s alert TargetUserId = %q, want %q", category, got, "u-1")
		}
	}
}

// TestReconcileTick_PositionQuantityDiscrepancy_ExplainedByPlatformOrders_NoHalt is the regression
// test for the feature-206 false halt: the broker holds AMAT=10 from the platform's OWN filled order,
// but the portfolio projection transiently reports 0 (fill→ledger→portfolio lag, or an empty
// position-sync that deleted the row). The trading.orders net-filled-qty grounding shows the platform
// itself placed fills summing to 10, so the broker position is fully explained — no finding, no halt.
func TestReconcileTick_PositionQuantityDiscrepancy_ExplainedByPlatformOrders_NoHalt(t *testing.T) {
	svc := newTestReconciliationService(
		map[string]brokerPoolEntry{"acct-1": {client: &fakeReconciliationBroker{
			listOrdersFn: func(ctx context.Context) ([]broker.BrokerOrder, error) { return nil, nil },
			getPositionsFn: func(ctx context.Context) ([]broker.BrokerPosition, error) {
				return []broker.BrokerPosition{{Symbol: "AMAT", Quantity: 10}}, nil
			},
		}, userID: "u-1"}},
		&fakeReconciliationPortfolioClient{
			listPositionsFn: func(ctx context.Context, req *portfoliov1.ListPositionsRequest, opts ...grpc.CallOption) (*portfoliov1.ListPositionsResponse, error) {
				// Projection lagging/zeroed — reports flat while the broker holds 10.
				return &portfoliov1.ListPositionsResponse{Positions: []*portfoliov1.Position{}}, nil
			},
		},
		&recordingLedgerClient{}, &fakeNotifyClient{}, noopAccountRepo{},
	)
	// The platform's own filled orders for AMAT net to 10 — the broker position is fully explained.
	svc.reconcilePositionLookup = &fakePositionQtyLookup{net: map[string]float64{"AMAT": 10}}

	// graceTicks=0 → any genuine finding would fire immediately; run several ticks to prove it never does.
	for i := 0; i < 3; i++ {
		svc.reconcileTick(context.Background(), 0, 1.1)
	}

	if svc.isAccountHalted("acct-1") {
		t.Fatal("account must NOT be halted when the platform's own fills explain the broker position (the false-halt regression)")
	}
	ledger := svc.ledger.(*recordingLedgerClient)
	for _, e := range ledger.eventTypes() {
		if e == "reconciliation.mismatch_found" {
			t.Fatalf("no reconciliation.mismatch_found expected for a platform-explained position, got %v", ledger.eventTypes())
		}
	}
}

// TestReconcileTick_PositionNetLookupError_SkipsHalt proves the fail-safe: a net-filled-qty DB lookup
// error must never cause a false position-side halt. The position check is skipped for the account
// this tick (re-evaluated next tick), so no finding and no halt — mirroring the order-side fail-safe.
func TestReconcileTick_PositionNetLookupError_SkipsHalt(t *testing.T) {
	svc := newTestReconciliationService(
		map[string]brokerPoolEntry{"acct-1": {client: &fakeReconciliationBroker{
			listOrdersFn: func(ctx context.Context) ([]broker.BrokerOrder, error) { return nil, nil },
			getPositionsFn: func(ctx context.Context) ([]broker.BrokerPosition, error) {
				return []broker.BrokerPosition{{Symbol: "AMAT", Quantity: 10}}, nil
			},
		}, userID: "u-1"}},
		&fakeReconciliationPortfolioClient{}, // portfolio reports flat (0) for AMAT
		&recordingLedgerClient{}, &fakeNotifyClient{}, noopAccountRepo{},
	)
	svc.reconcilePositionLookup = &fakePositionQtyLookup{err: errors.New("db unavailable")}

	svc.reconcileTick(context.Background(), 0, 1.1)

	if svc.isAccountHalted("acct-1") {
		t.Fatal("a net-filled-qty lookup error must not halt the account (fail-safe skip)")
	}
	ledger := svc.ledger.(*recordingLedgerClient)
	for _, e := range ledger.eventTypes() {
		if e == "reconciliation.mismatch_found" {
			t.Fatalf("no finding expected when the net-qty lookup errors, got %v", ledger.eventTypes())
		}
	}
}

// NOTE: TestReconcileTick_UnprotectedAccount_NoHalt_CountsTowardSystemic (implementation-spec.md
// Step 18 Instruction 6) is deliberately not written — reconcileTick's own doc comment explains
// why: every Broker client is constructed scoped to one account's own credentials, so a
// ListOrders/GetPositions call can only ever return records for that same account. There is no
// code path by which this poller could observe "a broker position/order under an account ID
// absent from s.brokers" — the bucket the spec names is architecturally unreachable given this
// feature's broker-client design, not a gap left untested.

func TestReconcileTick_ListOrdersError_SkipsAccount_CountsTowardSystemic(t *testing.T) {
	svc := newTestReconciliationService(
		map[string]brokerPoolEntry{"acct-1": {client: &fakeReconciliationBroker{
			listOrdersFn: func(ctx context.Context) ([]broker.BrokerOrder, error) {
				return nil, context.DeadlineExceeded
			},
		}, userID: "u-1"}},
		&fakeReconciliationPortfolioClient{}, &recordingLedgerClient{}, &fakeNotifyClient{}, noopAccountRepo{},
	)

	systemicCount, total := svc.reconcileTick(context.Background(), 0, 1.1)

	if total != 1 {
		t.Errorf("totalAccounts = %d, want 1", total)
	}
	if systemicCount != 1 {
		t.Errorf("systemicCount = %d, want 1", systemicCount)
	}
	ledger := svc.ledger.(*recordingLedgerClient)
	if len(ledger.events) != 0 {
		t.Errorf("expected no ledger events for a ListOrders error, got %v", ledger.eventTypes())
	}
}

// ── Steps 19-20: systemic escalation via platform.trading_state ───────────────────────────

// fakeConfigSetter implements configSetConfigForwarder, recording every call — the seam
// escalateSystemic calls through instead of cfgW.SetConfig directly (see TradingService's
// configSetter field doc comment for why: config.Watcher has no exported way to construct one
// around a fake gRPC client from outside package config).
type fakeConfigSetter struct {
	mu        sync.Mutex
	calls     []*configv1.SetConfigRequest
	callerIDs []string
}

func (f *fakeConfigSetter) SetConfig(ctx context.Context, callerID string, req *configv1.SetConfigRequest) (*configv1.SetConfigResponse, error) {
	f.mu.Lock()
	f.calls = append(f.calls, req)
	f.callerIDs = append(f.callerIDs, callerID)
	f.mu.Unlock()
	return &configv1.SetConfigResponse{}, nil
}

func TestReconcileTick_SystemicThresholdCrossed_EscalatesToReduceOnly(t *testing.T) {
	// Two accounts, both erroring on ListOrders — 2/2 = 1.0, at/above the 0.5 threshold.
	notify := &fakeNotifyClient{}
	failingBroker := &fakeReconciliationBroker{
		listOrdersFn: func(ctx context.Context) ([]broker.BrokerOrder, error) {
			return nil, context.DeadlineExceeded
		},
	}
	svc := newTestReconciliationService(
		map[string]brokerPoolEntry{
			"acct-1": {client: failingBroker, userID: "u-1"},
			"acct-2": {client: failingBroker, userID: "u-2"},
		},
		&fakeReconciliationPortfolioClient{}, &recordingLedgerClient{}, notify, noopAccountRepo{},
	)
	setter := &fakeConfigSetter{}
	svc.configSetter = setter

	svc.reconcileTick(context.Background(), 0, 0.5)

	var systemic []*notifyv1.EmitAlertRequest
	notify.mu.Lock()
	for _, c := range notify.calls {
		if strings.HasPrefix(c.Title, "Systemic broker-reconciliation failure") {
			systemic = append(systemic, c)
		}
	}
	notify.mu.Unlock()
	if len(systemic) != 1 {
		t.Fatalf("systemic alerts = %d, want 1", len(systemic))
	}
	if systemic[0].TargetUserId != "" {
		t.Errorf("systemic alert TargetUserId = %q, want untargeted", systemic[0].TargetUserId)
	}

	if len(setter.calls) != 1 {
		t.Fatalf("expected exactly 1 SetConfig call, got %d", len(setter.calls))
	}
	req := setter.calls[0]
	// escalateSystemic writes the namespace-relative key (feature 296 stores keys without the prefix).
	if req.Namespace != "platform" || req.Key != "trading_state" {
		t.Errorf("SetConfig target = namespace=%s key=%s, want namespace=platform key=trading_state", req.Namespace, req.Key)
	}
	if req.Value.GetStringVal() != "REDUCE_ONLY" {
		t.Errorf("SetConfig value = %q, want REDUCE_ONLY", req.Value.GetStringVal())
	}
	if setter.callerIDs[0] != testdata.ReconciliationPollerCallerID {
		t.Errorf("SetConfig callerID = %q, want %q", setter.callerIDs[0], testdata.ReconciliationPollerCallerID)
	}
	fd := req.ProtoReflect().Descriptor().Fields().ByName("author")
	if req.ProtoReflect().Has(fd) {
		t.Errorf("SetConfig must not send the deprecated author field")
	}
}

func TestReconcileTick_BelowThreshold_NoEscalation(t *testing.T) {
	// One account with an ordinary per-account finding (0 errors) — below any systemic
	// threshold; proves the ordinary/systemic split, not "every finding escalates".
	svc := newTestReconciliationService(
		map[string]brokerPoolEntry{"acct-1": {client: &fakeReconciliationBroker{
			listOrdersFn: func(ctx context.Context) ([]broker.BrokerOrder, error) {
				return []broker.BrokerOrder{{BrokerOrderID: "bo-unknown", Status: "new"}}, nil
			},
		}, userID: "u-1"}},
		&fakeReconciliationPortfolioClient{}, &recordingLedgerClient{}, &fakeNotifyClient{}, noopAccountRepo{},
	)
	setter := &fakeConfigSetter{}
	svc.configSetter = setter

	svc.reconcileTick(context.Background(), 0, 0.5)

	if len(setter.calls) != 0 {
		t.Errorf("expected zero SetConfig calls for a below-threshold (ordinary-only) tick, got %d", len(setter.calls))
	}
}

// ── Step 22: FR-6 — resolve 101's UNKNOWN order intents ────────────────────────────────────

// fakeReconciliationOrderIntentRepo implements repository.OrderIntentRepository, overriding only
// ListUnknownForAccount / ResolveUnknownIntent (the two Step 21 calls) — every other method
// panics if called, mirroring this file's established fake convention.
type fakeReconciliationOrderIntentRepo struct {
	listUnknownFn       func(ctx context.Context, brokerAccountID string) ([]*repository.OrderIntentRecord, error)
	resolveUnknownFn    func(ctx context.Context, intentID string, newState int16, response []byte) (bool, error)
	mu                  sync.Mutex
	resolveUnknownCalls []int16
}

func (f *fakeReconciliationOrderIntentRepo) InsertIntent(ctx context.Context, rec *repository.OrderIntentRecord) (bool, error) {
	panic("fakeReconciliationOrderIntentRepo.InsertIntent not implemented")
}
func (f *fakeReconciliationOrderIntentRepo) GetIntentByID(ctx context.Context, intentID string) (*repository.OrderIntentRecord, error) {
	panic("fakeReconciliationOrderIntentRepo.GetIntentByID not implemented")
}
func (f *fakeReconciliationOrderIntentRepo) ReclaimOrphanIntent(ctx context.Context, intentID string, staleBefore time.Time) (bool, *repository.OrderIntentRecord, error) {
	panic("fakeReconciliationOrderIntentRepo.ReclaimOrphanIntent not implemented")
}
func (f *fakeReconciliationOrderIntentRepo) FinalizeIntent(ctx context.Context, intentID, orderID string, state int16, response []byte) error {
	panic("fakeReconciliationOrderIntentRepo.FinalizeIntent not implemented")
}
func (f *fakeReconciliationOrderIntentRepo) SweepStalePending(ctx context.Context, staleBefore time.Time, limit int) ([]*repository.OrderIntentRecord, error) {
	panic("fakeReconciliationOrderIntentRepo.SweepStalePending not implemented")
}
func (f *fakeReconciliationOrderIntentRepo) ReleasePendingIntent(ctx context.Context, intentID string) (bool, error) {
	panic("fakeReconciliationOrderIntentRepo.ReleasePendingIntent not implemented")
}
func (f *fakeReconciliationOrderIntentRepo) ListUnknownForAccount(ctx context.Context, brokerAccountID string) ([]*repository.OrderIntentRecord, error) {
	if f.listUnknownFn != nil {
		return f.listUnknownFn(ctx, brokerAccountID)
	}
	return nil, nil
}
func (f *fakeReconciliationOrderIntentRepo) ResolveUnknownIntent(ctx context.Context, intentID string, newState int16, response []byte) (bool, error) {
	f.mu.Lock()
	f.resolveUnknownCalls = append(f.resolveUnknownCalls, newState)
	f.mu.Unlock()
	if f.resolveUnknownFn != nil {
		return f.resolveUnknownFn(ctx, intentID, newState, response)
	}
	return true, nil
}

var _ repository.OrderIntentRepository = (*fakeReconciliationOrderIntentRepo)(nil)

func TestReconcileTick_UnknownIntent_ResolvedViaLateResponseConflictEvent(t *testing.T) {
	payload, err := structpb.NewStruct(map[string]interface{}{"outcome": "completed"})
	if err != nil {
		t.Fatalf("build payload: %v", err)
	}
	ledger := &recordingLedgerClient{
		queryEventsFn: func(ctx context.Context, req *ledgerv1.QueryEventsRequest) (*ledgerv1.QueryEventsResponse, error) {
			if req.EventType == "order_intent.late_response_conflict" {
				return &ledgerv1.QueryEventsResponse{Events: []*ledgerv1.LedgerEvent{{Payload: payload}}}, nil
			}
			return &ledgerv1.QueryEventsResponse{}, nil
		},
	}
	intents := &fakeReconciliationOrderIntentRepo{
		listUnknownFn: func(ctx context.Context, brokerAccountID string) ([]*repository.OrderIntentRecord, error) {
			return []*repository.OrderIntentRecord{{IntentID: "intent-1", OrderID: "order-1"}}, nil
		},
	}
	svc := newTestReconciliationServiceWithIntents(
		map[string]brokerPoolEntry{"acct-1": {client: &fakeReconciliationBroker{}, userID: "u-1", brokerType: 1}},
		&fakeReconciliationPortfolioClient{}, ledger, &fakeNotifyClient{}, noopAccountRepo{}, intents,
	)

	svc.reconcileTick(context.Background(), 0, 1.1)

	if len(intents.resolveUnknownCalls) != 1 || intents.resolveUnknownCalls[0] != repository.IntentStateCompleted {
		t.Fatalf("expected exactly 1 ResolveUnknownIntent(Completed) call, got %v", intents.resolveUnknownCalls)
	}
	found := false
	for _, e := range ledger.eventTypes() {
		if e == "order_intent.resolved_by_reconciliation" {
			found = true
		}
	}
	if !found {
		t.Errorf("expected an order_intent.resolved_by_reconciliation event, got %v", ledger.eventTypes())
	}
}

func TestReconcileTick_UnknownIntent_ResolvedViaAlpacaListOrdersFallback(t *testing.T) {
	intentID := "intent-2"
	intents := &fakeReconciliationOrderIntentRepo{
		listUnknownFn: func(ctx context.Context, brokerAccountID string) ([]*repository.OrderIntentRecord, error) {
			return []*repository.OrderIntentRecord{{IntentID: intentID, OrderID: "order-2"}}, nil
		},
	}
	svc := newTestReconciliationServiceWithIntents(
		map[string]brokerPoolEntry{"acct-1": {client: &fakeReconciliationBroker{
			listOrdersFn: func(ctx context.Context) ([]broker.BrokerOrder, error) {
				return []broker.BrokerOrder{{
					BrokerOrderID: "bo-2", ClientOrderID: broker.DeriveBrokerClientOrderID(intentID), Status: "filled",
				}}, nil
			},
		}, userID: "u-1", brokerType: 1}}, // 1 = BROKER_TYPE_ALPACA
		&fakeReconciliationPortfolioClient{}, &recordingLedgerClient{}, &fakeNotifyClient{}, noopAccountRepo{}, intents,
	)

	svc.reconcileTick(context.Background(), 0, 1.1)

	if len(intents.resolveUnknownCalls) != 1 || intents.resolveUnknownCalls[0] != repository.IntentStateCompleted {
		t.Fatalf("expected exactly 1 ResolveUnknownIntent(Completed) call via the Alpaca fallback, got %v", intents.resolveUnknownCalls)
	}
}

func TestReconcileTick_UnknownIntent_IBKR_NeverUsesFallback(t *testing.T) {
	intentID := "intent-3"
	intents := &fakeReconciliationOrderIntentRepo{
		listUnknownFn: func(ctx context.Context, brokerAccountID string) ([]*repository.OrderIntentRecord, error) {
			return []*repository.OrderIntentRecord{{IntentID: intentID, OrderID: "order-3"}}, nil
		},
	}
	svc := newTestReconciliationServiceWithIntents(
		map[string]brokerPoolEntry{"acct-1": {client: &fakeReconciliationBroker{
			listOrdersFn: func(ctx context.Context) ([]broker.BrokerOrder, error) {
				// An IBKR ListOrders result never carries a ClientOrderID (Steps 9/11) —
				// even if one happened to match, IBKR must never resolve via this path.
				return []broker.BrokerOrder{{BrokerOrderID: "bo-3", ClientOrderID: "", Status: "filled"}}, nil
			},
		}, userID: "u-1", brokerType: 2}}, // 2 = BROKER_TYPE_IBKR
		&fakeReconciliationPortfolioClient{}, &recordingLedgerClient{}, &fakeNotifyClient{}, noopAccountRepo{}, intents,
	)

	svc.reconcileTick(context.Background(), 0, 1.1)

	if len(intents.resolveUnknownCalls) != 0 {
		t.Errorf("expected zero ResolveUnknownIntent calls for an IBKR account, got %v", intents.resolveUnknownCalls)
	}
}

func TestReconcileTick_UnknownIntent_GenuinelyInconclusive_NoWrite(t *testing.T) {
	intents := &fakeReconciliationOrderIntentRepo{
		listUnknownFn: func(ctx context.Context, brokerAccountID string) ([]*repository.OrderIntentRecord, error) {
			return []*repository.OrderIntentRecord{{IntentID: "intent-4", OrderID: "order-4"}}, nil
		},
	}
	svc := newTestReconciliationServiceWithIntents(
		map[string]brokerPoolEntry{"acct-1": {client: &fakeReconciliationBroker{
			listOrdersFn: func(ctx context.Context) ([]broker.BrokerOrder, error) {
				return nil, nil // no ledger event, no matching ListOrders entry
			},
		}, userID: "u-1", brokerType: 1}},
		&fakeReconciliationPortfolioClient{}, &recordingLedgerClient{}, &fakeNotifyClient{}, noopAccountRepo{}, intents,
	)

	svc.reconcileTick(context.Background(), 0, 1.1)

	if len(intents.resolveUnknownCalls) != 0 {
		t.Errorf("expected zero writes for a genuinely inconclusive intent, got %v", intents.resolveUnknownCalls)
	}
}

// ── Feature 358: drain portfolio ListPositions fail-closed ─────────────────────────────────
// Never run these in parallel: the counter-asserting tests swap the process-global MeterProvider.

const (
	reconcile358Owner      = "user-358-owner"
	reconcile358SkipMetric = "trading.reconciliation.position_check_skipped"
	reconcile358CallCap    = 100
)

// reconcile358BrokerPositions is the broker truth: SYM001..SYM501, qty 10 each.
func reconcile358BrokerPositions() []broker.BrokerPosition {
	out := make([]broker.BrokerPosition, 0, 501)
	for n := 1; n <= 501; n++ {
		out = append(out, broker.BrokerPosition{Symbol: fmt.Sprintf("SYM%03d", n), Quantity: 10})
	}
	return out
}

type reconcile358Call struct {
	token     string
	pageSize  int32
	accountID string
	mode      commonv1.TradingMode
	userID    string
	deadline  time.Time
}

// reconcile358Pager serves page 1 (SYM001..SYM500, next "p2") and page "p2" by token.
type reconcile358Pager struct {
	mu    sync.Mutex
	log   []reconcile358Call
	calls int

	page2Positions  []*portfoliov1.Position
	page2Next       string
	page2Err        error
	page1Sleep      time.Duration
	page2BlockOnCtx bool
	ignoreToken     bool
}

func newReconcile358Pager() *reconcile358Pager {
	return &reconcile358Pager{page2Positions: []*portfoliov1.Position{{Symbol: "SYM501", Qty: 10}}}
}

func (p *reconcile358Pager) listPositions(ctx context.Context, req *portfoliov1.ListPositionsRequest, _ ...grpc.CallOption) (*portfoliov1.ListPositionsResponse, error) {
	call := reconcile358Call{
		token: req.GetPage().GetPageToken(), pageSize: req.GetPage().GetPageSize(),
		accountID: req.GetAccountId(), mode: req.GetTradingMode(),
	}
	if md, ok := metadata.FromOutgoingContext(ctx); ok {
		if v := md.Get("x-user-id"); len(v) > 0 {
			call.userID = v[0]
		}
	}
	call.deadline, _ = ctx.Deadline()
	p.mu.Lock()
	p.calls++
	n := p.calls
	p.log = append(p.log, call)
	p.mu.Unlock()
	if n > reconcile358CallCap {
		return nil, grpcstatus.Error(codes.ResourceExhausted, "paging fake call cap exceeded")
	}
	token := call.token
	if p.ignoreToken {
		token = ""
	}
	switch token {
	case "":
		time.Sleep(p.page1Sleep) // never observes ctx, so a page-1 overrun cannot hide page 2
		page := make([]*portfoliov1.Position, 0, 500)
		for i := 1; i <= 500; i++ {
			page = append(page, &portfoliov1.Position{Symbol: fmt.Sprintf("SYM%03d", i), Qty: 10})
		}
		return &portfoliov1.ListPositionsResponse{Positions: page, Page: &commonv1.PageResponse{NextPageToken: "p2"}}, nil
	case "p2":
		if p.page2BlockOnCtx {
			<-ctx.Done()
			return nil, ctx.Err()
		}
		if p.page2Err != nil {
			return nil, p.page2Err
		}
		return &portfoliov1.ListPositionsResponse{Positions: p.page2Positions, Page: &commonv1.PageResponse{NextPageToken: p.page2Next}}, nil
	}
	return nil, grpcstatus.Errorf(codes.InvalidArgument, "paging fake: unknown token %q", token)
}

func (p *reconcile358Pager) takeLog() []reconcile358Call {
	p.mu.Lock()
	defer p.mu.Unlock()
	out := p.log
	p.log = nil
	return out
}

func newReconcile358Service(p *reconcile358Pager) (*TradingService, *recordingLedgerClient) {
	ledger := &recordingLedgerClient{}
	svc := newTestReconciliationService(
		map[string]brokerPoolEntry{"acc-1": {client: &fakeReconciliationBroker{
			getPositionsFn: func(ctx context.Context) ([]broker.BrokerPosition, error) {
				return reconcile358BrokerPositions(), nil
			},
			isPaper: true,
		}, userID: reconcile358Owner}},
		&fakeReconciliationPortfolioClient{listPositionsFn: p.listPositions},
		ledger, &fakeNotifyClient{}, noopAccountRepo{},
	)
	return svc, ledger
}

func reconcile358Tokens(log []reconcile358Call) []string {
	out := make([]string, len(log))
	for i, c := range log {
		out[i] = c.token
	}
	return out
}

func assert358Tokens(t *testing.T, tick int, log []reconcile358Call, want ...string) {
	t.Helper()
	got := reconcile358Tokens(log)
	if !slices.Equal(got, want) {
		t.Errorf("tick %d tokens = %q, want %q", tick, got, want)
	}
}

func assert358Identity(t *testing.T, tick int, log []reconcile358Call) {
	t.Helper()
	for i, c := range log {
		if c.userID != reconcile358Owner || c.accountID != "acc-1" || c.mode != commonv1.TradingMode_TRADING_MODE_PAPER {
			t.Errorf("tick %d call %d: x-user-id=%q account=%q mode=%v, want %q acc-1 TRADING_MODE_PAPER",
				tick, i, c.userID, c.accountID, c.mode, reconcile358Owner)
		}
	}
}

func reconcile358Findings(ledger *recordingLedgerClient) []*ledgerv1.AppendEventRequest {
	ledger.mu.Lock()
	defer ledger.mu.Unlock()
	var out []*ledgerv1.AppendEventRequest
	for _, e := range ledger.events {
		if e.EventType == "reconciliation.mismatch_found" {
			out = append(out, e)
		}
	}
	return out
}

func assert358NoFindingNoHalt(t *testing.T, tick int, svc *TradingService, ledger *recordingLedgerClient) {
	t.Helper()
	if f := reconcile358Findings(ledger); len(f) != 0 {
		t.Errorf("tick %d: %d reconciliation.mismatch_found event(s), want none", tick, len(f))
	}
	if svc.isAccountHalted("acc-1") {
		t.Errorf("tick %d: acc-1 halted, want not halted", tick)
	}
}

// assert358Skipped pins the fail-closed skip: no position candidate, no finding, no halt.
func assert358Skipped(t *testing.T, tick int, svc *TradingService, ledger *recordingLedgerClient) {
	t.Helper()
	svc.reconcileCandidatesMu.Lock()
	for k := range svc.reconcileCandidates {
		if strings.HasPrefix(k, "acc-1:pos:") {
			t.Errorf("tick %d: position candidate %q recorded, want the position check skipped", tick, k)
		}
	}
	svc.reconcileCandidatesMu.Unlock()
	assert358NoFindingNoHalt(t, tick, svc, ledger)
}

func assert358HasToken(t *testing.T, tick int, log []reconcile358Call, token string) {
	t.Helper()
	for _, c := range log {
		if c.token == token {
			return
		}
	}
	t.Errorf("tick %d tokens = %q, want a %q call", tick, reconcile358Tokens(log), token)
}

func assert358NoAccountLabels(t *testing.T, keys map[string]map[string]bool) {
	t.Helper()
	for _, k := range []string{"account_id", "user_id"} {
		if keys[reconcile358SkipMetric][k] {
			t.Errorf("%s carries a %q attribute, want none", reconcile358SkipMetric, k)
		}
	}
}

func TestReconcileTick_358_AC1_DrainsAllPages_NoFindingNoHalt(t *testing.T) {
	reader := installMetricReader(t)
	p := newReconcile358Pager()
	svc, ledger := newReconcile358Service(p)
	svc.reconcileCandidates["acc-1:pos:SYM501"] = 1

	for tick := 1; tick <= 2; tick++ {
		svc.reconcileTick(context.Background(), 1, 1.1)
		log := p.takeLog()
		assert358Tokens(t, tick, log, "", "p2")
		assert358Identity(t, tick, log)
		assert358NoFindingNoHalt(t, tick, svc, ledger)
		if tick == 1 {
			svc.reconcileCandidatesMu.Lock()
			_, ok := svc.reconcileCandidates["acc-1:pos:SYM501"]
			svc.reconcileCandidatesMu.Unlock()
			if ok {
				t.Error("tick 1: seeded acc-1:pos:SYM501 candidate still present, want cleared by a matching page-2 position")
			}
		}
	}
	if got := counterValue(t, reader, reconcile358SkipMetric); got != 0 {
		t.Errorf("skip counter total = %d, want 0", got)
	}
}

func TestReconcileTick_358_PositiveControl_Page2MismatchHalts(t *testing.T) {
	reader := installMetricReader(t)
	p := newReconcile358Pager()
	p.page2Positions = []*portfoliov1.Position{{Symbol: "SYM501", Qty: 5}}
	svc, ledger := newReconcile358Service(p)

	for tick := 1; tick <= 2; tick++ {
		svc.reconcileTick(context.Background(), 1, 1.1)
		log := p.takeLog()
		assert358Tokens(t, tick, log, "", "p2")
		assert358Identity(t, tick, log)
	}
	findings := reconcile358Findings(ledger)
	if len(findings) != 1 {
		t.Fatalf("%d reconciliation.mismatch_found events, want exactly 1 (%v)", len(findings), ledger.eventTypes())
	}
	f := findings[0].Payload.Fields
	sym, exp, rep := f["order_id"].GetStringValue(), f["expected"].GetNumberValue(), f["broker_reported"].GetNumberValue()
	if sym != "SYM501" || exp != 5 || rep != 10 {
		t.Errorf("payload order_id=%q expected=%v broker_reported=%v, want SYM501 5 10", sym, exp, rep)
	}
	if !svc.isAccountHalted("acc-1") {
		t.Error("acc-1 not halted, want halted on a genuine page-2 mismatch")
	}
	if got := counterValue(t, reader, reconcile358SkipMetric); got != 0 {
		t.Errorf("skip counter total = %d, want 0", got)
	}
}

func TestReconcileTick_358_AC2_Page2RPCError_SkipsAccountForTick(t *testing.T) {
	reader := installMetricReader(t)
	p := newReconcile358Pager()
	p.page2Err = grpcstatus.Error(codes.Unavailable, "portfolio down")
	svc, ledger := newReconcile358Service(p)

	for tick := 1; tick <= 2; tick++ {
		svc.reconcileTick(context.Background(), 1, 1.1)
		assert358HasToken(t, tick, p.takeLog(), "p2")
		assert358Skipped(t, tick, svc, ledger)
	}
	if got := counterValue(t, reader, reconcile358SkipMetric, outcome("rpc_error")); got != 2 {
		t.Errorf("rpc_error skips = %d, want 2", got)
	}
	assert358NoAccountLabels(t, keysByInstrument(t, reader))
}

func TestReconcileTick_358_AC2_Page2Deadline_SkipsAccountForTick(t *testing.T) {
	reader := installMetricReader(t)
	p := newReconcile358Pager()
	p.page1Sleep = 5 * time.Millisecond
	p.page2BlockOnCtx = true
	svc, ledger := newReconcile358Service(p)
	svc.cfgW = snapshotInts(map[string]int64{"broker.timeout_ms": 50})

	for tick := 1; tick <= 2; tick++ {
		svc.reconcileTick(context.Background(), 1, 1.1)
		log := p.takeLog()
		assert358HasToken(t, tick, log, "p2")
		assert358Skipped(t, tick, svc, ledger)
		if len(log) == 2 && !log[1].deadline.After(log[0].deadline) {
			t.Errorf("tick %d: page-2 deadline %v not after page-1 deadline %v, want a per-page timeout", tick, log[1].deadline, log[0].deadline)
		}
	}
	if got := counterValue(t, reader, reconcile358SkipMetric, outcome("deadline")); got != 2 {
		t.Errorf("deadline skips = %d, want 2", got)
	}
	assert358NoAccountLabels(t, keysByInstrument(t, reader))
}

func TestReconcileTick_358_AC3_IgnoredToken_SkipsAccountForTick(t *testing.T) {
	reader := installMetricReader(t)
	p := newReconcile358Pager()
	p.ignoreToken = true
	svc, ledger := newReconcile358Service(p)

	for tick := 1; tick <= 2; tick++ {
		svc.reconcileTick(context.Background(), 1, 1.1)
		assert358Tokens(t, tick, p.takeLog(), "", "p2")
		assert358Skipped(t, tick, svc, ledger)
	}
	if got := counterValue(t, reader, reconcile358SkipMetric, outcome("cursor_invalid")); got != 2 {
		t.Errorf("cursor_invalid skips = %d, want 2", got)
	}
	assert358NoAccountLabels(t, keysByInstrument(t, reader))
}

// Each guard row asserts its exact text, so deleting any single guard turns a row red.
func TestListAccountPlatformPositions_358_Guards(t *testing.T) {
	cases := []struct {
		name       string
		setup      func(p *reconcile358Pager)
		wantErr    string
		wantPrefix string
		wantCode   codes.Code
		wantCause  telemetry.ReconcileSkipOutcome
	}{
		{name: "happy two-page drain", setup: func(p *reconcile358Pager) {}},
		{
			name:      "repeated token",
			setup:     func(p *reconcile358Pager) { p.ignoreToken = true },
			wantErr:   `page 2: repeated next_page_token "p2"`,
			wantCause: telemetry.ReconcileSkipCursorInvalid,
		},
		{
			name: "empty page with token",
			setup: func(p *reconcile358Pager) {
				p.page2Positions, p.page2Next = nil, "p3"
			},
			wantErr:   `page 2: empty page with next_page_token "p3"`,
			wantCause: telemetry.ReconcileSkipCursorInvalid,
		},
		{
			name: "duplicate symbol",
			setup: func(p *reconcile358Pager) {
				p.page2Positions = []*portfoliov1.Position{{Symbol: "SYM500", Qty: 10}}
			},
			wantErr:   `page 2: duplicate symbol "SYM500"`,
			wantCause: telemetry.ReconcileSkipCursorInvalid,
		},
		{
			name:       "rpc error",
			setup:      func(p *reconcile358Pager) { p.page2Err = grpcstatus.Error(codes.Unavailable, "portfolio down") },
			wantPrefix: "page 2: list positions:",
			wantCode:   codes.Unavailable,
			wantCause:  telemetry.ReconcileSkipRPCError,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			p := newReconcile358Pager()
			tc.setup(p)
			svc, _ := newReconcile358Service(p)

			got, err := svc.listAccountPlatformPositions(context.Background(), "acc-1", reconcile358Owner, commonv1.TradingMode_TRADING_MODE_PAPER, time.Second)
			log := p.takeLog()

			if tc.wantErr == "" && tc.wantPrefix == "" {
				if err != nil {
					t.Fatalf("err = %v, want nil", err)
				}
				if len(got) != 501 || got["SYM501"] != 10 {
					t.Errorf("map has %d entries, SYM501=%v; want 501 entries, SYM501=10", len(got), got["SYM501"])
				}
				assert358Tokens(t, 1, log, "", "p2")
				for i, c := range log {
					if c.pageSize != reconcilePositionsPageSize {
						t.Errorf("call %d PageSize = %d, want %d", i, c.pageSize, reconcilePositionsPageSize)
					}
				}
				return
			}
			if got != nil {
				t.Errorf("map = %d entries, want nil on error (never a partial map)", len(got))
			}
			if err == nil {
				t.Fatal("err = nil, want an error")
			}
			if tc.wantErr != "" && err.Error() != tc.wantErr {
				t.Errorf("err = %q, want %q", err.Error(), tc.wantErr)
			}
			if tc.wantPrefix != "" {
				if !strings.HasPrefix(err.Error(), tc.wantPrefix) {
					t.Errorf("err = %q, want prefix %q", err.Error(), tc.wantPrefix)
				}
				if c := grpcstatus.Code(err); c != tc.wantCode {
					t.Errorf("status.Code(err) = %v, want %v", c, tc.wantCode)
				}
			}
			if cause := reconcilePositionSkipCause(err); cause != tc.wantCause {
				t.Errorf("reconcilePositionSkipCause = %q, want %q", cause, tc.wantCause)
			}
		})
	}
}

func TestReconcilePositionSkipCause_358(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want telemetry.ReconcileSkipOutcome
	}{
		{"plain context deadline", fmt.Errorf("page 2: list positions: %w", context.DeadlineExceeded), telemetry.ReconcileSkipDeadline},
		{"grpc DeadlineExceeded", fmt.Errorf("page 2: list positions: %w", grpcstatus.Error(codes.DeadlineExceeded, "x")), telemetry.ReconcileSkipDeadline},
		{"context canceled", fmt.Errorf("page 2: list positions: %w", context.Canceled), telemetry.ReconcileSkipRPCError},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := reconcilePositionSkipCause(tc.err); got != tc.want {
				t.Errorf("reconcilePositionSkipCause(%v) = %q, want %q", tc.err, got, tc.want)
			}
		})
	}
}
