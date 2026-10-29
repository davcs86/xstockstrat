package service

import (
	"testing"

	"github.com/pashagolub/pgxmock/v4"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	marketdatav1 "github.com/xstockstrat/contracts/gen/go/marketdata/v1"
	"github.com/xstockstrat/portfolio/internal/testdata"
)

// Feature 264 — snapshot fan-out is owner-scoped and fail-closed (@AC-1, @AC-3 producer half).

func newScopedSnapshotSvc(t *testing.T) (*PortfolioService, pgxmock.PgxPoolIface, *fakeLedger) {
	t.Helper()
	svc, mock, ledger := newQuoteSvc(t, &stubMarketData{quotes: []*marketdatav1.Quote{quote(testdata.Aapl, 100)}}, 0)
	mock.ExpectQuery(`FROM portfolio.positions`).WithArgs(anyArgs(4)...).
		WillReturnRows(posRow(mock.NewRows(positionCols), testdata.Aapl, "acc-1", 10, 100, 0))
	mock.ExpectExec(`INSERT INTO portfolio.snapshots`).WithArgs(anyArgs(7)...).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))
	return svc, mock, ledger
}

func TestBroadcastSnapshot_AC1_OnlyOwnerReceives(t *testing.T) {
	svc, mock, ledger := newScopedSnapshotSvc(t)
	a := svc.Subscribe("a", "u-1")
	b := svc.Subscribe("b", "u-2")

	svc.broadcastSnapshot(ctxWithUser(t, "u-1"), "u-1", commonv1.TradingMode_TRADING_MODE_PAPER)

	if len(a) != 1 {
		t.Fatalf("owner stream received %d snapshots, want 1", len(a))
	}
	if got := <-a; got.PortfolioId != "u-1" || got.Equity != 1000 {
		t.Fatalf("owner snapshot = {PortfolioId:%q Equity:%v}, want {u-1 1000}", got.PortfolioId, got.Equity)
	}
	if len(b) != 0 {
		t.Fatalf("other user's stream received %d of u-1's snapshots", len(b))
	}
	if ledger.calls != 1 {
		t.Fatalf("ledger emits = %d, want 1", ledger.calls)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("pgxmock: %v", err)
	}
}

func TestBroadcastSnapshot_EmptyOwnerSubscriberReceivesNothing(t *testing.T) {
	svc, mock, ledger := newScopedSnapshotSvc(t)
	anon := svc.Subscribe("anon", "")

	svc.broadcastSnapshot(ctxWithUser(t, "u-1"), "u-1", commonv1.TradingMode_TRADING_MODE_PAPER)

	if len(anon) != 0 {
		t.Fatalf("empty-owner stream received %d snapshots", len(anon))
	}
	if ledger.calls != 1 {
		t.Fatalf("ledger emits = %d, want 1", ledger.calls)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("pgxmock: %v", err)
	}
}
