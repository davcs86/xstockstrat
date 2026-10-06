package service

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"google.golang.org/protobuf/types/known/structpb"

	ledgerv1 "github.com/xstockstrat/contracts/gen/go/ledger/v1"
	"github.com/xstockstrat/portfolio/internal/config"
	"github.com/xstockstrat/portfolio/internal/repository"
)

// Regression for docs/reports/2026-10-03-portfolio-fill-sync-lost-update-defect.md: a position sync
// must not land between a fill's read and its write of the same row.

type noRow struct{}

func (noRow) Scan(...any) error { return pgx.ErrNoRows }

// interleaveDB blocks the fill's position read until released and records every write in order.
type interleaveDB struct {
	reading chan struct{}
	release chan struct{}
	once    sync.Once
	mu      sync.Mutex
	writes  []string
}

func (d *interleaveDB) QueryRow(_ context.Context, sql string, _ ...any) pgx.Row {
	if strings.Contains(sql, "FROM portfolio.positions") {
		d.once.Do(func() {
			close(d.reading)
			<-d.release
		})
	}
	return noRow{}
}

func (d *interleaveDB) Query(context.Context, string, ...any) (pgx.Rows, error) {
	return nil, pgx.ErrNoRows
}

func (d *interleaveDB) Exec(_ context.Context, sql string, _ ...any) (pgconn.CommandTag, error) {
	tag := "other"
	switch {
	case strings.Contains(sql, "realized_accum"):
		tag = "fill-upsert"
	case strings.Contains(sql, "market_value"):
		tag = "sync-upsert"
	}
	d.mu.Lock()
	d.writes = append(d.writes, tag)
	d.mu.Unlock()
	return pgconn.CommandTag{}, nil
}

func TestFillAndSync_SameRow_Serialized(t *testing.T) {
	db := &interleaveDB{reading: make(chan struct{}), release: make(chan struct{})}
	svc := &PortfolioService{repo: repository.NewPortfolioRepoWithDB(db), ledger: &fakeLedger{}, cfg: &config.Watcher{}}

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
		_ = svc.processOrderFill(context.Background(), fillEvent(t, 1, 5))
	}()
	<-db.reading
	go func() {
		defer wg.Done()
		svc.processPositionSync(context.Background(), &ledgerv1.LedgerEvent{Sequence: 2, Payload: syncPayload})
	}()
	time.Sleep(100 * time.Millisecond) // an unserialized sync writes inside this window
	close(db.release)
	wg.Wait()

	db.mu.Lock()
	defer db.mu.Unlock()
	fillAt, syncAt := -1, -1
	for i, w := range db.writes {
		if w == "fill-upsert" && fillAt < 0 {
			fillAt = i
		}
		if w == "sync-upsert" && syncAt < 0 {
			syncAt = i
		}
	}
	if fillAt < 0 || syncAt < 0 || syncAt < fillAt {
		t.Fatalf("sync wrote between the fill's read and write (lost update): writes=%v", db.writes)
	}
}
