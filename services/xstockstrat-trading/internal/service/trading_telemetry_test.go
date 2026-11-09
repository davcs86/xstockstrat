package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric/noop"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	grpcstatus "google.golang.org/grpc/status"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	ledgerv1 "github.com/xstockstrat/contracts/gen/go/ledger/v1"
	portfoliov1 "github.com/xstockstrat/contracts/gen/go/portfolio/v1"
	tradingv1 "github.com/xstockstrat/contracts/gen/go/trading/v1"
	"github.com/xstockstrat/trading/internal/broker"
	"github.com/xstockstrat/trading/internal/config"
	"github.com/xstockstrat/trading/internal/repository"
	"github.com/xstockstrat/trading/internal/telemetry"
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
		svc := &TradingService{cfgW: &config.Watcher{}, platformCfgW: &config.Watcher{}, orderIntentRepo: repo, ledger: ledger}

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
		svc := &TradingService{cfgW: &config.Watcher{}, platformCfgW: &config.Watcher{}, orderIntentRepo: repo, ledger: ledger}

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

// ── New-behavior cases: counters, tick records, clock seam ──────────────────────────────────
// No t.Parallel(): every test below swaps the process-global MeterProvider and slog default.

func installMetricReader(t *testing.T) *sdkmetric.ManualReader {
	t.Helper()
	prev := otel.GetMeterProvider()
	reader := sdkmetric.NewManualReader()
	mp := sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader))
	otel.SetMeterProvider(mp)
	t.Cleanup(func() {
		otel.SetMeterProvider(prev)
		_ = mp.Shutdown(context.Background())
	})
	return reader
}

func int64Points(t *testing.T, reader *sdkmetric.ManualReader) map[string][]metricdata.DataPoint[int64] {
	t.Helper()
	var rm metricdata.ResourceMetrics
	if err := reader.Collect(context.Background(), &rm); err != nil {
		t.Fatalf("collect: %v", err)
	}
	out := map[string][]metricdata.DataPoint[int64]{}
	for _, sm := range rm.ScopeMetrics {
		for _, m := range sm.Metrics {
			if sum, ok := m.Data.(metricdata.Sum[int64]); ok {
				out[m.Name] = append(out[m.Name], sum.DataPoints...)
			}
		}
	}
	return out
}

// counterValue sums name's points whose attribute set holds every kv.
func counterValue(t *testing.T, reader *sdkmetric.ManualReader, name string, kv ...attribute.KeyValue) int64 {
	t.Helper()
	var total int64
	for _, dp := range int64Points(t, reader)[name] {
		match := true
		for _, want := range kv {
			if got, ok := dp.Attributes.Value(want.Key); !ok || got != want.Value {
				match = false
				break
			}
		}
		if match {
			total += dp.Value
		}
	}
	return total
}

func outcome(v string) attribute.KeyValue { return attribute.String(telemetry.KeyOutcome, v) }

// assertNoAttrContains fails if any recorded metric attribute value contains one of needles.
func assertNoAttrContains(t *testing.T, reader *sdkmetric.ManualReader, needles ...string) {
	t.Helper()
	for name, dps := range int64Points(t, reader) {
		for _, dp := range dps {
			for _, kv := range dp.Attributes.ToSlice() {
				for _, n := range needles {
					if strings.Contains(kv.Value.String(), n) {
						t.Errorf("%s attribute %s=%q contains %q", name, kv.Key, kv.Value.String(), n)
					}
				}
			}
		}
	}
}

func logsWithMsg(recs []map[string]any, msg string) []map[string]any {
	var out []map[string]any
	for _, r := range recs {
		if r["msg"] == msg {
			out = append(out, r)
		}
	}
	return out
}

type stubPositionPortfolio struct {
	portfoliov1.PortfolioServiceClient
	pos *portfoliov1.Position
	err error
}

func (p stubPositionPortfolio) GetPosition(context.Context, *portfoliov1.GetPositionRequest, ...grpc.CallOption) (*portfoliov1.Position, error) {
	return p.pos, p.err
}

func TestFlattenAndHalt_PositionLookupOutcomes(t *testing.T) {
	cases := []struct {
		name      string
		pos       *portfoliov1.Position
		err       error
		wantOut   string
		otherOut  string
		wantMsg   string
		wantLevel string
	}{
		{"AC-1 lookup error", nil, grpcstatus.Error(codes.Unavailable, "portfolio down"), "lookup_error", "flat", "flattenAndHalt: position lookup failed", "ERROR"},
		{"AC-2 flat qty 0", &portfoliov1.Position{Symbol: "AAPL", Qty: 0}, nil, "flat", "lookup_error", "flattenAndHalt: no open position to flatten", "INFO"},
		{"AC-57 not found is flat", nil, grpcstatus.Error(codes.NotFound, "no position"), "flat", "lookup_error", "flattenAndHalt: no open position to flatten", "INFO"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			reader := installMetricReader(t)
			logs := captureLogs(t)
			h := newFlattenHarness(func(int) (*broker.BrokerOrder, error) {
				t.Error("no flatten order may be submitted when the lookup returns no open position")
				return nil, errors.New("unexpected submit")
			})
			h.svc.portfolio = stubPositionPortfolio{pos: tc.pos, err: tc.err}

			h.run(t)

			if got := counterValue(t, reader, "trading.flatten.outcome", outcome(tc.wantOut)); got != 1 {
				t.Errorf("flatten.outcome{%s} = %d, want 1", tc.wantOut, got)
			}
			if got := counterValue(t, reader, "trading.flatten.outcome", outcome(tc.otherOut)); got != 0 {
				t.Errorf("flatten.outcome{%s} = %d, want unchanged (0)", tc.otherOut, got)
			}
			recs := logsWithMsg(logs(), tc.wantMsg)
			if len(recs) != 1 || recs[0]["level"] != tc.wantLevel {
				t.Fatalf("%q records = %v, want exactly one at %s", tc.wantMsg, recs, tc.wantLevel)
			}
			if h.svc.isAccountHalted("acct-1") {
				t.Error("the lookup branch must return without halting")
			}
			assertNoAttrContains(t, reader, "ord-1", "acct-1", "AAPL", "user-1")
		})
	}
}

type lookupFailBracketRepo struct{ *fakeBracketRepo }

func (lookupFailBracketRepo) GetBracketByOrderID(context.Context, string) (*repository.OrderBracketRecord, error) {
	return nil, errors.New("db: connection reset")
}

func TestMaybeSubmitBracket_LookupFailed_CountedWithoutRowOrAlert(t *testing.T) {
	reader := installMetricReader(t)
	rows := &fakeBracketRepo{}
	notify := &fakeNotifyClient{}
	svc := newTestBracketService(lookupFailBracketRepo{rows}, notify)
	order := newTestBracketOrder("ord-3", tradingv1.OrderSide_ORDER_SIDE_BUY, commonv1.BrokerType_BROKER_TYPE_ALPACA)
	entry := brokerPoolEntry{client: &fakeBroker{}, brokerType: int32(commonv1.BrokerType_BROKER_TYPE_ALPACA)}

	// stopPrice 145 > 0 and bracket orders enabled: the guard passes and the lookup is reached.
	svc.maybeSubmitBracket(context.Background(), order, entry, &broker.BrokerOrder{}, 145.0, 148.0, true)

	if got := counterValue(t, reader, "trading.bracket.outcome", outcome("lookup_failed")); got != 1 {
		t.Errorf("bracket.outcome{lookup_failed} = %d, want 1", got)
	}
	if got := counterValue(t, reader, "trading.bracket.outcome", outcome("created")); got != 0 {
		t.Errorf("bracket.outcome{created} = %d, want 0", got)
	}
	if len(rows.byOrder) != 0 {
		t.Errorf("order_brackets rows = %v, want none for ord-3", rows.byOrder)
	}
	if len(notify.calls) != 0 || counterValue(t, reader, "trading.alert_emit") != 0 {
		t.Errorf("alerts = %d, want none from the lookup-failed branch", len(notify.calls))
	}
}

// scriptedLedger returns results[i] for the i-th AppendEvent call, and the last entry after that.
type scriptedLedger struct {
	ledgerv1.LedgerServiceClient
	mu      sync.Mutex
	results []error
	calls   int
}

func (l *scriptedLedger) AppendEvent(context.Context, *ledgerv1.AppendEventRequest, ...grpc.CallOption) (*ledgerv1.AppendEventResponse, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	err := l.results[min(l.calls, len(l.results)-1)]
	l.calls++
	if err != nil {
		return nil, err
	}
	return &ledgerv1.AppendEventResponse{}, nil
}

var errLedgerUnavailable = grpcstatus.Error(codes.Unavailable, "ledger unavailable")

func TestEmitLedgerEvent_OutcomeAfterUnavailableRetry(t *testing.T) {
	filled := attribute.String(telemetry.KeyEventType, "order.filled")

	t.Run("AC-4 unavailable on both attempts", func(t *testing.T) {
		reader := installMetricReader(t)
		logs := captureLogs(t)
		ledger := &scriptedLedger{results: []error{errLedgerUnavailable, errLedgerUnavailable}}
		svc := &TradingService{ledger: ledger}

		svc.emitLedgerEvent(context.Background(), "order.filled", "ord-4", "u-4", map[string]interface{}{"order_id": "ord-4"})

		if ledger.calls != appendMaxAttempts {
			t.Fatalf("AppendEvent calls = %d, want %d", ledger.calls, appendMaxAttempts)
		}
		if got := counterValue(t, reader, "trading.ledger_emit", filled, outcome("failed")); got != 1 {
			t.Errorf("ledger_emit{order.filled, failed} = %d, want 1", got)
		}
		recs := logsWithMsg(logs(), "ledger emit failed")
		if len(recs) != 1 || recs[0]["stream_key"] != "ord-4" {
			t.Fatalf("ledger emit failed records = %v, want one with stream_key ord-4", recs)
		}
		assertNoAttrContains(t, reader, "ord-4", "u-4")
	})

	t.Run("AC-4 unavailable once then ok", func(t *testing.T) {
		reader := installMetricReader(t)
		logs := captureLogs(t)
		ledger := &scriptedLedger{results: []error{errLedgerUnavailable, nil}}
		svc := &TradingService{ledger: ledger}

		svc.emitLedgerEvent(context.Background(), "order.filled", "ord-4", "u-4", map[string]interface{}{"order_id": "ord-4"})

		if got := counterValue(t, reader, "trading.ledger_emit", filled, outcome("retried_ok")); got != 1 {
			t.Errorf("ledger_emit{order.filled, retried_ok} = %d, want 1", got)
		}
		if got := counterValue(t, reader, "trading.ledger_emit", filled, outcome("failed")); got != 0 {
			t.Errorf("ledger_emit{order.filled, failed} = %d, want 0", got)
		}
		if len(logsWithMsg(logs(), "ledger emit failed")) != 0 {
			t.Error("a retried-ok emit must not log a failure")
		}
	})
}

func TestPlaceOrder_SubmitOutcomeIsBounded(t *testing.T) {
	t.Run("AC-5 Alpaca definite rejection", func(t *testing.T) {
		reader := installMetricReader(t)
		ledger := &recordingLedgerClient{}
		svc := auditSvc(&ctxCapturingDB{}, rejectBroker(), ledger, map[string]*tradingv1.Order{})

		if _, err := svc.PlaceOrder(ctxAsUser("u-1"), placeReq()); err == nil {
			t.Fatal("want the broker rejection surfaced as an error")
		}
		waitForLedgerEvents(t, ledger, 3) // order.created, order.submitted, order.broker_rejected

		got := counterValue(t, reader, "trading.order_submit", attribute.String(telemetry.KeyBrokerType, "ALPACA"), outcome("rejected"))
		if got != 1 {
			t.Errorf("order_submit{ALPACA, rejected} = %d, want 1", got)
		}
		assertNoAttrContains(t, reader, "insufficient buying power", "acct-1", "u-1", "AAPL")
	})

	t.Run("AC-45 IBKR uncertain timeout", func(t *testing.T) {
		reader := installMetricReader(t)
		ledger := &recordingLedgerClient{}
		svc := auditSvc(&ctxCapturingDB{}, timeoutBroker(), ledger, map[string]*tradingv1.Order{})
		entry := svc.brokers["acct-1"]
		entry.brokerType = int32(commonv1.BrokerType_BROKER_TYPE_IBKR)
		svc.brokers["acct-1"] = entry

		if _, err := svc.PlaceOrder(ctxAsUser("u-1"), placeReq()); err == nil {
			t.Fatal("want the broker timeout surfaced as an error")
		}
		waitForLedgerEvents(t, ledger, 3) // order.created, order.submitted, order.broker_call_uncertain

		got := counterValue(t, reader, "trading.order_submit", attribute.String(telemetry.KeyBrokerType, "IBKR"), outcome("uncertain"))
		if got != 1 {
			t.Errorf("order_submit{IBKR, uncertain} = %d, want 1", got)
		}
	})
}

func TestReconcileTick_RepeatedSystemicEscalationCounted(t *testing.T) {
	reader := installMetricReader(t)
	failing := &fakeReconciliationBroker{listOrdersFn: func(context.Context) ([]broker.BrokerOrder, error) {
		return nil, errors.New("broker unreachable")
	}}
	svc := newTestReconciliationService(map[string]brokerPoolEntry{
		"acc-1": {client: failing, userID: "u-1"},
		"acc-2": {client: failing, userID: "u-2"},
		"acc-3": {client: &fakeReconciliationBroker{}, userID: "u-3"},
		"acc-4": {client: &fakeReconciliationBroker{}, userID: "u-4"},
	}, &fakeReconciliationPortfolioClient{}, &recordingLedgerClient{}, &fakeNotifyClient{}, noopAccountRepo{})
	setter := &fakeConfigSetter{}
	svc.configSetter = setter

	for range 3 {
		svc.reconcileTick(context.Background(), 0, 0.5)
	}

	if got := counterValue(t, reader, "trading.escalation.systemic"); got != 3 {
		t.Errorf("escalation.systemic = %d, want 3", got)
	}
	if len(setter.calls) != 3 {
		t.Errorf("SetConfig calls = %d, want 3 (one escalation per tick, behavior unchanged)", len(setter.calls))
	}
}

// persistedStatusDB records the status and filled_qty argument of every UpsertOrder Exec.
type persistedStatusDB struct {
	execOnlyDB
	mu   sync.Mutex
	rows []string
}

func (d *persistedStatusDB) Exec(_ context.Context, _ string, args ...any) (pgconn.CommandTag, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.rows = append(d.rows, fmt.Sprintf("%v/%v", args[6], args[8]))
	return pgconn.CommandTag{}, nil
}

// runPartialThenFill polls one order through PARTIALLY_FILLED then FILLED and returns what was persisted.
func runPartialThenFill(t *testing.T) []string {
	t.Helper()
	call := 0
	fb := &fakeBroker{getOrderFn: func(context.Context, string) (*broker.BrokerOrder, error) {
		call++
		if call == 1 {
			return &broker.BrokerOrder{Status: "partially_filled", FilledQty: 4, FilledAvgPrice: 100}, nil
		}
		return &broker.BrokerOrder{Status: "filled", FilledQty: 10, FilledAvgPrice: 101}, nil
	}}
	db := &persistedStatusDB{}
	ledger := &recordingLedgerClient{}
	svc := &TradingService{
		cfgW: &config.Watcher{}, platformCfgW: &config.Watcher{}, repo: repository.NewTradingRepoWithDB(db), ledger: ledger, notify: &fakeNotifyClient{},
		bracketRepo: &fakeBracketRepo{},
		brokers:     map[string]brokerPoolEntry{"acc-45": {client: fb, brokerType: int32(commonv1.BrokerType_BROKER_TYPE_ALPACA), userID: "u-45"}},
		orders: map[string]*tradingv1.Order{"ord-45": {
			OrderId: "ord-45", AccountId: "acc-45", UserId: "u-45", BrokerOrderId: "bo-45", Symbol: "AAPL",
			Status: tradingv1.OrderStatus_ORDER_STATUS_NEW, Qty: 10,
		}},
	}
	svc.pollFills(context.Background())
	svc.pollFills(context.Background())
	waitForLedgerEvents(t, ledger, 2) // order.partially_filled, order.filled
	db.mu.Lock()
	defer db.mu.Unlock()
	return append([]string(nil), db.rows...)
}

func TestPollFills_PartialThenFilledUnchangedByTelemetry(t *testing.T) {
	prev := otel.GetMeterProvider()
	otel.SetMeterProvider(noop.NewMeterProvider())
	baseline := runPartialThenFill(t)
	otel.SetMeterProvider(prev)

	installMetricReader(t)
	instrumented := runPartialThenFill(t)

	if len(baseline) != 2 || fmt.Sprint(baseline) != fmt.Sprint(instrumented) {
		t.Fatalf("persisted (status/filled_qty) with telemetry = %v, baseline without = %v; want two identical rows", instrumented, baseline)
	}
}

type syncPositionsBroker struct{ fakeReconciliationBroker }

func (*syncPositionsBroker) GetAccount(context.Context) (*broker.BrokerBalance, error) {
	return nil, errors.New("balance endpoint down")
}

func TestSyncPositions_FailedLedgerEmitStillCountsSynced(t *testing.T) {
	reader := installMetricReader(t)
	logs := captureLogs(t)
	fb := &syncPositionsBroker{fakeReconciliationBroker{getPositionsFn: func(context.Context) ([]broker.BrokerPosition, error) {
		return []broker.BrokerPosition{{Symbol: "AAPL", Quantity: 5}}, nil
	}}}
	svc := &TradingService{
		cfgW: &config.Watcher{}, platformCfgW: &config.Watcher{}, ledger: &scriptedLedger{results: []error{errLedgerUnavailable}},
		brokers:    map[string]brokerPoolEntry{"acc-59": {client: fb, brokerType: int32(commonv1.BrokerType_BROKER_TYPE_ALPACA), userID: "u-59"}},
		credStatus: map[string]int32{}, credSkipLoggedAt: map[string]time.Time{},
	}

	synced, skipped, failed := svc.syncPositions(context.Background())

	if synced != 1 || skipped != 0 || failed != 0 {
		t.Errorf("syncPositions = (%d, %d, %d), want (1, 0, 0): a failed emit still counts in accounts_synced", synced, skipped, failed)
	}
	positions := attribute.String(telemetry.KeyEventType, "account.positions.synced")
	if got := counterValue(t, reader, "trading.ledger_emit", positions, outcome("failed")); got != 1 {
		t.Errorf("ledger_emit{account.positions.synced, failed} = %d, want 1", got)
	}
	if n := len(logsWithMsg(logs(), telemetry.LoopTickOKMsg)); n != 0 {
		t.Errorf("syncPositions wrote %d %q records; position sync keeps only its cycle heartbeat", n, telemetry.LoopTickOKMsg)
	}
}

func TestPollFills_TickRecordUsesInjectedClock(t *testing.T) {
	logs := captureLogs(t)
	now := time.Date(2026, 11, 6, 14, 30, 0, 0, time.UTC)
	call := 0
	fb := &fakeBroker{getOrderFn: func(context.Context, string) (*broker.BrokerOrder, error) {
		call++
		if call == 1 {
			now = now.Add(120 * time.Millisecond)
			return &broker.BrokerOrder{Status: "new"}, nil
		}
		return nil, errors.New("broker 503")
	}}
	svc := &TradingService{
		now:     func() time.Time { return now },
		brokers: map[string]brokerPoolEntry{"acc-6": {client: fb, brokerType: int32(commonv1.BrokerType_BROKER_TYPE_ALPACA)}},
		orders: map[string]*tradingv1.Order{"ord-6": {
			OrderId: "ord-6", AccountId: "acc-6", BrokerOrderId: "bo-6", Status: tradingv1.OrderStatus_ORDER_STATUS_NEW,
		}},
	}

	svc.pollFills(context.Background())
	afterFirst := len(logsWithMsg(logs(), telemetry.LoopTickOKMsg))
	svc.pollFills(context.Background())

	ticks := logsWithMsg(logs(), telemetry.LoopTickOKMsg)
	if afterFirst != 1 || len(ticks) != 1 {
		t.Fatalf("tick records after call 1 = %d, after call 2 = %d; want 1 and still 1", afterFirst, len(ticks))
	}
	r := ticks[0]
	if r["level"] != "INFO" || r["loop"] != string(telemetry.LoopFillPoller) || r["duration_ms"] != float64(120) {
		t.Errorf("tick record = %v, want INFO loop=fill_poller duration_ms=120", r)
	}
	if _, ok := r["state"]; ok {
		t.Errorf("a tick that polled an order must carry no state, got %v", r["state"])
	}
	if warns := logsWithMsg(logs(), "fill poll: broker GetOrder failed"); len(warns) != 1 || warns[0]["level"] != "WARN" {
		t.Errorf("GetOrder-failed records = %v, want one WARN for call 2", warns)
	}
}

// tickCase runs one loop tick; wantRecord false means a whole-tick failure that writes no record.
type tickCase struct {
	name       string
	loop       telemetry.Loop
	run        func(t *testing.T)
	wantRecord bool
	wantState  string
}

func tickCases() []tickCase {
	recon := func(brokers map[string]brokerPoolEntry) *TradingService {
		return newTestReconciliationService(brokers, &fakeReconciliationPortfolioClient{}, &recordingLedgerClient{}, &fakeNotifyClient{}, noopAccountRepo{})
	}
	failingList := &fakeReconciliationBroker{listOrdersFn: func(context.Context) ([]broker.BrokerOrder, error) {
		return nil, errors.New("broker unreachable")
	}}
	cred := func(brokers map[string]brokerPoolEntry) *TradingService {
		return &TradingService{accountRepo: &credStatusRepo{writes: map[string]int32{}}, credStatus: map[string]int32{}, brokers: brokers}
	}
	credDown := &credCheckBroker{err: errors.New("dial tcp: i/o timeout")}
	sweep := func(repo *sweepIntentRepo) {
		svc := &TradingService{cfgW: &config.Watcher{}, platformCfgW: &config.Watcher{}, orderIntentRepo: repo, ledger: &recordingLedgerClient{}}
		svc.sweepOrderIntents(context.Background())
	}
	reclaim := func(err error) func(string) (bool, *repository.OrderIntentRecord, error) {
		return func(id string) (bool, *repository.OrderIntentRecord, error) {
			if err != nil {
				return false, nil, err
			}
			return true, &repository.OrderIntentRecord{IntentID: id, OrderID: "ord-s"}, nil
		}
	}
	staleOne := []*repository.OrderIntentRecord{{IntentID: "int-s"}}
	alpaca := int32(commonv1.BrokerType_BROKER_TYPE_ALPACA)
	return []tickCase{
		{"fill_poller idle", telemetry.LoopFillPoller, func(*testing.T) {
			(&TradingService{brokers: map[string]brokerPoolEntry{}, orders: map[string]*tradingv1.Order{}}).pollFills(context.Background())
		}, true, "idle"},
		{"fill_poller skipped", telemetry.LoopFillPoller, func(*testing.T) {
			(&TradingService{brokers: map[string]brokerPoolEntry{}, orders: map[string]*tradingv1.Order{
				"ord-f": {OrderId: "ord-f", AccountId: "acc-f", BrokerOrderId: "bo-f", Status: tradingv1.OrderStatus_ORDER_STATUS_NEW},
			}}).pollFills(context.Background())
		}, true, "skipped"},
		{"reconciliation ok", telemetry.LoopReconciliation, func(*testing.T) {
			recon(map[string]brokerPoolEntry{"acc-r": {client: &fakeReconciliationBroker{}, userID: "u-r"}}).reconcileTick(context.Background(), 0, 1.1)
		}, true, ""},
		{"reconciliation idle", telemetry.LoopReconciliation, func(*testing.T) {
			recon(map[string]brokerPoolEntry{}).reconcileTick(context.Background(), 0, 1.1)
		}, true, "idle"},
		{"reconciliation every poll failed", telemetry.LoopReconciliation, func(*testing.T) {
			recon(map[string]brokerPoolEntry{"acc-r": {client: failingList, userID: "u-r"}}).reconcileTick(context.Background(), 0, 1.1)
		}, false, ""},
		{"credential_health ok", telemetry.LoopCredentialHealth, func(*testing.T) {
			cred(map[string]brokerPoolEntry{
				"acc-c":  {client: &credCheckBroker{}, brokerType: alpaca},
				"acc-c2": {client: credDown, brokerType: alpaca},
			}).checkCredentialHealth(context.Background())
		}, true, ""},
		{"credential_health idle", telemetry.LoopCredentialHealth, func(*testing.T) {
			cred(map[string]brokerPoolEntry{}).checkCredentialHealth(context.Background())
		}, true, "idle"},
		{"credential_health every check unknown", telemetry.LoopCredentialHealth, func(*testing.T) {
			cred(map[string]brokerPoolEntry{"acc-c": {client: credDown, brokerType: alpaca}}).checkCredentialHealth(context.Background())
		}, false, ""},
		{"bracket_watchdog ok", telemetry.LoopBracketWatchdog, func(t *testing.T) {
			repo := &fakeBracketRepo{}
			if err := repo.CreateBracket(context.Background(), &repository.OrderBracketRecord{AccountID: "acc-b", OrderID: "ord-b",
				Status: bracketStatusSubmitting, ProtectionDeadline: time.Now().Add(-time.Minute)}); err != nil {
				t.Fatal(err)
			}
			svc := newBracketWatchdogService(repo)
			svc.checkBracketProtection(context.Background())
			deadline := time.Now().Add(2 * time.Second)
			for inFlightCount(svc) != 0 {
				if time.Now().After(deadline) {
					t.Fatal("flatten goroutine never released its in-flight entry")
				}
				time.Sleep(5 * time.Millisecond)
			}
		}, true, ""},
		{"bracket_watchdog idle", telemetry.LoopBracketWatchdog, func(*testing.T) {
			newBracketWatchdogService(&fakeBracketRepo{}).checkBracketProtection(context.Background())
		}, true, "idle"},
		{"bracket_watchdog scan failed", telemetry.LoopBracketWatchdog, func(*testing.T) {
			newBracketWatchdogService(failingBracketScan{&fakeBracketRepo{}}).checkBracketProtection(context.Background())
		}, false, ""},
		{"order_intent_sweeper ok", telemetry.LoopOrderIntentSweeper, func(*testing.T) {
			sweep(&sweepIntentRepo{stale: staleOne, reclaim: reclaim(nil)})
		}, true, ""},
		{"order_intent_sweeper idle", telemetry.LoopOrderIntentSweeper, func(*testing.T) {
			sweep(&sweepIntentRepo{reclaim: reclaim(nil)})
		}, true, "idle"},
		{"order_intent_sweeper select failed", telemetry.LoopOrderIntentSweeper, func(*testing.T) {
			sweep(&sweepIntentRepo{sweepErr: errors.New("db down")})
		}, false, ""},
		{"order_intent_sweeper every reclaim failed", telemetry.LoopOrderIntentSweeper, func(*testing.T) {
			sweep(&sweepIntentRepo{stale: staleOne, reclaim: reclaim(errors.New("cas failed"))})
		}, false, ""},
	}
}

// tickIdentifiers are the account, user, symbol and order id fragments the tick cases use.
var tickIdentifiers = []string{"acc-", "u-r", "ord-", "bo-", "int-s", "AAPL"}

func TestLoopTickRecords(t *testing.T) {
	seen := map[string]bool{}
	for _, tc := range tickCases() {
		t.Run(tc.name, func(t *testing.T) {
			logs := captureLogs(t)
			tc.run(t)

			ticks := logsWithMsg(logs(), telemetry.LoopTickOKMsg)
			if !tc.wantRecord {
				if len(ticks) != 0 {
					t.Fatalf("tick records = %v, want none for a whole-tick failure", ticks)
				}
				return
			}
			if len(ticks) != 1 {
				t.Fatalf("tick records = %v, want exactly one", ticks)
			}
			r := ticks[0]
			if r["level"] != "INFO" || r["loop"] != string(tc.loop) {
				t.Errorf("tick record = %v, want INFO loop=%s", r, tc.loop)
			}
			if got, _ := r["state"].(string); got != tc.wantState {
				t.Errorf("state = %q, want %q", got, tc.wantState)
			}
			for k, v := range r {
				for _, id := range tickIdentifiers {
					if strings.Contains(fmt.Sprint(v), id) {
						t.Errorf("tick record attribute %s=%v carries identifier %q", k, v, id)
					}
				}
			}
			seen[fmt.Sprint(r["loop"])] = true
		})
	}

	// AC-7 (trading half): every written loop name is in the closed set, which stays at most 8.
	if len(telemetry.Loops) > 8 {
		t.Errorf("len(telemetry.Loops) = %d, want <= 8", len(telemetry.Loops))
	}
	allowed := map[string]bool{}
	for _, l := range telemetry.Loops {
		allowed[string(l)] = true
	}
	for loop := range seen {
		if !allowed[loop] {
			t.Errorf("loop %q is not in telemetry.Loops", loop)
		}
	}
	if seen[string(telemetry.LoopPositionSync)] {
		t.Error("position_sync must never be written through LogTickOK")
	}
	for _, l := range []telemetry.Loop{telemetry.LoopFillPoller, telemetry.LoopReconciliation, telemetry.LoopCredentialHealth, telemetry.LoopBracketWatchdog, telemetry.LoopOrderIntentSweeper} {
		if !seen[string(l)] {
			t.Errorf("no successful tick record was observed for %s", l)
		}
	}
}
