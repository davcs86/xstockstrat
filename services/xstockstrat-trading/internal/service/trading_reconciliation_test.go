package service

import (
	"context"
	"sync"
	"testing"
	"time"

	"google.golang.org/grpc"

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
	mu     sync.Mutex
	events []*ledgerv1.AppendEventRequest
}

func (f *recordingLedgerClient) AppendEvent(_ context.Context, req *ledgerv1.AppendEventRequest, _ ...grpc.CallOption) (*ledgerv1.AppendEventResponse, error) {
	f.mu.Lock()
	f.events = append(f.events, req)
	f.mu.Unlock()
	return &ledgerv1.AppendEventResponse{}, nil
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
	return &TradingService{
		cfg:                 &config.Config{},
		cfgW:                &config.Watcher{},
		brokers:             brokers,
		portfolio:           portfolio,
		ledger:              ledger,
		notify:              notify,
		accountRepo:         accountRepo,
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
			systemicCount, total := svc.reconcileTick(context.Background(), 0)

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
	svc.reconcileTick(context.Background(), 1)

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
	svc.reconcileTick(context.Background(), 1)
	svc.reconcileTick(context.Background(), 1)

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

	svc.reconcileTick(context.Background(), 0)

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

	svc.reconcileTick(context.Background(), 0)

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

	systemicCount, total := svc.reconcileTick(context.Background(), 0)

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
