//go:build dbtest

package repository

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	portfoliov1 "github.com/xstockstrat/contracts/gen/go/portfolio/v1"
)

const (
	srcUnspecified = portfoliov1.WatchlistEntrySource_WATCHLIST_ENTRY_SOURCE_UNSPECIFIED
	srcManual      = portfoliov1.WatchlistEntrySource_WATCHLIST_ENTRY_SOURCE_MANUAL
	srcSignal      = portfoliov1.WatchlistEntrySource_WATCHLIST_ENTRY_SOURCE_SIGNAL
)

func addBinding(symbol string, src portfoliov1.WatchlistEntrySource) *portfoliov1.WatchlistBinding {
	return &portfoliov1.WatchlistBinding{Symbol: symbol, Source: src}
}

func day(y int, m time.Month, d int) time.Time {
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

func sigID(v int64) *int64 { return &v }

func provenanceIntent(symbol string, signalID int64, validUntil time.Time) ExpiryIntent {
	return ExpiryIntent{Provenance: &SignalProvenance{SignalID: signalID, ValidUntil: validUntil}, Symbol: symbol}
}

func mustAdd(t *testing.T, repo *WatchlistRepo, wlID string, bindings []*portfoliov1.WatchlistBinding, intent ExpiryIntent) {
	t.Helper()
	if _, err := repo.AddSymbols(context.Background(), wlID, bindings, intent); err != nil {
		t.Fatalf("AddSymbols: %v", err)
	}
}

func assertExpiry(t *testing.T, pool *pgxpool.Pool, wlID, symbol string, wantUntil time.Time, wantID *int64) {
	t.Helper()
	rec, ok := expiryRow(t, pool, wlID, symbol)
	if !ok {
		t.Fatalf("%s: no expiry row, want valid_until=%v signal_id=%v", symbol, wantUntil, ptrVal(wantID))
	}
	if !rec.ValidUntil.Equal(wantUntil) || ptrVal(rec.SignalID) != ptrVal(wantID) {
		t.Fatalf("%s: expiry row = (valid_until=%v, signal_id=%v), want (%v, %v)",
			symbol, rec.ValidUntil, ptrVal(rec.SignalID), wantUntil, ptrVal(wantID))
	}
}

func assertNoExpiry(t *testing.T, pool *pgxpool.Pool, wlID, symbol string) {
	t.Helper()
	if rec, ok := expiryRow(t, pool, wlID, symbol); ok {
		t.Fatalf("%s: expiry row = %+v, want none", symbol, rec)
	}
}

func assertSource(t *testing.T, pool *pgxpool.Pool, wlID, symbol string, want portfoliov1.WatchlistEntrySource) {
	t.Helper()
	got, ok := bindingSource(t, pool, wlID, symbol)
	if !ok || got != int16(want) {
		t.Fatalf("%s: binding source = %d (found=%v), want %d", symbol, got, ok, int16(want))
	}
}

func ptrVal(p *int64) any {
	if p == nil {
		return nil
	}
	return *p
}

// A fresh SIGNAL insert stamps the row; a pre-existing orphan row is overwritten, never merged.
func TestAddPath_FreshInsertOverwrites(t *testing.T) {
	pool := testPool(t)
	repo := NewWatchlistRepo(pool)
	wlID := seedWatchlist(t, pool, testUserID(t), true)

	mustAdd(t, repo, wlID, []*portfoliov1.WatchlistBinding{addBinding("AAPL", srcSignal)},
		provenanceIntent("AAPL", 101, day(2026, 11, 1)))
	assertSource(t, pool, wlID, "AAPL", srcSignal)
	assertExpiry(t, pool, wlID, "AAPL", day(2026, 11, 1), sigID(101))

	seedExpiry(t, pool, wlID, "MSFT", day(2026, 12, 1), sigID(99))
	mustAdd(t, repo, wlID, []*portfoliov1.WatchlistBinding{addBinding("MSFT", srcSignal)},
		provenanceIntent("MSFT", 100, day(2026, 10, 20)))
	assertExpiry(t, pool, wlID, "MSFT", day(2026, 10, 20), sigID(100))
}

// AC-3 / AC-8: a tracked SIGNAL entry keeps the later valid_until; the signal id follows the later signal.
func TestAddPath_MergeTrackedSignal(t *testing.T) {
	cases := []struct {
		name      string
		signalID  int64
		until     time.Time
		wantUntil time.Time
		wantID    int64
	}{
		{"later-dated renewal advances", 102, day(2026, 12, 1), day(2026, 12, 1), 102},
		{"earlier-dated signal keeps row", 100, day(2026, 10, 15), day(2026, 11, 1), 101},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			pool := testPool(t)
			repo := NewWatchlistRepo(pool)
			wlID := seedWatchlist(t, pool, testUserID(t), true)
			seedBinding(t, pool, wlID, "AAPL", "", int16(srcSignal))
			seedExpiry(t, pool, wlID, "AAPL", day(2026, 11, 1), sigID(101))

			mustAdd(t, repo, wlID, []*portfoliov1.WatchlistBinding{addBinding("AAPL", srcSignal)},
				provenanceIntent("AAPL", tc.signalID, tc.until))
			assertExpiry(t, pool, wlID, "AAPL", tc.wantUntil, sigID(tc.wantID))
		})
	}
}

// The merge is update-only: an untracked SIGNAL entry (no row) stays untracked.
func TestAddPath_UntrackedStaysUntracked(t *testing.T) {
	pool := testPool(t)
	repo := NewWatchlistRepo(pool)
	wlID := seedWatchlist(t, pool, testUserID(t), true)
	seedBinding(t, pool, wlID, "NVDA", "", int16(srcSignal))

	mustAdd(t, repo, wlID, []*portfoliov1.WatchlistBinding{addBinding("NVDA", srcSignal)},
		provenanceIntent("NVDA", 103, day(2026, 12, 1)))
	assertNoExpiry(t, pool, wlID, "NVDA")
}

// AC-17: a backfill-marked row (signal_id NULL) takes the new provenance, even an already-past one.
func TestAddPath_RescueMarkedRow(t *testing.T) {
	cases := []struct {
		name     string
		signalID int64
		until    time.Time
	}{
		{"live provenance rescues", 110, day(2026, 12, 1)},
		{"past provenance holds the past valid_until", 111, day(2026, 10, 15)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			pool := testPool(t)
			repo := NewWatchlistRepo(pool)
			wlID := seedWatchlist(t, pool, testUserID(t), true)
			seedBinding(t, pool, wlID, "AMD", "", int16(srcSignal))
			seedExpiry(t, pool, wlID, "AMD", day(2026, 11, 1), nil)

			mustAdd(t, repo, wlID, []*portfoliov1.WatchlistBinding{addBinding("AMD", srcSignal)},
				provenanceIntent("AMD", tc.signalID, tc.until))
			assertExpiry(t, pool, wlID, "AMD", tc.until, sigID(tc.signalID))
		})
	}
}

// An existing MANUAL binding keeps its source and gets no expiry row from a SIGNAL add.
func TestAddPath_ManualBindingNotTracked(t *testing.T) {
	pool := testPool(t)
	repo := NewWatchlistRepo(pool)
	wlID := seedWatchlist(t, pool, testUserID(t), true)
	seedBinding(t, pool, wlID, "TSLA", "", int16(srcManual))

	mustAdd(t, repo, wlID, []*portfoliov1.WatchlistBinding{addBinding("TSLA", srcSignal)},
		provenanceIntent("TSLA", 104, day(2026, 12, 1)))
	assertSource(t, pool, wlID, "TSLA", srcManual)
	assertNoExpiry(t, pool, wlID, "TSLA")
}

// AC-9 / AC-11: only a provenance-less SIGNAL add untracks; MANUAL/UNSPECIFIED adds leave the row alone.
func TestAddPath_Untrack(t *testing.T) {
	pool := testPool(t)
	repo := NewWatchlistRepo(pool)
	wlID := seedWatchlist(t, pool, testUserID(t), true)
	for _, sym := range []string{"INTC", "ORCL", "META"} {
		seedBinding(t, pool, wlID, sym, "", int16(srcSignal))
		seedExpiry(t, pool, wlID, sym, day(2026, 11, 1), sigID(105))
	}

	mustAdd(t, repo, wlID, []*portfoliov1.WatchlistBinding{addBinding("INTC", srcSignal)},
		ExpiryIntent{UntrackSymbols: []string{"INTC"}})
	assertNoExpiry(t, pool, wlID, "INTC")
	assertSource(t, pool, wlID, "INTC", srcSignal)

	mustAdd(t, repo, wlID, []*portfoliov1.WatchlistBinding{addBinding("ORCL", srcUnspecified)}, ExpiryIntent{})
	assertExpiry(t, pool, wlID, "ORCL", day(2026, 11, 1), sigID(105))

	mustAdd(t, repo, wlID, []*portfoliov1.WatchlistBinding{addBinding("META", srcManual)}, ExpiryIntent{})
	assertSource(t, pool, wlID, "META", srcSignal)
	assertExpiry(t, pool, wlID, "META", day(2026, 11, 1), sigID(105))
}

// Replace-all Update (rename) deletes and re-inserts bindings; the expiry FK is to watchlists only, so rows survive.
func TestAddPath_ReplaceAllKeepsExpiry(t *testing.T) {
	pool := testPool(t)
	repo := NewWatchlistRepo(pool)
	wlID := seedWatchlist(t, pool, testUserID(t), true)
	for _, sym := range []string{"AAPL", "MSFT"} {
		seedBinding(t, pool, wlID, sym, "", int16(srcSignal))
		seedExpiry(t, pool, wlID, sym, day(2026, 11, 1), sigID(106))
	}
	ctx := context.Background()

	if _, err := repo.Update(ctx, wlID, "renamed", "",
		[]*portfoliov1.WatchlistBinding{addBinding("AAPL", srcSignal), addBinding("MSFT", srcSignal)}); err != nil {
		t.Fatalf("Update (rename): %v", err)
	}
	assertExpiry(t, pool, wlID, "AAPL", day(2026, 11, 1), sigID(106))
	assertExpiry(t, pool, wlID, "MSFT", day(2026, 11, 1), sigID(106))

	if _, err := repo.Update(ctx, wlID, "renamed", "",
		[]*portfoliov1.WatchlistBinding{addBinding("AAPL", srcSignal), addBinding("MSFT", srcManual)}); err != nil {
		t.Fatalf("Update (re-stamp MANUAL): %v", err)
	}
	assertSource(t, pool, wlID, "MSFT", srcManual)
	assertExpiry(t, pool, wlID, "MSFT", day(2026, 11, 1), sigID(106))
}
