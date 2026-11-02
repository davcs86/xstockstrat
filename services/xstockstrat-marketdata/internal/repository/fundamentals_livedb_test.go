package repository

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/xstockstrat/marketdata/internal/source"
)

// TestUpsertFundamentals_LiveDB_EpochAndSeed proves the $17::boolean bind and the source-filtered seed count
// against real Postgres under QueryExecModeExec (pgxmock cannot prove wire OIDs). Needs a migrated DATABASE_URL.
func TestUpsertFundamentals_LiveDB_EpochAndSeed(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL not set: live-DB test needs a migrated marketdata schema")
	}
	t.Setenv("DB_PGBOUNCER", "true")
	repo, err := NewMarketDataRepo(dsn)
	if err != nil {
		t.Fatalf("NewMarketDataRepo: %v", err)
	}
	ctx := context.Background()
	const prefix = "ZZ255_"
	t.Cleanup(func() {
		if _, err := repo.db.Exec(ctx, `DELETE FROM marketdata.fundamentals WHERE symbol LIKE $1`, prefix+"%"); err != nil {
			t.Errorf("cleanup: %v", err)
		}
		repo.pool.Close()
	})

	// A shared database may already hold today's fmp rows, so the seed count is asserted as a delta.
	baseline, err := repo.CountFundamentalsFetchedToday(ctx, "fmp")
	if err != nil {
		t.Fatalf("baseline count: %v", err)
	}
	today := time.Now().UTC()
	for i := range 30 {
		if err := repo.UpsertFundamentals(ctx, &source.Fundamentals{
			Symbol: fmt.Sprintf("%sE%02d", prefix, i), AsOf: today, Source: "edgar",
		}); err != nil {
			t.Fatalf("upsert edgar row %d: %v", i, err)
		}
	}
	if n, err := repo.CountFundamentalsFetchedToday(ctx, "fmp"); err != nil || n != baseline {
		t.Fatalf("fmp count after 30 edgar rows = %d (err %v), want %d", n, err, baseline)
	}

	sym := prefix + "FMP"
	if err := repo.UpsertFundamentals(ctx, &source.Fundamentals{
		Symbol: sym, AsOf: today, Source: "fmp", EnrichmentFailed: true,
	}); err != nil {
		t.Fatalf("upsert flagged fmp row: %v", err)
	}
	_, fetchedAt, found, err := repo.GetFundamentals(ctx, sym)
	if err != nil || !found {
		t.Fatalf("read back flagged row: found=%v err=%v", found, err)
	}
	if !fetchedAt.Equal(time.Unix(0, 0)) {
		t.Fatalf("fetched_at = %s, want 1970-01-01T00:00:00Z", fetchedAt.UTC().Format(time.RFC3339))
	}
	if n, err := repo.CountFundamentalsFetchedToday(ctx, "fmp"); err != nil || n != baseline+1 {
		t.Fatalf("fmp count with an epoch-stamped as-of-today row = %d (err %v), want %d", n, err, baseline+1)
	}
}
