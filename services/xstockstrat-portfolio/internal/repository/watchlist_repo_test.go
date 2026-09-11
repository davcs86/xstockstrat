package repository

import (
	"context"
	"testing"

	"github.com/pashagolub/pgxmock/v4"

	portfoliov1 "github.com/xstockstrat/contracts/gen/go/portfolio/v1"
)

// TestBindingsByWatchlist_SingleAnyArrayQuery — feature 178 @AC-2: a multi-watchlist page reads all
// bindings in ONE ANY-array query (not one per watchlist), grouped by watchlist_id with each list's
// symbol order and Symbol/StrategyId/Source mapping preserved (the pre-Step-7 tree issued N queries).
// pgxmock exercises the exact SQL offline — no database, matching the repo package's harness.
func TestBindingsByWatchlist_SingleAnyArrayQuery(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	repo := &WatchlistRepo{db: mock}

	rows := mock.NewRows([]string{"watchlist_id", "symbol", "strategy_id", "source"}).
		AddRow("wl-a", "AAPL", "s1", int16(1)).
		AddRow("wl-a", "MSFT", "s2", int16(0)).
		AddRow("wl-b", "GOOG", "s3", int16(2))

	// Exactly one ANY-array query is expected; ExpectationsWereMet fails if a second (per-watchlist)
	// query fires or the ANY-array query does not.
	mock.ExpectQuery(`watchlist_id = ANY\(\$1::uuid\[\]\)`).
		WithArgs([]string{"wl-a", "wl-b"}).
		WillReturnRows(rows)

	got, err := repo.bindingsByWatchlist(context.Background(), []string{"wl-a", "wl-b"})
	if err != nil {
		t.Fatalf("bindingsByWatchlist: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expected exactly one ANY-array binding query: %v", err)
	}

	// Grouping + field parity (mirrors the old per-watchlist listBindings mapping).
	if len(got["wl-a"]) != 2 || len(got["wl-b"]) != 1 {
		t.Fatalf("grouping wrong: wl-a=%d wl-b=%d (want 2, 1)", len(got["wl-a"]), len(got["wl-b"]))
	}
	if got["wl-a"][0].Symbol != "AAPL" || got["wl-a"][0].StrategyId != "s1" ||
		got["wl-a"][0].Source != portfoliov1.WatchlistEntrySource(1) {
		t.Fatalf("wl-a[0] field mismatch: %+v", got["wl-a"][0])
	}
	if got["wl-a"][1].Symbol != "MSFT" {
		t.Fatalf("wl-a per-symbol order not preserved: %+v", got["wl-a"])
	}
	if got["wl-b"][0].Symbol != "GOOG" ||
		got["wl-b"][0].Source != portfoliov1.WatchlistEntrySource(2) {
		t.Fatalf("wl-b[0] field mismatch: %+v", got["wl-b"][0])
	}
}
