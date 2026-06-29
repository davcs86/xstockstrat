package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"google.golang.org/protobuf/types/known/timestamppb"

	portfoliov1 "github.com/xstockstrat/contracts/gen/go/portfolio/v1"
)

// ErrWatchlistNotFound is returned when a watchlist row does not exist.
var ErrWatchlistNotFound = errors.New("watchlist not found")

// WatchlistRepo handles reads and writes for user-owned watchlists. It reuses the
// portfolio service's existing pgxpool (see PortfolioRepo.Pool) — no second pool.
//
// Every row is owned by a single user_id. Ownership enforcement (a user may only
// touch their own lists) is done in the service layer, which reads UserId off the
// row returned by GetByID before mutating; the repo itself is ownership-agnostic so
// the FR-2 PermissionDenied vs NotFound distinction stays in one place.
type WatchlistRepo struct {
	pool *pgxpool.Pool
}

// NewWatchlistRepo constructs a WatchlistRepo over an existing pool.
func NewWatchlistRepo(pool *pgxpool.Pool) *WatchlistRepo {
	return &WatchlistRepo{pool: pool}
}

// Create inserts a new watchlist plus its (already normalized) symbols in one tx.
func (r *WatchlistRepo) Create(ctx context.Context, userID, name, description string, symbols []string) (*portfoliov1.Watchlist, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var id string
	err = tx.QueryRow(ctx,
		`INSERT INTO portfolio.watchlists (user_id, name, description)
		 VALUES ($1, $2, $3) RETURNING watchlist_id`,
		userID, name, description).Scan(&id)
	if err != nil {
		return nil, fmt.Errorf("insert watchlist: %w", err)
	}
	if err := insertSymbolsTx(ctx, tx, id, symbols); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}
	return r.GetByID(ctx, id)
}

// GetByID returns a single watchlist with its symbols, or ErrWatchlistNotFound.
func (r *WatchlistRepo) GetByID(ctx context.Context, watchlistID string) (*portfoliov1.Watchlist, error) {
	wl, err := scanWatchlist(r.pool.QueryRow(ctx,
		`SELECT watchlist_id, user_id, name, description, created_at, updated_at
		 FROM portfolio.watchlists WHERE watchlist_id = $1`, watchlistID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrWatchlistNotFound
		}
		return nil, fmt.Errorf("get watchlist: %w", err)
	}
	syms, err := r.listSymbols(ctx, watchlistID)
	if err != nil {
		return nil, err
	}
	wl.Symbols = syms
	return wl, nil
}

// ListByUser returns watchlists owned by userID, keyset-paginated by watchlist_id.
func (r *WatchlistRepo) ListByUser(ctx context.Context, userID string, pageSize int, pageToken string) ([]*portfoliov1.Watchlist, string, error) {
	if pageSize <= 0 || pageSize > 500 {
		pageSize = 100
	}
	rows, err := r.pool.Query(ctx,
		`SELECT watchlist_id, user_id, name, description, created_at, updated_at
		 FROM portfolio.watchlists
		 WHERE user_id = $1 AND ($2 = '' OR watchlist_id > $2::uuid)
		 ORDER BY watchlist_id ASC LIMIT $3`,
		userID, pageToken, pageSize+1)
	if err != nil {
		return nil, "", fmt.Errorf("list watchlists: %w", err)
	}
	defer rows.Close()

	var wls []*portfoliov1.Watchlist
	for rows.Next() {
		wl, err := scanWatchlist(rows)
		if err != nil {
			return nil, "", fmt.Errorf("scan watchlist: %w", err)
		}
		wls = append(wls, wl)
	}
	if rows.Err() != nil {
		return nil, "", rows.Err()
	}
	rows.Close()

	// Hydrate symbols for the returned page.
	for _, wl := range wls {
		syms, err := r.listSymbols(ctx, wl.WatchlistId)
		if err != nil {
			return nil, "", err
		}
		wl.Symbols = syms
	}

	nextToken := ""
	if len(wls) > pageSize {
		nextToken = wls[pageSize].WatchlistId
		wls = wls[:pageSize]
	}
	return wls, nextToken, nil
}

// Update replaces name/description and the full symbol set (already normalized) in one tx.
func (r *WatchlistRepo) Update(ctx context.Context, watchlistID, name, description string, symbols []string) (*portfoliov1.Watchlist, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	ct, err := tx.Exec(ctx,
		`UPDATE portfolio.watchlists SET name = $2, description = $3, updated_at = now()
		 WHERE watchlist_id = $1`, watchlistID, name, description)
	if err != nil {
		return nil, fmt.Errorf("update watchlist: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return nil, ErrWatchlistNotFound
	}
	if _, err := tx.Exec(ctx, `DELETE FROM portfolio.watchlist_symbols WHERE watchlist_id = $1`, watchlistID); err != nil {
		return nil, fmt.Errorf("clear symbols: %w", err)
	}
	if err := insertSymbolsTx(ctx, tx, watchlistID, symbols); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}
	return r.GetByID(ctx, watchlistID)
}

// Delete removes a watchlist; ON DELETE CASCADE clears its symbols.
func (r *WatchlistRepo) Delete(ctx context.Context, watchlistID string) error {
	ct, err := r.pool.Exec(ctx, `DELETE FROM portfolio.watchlists WHERE watchlist_id = $1`, watchlistID)
	if err != nil {
		return fmt.Errorf("delete watchlist: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return ErrWatchlistNotFound
	}
	return nil
}

// AddSymbols inserts the given (normalized) symbols, ignoring duplicates, and bumps updated_at.
func (r *WatchlistRepo) AddSymbols(ctx context.Context, watchlistID string, symbols []string) (*portfoliov1.Watchlist, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if err := touchWatchlistTx(ctx, tx, watchlistID); err != nil {
		return nil, err
	}
	if err := insertSymbolsTx(ctx, tx, watchlistID, symbols); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}
	return r.GetByID(ctx, watchlistID)
}

// RemoveSymbols deletes the given symbols and bumps updated_at.
func (r *WatchlistRepo) RemoveSymbols(ctx context.Context, watchlistID string, symbols []string) (*portfoliov1.Watchlist, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if err := touchWatchlistTx(ctx, tx, watchlistID); err != nil {
		return nil, err
	}
	if len(symbols) > 0 {
		if _, err := tx.Exec(ctx,
			`DELETE FROM portfolio.watchlist_symbols WHERE watchlist_id = $1 AND symbol = ANY($2)`,
			watchlistID, symbols); err != nil {
			return nil, fmt.Errorf("remove symbols: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}
	return r.GetByID(ctx, watchlistID)
}

// CountByUser returns how many watchlists a user owns (for the per-user cap).
func (r *WatchlistRepo) CountByUser(ctx context.Context, userID string) (int, error) {
	var n int
	err := r.pool.QueryRow(ctx, `SELECT COUNT(*) FROM portfolio.watchlists WHERE user_id = $1`, userID).Scan(&n)
	return n, err
}

func (r *WatchlistRepo) listSymbols(ctx context.Context, watchlistID string) ([]string, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT symbol FROM portfolio.watchlist_symbols WHERE watchlist_id = $1 ORDER BY symbol ASC`, watchlistID)
	if err != nil {
		return nil, fmt.Errorf("list symbols: %w", err)
	}
	defer rows.Close()
	var syms []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			return nil, fmt.Errorf("scan symbol: %w", err)
		}
		syms = append(syms, s)
	}
	return syms, rows.Err()
}

// touchWatchlistTx bumps updated_at and verifies the row exists (ErrWatchlistNotFound otherwise).
func touchWatchlistTx(ctx context.Context, tx pgx.Tx, watchlistID string) error {
	ct, err := tx.Exec(ctx, `UPDATE portfolio.watchlists SET updated_at = now() WHERE watchlist_id = $1`, watchlistID)
	if err != nil {
		return fmt.Errorf("touch watchlist: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return ErrWatchlistNotFound
	}
	return nil
}

// insertSymbolsTx inserts symbols (already normalized), ignoring duplicates.
func insertSymbolsTx(ctx context.Context, tx pgx.Tx, watchlistID string, symbols []string) error {
	for _, s := range symbols {
		if _, err := tx.Exec(ctx,
			`INSERT INTO portfolio.watchlist_symbols (watchlist_id, symbol)
			 VALUES ($1, $2) ON CONFLICT (watchlist_id, symbol) DO NOTHING`,
			watchlistID, s); err != nil {
			return fmt.Errorf("insert symbol %q: %w", s, err)
		}
	}
	return nil
}

func scanWatchlist(row pgxRow) (*portfoliov1.Watchlist, error) {
	var (
		id, userID, name, description string
		createdAt, updatedAt          time.Time
	)
	if err := row.Scan(&id, &userID, &name, &description, &createdAt, &updatedAt); err != nil {
		return nil, err
	}
	return &portfoliov1.Watchlist{
		WatchlistId: id,
		UserId:      userID,
		Name:        name,
		Description: description,
		CreatedAt:   timestamppb.New(createdAt),
		UpdatedAt:   timestamppb.New(updatedAt),
	}, nil
}
