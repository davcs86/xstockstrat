//go:build dbtest

package repository

import (
	"context"
	"sync"
	"testing"
)

// Feature 351: the real-index proof behind ListWatchlists' ensure-on-first-page. Offline these skip
// (testPool), which is not evidence; the portfolio-db-test CI job is.

// AC-2 (concurrency clause): concurrent ensures for one new user yield exactly one system row, via
// the partial unique index watchlists_user_system_uidx (migration 011), without a transaction.
func TestEnsureSystemManaged_ConcurrentSingleRow(t *testing.T) {
	pool := testPoolWithLockTimeout(t, "5s")
	repo := NewWatchlistRepo(pool)
	uid := testUserID(t)
	ctx := context.Background()

	const callers = 5
	ids := make([]string, callers)
	var wg sync.WaitGroup
	for i := 0; i < callers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			wl, err := repo.EnsureSystemManaged(ctx, uid, "Signals")
			if err != nil {
				t.Errorf("ensure #%d: %v", i, err)
				return
			}
			ids[i] = wl.GetWatchlistId()
		}(i)
	}
	wg.Wait()

	for i, id := range ids {
		if id == "" || id != ids[0] {
			t.Fatalf("ensure #%d returned id %q, want the same non-empty id as #0 (%q)", i, id, ids[0])
		}
	}
	var n int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM portfolio.watchlists WHERE user_id = $1 AND system_managed`, uid).Scan(&n); err != nil {
		t.Fatalf("count system rows: %v", err)
	}
	if n != 1 {
		t.Fatalf("system rows = %d, want 1", n)
	}
}

// The ensure's re-list skip compares ids as Go strings; this proves that equals Postgres uuid order
// without following any token. Rows are inserted in non-ascending id order so an ORDER BY regression
// (system-first, created_at) fails every time instead of by chance.
func TestListByUser_OrdersByWatchlistIDAfterEnsure(t *testing.T) {
	pool := testPool(t)
	repo := NewWatchlistRepo(pool)
	uid := testUserID(t)
	ctx := context.Background()

	for i, id := range []string{
		"ffffffff-ffff-4fff-bfff-fffffffffffe",
		"00000000-0000-4000-8000-000000000001",
		"00000000-0000-4000-8000-000000000002",
	} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO portfolio.watchlists (watchlist_id, user_id, name) VALUES ($1::uuid, $2, $3)`,
			id, uid, "manual-"+string(rune('a'+i))); err != nil {
			t.Fatalf("seed %s: %v", id, err)
		}
	}
	if _, err := repo.EnsureSystemManaged(ctx, uid, "Signals"); err != nil {
		t.Fatalf("EnsureSystemManaged: %v", err)
	}

	wls, _, err := repo.ListByUser(ctx, uid, 100, "")
	if err != nil {
		t.Fatalf("ListByUser: %v", err)
	}
	if len(wls) != 4 {
		t.Fatalf("got %d lists, want 4", len(wls))
	}
	systems := 0
	for i, wl := range wls {
		if wl.GetSystemManaged() {
			systems++
		}
		if i > 0 && wls[i-1].GetWatchlistId() >= wl.GetWatchlistId() {
			t.Fatalf("ids not strictly ascending: %q then %q", wls[i-1].GetWatchlistId(), wl.GetWatchlistId())
		}
	}
	if systems != 1 {
		t.Fatalf("system lists = %d, want 1", systems)
	}
}
