//go:build dbtest

package repository

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	portfoliov1 "github.com/xstockstrat/contracts/gen/go/portfolio/v1"
)

// The DB clock cannot be injected: valid_until is set relative to now() in SQL ("past" / "future").
func seedExpiryIn(t *testing.T, pool *pgxpool.Pool, wlID, symbol, offset string, signalID *int64) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO portfolio.watchlist_signal_expiry (watchlist_id, symbol, valid_until, signal_id)
		 VALUES ($1, $2, now() + $3::interval, $4)`, wlID, symbol, offset, signalID); err != nil {
		t.Fatalf("seedExpiryIn: %v", err)
	}
}

func expireNow(t *testing.T, pool *pgxpool.Pool, wlID, symbol string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`UPDATE portfolio.watchlist_signal_expiry SET valid_until = now() - interval '1 day'
		 WHERE watchlist_id = $1 AND symbol = $2`, wlID, symbol); err != nil {
		t.Fatalf("expireNow: %v", err)
	}
}

func dbNow(t *testing.T, pool *pgxpool.Pool) time.Time {
	t.Helper()
	var now time.Time
	if err := pool.QueryRow(context.Background(), `SELECT now()`).Scan(&now); err != nil {
		t.Fatalf("dbNow: %v", err)
	}
	return now
}

// mustPrune runs one tick and returns only this list's removals; other lists in the DB are not the test's.
func mustPrune(t *testing.T, repo *WatchlistRepo, wlID string) []PrunedEntry {
	t.Helper()
	res, err := repo.PruneExpiredSignalEntries(context.Background())
	if err != nil {
		t.Fatalf("PruneExpiredSignalEntries: %v (code %s)", err, pgCode(err))
	}
	return removedFor(res, wlID)
}

func removedFor(res PruneResult, wlID string) []PrunedEntry {
	var out []PrunedEntry
	for _, e := range res.Removed {
		if e.WatchlistID == wlID {
			out = append(out, e)
		}
	}
	return out
}

func pgCode(err error) string {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code
	}
	return ""
}

func assertPruned(t *testing.T, got []PrunedEntry, want PrunedEntry) {
	t.Helper()
	if len(got) != 1 {
		t.Fatalf("removed entries = %+v, want exactly one (%s)", got, want.Symbol)
	}
	g := got[0]
	if g.UserID != want.UserID || g.WatchlistID != want.WatchlistID || g.Symbol != want.Symbol ||
		g.StrategyID != want.StrategyID || ptrVal(g.SignalID) != ptrVal(want.SignalID) ||
		!g.ValidUntil.Equal(want.ValidUntil) {
		t.Fatalf("pruned entry = {user=%s wl=%s sym=%s strat=%s sig=%v until=%v}, want {%s %s %s %s %v %v}",
			g.UserID, g.WatchlistID, g.Symbol, g.StrategyID, ptrVal(g.SignalID), g.ValidUntil,
			want.UserID, want.WatchlistID, want.Symbol, want.StrategyID, ptrVal(want.SignalID), want.ValidUntil)
	}
}

func assertBindingGone(t *testing.T, pool *pgxpool.Pool, wlID, symbol string) {
	t.Helper()
	if src, ok := bindingSource(t, pool, wlID, symbol); ok {
		t.Fatalf("%s: binding still present (source %d), want removed", symbol, src)
	}
}

func dueRow(t *testing.T, pool *pgxpool.Pool, wlID, symbol string) expiryRecord {
	t.Helper()
	rec, ok := expiryRow(t, pool, wlID, symbol)
	if !ok {
		t.Fatalf("%s: no expiry row seeded", symbol)
	}
	return rec
}

// AC-2: the only tracked signal is past → entry and expiry row removed; the list survives.
func TestPrune_ExpiredOnlySignalRemoves(t *testing.T) {
	pool := testPool(t)
	repo := NewWatchlistRepo(pool)
	userID := testUserID(t)
	wlID := seedWatchlist(t, pool, userID, true)
	seedBinding(t, pool, wlID, "AAPL", "", int16(srcSignal))
	seedExpiryIn(t, pool, wlID, "AAPL", "-30 days", sigID(101))
	rec := dueRow(t, pool, wlID, "AAPL")

	assertPruned(t, mustPrune(t, repo, wlID), PrunedEntry{
		UserID: userID, WatchlistID: wlID, Symbol: "AAPL", SignalID: sigID(101), ValidUntil: rec.ValidUntil,
	})
	assertBindingGone(t, pool, wlID, "AAPL")
	assertNoExpiry(t, pool, wlID, "AAPL")
	if _, err := repo.GetByID(context.Background(), wlID); err != nil {
		t.Fatalf("emptied list must survive the prune: GetByID: %v", err)
	}
}

// AC-3: a merged row from two signals keeps the later valid_until; removed once that one is past.
func TestPrune_MergedRowRetainsThenRemoves(t *testing.T) {
	pool := testPool(t)
	repo := NewWatchlistRepo(pool)
	userID := testUserID(t)
	wlID := seedWatchlist(t, pool, userID, true)
	now := dbNow(t, pool)
	mustAdd(t, repo, wlID, []*portfoliov1.WatchlistBinding{addBinding("AAPL", srcSignal)},
		provenanceIntent("AAPL", 101, now.Add(10*24*time.Hour)))
	mustAdd(t, repo, wlID, []*portfoliov1.WatchlistBinding{addBinding("AAPL", srcSignal)},
		provenanceIntent("AAPL", 102, now.Add(30*24*time.Hour)))

	if got := mustPrune(t, repo, wlID); len(got) != 0 {
		t.Fatalf("future merged row: removed = %+v, want none", got)
	}
	assertSource(t, pool, wlID, "AAPL", srcSignal)

	expireNow(t, pool, wlID, "AAPL")
	rec := dueRow(t, pool, wlID, "AAPL")
	assertPruned(t, mustPrune(t, repo, wlID), PrunedEntry{
		UserID: userID, WatchlistID: wlID, Symbol: "AAPL", SignalID: sigID(102), ValidUntil: rec.ValidUntil,
	})
	assertBindingGone(t, pool, wlID, "AAPL")
	assertNoExpiry(t, pool, wlID, "AAPL")
}

// AC-4: a SIGNAL binding with no expiry row is open-ended and survives any number of ticks.
func TestPrune_UntrackedEntrySurvives(t *testing.T) {
	pool := testPool(t)
	repo := NewWatchlistRepo(pool)
	wlID := seedWatchlist(t, pool, testUserID(t), true)
	seedBinding(t, pool, wlID, "NVDA", "", int16(srcSignal))

	for i := 0; i < 3; i++ {
		if got := mustPrune(t, repo, wlID); len(got) != 0 {
			t.Fatalf("tick %d: removed = %+v, want none", i, got)
		}
	}
	assertSource(t, pool, wlID, "NVDA", srcSignal)
	assertNoExpiry(t, pool, wlID, "NVDA")
}

// AC-5: a MANUAL binding is never pruned; its expired orphan expiry row is swept.
func TestPrune_ManualOrphanSweptEntryKept(t *testing.T) {
	pool := testPool(t)
	repo := NewWatchlistRepo(pool)
	wlID := seedWatchlist(t, pool, testUserID(t), true)
	seedBinding(t, pool, wlID, "MSFT", "", int16(srcManual))
	seedExpiryIn(t, pool, wlID, "MSFT", "-30 days", sigID(99))

	if got := mustPrune(t, repo, wlID); len(got) != 0 {
		t.Fatalf("removed = %+v, want none for a MANUAL binding", got)
	}
	assertSource(t, pool, wlID, "MSFT", srcManual)
	assertNoExpiry(t, pool, wlID, "MSFT")
}

// AC-6: a second tick over the same state removes nothing and does not fail.
func TestPrune_SecondTickIsNoop(t *testing.T) {
	pool := testPool(t)
	repo := NewWatchlistRepo(pool)
	wlID := seedWatchlist(t, pool, testUserID(t), true)
	seedBinding(t, pool, wlID, "AAPL", "", int16(srcSignal))
	seedExpiryIn(t, pool, wlID, "AAPL", "-30 days", sigID(101))

	if got := mustPrune(t, repo, wlID); len(got) != 1 {
		t.Fatalf("first tick removed = %+v, want one", got)
	}
	if got := mustPrune(t, repo, wlID); got != nil {
		t.Fatalf("second tick removed = %+v, want nil", got)
	}
}

// AC-8: a renewal merged onto a past row keeps the entry past the old expiry; the later removal names 102.
func TestPrune_RenewalEventNamesSignal102(t *testing.T) {
	pool := testPool(t)
	repo := NewWatchlistRepo(pool)
	userID := testUserID(t)
	wlID := seedWatchlist(t, pool, userID, true)
	seedBinding(t, pool, wlID, "AAPL", "", int16(srcSignal))
	seedExpiryIn(t, pool, wlID, "AAPL", "-1 day", sigID(101))

	mustAdd(t, repo, wlID, []*portfoliov1.WatchlistBinding{addBinding("AAPL", srcSignal)},
		provenanceIntent("AAPL", 102, dbNow(t, pool).Add(30*24*time.Hour)))
	if got := mustPrune(t, repo, wlID); len(got) != 0 {
		t.Fatalf("renewed entry: removed = %+v, want none past the old expiry", got)
	}
	assertSource(t, pool, wlID, "AAPL", srcSignal)

	expireNow(t, pool, wlID, "AAPL")
	rec := dueRow(t, pool, wlID, "AAPL")
	assertPruned(t, mustPrune(t, repo, wlID), PrunedEntry{
		UserID: userID, WatchlistID: wlID, Symbol: "AAPL", SignalID: sigID(102), ValidUntil: rec.ValidUntil,
	})
	assertBindingGone(t, pool, wlID, "AAPL")
}

// A strategy-bound SIGNAL entry is removed like any other and reports its strategy (feeds AC-13).
func TestPrune_StrategyBoundRemovedLikeAny(t *testing.T) {
	pool := testPool(t)
	repo := NewWatchlistRepo(pool)
	userID := testUserID(t)
	wlID := seedWatchlist(t, pool, userID, true)
	seedBinding(t, pool, wlID, "TSLA", "strat-9", int16(srcSignal))
	seedExpiryIn(t, pool, wlID, "TSLA", "-30 days", sigID(105))
	rec := dueRow(t, pool, wlID, "TSLA")

	assertPruned(t, mustPrune(t, repo, wlID), PrunedEntry{
		UserID: userID, WatchlistID: wlID, Symbol: "TSLA", StrategyID: "strat-9",
		SignalID: sigID(105), ValidUntil: rec.ValidUntil,
	})
	assertBindingGone(t, pool, wlID, "TSLA")
	assertNoExpiry(t, pool, wlID, "TSLA")
}

// AC-10: live ingest signals for the symbol do not keep the entry alive — the prune reads only the side table.
func TestPrune_IngestSignalsDoNotKeepAlive(t *testing.T) {
	pool := testPool(t)
	repo := NewWatchlistRepo(pool)
	userID := testUserID(t)
	wlID := seedWatchlist(t, pool, userID, true)
	t.Cleanup(func() {
		if _, err := pool.Exec(context.Background(),
			`DELETE FROM ingest.newsletter_signals WHERE user_id = $1`, userID); err != nil {
			t.Errorf("cleanup ingest signals: %v", err)
		}
	})
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO ingest.newsletter_signals (user_id, source, symbol, direction, valid_from, valid_until)
		 VALUES ($1, 'newsletter-it', 'AMD', 'buy', now() - interval '1 day', now() + interval '30 days'),
		        ($1, 'mcp_client', 'AMD', 'watchlist', now() - interval '1 day', NULL)`, userID); err != nil {
		t.Fatalf("seed ingest signals: %v", err)
	}
	seedBinding(t, pool, wlID, "AMD", "", int16(srcSignal))
	seedExpiryIn(t, pool, wlID, "AMD", "-30 days", sigID(106))

	if got := mustPrune(t, repo, wlID); len(got) != 1 || got[0].Symbol != "AMD" {
		t.Fatalf("removed = %+v, want AMD despite live ingest signals", got)
	}
	assertBindingGone(t, pool, wlID, "AMD")
	assertNoExpiry(t, pool, wlID, "AMD")
}

// AC-12: the tick never waits on a row lock. Interleavings mirror UpdateBinding's SQL order (symbol
// UPDATE … RETURNING first, parent touch last); a future reorder of UpdateBinding must update this test.
func TestPrune_ConcurrencyNeverWaits(t *testing.T) {
	ctx := context.Background()

	t.Run("a: binding row held by UpdateBinding step 1", func(t *testing.T) {
		pool := testPool(t)
		repo := NewWatchlistRepo(pool)
		wlID := seedWatchlist(t, pool, testUserID(t), true)
		seedBinding(t, pool, wlID, "AAPL", "", int16(srcSignal))
		seedExpiryIn(t, pool, wlID, "AAPL", "-30 days", sigID(101))

		holder, err := pool.Begin(ctx)
		if err != nil {
			t.Fatalf("begin holder: %v", err)
		}
		defer func() { _ = holder.Rollback(ctx) }()
		if _, err := holder.Exec(ctx,
			`UPDATE portfolio.watchlist_symbols SET strategy_id = 'strat-held'
			 WHERE watchlist_id = $1 AND symbol = $2 RETURNING symbol`, wlID, "AAPL"); err != nil {
			t.Fatalf("holder update: %v", err)
		}

		if got := mustPrune(t, repo, wlID); len(got) != 0 {
			t.Fatalf("held binding: removed = %+v, want none", got)
		}
		assertSource(t, pool, wlID, "AAPL", srcSignal)
		dueRow(t, pool, wlID, "AAPL")

		if err := holder.Commit(ctx); err != nil {
			t.Fatalf("commit holder: %v", err)
		}
		if got := mustPrune(t, repo, wlID); len(got) != 1 || got[0].StrategyID != "strat-held" {
			t.Fatalf("after holder commit: removed = %+v, want AAPL bound to strat-held", got)
		}
		assertBindingGone(t, pool, wlID, "AAPL")
		assertNoExpiry(t, pool, wlID, "AAPL")
	})

	t.Run("b: parent row held", func(t *testing.T) {
		pool := testPool(t)
		repo := NewWatchlistRepo(pool)
		wlID := seedWatchlist(t, pool, testUserID(t), true)
		seedBinding(t, pool, wlID, "AAPL", "", int16(srcSignal))
		seedExpiryIn(t, pool, wlID, "AAPL", "-30 days", sigID(101))

		holder, err := pool.Begin(ctx)
		if err != nil {
			t.Fatalf("begin holder: %v", err)
		}
		if _, err := holder.Exec(ctx,
			`UPDATE portfolio.watchlists SET updated_at = now() WHERE watchlist_id = $1`, wlID); err != nil {
			t.Fatalf("holder parent touch: %v", err)
		}
		res, err := repo.PruneExpiredSignalEntries(ctx)
		_ = holder.Rollback(ctx)
		if err != nil {
			t.Fatalf("tick with parent held: %v (code %s)", err, pgCode(err))
		}
		if got := removedFor(res, wlID); len(got) != 0 || res.SkippedLists < 1 {
			t.Fatalf("parent held: removed = %+v skipped = %d, want none removed and the list skipped",
				got, res.SkippedLists)
		}
		assertSource(t, pool, wlID, "AAPL", srcSignal)

		// A tick holding the parent while UpdateBinding holds the symbol row and waits on the parent:
		// the tick's SKIP LOCKED binding select must skip, so the two cannot deadlock.
		tick, err := pool.Begin(ctx)
		if err != nil {
			t.Fatalf("begin tick: %v", err)
		}
		defer func() { _ = tick.Rollback(ctx) }()
		var owner string
		if err := tick.QueryRow(ctx,
			`SELECT user_id FROM portfolio.watchlists WHERE watchlist_id = $1 FOR NO KEY UPDATE SKIP LOCKED`,
			wlID).Scan(&owner); err != nil {
			t.Fatalf("tick parent lock: %v", err)
		}

		var wg sync.WaitGroup
		var ubErr error
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _, ubErr = repo.UpdateBinding(ctx, wlID, "AAPL", "strat-ub")
		}()
		waitForParentLockWait(t, pool)

		var skipped []string
		rows, err := tick.Query(ctx,
			`SELECT symbol FROM portfolio.watchlist_symbols
			 WHERE watchlist_id = $1 AND symbol = ANY($2) AND source = 2 FOR UPDATE SKIP LOCKED`,
			wlID, []string{"AAPL"})
		if err != nil {
			t.Fatalf("tick binding select: %v (code %s)", err, pgCode(err))
		}
		for rows.Next() {
			var s string
			if err := rows.Scan(&s); err != nil {
				t.Fatalf("scan: %v", err)
			}
			skipped = append(skipped, s)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			t.Fatalf("tick binding select rows: %v (code %s)", err, pgCode(err))
		}
		if len(skipped) != 0 {
			t.Fatalf("tick locked %v, want the UpdateBinding-held row skipped", skipped)
		}
		if err := tick.Commit(ctx); err != nil {
			t.Fatalf("commit tick: %v", err)
		}
		wg.Wait()
		if ubErr != nil && !errors.Is(ubErr, ErrBindingNotFound) {
			t.Fatalf("UpdateBinding err = %v (code %s), want success or ErrBindingNotFound, never 40P01",
				ubErr, pgCode(ubErr))
		}
	})

	t.Run("c: concurrent renewal AddSymbols and tick", func(t *testing.T) {
		pool := testPool(t)
		repo := NewWatchlistRepo(pool)
		wlID := seedWatchlist(t, pool, testUserID(t), true)
		renewUntil := dbNow(t, pool).Add(30 * 24 * time.Hour).Truncate(time.Microsecond)

		for i := 0; i < 10; i++ {
			if _, err := pool.Exec(ctx,
				`DELETE FROM portfolio.watchlist_symbols WHERE watchlist_id = $1`, wlID); err != nil {
				t.Fatalf("reset bindings: %v", err)
			}
			if _, err := pool.Exec(ctx,
				`DELETE FROM portfolio.watchlist_signal_expiry WHERE watchlist_id = $1`, wlID); err != nil {
				t.Fatalf("reset expiry: %v", err)
			}
			seedBinding(t, pool, wlID, "AAPL", "", int16(srcSignal))
			seedExpiryIn(t, pool, wlID, "AAPL", "-1 day", sigID(101))

			var wg sync.WaitGroup
			var addErr, pruneErr error
			wg.Add(2)
			go func() {
				defer wg.Done()
				_, addErr = repo.AddSymbols(ctx, wlID,
					[]*portfoliov1.WatchlistBinding{addBinding("AAPL", srcSignal)},
					provenanceIntent("AAPL", 102, renewUntil))
			}()
			go func() {
				defer wg.Done()
				_, pruneErr = repo.PruneExpiredSignalEntries(ctx)
			}()
			wg.Wait()
			if addErr != nil || pruneErr != nil {
				t.Fatalf("iteration %d: AddSymbols err = %v (code %s), prune err = %v (code %s); want neither, never 55P03/40P01",
					i, addErr, pgCode(addErr), pruneErr, pgCode(pruneErr))
			}
			// Either order converges: renewal first advances the row; prune first lets the add re-stamp it.
			assertSource(t, pool, wlID, "AAPL", srcSignal)
			assertExpiry(t, pool, wlID, "AAPL", renewUntil, sigID(102))
		}
	})
}

// waitForParentLockWait blocks until some backend is waiting on a lock for the parent touch statement.
func waitForParentLockWait(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	deadline := time.Now().Add(400 * time.Millisecond)
	for time.Now().Before(deadline) {
		var n int
		if err := pool.QueryRow(context.Background(),
			`SELECT count(*) FROM pg_stat_activity
			 WHERE wait_event_type = 'Lock' AND query LIKE 'UPDATE portfolio.watchlists SET updated_at%'`).Scan(&n); err != nil {
			t.Fatalf("pg_stat_activity: %v", err)
		}
		if n > 0 {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("UpdateBinding never reached its parent touch wait")
}
