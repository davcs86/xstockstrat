package service

import (
	"context"
	"errors"
	"io"
	"testing"
	"time"

	"github.com/pashagolub/pgxmock/v4"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/types/known/structpb"

	ledgerv1 "github.com/xstockstrat/contracts/gen/go/ledger/v1"
	"github.com/xstockstrat/portfolio/internal/repository"
)

// Regression suite for docs/reports/2026-10-02-portfolio-fill-db-errors-defect.md: a DB error on
// the fill path emits no ledger event and is surfaced so the consumer does not advance past it.

var errDBBlip = errors.New("conn reset")

func fillEvent(t *testing.T, seq int64, qty float64) *ledgerv1.LedgerEvent {
	t.Helper()
	p, err := structpb.NewStruct(map[string]interface{}{
		"user_id": "u1", "symbol": "AAPL", "qty": qty, "fill_price": 100.0,
		"trading_mode": "TRADING_MODE_PAPER", "account_id": "acc-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	return &ledgerv1.LedgerEvent{Sequence: seq, EventType: "order.filled", Payload: p}
}

func anyArgs(n int) []any {
	out := make([]any, n)
	for i := range out {
		out[i] = pgxmock.AnyArg()
	}
	return out
}

func positionRow(mock pgxmock.PgxPoolIface, qty float64) *pgxmock.Rows {
	return mock.NewRows([]string{
		"symbol", "qty", "avg_entry_price", "cost_basis", "opened_at", "trading_mode", "account_id",
		"current_price", "market_value", "unrealized_pnl", "unrealized_pnl_pct", "day_pnl",
		"day_pnl_pct", "stop_order_id", "take_profit_order_id", "source", "as_of",
	}).AddRow("AAPL", qty, 100.0, qty*100, time.Now(), "TRADING_MODE_PAPER", "acc-1",
		0.0, 0.0, 0.0, 0.0, 0.0, 0.0, "", "", 0, nil)
}

func newFillSvc(t *testing.T) (*PortfolioService, pgxmock.PgxPoolIface, *fakeLedger) {
	t.Helper()
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mock.Close)
	ledger := &fakeLedger{}
	return &PortfolioService{repo: repository.NewPortfolioRepoWithDB(mock), ledger: ledger}, mock, ledger
}

func TestProcessOrderFill_GetPositionError_NoWriteNoEvent(t *testing.T) {
	svc, mock, ledger := newFillSvc(t)
	mock.ExpectQuery("FROM portfolio.positions").WithArgs(anyArgs(4)...).WillReturnError(errDBBlip)

	// Pre-fix: the error read as "no position", so a SELL 4 against a 10-share row deleted it.
	if err := svc.processOrderFill(context.Background(), fillEvent(t, 7, -4)); !errors.Is(err, errDBBlip) {
		t.Fatalf("err = %v, want wrapped %v", err, errDBBlip)
	}
	if ledger.calls != 0 {
		t.Fatalf("ledger AppendEvent calls = %d, want 0", ledger.calls)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestProcessOrderFill_UpsertError_NoEvent(t *testing.T) {
	svc, mock, ledger := newFillSvc(t)
	mock.ExpectQuery("FROM portfolio.positions").WithArgs(anyArgs(4)...).WillReturnRows(positionRow(mock, 10))
	mock.ExpectExec("INSERT INTO portfolio.positions").WithArgs(anyArgs(9)...).WillReturnError(errDBBlip)

	if err := svc.processOrderFill(context.Background(), fillEvent(t, 7, 5)); !errors.Is(err, errDBBlip) {
		t.Fatalf("err = %v, want wrapped %v", err, errDBBlip)
	}
	if ledger.calls != 0 {
		t.Fatalf("ledger AppendEvent calls = %d, want 0 (no position.updated for a failed write)", ledger.calls)
	}
}

func TestProcessOrderFill_CloseError_NoEvent(t *testing.T) {
	svc, mock, ledger := newFillSvc(t)
	mock.ExpectQuery("FROM portfolio.positions").WithArgs(anyArgs(4)...).WillReturnRows(positionRow(mock, 10))
	mock.ExpectQuery("realized_accum").WithArgs(anyArgs(4)...).WillReturnRows(mock.NewRows([]string{"a"}).AddRow(0.0))
	mock.ExpectQuery("fees_accum").WithArgs(anyArgs(4)...).WillReturnRows(mock.NewRows([]string{"a"}).AddRow(0.0))
	mock.ExpectExec("DELETE FROM portfolio.positions").WithArgs(anyArgs(4)...).WillReturnError(errDBBlip)

	if err := svc.processOrderFill(context.Background(), fillEvent(t, 7, -10)); !errors.Is(err, errDBBlip) {
		t.Fatalf("err = %v, want wrapped %v", err, errDBBlip)
	}
	if ledger.calls != 0 {
		t.Fatalf("ledger AppendEvent calls = %d, want 0 (no position.closed for a failed delete)", ledger.calls)
	}
}

func TestProcessOrderFill_MalformedPayload_Acked(t *testing.T) {
	svc, _, _ := newFillSvc(t)
	if err := svc.processOrderFill(context.Background(), &ledgerv1.LedgerEvent{}); err != nil {
		t.Fatalf("nil payload must be skipped, got %v", err)
	}
}

// streamLedger serves a fixed event list from StreamEvents.
type streamLedger struct {
	ledgerv1.LedgerServiceClient
	events []*ledgerv1.LedgerEvent
}

type sliceStream struct {
	grpc.ServerStreamingClient[ledgerv1.LedgerEvent]
	events []*ledgerv1.LedgerEvent
}

func (s *sliceStream) Recv() (*ledgerv1.LedgerEvent, error) {
	if len(s.events) == 0 {
		return nil, io.EOF
	}
	ev := s.events[0]
	s.events = s.events[1:]
	return ev, nil
}

func (l *streamLedger) StreamEvents(_ context.Context, _ *ledgerv1.StreamEventsRequest, _ ...grpc.CallOption) (grpc.ServerStreamingClient[ledgerv1.LedgerEvent], error) {
	return &sliceStream{events: l.events}, nil
}

func TestStreamEventsFrom_HandlerError_DoesNotAdvanceCursor(t *testing.T) {
	svc := &PortfolioService{ledger: &streamLedger{events: []*ledgerv1.LedgerEvent{
		{Sequence: 5}, {Sequence: 6}, {Sequence: 7},
	}}}
	var handled []int64
	handle := func(_ context.Context, ev *ledgerv1.LedgerEvent) error {
		handled = append(handled, ev.Sequence)
		if ev.Sequence == 6 {
			return errDBBlip
		}
		return nil
	}

	last, err := svc.streamEventsFrom(context.Background(), "order.filled", 4, handle)
	if !errors.Is(err, errDBBlip) {
		t.Fatalf("err = %v, want wrapped %v", err, errDBBlip)
	}
	if last != 5 {
		t.Fatalf("lastSeq = %d, want 5 (resume re-delivers the failed seq 6)", last)
	}
	if len(handled) != 2 {
		t.Fatalf("handled = %v, want [5 6] (stop at the failure)", handled)
	}
}
