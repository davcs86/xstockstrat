package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"testing"
	"time"

	"github.com/pashagolub/pgxmock/v4"

	ledgerv1 "github.com/xstockstrat/contracts/gen/go/ledger/v1"
	"github.com/xstockstrat/portfolio/internal/repository"
	"github.com/xstockstrat/portfolio/internal/telemetry"
	"github.com/xstockstrat/portfolio/internal/testdata"
)

var testFillFloor = time.Date(2026, 11, 27, 8, 0, 0, 123000000, time.UTC)

const (
	floorInsertSQL = `INSERT INTO portfolio\.consumer_floors`
	floorSelectSQL = `SELECT floor_recorded_at FROM portfolio\.consumer_floors`
)

func TestFillFloor_BelowFloorAckedWithNoDBCall(t *testing.T) {
	svc, mock, ledger := newFillSvc(t)
	svc.fillFloor = testFillFloor
	ev := testdata.Stamped(fillEvent(t, 7, 5), testFillFloor.Add(-time.Millisecond))

	if err := svc.processOrderFill(context.Background(), ev); !errors.Is(err, errFillAcked) {
		t.Fatalf("err = %v, want errFillAcked", err)
	}
	if ledger.calls != 0 {
		t.Fatalf("ledger AppendEvent calls = %d, want 0", ledger.calls)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestFillFloor_SameMillisecondFolds(t *testing.T) {
	svc, mock, _ := newFillSvc(t)
	svc.fillFloor = testFillFloor
	mock.ExpectQuery("FROM portfolio.positions").WithArgs(anyArgs(4)...).WillReturnError(errDBBlip)

	err := svc.processOrderFill(context.Background(), testdata.Stamped(fillEvent(t, 7, 5), testFillFloor))
	if !errors.Is(err, errDBBlip) {
		t.Fatalf("err = %v, want the DB path (%v), not the floor ack", err, errDBBlip)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestObserved_FillAckedCountsAckedAndTicks(t *testing.T) {
	reader := installMetricReader(t)
	rec := recordLogs(t)
	svc := &PortfolioService{now: fakeClock(time.Second)}
	h := svc.observed("order fill", "ok", func(context.Context, *ledgerv1.LedgerEvent) error {
		return fmt.Errorf("duplicate: %w", errFillAcked)
	})

	if err := h(context.Background(), &ledgerv1.LedgerEvent{Sequence: 3}); err != nil {
		t.Fatalf("err = %v, want nil", err)
	}
	if got := consumerEvents(t, reader, "order_fill", "acked"); got != 1 {
		t.Errorf("consumer.events{order_fill,acked} = %d, want 1", got)
	}
	if got := consumerEvents(t, reader, "order_fill", "error"); got != 0 {
		t.Errorf("consumer.events{order_fill,error} = %d, want 0", got)
	}
	ticks := rec.with(telemetry.LoopTickOKMsg)
	if len(ticks) != 1 || ticks[0]["loop"] != string(telemetry.LoopOrderFill) {
		t.Fatalf("tick records = %v, want one with loop=order_fill", ticks)
	}
}

func TestObserved_FillUnattributableParked(t *testing.T) {
	reader := installMetricReader(t)
	rec := recordLogs(t)
	svc := &PortfolioService{now: fakeClock(time.Second)}
	h := svc.observed("order fill", "ok", func(context.Context, *ledgerv1.LedgerEvent) error {
		return fmt.Errorf("fill ord-9: %w", ErrFillUnattributable)
	})
	ev := &ledgerv1.LedgerEvent{EventId: "evt-9", Sequence: 9, StreamKey: "ord-9"}

	if err := h(context.Background(), ev); err != nil {
		t.Fatalf("err = %v, want nil", err)
	}
	if got := consumerEvents(t, reader, "order_fill", "parked"); got != 1 {
		t.Errorf("consumer.events{order_fill,parked} = %d, want 1", got)
	}
	if got := consumerEvents(t, reader, "order_fill", "error"); got != 0 {
		t.Errorf("consumer.events{order_fill,error} = %d, want 0", got)
	}
	parked := rec.with("event parked")
	if len(parked) != 1 {
		t.Fatalf("\"event parked\" records = %v, want one", parked)
	}
	want := map[string]string{
		"level": slog.LevelError.String(), "event_id": "evt-9", "sequence": "9", "stream_key": "ord-9",
		"consumer": "order fill", "attempts": "1",
	}
	for k, v := range want {
		if parked[0][k] != v {
			t.Errorf("event parked %s = %q, want %q (record %v)", k, parked[0][k], v, parked[0])
		}
	}
}

func TestObserved_OtherErrorReturned(t *testing.T) {
	reader := installMetricReader(t)
	svc := &PortfolioService{now: fakeClock(time.Second)}
	h := svc.observed("order fill", "ok", func(context.Context, *ledgerv1.LedgerEvent) error { return errDBBlip })

	if err := h(context.Background(), &ledgerv1.LedgerEvent{}); !errors.Is(err, errDBBlip) {
		t.Fatalf("err = %v, want %v", err, errDBBlip)
	}
	if got := consumerEvents(t, reader, "order_fill", "error"); got != 1 {
		t.Errorf("consumer.events{order_fill,error} = %d, want 1", got)
	}
}

type floorBoot struct {
	svc            *PortfolioService
	mock           pgxmock.PgxPoolIface
	ledger         *scriptedStreamLedger
	streamsAtSleep []int
}

func newFloorBoot(t *testing.T) *floorBoot {
	t.Helper()
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mock.Close)
	b := &floorBoot{mock: mock, ledger: &scriptedStreamLedger{}}
	b.svc = &PortfolioService{repo: repository.NewPortfolioRepoWithDB(mock), ledger: b.ledger, now: fakeClock(time.Second)}
	b.svc.sleep = func(time.Duration) {
		b.ledger.mu.Lock()
		b.streamsAtSleep = append(b.streamsAtSleep, len(b.ledger.fromSeqs))
		b.ledger.mu.Unlock()
	}
	return b
}

func (b *floorBoot) run(t *testing.T) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	b.ledger.cancel = cancel
	guard(t, func() { b.svc.ConsumeOrderFills(ctx) })
	if err := b.mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func floorRows(mock pgxmock.PgxPoolIface) *pgxmock.Rows {
	return mock.NewRows([]string{"floor_recorded_at"}).AddRow(testFillFloor)
}

func TestConsumeOrderFills_FillFloorRetriedBeforeStream(t *testing.T) {
	rec := recordLogs(t)
	first := newFloorBoot(t)
	first.mock.ExpectExec(floorInsertSQL).WithArgs("order_fill").WillReturnError(errDBBlip)
	first.mock.ExpectExec(floorInsertSQL).WithArgs("order_fill").WillReturnResult(pgxmock.NewResult("INSERT", 1))
	first.mock.ExpectQuery(floorSelectSQL).WithArgs("order_fill").WillReturnRows(floorRows(first.mock))
	first.run(t)

	if fmt.Sprint(first.streamsAtSleep) != "[0]" {
		t.Fatalf("StreamEvents calls at each floor retry = %v, want [0]: no stream before the floor loads", first.streamsAtSleep)
	}
	if len(first.ledger.fromSeqs) != 1 {
		t.Fatalf("StreamEvents calls = %d, want 1 after the floor loads", len(first.ledger.fromSeqs))
	}
	if !first.svc.fillFloor.Equal(testFillFloor) {
		t.Fatalf("fillFloor = %v, want %v", first.svc.fillFloor, testFillFloor)
	}

	second := newFloorBoot(t)
	second.mock.ExpectExec(floorInsertSQL).WithArgs("order_fill").WillReturnResult(pgxmock.NewResult("INSERT", 0))
	second.mock.ExpectQuery(floorSelectSQL).WithArgs("order_fill").WillReturnRows(floorRows(second.mock))
	second.run(t)

	if !second.svc.fillFloor.Equal(testFillFloor) || len(second.streamsAtSleep) != 0 {
		t.Fatalf("second boot fillFloor = %v (retries %v), want the first floor %v with no retry",
			second.svc.fillFloor, second.streamsAtSleep, testFillFloor)
	}
	loaded := rec.with("order fill floor loaded")
	if len(loaded) != 2 || loaded[0]["stamped_now"] != "true" || loaded[1]["stamped_now"] != "false" ||
		loaded[0]["floor"] != fmt.Sprint(testFillFloor) || loaded[1]["floor"] != fmt.Sprint(testFillFloor) {
		t.Fatalf("\"order fill floor loaded\" records = %v, want stamped_now true then false at %v", loaded, testFillFloor)
	}
}

func TestConsumeOrderFills_FillFloorNeverLoadsNoStream(t *testing.T) {
	b := newFloorBoot(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	b.svc.sleep = func(time.Duration) { cancel() }
	b.mock.ExpectExec(floorInsertSQL).WithArgs("order_fill").WillReturnError(errDBBlip)
	guard(t, func() { b.svc.ConsumeOrderFills(ctx) })

	if len(b.ledger.fromSeqs) != 0 {
		t.Fatalf("StreamEvents calls = %d, want 0 while the floor has not loaded", len(b.ledger.fromSeqs))
	}
	if !b.svc.fillFloor.IsZero() {
		t.Fatalf("fillFloor = %v, want unset", b.svc.fillFloor)
	}
}
