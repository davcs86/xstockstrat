package repository

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"google.golang.org/protobuf/types/known/timestamppb"

	portfoliov1 "github.com/xstockstrat/contracts/gen/go/portfolio/v1"
)

// ErrWatchlistNotFound is returned when a watchlist row does not exist.
var ErrWatchlistNotFound = errors.New("watchlist not found")

// ErrBindingNotFound is returned when the (watchlist_id, symbol) row does not exist.
var ErrBindingNotFound = errors.New("watchlist binding not found")

// WatchlistRepo handles reads/writes for user-owned watchlists, reusing the shared portfolio pool
// (no second pool). Ownership is enforced in the service layer; the repo is ownership-agnostic.
type WatchlistRepo struct {
	pool *pgxpool.Pool
}

// NewWatchlistRepo constructs a WatchlistRepo over an existing pool.
func NewWatchlistRepo(pool *pgxpool.Pool) *WatchlistRepo {
	return &WatchlistRepo{pool: pool}
}

// Create inserts a new watchlist plus its (already normalized) bindings in one tx.
// defaultStrategyID persists the watchlist-level default; "" = none.
func (r *WatchlistRepo) Create(ctx context.Context, userID, name, description, defaultStrategyID string, bindings []*portfoliov1.WatchlistBinding) (*portfoliov1.Watchlist, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var id string
	err = tx.QueryRow(ctx,
		`INSERT INTO portfolio.watchlists (user_id, name, description, default_strategy_id)
		 VALUES ($1, $2, $3, $4) RETURNING watchlist_id`,
		userID, name, description, defaultStrategyID).Scan(&id)
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

// EnsureSystemManaged find-or-creates the caller's single system-managed watchlist, race-free via
// the watchlists_user_system_uidx partial unique index — exactly one system list per user.
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
		`SELECT watchlist_id, user_id, name, description, created_at, updated_at, system_managed, default_strategy_id
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
		`SELECT watchlist_id, user_id, name, description, created_at, updated_at, system_managed, default_strategy_id
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

// WatchlistPatch carries the optional scalar fields of a masked partial update. Each Set* flag gates
// whether the paired value is written; bindings are never part of a partial update (scalar-only mask).
type WatchlistPatch struct {
	SetName            bool
	Name               string
	SetDescription     bool
	Description        string
	SetDefaultStrategy bool
	DefaultStrategyID  string
}

// UpdatePartial writes only the flagged scalar columns plus updated_at in one statement. Column
// identifiers come from a fixed allowlist (never caller input) and values are bound $N — injection-safe.
func (r *WatchlistRepo) UpdatePartial(ctx context.Context, watchlistID string, patch WatchlistPatch) (*portfoliov1.Watchlist, error) {
	setClauses := []string{"updated_at = now()"}
	args := []any{watchlistID}
	if patch.SetName {
		args = append(args, patch.Name)
		setClauses = append(setClauses, fmt.Sprintf("name = $%d", len(args)))
	}
	if patch.SetDescription {
		args = append(args, patch.Description)
		setClauses = append(setClauses, fmt.Sprintf("description = $%d", len(args)))
	}
	if patch.SetDefaultStrategy {
		args = append(args, patch.DefaultStrategyID)
		setClauses = append(setClauses, fmt.Sprintf("default_strategy_id = $%d", len(args)))
	}
	if len(setClauses) == 1 { // only updated_at — no real masked column
		return nil, fmt.Errorf("update partial: empty patch")
	}
	query := fmt.Sprintf(
		`UPDATE portfolio.watchlists SET %s WHERE watchlist_id = $1`,
		strings.Join(setClauses, ", "))
	ct, err := r.pool.Exec(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("update partial: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return nil, ErrWatchlistNotFound
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

// AddSymbols inserts the given (normalized) bindings, ignoring duplicates (ON CONFLICT DO NOTHING —
// an existing symbol keeps its strategy_id, so a legacy flat add never clears a prior binding).
func (r *WatchlistRepo) AddSymbols(ctx context.Context, watchlistID string, bindings []*portfoliov1.WatchlistBinding) (*portfoliov1.Watchlist, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := touchWatchlistTx(ctx, tx, watchlistID); err != nil {
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

	if _, err := touchWatchlistTx(ctx, tx, watchlistID); err != nil {
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

// UpdateBinding rebinds one symbol's strategy_id via a single-row UPDATE, writing ONLY strategy_id
// (source untouched — fails-080). No such symbol → ErrBindingNotFound; bumps and returns parent updated_at.
func (r *WatchlistRepo) UpdateBinding(ctx context.Context, watchlistID, symbol, strategyID string) (*portfoliov1.WatchlistBinding, time.Time, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, time.Time{}, fmt.Errorf("begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var (
		sym, strat string
		source     int16
	)
	err = tx.QueryRow(ctx,
		`UPDATE portfolio.watchlist_symbols SET strategy_id = $3
		 WHERE watchlist_id = $1 AND symbol = $2
		 RETURNING symbol, strategy_id, source`,
		watchlistID, symbol, strategyID).Scan(&sym, &strat, &source)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, time.Time{}, ErrBindingNotFound
	}
	if err != nil {
		return nil, time.Time{}, fmt.Errorf("update binding: %w", err)
	}
	updatedAt, err := touchWatchlistTx(ctx, tx, watchlistID)
	if err != nil {
		return nil, time.Time{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, time.Time{}, fmt.Errorf("commit: %w", err)
	}
	return &portfoliov1.WatchlistBinding{
		Symbol:     sym,
		StrategyId: strat,
		Source:     portfoliov1.WatchlistEntrySource(source),
	}, updatedAt, nil
}

// UpdateBindings atomically rebinds pre-normalized/deduped symbols to one strategy_id (writes ONLY
// strategy_id). Any symbol absent → whole tx rolled back (no partial writes) + ErrBindingNotFound.
func (r *WatchlistRepo) UpdateBindings(ctx context.Context, watchlistID string, symbols []string, strategyID string) ([]*portfoliov1.WatchlistBinding, time.Time, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, time.Time{}, fmt.Errorf("begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	rows, err := tx.Query(ctx,
		`UPDATE portfolio.watchlist_symbols SET strategy_id = $3
		 WHERE watchlist_id = $1 AND symbol = ANY($2)
		 RETURNING symbol, strategy_id, source`,
		watchlistID, symbols, strategyID)
	if err != nil {
		return nil, time.Time{}, fmt.Errorf("update bindings: %w", err)
	}
	var binds []*portfoliov1.WatchlistBinding
	for rows.Next() {
		var (
			sym, strat string
			source     int16
		)
		if err := rows.Scan(&sym, &strat, &source); err != nil {
			rows.Close()
			return nil, time.Time{}, fmt.Errorf("scan binding: %w", err)
		}
		binds = append(binds, &portfoliov1.WatchlistBinding{
			Symbol:     sym,
			StrategyId: strat,
			Source:     portfoliov1.WatchlistEntrySource(source),
		})
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, time.Time{}, fmt.Errorf("update bindings rows: %w", err)
	}
	// Fewer RETURNING rows than requested = some symbol absent → reject the whole batch (no partial writes).
	if len(binds) != len(symbols) {
		return nil, time.Time{}, ErrBindingNotFound
	}
	updatedAt, err := touchWatchlistTx(ctx, tx, watchlistID)
	if err != nil {
		return nil, time.Time{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, time.Time{}, fmt.Errorf("commit: %w", err)
	}
	return binds, updatedAt, nil
}

// CountByUser returns how many watchlists a user owns (for the per-user cap).
func (r *WatchlistRepo) CountByUser(ctx context.Context, userID string) (int, error) {
	var n int
	err := r.pool.QueryRow(ctx, `SELECT COUNT(*) FROM portfolio.watchlists WHERE user_id = $1`, userID).Scan(&n)
	return n, err
}

// ListAllSymbols returns the distinct union of watchlist symbols across ALL users — no user filter
// or join (symbols are flat rows on watchlist_symbols). Cross-user by design.
func (r *WatchlistRepo) ListAllSymbols(ctx context.Context) ([]string, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT DISTINCT symbol FROM portfolio.watchlist_symbols ORDER BY symbol`)
	if err != nil {
		return nil, fmt.Errorf("list all symbols: %w", err)
	}
	defer rows.Close()
	var syms []string
	for rows.Next() {
		var symbol string
		if err := rows.Scan(&symbol); err != nil {
			return nil, fmt.Errorf("scan symbol: %w", err)
		}
		syms = append(syms, symbol)
	}
	return syms, rows.Err()
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

// touchWatchlistTx bumps updated_at, verifies the row exists (else ErrWatchlistNotFound), and
// returns the bumped timestamp so a caller can source a response updated_at without a second query.
func touchWatchlistTx(ctx context.Context, tx pgx.Tx, watchlistID string) (time.Time, error) {
	var updatedAt time.Time
	err := tx.QueryRow(ctx,
		`UPDATE portfolio.watchlists SET updated_at = now() WHERE watchlist_id = $1 RETURNING updated_at`,
		watchlistID).Scan(&updatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return time.Time{}, ErrWatchlistNotFound
	}
	if err != nil {
		return time.Time{}, fmt.Errorf("touch watchlist: %w", err)
	}
	return updatedAt, nil
}

// insertBindingsTx inserts (already normalized) bindings, ignoring duplicates. ON CONFLICT DO NOTHING
// preserves an existing binding's strategy_id — a legacy flat add never clears a prior one (fails-080).
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
		defaultStrategyID             string
	)
	if err := row.Scan(&id, &userID, &name, &description, &createdAt, &updatedAt, &systemManaged, &defaultStrategyID); err != nil {
		return nil, err
	}
	return &portfoliov1.Watchlist{
		WatchlistId:       id,
		UserId:            userID,
		Name:              name,
		Description:       description,
		CreatedAt:         timestamppb.New(createdAt),
		UpdatedAt:         timestamppb.New(updatedAt),
		SystemManaged:     systemManaged,
		DefaultStrategyId: defaultStrategyID,
	}, nil
}
