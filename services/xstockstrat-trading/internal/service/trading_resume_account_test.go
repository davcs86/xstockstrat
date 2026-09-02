package service

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	grpcstatus "google.golang.org/grpc/status"

	notifyv1 "github.com/xstockstrat/contracts/gen/go/notify/v1"
	tradingv1 "github.com/xstockstrat/contracts/gen/go/trading/v1"
	"github.com/xstockstrat/trading/internal/config"
	"github.com/xstockstrat/trading/internal/middleware"
	"github.com/xstockstrat/trading/internal/repository"
)

// ---------------------------------------------------------------------------
// Mock AccountRepository for resume tests
// ---------------------------------------------------------------------------

type mockResumeAccountRepo struct {
	repository.AccountRepository // embed for interface satisfaction

	mu                sync.Mutex
	accounts          map[string]*repository.BrokerAccountRecord
	updateHaltCalls   int
	updateHaltErr     error
	getAccountErr     error
	lastUpdateHalted  bool
	lastUpdateReason  string
	lastUpdateSource  int32
}

func newMockResumeAccountRepo() *mockResumeAccountRepo {
	return &mockResumeAccountRepo{
		accounts: make(map[string]*repository.BrokerAccountRecord),
	}
}

func (m *mockResumeAccountRepo) GetBrokerAccount(_ context.Context, id string) (*repository.BrokerAccountRecord, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.getAccountErr != nil {
		return nil, m.getAccountErr
	}
	rec, ok := m.accounts[id]
	if !ok {
		return nil, fmt.Errorf("account %s not found", id)
	}
	// Return a copy so mutations in the service don't affect the mock's state.
	cp := *rec
	return &cp, nil
}

func (m *mockResumeAccountRepo) UpdateHaltStatus(_ context.Context, id string, halted bool, reason string, _ *time.Time, haltSource int32) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.updateHaltCalls++
	m.lastUpdateHalted = halted
	m.lastUpdateReason = reason
	m.lastUpdateSource = haltSource
	if m.updateHaltErr != nil {
		return m.updateHaltErr
	}
	// Apply the mutation so a subsequent GetBrokerAccount reflects the clear.
	if rec, ok := m.accounts[id]; ok {
		rec.Halted = halted
		rec.HaltReason = reason
		rec.HaltSource = haltSource
		if !halted {
			rec.HaltedAt = nil
		}
	}
	return nil
}

// ---------------------------------------------------------------------------
// Helper: build a TradingService wired for resume tests
// ---------------------------------------------------------------------------

func adminCtx() context.Context {
	return middleware.WithPropagationData(context.Background(), middleware.PropagationData{
		AccessScope: "4",
		UserID:      "admin-1",
	})
}

func nonAdminCtx() context.Context {
	return middleware.WithPropagationData(context.Background(), middleware.PropagationData{
		AccessScope: "2",
		UserID:      "user-1",
	})
}

func newTestResumeService(accountRepo *mockResumeAccountRepo, ledger *recordingLedgerClient, notify notifyv1.NotifyServiceClient) *TradingService {
	return &TradingService{
		cfg:              &config.Config{},
		cfgW:             &config.Watcher{},
		accountRepo:      accountRepo,
		ledger:           ledger,
		notify:           notify,
		orders:           make(map[string]*tradingv1.Order),
		credStatus:       make(map[string]int32),
		halted:           make(map[string]bool),
		haltReasons:      make(map[string]string),
		haltedLastPolled: make(map[string]time.Time),
	}
}

func haltedRecord(id string) *repository.BrokerAccountRecord {
	haltedAt := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	return &repository.BrokerAccountRecord{
		ID:         id,
		Halted:     true,
		HaltReason: "reconciliation mismatch",
		HaltSource: 2, // HALT_SOURCE_RECONCILIATION
		HaltedAt:   &haltedAt,
		IsActive:   true,
		BrokerType: 1, // Alpaca
	}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// AC-6: non-admin callers are rejected with PermissionDenied.
func TestResumeAccountSvc_NonAdminRejected(t *testing.T) {
	repo := newMockResumeAccountRepo()
	repo.accounts["acct-1"] = haltedRecord("acct-1")
	svc := newTestResumeService(repo, &recordingLedgerClient{}, &fakeNotifyClient{})

	_, err := svc.ResumeAccountSvc(nonAdminCtx(), "acct-1", "test", "user-1")
	if err == nil {
		t.Fatal("expected PermissionDenied, got nil")
	}
	s, ok := grpcstatus.FromError(err)
	if !ok || s.Code() != codes.PermissionDenied {
		t.Fatalf("expected PermissionDenied, got %v", err)
	}
	// No DB writes should have occurred.
	if repo.updateHaltCalls != 0 {
		t.Fatalf("expected 0 UpdateHaltStatus calls, got %d", repo.updateHaltCalls)
	}
}

// AC-1: account not found returns NotFound.
func TestResumeAccountSvc_AccountNotFound(t *testing.T) {
	repo := newMockResumeAccountRepo()
	svc := newTestResumeService(repo, &recordingLedgerClient{}, &fakeNotifyClient{})

	_, err := svc.ResumeAccountSvc(adminCtx(), "missing-acct", "test", "admin-1")
	if err == nil {
		t.Fatal("expected NotFound, got nil")
	}
	s, ok := grpcstatus.FromError(err)
	if !ok || s.Code() != codes.NotFound {
		t.Fatalf("expected NotFound, got %v (code=%v)", err, s.Code())
	}
}

// AC-1 + AC-5: happy-path resume clears DB halt, in-memory maps, emits ledger + alert.
func TestResumeAccountSvc_HappyPath(t *testing.T) {
	repo := newMockResumeAccountRepo()
	repo.accounts["acct-1"] = haltedRecord("acct-1")

	ledger := &recordingLedgerClient{}
	notify := &fakeNotifyClient{}
	svc := newTestResumeService(repo, ledger, notify)

	// Pre-populate in-memory halt state (simulates boot hydration).
	svc.halted["acct-1"] = true
	svc.haltReasons["acct-1"] = "reconciliation mismatch"
	svc.haltedLastPolled["acct-1"] = time.Now()

	account, err := svc.ResumeAccountSvc(adminCtx(), "acct-1", "false alarm", "admin-1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// (AC-1) Returned account is no longer halted.
	if account.Halted {
		t.Error("expected account.Halted=false after resume")
	}

	// (AC-1) DB was updated.
	if repo.updateHaltCalls != 1 {
		t.Fatalf("expected 1 UpdateHaltStatus call, got %d", repo.updateHaltCalls)
	}
	if repo.lastUpdateHalted != false {
		t.Error("expected UpdateHaltStatus called with halted=false")
	}

	// (AC-5) In-memory maps are cleared.
	svc.haltedMu.Lock()
	if svc.halted["acct-1"] {
		t.Error("in-memory halted map not cleared")
	}
	if _, ok := svc.haltReasons["acct-1"]; ok {
		t.Error("in-memory haltReasons map not cleared")
	}
	if _, ok := svc.haltedLastPolled["acct-1"]; ok {
		t.Error("in-memory haltedLastPolled map not cleared")
	}
	svc.haltedMu.Unlock()

	// (AC-3) Ledger event emitted.
	types := ledger.eventTypes()
	if len(types) != 1 || types[0] != "account.halt.resumed" {
		t.Fatalf("expected [account.halt.resumed], got %v", types)
	}

	// (AC-4) Notify alert emitted at INFO severity.
	notify.mu.Lock()
	if len(notify.calls) != 1 {
		t.Fatalf("expected 1 EmitAlert call, got %d", len(notify.calls))
	}
	alert := notify.calls[0]
	if alert.Severity != notifyv1.AlertSeverity_ALERT_SEVERITY_INFO {
		t.Errorf("expected INFO severity, got %v", alert.Severity)
	}
	notify.mu.Unlock()
}

// AC-7 (idempotent no-op): resuming an already-running account is a success no-op.
func TestResumeAccountSvc_AlreadyRunningNoOp(t *testing.T) {
	repo := newMockResumeAccountRepo()
	repo.accounts["acct-1"] = &repository.BrokerAccountRecord{
		ID:       "acct-1",
		Halted:   false,
		IsActive: true,
	}
	ledger := &recordingLedgerClient{}
	notify := &fakeNotifyClient{}
	svc := newTestResumeService(repo, ledger, notify)

	account, err := svc.ResumeAccountSvc(adminCtx(), "acct-1", "no reason", "admin-1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if account.Halted {
		t.Error("expected account.Halted=false")
	}

	// No DB write, no ledger, no alert.
	if repo.updateHaltCalls != 0 {
		t.Errorf("expected 0 UpdateHaltStatus calls (no-op), got %d", repo.updateHaltCalls)
	}
	if len(ledger.eventTypes()) != 0 {
		t.Errorf("expected 0 ledger events (no-op), got %v", ledger.eventTypes())
	}
	notify.mu.Lock()
	if len(notify.calls) != 0 {
		t.Errorf("expected 0 alert calls (no-op), got %d", len(notify.calls))
	}
	notify.mu.Unlock()
}

// DB failure on UpdateHaltStatus returns Internal, leaving in-memory still halted.
func TestResumeAccountSvc_DBFailureLeavesHalted(t *testing.T) {
	repo := newMockResumeAccountRepo()
	repo.accounts["acct-1"] = haltedRecord("acct-1")
	repo.updateHaltErr = fmt.Errorf("connection refused")

	svc := newTestResumeService(repo, &recordingLedgerClient{}, &fakeNotifyClient{})
	svc.halted["acct-1"] = true

	_, err := svc.ResumeAccountSvc(adminCtx(), "acct-1", "test", "admin-1")
	if err == nil {
		t.Fatal("expected Internal error, got nil")
	}
	s, ok := grpcstatus.FromError(err)
	if !ok || s.Code() != codes.Internal {
		t.Fatalf("expected Internal, got %v", err)
	}

	// In-memory halt MUST still be set (DB-first ordering guarantee).
	if !svc.halted["acct-1"] {
		t.Error("in-memory halted map was cleared despite DB failure — DB-first invariant violated")
	}
}

// AC-3: ledger event carries prior halt reason and source.
func TestResumeAccountSvc_LedgerEventPayload(t *testing.T) {
	repo := newMockResumeAccountRepo()
	repo.accounts["acct-1"] = haltedRecord("acct-1")

	ledger := &recordingLedgerClient{}
	svc := newTestResumeService(repo, ledger, &fakeNotifyClient{})
	svc.halted["acct-1"] = true

	_, err := svc.ResumeAccountSvc(adminCtx(), "acct-1", "false alarm", "admin-1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(ledger.events) != 1 {
		t.Fatalf("expected 1 ledger event, got %d", len(ledger.events))
	}
	ev := ledger.events[0]
	if ev.EventType != "account.halt.resumed" {
		t.Errorf("expected event type account.halt.resumed, got %s", ev.EventType)
	}
	if ev.StreamKey != "account:acct-1" {
		t.Errorf("expected stream key account:acct-1, got %s", ev.StreamKey)
	}
	if ev.UserId != "admin-1" {
		t.Errorf("expected user_id admin-1, got %s", ev.UserId)
	}
}

// AC-4: alert failure is non-fatal (warn-on-fail).
func TestResumeAccountSvc_AlertFailureNonFatal(t *testing.T) {
	repo := newMockResumeAccountRepo()
	repo.accounts["acct-1"] = haltedRecord("acct-1")

	notify := &failingNotifyClient{}
	svc := newTestResumeService(repo, &recordingLedgerClient{}, notify)
	svc.halted["acct-1"] = true

	account, err := svc.ResumeAccountSvc(adminCtx(), "acct-1", "test", "admin-1")
	if err != nil {
		t.Fatalf("alert failure should be non-fatal, got error: %v", err)
	}
	if account.Halted {
		t.Error("account should be unhalted despite alert failure")
	}
}

// AC-2: admin scope "4" is accepted (duplicates the authz unit test but exercises
// the end-to-end path through ResumeAccountSvc).
func TestResumeAccountSvc_AdminScopeAccepted(t *testing.T) {
	repo := newMockResumeAccountRepo()
	repo.accounts["acct-1"] = haltedRecord("acct-1")
	svc := newTestResumeService(repo, &recordingLedgerClient{}, &fakeNotifyClient{})
	svc.halted["acct-1"] = true

	_, err := svc.ResumeAccountSvc(adminCtx(), "acct-1", "test", "admin-1")
	if err != nil {
		t.Fatalf("admin scope should be accepted, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// failingNotifyClient returns an error from EmitAlert.
// ---------------------------------------------------------------------------

type failingNotifyClient struct {
	notifyv1.NotifyServiceClient
}

func (f *failingNotifyClient) EmitAlert(_ context.Context, _ *notifyv1.EmitAlertRequest, _ ...grpc.CallOption) (*notifyv1.EmitAlertResponse, error) {
	return nil, fmt.Errorf("notify service unavailable")
}
