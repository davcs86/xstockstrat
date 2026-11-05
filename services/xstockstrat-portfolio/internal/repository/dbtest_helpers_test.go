//go:build dbtest

package repository

import (
	"context"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// dbtestUserPrefix scopes every seeded row so cleanup never touches data the tests did not create.
const dbtestUserPrefix = "it-281-"

// testPool connects to the migrated database at PORTFOLIO_DB_TEST_URL. lock_timeout makes any
// lock wait fail fast, so a test that would block reports an error instead of hanging.
func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("PORTFOLIO_DB_TEST_URL")
	if url == "" {
		if os.Getenv("CI") == "true" {
			t.Fatal("PORTFOLIO_DB_TEST_URL is unset under CI=true; the portfolio-db-test job must provide it")
		}
		t.Skip("PORTFOLIO_DB_TEST_URL unset; skipping real-Postgres test")
	}
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatalf("pgxpool.ParseConfig: %v", err)
	}
	cfg.ConnConfig.RuntimeParams["lock_timeout"] = "500ms"
	ctx := context.Background()
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatalf("pgxpool.NewWithConfig: %v", err)
	}
	t.Cleanup(pool.Close)
	t.Cleanup(func() {
		if _, err := pool.Exec(context.Background(),
			`DELETE FROM portfolio.watchlists WHERE user_id LIKE $1`, dbtestUserPrefix+"%"); err != nil {
			t.Errorf("cleanup watchlists: %v", err)
		}
	})
	return pool
}

// testUserID returns a unique, cleanup-scoped user id for one test.
func testUserID(t *testing.T) string {
	t.Helper()
	return fmt.Sprintf("%s%s-%d", dbtestUserPrefix, t.Name(), time.Now().UnixNano())
}

func seedWatchlist(t *testing.T, pool *pgxpool.Pool, userID string, systemManaged bool) string {
	t.Helper()
	var id string
	err := pool.QueryRow(context.Background(),
		`INSERT INTO portfolio.watchlists (user_id, name, system_managed)
		 VALUES ($1, $2, $3) RETURNING watchlist_id::text`,
		userID, "wl-"+userID, systemManaged).Scan(&id)
	if err != nil {
		t.Fatalf("seedWatchlist: %v", err)
	}
	return id
}

func seedBinding(t *testing.T, pool *pgxpool.Pool, wlID, symbol, strategy string, source int16) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO portfolio.watchlist_symbols (watchlist_id, symbol, strategy_id, source)
		 VALUES ($1, $2, $3, $4)`, wlID, symbol, strategy, source); err != nil {
		t.Fatalf("seedBinding: %v", err)
	}
}

// insertExpiry returns the insert error so callers can assert constraint violations.
func insertExpiry(pool *pgxpool.Pool, wlID, symbol string, validUntil time.Time, signalID *int64) error {
	_, err := pool.Exec(context.Background(),
		`INSERT INTO portfolio.watchlist_signal_expiry (watchlist_id, symbol, valid_until, signal_id)
		 VALUES ($1, $2, $3, $4)`, wlID, symbol, validUntil, signalID)
	return err
}

func seedExpiry(t *testing.T, pool *pgxpool.Pool, wlID, symbol string, validUntil time.Time, signalID *int64) {
	t.Helper()
	if err := insertExpiry(pool, wlID, symbol, validUntil, signalID); err != nil {
		t.Fatalf("seedExpiry: %v", err)
	}
}

// bindingSource returns the binding's source and whether the binding exists.
func bindingSource(t *testing.T, pool *pgxpool.Pool, wlID, symbol string) (int16, bool) {
	t.Helper()
	var src int16
	err := pool.QueryRow(context.Background(),
		`SELECT source FROM portfolio.watchlist_symbols WHERE watchlist_id = $1 AND symbol = $2`,
		wlID, symbol).Scan(&src)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, false
	}
	if err != nil {
		t.Fatalf("bindingSource: %v", err)
	}
	return src, true
}

type expiryRecord struct {
	ValidUntil time.Time
	SignalID   *int64
}

// expiryRow returns the expiry row and whether it exists.
func expiryRow(t *testing.T, pool *pgxpool.Pool, wlID, symbol string) (expiryRecord, bool) {
	t.Helper()
	var rec expiryRecord
	err := pool.QueryRow(context.Background(),
		`SELECT valid_until, signal_id FROM portfolio.watchlist_signal_expiry
		 WHERE watchlist_id = $1 AND symbol = $2`, wlID, symbol).Scan(&rec.ValidUntil, &rec.SignalID)
	if errors.Is(err, pgx.ErrNoRows) {
		return expiryRecord{}, false
	}
	if err != nil {
		t.Fatalf("expiryRow: %v", err)
	}
	return rec, true
}
