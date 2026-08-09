package service

import (
	"context"
	"sync"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/protobuf/types/known/structpb"

	configv1 "github.com/xstockstrat/contracts/gen/go/config/v1"
	ledgerv1 "github.com/xstockstrat/contracts/gen/go/ledger/v1"
	notifyv1 "github.com/xstockstrat/contracts/gen/go/notify/v1"
	portfoliov1 "github.com/xstockstrat/contracts/gen/go/portfolio/v1"
	tradingv1 "github.com/xstockstrat/contracts/gen/go/trading/v1"
	"github.com/xstockstrat/trading/internal/broker"
	"github.com/xstockstrat/trading/internal/config"
	"github.com/xstockstrat/trading/internal/repository"
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
		cfg:                 &config.Config{},
		cfgW:                &config.Watcher{},
		brokers:             brokers,
		portfolio:           portfolio,
		ledger:              ledger,
		notify:              notify,
		accountRepo:         accountRepo,
		orderIntentRepo:     orderIntentRepo,
		orders:              make(map[string]*tradingv1.Order),
		credStatus:          make(map[string]int32),
		halted:              make(map[string]bool),
		haltReasons:         make(map[string]string),
		reconcileCandidates: make(map[string]int),
	}
}

// noopAccountRepo satisfies repository.AccountRepository for tests that don't care about the
// halt write itself (only whether haltAccount was invoked, observed via notify/ledger).
type noopAccountRepo struct {
	repository.AccountRepository
}

func (noopAccountRepo) UpdateHaltStatus(ctx context.Context, id string, halted bool, reason string, haltedAt *time.Time, haltSource int32) error {
	return nil
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
		})
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
}

func TestReconcileTick_MissingBrokerOrder_HaltsAndEmits(t *testing.T) {
	svc := newTestReconciliationService(
		map[string]brokerPoolEntry{"acct-1": {client: &fakeReconciliationBroker{
			listOrdersFn: func(ctx context.Context) ([]broker.BrokerOrder, error) {
				return nil, nil // broker reports no orders at all
			},
		}, userID: "u-1"}},
		&fakeReconciliationPortfolioClient{}, &recordingLedgerClient{}, &fakeNotifyClient{}, noopAccountRepo{},
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
	mu    sync.Mutex
	calls []*configv1.SetConfigRequest
}

func (f *fakeConfigSetter) SetConfig(ctx context.Context, callerID string, req *configv1.SetConfigRequest) (*configv1.SetConfigResponse, error) {
	f.mu.Lock()
	f.calls = append(f.calls, req)
	f.mu.Unlock()
	return &configv1.SetConfigResponse{}, nil
}

func TestReconcileTick_SystemicThresholdCrossed_EscalatesToReduceOnly(t *testing.T) {
	// Two accounts, both erroring on ListOrders — 2/2 = 1.0, at/above the 0.5 threshold.
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
		&fakeReconciliationPortfolioClient{}, &recordingLedgerClient{}, &fakeNotifyClient{}, noopAccountRepo{},
	)
	setter := &fakeConfigSetter{}
	svc.configSetter = setter

	svc.reconcileTick(context.Background(), 0, 0.5)

	if len(setter.calls) != 1 {
		t.Fatalf("expected exactly 1 SetConfig call, got %d", len(setter.calls))
	}
	req := setter.calls[0]
	if req.Namespace != "platform" || req.Key != "trading_state" {
		t.Errorf("SetConfig target = %s.%s, want platform.trading_state", req.Namespace, req.Key)
	}
	if req.Value.GetStringVal() != "REDUCE_ONLY" {
		t.Errorf("SetConfig value = %q, want REDUCE_ONLY", req.Value.GetStringVal())
	}
	if req.Author != "system:reconciliation-poller" {
		t.Errorf("SetConfig author = %q, want system:reconciliation-poller", req.Author)
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
