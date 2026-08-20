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

// Create inserts a new watchlist plus its (already normalized) bindings in one tx.
func (r *WatchlistRepo) Create(ctx context.Context, userID, name, description string, bindings []*portfoliov1.WatchlistBinding) (*portfoliov1.Watchlist, error) {
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
	if err := insertBindingsTx(ctx, tx, id, bindings); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}
	return r.GetByID(ctx, id)
}

// EnsureSystemManaged find-or-creates the caller's single system-managed watchlist,
// race-free. The INSERT ... ON CONFLICT (user_id) WHERE system_managed DO NOTHING
// targets the watchlists_user_system_uidx partial unique index (migration 011): a
// concurrent creator's row wins and this call's RETURNING is empty, so we fall back
// to selecting the existing row's id. Either way exactly one system list per user.
func (r *WatchlistRepo) EnsureSystemManaged(ctx context.Context, userID, defaultName string) (*portfoliov1.Watchlist, error) {
	var id string
	err := r.pool.QueryRow(ctx,
		`INSERT INTO portfolio.watchlists (user_id, name, system_managed)
		 VALUES ($1, $2, true)
		 ON CONFLICT (user_id) WHERE system_managed DO NOTHING
		 RETURNING watchlist_id`,
		userID, defaultName).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		// Row already existed (conflict) — fetch the existing system list's id.
		if err := r.pool.QueryRow(ctx,
			`SELECT watchlist_id FROM portfolio.watchlists
			 WHERE user_id = $1 AND system_managed`, userID).Scan(&id); err != nil {
			return nil, fmt.Errorf("select existing system watchlist: %w", err)
		}
	} else if err != nil {
		return nil, fmt.Errorf("ensure system watchlist: %w", err)
	}
	return r.GetByID(ctx, id)
}

// GetByID returns a single watchlist with its symbols, or ErrWatchlistNotFound.
func (r *WatchlistRepo) GetByID(ctx context.Context, watchlistID string) (*portfoliov1.Watchlist, error) {
	wl, err := scanWatchlist(r.pool.QueryRow(ctx,
		`SELECT watchlist_id, user_id, name, description, created_at, updated_at, system_managed
		 FROM portfolio.watchlists WHERE watchlist_id = $1`, watchlistID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrWatchlistNotFound
		}
		return nil, fmt.Errorf("get watchlist: %w", err)
	}
	binds, err := r.listBindings(ctx, watchlistID)
	if err != nil {
		return nil, err
	}
	wl.Bindings = binds
	wl.Symbols = bindingSymbols(binds) //nolint:staticcheck // SA1019: deprecated symbols mirror intentionally retained for old clients (feature 097)
	return wl, nil
}

// ListByUser returns watchlists owned by userID, keyset-paginated by watchlist_id.
func (r *WatchlistRepo) ListByUser(ctx context.Context, userID string, pageSize int, pageToken string) ([]*portfoliov1.Watchlist, string, error) {
	if pageSize <= 0 || pageSize > 500 {
		pageSize = 100
	}
	rows, err := r.pool.Query(ctx,
		`SELECT watchlist_id, user_id, name, description, created_at, updated_at, system_managed
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

	// Hydrate bindings (and the flat symbols mirror) for the returned page.
	for _, wl := range wls {
		binds, err := r.listBindings(ctx, wl.WatchlistId)
		if err != nil {
			return nil, "", err
		}
		wl.Bindings = binds
		wl.Symbols = bindingSymbols(binds) //nolint:staticcheck // SA1019: deprecated symbols mirror intentionally retained for old clients (feature 097)
	}

	nextToken := ""
	if len(wls) > pageSize {
		nextToken = wls[pageSize].WatchlistId
		wls = wls[:pageSize]
	}
	return wls, nextToken, nil
}

// Update replaces name/description and the full binding set (already normalized) in one tx.
func (r *WatchlistRepo) Update(ctx context.Context, watchlistID, name, description string, bindings []*portfoliov1.WatchlistBinding) (*portfoliov1.Watchlist, error) {
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
	if err := insertBindingsTx(ctx, tx, watchlistID, bindings); err != nil {
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

// AddSymbols inserts the given (normalized) bindings, ignoring duplicate symbols
// (ON CONFLICT DO NOTHING — an existing symbol keeps its stored strategy_id, so a
// legacy flat add never clears a prior binding), and bumps updated_at.
func (r *WatchlistRepo) AddSymbols(ctx context.Context, watchlistID string, bindings []*portfoliov1.WatchlistBinding) (*portfoliov1.Watchlist, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if err := touchWatchlistTx(ctx, tx, watchlistID); err != nil {
		return nil, err
	}
	if err := insertBindingsTx(ctx, tx, watchlistID, bindings); err != nil {
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

func (r *WatchlistRepo) listBindings(ctx context.Context, watchlistID string) ([]*portfoliov1.WatchlistBinding, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT symbol, strategy_id, source FROM portfolio.watchlist_symbols WHERE watchlist_id = $1 ORDER BY symbol ASC`, watchlistID)
	if err != nil {
		return nil, fmt.Errorf("list bindings: %w", err)
	}
	defer rows.Close()
	var binds []*portfoliov1.WatchlistBinding
	for rows.Next() {
		var (
			symbol, strategyID string
			source             int16
		)
		if err := rows.Scan(&symbol, &strategyID, &source); err != nil {
			return nil, fmt.Errorf("scan binding: %w", err)
		}
		binds = append(binds, &portfoliov1.WatchlistBinding{
			Symbol:     symbol,
			StrategyId: strategyID,
			Source:     portfoliov1.WatchlistEntrySource(source),
		})
	}
	return binds, rows.Err()
}

// bindingSymbols flattens bindings to the deprecated symbols mirror (kept for old readers).
func bindingSymbols(binds []*portfoliov1.WatchlistBinding) []string {
	if len(binds) == 0 {
		return nil
	}
	out := make([]string, 0, len(binds))
	for _, b := range binds {
		out = append(out, b.GetSymbol())
	}
	return out
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

// insertBindingsTx inserts (symbol, strategy_id) bindings (already normalized),
// ignoring duplicate symbols. ON CONFLICT DO NOTHING preserves an existing binding's
// strategy_id — a legacy flat add (strategy_id="") never clears a prior binding (fails-080).
func insertBindingsTx(ctx context.Context, tx pgx.Tx, watchlistID string, bindings []*portfoliov1.WatchlistBinding) error {
	for _, b := range bindings {
		if _, err := tx.Exec(ctx,
			`INSERT INTO portfolio.watchlist_symbols (watchlist_id, symbol, strategy_id, source)
			 VALUES ($1, $2, $3, $4) ON CONFLICT (watchlist_id, symbol) DO NOTHING`,
			watchlistID, b.GetSymbol(), b.GetStrategyId(), int16(b.GetSource())); err != nil {
			return fmt.Errorf("insert binding %q: %w", b.GetSymbol(), err)
		}
	}
	return nil
}

func scanWatchlist(row pgxRow) (*portfoliov1.Watchlist, error) {
	var (
		id, userID, name, description string
		createdAt, updatedAt          time.Time
		systemManaged                 bool
	)
	if err := row.Scan(&id, &userID, &name, &description, &createdAt, &updatedAt, &systemManaged); err != nil {
		return nil, err
	}
	return &portfoliov1.Watchlist{
		WatchlistId:   id,
		UserId:        userID,
		Name:          name,
		Description:   description,
		CreatedAt:     timestamppb.New(createdAt),
		UpdatedAt:     timestamppb.New(updatedAt),
		SystemManaged: systemManaged,
	}, nil
}
