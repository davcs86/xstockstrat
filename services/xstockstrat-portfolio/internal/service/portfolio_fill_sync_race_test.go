package service

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/pashagolub/pgxmock/v4"
	"google.golang.org/protobuf/types/known/structpb"

	ledgerv1 "github.com/xstockstrat/contracts/gen/go/ledger/v1"
	"github.com/xstockstrat/portfolio/internal/config"
	"github.com/xstockstrat/portfolio/internal/repository"
)

// Regression for docs/reports/2026-10-03-portfolio-fill-sync-lost-update-defect.md: a position sync
// must not land between a fill's locked read and its write of the same row.

func TestFillAndSync_SameRow_Serialized(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mock.Close)
	svc := &PortfolioService{repo: repository.NewPortfolioRepoWithDB(mock), ledger: &fakeLedger{}, cfg: &config.Watcher{}}

	// Ordered expectations: a sync write arriving inside the fill's transaction matches nothing and stays unmet.
	expectNotApplied(mock)
	mock.ExpectBegin()
	mock.ExpectExec(appliedInsertSQL).WithArgs(anyArgs(5)...).WillReturnResult(pgxmock.NewResult("INSERT", 1))
	mock.ExpectExec(advisoryLockSQL).WithArgs(pgxmock.AnyArg()).WillReturnResult(pgxmock.NewResult("SELECT", 1))
	mock.ExpectQuery(lockedReadSQL).WithArgs(anyArgs(4)...).WillReturnRows(mock.NewRows(lockedCols)).
		WillDelayFor(300 * time.Millisecond)
	mock.ExpectExec(`realized_accum=\$8`).WithArgs(anyArgs(9)...).WillReturnResult(pgxmock.NewResult("INSERT", 1))
	mock.ExpectCommit()
	mock.ExpectExec(`market_value`).WithArgs(anyArgs(15)...).WillReturnResult(pgxmock.NewResult("INSERT", 1))
	mock.ExpectExec(`DELETE FROM portfolio\.positions`).WithArgs(anyArgs(3)...).WillReturnResult(pgxmock.NewResult("DELETE", 0))

	syncPayload, err := structpb.NewStruct(map[string]interface{}{
		"account_id": "acc-1", "user_id": "u1", "trading_mode": "TRADING_MODE_PAPER",
		"positions": []interface{}{map[string]interface{}{"symbol": "AAPL", "qty": 7.0, "avg_cost": 90.0, "market_value": 700.0}},
	})
	if err != nil {
		t.Fatal(err)
	}

	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		if err := svc.processOrderFill(context.Background(), fillEvent(t, 1, 5)); err != nil {
			t.Errorf("processOrderFill: %v", err)
		}
	}()
	time.Sleep(50 * time.Millisecond) // the fill is now inside its delayed FOR UPDATE read
	go func() {
		defer wg.Done()
		if err := svc.processPositionSync(context.Background(), &ledgerv1.LedgerEvent{Sequence: 2, Payload: syncPayload}); err != nil {
			t.Errorf("processPositionSync: %v", err)
		}
	}()
	wg.Wait()

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("sync wrote between the fill's locked read and its write (lost update): %v", err)
	}
}
