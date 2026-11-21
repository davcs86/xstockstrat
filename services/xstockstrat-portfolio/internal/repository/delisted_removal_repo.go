package repository

import (
	"context"
	"errors"
	"fmt"
	"slices"

	"github.com/jackc/pgx/v5"
)

// DelistedRemoval reports one system-managed list that held at least one of the given symbols.
// Left = held symbols not removed; Skipped = the parent row or one of the held bindings was locked.
type DelistedRemoval struct {
	WatchlistID, UserID, Name string
	Removed, Left             []string
	Skipped                   bool
}

type delistedList struct {
	watchlistID, userID, name string
	held                      []string
}

// RemoveDelistedFromSystemLists deletes the given symbols from every system-managed list, one short
// transaction per list. Removals of committed lists are returned even when err != nil (first failure).
func (r *WatchlistRepo) RemoveDelistedFromSystemLists(ctx context.Context, symbols []string) ([]DelistedRemoval, error) {
	if len(symbols) == 0 {
		return nil, nil
	}
	lists, err := r.listDelistedHolders(ctx, symbols)
	if err != nil {
		return nil, fmt.Errorf("list system watchlists holding delisted symbols: %w", err)
	}
	var (
		out      []DelistedRemoval
		firstErr error
	)
	for _, l := range lists {
		rem, err := r.removeDelistedListTx(ctx, l)
		if err != nil {
			if firstErr == nil {
				firstErr = fmt.Errorf("remove delisted from watchlist %s: %w", l.watchlistID, err)
			}
			continue
		}
		out = append(out, rem)
	}
	return out, firstErr
}

func (r *WatchlistRepo) listDelistedHolders(ctx context.Context, symbols []string) ([]delistedList, error) {
	rows, err := r.db.Query(ctx,
		`SELECT w.watchlist_id::text, w.user_id, w.name, array_agg(s.symbol ORDER BY s.symbol) AS held
		 FROM portfolio.watchlists w
		 JOIN portfolio.watchlist_symbols s ON s.watchlist_id = w.watchlist_id
		 WHERE w.system_managed AND s.symbol = ANY($1)
		 GROUP BY w.watchlist_id, w.user_id, w.name
		 ORDER BY w.watchlist_id`, symbols)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var lists []delistedList
	for rows.Next() {
		var l delistedList
		if err := rows.Scan(&l.watchlistID, &l.userID, &l.name, &l.held); err != nil {
			return nil, err
		}
		lists = append(lists, l)
	}
	return lists, rows.Err()
}

func (r *WatchlistRepo) removeDelistedListTx(ctx context.Context, l delistedList) (DelistedRemoval, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return DelistedRemoval{}, fmt.Errorf("begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	rem, err := removeDelistedInTx(ctx, tx, l)
	if err != nil {
		return DelistedRemoval{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return DelistedRemoval{}, fmt.Errorf("commit: %w", err)
	}
	return rem, nil
}

// removeDelistedInTx must never wait on a row lock: UpdateBinding locks binding-then-parent, the
// reverse order, so a wait here while holding the parent would deadlock. The caller commits.
func removeDelistedInTx(ctx context.Context, tx pgx.Tx, l delistedList) (DelistedRemoval, error) {
	rem := DelistedRemoval{WatchlistID: l.watchlistID, UserID: l.userID, Name: l.name}

	var (
		userID, name  string
		systemManaged bool
	)
	err := tx.QueryRow(ctx,
		`SELECT user_id, name, system_managed FROM portfolio.watchlists WHERE watchlist_id = $1 FOR NO KEY UPDATE SKIP LOCKED`,
		l.watchlistID).Scan(&userID, &name, &systemManaged)
	if errors.Is(err, pgx.ErrNoRows) {
		rem.Skipped = true
		rem.Left = l.held
		return rem, nil
	}
	if err != nil {
		return rem, fmt.Errorf("lock watchlist: %w", err)
	}
	if !systemManaged {
		return rem, nil
	}

	locked, err := collectStrings(tx.Query(ctx,
		`SELECT symbol FROM portfolio.watchlist_symbols
		 WHERE watchlist_id = $1 AND symbol = ANY($2)
		 FOR UPDATE SKIP LOCKED`,
		l.watchlistID, l.held))
	if err != nil {
		return rem, fmt.Errorf("lock delisted bindings: %w", err)
	}
	if len(locked) > 0 {
		// Delete only the bindings locked above: a delete over every held symbol would wait on a skipped row.
		rem.Removed, err = collectStrings(tx.Query(ctx,
			`DELETE FROM portfolio.watchlist_symbols WHERE watchlist_id = $1 AND symbol = ANY($2)
			 RETURNING symbol`,
			l.watchlistID, locked))
		if err != nil {
			return rem, fmt.Errorf("delete delisted bindings: %w", err)
		}
	}
	for _, sym := range l.held {
		if !slices.Contains(rem.Removed, sym) {
			rem.Left = append(rem.Left, sym)
		}
	}
	rem.Skipped = len(locked) < len(l.held)
	if len(rem.Removed) == 0 {
		return rem, nil
	}
	if _, err := tx.Exec(ctx,
		`DELETE FROM portfolio.watchlist_signal_expiry WHERE watchlist_id = $1 AND symbol = ANY($2)`,
		l.watchlistID, rem.Removed); err != nil {
		return rem, fmt.Errorf("delete delisted expiry rows: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`UPDATE portfolio.watchlists SET updated_at = now() WHERE watchlist_id = $1`,
		l.watchlistID); err != nil {
		return rem, fmt.Errorf("touch watchlist: %w", err)
	}
	return rem, nil
}
