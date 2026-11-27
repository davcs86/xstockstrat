//go:build dbtest

package service

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"google.golang.org/protobuf/types/known/structpb"

	ledgerv1 "github.com/xstockstrat/contracts/gen/go/ledger/v1"
	"github.com/xstockstrat/portfolio/internal/config"
	"github.com/xstockstrat/portfolio/internal/repository"
	"github.com/xstockstrat/portfolio/internal/testdata"
)

const (
	fillFoldDBSymbol = "FOLD"
	fillFoldDBPaper  = "TRADING_MODE_PAPER"
)

// fillFoldDBService is one portfolio process: its own pool, its own positionsMu, and a floor before every event.
func fillFoldDBService(t *testing.T, floor time.Time) (*PortfolioService, *pgxpool.Pool) {
	t.Helper()
	pool := serviceTestPool(t)
	return &PortfolioService{
		repo: repository.NewPortfolioRepoWithDB(pool), ledger: &fakeLedger{}, cfg: &config.Watcher{},
		marketdata: &stubMarketData{}, subs: map[string]snapshotSubscriber{}, fillFloor: floor,
	}, pool
}

type fillFoldDBRow struct{ qty, costBasis, realized float64 }

func readFillFoldDBRow(t *testing.T, pool *pgxpool.Pool, userID, account string) fillFoldDBRow {
	t.Helper()
	var r fillFoldDBRow
	if err := pool.QueryRow(context.Background(),
		`SELECT qty, cost_basis, realized_accum FROM portfolio.positions
		 WHERE user_id=$1 AND symbol=$2 AND trading_mode=$3 AND account_id=$4`,
		userID, fillFoldDBSymbol, fillFoldDBPaper, account).Scan(&r.qty, &r.costBasis, &r.realized); err != nil {
		t.Fatalf("read position: %v", err)
	}
	return r
}

func countFillFoldDBApplied(t *testing.T, pool *pgxpool.Pool, userID, orderID string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM portfolio.consumer_applied_events WHERE consumer=$1 AND user_id=$2 AND order_id=$3`,
		repository.ConsumerOrderFill, userID, orderID).Scan(&n); err != nil {
		t.Fatalf("count applied rows: %v", err)
	}
	return n
}

func fillFoldDBEvent(seq int64, at time.Time, orderID, userID, account string, qty, price float64, side string) *ledgerv1.LedgerEvent {
	return testdata.Stamped(testdata.FilledEvent(seq, orderID, userID, fillFoldDBSymbol, account, fillFoldDBPaper, qty, price, side), at)
}

// @AC-2: two processes fold one order.filled once.
func TestFillFoldDB_AC2_TwoInstancesApplyOnce(t *testing.T) {
	now := time.Now()
	svcA, pool := fillFoldDBService(t, now.Add(-time.Hour))
	svcB, _ := fillFoldDBService(t, now.Add(-time.Hour))
	userID := drainDBUser(t)
	account := userID + "-a"
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO portfolio.positions (user_id, symbol, qty, avg_entry_price, cost_basis, trading_mode, account_id)
		 VALUES ($1, $2, 10, 100, 1000, $3, $4)`, userID, fillFoldDBSymbol, fillFoldDBPaper, account); err != nil {
		t.Fatalf("seed position: %v", err)
	}
	orderID := "ord-" + userID
	ev := fillFoldDBEvent(1, now, orderID, userID, account, 5, 110, "ORDER_SIDE_BUY")

	svcs := []*PortfolioService{svcA, svcB}
	errs := make([]error, len(svcs))
	start := make(chan struct{})
	var wg sync.WaitGroup
	for i, svc := range svcs {
		wg.Add(1)
		go func(i int, svc *PortfolioService) {
			defer wg.Done()
			<-start
			errs[i] = svc.processOrderFill(context.Background(), ev)
		}(i, svc)
	}
	close(start)
	wg.Wait()

	applied, acked := 0, 0
	for i, err := range errs {
		switch {
		case err == nil:
			applied++
		case errors.Is(err, errFillAcked):
			acked++
		default:
			t.Errorf("instance %d: unexpected error %v", i, err)
		}
	}
	if applied != 1 || acked != 1 {
		t.Errorf("applied=%d acked=%d, want 1 and 1", applied, acked)
	}
	if got := readFillFoldDBRow(t, pool, userID, account).qty; got != 15 {
		t.Errorf("qty = %v, want 15", got)
	}
	if got := countFillFoldDBApplied(t, pool, userID, orderID); got != 1 {
		t.Errorf("applied rows = %d, want 1", got)
	}
}

// @AC-1: a restarted service re-delivered the same history changes nothing.
func TestFillFoldDB_AC1_RestartDoesNotReapply(t *testing.T) {
	now := time.Now()
	first, pool := fillFoldDBService(t, now.Add(-time.Hour))
	userID := drainDBUser(t)
	account := userID + "-a"
	history := []*ledgerv1.LedgerEvent{
		fillFoldDBEvent(1, now, "ord-1-"+userID, userID, account, 10, 100, "ORDER_SIDE_BUY"),
		fillFoldDBEvent(2, now, "ord-2-"+userID, userID, account, 5, 110, "ORDER_SIDE_BUY"),
		fillFoldDBEvent(3, now, "ord-3-"+userID, userID, account, 3, 120, "ORDER_SIDE_SELL"),
	}
	for _, ev := range history {
		if err := first.processOrderFill(context.Background(), ev); err != nil {
			t.Fatalf("first boot, seq %d: %v", ev.Sequence, err)
		}
	}
	before := readFillFoldDBRow(t, pool, userID, account)
	if before.qty != 12 || before.realized == 0 {
		t.Fatalf("after the history: %+v, want qty 12 and a non-zero realized_accum", before)
	}

	restarted, _ := fillFoldDBService(t, now.Add(-time.Hour))
	for _, ev := range history {
		if err := restarted.processOrderFill(context.Background(), ev); !errors.Is(err, errFillAcked) {
			t.Errorf("second boot, seq %d: err = %v, want errFillAcked", ev.Sequence, err)
		}
	}
	if after := readFillFoldDBRow(t, pool, userID, account); after != before {
		t.Errorf("after the second boot: %+v, want unchanged %+v", after, before)
	}
}

func fillFoldDBSyncEvent(t *testing.T, seq int64, userID, account string) *ledgerv1.LedgerEvent {
	t.Helper()
	p, err := structpb.NewStruct(map[string]any{
		"account_id": account, "user_id": userID, "trading_mode": fillFoldDBPaper,
		"positions": []any{
			map[string]any{"symbol": fillFoldDBSymbol, "qty": 10, "avg_cost": 100},
			map[string]any{"symbol": "OTHR", "qty": 1, "avg_cost": 10},
		},
	})
	if err != nil {
		t.Fatalf("sync payload: %v", err)
	}
	return &ledgerv1.LedgerEvent{EventId: fmt.Sprintf("sync-%d", seq), EventType: "account.positions.synced",
		StreamKey: account, Sequence: seq, Payload: p}
}

// Sync on one instance and a fill on another, on the same row: no deadlock (40P01) and no lock timeout.
func TestFillFoldDB_SyncVersusFillNoDeadlock(t *testing.T) {
	const rounds = 25
	now := time.Now()
	syncer, pool := fillFoldDBService(t, now.Add(-time.Hour))
	folder, _ := fillFoldDBService(t, now.Add(-time.Hour))
	userID := drainDBUser(t)
	account := userID + "-a"
	warns := recordWarns(t)
	syncs := make([]*ledgerv1.LedgerEvent, rounds)
	for i := range syncs {
		syncs[i] = fillFoldDBSyncEvent(t, int64(i), userID, account)
	}

	var syncErrs, fillErrs []error
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		for _, ev := range syncs {
			if err := syncer.processPositionSync(context.Background(), ev); err != nil {
				syncErrs = append(syncErrs, err)
			}
		}
	}()
	go func() {
		defer wg.Done()
		for i := 0; i < rounds; i++ {
			ev := fillFoldDBEvent(int64(i), now, fmt.Sprintf("ord-%d-%s", i, userID), userID, account, 1, 100, "ORDER_SIDE_BUY")
			if err := folder.processOrderFill(context.Background(), ev); err != nil {
				fillErrs = append(fillErrs, err)
			}
		}
	}()
	done := make(chan struct{})
	go func() { wg.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(60 * time.Second):
		t.Fatal("sync and fill did not finish within 60s")
	}

	for _, err := range append(syncErrs, fillErrs...) {
		t.Errorf("unexpected error: %v", err)
	}
	for _, msg := range []string{"upsert position from sync failed", "delete positions not in sync failed"} {
		if rec := warns.find(msg); rec != nil {
			t.Errorf("sync logged %q: %v", msg, rec)
		}
	}
	if got := readFillFoldDBRow(t, pool, userID, account).qty; got < 10 {
		t.Errorf("qty = %v, want at least the synced 10", got)
	}
}
