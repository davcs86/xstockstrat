package service

import (
	"context"
	"sync"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	grpcstatus "google.golang.org/grpc/status"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	ledgerv1 "github.com/xstockstrat/contracts/gen/go/ledger/v1"
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
type recordingLedger struct {
	ledgerv1.LedgerServiceClient
	mu     sync.Mutex
	events []string
}

func (r *recordingLedger) AppendEvent(_ context.Context, req *ledgerv1.AppendEventRequest, _ ...grpc.CallOption) (*ledgerv1.AppendEventResponse, error) {
	r.mu.Lock()
	r.events = append(r.events, req.EventType)
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
	svc := &TradingService{
		cfgW:        &config.Watcher{},
		accountRepo: repo,
		ledger:      ledger,
		brokers:     map[string]brokerPoolEntry{"off-1": {brokerType: int32(commonv1.BrokerType_BROKER_TYPE_OFFLINE), userID: "user-1"}},
		credStatus:  map[string]int32{"off-1": 0},
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
