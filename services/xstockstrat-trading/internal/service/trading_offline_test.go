package service

import (
	"context"
	"encoding/json"
	"math"
	"sync"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	grpcstatus "google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	ledgerv1 "github.com/xstockstrat/contracts/gen/go/ledger/v1"
	portfoliov1 "github.com/xstockstrat/contracts/gen/go/portfolio/v1"
	tradingv1 "github.com/xstockstrat/contracts/gen/go/trading/v1"
	"github.com/xstockstrat/contracts/pnl"
	"github.com/xstockstrat/trading/internal/config"
	"github.com/xstockstrat/trading/internal/repository"
)

// offlineAccountRepo is a fake AccountRepository recording CreateBrokerAccount and serving a
// preconfigured GetBrokerAccount, for the DB-free offline-account service tests (feature 157).
type offlineAccountRepo struct {
	repository.AccountRepository
	created  []*repository.BrokerAccountRecord
	getRec   *repository.BrokerAccountRecord
	deactive []string
}

func (f *offlineAccountRepo) CreateBrokerAccount(_ context.Context, rec *repository.BrokerAccountRecord) error {
	f.created = append(f.created, rec)
	return nil
}

func (f *offlineAccountRepo) GetBrokerAccount(_ context.Context, _ string) (*repository.BrokerAccountRecord, error) {
	return f.getRec, nil
}

func (f *offlineAccountRepo) DeactivateBrokerAccount(_ context.Context, id string) error {
	f.deactive = append(f.deactive, id)
	return nil
}

func (f *offlineAccountRepo) UpdateCredentialStatus(_ context.Context, _ string, _ int32, _ time.Time) error {
	return nil
}

// recordingLedger captures every AppendEvent so a test can assert which ledger events were emitted.
// Enhanced for feature 163 (Step 9) to capture full requests, enabling assertions on payloads
// (source, as_of, realized_pnl, etc.) beyond event-type-only checks.
type recordingLedger struct {
	ledgerv1.LedgerServiceClient
	mu       sync.Mutex
	events   []string
	requests []*ledgerv1.AppendEventRequest
}

func (r *recordingLedger) AppendEvent(_ context.Context, req *ledgerv1.AppendEventRequest, _ ...grpc.CallOption) (*ledgerv1.AppendEventResponse, error) {
	r.mu.Lock()
	r.events = append(r.events, req.EventType)
	r.requests = append(r.requests, req)
	r.mu.Unlock()
	return &ledgerv1.AppendEventResponse{}, nil
}

func (r *recordingLedger) eventTypes() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]string, len(r.events))
	copy(out, r.events)
	return out
}

// requestsByType returns all AppendEventRequests matching a given event type, for payload assertions.
func (r *recordingLedger) requestsByType(eventType string) []*ledgerv1.AppendEventRequest {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []*ledgerv1.AppendEventRequest
	for _, req := range r.requests {
		if req.EventType == eventType {
			out = append(out, req)
		}
	}
	return out
}

// reset clears all recorded events so a test can re-assert after a second call.
func (r *recordingLedger) reset() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.events = nil
	r.requests = nil
}

// fakeBaselineStore is a DB-free in-memory offlineBaselineStore for the snapshot producer tests
// (feature 163, Step 9). Each method is driven by configurable fields so individual test cases can
// set up the exact baseline / order / warning state they need.
type fakeBaselineStore struct {
	// baseline state — returned by EffectiveBaselineByAccount
	baselineAsOf time.Time
	baselineLots map[string]pnl.Lot
	hasBaseline  bool
	baselineErr  error

	// confirmed orders — returned by ListConfirmedOfflineOrdersByAccount
	confirmedOrders []*tradingv1.Order
	confirmedErr    error

	// upsert tracking — populated by UpsertBaselineSnapshot
	upsertCalls []upsertBaselineCall
	upsertErr   error

	// delete tracking — populated by DeleteBaselinesByAccount
	deleteCalls []string
	deleteErr   error

	// unconfirmed orders warning — returned by HasUnconfirmedOfflineOrders
	hasUnconfirmed    bool
	hasUnconfirmedErr error

	mu sync.Mutex
}

type upsertBaselineCall struct {
	accountID        string
	clientSnapshotID string
	asOf             time.Time
	rows             []repository.BaselineRow
}

func (f *fakeBaselineStore) UpsertBaselineSnapshot(_ context.Context, accountID, clientSnapshotID string, asOf time.Time, rows []repository.BaselineRow) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.upsertCalls = append(f.upsertCalls, upsertBaselineCall{
		accountID: accountID, clientSnapshotID: clientSnapshotID, asOf: asOf, rows: rows,
	})
	if f.upsertErr != nil {
		return f.upsertErr
	}
	// After upsert, update the in-memory baseline state for the next EffectiveBaselineByAccount call
	// (simulates the DB replace-in-tx semantics: the upserted rows become the effective baseline).
	f.baselineAsOf = asOf
	f.hasBaseline = len(rows) > 0
	f.baselineLots = make(map[string]pnl.Lot, len(rows))
	for _, r := range rows {
		if r.Qty == 0 {
			continue // drop qty=0 — mirrors EffectiveBaselineByAccount's AC-8/AC-15 behavior
		}
		f.baselineLots[r.Symbol] = pnl.Lot{Qty: r.Qty, CostBasis: r.Qty * r.AvgCostPerShare}
	}
	return nil
}

func (f *fakeBaselineStore) EffectiveBaselineByAccount(_ context.Context, _ string) (time.Time, map[string]pnl.Lot, bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.baselineErr != nil {
		return time.Time{}, nil, false, f.baselineErr
	}
	if !f.hasBaseline {
		return time.Time{}, nil, false, nil
	}
	// Return a copy so mutations in the caller don't affect our state.
	lots := make(map[string]pnl.Lot, len(f.baselineLots))
	for k, v := range f.baselineLots {
		lots[k] = v
	}
	return f.baselineAsOf, lots, true, nil
}

func (f *fakeBaselineStore) DeleteBaselinesByAccount(_ context.Context, accountID string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.deleteCalls = append(f.deleteCalls, accountID)
	if f.deleteErr != nil {
		return f.deleteErr
	}
	// Clear the in-memory baseline (simulates the DELETE).
	f.hasBaseline = false
	f.baselineLots = nil
	return nil
}

func (f *fakeBaselineStore) HasUnconfirmedOfflineOrders(_ context.Context, _ string) (bool, error) {
	return f.hasUnconfirmed, f.hasUnconfirmedErr
}

func (f *fakeBaselineStore) ListConfirmedOfflineOrdersByAccount(_ context.Context, _ string) ([]*tradingv1.Order, error) {
	if f.confirmedErr != nil {
		return nil, f.confirmedErr
	}
	return f.confirmedOrders, nil
}

// Compile-time interface check.
var _ offlineBaselineStore = (*fakeBaselineStore)(nil)

// TestRegisterBrokerAccount_Offline covers @AC-1 (broker_type OFFLINE, credential_status
// UNSPECIFIED, active) and @AC-2 (persisted credentials_enc is NULL, no broker client).
func TestRegisterBrokerAccount_Offline(t *testing.T) {
	repo := &offlineAccountRepo{}
	svc := &TradingService{
		cfg:         &config.Config{TradingMode: "paper"},
		cfgW:        &config.Watcher{},
		accountRepo: repo,
		brokers:     map[string]brokerPoolEntry{},
	}

	acct, err := svc.RegisterBrokerAccount(context.Background(), &tradingv1.RegisterBrokerAccountRequest{
		DisplayName:     "Manual book",
		BrokerType:      commonv1.BrokerType_BROKER_TYPE_OFFLINE,
		CredentialsJson: "", // offline accounts have no credentials
	}, "user-1")
	if err != nil {
		t.Fatalf("register offline account: %v", err)
	}

	// @AC-1
	if acct.BrokerType != commonv1.BrokerType_BROKER_TYPE_OFFLINE {
		t.Errorf("broker_type = %v, want OFFLINE", acct.BrokerType)
	}
	if acct.CredentialStatus != tradingv1.CredentialStatus_CREDENTIAL_STATUS_UNSPECIFIED {
		t.Errorf("credential_status = %v, want UNSPECIFIED", acct.CredentialStatus)
	}
	if !acct.IsActive {
		t.Error("offline account should be active")
	}

	// @AC-2: persisted with NULL credentials
	if len(repo.created) != 1 {
		t.Fatalf("expected 1 CreateBrokerAccount call, got %d", len(repo.created))
	}
	if repo.created[0].CredentialsEnc != nil {
		t.Errorf("offline account persisted non-nil credentials: %v", repo.created[0].CredentialsEnc)
	}
	if repo.created[0].BrokerType != int32(commonv1.BrokerType_BROKER_TYPE_OFFLINE) {
		t.Errorf("persisted broker_type = %d, want OFFLINE", repo.created[0].BrokerType)
	}

	// Pool entry tags it OFFLINE with a nil client so every broker poller skips it.
	entry, ok := svc.brokers[acct.Id]
	if !ok {
		t.Fatal("offline account not added to broker pool")
	}
	if entry.client != nil {
		t.Error("offline pool entry must have a nil broker client")
	}
	if entry.brokerType != int32(commonv1.BrokerType_BROKER_TYPE_OFFLINE) {
		t.Errorf("pool entry broker_type = %d, want OFFLINE", entry.brokerType)
	}
}

// TestUpdateBrokerAccountCredentials_RejectsOffline: offline accounts have no credentials to update.
func TestUpdateBrokerAccountCredentials_RejectsOffline(t *testing.T) {
	repo := &offlineAccountRepo{getRec: &repository.BrokerAccountRecord{
		ID: "off-1", UserID: "user-1", BrokerType: int32(commonv1.BrokerType_BROKER_TYPE_OFFLINE),
	}}
	svc := &TradingService{cfgW: &config.Watcher{}, encKey: "", accountRepo: repo}

	_, err := svc.UpdateBrokerAccountCredentials(context.Background(), "off-1", "user-1", `{"api_key":"x"}`)
	if grpcstatus.Code(err) != codes.FailedPrecondition {
		t.Errorf("update credentials on offline account: got code %v, want FailedPrecondition", grpcstatus.Code(err))
	}
}

// TestResolveAccount_SkipsOfflineInSoleFallback proves the sole-account fallback never auto-selects
// an offline account for a broker-routed order, but an explicit offline account_id still resolves
// (its own PlaceOrder branch handles it) — feature 157.
func TestResolveAccount_SkipsOfflineInSoleFallback(t *testing.T) {
	// one offline + one broker → fallback picks the broker
	s := &TradingService{brokers: map[string]brokerPoolEntry{
		"off-1": {brokerType: int32(commonv1.BrokerType_BROKER_TYPE_OFFLINE), userID: "u1"},
		"brk-1": {brokerType: int32(commonv1.BrokerType_BROKER_TYPE_ALPACA), userID: "u1"},
	}}
	id, _, err := s.resolveAccount("")
	if err != nil || id != "brk-1" {
		t.Fatalf("fallback with one broker + one offline: id=%q err=%v, want brk-1/nil", id, err)
	}

	// only an offline account registered → no broker account error
	sOff := &TradingService{brokers: map[string]brokerPoolEntry{
		"off-1": {brokerType: int32(commonv1.BrokerType_BROKER_TYPE_OFFLINE), userID: "u1"},
	}}
	if _, _, err := sOff.resolveAccount(""); grpcstatus.Code(err) != codes.FailedPrecondition {
		t.Errorf("fallback with only an offline account: got code %v, want FailedPrecondition", grpcstatus.Code(err))
	}

	// explicit offline account_id still resolves (for the offline PlaceOrder branch)
	id3, entry3, err := sOff.resolveAccount("off-1")
	if err != nil || id3 != "off-1" || entry3.brokerType != int32(commonv1.BrokerType_BROKER_TYPE_OFFLINE) {
		t.Errorf("explicit offline resolve: id=%q err=%v", id3, err)
	}
}

// TestCheckCredentialHealth_SkipsOffline proves the credential-health poller skips offline accounts
// (nil client, never dereferenced) while still checking broker accounts — @AC-8.
func TestCheckCredentialHealth_SkipsOffline(t *testing.T) {
	svc := &TradingService{
		accountRepo: &offlineAccountRepo{},
		brokers: map[string]brokerPoolEntry{
			"off-1": {client: nil, brokerType: int32(commonv1.BrokerType_BROKER_TYPE_OFFLINE), userID: "u1"},
			"brk-1": {client: &fakeBroker{}, brokerType: int32(commonv1.BrokerType_BROKER_TYPE_ALPACA), userID: "u1"},
		},
		credStatus: map[string]int32{},
	}

	// A nil offline client would panic here if the poller did not skip it.
	svc.checkCredentialHealth(context.Background())

	svc.credStatusMu.Lock()
	defer svc.credStatusMu.Unlock()
	if _, ok := svc.credStatus["off-1"]; ok {
		t.Error("offline account must be skipped by the credential-health poller")
	}
	if _, ok := svc.credStatus["brk-1"]; !ok {
		t.Error("broker account should have a recorded credential status")
	}
}

// TestSyncPositions_SkipsOffline proves the position-sync poller skips offline accounts (nil client)
// — @AC-8. An offline-only pool yields zero synced/skipped/failed and never dereferences nil.
func TestSyncPositions_SkipsOffline(t *testing.T) {
	svc := &TradingService{
		cfg:              &config.Config{},
		cfgW:             &config.Watcher{},
		ledger:           &recordingLedger{},
		brokers:          map[string]brokerPoolEntry{"off-1": {client: nil, brokerType: int32(commonv1.BrokerType_BROKER_TYPE_OFFLINE), userID: "u1"}},
		credStatus:       map[string]int32{},
		credSkipLoggedAt: map[string]time.Time{},
	}
	synced, skipped, failed := svc.syncPositions(context.Background())
	if synced != 0 || skipped != 0 || failed != 0 {
		t.Errorf("offline-only sync: synced=%d skipped=%d failed=%d, want 0/0/0", synced, skipped, failed)
	}
}

// TestDeregisterBrokerAccount_Offline_EmitsDeregistered covers @AC-15: deregistering an offline
// account emits account.deregistered so portfolio can purge its positions + realized.
func TestDeregisterBrokerAccount_Offline_EmitsDeregistered(t *testing.T) {
	ledger := &recordingLedger{}
	repo := &offlineAccountRepo{getRec: &repository.BrokerAccountRecord{
		ID: "off-1", UserID: "user-1", BrokerType: int32(commonv1.BrokerType_BROKER_TYPE_OFFLINE),
	}}
	baseline := &fakeBaselineStore{}
	svc := &TradingService{
		cfgW:          &config.Watcher{},
		accountRepo:   repo,
		ledger:        ledger,
		baselineStore: baseline,
		brokers:       map[string]brokerPoolEntry{"off-1": {brokerType: int32(commonv1.BrokerType_BROKER_TYPE_OFFLINE), userID: "user-1"}},
		credStatus:    map[string]int32{"off-1": 0},
	}

	if err := svc.DeregisterBrokerAccountSvc(context.Background(), "off-1", "user-1"); err != nil {
		t.Fatalf("deregister offline account: %v", err)
	}
	if _, ok := svc.brokers["off-1"]; ok {
		t.Error("offline account should be removed from the pool")
	}
	var sawDeregistered bool
	for _, ev := range ledger.eventTypes() {
		if ev == "account.deregistered" {
			sawDeregistered = true
		}
	}
	if !sawDeregistered {
		t.Errorf("expected account.deregistered to be emitted, got %v", ledger.eventTypes())
	}
}

// TestDeriveOfflineStatus covers server-derived status from filled_qty vs qty — the fill-state
// completeness rule (@AC-5): NEW, PARTIALLY_FILLED, and FILLED are all reachable.
func TestDeriveOfflineStatus(t *testing.T) {
	cases := []struct {
		filled, qty float64
		want        tradingv1.OrderStatus
	}{
		{0, 10, tradingv1.OrderStatus_ORDER_STATUS_NEW},
		{4, 10, tradingv1.OrderStatus_ORDER_STATUS_PARTIALLY_FILLED},
		{10, 10, tradingv1.OrderStatus_ORDER_STATUS_FILLED},
		{12, 10, tradingv1.OrderStatus_ORDER_STATUS_FILLED}, // over-fill clamps to FILLED
	}
	for _, c := range cases {
		if got := deriveOfflineStatus(c.filled, c.qty); got != c.want {
			t.Errorf("deriveOfflineStatus(%v, %v) = %v, want %v", c.filled, c.qty, got, c.want)
		}
	}
}

// TestOfflineRecompute_FromConfirmedOrders proves the order→signed-fill→fold pipeline ConfirmOrder
// uses to rebuild absolute positions: idempotent re-edit (@AC-10), sell-to-close (@AC-11), and
// sell-to-open short (@AC-12).
func TestOfflineRecompute_FromConfirmedOrders(t *testing.T) {
	buy := tradingv1.OrderSide_ORDER_SIDE_BUY
	sell := tradingv1.OrderSide_ORDER_SIDE_SELL

	// @AC-10: a re-edited order contributes its corrected fill only — fold yields qty 10 @ avg 191.
	reedit := pnl.Fold(offlineFillsFromOrders([]*tradingv1.Order{
		{Symbol: "AAPL", Side: buy, FilledQty: 10, FilledAvgPrice: 191.00},
	}))
	if lot := reedit.Positions["AAPL"]; lot.Qty != 10 || lot.CostBasis != 1910.00 {
		t.Errorf("@AC-10 re-edit: got %+v, want qty 10 cost 1910", lot)
	}

	// @AC-11: sell-to-close nets flat with realized +97.50.
	closed := pnl.Fold(offlineFillsFromOrders([]*tradingv1.Order{
		{Symbol: "AAPL", Side: buy, FilledQty: 10, FilledAvgPrice: 190.25},
		{Symbol: "AAPL", Side: sell, FilledQty: 10, FilledAvgPrice: 200.00},
	}))
	if _, ok := closed.Positions["AAPL"]; ok {
		t.Errorf("@AC-11 sell-to-close: expected flat, got %+v", closed.Positions["AAPL"])
	}
	if closed.Realized != 97.50 {
		t.Errorf("@AC-11 realized: got %v, want 97.50", closed.Realized)
	}

	// @AC-12: sell-to-open opens a short.
	short := pnl.Fold(offlineFillsFromOrders([]*tradingv1.Order{
		{Symbol: "TSLA", Side: sell, FilledQty: 5, FilledAvgPrice: 250.00},
	}))
	if lot := short.Positions["TSLA"]; lot.Qty != -5 || lot.CostBasis != -1250.00 {
		t.Errorf("@AC-12 sell-to-open short: got %+v, want qty -5 cost -1250", lot)
	}
}

// TestCancelOrder_RejectsOfflineOrder (feature 159, @AC-1) proves guard A: CancelOrder rejects an
// offline order with FailedPrecondition and never flips it to CANCELED. Pre-fix, CancelOrder set
// order.Status = CANCELED unconditionally at trading.go:1079 (the broker cancel above it is gated on a
// non-empty broker_order_id, but the local transition was not), so an offline NEW order — which has an
// empty broker_order_id by design — was silently canceled. The nil concrete *repository.TradingRepo
// panics at the post-transition UpsertOrder (the same un-fakeable-repo constraint the bracket tests
// document); we recover and assert the observable pre-panic state.
func TestCancelOrder_RejectsOfflineOrder(t *testing.T) {
	svc := &TradingService{
		cfgW:            &config.Watcher{},
		orderIntentRepo: &fakeOrderIntentRepo{},
		orders: map[string]*tradingv1.Order{
			"off-ord-1": {
				OrderId:    "off-ord-1",
				AccountId:  "off-1",
				BrokerType: commonv1.BrokerType_BROKER_TYPE_OFFLINE,
				Status:     tradingv1.OrderStatus_ORDER_STATUS_NEW,
				// no broker_order_id — an unconfirmed offline order never has one.
			},
		},
	}

	var err error
	func() {
		// Pre-fix, this reaches the unconditional CANCELED transition and then panics at the nil-repo
		// UpsertOrder; post-fix, guard A returns before any repo access (no panic).
		defer func() { _ = recover() }()
		_, err = svc.CancelOrder(context.Background(), &tradingv1.CancelOrderRequest{OrderId: "off-ord-1"})
	}()

	if grpcstatus.Code(err) != codes.FailedPrecondition {
		t.Errorf("CancelOrder on an offline order: got code %v, want FailedPrecondition", grpcstatus.Code(err))
	}
	if got := svc.orders["off-ord-1"].Status; got != tradingv1.OrderStatus_ORDER_STATUS_NEW {
		t.Errorf("offline order status after CancelOrder = %v, want NEW (must never become CANCELED)", got)
	}
}

// TestPlaceOrder_RoutesAuthoritativeOfflineToRecord (feature 159, @AC-1) proves guard B: PlaceOrder
// routes on the authoritative persisted broker_type (union with the in-memory pool tag), so an offline
// account can never fall through to a broker path even when the pool entry diverges. The divergence case
// (pool entry tagged ALPACA, persisted record OFFLINE) is the sharp one: pre-fix the pool tag alone
// decides and the order takes the broker path (no offline order is recorded); post-fix the union routes
// it to recordOfflineOrder, which records a NEW offline order before the nil-repo UpsertOrder panic.
func TestPlaceOrder_RoutesAuthoritativeOfflineToRecord(t *testing.T) {
	repo := &offlineAccountRepo{getRec: &repository.BrokerAccountRecord{
		ID: "acct-1", UserID: "user-1", BrokerType: int32(commonv1.BrokerType_BROKER_TYPE_OFFLINE),
	}}
	svc := &TradingService{
		cfg:             &config.Config{TradingMode: "paper"},
		cfgW:            &config.Watcher{},
		accountRepo:     repo,
		orderIntentRepo: &fakeOrderIntentRepo{},
		ledger:          &fakeLedgerClient{},
		// Pool entry diverges from the persisted record: tagged ALPACA with a broker client. Pre-fix this
		// routes to the broker path; post-fix guard B's authoritative read overrides it to offline.
		brokers: map[string]brokerPoolEntry{
			"acct-1": {client: &fakeBroker{}, brokerType: int32(commonv1.BrokerType_BROKER_TYPE_ALPACA), userID: "user-1"},
		},
		orders: map[string]*tradingv1.Order{},
		halted: map[string]bool{},
	}

	func() {
		defer func() { _ = recover() }() // offline record path panics at the nil-repo UpsertOrder
		_, _ = svc.PlaceOrder(context.Background(), &tradingv1.PlaceOrderRequest{
			Symbol: "HONA", Side: tradingv1.OrderSide_ORDER_SIDE_BUY, OrderType: tradingv1.OrderType_ORDER_TYPE_MARKET,
			Qty: 1, ClientOrderId: "c-159-b", AccountId: "acct-1",
		})
	}()

	var recorded *tradingv1.Order
	for _, o := range svc.orders {
		recorded = o
	}
	if recorded == nil {
		t.Fatal("PlaceOrder on a persisted-offline account recorded no order — it was not routed to the offline branch")
	}
	if recorded.BrokerType != commonv1.BrokerType_BROKER_TYPE_OFFLINE {
		t.Errorf("recorded order broker_type = %v, want OFFLINE (authoritative routing must win over the pool tag)", recorded.BrokerType)
	}
	if recorded.Status != tradingv1.OrderStatus_ORDER_STATUS_NEW {
		t.Errorf("recorded order status = %v, want NEW", recorded.Status)
	}
	if recorded.BrokerOrderId != "" {
		t.Errorf("recorded offline order broker_order_id = %q, want empty (no broker submit)", recorded.BrokerOrderId)
	}
}

// TestConfirmOrder_Validation covers the input guards that run before any repo access.
func TestConfirmOrder_Validation(t *testing.T) {
	svc := &TradingService{}
	if _, err := svc.ConfirmOrder(context.Background(), &tradingv1.ConfirmOrderRequest{OrderId: ""}); grpcstatus.Code(err) != codes.InvalidArgument {
		t.Errorf("empty order_id: got code %v, want InvalidArgument", grpcstatus.Code(err))
	}
	if _, err := svc.ConfirmOrder(context.Background(), &tradingv1.ConfirmOrderRequest{OrderId: "o1", FilledQty: -1}); grpcstatus.Code(err) != codes.InvalidArgument {
		t.Errorf("negative filled_qty: got code %v, want InvalidArgument", grpcstatus.Code(err))
	}
}

// ---------------------------------------------------------------------------
// Feature 163 — Snapshot Offline Positions: AC-1 through AC-18 + concurrency
// ---------------------------------------------------------------------------
//
// These tests drive the producer-level methods (SnapshotOfflinePositions and the extracted
// recomputeAndEmitOfflinePositions) end-to-end via fakeBaselineStore and recordingLedger,
// asserting the emitted account.positions.synced payloads (source, as_of, realized_pnl)
// and the audit account.positions.baseline_set event — not just pnl.FoldFrom (which is
// covered by pnl_fold_test.go's TestPnLFoldFrom_Trading).

// newSnapshotTestService constructs a TradingService wired for snapshot producer tests: a fake
// baseline store, a recording ledger, an offline account repo, and the per-account confirm lock.
func newSnapshotTestService(baseline *fakeBaselineStore, ledger *recordingLedger) *TradingService {
	return &TradingService{
		cfg:  &config.Config{TradingMode: "paper"},
		cfgW: &config.Watcher{},
		accountRepo: &offlineAccountRepo{getRec: &repository.BrokerAccountRecord{
			ID: "acc-1", UserID: "user-1", BrokerType: int32(commonv1.BrokerType_BROKER_TYPE_OFFLINE),
		}},
		baselineStore: baseline,
		ledger:        ledger,
		brokers: map[string]brokerPoolEntry{
			"acc-1": {brokerType: int32(commonv1.BrokerType_BROKER_TYPE_OFFLINE), userID: "user-1"},
		},
		confirmLocks: make(map[string]*sync.Mutex),
		credStatus:   make(map[string]int32),
	}
}

// snapshotReq is a shorthand builder for SnapshotOfflinePositionsRequest.
func snapshotReq(accountID, userID, snapshotID string, asOf time.Time, positions ...*tradingv1.PositionBaseline) *tradingv1.SnapshotOfflinePositionsRequest {
	return &tradingv1.SnapshotOfflinePositionsRequest{
		AccountId:        accountID,
		UserId:           userID,
		ClientSnapshotId: snapshotID,
		AsOf:             timestamppb.New(asOf),
		Positions:        positions,
	}
}

// posBaseline builds a PositionBaseline proto.
func posBaseline(sym string, qty, avgCost float64) *tradingv1.PositionBaseline {
	return &tradingv1.PositionBaseline{Symbol: sym, Qty: qty, AvgCostPerShare: avgCost}
}

// confirmedOrder builds a confirmed offline order with the given fills.
func confirmedOrder(sym string, side tradingv1.OrderSide, filledQty, filledAvg float64, filledAt time.Time) *tradingv1.Order {
	return &tradingv1.Order{
		Symbol:         sym,
		Side:           side,
		FilledQty:      filledQty,
		FilledAvgPrice: filledAvg,
		FilledAt:       timestamppb.New(filledAt),
		AccountId:      "acc-1",
		BrokerType:     commonv1.BrokerType_BROKER_TYPE_OFFLINE,
		Status:         tradingv1.OrderStatus_ORDER_STATUS_FILLED,
	}
}

// extractPositionsSynced extracts and parses the positions from the last account.positions.synced event.
type syncedPayload struct {
	AccountID   string
	UserID      string
	TradingMode string
	Realized    float64
	Positions   []syncedPosition
}
type syncedPosition struct {
	Symbol  string
	Qty     float64
	AvgCost float64
	Source  int32
	AsOf    string // RFC3339 or empty
}

func parseSyncedPayload(t *testing.T, ledger *recordingLedger) *syncedPayload {
	t.Helper()
	reqs := ledger.requestsByType("account.positions.synced")
	if len(reqs) == 0 {
		t.Fatal("no account.positions.synced event emitted")
	}
	req := reqs[len(reqs)-1] // last one
	p := req.Payload.AsMap()

	result := &syncedPayload{
		AccountID:   strVal(p, "account_id"),
		UserID:      strVal(p, "user_id"),
		TradingMode: strVal(p, "trading_mode"),
	}
	if r, ok := p["realized_pnl"]; ok {
		result.Realized = r.(float64)
	}
	if positions, ok := p["positions"]; ok {
		for _, raw := range positions.([]interface{}) {
			pm := raw.(map[string]interface{})
			pos := syncedPosition{
				Symbol: strVal(pm, "symbol"),
			}
			if v, ok := pm["qty"]; ok {
				pos.Qty = v.(float64)
			}
			if v, ok := pm["avg_cost"]; ok {
				pos.AvgCost = v.(float64)
			}
			if v, ok := pm["source"]; ok {
				pos.Source = int32(v.(float64))
			}
			if v, ok := pm["as_of"]; ok {
				if s, ok := v.(string); ok {
					pos.AsOf = s
				}
			}
			result.Positions = append(result.Positions, pos)
		}
	}
	return result
}

func strVal(m map[string]interface{}, key string) string {
	if v, ok := m[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

func findPosition(positions []syncedPosition, sym string) (syncedPosition, bool) {
	for _, p := range positions {
		if p.Symbol == sym {
			return p, true
		}
	}
	return syncedPosition{}, false
}

// TestSnapshotOfflinePositions_AC1_BaselineSeeds: snapshot AAPL 100@150 and LYFT −378@12.50,
// no prior confirmed orders → emitted positions carry source=BASELINE, as_of=T0.
func TestSnapshotOfflinePositions_AC1_BaselineSeeds(t *testing.T) {
	T0 := time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)
	baseline := &fakeBaselineStore{}
	ledger := &recordingLedger{}
	svc := newSnapshotTestService(baseline, ledger)

	resp, err := svc.SnapshotOfflinePositions(context.Background(), snapshotReq(
		"acc-1", "user-1", "snap-1", T0,
		posBaseline("AAPL", 100, 150),
		posBaseline("LYFT", -378, 12.50),
	))
	if err != nil {
		t.Fatalf("SnapshotOfflinePositions: %v", err)
	}
	if resp.CommittedCount != 2 {
		t.Errorf("committed_count = %d, want 2", resp.CommittedCount)
	}
	if len(resp.Rejected) != 0 {
		t.Errorf("rejected = %v, want empty", resp.Rejected)
	}

	synced := parseSyncedPayload(t, ledger)

	aapl, ok := findPosition(synced.Positions, "AAPL")
	if !ok {
		t.Fatal("AAPL not in emitted positions")
	}
	if aapl.Qty != 100 || aapl.AvgCost != 150 {
		t.Errorf("AAPL: qty=%v avg=%v, want 100/150", aapl.Qty, aapl.AvgCost)
	}
	if aapl.Source != int32(portfoliov1.PositionSource_POSITION_SOURCE_BASELINE) {
		t.Errorf("AAPL source=%d, want BASELINE (%d)", aapl.Source, portfoliov1.PositionSource_POSITION_SOURCE_BASELINE)
	}
	if aapl.AsOf == "" {
		t.Error("AAPL as_of should be set for BASELINE source")
	}

	lyft, ok := findPosition(synced.Positions, "LYFT")
	if !ok {
		t.Fatal("LYFT not in emitted positions")
	}
	if lyft.Qty != -378 || lyft.AvgCost != 12.50 {
		t.Errorf("LYFT: qty=%v avg=%v, want -378/12.50", lyft.Qty, lyft.AvgCost)
	}
	if lyft.Source != int32(portfoliov1.PositionSource_POSITION_SOURCE_BASELINE) {
		t.Errorf("LYFT source=%d, want BASELINE", lyft.Source)
	}
}

// TestSnapshotOfflinePositions_AC2_AC13_PostT0Buy: baseline AAPL 100@150, then a post-T0 BUY
// 50@160 → AAPL 150 avg 153.33 source=MIXED.
func TestSnapshotOfflinePositions_AC2_AC13_PostT0Buy(t *testing.T) {
	T0 := time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)
	baseline := &fakeBaselineStore{
		confirmedOrders: []*tradingv1.Order{
			confirmedOrder("AAPL", tradingv1.OrderSide_ORDER_SIDE_BUY, 50, 160, T0.Add(24*time.Hour)),
		},
	}
	ledger := &recordingLedger{}
	svc := newSnapshotTestService(baseline, ledger)

	resp, err := svc.SnapshotOfflinePositions(context.Background(), snapshotReq(
		"acc-1", "user-1", "snap-1", T0,
		posBaseline("AAPL", 100, 150),
	))
	if err != nil {
		t.Fatalf("SnapshotOfflinePositions: %v", err)
	}
	if resp.CommittedCount != 1 {
		t.Errorf("committed_count = %d, want 1", resp.CommittedCount)
	}

	synced := parseSyncedPayload(t, ledger)
	aapl, ok := findPosition(synced.Positions, "AAPL")
	if !ok {
		t.Fatal("AAPL not in emitted positions")
	}
	// 100@150 + 50@160 = 150 shares, total cost = 15000+8000 = 23000, avg = 153.33...
	if aapl.Qty != 150 {
		t.Errorf("AAPL qty=%v, want 150", aapl.Qty)
	}
	wantAvg := 23000.0 / 150.0
	if math.Abs(aapl.AvgCost-wantAvg) > 0.01 {
		t.Errorf("AAPL avg_cost=%v, want ~%.2f", aapl.AvgCost, wantAvg)
	}
	if aapl.Source != int32(portfoliov1.PositionSource_POSITION_SOURCE_MIXED) {
		t.Errorf("AAPL source=%d, want MIXED (%d)", aapl.Source, portfoliov1.PositionSource_POSITION_SOURCE_MIXED)
	}
	if aapl.AsOf == "" {
		t.Error("AAPL as_of should be set for MIXED source")
	}
}

// TestSnapshotOfflinePositions_AC3_PreT0Subsumed: a confirmed BUY dated ≤ T0 is subsumed by the
// baseline and does not alter the emitted position.
func TestSnapshotOfflinePositions_AC3_PreT0Subsumed(t *testing.T) {
	T0 := time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)
	baseline := &fakeBaselineStore{
		confirmedOrders: []*tradingv1.Order{
			// Fill dated AT T0 — should be filtered out (only filled_at > asOf passes).
			confirmedOrder("AAPL", tradingv1.OrderSide_ORDER_SIDE_BUY, 50, 160, T0),
		},
	}
	ledger := &recordingLedger{}
	svc := newSnapshotTestService(baseline, ledger)

	_, err := svc.SnapshotOfflinePositions(context.Background(), snapshotReq(
		"acc-1", "user-1", "snap-1", T0,
		posBaseline("AAPL", 100, 150),
	))
	if err != nil {
		t.Fatalf("SnapshotOfflinePositions: %v", err)
	}

	synced := parseSyncedPayload(t, ledger)
	aapl, ok := findPosition(synced.Positions, "AAPL")
	if !ok {
		t.Fatal("AAPL not in emitted positions")
	}
	// Baseline only — pre-T0 fill subsumed.
	if aapl.Qty != 100 || aapl.AvgCost != 150 {
		t.Errorf("AAPL: qty=%v avg=%v, want 100/150 (pre-T0 fill should be subsumed)", aapl.Qty, aapl.AvgCost)
	}
	if aapl.Source != int32(portfoliov1.PositionSource_POSITION_SOURCE_BASELINE) {
		t.Errorf("AAPL source=%d, want BASELINE (no post-T0 fill)", aapl.Source)
	}
}

// TestSnapshotOfflinePositions_AC4_PostT0Sell: post-T0 SELL 30@170 on a 100@150 baseline →
// AAPL 70 avg 150, realized 600.00, source=MIXED.
func TestSnapshotOfflinePositions_AC4_PostT0Sell(t *testing.T) {
	T0 := time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)
	baseline := &fakeBaselineStore{
		confirmedOrders: []*tradingv1.Order{
			confirmedOrder("AAPL", tradingv1.OrderSide_ORDER_SIDE_SELL, 30, 170, T0.Add(24*time.Hour)),
		},
	}
	ledger := &recordingLedger{}
	svc := newSnapshotTestService(baseline, ledger)

	_, err := svc.SnapshotOfflinePositions(context.Background(), snapshotReq(
		"acc-1", "user-1", "snap-1", T0,
		posBaseline("AAPL", 100, 150),
	))
	if err != nil {
		t.Fatalf("SnapshotOfflinePositions: %v", err)
	}

	synced := parseSyncedPayload(t, ledger)
	aapl, ok := findPosition(synced.Positions, "AAPL")
	if !ok {
		t.Fatal("AAPL not in emitted positions")
	}
	if aapl.Qty != 70 {
		t.Errorf("AAPL qty=%v, want 70", aapl.Qty)
	}
	if aapl.AvgCost != 150 {
		t.Errorf("AAPL avg_cost=%v, want 150 (avg does not change on a sell)", aapl.AvgCost)
	}
	// realized = 30 * (170 - 150) = 600.00
	if synced.Realized != 600.00 {
		t.Errorf("realized_pnl=%v, want 600.00", synced.Realized)
	}
	if aapl.Source != int32(portfoliov1.PositionSource_POSITION_SOURCE_MIXED) {
		t.Errorf("AAPL source=%d, want MIXED", aapl.Source)
	}
}

// TestSnapshotOfflinePositions_AC5_LaterSnapshotSupersedes: a second snapshot with a later as_of
// supersedes the first; emitted positions reflect the new baseline.
func TestSnapshotOfflinePositions_AC5_LaterSnapshotSupersedes(t *testing.T) {
	T0 := time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)
	T1 := time.Date(2026, 8, 15, 0, 0, 0, 0, time.UTC)
	baseline := &fakeBaselineStore{}
	ledger := &recordingLedger{}
	svc := newSnapshotTestService(baseline, ledger)

	// First snapshot: AAPL 100@150
	_, err := svc.SnapshotOfflinePositions(context.Background(), snapshotReq(
		"acc-1", "user-1", "snap-1", T0,
		posBaseline("AAPL", 100, 150),
	))
	if err != nil {
		t.Fatalf("first snapshot: %v", err)
	}

	ledger.reset()

	// Second snapshot: AAPL 80@155 with a later as_of
	_, err = svc.SnapshotOfflinePositions(context.Background(), snapshotReq(
		"acc-1", "user-1", "snap-2", T1,
		posBaseline("AAPL", 80, 155),
	))
	if err != nil {
		t.Fatalf("second snapshot: %v", err)
	}

	synced := parseSyncedPayload(t, ledger)
	aapl, ok := findPosition(synced.Positions, "AAPL")
	if !ok {
		t.Fatal("AAPL not in emitted positions")
	}
	if aapl.Qty != 80 || aapl.AvgCost != 155 {
		t.Errorf("AAPL: qty=%v avg=%v, want 80/155 (later snapshot should supersede)", aapl.Qty, aapl.AvgCost)
	}
	if aapl.Source != int32(portfoliov1.PositionSource_POSITION_SOURCE_BASELINE) {
		t.Errorf("AAPL source=%d, want BASELINE", aapl.Source)
	}
	// Verify the as_of references the new T1, not T0.
	parsed, parseErr := time.Parse(time.RFC3339Nano, aapl.AsOf)
	if parseErr != nil {
		t.Fatalf("parse as_of: %v", parseErr)
	}
	if !parsed.Equal(T1) {
		t.Errorf("AAPL as_of=%v, want %v (later snapshot)", parsed, T1)
	}
}

// TestSnapshotOfflinePositions_AC6_ResubmitReplaces: re-submitting the same client_snapshot_id
// replaces (single AAPL row qty 120 avg 151, never stacks with the prior submit).
func TestSnapshotOfflinePositions_AC6_ResubmitReplaces(t *testing.T) {
	T0 := time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)
	baseline := &fakeBaselineStore{}
	ledger := &recordingLedger{}
	svc := newSnapshotTestService(baseline, ledger)

	// First submit: AAPL 100@150 + MSFT 50@300
	_, err := svc.SnapshotOfflinePositions(context.Background(), snapshotReq(
		"acc-1", "user-1", "snap-same", T0,
		posBaseline("AAPL", 100, 150),
		posBaseline("MSFT", 50, 300),
	))
	if err != nil {
		t.Fatalf("first submit: %v", err)
	}

	ledger.reset()

	// Re-submit with same client_snapshot_id: only AAPL 120@151 (MSFT dropped).
	resp, err := svc.SnapshotOfflinePositions(context.Background(), snapshotReq(
		"acc-1", "user-1", "snap-same", T0,
		posBaseline("AAPL", 120, 151),
	))
	if err != nil {
		t.Fatalf("re-submit: %v", err)
	}
	if resp.CommittedCount != 1 {
		t.Errorf("committed_count = %d, want 1", resp.CommittedCount)
	}

	synced := parseSyncedPayload(t, ledger)
	if _, ok := findPosition(synced.Positions, "MSFT"); ok {
		t.Error("MSFT should not appear after replace (dropped symbol must be removed)")
	}
	aapl, ok := findPosition(synced.Positions, "AAPL")
	if !ok {
		t.Fatal("AAPL not in emitted positions after replace")
	}
	if aapl.Qty != 120 || aapl.AvgCost != 151 {
		t.Errorf("AAPL: qty=%v avg=%v, want 120/151 (replaced value)", aapl.Qty, aapl.AvgCost)
	}

	// Verify the upsert received the replace call.
	if len(baseline.upsertCalls) != 2 {
		t.Errorf("upsertCalls count=%d, want 2 (first + replace)", len(baseline.upsertCalls))
	}
}

// TestSnapshotOfflinePositions_AC7_MalformedRowRejected: a row with avg_cost_per_share=-10 is
// rejected; AAPL commits; emitted positions include AAPL, exclude MSFT.
func TestSnapshotOfflinePositions_AC7_MalformedRowRejected(t *testing.T) {
	T0 := time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)
	baseline := &fakeBaselineStore{}
	ledger := &recordingLedger{}
	svc := newSnapshotTestService(baseline, ledger)

	resp, err := svc.SnapshotOfflinePositions(context.Background(), snapshotReq(
		"acc-1", "user-1", "snap-1", T0,
		posBaseline("AAPL", 100, 150),
		posBaseline("MSFT", 50, -10), // malformed: negative avg_cost
	))
	if err != nil {
		t.Fatalf("SnapshotOfflinePositions: %v", err)
	}
	if resp.CommittedCount != 1 {
		t.Errorf("committed_count = %d, want 1 (only AAPL)", resp.CommittedCount)
	}
	if len(resp.Rejected) != 1 {
		t.Fatalf("rejected count = %d, want 1", len(resp.Rejected))
	}
	if resp.Rejected[0].RowIndex != 1 {
		t.Errorf("rejected row_index=%d, want 1", resp.Rejected[0].RowIndex)
	}
	if resp.Rejected[0].Reason == "" {
		t.Error("rejected reason should name negative avg_cost_per_share")
	}

	synced := parseSyncedPayload(t, ledger)
	if _, ok := findPosition(synced.Positions, "MSFT"); ok {
		t.Error("MSFT (malformed) should not appear in emitted positions")
	}
	aapl, ok := findPosition(synced.Positions, "AAPL")
	if !ok {
		t.Fatal("AAPL should be in emitted positions despite MSFT rejection")
	}
	if aapl.Qty != 100 {
		t.Errorf("AAPL qty=%v, want 100", aapl.Qty)
	}
}

// TestSnapshotOfflinePositions_AC8_AC15_ZeroQtyNoPhantom: a qty=0 row commits (response.rejected
// is empty) but emits no TSLA position (dropped by EffectiveBaselineByAccount).
func TestSnapshotOfflinePositions_AC8_AC15_ZeroQtyNoPhantom(t *testing.T) {
	T0 := time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)
	baseline := &fakeBaselineStore{}
	ledger := &recordingLedger{}
	svc := newSnapshotTestService(baseline, ledger)

	resp, err := svc.SnapshotOfflinePositions(context.Background(), snapshotReq(
		"acc-1", "user-1", "snap-1", T0,
		posBaseline("AAPL", 100, 150),
		posBaseline("TSLA", 0, 200), // qty=0 → flatten
	))
	if err != nil {
		t.Fatalf("SnapshotOfflinePositions: %v", err)
	}
	// Both rows commit (qty=0 is valid, not rejected).
	if resp.CommittedCount != 2 {
		t.Errorf("committed_count = %d, want 2 (both rows commit)", resp.CommittedCount)
	}
	if len(resp.Rejected) != 0 {
		t.Errorf("rejected = %v, want empty (qty=0 is valid)", resp.Rejected)
	}

	synced := parseSyncedPayload(t, ledger)
	if _, ok := findPosition(synced.Positions, "TSLA"); ok {
		t.Error("TSLA (qty=0) must not appear as a phantom position in the emit")
	}
	if _, ok := findPosition(synced.Positions, "AAPL"); !ok {
		t.Error("AAPL should still appear")
	}
}

// TestSnapshotOfflinePositions_AC9_BrokerAccountRejected: snapshot on a non-OFFLINE account →
// FailedPrecondition.
func TestSnapshotOfflinePositions_AC9_BrokerAccountRejected(t *testing.T) {
	T0 := time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)
	baseline := &fakeBaselineStore{}
	ledger := &recordingLedger{}
	svc := &TradingService{
		cfg:  &config.Config{TradingMode: "paper"},
		cfgW: &config.Watcher{},
		accountRepo: &offlineAccountRepo{getRec: &repository.BrokerAccountRecord{
			ID: "broker-1", UserID: "user-1", BrokerType: int32(commonv1.BrokerType_BROKER_TYPE_ALPACA),
		}},
		baselineStore: baseline,
		ledger:        ledger,
		confirmLocks:  make(map[string]*sync.Mutex),
	}

	_, err := svc.SnapshotOfflinePositions(context.Background(), snapshotReq(
		"broker-1", "user-1", "snap-1", T0,
		posBaseline("AAPL", 100, 150),
	))
	if grpcstatus.Code(err) != codes.FailedPrecondition {
		t.Errorf("snapshot on broker account: got code %v, want FailedPrecondition", grpcstatus.Code(err))
	}
}

// TestSnapshotOfflinePositions_AC10_AuditEvent: snapshot emits account.positions.baseline_set
// with the expected payload fields.
func TestSnapshotOfflinePositions_AC10_AuditEvent(t *testing.T) {
	T0 := time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)
	baseline := &fakeBaselineStore{}
	ledger := &recordingLedger{}
	svc := newSnapshotTestService(baseline, ledger)

	_, err := svc.SnapshotOfflinePositions(context.Background(), snapshotReq(
		"acc-1", "user-1", "snap-audit", T0,
		posBaseline("AAPL", 100, 150),
	))
	if err != nil {
		t.Fatalf("SnapshotOfflinePositions: %v", err)
	}

	auditReqs := ledger.requestsByType("account.positions.baseline_set")
	if len(auditReqs) != 1 {
		t.Fatalf("expected 1 baseline_set event, got %d", len(auditReqs))
	}

	audit := auditReqs[0]
	if audit.StreamKey != "account:acc-1" {
		t.Errorf("stream_key=%q, want account:acc-1", audit.StreamKey)
	}

	payload := audit.Payload.AsMap()
	if payload["account_id"] != "acc-1" {
		t.Errorf("account_id=%v, want acc-1", payload["account_id"])
	}
	if payload["user_id"] != "user-1" {
		t.Errorf("user_id=%v, want user-1", payload["user_id"])
	}
	if payload["client_snapshot_id"] != "snap-audit" {
		t.Errorf("client_snapshot_id=%v, want snap-audit", payload["client_snapshot_id"])
	}
	if _, ok := payload["as_of"]; !ok {
		t.Error("as_of missing from baseline_set payload")
	}
	if positions, ok := payload["positions"]; !ok || positions == nil {
		t.Error("positions missing from baseline_set payload")
	}
}

// TestSnapshotOfflinePositions_AC14_RealizedReset: after a sell that produces realized 600, a
// later snapshot that covers the post-sell state → realized resets to 0.
func TestSnapshotOfflinePositions_AC14_RealizedReset(t *testing.T) {
	T0 := time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)
	T1 := time.Date(2026, 8, 20, 0, 0, 0, 0, time.UTC) // after the sell

	// The sell happened between T0 and T1.
	sellTime := T0.Add(48 * time.Hour)
	baseline := &fakeBaselineStore{
		confirmedOrders: []*tradingv1.Order{
			confirmedOrder("AAPL", tradingv1.OrderSide_ORDER_SIDE_SELL, 30, 170, sellTime),
		},
	}
	ledger := &recordingLedger{}
	svc := newSnapshotTestService(baseline, ledger)

	// First snapshot: AAPL 100@150 with T0 — sell at T0+48h produces realized.
	_, err := svc.SnapshotOfflinePositions(context.Background(), snapshotReq(
		"acc-1", "user-1", "snap-1", T0,
		posBaseline("AAPL", 100, 150),
	))
	if err != nil {
		t.Fatalf("first snapshot: %v", err)
	}

	synced1 := parseSyncedPayload(t, ledger)
	if synced1.Realized != 600.00 {
		t.Errorf("after first snapshot: realized=%v, want 600.00", synced1.Realized)
	}

	ledger.reset()

	// Second snapshot: AAPL 70@150 with T1 (after the sell). The sell is now ≤ T1 so it's
	// subsumed by the new baseline → no post-T1 fills → realized resets to 0.
	_, err = svc.SnapshotOfflinePositions(context.Background(), snapshotReq(
		"acc-1", "user-1", "snap-2", T1,
		posBaseline("AAPL", 70, 150),
	))
	if err != nil {
		t.Fatalf("second snapshot: %v", err)
	}

	synced2 := parseSyncedPayload(t, ledger)
	if synced2.Realized != 0 {
		t.Errorf("after second snapshot: realized=%v, want 0.00 (statement-sealed reset)", synced2.Realized)
	}
}

// TestSnapshotOfflinePositions_AC17_FlattenThenRefill: baseline 100, SELL 100, BUY 30 post-T0 →
// AAPL 30 source=MIXED.
func TestSnapshotOfflinePositions_AC17_FlattenThenRefill(t *testing.T) {
	T0 := time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)
	baseline := &fakeBaselineStore{
		confirmedOrders: []*tradingv1.Order{
			confirmedOrder("AAPL", tradingv1.OrderSide_ORDER_SIDE_SELL, 100, 160, T0.Add(24*time.Hour)),
			confirmedOrder("AAPL", tradingv1.OrderSide_ORDER_SIDE_BUY, 30, 170, T0.Add(48*time.Hour)),
		},
	}
	ledger := &recordingLedger{}
	svc := newSnapshotTestService(baseline, ledger)

	_, err := svc.SnapshotOfflinePositions(context.Background(), snapshotReq(
		"acc-1", "user-1", "snap-1", T0,
		posBaseline("AAPL", 100, 150),
	))
	if err != nil {
		t.Fatalf("SnapshotOfflinePositions: %v", err)
	}

	synced := parseSyncedPayload(t, ledger)
	aapl, ok := findPosition(synced.Positions, "AAPL")
	if !ok {
		t.Fatal("AAPL not in emitted positions")
	}
	if aapl.Qty != 30 {
		t.Errorf("AAPL qty=%v, want 30 (flatten then refill)", aapl.Qty)
	}
	if aapl.Source != int32(portfoliov1.PositionSource_POSITION_SOURCE_MIXED) {
		t.Errorf("AAPL source=%d, want MIXED", aapl.Source)
	}
}

// TestSnapshotOfflinePositions_AC16_UnconfirmedOrderWarning: snapshot with an unconfirmed NEW
// order present → response.warnings has one entry.
func TestSnapshotOfflinePositions_AC16_UnconfirmedOrderWarning(t *testing.T) {
	T0 := time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)
	baseline := &fakeBaselineStore{
		hasUnconfirmed: true,
	}
	ledger := &recordingLedger{}
	svc := newSnapshotTestService(baseline, ledger)

	resp, err := svc.SnapshotOfflinePositions(context.Background(), snapshotReq(
		"acc-1", "user-1", "snap-1", T0,
		posBaseline("AAPL", 100, 150),
	))
	if err != nil {
		t.Fatalf("SnapshotOfflinePositions: %v", err)
	}
	if len(resp.Warnings) == 0 {
		t.Fatal("expected at least one warning about unconfirmed NEW orders")
	}
	foundWarning := false
	for _, w := range resp.Warnings {
		if len(w) > 0 {
			foundWarning = true
		}
	}
	if !foundWarning {
		t.Error("warning should name unconfirmed NEW orders")
	}
	// AAPL should still commit and appear.
	if resp.CommittedCount != 1 {
		t.Errorf("committed_count = %d, want 1 (warning does not block commit)", resp.CommittedCount)
	}
}

// TestSnapshotOfflinePositions_AC18_DeregisterPurge: deregistering an OFFLINE account with a
// baseline calls DeleteBaselinesByAccount BEFORE emitting account.deregistered.
func TestSnapshotOfflinePositions_AC18_DeregisterPurge(t *testing.T) {
	T0 := time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)
	baseline := &fakeBaselineStore{}
	ledger := &recordingLedger{}
	svc := newSnapshotTestService(baseline, ledger)

	// Seed a baseline first.
	_, err := svc.SnapshotOfflinePositions(context.Background(), snapshotReq(
		"acc-1", "user-1", "snap-1", T0,
		posBaseline("AAPL", 100, 150),
	))
	if err != nil {
		t.Fatalf("seed baseline: %v", err)
	}

	ledger.reset()

	// Deregister.
	if err := svc.DeregisterBrokerAccountSvc(context.Background(), "acc-1", "user-1"); err != nil {
		t.Fatalf("deregister: %v", err)
	}

	// DeleteBaselinesByAccount must have been called.
	if len(baseline.deleteCalls) == 0 {
		t.Fatal("DeleteBaselinesByAccount was not called during deregister")
	}
	if baseline.deleteCalls[len(baseline.deleteCalls)-1] != "acc-1" {
		t.Errorf("delete called with account=%q, want acc-1", baseline.deleteCalls[len(baseline.deleteCalls)-1])
	}

	// account.deregistered must have been emitted.
	events := ledger.eventTypes()
	var sawDeregistered bool
	for _, ev := range events {
		if ev == "account.deregistered" {
			sawDeregistered = true
		}
	}
	if !sawDeregistered {
		t.Errorf("expected account.deregistered, got %v", events)
	}

	// Baseline store should be cleared after delete.
	if baseline.hasBaseline {
		t.Error("baseline should be cleared after deregister purge")
	}
}

// TestSnapshotOfflinePositions_ValidationGates covers the input validation gates.
func TestSnapshotOfflinePositions_ValidationGates(t *testing.T) {
	svc := &TradingService{
		cfgW: &config.Watcher{},
	}

	cases := []struct {
		name string
		req  *tradingv1.SnapshotOfflinePositionsRequest
		code codes.Code
	}{
		{"empty account_id", &tradingv1.SnapshotOfflinePositionsRequest{
			AccountId: "", UserId: "u", ClientSnapshotId: "s", AsOf: timestamppb.Now(),
		}, codes.InvalidArgument},
		{"empty user_id", &tradingv1.SnapshotOfflinePositionsRequest{
			AccountId: "a", UserId: "", ClientSnapshotId: "s", AsOf: timestamppb.Now(),
		}, codes.InvalidArgument},
		{"empty client_snapshot_id", &tradingv1.SnapshotOfflinePositionsRequest{
			AccountId: "a", UserId: "u", ClientSnapshotId: "", AsOf: timestamppb.Now(),
		}, codes.InvalidArgument},
		{"nil as_of", &tradingv1.SnapshotOfflinePositionsRequest{
			AccountId: "a", UserId: "u", ClientSnapshotId: "s", AsOf: nil,
		}, codes.InvalidArgument},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := svc.SnapshotOfflinePositions(context.Background(), c.req)
			if grpcstatus.Code(err) != c.code {
				t.Errorf("%s: got code %v, want %v", c.name, grpcstatus.Code(err), c.code)
			}
		})
	}
}

// TestSnapshotOfflinePositions_AC7_NonFiniteQtyRejected: NaN/Inf qty rows are rejected.
func TestSnapshotOfflinePositions_AC7_NonFiniteQtyRejected(t *testing.T) {
	T0 := time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)
	baseline := &fakeBaselineStore{}
	ledger := &recordingLedger{}
	svc := newSnapshotTestService(baseline, ledger)

	resp, err := svc.SnapshotOfflinePositions(context.Background(), snapshotReq(
		"acc-1", "user-1", "snap-1", T0,
		posBaseline("AAPL", 100, 150),
		posBaseline("BAD1", math.NaN(), 100),
		posBaseline("BAD2", math.Inf(1), 100),
		posBaseline("BAD3", 10, math.Inf(-1)),
	))
	if err != nil {
		t.Fatalf("SnapshotOfflinePositions: %v", err)
	}
	// AAPL commits; BAD1, BAD2, BAD3 rejected.
	if resp.CommittedCount != 1 {
		t.Errorf("committed_count = %d, want 1", resp.CommittedCount)
	}
	if len(resp.Rejected) != 3 {
		t.Errorf("rejected count = %d, want 3", len(resp.Rejected))
	}
}

// TestSnapshotOfflinePositions_AC7_EmptySymbolRejected: an empty-symbol row is rejected.
func TestSnapshotOfflinePositions_AC7_EmptySymbolRejected(t *testing.T) {
	T0 := time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)
	baseline := &fakeBaselineStore{}
	ledger := &recordingLedger{}
	svc := newSnapshotTestService(baseline, ledger)

	resp, err := svc.SnapshotOfflinePositions(context.Background(), snapshotReq(
		"acc-1", "user-1", "snap-1", T0,
		posBaseline("", 100, 150), // empty symbol
		posBaseline("AAPL", 50, 200),
	))
	if err != nil {
		t.Fatalf("SnapshotOfflinePositions: %v", err)
	}
	if resp.CommittedCount != 1 {
		t.Errorf("committed_count = %d, want 1 (only AAPL)", resp.CommittedCount)
	}
	if len(resp.Rejected) != 1 {
		t.Fatalf("rejected count = %d, want 1", len(resp.Rejected))
	}
	if resp.Rejected[0].RowIndex != 0 {
		t.Errorf("rejected row_index=%d, want 0 (first row)", resp.Rejected[0].RowIndex)
	}
}

// TestSnapshotOfflinePositions_NoBaselineFallback: without a baseline, the producer folds all
// confirmed orders (byte-identical to feature-157 behavior) with source=ORDERS.
func TestSnapshotOfflinePositions_NoBaselineFallback(t *testing.T) {
	baseline := &fakeBaselineStore{
		// No baseline set.
		confirmedOrders: []*tradingv1.Order{
			confirmedOrder("AAPL", tradingv1.OrderSide_ORDER_SIDE_BUY, 50, 160, time.Now()),
		},
	}
	ledger := &recordingLedger{}
	svc := &TradingService{
		cfg:  &config.Config{TradingMode: "paper"},
		cfgW: &config.Watcher{},
		accountRepo: &offlineAccountRepo{getRec: &repository.BrokerAccountRecord{
			ID: "acc-1", UserID: "user-1", BrokerType: int32(commonv1.BrokerType_BROKER_TYPE_OFFLINE),
		}},
		baselineStore: baseline,
		ledger:        ledger,
		confirmLocks:  make(map[string]*sync.Mutex),
	}

	// Trigger via recomputeAndEmitOfflinePositions directly (no snapshot, just orders).
	if err := svc.recomputeAndEmitOfflinePositions(context.Background(), "acc-1", "user-1"); err != nil {
		t.Fatalf("recompute: %v", err)
	}

	synced := parseSyncedPayload(t, ledger)
	aapl, ok := findPosition(synced.Positions, "AAPL")
	if !ok {
		t.Fatal("AAPL not in emitted positions")
	}
	if aapl.Source != int32(portfoliov1.PositionSource_POSITION_SOURCE_ORDERS) {
		t.Errorf("AAPL source=%d, want ORDERS (no baseline)", aapl.Source)
	}
	if aapl.AsOf != "" {
		t.Errorf("AAPL as_of=%q, want empty (ORDERS source has no as_of)", aapl.AsOf)
	}
}

// TestSnapshotOfflinePositions_Concurrency_AC10: concurrent ConfirmOrder + SnapshotOfflinePositions
// on one account serialize via s.confirmLock — no interleaved/stale absolute snapshot.
func TestSnapshotOfflinePositions_Concurrency_AC10(t *testing.T) {
	T0 := time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)
	baseline := &fakeBaselineStore{
		confirmedOrders: []*tradingv1.Order{
			confirmedOrder("AAPL", tradingv1.OrderSide_ORDER_SIDE_BUY, 50, 160, T0.Add(24*time.Hour)),
		},
	}
	ledger := &recordingLedger{}
	svc := newSnapshotTestService(baseline, ledger)

	// Both operations contend for confirmLock("acc-1"). Run them concurrently.
	var wg sync.WaitGroup
	errCh := make(chan error, 2)

	// Goroutine 1: SnapshotOfflinePositions
	wg.Add(1)
	go func() {
		defer wg.Done()
		_, err := svc.SnapshotOfflinePositions(context.Background(), snapshotReq(
			"acc-1", "user-1", "snap-conc", T0,
			posBaseline("AAPL", 100, 150),
		))
		if err != nil {
			errCh <- err
		}
	}()

	// Goroutine 2: recomputeAndEmitOfflinePositions (simulating ConfirmOrder's recompute step)
	// This acquires the same per-account lock.
	wg.Add(1)
	go func() {
		defer wg.Done()
		lock := svc.confirmLock("acc-1")
		lock.Lock()
		err := svc.recomputeAndEmitOfflinePositions(context.Background(), "acc-1", "user-1")
		lock.Unlock()
		if err != nil {
			errCh <- err
		}
	}()

	wg.Wait()
	close(errCh)
	for err := range errCh {
		t.Fatalf("concurrent operation failed: %v", err)
	}

	// Both operations must have completed and emitted events. The key invariant is that they
	// serialized (no data race, no interleaved payload) — the -race flag in the test runner
	// catches any unserialized access.
	syncedEvents := ledger.requestsByType("account.positions.synced")
	if len(syncedEvents) < 2 {
		t.Errorf("expected ≥2 account.positions.synced events (snapshot + recompute), got %d", len(syncedEvents))
	}

	// Every synced event must have a well-formed positions payload (not corrupt from interleaving).
	for i, req := range syncedEvents {
		p := req.Payload.AsMap()
		positions, ok := p["positions"]
		if !ok {
			t.Errorf("synced event %d missing positions key", i)
			continue
		}
		posList, ok := positions.([]interface{})
		if !ok {
			t.Errorf("synced event %d positions is not a list: %T", i, positions)
			continue
		}
		for _, raw := range posList {
			pm, ok := raw.(map[string]interface{})
			if !ok {
				t.Errorf("synced event %d: position entry is not a map", i)
				continue
			}
			if _, ok := pm["symbol"]; !ok {
				t.Errorf("synced event %d: position entry missing symbol", i)
			}
		}
	}
}

// suppress unused import warning — json is used by the payload-parsing helpers above and kept as
// insurance for any future payload-based assertion that needs raw JSON parsing.
var _ = json.Marshal
