package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// PrunedEntry is one SIGNAL watchlist entry a prune tick removed. SignalID is nil when the expiry
// row was an untracked mark (signal_id IS NULL).
type PrunedEntry struct {
	UserID, WatchlistID, Symbol, StrategyID string
	SignalID                                *int64
	ValidUntil                              time.Time
}

// PruneResult reports one prune tick: Lists = lists with a due expiry row, SkippedLists = those whose
// parent row was locked and left for the next tick.
type PruneResult struct {
	Removed             []PrunedEntry
	Lists, SkippedLists int
}

type dueExpiry struct {
	signalID   *int64
	validUntil time.Time
}

// PruneExpiredSignalEntries removes SIGNAL entries whose expiry row is due, one short transaction per
// list that never waits on a row lock (SKIP LOCKED). Removals of committed lists are returned even
// when err != nil; err is the first per-list failure, reported after every list was attempted.
func (r *WatchlistRepo) PruneExpiredSignalEntries(ctx context.Context) (PruneResult, error) {
	var res PruneResult
	ids, err := collectStrings(r.pool.Query(ctx,
		`SELECT DISTINCT watchlist_id FROM portfolio.watchlist_signal_expiry WHERE valid_until <= now()`))
	if err != nil {
		return res, fmt.Errorf("list due watchlists: %w", err)
	}
	res.Lists = len(ids)
	var firstErr error
	for _, id := range ids {
		removed, skipped, err := r.pruneListTx(ctx, id)
		if err != nil {
			if firstErr == nil {
				firstErr = fmt.Errorf("prune watchlist %s: %w", id, err)
			}
			continue
		}
		if skipped {
			res.SkippedLists++
			continue
		}
		res.Removed = append(res.Removed, removed...)
	}
	return res, firstErr
}

func (r *WatchlistRepo) pruneListTx(ctx context.Context, watchlistID string) ([]PrunedEntry, bool, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, false, fmt.Errorf("begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var userID string
	err = tx.QueryRow(ctx,
		`SELECT user_id FROM portfolio.watchlists WHERE watchlist_id = $1 FOR NO KEY UPDATE SKIP LOCKED`,
		watchlistID).Scan(&userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, true, nil
	}
	if err != nil {
		return nil, false, fmt.Errorf("lock watchlist: %w", err)
	}

	due, dueSymbols, err := lockDueExpiryTx(ctx, tx, watchlistID)
	if err != nil {
		return nil, false, err
	}
	if len(dueSymbols) == 0 {
		return nil, false, tx.Commit(ctx)
	}

	locked, err := collectStrings(tx.Query(ctx,
		`SELECT symbol FROM portfolio.watchlist_symbols
		 WHERE watchlist_id = $1 AND symbol = ANY($2) AND source = 2
		 FOR UPDATE SKIP LOCKED`,
		watchlistID, dueSymbols))
	if err != nil {
		return nil, false, fmt.Errorf("lock due bindings: %w", err)
	}

	// Delete only the bindings locked above: a delete over every due symbol would wait on a skipped row.
	var removed []PrunedEntry
	removedSymbols := []string{}
	if len(locked) > 0 {
		rows, err := tx.Query(ctx,
			`DELETE FROM portfolio.watchlist_symbols WHERE watchlist_id = $1 AND symbol = ANY($2)
			 RETURNING symbol, strategy_id`,
			watchlistID, locked)
		if err != nil {
			return nil, false, fmt.Errorf("delete due bindings: %w", err)
		}
		for rows.Next() {
			var sym, strat string
			if err := rows.Scan(&sym, &strat); err != nil {
				rows.Close()
				return nil, false, fmt.Errorf("scan removed binding: %w", err)
			}
			d := due[sym]
			removedSymbols = append(removedSymbols, sym)
			removed = append(removed, PrunedEntry{
				UserID: userID, WatchlistID: watchlistID, Symbol: sym, StrategyID: strat,
				SignalID: d.signalID, ValidUntil: d.validUntil,
			})
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return nil, false, fmt.Errorf("delete due bindings rows: %w", err)
		}
	}

	if _, err := tx.Exec(ctx,
		`DELETE FROM portfolio.watchlist_signal_expiry e
		 WHERE e.watchlist_id = $1 AND e.symbol = ANY($2)
		   AND (e.symbol = ANY($3) OR NOT EXISTS (
		     SELECT 1 FROM portfolio.watchlist_symbols s
		     WHERE s.watchlist_id = e.watchlist_id AND s.symbol = e.symbol AND s.source = 2))`,
		watchlistID, dueSymbols, removedSymbols); err != nil {
		return nil, false, fmt.Errorf("delete due expiry rows: %w", err)
	}
	if len(removed) > 0 {
		if _, err := tx.Exec(ctx,
			`UPDATE portfolio.watchlists SET updated_at = now() WHERE watchlist_id = $1`,
			watchlistID); err != nil {
			return nil, false, fmt.Errorf("touch watchlist: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, false, fmt.Errorf("commit: %w", err)
	}
	return removed, false, nil
}

func lockDueExpiryTx(ctx context.Context, tx pgx.Tx, watchlistID string) (map[string]dueExpiry, []string, error) {
	rows, err := tx.Query(ctx,
		`SELECT symbol, signal_id, valid_until FROM portfolio.watchlist_signal_expiry
		 WHERE watchlist_id = $1 AND valid_until <= now()
		 FOR UPDATE SKIP LOCKED`,
		watchlistID)
	if err != nil {
		return nil, nil, fmt.Errorf("lock due expiry rows: %w", err)
	}
	defer rows.Close()
	due := map[string]dueExpiry{}
	var symbols []string
	for rows.Next() {
		var (
			sym string
			d   dueExpiry
		)
		if err := rows.Scan(&sym, &d.signalID, &d.validUntil); err != nil {
			return nil, nil, fmt.Errorf("scan due expiry row: %w", err)
		}
		due[sym] = d
		symbols = append(symbols, sym)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, fmt.Errorf("due expiry rows: %w", err)
	}
	return due, symbols, nil
}

func collectStrings(rows pgx.Rows, err error) ([]string, error) {
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}
