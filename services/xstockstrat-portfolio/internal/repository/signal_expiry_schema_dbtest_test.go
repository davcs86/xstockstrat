//go:build dbtest

package repository

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

// TestSignalExpirySchema asserts migration 018: PK (watchlist_id, symbol), nullable signal_id,
// and ON DELETE CASCADE from portfolio.watchlists.
func TestSignalExpirySchema(t *testing.T) {
	pool := testPool(t)
	wlID := seedWatchlist(t, pool, testUserID(t), true)
	seedBinding(t, pool, wlID, "AAPL", "strat-1", 2)

	until := time.Now().Add(24 * time.Hour).UTC().Truncate(time.Microsecond)
	sig := int64(42)
	seedExpiry(t, pool, wlID, "AAPL", until, &sig)
	seedExpiry(t, pool, wlID, "MSFT", until, nil)

	rec, ok := expiryRow(t, pool, wlID, "AAPL")
	if !ok || rec.SignalID == nil || *rec.SignalID != sig || !rec.ValidUntil.Equal(until) {
		t.Fatalf("AAPL expiry row = %+v (found=%v), want signal_id=%d valid_until=%v", rec, ok, sig, until)
	}
	if rec, ok := expiryRow(t, pool, wlID, "MSFT"); !ok || rec.SignalID != nil {
		t.Fatalf("MSFT expiry row = %+v (found=%v), want a row with NULL signal_id", rec, ok)
	}

	err := insertExpiry(pool, wlID, "AAPL", until, nil)
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "23505" {
		t.Fatalf("duplicate (watchlist_id, symbol) insert err = %v, want unique_violation 23505", err)
	}

	if _, err := pool.Exec(context.Background(),
		`DELETE FROM portfolio.watchlists WHERE watchlist_id = $1`, wlID); err != nil {
		t.Fatalf("delete watchlist: %v", err)
	}
	if _, ok := expiryRow(t, pool, wlID, "AAPL"); ok {
		t.Fatal("AAPL expiry row survived watchlist delete; want ON DELETE CASCADE")
	}
	if _, ok := expiryRow(t, pool, wlID, "MSFT"); ok {
		t.Fatal("MSFT expiry row survived watchlist delete; want ON DELETE CASCADE")
	}
	if _, ok := bindingSource(t, pool, wlID, "AAPL"); ok {
		t.Fatal("binding survived watchlist delete")
	}
}
