package service

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	tradingv1 "github.com/xstockstrat/contracts/gen/go/trading/v1"
	"github.com/xstockstrat/trading/internal/broker"
	"github.com/xstockstrat/trading/internal/config"
	"github.com/xstockstrat/trading/internal/repository"
)

// Characterization tests: they pin the poller behavior that existed before the telemetry was
// added, so a later edit that changes what these loops do (not just what they record) fails here.

type credCheckBroker struct {
	fakeReconciliationBroker
	err error
}

func (b *credCheckBroker) ValidateCredentials(context.Context) error { return b.err }

type credStatusRepo struct {
	repository.AccountRepository
	mu     sync.Mutex
	writes map[string]int32
	calls  int
}

func (r *credStatusRepo) UpdateCredentialStatus(_ context.Context, id string, status int32, _ time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.writes[id] = status
	r.calls++
	return nil
}

func TestCheckCredentialHealthCharacterization(t *testing.T) {
	repo := &credStatusRepo{writes: map[string]int32{}}
	svc := &TradingService{
		accountRepo: repo,
		credStatus:  map[string]int32{},
		brokers: map[string]brokerPoolEntry{
			"acc-ok":   {client: &credCheckBroker{}, brokerType: int32(commonv1.BrokerType_BROKER_TYPE_ALPACA)},
			"acc-bad":  {client: &credCheckBroker{err: broker.ErrInvalidCredentials}, brokerType: int32(commonv1.BrokerType_BROKER_TYPE_IBKR)},
			"acc-down": {client: &credCheckBroker{err: errors.New("dial tcp: connection refused")}, brokerType: int32(commonv1.BrokerType_BROKER_TYPE_ALPACA)},
			"acc-off":  {brokerType: int32(commonv1.BrokerType_BROKER_TYPE_OFFLINE)},
		},
	}

	svc.checkCredentialHealth(context.Background())

	want := map[string]int32{
		"acc-ok":   int32(tradingv1.CredentialStatus_CREDENTIAL_STATUS_OK),
		"acc-bad":  int32(tradingv1.CredentialStatus_CREDENTIAL_STATUS_INVALID),
		"acc-down": int32(tradingv1.CredentialStatus_CREDENTIAL_STATUS_UNKNOWN),
	}
	if len(svc.credStatus) != len(want) {
		t.Fatalf("credStatus = %v, want exactly %v (the offline account is never validated)", svc.credStatus, want)
	}
	for id, st := range want {
		if svc.credStatus[id] != st {
			t.Errorf("credStatus[%s] = %d, want %d", id, svc.credStatus[id], st)
		}
		if repo.writes[id] != st {
			t.Errorf("persisted status for %s = %d, want %d", id, repo.writes[id], st)
		}
	}
	if repo.calls != 3 {
		t.Fatalf("UpdateCredentialStatus calls = %d, want 3", repo.calls)
	}

	svc.checkCredentialHealth(context.Background())
	if repo.calls != 3 {
		t.Errorf("an unchanged status was re-persisted: calls = %d, want 3", repo.calls)
	}
}

type sweepIntentRepo struct {
	repository.OrderIntentRepository
	stale     []*repository.OrderIntentRecord
	sweepErr  error
	reclaim   func(id string) (bool, *repository.OrderIntentRecord, error)
	reclaimed []string
}

func (r *sweepIntentRepo) SweepStalePending(context.Context, time.Time, int) ([]*repository.OrderIntentRecord, error) {
	return r.stale, r.sweepErr
}

func (r *sweepIntentRepo) ReclaimOrphanIntent(_ context.Context, id string, _ time.Time) (bool, *repository.OrderIntentRecord, error) {
	r.reclaimed = append(r.reclaimed, id)
	return r.reclaim(id)
}

func TestSweepOrderIntentsCharacterization(t *testing.T) {
	t.Run("reclaims each stale intent and emits one event per reclaim", func(t *testing.T) {
		repo := &sweepIntentRepo{
			stale: []*repository.OrderIntentRecord{{IntentID: "int-1"}, {IntentID: "int-2"}, {IntentID: "int-3"}},
			reclaim: func(id string) (bool, *repository.OrderIntentRecord, error) {
				switch id {
				case "int-1":
					return true, &repository.OrderIntentRecord{IntentID: id, OrderID: "ord-1"}, nil
				case "int-2":
					return false, nil, nil
				default:
					return false, nil, errors.New("cas failed")
				}
			},
		}
		ledger := &recordingLedgerClient{}
		svc := &TradingService{cfgW: &config.Watcher{}, orderIntentRepo: repo, ledger: ledger}

		svc.sweepOrderIntents(context.Background())

		if len(repo.reclaimed) != 3 {
			t.Fatalf("ReclaimOrphanIntent calls = %v, want one per stale intent", repo.reclaimed)
		}
		if len(ledger.events) != 1 || ledger.events[0].EventType != reclaimedUnknownEventType || ledger.events[0].StreamKey != "order:ord-1" {
			t.Fatalf("ledger events = %v, want one %s on order:ord-1", ledger.eventTypes(), reclaimedUnknownEventType)
		}
	})

	t.Run("a select failure reclaims nothing", func(t *testing.T) {
		repo := &sweepIntentRepo{sweepErr: errors.New("db down")}
		ledger := &recordingLedgerClient{}
		svc := &TradingService{cfgW: &config.Watcher{}, orderIntentRepo: repo, ledger: ledger}

		svc.sweepOrderIntents(context.Background())

		if len(repo.reclaimed) != 0 || len(ledger.events) != 0 {
			t.Fatalf("reclaims = %v, events = %v; want none after a failed select", repo.reclaimed, ledger.eventTypes())
		}
	})
}

type failingBracketScan struct{ *fakeBracketRepo }

func (failingBracketScan) ListExpiredProtection(context.Context, time.Time) ([]*repository.OrderBracketRecord, error) {
	return nil, errors.New("scan timeout")
}

func newBracketWatchdogService(repo repository.BracketRepository) *TradingService {
	return &TradingService{
		bracketRepo:     repo,
		brokers:         map[string]brokerPoolEntry{},
		orders:          map[string]*tradingv1.Order{},
		flattenInFlight: map[string]bool{},
		notify:          &fakeNotifyClient{},
	}
}

func inFlightCount(svc *TradingService) int {
	svc.flattenInFlightMu.Lock()
	defer svc.flattenInFlightMu.Unlock()
	return len(svc.flattenInFlight)
}

func hasMsg(recs []map[string]any, msg string) bool {
	for _, r := range recs {
		if r["msg"] == msg {
			return true
		}
	}
	return false
}

func TestCheckBracketProtectionCharacterization(t *testing.T) {
	expired := func(repo *fakeBracketRepo) *repository.OrderBracketRecord {
		rec := &repository.OrderBracketRecord{AccountID: "acc-gone", OrderID: "ord-1", Status: bracketStatusSubmitting,
			ProtectionDeadline: time.Now().Add(-time.Minute)}
		if err := repo.CreateBracket(context.Background(), rec); err != nil {
			t.Fatal(err)
		}
		return rec
	}

	t.Run("an expired bracket is flattened once and released", func(t *testing.T) {
		logs := captureLogs(t)
		repo := &fakeBracketRepo{}
		rec := expired(repo)
		svc := newBracketWatchdogService(repo)

		svc.checkBracketProtection(context.Background())

		deadline := time.Now().Add(2 * time.Second)
		for inFlightCount(svc) != 0 {
			if time.Now().After(deadline) {
				t.Fatal("flatten goroutine never released its in-flight entry")
			}
			time.Sleep(5 * time.Millisecond)
		}
		if !hasMsg(logs(), "flattenAndHalt: no broker for account") {
			t.Fatal("flattenAndHalt was not run for the expired bracket")
		}
		got, _ := repo.GetBracketByOrderID(context.Background(), rec.OrderID)
		if got.Status != bracketStatusSubmitting {
			t.Errorf("bracket status = %d, want it untouched (%d)", got.Status, bracketStatusSubmitting)
		}
	})

	t.Run("an in-flight bracket is not flattened again", func(t *testing.T) {
		logs := captureLogs(t)
		repo := &fakeBracketRepo{}
		rec := expired(repo)
		svc := newBracketWatchdogService(repo)
		svc.flattenInFlight[rec.ID] = true

		svc.checkBracketProtection(context.Background())

		if !svc.flattenInFlight[rec.ID] || hasMsg(logs(), "flattenAndHalt: no broker for account") {
			t.Fatal("an in-flight bracket was flattened a second time")
		}
	})

	t.Run("a scan failure flattens nothing", func(t *testing.T) {
		logs := captureLogs(t)
		repo := &fakeBracketRepo{}
		expired(repo)
		svc := newBracketWatchdogService(failingBracketScan{repo})

		svc.checkBracketProtection(context.Background())

		if inFlightCount(svc) != 0 || !hasMsg(logs(), "checkBracketProtection: scan failed") {
			t.Fatalf("in-flight = %d after a failed scan; want 0 and the scan-failed WARN", inFlightCount(svc))
		}
	})
}

func TestReconcileTickPolledCharacterization(t *testing.T) {
	var mu sync.Mutex
	calls := map[string]int{}
	brokerFor := func(id string, err error) *fakeReconciliationBroker {
		return &fakeReconciliationBroker{listOrdersFn: func(context.Context) ([]broker.BrokerOrder, error) {
			mu.Lock()
			calls[id]++
			mu.Unlock()
			return nil, err
		}}
	}
	svc := newTestReconciliationService(map[string]brokerPoolEntry{
		"acc-invalid": {client: brokerFor("acc-invalid", nil), userID: "u-1"},
		"acc-halted":  {client: brokerFor("acc-halted", nil), userID: "u-1"},
		"acc-ok":      {client: brokerFor("acc-ok", nil), userID: "u-1"},
		"acc-err":     {client: brokerFor("acc-err", errors.New("broker unreachable")), userID: "u-1"},
		"acc-off":     {brokerType: int32(commonv1.BrokerType_BROKER_TYPE_OFFLINE)},
	}, &fakeReconciliationPortfolioClient{}, &recordingLedgerClient{}, &fakeNotifyClient{}, noopAccountRepo{})
	svc.credStatus["acc-invalid"] = int32(tradingv1.CredentialStatus_CREDENTIAL_STATUS_INVALID)
	svc.halted["acc-halted"] = true
	svc.haltedLastPolled["acc-halted"] = time.Now()

	systemic, total := svc.reconcileTick(context.Background(), 0, 1.1)

	if total != 4 || systemic != 1 {
		t.Fatalf("reconcileTick = (%d, %d), want (1, 4): the offline account is excluded, only acc-err is systemic", systemic, total)
	}
	want := map[string]int{"acc-ok": 1, "acc-err": 1}
	if len(calls) != len(want) || calls["acc-ok"] != 1 || calls["acc-err"] != 1 {
		t.Fatalf("ListOrders calls = %v, want %v (invalid-credential and in-cooldown halted accounts are skipped first)", calls, want)
	}
}
