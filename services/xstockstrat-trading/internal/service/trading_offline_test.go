package service

import (
	"context"
	"encoding/json"
	"math"
	"sort"
	"sync"
	"testing"
	"time"

	"github.com/pashagolub/pgxmock/v4"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	grpcstatus "google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	ledgerv1 "github.com/xstockstrat/contracts/gen/go/ledger/v1"
	portfoliov1 "github.com/xstockstrat/contracts/gen/go/portfolio/v1"
	tradingv1 "github.com/xstockstrat/contracts/gen/go/trading/v1"
	"github.com/xstockstrat/contracts/pnl"
	"github.com/xstockstrat/trading/internal/config"
	"github.com/xstockstrat/trading/internal/repository"
	"github.com/xstockstrat/trading/internal/testdata"
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
	ordersFn        func() []*tradingv1.Order // when set, overrides confirmedOrders (live svc.orders view)

	// upsert tracking — populated by UpsertBaselineSnapshot
	upsertCalls []upsertBaselineCall
	upsertErr   error

	// delete tracking — populated by DeleteBaselinesByAccount
	deleteCalls []string
	deleteErr   error

	// snapshot headers — written by UpsertBaselineSnapshot, read by EffectiveBaselineByAccount when set
	headers map[string]*fakeSnapshotHeader
	seq     int

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

// fakeSnapshotHeader is the fake's trading.offline_snapshot_headers row; seq stands in for created_at.
type fakeSnapshotHeader struct {
	hdr repository.SnapshotHeader
	seq int
}

func fakeHeaderAfter(a, b *fakeSnapshotHeader) bool {
	return a.hdr.AsOf.After(b.hdr.AsOf) || (a.hdr.AsOf.Equal(b.hdr.AsOf) && a.seq > b.seq)
}

// UpsertBaselineSnapshot mirrors the repo's header rules (keep carry on same id + as_of, reject a
// non-latest/backwards as_of change, pred excludes its own id); the repo's tx SQL is proven by
// SQL-shape review only.
func (f *fakeBaselineStore) UpsertBaselineSnapshot(_ context.Context, accountID, clientSnapshotID string, asOf time.Time, rows []repository.BaselineRow, carry repository.CarryFunc) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.upsertCalls = append(f.upsertCalls, upsertBaselineCall{
		accountID: accountID, clientSnapshotID: clientSnapshotID, asOf: asOf, rows: rows,
	})
	if f.upsertErr != nil {
		return f.upsertErr
	}
	if f.headers == nil {
		f.headers = make(map[string]*fakeSnapshotHeader)
	}

	var latest *fakeSnapshotHeader
	for _, h := range f.headers {
		if latest == nil || fakeHeaderAfter(h, latest) {
			latest = h
		}
	}
	own := f.headers[clientSnapshotID]
	var realized, fees float64
	if own != nil && own.hdr.AsOf.Equal(asOf) {
		realized, fees = own.hdr.RealizedCarried, own.hdr.FeesCarried
	} else {
		if own != nil {
			if latest != own {
				return repository.ErrSnapshotAsOfConflict
			}
			for id, h := range f.headers {
				if id != clientSnapshotID && h.hdr.AsOf.After(asOf) {
					return repository.ErrSnapshotAsOfConflict
				}
			}
		}
		var pred *fakeSnapshotHeader
		for id, h := range f.headers {
			if id == clientSnapshotID || !h.hdr.AsOf.Before(asOf) {
				continue
			}
			if pred == nil || fakeHeaderAfter(h, pred) {
				pred = h
			}
		}
		if carry != nil {
			var predHdr *repository.SnapshotHeader
			if pred != nil {
				p := pred.hdr
				predHdr = &p
			}
			var err error
			if realized, fees, err = carry(predHdr, asOf); err != nil {
				return err
			}
		}
	}

	lots := make(map[string]pnl.Lot, len(rows))
	for _, r := range rows {
		if r.Qty == 0 {
			continue // drop qty=0 — mirrors EffectiveBaselineByAccount's AC-8/AC-15 behavior
		}
		lots[r.Symbol] = pnl.Lot{Qty: r.Qty, CostBasis: r.Qty * r.AvgCostPerShare}
	}
	h := own
	if h == nil {
		f.seq++
		h = &fakeSnapshotHeader{seq: f.seq}
		f.headers[clientSnapshotID] = h
	}
	h.hdr = repository.SnapshotHeader{
		ClientSnapshotID: clientSnapshotID, AsOf: asOf,
		RealizedCarried: realized, FeesCarried: fees, Lots: lots,
	}
	return nil
}

func (f *fakeBaselineStore) EffectiveBaselineByAccount(_ context.Context, _ string) (repository.SnapshotHeader, bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.baselineErr != nil {
		return repository.SnapshotHeader{}, false, f.baselineErr
	}
	var latest *fakeSnapshotHeader
	for _, h := range f.headers {
		if latest == nil || fakeHeaderAfter(h, latest) {
			latest = h
		}
	}
	if latest != nil {
		hdr := latest.hdr
		hdr.Lots = make(map[string]pnl.Lot, len(latest.hdr.Lots))
		for k, v := range latest.hdr.Lots {
			hdr.Lots[k] = v
		}
		return hdr, true, nil
	}
	if !f.hasBaseline {
		return repository.SnapshotHeader{}, false, nil
	}
	// Return a copy so mutations in the caller don't affect our state.
	lots := make(map[string]pnl.Lot, len(f.baselineLots))
	for k, v := range f.baselineLots {
		lots[k] = v
	}
	return repository.SnapshotHeader{AsOf: f.baselineAsOf, Lots: lots}, true, nil
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
	f.headers = nil
	return nil
}

func (f *fakeBaselineStore) HasUnconfirmedOfflineOrders(_ context.Context, _ string) (bool, error) {
	return f.hasUnconfirmed, f.hasUnconfirmedErr
}

func (f *fakeBaselineStore) ListConfirmedOfflineOrdersByAccount(_ context.Context, _ string) ([]*tradingv1.Order, error) {
	if f.confirmedErr != nil {
		return nil, f.confirmedErr
	}
	if f.ordersFn != nil {
		return f.ordersFn(), nil
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
				UserId:     "user-1",
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
		_, err = svc.CancelOrder(ctxAsUser("user-1"), &tradingv1.CancelOrderRequest{OrderId: "off-ord-1"})
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
		_, _ = svc.PlaceOrder(ctxAsUser("user-1"), &tradingv1.PlaceOrderRequest{
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
	AccountID       string
	UserID          string
	TradingMode     string
	Realized        float64
	FeesSince       float64
	RealizedCarried float64
	FeesCarried     float64
	RecentFills     []map[string]interface{}
	Positions       []syncedPosition
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
	for key, dst := range map[string]*float64{
		"fees_since_snapshot": &result.FeesSince, "realized_carried": &result.RealizedCarried, "fees_carried": &result.FeesCarried,
	} {
		v, ok := p[key]
		if !ok {
			t.Fatalf("account.positions.synced payload has no %q", key)
		}
		*dst = v.(float64)
	}
	if fills, ok := p["recent_fills"].([]interface{}); ok {
		for _, f := range fills {
			result.RecentFills = append(result.RecentFills, f.(map[string]interface{}))
		}
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

// ---------------------------------------------------------------------------
// Feature 230 — ConfirmOrder fees, filled_at preservation and NEW-order masking
// ---------------------------------------------------------------------------

// rowCapture is a pgxmock argument matcher that records the bound value at one UpsertOrder position.
type rowCapture struct {
	row *[]any
	i   int
}

func (c rowCapture) Match(v any) bool { (*c.row)[c.i] = v; return true }

const upsertRequiresApprovalArg = 16 // the one UpsertOrder bind with no scanOrder column

// confirmHarness round-trips every order through the real UpsertOrder/GetOrder SQL: each persisted
// write is captured and served back as the next GetOrder row.
type confirmHarness struct {
	t        *testing.T
	mock     pgxmock.PgxPoolIface
	svc      *TradingService
	baseline *fakeBaselineStore
	ledger   *recordingLedger
	stored   []any
}

func newConfirmHarness(t *testing.T) *confirmHarness {
	t.Helper()
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	t.Cleanup(mock.Close)
	baseline, ledger := &fakeBaselineStore{}, &recordingLedger{}
	svc := newSnapshotTestService(baseline, ledger)
	svc.repo = repository.NewTradingRepoWithDB(mock)
	svc.orders = map[string]*tradingv1.Order{}
	baseline.ordersFn = func() []*tradingv1.Order { return confirmedOfflineOrders(svc) }
	return &confirmHarness{t: t, mock: mock, svc: svc, baseline: baseline, ledger: ledger}
}

// confirmedOfflineOrders mirrors ListConfirmedOfflineOrdersByAccount over svc.orders (filled_at ASC).
func confirmedOfflineOrders(svc *TradingService) []*tradingv1.Order {
	svc.mu.Lock()
	defer svc.mu.Unlock()
	var out []*tradingv1.Order
	for _, o := range svc.orders {
		if o.BrokerType == commonv1.BrokerType_BROKER_TYPE_OFFLINE && o.FilledQty > 0 &&
			(o.Status == tradingv1.OrderStatus_ORDER_STATUS_FILLED || o.Status == tradingv1.OrderStatus_ORDER_STATUS_PARTIALLY_FILLED) {
			out = append(out, proto.Clone(o).(*tradingv1.Order))
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].GetFilledAt().AsTime().Before(out[j].GetFilledAt().AsTime()) })
	return out
}

func (h *confirmHarness) expectUpsert() {
	args := make([]any, 23)
	h.stored = make([]any, 23)
	for i := range args {
		args[i] = rowCapture{row: &h.stored, i: i}
	}
	h.mock.ExpectExec(`INSERT INTO trading\.orders`).WithArgs(args...).WillReturnResult(pgxmock.NewResult("INSERT", 1))
}

// persisted returns the last UpsertOrder write as a scanOrder row: requires_approval dropped, state
// NULL, and nullable binds re-pointered (pgxmock scans a value into a pointer destination only as one).
func (h *confirmHarness) persisted() []any {
	row := append(append([]any{}, h.stored[:upsertRequiresApprovalArg]...), h.stored[upsertRequiresApprovalArg+1:]...)
	for i, v := range row {
		switch x := v.(type) {
		case float64:
			if i == 9 || i == 10 || i == 11 { // limit_price, stop_price, filled_avg_price
				row[i] = &x
			}
		case time.Time:
			if i == 20 { // filled_at
				row[i] = &x
			}
		case *float64: // fees
			if x != nil {
				c := *x
				row[i] = &c
			}
		}
	}
	return append(row, nil)
}

func (h *confirmHarness) seed(o *tradingv1.Order) {
	h.t.Helper()
	h.expectUpsert()
	if err := h.svc.repo.UpsertOrder(context.Background(), o); err != nil {
		h.t.Fatalf("seed UpsertOrder: %v", err)
	}
}

func (h *confirmHarness) confirm(req *tradingv1.ConfirmOrderRequest) *tradingv1.Order {
	h.t.Helper()
	h.mock.ExpectQuery(`FROM trading\.orders`).WithArgs(req.OrderId).
		WillReturnRows(pgxmock.NewRows(testdata.OrderRowColumns).AddRow(h.persisted()...))
	h.expectUpsert()
	resp, err := h.svc.ConfirmOrder(ctxAsUser(testdata.S1UserID), req)
	if err != nil {
		h.t.Fatalf("ConfirmOrder(%+v): %v", req, err)
	}
	return resp
}

// persistedOrder decodes the last persisted write through the real scanOrder path.
func (h *confirmHarness) persistedOrder(id string) *tradingv1.Order {
	h.t.Helper()
	h.mock.ExpectQuery(`FROM trading\.orders`).WithArgs(id).
		WillReturnRows(pgxmock.NewRows(testdata.OrderRowColumns).AddRow(h.persisted()...))
	o, err := h.svc.repo.GetOrder(context.Background(), id)
	if err != nil {
		h.t.Fatalf("GetOrder: %v", err)
	}
	return o
}

func newOfflineOrder(id string, qty float64) *tradingv1.Order {
	return &tradingv1.Order{
		OrderId: id, ClientOrderId: "client-" + id, Symbol: "AAPL", Side: tradingv1.OrderSide_ORDER_SIDE_BUY,
		OrderType: tradingv1.OrderType_ORDER_TYPE_MARKET, Status: tradingv1.OrderStatus_ORDER_STATUS_NEW,
		Qty: qty, TimeInForce: tradingv1.TimeInForce_TIME_IN_FORCE_DAY, UserId: testdata.S1UserID,
		TradingMode: commonv1.TradingMode_TRADING_MODE_PAPER, AccountId: testdata.S1AccountID,
		BrokerType: commonv1.BrokerType_BROKER_TYPE_OFFLINE, CreatedAt: timestamppb.New(time.Now().Add(-time.Hour)),
	}
}

func feesOf(o *tradingv1.Order) any {
	if o.Fees == nil {
		return nil
	}
	return *o.Fees
}

func TestConfirmOrder_AC9_NegativeFeesRejectedBeforeLoad(t *testing.T) {
	h := newConfirmHarness(t)
	for _, fees := range []float64{-1, math.NaN(), math.Inf(1)} {
		_, err := h.svc.ConfirmOrder(ctxAsUser(testdata.S1UserID), &tradingv1.ConfirmOrderRequest{
			OrderId: "ord-x", FilledQty: 10, FilledAvgPrice: 150, Fees: proto.Float64(fees),
		})
		if grpcstatus.Code(err) != codes.InvalidArgument || grpcstatus.Convert(err).Message() != "fees must be >= 0" {
			t.Errorf("fees %v: err = %v, want InvalidArgument \"fees must be >= 0\"", fees, err)
		}
	}
	if err := h.mock.ExpectationsWereMet(); err != nil {
		t.Errorf("GetOrder/UpsertOrder must not run: %v", err)
	}
}

func TestConfirmOrder_AC8_ReconfirmReplacesFees(t *testing.T) {
	h := newConfirmHarness(t)
	h.seed(newOfflineOrder("ord-1", 10))
	h.confirm(&tradingv1.ConfirmOrderRequest{OrderId: "ord-1", FilledQty: 10, FilledAvgPrice: 150, Fees: proto.Float64(5)})
	resp := h.confirm(&tradingv1.ConfirmOrderRequest{OrderId: "ord-1", FilledQty: 10, FilledAvgPrice: 150, Fees: proto.Float64(2)})
	if feesOf(resp) != 2.0 || feesOf(h.persistedOrder("ord-1")) != 2.0 {
		t.Errorf("fees: resp=%v persisted=%v, want 2 (a re-confirm replaces, never adds)", feesOf(resp), feesOf(h.persistedOrder("ord-1")))
	}
}

func TestConfirmOrder_AC37_OmittedFeesKept(t *testing.T) {
	h := newConfirmHarness(t)
	h.seed(newOfflineOrder("ord-1", 10))
	h.confirm(&tradingv1.ConfirmOrderRequest{OrderId: "ord-1", FilledQty: 10, FilledAvgPrice: 150, Fees: proto.Float64(2)})
	resp := h.confirm(&tradingv1.ConfirmOrderRequest{OrderId: "ord-1", FilledQty: 10, FilledAvgPrice: 151})
	if feesOf(resp) != 2.0 || resp.FilledAvgPrice != 151 {
		t.Errorf("resp fees=%v price=%v, want fees 2 kept and price 151", feesOf(resp), resp.FilledAvgPrice)
	}
}

func TestConfirmOrder_AC21_PartialThenFullCumulative(t *testing.T) {
	h := newConfirmHarness(t)
	h.seed(newOfflineOrder("ord-1", 100))
	part := h.confirm(&tradingv1.ConfirmOrderRequest{OrderId: "ord-1", FilledQty: 40, FilledAvgPrice: 150, Fees: proto.Float64(0.40)})
	if part.Status != tradingv1.OrderStatus_ORDER_STATUS_PARTIALLY_FILLED || feesOf(part) != 0.40 {
		t.Fatalf("partial: status=%v fees=%v, want PARTIALLY_FILLED 0.40", part.Status, feesOf(part))
	}
	full := h.confirm(&tradingv1.ConfirmOrderRequest{OrderId: "ord-1", FilledQty: 100, FilledAvgPrice: 150, Fees: proto.Float64(1)})
	if full.Status != tradingv1.OrderStatus_ORDER_STATUS_FILLED || feesOf(full) != 1.0 {
		t.Errorf("full: status=%v fees=%v, want FILLED 1.00 (cumulative, not 1.40)", full.Status, feesOf(full))
	}
}

func TestConfirmOrder_AC47_ReconfirmKeepsFrozenFilledAt(t *testing.T) {
	h := newConfirmHarness(t)
	var sell *tradingv1.Order
	for _, o := range testdata.S1HistoryOrders() {
		if o.OrderId == testdata.S1SellID {
			sell = o
		}
	}
	h.seed(sell)
	h.confirm(&tradingv1.ConfirmOrderRequest{OrderId: testdata.S1SellID, FilledQty: 40, FilledAvgPrice: 165, Fees: proto.Float64(2)})
	want := time.Date(2026, 10, 20, 15, 0, 0, 0, time.UTC)
	if got := h.persistedOrder(testdata.S1SellID).GetFilledAt().AsTime(); !got.Equal(want) {
		t.Errorf("filled_at = %v, want %v (a re-confirm without filled_at must not move a frozen order)", got, want)
	}
}

func TestConfirmOrder_AC48_UnconfirmHidesFeesAndFilledAt(t *testing.T) {
	h := newConfirmHarness(t)
	at := time.Date(2026, 10, 19, 14, 0, 0, 0, time.UTC)
	h.seed(newOfflineOrder("ord-1", 10))
	h.confirm(&tradingv1.ConfirmOrderRequest{OrderId: "ord-1", FilledQty: 10, FilledAvgPrice: 150, Fees: proto.Float64(2), FilledAt: timestamppb.New(at)})
	resp := h.confirm(&tradingv1.ConfirmOrderRequest{OrderId: "ord-1", FilledQty: 0})

	got, err := h.svc.GetOrder(context.Background(), &tradingv1.GetOrderRequest{OrderId: "ord-1"})
	if err != nil {
		t.Fatalf("GetOrder: %v", err)
	}
	for name, o := range map[string]*tradingv1.Order{"ConfirmOrder": resp, "GetOrder": got} {
		if o.Status != tradingv1.OrderStatus_ORDER_STATUS_NEW || o.Fees != nil || o.FilledAt != nil {
			t.Errorf("%s: status=%v fees=%v filled_at=%v, want NEW with fees and filled_at hidden", name, o.Status, feesOf(o), o.FilledAt)
		}
	}
	if cached := h.svc.orders["ord-1"]; feesOf(cached) != 2.0 || !cached.GetFilledAt().AsTime().Equal(at) {
		t.Errorf("cache must keep the stored values: fees=%v filled_at=%v", feesOf(cached), cached.FilledAt)
	}

	back := h.confirm(&tradingv1.ConfirmOrderRequest{OrderId: "ord-1", FilledQty: 10, FilledAvgPrice: 150})
	if back.Status != tradingv1.OrderStatus_ORDER_STATUS_FILLED || feesOf(back) != 2.0 || !back.GetFilledAt().AsTime().Equal(at) {
		t.Errorf("re-confirm: status=%v fees=%v filled_at=%v, want FILLED 2.00 %v", back.Status, feesOf(back), back.FilledAt, at)
	}
}

func TestConfirmOrder_QtyZeroNeverFilledKeepsNilFilledAt(t *testing.T) {
	h := newConfirmHarness(t)
	h.seed(newOfflineOrder("ord-1", 10))
	h.confirm(&tradingv1.ConfirmOrderRequest{OrderId: "ord-1", FilledQty: 0, FilledAt: timestamppb.New(time.Now().Add(-48 * time.Hour))})
	if fa := h.persistedOrder("ord-1").FilledAt; fa != nil {
		t.Fatalf("qty-0 confirm on a never-filled order persisted filled_at %v, want NULL", fa.AsTime())
	}
	before := time.Now()
	resp := h.confirm(&tradingv1.ConfirmOrderRequest{OrderId: "ord-1", FilledQty: 10, FilledAvgPrice: 150})
	if fa := resp.GetFilledAt().AsTime(); fa.Before(before.Add(-time.Second)) {
		t.Errorf("first non-NEW confirm filled_at = %v, want now", fa)
	}
}

func TestHideUnconfirmedFill_BrokerUntouched(t *testing.T) {
	at := timestamppb.Now()
	o := &tradingv1.Order{BrokerType: commonv1.BrokerType_BROKER_TYPE_ALPACA, Status: tradingv1.OrderStatus_ORDER_STATUS_NEW, FilledAt: at, Fees: proto.Float64(1)}
	hideUnconfirmedFill(o)
	if o.FilledAt != at || feesOf(o) != 1.0 {
		t.Errorf("broker order changed: filled_at=%v fees=%v", o.FilledAt, feesOf(o))
	}
}

// ---------------------------------------------------------------------------
// Feature 230 — positions.synced fees/carry payload and snapshot carry rules
// ---------------------------------------------------------------------------

func s1Snapshot(t *testing.T, svc *TradingService, id string, asOf time.Time, rows ...*tradingv1.PositionBaseline) {
	t.Helper()
	if _, err := svc.SnapshotOfflinePositions(context.Background(), snapshotReq(testdata.S1AccountID, testdata.S1UserID, id, asOf, rows...)); err != nil {
		t.Fatalf("snapshot %s: %v", id, err)
	}
}

// seedS1History puts the S1 history orders in the harness DB and cache, then records snapshot S1.
func (h *confirmHarness) seedS1History() {
	h.t.Helper()
	for _, o := range testdata.S1HistoryOrders() {
		h.svc.orders[o.OrderId] = o
		if o.OrderId == testdata.S1SellID {
			h.seed(proto.Clone(o).(*tradingv1.Order))
		}
	}
	asOf, rows := testdata.S1Snapshot()
	s1Snapshot(h.t, h.svc, testdata.S1SnapshotID, asOf, rows...)
}

func assertPayload(t *testing.T, got *syncedPayload, realized, feesSince, realizedCarried, feesCarried float64) {
	t.Helper()
	if got.Realized != realized || math.Abs(got.FeesSince-feesSince) > 1e-9 || got.RealizedCarried != realizedCarried || math.Abs(got.FeesCarried-feesCarried) > 1e-9 {
		t.Errorf("payload realized=%v fees_since=%v realized_carried=%v fees_carried=%v, want %v %v %v %v",
			got.Realized, got.FeesSince, got.RealizedCarried, got.FeesCarried, realized, feesSince, realizedCarried, feesCarried)
	}
}

func TestOfflineRecompute_AC7_FeesSeparateFromCostBasis(t *testing.T) {
	h := newConfirmHarness(t)
	h.seed(newOfflineOrder("ord-1", 100))
	h.confirm(&tradingv1.ConfirmOrderRequest{OrderId: "ord-1", FilledQty: 100, FilledAvgPrice: 150, Fees: proto.Float64(1.5)})
	got := parseSyncedPayload(t, h.ledger)
	if aapl, _ := findPosition(got.Positions, "AAPL"); aapl.AvgCost != 150 {
		t.Errorf("avg_cost = %v, want 150 (fees never enter cost basis)", aapl.AvgCost)
	}
	assertPayload(t, got, 0, 1.5, 0, 0)
}

func TestOfflineRecompute_AC20_RealizedGrossFeesSummed(t *testing.T) {
	h := newConfirmHarness(t)
	h.seed(newOfflineOrder("ord-b", 100))
	h.confirm(&tradingv1.ConfirmOrderRequest{OrderId: "ord-b", FilledQty: 100, FilledAvgPrice: 150, Fees: proto.Float64(1.5),
		FilledAt: timestamppb.New(time.Now().Add(-2 * time.Hour))})
	sell := newOfflineOrder("ord-s", 100)
	sell.Side = tradingv1.OrderSide_ORDER_SIDE_SELL
	h.seed(sell)
	h.confirm(&tradingv1.ConfirmOrderRequest{OrderId: "ord-s", FilledQty: 100, FilledAvgPrice: 156, Fees: proto.Float64(1.5)})
	assertPayload(t, parseSyncedPayload(t, h.ledger), 600, 3, 0, 0)
}

func TestOfflineRecompute_AC8_AC21_FeesFollowReplacedCumulative(t *testing.T) {
	h := newConfirmHarness(t)
	h.seed(newOfflineOrder("ord-1", 10))
	h.confirm(&tradingv1.ConfirmOrderRequest{OrderId: "ord-1", FilledQty: 10, FilledAvgPrice: 150, Fees: proto.Float64(5)})
	h.confirm(&tradingv1.ConfirmOrderRequest{OrderId: "ord-1", FilledQty: 10, FilledAvgPrice: 150, Fees: proto.Float64(2)})
	assertPayload(t, parseSyncedPayload(t, h.ledger), 0, 2, 0, 0)

	h2 := newConfirmHarness(t)
	h2.seed(newOfflineOrder("ord-2", 100))
	h2.confirm(&tradingv1.ConfirmOrderRequest{OrderId: "ord-2", FilledQty: 40, FilledAvgPrice: 150, Fees: proto.Float64(0.4)})
	h2.confirm(&tradingv1.ConfirmOrderRequest{OrderId: "ord-2", FilledQty: 100, FilledAvgPrice: 150, Fees: proto.Float64(1)})
	assertPayload(t, parseSyncedPayload(t, h2.ledger), 0, 1, 0, 0)
}

func TestSnapshotOfflinePositions_AC41_FirstSnapshotCarriesPriorRealized(t *testing.T) {
	baseline, ledger := &fakeBaselineStore{confirmedOrders: testdata.S1HistoryOrders()}, &recordingLedger{}
	svc := newSnapshotTestService(baseline, ledger)
	asOf, rows := testdata.S1Snapshot()
	s1Snapshot(t, svc, testdata.S1SnapshotID, asOf, rows...)

	got := parseSyncedPayload(t, ledger)
	assertPayload(t, got, 100, 0, 600, 0)
	if aapl, _ := findPosition(got.Positions, "AAPL"); aapl.Qty != 40 {
		t.Errorf("AAPL qty = %v, want 40", aapl.Qty)
	}
}

// buySellRoundTrip is AC-10/AC-42's history: buy 100 @150 and sell 100 @156, 1.50 fees each.
func buySellRoundTrip(at time.Time) []*tradingv1.Order {
	buy := confirmedOrder("AAPL", tradingv1.OrderSide_ORDER_SIDE_BUY, 100, 150, at)
	sell := confirmedOrder("AAPL", tradingv1.OrderSide_ORDER_SIDE_SELL, 100, 156, at.Add(time.Hour))
	buy.Fees, sell.Fees = proto.Float64(1.5), proto.Float64(1.5)
	return []*tradingv1.Order{buy, sell}
}

func TestSnapshotOfflinePositions_AC42_AC10_EmptySnapshotIsFullFlatten(t *testing.T) {
	T0 := time.Date(2026, 10, 1, 15, 0, 0, 0, time.UTC)
	baseline, ledger := &fakeBaselineStore{confirmedOrders: buySellRoundTrip(T0)}, &recordingLedger{}
	svc := newSnapshotTestService(baseline, ledger)
	resp, err := svc.SnapshotOfflinePositions(context.Background(), snapshotReq("acc-1", "user-1", "flat", T0.Add(24*time.Hour)))
	if err != nil || resp.CommittedCount != 0 {
		t.Fatalf("empty snapshot: resp=%+v err=%v, want a committed full flatten", resp, err)
	}
	got := parseSyncedPayload(t, ledger)
	if len(got.Positions) != 0 {
		t.Errorf("positions = %+v, want none", got.Positions)
	}
	assertPayload(t, got, 0, 0, 600, 3)
}

func TestSnapshotOfflinePositions_AC11_SecondSnapshotChainsCarry(t *testing.T) {
	baseline, ledger := &fakeBaselineStore{confirmedOrders: testdata.S1HistoryOrders()}, &recordingLedger{}
	svc := newSnapshotTestService(baseline, ledger)
	asOf, rows := testdata.S1Snapshot()
	s1Snapshot(t, svc, testdata.S1SnapshotID, asOf, rows...)
	s1Snapshot(t, svc, "S2", time.Date(2026, 11, 30, 23, 59, 59, 0, time.UTC), posBaseline("AAPL", 40, 150))
	assertPayload(t, parseSyncedPayload(t, ledger), 0, 0, 700, 0)
}

func TestSnapshotOfflinePositions_AC43_AllRowsRejectedIsNoop(t *testing.T) {
	baseline, ledger := &fakeBaselineStore{confirmedOrders: testdata.S1HistoryOrders()}, &recordingLedger{}
	svc := newSnapshotTestService(baseline, ledger)
	asOf, rows := testdata.S1Snapshot()
	s1Snapshot(t, svc, testdata.S1SnapshotID, asOf, rows...)
	upserts := len(baseline.upsertCalls)
	ledger.reset()

	resp, err := svc.SnapshotOfflinePositions(context.Background(), snapshotReq("acc-1", "user-1", "S2",
		time.Date(2026, 11, 30, 23, 59, 59, 0, time.UTC), posBaseline("", 10, 1)))
	if err != nil || resp.CommittedCount != 0 || len(resp.Rejected) != 1 {
		t.Fatalf("resp=%+v err=%v, want committed 0 with 1 rejection", resp, err)
	}
	if len(baseline.upsertCalls) != upserts || len(ledger.requestsByType("account.positions.synced")) != 0 ||
		len(ledger.requestsByType("account.positions.baseline_set")) != 0 {
		t.Errorf("an all-rejected snapshot must not persist or emit: upserts %d→%d, events=%d",
			upserts, len(baseline.upsertCalls), len(ledger.requests))
	}
}

func TestSnapshotOfflinePositions_AC44_NonLatestAsOfChangeRejected(t *testing.T) {
	baseline, ledger := &fakeBaselineStore{confirmedOrders: testdata.S1HistoryOrders()}, &recordingLedger{}
	svc := newSnapshotTestService(baseline, ledger)
	asOf, rows := testdata.S1Snapshot()
	s1Snapshot(t, svc, testdata.S1SnapshotID, asOf, rows...)
	s1Snapshot(t, svc, "S2", time.Date(2026, 11, 30, 23, 59, 59, 0, time.UTC), posBaseline("AAPL", 40, 150))

	_, err := svc.SnapshotOfflinePositions(context.Background(), snapshotReq("acc-1", "user-1", testdata.S1SnapshotID,
		time.Date(2026, 11, 15, 23, 59, 59, 0, time.UTC), rows...))
	if grpcstatus.Code(err) != codes.FailedPrecondition {
		t.Fatalf("err = %v, want FailedPrecondition", err)
	}
	if s1, s2 := baseline.headers[testdata.S1SnapshotID].hdr, baseline.headers["S2"].hdr; !s1.AsOf.Equal(asOf) || s1.RealizedCarried != 600 || s2.RealizedCarried != 700 {
		t.Errorf("stored carries changed: S1=%+v S2=%+v", s1, s2)
	}
}

func TestSnapshotOfflinePositions_AC45_LatestAsOfMoveExcludesItself(t *testing.T) {
	baseline, ledger := &fakeBaselineStore{confirmedOrders: testdata.S1HistoryOrders()}, &recordingLedger{}
	svc := newSnapshotTestService(baseline, ledger)
	asOf, rows := testdata.S1Snapshot()
	s1Snapshot(t, svc, testdata.S1SnapshotID, asOf, rows...)
	s1Snapshot(t, svc, testdata.S1SnapshotID, time.Date(2026, 11, 10, 23, 59, 59, 0, time.UTC), posBaseline("AAPL", 40, 140))

	got := parseSyncedPayload(t, ledger)
	assertPayload(t, got, 0, 0, 700, 0)
	if aapl, _ := findPosition(got.Positions, "AAPL"); aapl.Qty != 40 || aapl.AvgCost != 140 {
		t.Errorf("AAPL = %+v, want 40 @ 140", aapl)
	}
}

// TestSnapshotOfflinePositions_AC6_SameIDSameAsOfKeepsCarry (@AC-6 @feature-163): a re-submit keeps the
// stored carry even when the history before as_of has since changed.
func TestSnapshotOfflinePositions_AC6_SameIDSameAsOfKeepsCarry(t *testing.T) {
	baseline, ledger := &fakeBaselineStore{confirmedOrders: testdata.S1HistoryOrders()}, &recordingLedger{}
	svc := newSnapshotTestService(baseline, ledger)
	asOf, rows := testdata.S1Snapshot()
	s1Snapshot(t, svc, testdata.S1SnapshotID, asOf, rows...)
	baseline.confirmedOrders = append(baseline.confirmedOrders,
		confirmedOrder("AAPL", tradingv1.OrderSide_ORDER_SIDE_SELL, 10, 200, time.Date(2026, 10, 25, 15, 0, 0, 0, time.UTC)))
	s1Snapshot(t, svc, testdata.S1SnapshotID, asOf, rows...)
	if got := parseSyncedPayload(t, ledger); got.RealizedCarried != 600 {
		t.Errorf("realized_carried = %v, want 600 kept (carry not recomputed)", got.RealizedCarried)
	}
}

func TestConfirmOrder_AC46_FrozenWindowFillIgnored(t *testing.T) {
	h := newConfirmHarness(t)
	h.seedS1History()
	h.seed(newOfflineOrder("ord-n", 10))
	h.confirm(&tradingv1.ConfirmOrderRequest{OrderId: "ord-n", FilledQty: 10, FilledAvgPrice: 150, Fees: proto.Float64(5),
		FilledAt: timestamppb.New(time.Date(2026, 10, 15, 15, 0, 0, 0, time.UTC))})
	got := parseSyncedPayload(t, h.ledger)
	assertPayload(t, got, 100, 0, 600, 0)
	if aapl, _ := findPosition(got.Positions, "AAPL"); aapl.Qty != 40 {
		t.Errorf("AAPL qty = %v, want 40", aapl.Qty)
	}
}

func TestConfirmOrder_AC47_FrozenReconfirmLeavesPayload(t *testing.T) {
	h := newConfirmHarness(t)
	h.seedS1History()
	h.confirm(&tradingv1.ConfirmOrderRequest{OrderId: testdata.S1SellID, FilledQty: 40, FilledAvgPrice: 165, Fees: proto.Float64(2)})
	got := parseSyncedPayload(t, h.ledger)
	assertPayload(t, got, 100, 0, 600, 0)
	if aapl, _ := findPosition(got.Positions, "AAPL"); aapl.Qty != 40 {
		t.Errorf("AAPL qty = %v, want 40", aapl.Qty)
	}
}

func TestOfflineRecompute_RecentFillsWindow(t *testing.T) {
	now := time.Now()
	old := confirmedOrder("AAPL", tradingv1.OrderSide_ORDER_SIDE_BUY, 10, 100, now.Add(-11*24*time.Hour))
	frozen := confirmedOrder("AAPL", tradingv1.OrderSide_ORDER_SIDE_BUY, 5, 100, now.Add(-7*24*time.Hour))
	recent := confirmedOrder("AAPL", tradingv1.OrderSide_ORDER_SIDE_SELL, 4, 110, now.Add(-2*24*time.Hour))
	baseline, ledger := &fakeBaselineStore{confirmedOrders: []*tradingv1.Order{old, frozen, recent}}, &recordingLedger{}
	svc := newSnapshotTestService(baseline, ledger)

	if err := svc.recomputeAndEmitOfflinePositions(context.Background(), "acc-1", "user-1"); err != nil {
		t.Fatal(err)
	}
	if fills := parseSyncedPayload(t, ledger).RecentFills; len(fills) != 2 {
		t.Errorf("no-baseline recent_fills = %v, want the 7- and 2-day fills only (11 days is outside)", fills)
	}

	s1Snapshot(t, svc, "snap", now.Add(-5*24*time.Hour), posBaseline("AAPL", 15, 100))
	fills := parseSyncedPayload(t, ledger).RecentFills
	if len(fills) != 1 {
		t.Fatalf("recent_fills = %v, want only the post-snapshot sell (frozen-window fill excluded)", fills)
	}
	at, err := time.Parse(time.RFC3339Nano, fills[0]["filled_at"].(string))
	if fills[0]["symbol"] != "AAPL" || fills[0]["qty"] != -4.0 || fills[0]["price"] != 110.0 || err != nil || !at.Equal(recent.FilledAt.AsTime()) {
		t.Errorf("recent fill = %v (parse err %v), want AAPL −4 @110 at %v", fills[0], err, recent.FilledAt.AsTime())
	}
}
