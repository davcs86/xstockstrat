//go:build dbtest

package repository

import (
	"context"
	"reflect"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// A wait on a row lock must fail the test, so every call runs under a deadline shorter than lock_timeout.
const delistedNoWait = 400 * time.Millisecond

func mustRemoveDelisted(t *testing.T, repo *WatchlistRepo, symbols ...string) []DelistedRemoval {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), delistedNoWait)
	defer cancel()
	res, err := repo.RemoveDelistedFromSystemLists(ctx, symbols)
	if err != nil {
		t.Fatalf("RemoveDelistedFromSystemLists(%v): %v (code %s)", symbols, err, pgCode(err))
	}
	return res
}

// removalFor returns this list's entry; other lists in the DB are not the test's.
func removalFor(res []DelistedRemoval, wlID string) (DelistedRemoval, bool) {
	for _, r := range res {
		if r.WatchlistID == wlID {
			return r, true
		}
	}
	return DelistedRemoval{}, false
}

func watchlistUpdatedAt(t *testing.T, pool *pgxpool.Pool, wlID string) time.Time {
	t.Helper()
	var at time.Time
	if err := pool.QueryRow(context.Background(),
		`SELECT updated_at FROM portfolio.watchlists WHERE watchlist_id = $1`, wlID).Scan(&at); err != nil {
		t.Fatalf("watchlistUpdatedAt: %v", err)
	}
	return at
}

func assertBindingPresent(t *testing.T, pool *pgxpool.Pool, wlID, symbol string) {
	t.Helper()
	if _, ok := bindingSource(t, pool, wlID, symbol); !ok {
		t.Fatalf("%s: binding gone, want kept", symbol)
	}
}

// @AC-6
func TestDelistedRemoval_AC6_SystemListLosesOnlyTheFlaggedSymbol(t *testing.T) {
	pool := testPool(t)
	repo := NewWatchlistRepo(pool)
	userID := testUserID(t)
	wlID := seedNamedWatchlist(t, pool, userID, "Signals", true)
	seedBinding(t, pool, wlID, "KPTI", "", int16(srcSignal))
	seedBinding(t, pool, wlID, "AAPL", "", int16(srcSignal))
	before := watchlistUpdatedAt(t, pool, wlID)

	got, ok := removalFor(mustRemoveDelisted(t, repo, "KPTI"), wlID)
	if !ok || !reflect.DeepEqual(got.Removed, []string{"KPTI"}) || len(got.Left) != 0 || got.Skipped {
		t.Fatalf("removal = %+v (found %v), want Removed=[KPTI]", got, ok)
	}
	if got.Name != "Signals" || got.UserID != userID {
		t.Fatalf("removal identity = %+v, want Signals owned by %s", got, userID)
	}
	assertBindingGone(t, pool, wlID, "KPTI")
	assertBindingPresent(t, pool, wlID, "AAPL")
	if after := watchlistUpdatedAt(t, pool, wlID); !after.After(before) {
		t.Fatalf("updated_at = %v, want after %v", after, before)
	}
}

// @AC-7
func TestDelistedRemoval_AC7_UserCreatedListIsUntouched(t *testing.T) {
	pool := testPool(t)
	repo := NewWatchlistRepo(pool)
	userID := testUserID(t)
	userWL := seedNamedWatchlist(t, pool, userID, "Tech", false)
	sysWL := seedNamedWatchlist(t, pool, userID, "Signals", true)
	seedBinding(t, pool, userWL, "ROKU", "", int16(srcManual))
	seedBinding(t, pool, sysWL, "ROKU", "", int16(srcSignal))
	userBefore := watchlistUpdatedAt(t, pool, userWL)

	res := mustRemoveDelisted(t, repo, "ROKU")
	if got, ok := removalFor(res, sysWL); !ok || !reflect.DeepEqual(got.Removed, []string{"ROKU"}) {
		t.Fatalf("system list removal = %+v (found %v), want Removed=[ROKU]", got, ok)
	}
	if got, ok := removalFor(res, userWL); ok {
		t.Fatalf("user-created list reported: %+v", got)
	}
	assertBindingGone(t, pool, sysWL, "ROKU")
	assertBindingPresent(t, pool, userWL, "ROKU")
	if after := watchlistUpdatedAt(t, pool, userWL); !after.Equal(userBefore) {
		t.Fatalf("user-created list updated_at changed: %v → %v", userBefore, after)
	}
}

func TestDelistedRemoval_ManualEntryOnSystemListIsRemoved(t *testing.T) {
	pool := testPool(t)
	repo := NewWatchlistRepo(pool)
	wlID := seedWatchlist(t, pool, testUserID(t), true)
	seedBinding(t, pool, wlID, "KPTI", "", int16(srcManual))

	if got, ok := removalFor(mustRemoveDelisted(t, repo, "KPTI"), wlID); !ok || !reflect.DeepEqual(got.Removed, []string{"KPTI"}) {
		t.Fatalf("removal = %+v (found %v), want the MANUAL entry removed", got, ok)
	}
	assertBindingGone(t, pool, wlID, "KPTI")
}

func TestDelistedRemoval_ExpiryRowsFollowTheBinding(t *testing.T) {
	pool := testPool(t)
	repo := NewWatchlistRepo(pool)
	wlID := seedWatchlist(t, pool, testUserID(t), true)
	for _, sym := range []string{"KPTI", "ROKU", "AAPL"} {
		seedBinding(t, pool, wlID, sym, "", int16(srcSignal))
	}
	seedExpiryIn(t, pool, wlID, "KPTI", "-1 day", sigID(101))
	seedExpiryIn(t, pool, wlID, "ROKU", "30 days", sigID(102))
	seedExpiryIn(t, pool, wlID, "AAPL", "30 days", sigID(103))

	mustRemoveDelisted(t, repo, "KPTI", "ROKU")
	assertNoExpiry(t, pool, wlID, "KPTI")
	assertNoExpiry(t, pool, wlID, "ROKU")
	if _, ok := expiryRow(t, pool, wlID, "AAPL"); !ok {
		t.Fatal("AAPL: expiry row deleted, want kept")
	}
}

func TestDelistedRemoval_NeverWaits(t *testing.T) {
	ctx := context.Background()

	t.Run("parent row held", func(t *testing.T) {
		pool := testPool(t)
		repo := NewWatchlistRepo(pool)
		wlID := seedWatchlist(t, pool, testUserID(t), true)
		seedBinding(t, pool, wlID, "KPTI", "", int16(srcSignal))
		seedBinding(t, pool, wlID, "ROKU", "", int16(srcSignal))

		holder, err := pool.Begin(ctx)
		if err != nil {
			t.Fatalf("begin holder: %v", err)
		}
		defer func() { _ = holder.Rollback(ctx) }()
		if _, err := holder.Exec(ctx,
			`UPDATE portfolio.watchlists SET updated_at = now() WHERE watchlist_id = $1`, wlID); err != nil {
			t.Fatalf("holder parent touch: %v", err)
		}

		got, ok := removalFor(mustRemoveDelisted(t, repo, "KPTI", "ROKU"), wlID)
		if !ok || !got.Skipped || len(got.Removed) != 0 || !reflect.DeepEqual(got.Left, []string{"KPTI", "ROKU"}) {
			t.Fatalf("removal = %+v (found %v), want Skipped with Left=[KPTI ROKU]", got, ok)
		}
		assertBindingPresent(t, pool, wlID, "KPTI")
		assertBindingPresent(t, pool, wlID, "ROKU")
	})

	t.Run("one binding row held by UpdateBinding step 1", func(t *testing.T) {
		pool := testPool(t)
		repo := NewWatchlistRepo(pool)
		wlID := seedWatchlist(t, pool, testUserID(t), true)
		seedBinding(t, pool, wlID, "KPTI", "", int16(srcSignal))
		seedBinding(t, pool, wlID, "ROKU", "", int16(srcSignal))

		holder, err := pool.Begin(ctx)
		if err != nil {
			t.Fatalf("begin holder: %v", err)
		}
		defer func() { _ = holder.Rollback(ctx) }()
		if _, err := holder.Exec(ctx,
			`UPDATE portfolio.watchlist_symbols SET strategy_id = 'strat-held'
			 WHERE watchlist_id = $1 AND symbol = $2 RETURNING symbol`, wlID, "ROKU"); err != nil {
			t.Fatalf("holder update: %v", err)
		}

		got, ok := removalFor(mustRemoveDelisted(t, repo, "KPTI", "ROKU"), wlID)
		if !ok || !got.Skipped || !reflect.DeepEqual(got.Removed, []string{"KPTI"}) || !reflect.DeepEqual(got.Left, []string{"ROKU"}) {
			t.Fatalf("removal = %+v (found %v), want Removed=[KPTI] Left=[ROKU] Skipped", got, ok)
		}
		assertBindingGone(t, pool, wlID, "KPTI")
		assertBindingPresent(t, pool, wlID, "ROKU")
	})
}

func TestDelistedRemoval_PartialResultAcrossLists(t *testing.T) {
	ctx := context.Background()
	pool := testPool(t)
	repo := NewWatchlistRepo(pool)
	freeWL := seedNamedWatchlist(t, pool, testUserID(t)+"-a", "Signals", true)
	heldWL := seedNamedWatchlist(t, pool, testUserID(t)+"-b", "Signals", true)
	seedBinding(t, pool, freeWL, "KPTI", "", int16(srcSignal))
	seedBinding(t, pool, heldWL, "KPTI", "", int16(srcSignal))

	holder, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin holder: %v", err)
	}
	defer func() { _ = holder.Rollback(ctx) }()
	if _, err := holder.Exec(ctx,
		`UPDATE portfolio.watchlists SET updated_at = now() WHERE watchlist_id = $1`, heldWL); err != nil {
		t.Fatalf("holder parent touch: %v", err)
	}

	res := mustRemoveDelisted(t, repo, "KPTI")
	if got, ok := removalFor(res, freeWL); !ok || !reflect.DeepEqual(got.Removed, []string{"KPTI"}) || got.Skipped {
		t.Fatalf("free list = %+v (found %v), want Removed=[KPTI]", got, ok)
	}
	if got, ok := removalFor(res, heldWL); !ok || !got.Skipped || !reflect.DeepEqual(got.Left, []string{"KPTI"}) {
		t.Fatalf("held list = %+v (found %v), want Skipped with Left=[KPTI]", got, ok)
	}
	assertBindingGone(t, pool, freeWL, "KPTI")
	assertBindingPresent(t, pool, heldWL, "KPTI")
}

func TestDelistedRemoval_FlagClearedAtLockTimeIsNotModified(t *testing.T) {
	ctx := context.Background()
	pool := testPool(t)
	wlID := seedWatchlist(t, pool, testUserID(t), false)
	seedBinding(t, pool, wlID, "KPTI", "", int16(srcSignal))

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	got, err := removeDelistedInTx(ctx, tx, delistedList{watchlistID: wlID, held: []string{"KPTI"}})
	if err != nil {
		t.Fatalf("removeDelistedInTx: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit: %v", err)
	}
	if len(got.Removed) != 0 || got.Skipped {
		t.Fatalf("removal = %+v, want nothing removed and not Skipped", got)
	}
	assertBindingPresent(t, pool, wlID, "KPTI")
}

func TestDelistedRemoval_SecondCallIsNoop(t *testing.T) {
	pool := testPool(t)
	repo := NewWatchlistRepo(pool)
	wlID := seedWatchlist(t, pool, testUserID(t), true)
	seedBinding(t, pool, wlID, "KPTI", "", int16(srcSignal))

	mustRemoveDelisted(t, repo, "KPTI")
	after := watchlistUpdatedAt(t, pool, wlID)
	if got, ok := removalFor(mustRemoveDelisted(t, repo, "KPTI"), wlID); ok {
		t.Fatalf("second call reported %+v, want the list absent", got)
	}
	if again := watchlistUpdatedAt(t, pool, wlID); !again.Equal(after) {
		t.Fatalf("second call touched updated_at: %v → %v", after, again)
	}
}

// PRESERVE feature 281: the expiry prune still handles the entries a removal left behind.
func TestDelistedRemoval_PruneStillWorksOnRemainingEntries(t *testing.T) {
	pool := testPool(t)
	repo := NewWatchlistRepo(pool)
	wlID := seedWatchlist(t, pool, testUserID(t), true)
	seedBinding(t, pool, wlID, "KPTI", "", int16(srcSignal))
	seedBinding(t, pool, wlID, "AAPL", "", int16(srcSignal))
	seedBinding(t, pool, wlID, "MSFT", "", int16(srcSignal))
	seedExpiryIn(t, pool, wlID, "AAPL", "-1 day", sigID(101))
	seedExpiryIn(t, pool, wlID, "MSFT", "30 days", sigID(102))

	mustRemoveDelisted(t, repo, "KPTI")
	if got := mustPrune(t, repo, wlID); len(got) != 1 || got[0].Symbol != "AAPL" {
		t.Fatalf("prune removed %+v, want only the due AAPL entry", got)
	}
	assertBindingGone(t, pool, wlID, "AAPL")
	assertSource(t, pool, wlID, "MSFT", srcSignal)
}
