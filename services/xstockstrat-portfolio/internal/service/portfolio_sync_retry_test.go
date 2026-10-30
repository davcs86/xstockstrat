package service

import (
	"context"
	"errors"
	"fmt"
	"net"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/pashagolub/pgxmock/v4"
	"google.golang.org/protobuf/types/known/structpb"

	ledgerv1 "github.com/xstockstrat/contracts/gen/go/ledger/v1"
)

// Feature 256 D-47: offline sync / deregistration write failures are retried through boundedRetry
// instead of being acked; only deterministic or long-unclassified failures park.

func syncEvent(t *testing.T, seq int64, payload map[string]interface{}) *ledgerv1.LedgerEvent {
	t.Helper()
	p, err := structpb.NewStruct(payload)
	if err != nil {
		t.Fatal(err)
	}
	return &ledgerv1.LedgerEvent{Sequence: seq, EventId: fmt.Sprintf("evt-%d", seq), StreamKey: "off-1", Payload: p}
}

func offlineSyncPayload(positions []interface{}) map[string]interface{} {
	return map[string]interface{}{
		"account_id": "off-1", "user_id": "u1", "trading_mode": "TRADING_MODE_PAPER",
		"positions": positions, "realized_pnl": 500.0,
	}
}

// fakeClock returns a clock that advances by step on every read, starting at t0.
func fakeClock(step time.Duration) func() time.Time {
	t := time.Date(2026, 10, 29, 14, 0, 0, 0, time.UTC)
	return func() time.Time {
		now := t
		t = t.Add(step)
		return now
	}
}

func parkedCount(rec *warnRecorder) int {
	rec.mu.Lock()
	defer rec.mu.Unlock()
	n := 0
	for _, r := range rec.recs {
		if r["msg"] == "event parked" {
			n++
		}
	}
	return n
}

func TestProcessPositionSync_AC1_RealizedUpsertFailureIsRetryable(t *testing.T) {
	svc, mock, _ := newFillSvc(t)
	svc.now = fakeClock(time.Second)
	ev := syncEvent(t, 3, offlineSyncPayload([]interface{}{}))
	svc.ledger = &streamLedger{events: []*ledgerv1.LedgerEvent{ev}}

	mock.ExpectExec("DELETE FROM portfolio.positions").WithArgs(anyArgs(1)...).WillReturnResult(pgxmock.NewResult("DELETE", 0))
	mock.ExpectExec("INSERT INTO portfolio.offline_account_realized").WithArgs(anyArgs(8)...).WillReturnError(errDBBlip)
	mock.ExpectExec("DELETE FROM portfolio.positions").WithArgs(anyArgs(1)...).WillReturnResult(pgxmock.NewResult("DELETE", 0))
	mock.ExpectExec("INSERT INTO portfolio.offline_account_realized").
		WithArgs("off-1", "u1", "TRADING_MODE_PAPER", 500.0, 0.0, 0.0, 0.0, `[]`).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))

	handle := svc.boundedRetry("position sync", svc.processPositionSync)
	last, err := svc.streamEventsFrom(context.Background(), "account.positions.synced", 2, handle)
	if !errors.Is(err, errDBBlip) {
		t.Fatalf("first delivery err = %v, want wrapped %v", err, errDBBlip)
	}
	if last != 2 {
		t.Fatalf("lastSeq = %d after a failed realized upsert, want 2 (redeliver seq 3)", last)
	}
	last, err = svc.streamEventsFrom(context.Background(), "account.positions.synced", last, handle)
	if err != nil {
		t.Fatalf("second delivery err = %v, want nil", err)
	}
	if last != 3 {
		t.Fatalf("lastSeq = %d after the retry succeeded, want 3", last)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestProcessPositionSync_TryAll(t *testing.T) {
	svc, mock, _ := newFillSvc(t)
	mock.ExpectExec("INSERT INTO portfolio.positions").WithArgs(anyArgs(15)...).WillReturnError(errDBBlip)
	mock.ExpectExec("DELETE FROM portfolio.positions").WithArgs(anyArgs(3)...).WillReturnResult(pgxmock.NewResult("DELETE", 0))
	mock.ExpectExec("INSERT INTO portfolio.offline_account_realized").WithArgs(anyArgs(8)...).WillReturnResult(pgxmock.NewResult("INSERT", 1))

	pos := []interface{}{map[string]interface{}{"symbol": "AAPL", "qty": 10.0, "avg_cost": 150.0}}
	if err := svc.processPositionSync(context.Background(), syncEvent(t, 1, offlineSyncPayload(pos))); !errors.Is(err, errDBBlip) {
		t.Fatalf("err = %v, want wrapped %v", err, errDBBlip)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("every offline write must still be attempted: %v", err)
	}
}

func TestProcessPositionSync_BrokerBranchStillAcked(t *testing.T) {
	svc, mock, _ := newFillSvc(t)
	mock.ExpectExec("INSERT INTO portfolio.positions").WithArgs(anyArgs(15)...).WillReturnError(errDBBlip)
	mock.ExpectExec("DELETE FROM portfolio.positions").WithArgs(anyArgs(3)...).WillReturnError(errDBBlip)

	ev := syncEvent(t, 1, map[string]interface{}{
		"account_id": "brk-1", "user_id": "u1", "trading_mode": "TRADING_MODE_LIVE",
		"positions": []interface{}{map[string]interface{}{"symbol": "AAPL", "qty": 1.0, "avg_cost": 1.0}},
	})
	if err := svc.processPositionSync(context.Background(), ev); err != nil {
		t.Fatalf("broker sync must stay warn-and-continue, got %v", err)
	}
}

func TestProcessPositionSync_MalformedPayloadAcked(t *testing.T) {
	svc, _, _ := newFillSvc(t)
	for name, ev := range map[string]*ledgerv1.LedgerEvent{
		"nil payload":   {},
		"no account_id": syncEvent(t, 1, map[string]interface{}{"user_id": "u1", "realized_pnl": 1.0}),
		"bad shape":     syncEvent(t, 2, map[string]interface{}{"account_id": 7.0}),
	} {
		if err := svc.processPositionSync(context.Background(), ev); err != nil {
			t.Errorf("%s: poison payload must be acked, got %v", name, err)
		}
	}
}

func TestProcessAccountDeregistered_AC2_DeleteFailureIsRetryable(t *testing.T) {
	svc, mock, _ := newFillSvc(t)
	ev := syncEvent(t, 4, map[string]interface{}{"account_id": "off-1", "user_id": "u1"})

	mock.ExpectExec("DELETE FROM portfolio.positions").WithArgs("off-1").WillReturnResult(pgxmock.NewResult("DELETE", 2))
	mock.ExpectExec("DELETE FROM portfolio.offline_account_realized").WithArgs("off-1").WillReturnError(errDBBlip)
	if err := svc.processAccountDeregistered(context.Background(), ev); !errors.Is(err, errDBBlip) {
		t.Fatalf("first delivery err = %v, want wrapped %v", err, errDBBlip)
	}

	mock.ExpectExec("DELETE FROM portfolio.positions").WithArgs("off-1").WillReturnResult(pgxmock.NewResult("DELETE", 0))
	mock.ExpectExec("DELETE FROM portfolio.offline_account_realized").WithArgs("off-1").WillReturnResult(pgxmock.NewResult("DELETE", 1))
	if err := svc.processAccountDeregistered(context.Background(), ev); err != nil {
		t.Fatalf("second delivery err = %v, want nil", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestBoundedRetry_AC6_DeterministicParksAfterFiveAttempts(t *testing.T) {
	rec := recordWarns(t)
	svc := &PortfolioService{now: fakeClock(2 * time.Second)}
	evt1 := &ledgerv1.LedgerEvent{EventId: "evt-1", Sequence: 1, StreamKey: "off-1"}
	evt2 := &ledgerv1.LedgerEvent{EventId: "evt-2", Sequence: 2, StreamKey: "off-1"}
	var applied []int64
	h := svc.boundedRetry("position sync", func(_ context.Context, ev *ledgerv1.LedgerEvent) error {
		if ev.Sequence == 1 {
			return &pgconn.PgError{Code: "23505"}
		}
		applied = append(applied, ev.Sequence)
		return nil
	})

	for attempt := 1; attempt <= 4; attempt++ {
		if err := h(context.Background(), evt1); err == nil {
			t.Fatalf("attempt %d: err = nil, want the deterministic error (not parked yet)", attempt)
		}
	}
	if err := h(context.Background(), evt1); err != nil {
		t.Fatalf("attempt 5: err = %v, want nil (parked)", err)
	}
	if n := parkedCount(rec); n != 1 {
		t.Fatalf("\"event parked\" logged %d times, want 1", n)
	}
	got := rec.find("event parked")
	for k, want := range map[string]string{"event_id": "evt-1", "sequence": "1", "stream_key": "off-1", "consumer": "position sync", "attempts": "5"} {
		if got[k] != want {
			t.Errorf("parked log %s = %q, want %q", k, got[k], want)
		}
	}
	if err := h(context.Background(), evt2); err != nil || len(applied) != 1 || applied[0] != 2 {
		t.Fatalf("evt-2 after park: err = %v, applied = %v, want [2]", err, applied)
	}
}

func TestBoundedRetry_AC9_TransientNeverParks(t *testing.T) {
	for name, transient := range map[string]error{
		"08006 connection failure": &pgconn.PgError{Code: "08006"},
		"deadline exceeded":        fmt.Errorf("upsert: %w", context.DeadlineExceeded),
		"net.Error":                &net.OpError{Op: "read", Net: "tcp", Err: errors.New("connection reset")},
	} {
		t.Run(name, func(t *testing.T) {
			rec := recordWarns(t)
			svc := &PortfolioService{now: fakeClock(45 * time.Second)} // 20 attempts ≈ 15 fake minutes
			fail := true
			h := svc.boundedRetry("position sync", func(context.Context, *ledgerv1.LedgerEvent) error {
				if fail {
					return transient
				}
				return nil
			})
			ev := &ledgerv1.LedgerEvent{EventId: "evt-1", Sequence: 1}
			for attempt := 1; attempt <= 20; attempt++ {
				if err := h(context.Background(), ev); err == nil {
					t.Fatalf("attempt %d: transient failure was parked", attempt)
				}
			}
			fail = false
			if err := h(context.Background(), ev); err != nil {
				t.Fatalf("recovery delivery err = %v, want nil", err)
			}
			if n := parkedCount(rec); n != 0 {
				t.Fatalf("\"event parked\" logged %d times, want 0", n)
			}
		})
	}
}

func TestBoundedRetry_UnclassifiedUsesFallbackBound(t *testing.T) {
	rec := recordWarns(t)
	svc := &PortfolioService{now: fakeClock(time.Minute)}
	h := svc.boundedRetry("account deregistration", func(context.Context, *ledgerv1.LedgerEvent) error { return errDBBlip })
	ev := &ledgerv1.LedgerEvent{EventId: "evt-1", Sequence: 1}

	attempt := 0
	for {
		attempt++
		err := h(context.Background(), ev)
		if err == nil {
			break
		}
		if attempt > 30 {
			t.Fatal("unclassified failure never parked")
		}
	}
	if attempt <= syncRetryMinAttempts {
		t.Fatalf("parked at attempt %d, want > %d (elapsed floor of %v not yet reached)", attempt, syncRetryMinAttempts, syncRetryFallbackElapsed)
	}
	if n := parkedCount(rec); n != 1 {
		t.Fatalf("\"event parked\" logged %d times, want 1", n)
	}
}

func TestClassifyConsumerErr_Table(t *testing.T) {
	for _, tc := range []struct {
		name string
		err  error
		want retryClass
	}{
		{"22 data exception", &pgconn.PgError{Code: "22P02"}, retryDeterministic},
		{"23 integrity violation", &pgconn.PgError{Code: "23505"}, retryDeterministic},
		{"08 connection", &pgconn.PgError{Code: "08006"}, retryTransient},
		{"40 serialization", &pgconn.PgError{Code: "40001"}, retryTransient},
		{"53 resources", &pgconn.PgError{Code: "53300"}, retryTransient},
		{"57 operator intervention", &pgconn.PgError{Code: "57P01"}, retryTransient},
		{"wrapped deterministic", fmt.Errorf("upsert: %w", &pgconn.PgError{Code: "23505"}), retryDeterministic},
		{"join transient + deterministic", errors.Join(&pgconn.PgError{Code: "23505"}, &pgconn.PgError{Code: "08006"}), retryTransient},
		{"join deterministic + plain", errors.Join(errDBBlip, &pgconn.PgError{Code: "22003"}), retryDeterministic},
		{"canceled", context.Canceled, retryTransient},
		{"plain error", errDBBlip, retryUnclassified},
	} {
		if got := classifyConsumerErr(tc.err); got != tc.want {
			t.Errorf("%s: classifyConsumerErr = %v, want %v", tc.name, got, tc.want)
		}
	}
}
