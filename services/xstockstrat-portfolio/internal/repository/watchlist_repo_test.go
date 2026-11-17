package repository

import (
	"context"
	"testing"
	"time"

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

// TestBindingSymbols_MirrorsBindings_Feature196 — the repo is the real producer of the KEEP field
// Watchlist.symbols (feature 196 @AC-2): it mirrors every binding's symbol in order.
func TestBindingSymbols_MirrorsBindings_Feature196(t *testing.T) {
	got := bindingSymbols([]*portfoliov1.WatchlistBinding{{Symbol: "AAPL"}, {Symbol: "MSFT", StrategyId: "s1"}})
	if len(got) != 2 || got[0] != "AAPL" || got[1] != "MSFT" {
		t.Fatalf("expected [AAPL MSFT], got %v", got)
	}
	if bindingSymbols(nil) != nil {
		t.Fatalf("expected nil for no bindings")
	}
}

// listPageSQL pins the strict > keyset and the LIMIT placeholder; LIMIT's value is pinned by WithArgs.
const listPageSQL = `FROM portfolio\.watchlists\s+WHERE user_id = \$1 AND \(\$2 = '' OR watchlist_id > \$2::uuid\)\s+ORDER BY watchlist_id ASC LIMIT \$3`

func listPageRows(mock pgxmock.PgxPoolIface, ids ...string) *pgxmock.Rows {
	now := time.Now()
	rows := mock.NewRows([]string{"watchlist_id", "user_id", "name", "description", "created_at", "updated_at", "system_managed", "default_strategy_id"})
	for _, id := range ids {
		rows.AddRow(id, "u1", "name-"+id, "", now, now, false, "")
	}
	return rows
}

func expectNoBindings(mock pgxmock.PgxPoolIface, ids ...string) {
	mock.ExpectQuery(`watchlist_id = ANY\(\$1::uuid\[\]\)`).
		WithArgs(ids).
		WillReturnRows(mock.NewRows([]string{"watchlist_id", "symbol", "strategy_id", "source"}))
}

// @AC-2: the token is the last RETURNED row, not the +1 lookahead row.
func TestListByUser_TokenIsLastReturnedRow(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()
	repo := &WatchlistRepo{db: mock}

	mock.ExpectQuery(listPageSQL).WithArgs("u1", "", 3).WillReturnRows(listPageRows(mock, "wl-a", "wl-b", "wl-c"))
	expectNoBindings(mock, "wl-a", "wl-b")

	wls, next, err := repo.ListByUser(context.Background(), "u1", 2, "")
	if err != nil {
		t.Fatalf("ListByUser: %v", err)
	}
	if len(wls) != 2 || wls[0].WatchlistId != "wl-a" || wls[1].WatchlistId != "wl-b" {
		t.Fatalf("page = %v, want [wl-a wl-b]", wls)
	}
	if next != "wl-b" {
		t.Fatalf("next_page_token = %q, want last returned id %q", next, "wl-b")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

// @AC-1 guard: an exactly-full last page ends the traversal (empty token).
func TestListByUser_ExactlyFullPageHasNoToken(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()
	repo := &WatchlistRepo{db: mock}

	mock.ExpectQuery(listPageSQL).WithArgs("u1", "", 3).WillReturnRows(listPageRows(mock, "wl-a", "wl-b"))
	expectNoBindings(mock, "wl-a", "wl-b")

	wls, next, err := repo.ListByUser(context.Background(), "u1", 2, "")
	if err != nil {
		t.Fatalf("ListByUser: %v", err)
	}
	if len(wls) != 2 {
		t.Fatalf("page len = %d, want 2", len(wls))
	}
	if next != "" {
		t.Fatalf("next_page_token = %q, want empty on an exactly-full last page", next)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}
