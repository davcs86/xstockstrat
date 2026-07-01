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

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	portfoliov1 "github.com/xstockstrat/contracts/gen/go/portfolio/v1"
)

// PortfolioRepo handles reads and writes for positions and snapshots.
type PortfolioRepo struct {
	pool *pgxpool.Pool
}

// NewPortfolioRepo opens a pgx connection pool.
func NewPortfolioRepo(connStr string) (*PortfolioRepo, error) {
	pool, err := newPool(context.Background(), connStr)
	if err != nil {
		return nil, fmt.Errorf("newPool: %w", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		return nil, fmt.Errorf("db ping: %w", err)
	}
	return &PortfolioRepo{pool: pool}, nil
}

// Pool exposes the underlying connection pool so sibling repositories in this
// package (e.g. WatchlistRepo) can reuse the single portfolio pgxpool rather than
// opening a second pool (keeps the connection-pool budget at 2).
func (r *PortfolioRepo) Pool() *pgxpool.Pool {
	return r.pool
}

// UpsertPosition inserts or updates a position row.
func (r *PortfolioRepo) UpsertPosition(ctx context.Context, userID, symbol string, qty, avgEntry, costBasis float64, mode commonv1.TradingMode, accountID string) error {
	const q = `
		INSERT INTO portfolio.positions (user_id, symbol, qty, avg_entry_price, cost_basis, trading_mode, account_id, opened_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
		ON CONFLICT (user_id, symbol, trading_mode, account_id) DO UPDATE
		SET qty=$3, avg_entry_price=$4, cost_basis=$5, updated_at=NOW()`
	_, err := r.pool.Exec(ctx, q, userID, symbol, qty, avgEntry, costBasis, mode.String(), accountID)
	return err
}

// ClosePosition removes a position row (called when qty reaches zero).
func (r *PortfolioRepo) ClosePosition(ctx context.Context, userID, symbol string, mode commonv1.TradingMode) error {
	const q = `DELETE FROM portfolio.positions WHERE user_id=$1 AND symbol=$2 AND trading_mode=$3`
	_, err := r.pool.Exec(ctx, q, userID, symbol, mode.String())
	return err
}

// GetPosition returns a single position for a user/symbol/mode.
func (r *PortfolioRepo) GetPosition(ctx context.Context, userID, symbol string, mode commonv1.TradingMode) (*portfoliov1.Position, error) {
	q := `
		SELECT ` + positionColumns + `
		FROM portfolio.positions
		WHERE user_id=$1 AND symbol=$2 AND trading_mode=$3
		ORDER BY opened_at DESC LIMIT 1`
	row := r.pool.QueryRow(ctx, q, userID, symbol, mode.String())
	return scanPositionRow(row)
}

// ListPositions returns paginated positions for a user, optionally filtered by mode and accountID.
func (r *PortfolioRepo) ListPositions(ctx context.Context, userID string, mode commonv1.TradingMode, pageSize int, pageToken string, accountID string, symbolFilter string, side portfoliov1.PositionSide) ([]*portfoliov1.Position, string, error) {
	if pageSize <= 0 || pageSize > 500 {
		pageSize = 100
	}

	// Build the WHERE clause dynamically: optional trading_mode / account_id / symbol
	// filters (each a placeholder param), a static qty-sign side filter, and the keyset
	// pagination predicate (symbol > pageToken). ORDER BY symbol + pageSize+1 overflow probe
	// are preserved so keyset pagination still works.
	conds := []string{"user_id = $1"}
	args := []any{userID}
	add := func(condFmt string, val any) {
		args = append(args, val)
		conds = append(conds, fmt.Sprintf(condFmt, len(args)))
	}
	if mode != commonv1.TradingMode_TRADING_MODE_UNSPECIFIED {
		add("trading_mode = $%d", mode.String())
	}
	if accountID != "" {
		add("account_id = $%d", accountID)
	}
	if symbolFilter != "" {
		add("symbol = $%d", symbolFilter)
	}
	switch side {
	case portfoliov1.PositionSide_POSITION_SIDE_LONG:
		conds = append(conds, "qty > 0")
	case portfoliov1.PositionSide_POSITION_SIDE_SHORT:
		conds = append(conds, "qty < 0")
	}
	args = append(args, pageToken)
	conds = append(conds, fmt.Sprintf("($%d = '' OR symbol > $%d)", len(args), len(args)))
	args = append(args, pageSize+1)
	limitIdx := len(args)

	// Select the broker's mark-to-market valuation (current_price / market_value /
	// unrealized_pnl / unrealized_pnl_pct) and intraday day_pnl figures via the shared
	// positionColumns/scanPositionRow so broker-valued positions return authoritative figures.
	// The service only falls back to marketdata mid-quote enrichment for positions the broker
	// did not value (current_price <= 0) — previously this query omitted these columns, so the
	// service always recomputed them from mid-quotes and the positions table diverged from the
	// broker (e.g. market value / current price / P&L disagreeing with the Alpaca dashboard).
	q := fmt.Sprintf(`
		SELECT `+positionColumns+`
		FROM portfolio.positions
		WHERE %s
		ORDER BY symbol ASC LIMIT $%d`, strings.Join(conds, " AND "), limitIdx)

	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, "", fmt.Errorf("list positions: %w", err)
	}
	defer rows.Close()

	var positions []*portfoliov1.Position
	for rows.Next() {
		p, err := scanPositionRow(rows)
		if err != nil {
			return nil, "", err
		}
		positions = append(positions, p)
	}
	if rows.Err() != nil {
		return nil, "", rows.Err()
	}

	nextToken := ""
	if len(positions) > pageSize {
		nextToken = positions[pageSize].Symbol
		positions = positions[:pageSize]
	}
	return positions, nextToken, nil
}

// InsertSnapshot writes a portfolio snapshot to the hypertable.
func (r *PortfolioRepo) InsertSnapshot(ctx context.Context, portfolioID, userID string, equity, cash, dayPnL float64, openPositions int, mode commonv1.TradingMode) error {
	const q = `
		INSERT INTO portfolio.snapshots (snapshot_time, portfolio_id, user_id, equity, cash, buying_power, day_pnl, open_positions, trading_mode)
		VALUES (NOW(), $1, $2, $3, $4, $4, $5, $6, $7)
		ON CONFLICT (portfolio_id, snapshot_time) DO NOTHING`
	_, err := r.pool.Exec(ctx, q, portfolioID, userID, equity, cash, dayPnL, openPositions, mode.String())
	return err
}

// GetSnapshot returns the snapshot closest to atTime for a portfolio.
func (r *PortfolioRepo) GetSnapshot(ctx context.Context, portfolioID string, atTime time.Time) (*portfoliov1.PortfolioSnapshot, error) {
	const q = `
		SELECT portfolio_id, snapshot_time, equity, cash, day_pnl, open_positions
		FROM portfolio.snapshots
		WHERE portfolio_id=$1 AND snapshot_time <= $2
		ORDER BY snapshot_time DESC LIMIT 1`
	row := r.pool.QueryRow(ctx, q, portfolioID, atTime)
	var (
		pid                  string
		snapTime             time.Time
		equity, cash, dayPnL float64
		openPos              int32
	)
	if err := row.Scan(&pid, &snapTime, &equity, &cash, &dayPnL, &openPos); err != nil {
		return nil, fmt.Errorf("get snapshot: %w", err)
	}
	return &portfoliov1.PortfolioSnapshot{
		PortfolioId:   pid,
		SnapshotTime:  timestamppb.New(snapTime),
		Equity:        equity,
		Cash:          cash,
		DayPnl:        dayPnL,
		OpenPositions: openPos,
	}, nil
}

// CountPositions returns how many open positions a user has for a given mode.
func (r *PortfolioRepo) CountPositions(ctx context.Context, userID string, mode commonv1.TradingMode) (int, error) {
	const q = `SELECT COUNT(*) FROM portfolio.positions WHERE user_id=$1 AND trading_mode=$2`
	var count int
	err := r.pool.QueryRow(ctx, q, userID, mode.String()).Scan(&count)
	return count, err
}

type pgxRow interface {
	Scan(dest ...any) error
}

func scanPositionRow(row pgxRow) (*portfoliov1.Position, error) {
	var (
		symbol, modeStr, accountID                                 string
		qty, avgEntry, costBasis                                   float64
		currentPrice, marketValue, unrealizedPnl, unrealizedPnlPct float64
		dayPnl, dayPnlPct                                          float64
		openedAt                                                   time.Time
	)
	if err := row.Scan(&symbol, &qty, &avgEntry, &costBasis, &openedAt, &modeStr, &accountID,
		&currentPrice, &marketValue, &unrealizedPnl, &unrealizedPnlPct, &dayPnl, &dayPnlPct); err != nil {
		return nil, fmt.Errorf("scan position: %w", err)
	}
	return &portfoliov1.Position{
		Symbol:           symbol,
		Qty:              qty,
		AvgEntryPrice:    avgEntry,
		CostBasis:        costBasis,
		OpenedAt:         timestamppb.New(openedAt),
		AccountId:        accountID,
		CurrentPrice:     currentPrice,
		MarketValue:      marketValue,
		UnrealizedPnl:    unrealizedPnl,
		UnrealizedPnlPct: unrealizedPnlPct,
		DayPnl:           dayPnl,
		DayPnlPct:        dayPnlPct,
	}, nil
}

// positionColumns is the SELECT column list backing scanPositionRow — kept in one place so
// the column order stays in lockstep with the Scan call above.
const positionColumns = `symbol, qty, avg_entry_price, cost_basis, opened_at, trading_mode, account_id, current_price, market_value, unrealized_pnl, unrealized_pnl_pct, day_pnl, day_pnl_pct`

// PositionValuation is the broker's mark-to-market snapshot for a single position,
// carried on account.positions.synced. Zero fields mean the broker did not report a
// value (e.g. a legacy sync event), in which case the service falls back to marketdata.
type PositionValuation struct {
	CurrentPrice     float64
	MarketValue      float64
	UnrealizedPnl    float64
	UnrealizedPnlPct float64
	// DayPnl / DayPnlPct are the broker's intraday (today's) P&L — change since the
	// previous close. Distinct from UnrealizedPnl (total since entry); zero = not reported.
	DayPnl    float64
	DayPnlPct float64
}

// UpsertPositionFromSync inserts or updates a position from a broker position sync.
// Unlike UpsertPosition, opened_at is never overwritten on conflict. cost_basis is
// the total cost (qty × avg_cost) to match the per-fill path and the P&L math in
// GetPortfolio/ListPortfolios (which compute market_value − cost_basis). The broker's
// mark-to-market valuation (val) is stored so ListPortfolios can show figures that
// reconcile with broker equity instead of recomputing from marketdata mid-quotes.
func (r *PortfolioRepo) UpsertPositionFromSync(ctx context.Context, userID, symbol, tradingMode, accountID string, qty, avgCost float64, val PositionValuation) error {
	costBasis := qty * avgCost
	const q = `
		INSERT INTO portfolio.positions (user_id, symbol, qty, avg_entry_price, cost_basis, trading_mode, account_id, current_price, market_value, unrealized_pnl, unrealized_pnl_pct, day_pnl, day_pnl_pct, opened_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
		ON CONFLICT (user_id, symbol, trading_mode, account_id) DO UPDATE
		SET qty=$3, avg_entry_price=$4, cost_basis=$5, current_price=$8, market_value=$9, unrealized_pnl=$10, unrealized_pnl_pct=$11, day_pnl=$12, day_pnl_pct=$13, updated_at=NOW()`
	_, err := r.pool.Exec(ctx, q, userID, symbol, qty, avgCost, costBasis, tradingMode, accountID,
		val.CurrentPrice, val.MarketValue, val.UnrealizedPnl, val.UnrealizedPnlPct, val.DayPnl, val.DayPnlPct)
	return err
}

// DeletePositionsNotInSync reconciles an account against a broker snapshot: it
// deletes every position row for the account that is not (userID, symbol-in-snapshot).
// This removes both symbols the broker no longer reports AND stale rows left under a
// different user_id (e.g. the legacy "default" placeholder used before user_id was
// carried on the sync event), which would otherwise surface as duplicate positions.
// When presentSymbols is empty, all positions for the account are deleted.
func (r *PortfolioRepo) DeletePositionsNotInSync(ctx context.Context, accountID, userID string, presentSymbols []string) error {
	if len(presentSymbols) == 0 {
		const q = `DELETE FROM portfolio.positions WHERE account_id=$1`
		_, err := r.pool.Exec(ctx, q, accountID)
		return err
	}
	// $1=accountID, $2=userID, $3.. = present symbols.
	args := make([]interface{}, 0, len(presentSymbols)+2)
	args = append(args, accountID, userID)
	placeholders := make([]string, len(presentSymbols))
	for i, s := range presentSymbols {
		args = append(args, s)
		placeholders[i] = fmt.Sprintf("$%d", i+3)
	}
	q := fmt.Sprintf(`DELETE FROM portfolio.positions WHERE account_id=$1 AND (user_id <> $2 OR symbol NOT IN (%s))`,
		joinStrings(placeholders, ","))
	_, err := r.pool.Exec(ctx, q, args...)
	return err
}

func joinStrings(ss []string, sep string) string {
	result := ""
	for i, s := range ss {
		if i > 0 {
			result += sep
		}
		result += s
	}
	return result
}

// AccountBalance is the latest broker-reported balance snapshot for an account.
type AccountBalance struct {
	Cash        float64
	BuyingPower float64
	Equity      float64
	LastEquity  float64
}

// UpsertAccountBalance inserts or updates the latest balance snapshot for an account.
func (r *PortfolioRepo) UpsertAccountBalance(ctx context.Context, accountID, userID, tradingMode string, cash, buyingPower, equity, lastEquity float64) error {
	const q = `
		INSERT INTO portfolio.account_balances (account_id, user_id, trading_mode, cash, buying_power, equity, last_equity, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
		ON CONFLICT (account_id) DO UPDATE
		SET user_id=$2, trading_mode=$3, cash=$4, buying_power=$5, equity=$6, last_equity=$7, updated_at=NOW()`
	_, err := r.pool.Exec(ctx, q, accountID, userID, tradingMode, cash, buyingPower, equity, lastEquity)
	return err
}

// GetAccountBalance returns the latest balance snapshot for an account, or
// (nil, nil) when no balance has been synced yet.
func (r *PortfolioRepo) GetAccountBalance(ctx context.Context, accountID string) (*AccountBalance, error) {
	const q = `
		SELECT cash, buying_power, equity, last_equity
		FROM portfolio.account_balances
		WHERE account_id=$1`
	var b AccountBalance
	err := r.pool.QueryRow(ctx, q, accountID).Scan(&b.Cash, &b.BuyingPower, &b.Equity, &b.LastEquity)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("get account balance: %w", err)
	}
	return &b, nil
}

// UserAccountBalance pairs an account_id with its latest balance snapshot.
type UserAccountBalance struct {
	AccountID string
	Balance   AccountBalance
}

// ListAccountBalancesByUser returns the latest balance snapshot for every account
// owned by a user, ordered by account_id. Used to aggregate the "all accounts"
// portfolio view, where no single account_id is supplied.
func (r *PortfolioRepo) ListAccountBalancesByUser(ctx context.Context, userID string) ([]UserAccountBalance, error) {
	const q = `
		SELECT account_id, cash, buying_power, equity, last_equity
		FROM portfolio.account_balances
		WHERE user_id=$1
		ORDER BY account_id ASC`
	rows, err := r.pool.Query(ctx, q, userID)
	if err != nil {
		return nil, fmt.Errorf("list account balances by user: %w", err)
	}
	defer rows.Close()

	var result []UserAccountBalance
	for rows.Next() {
		var ab UserAccountBalance
		if err := rows.Scan(&ab.AccountID, &ab.Balance.Cash, &ab.Balance.BuyingPower, &ab.Balance.Equity, &ab.Balance.LastEquity); err != nil {
			return nil, fmt.Errorf("scan account balance: %w", err)
		}
		result = append(result, ab)
	}
	return result, rows.Err()
}

// ListPositionsByAccount returns all positions for a given account, optionally filtered by tradingMode.
func (r *PortfolioRepo) ListPositionsByAccount(ctx context.Context, accountID string, tradingMode string) ([]*portfoliov1.Position, error) {
	var (
		rows interface {
			Next() bool
			Scan(dest ...any) error
			Close()
			Err() error
		}
		err error
	)
	if tradingMode == "" {
		q := `
			SELECT ` + positionColumns + `
			FROM portfolio.positions
			WHERE account_id=$1
			ORDER BY symbol ASC`
		rows, err = r.pool.Query(ctx, q, accountID)
	} else {
		q := `
			SELECT ` + positionColumns + `
			FROM portfolio.positions
			WHERE account_id=$1 AND trading_mode=$2
			ORDER BY symbol ASC`
		rows, err = r.pool.Query(ctx, q, accountID, tradingMode)
	}
	if err != nil {
		return nil, fmt.Errorf("list positions by account: %w", err)
	}
	defer rows.Close()

	var positions []*portfoliov1.Position
	for rows.Next() {
		p, err := scanPositionRow(rows)
		if err != nil {
			return nil, err
		}
		positions = append(positions, p)
	}
	return positions, rows.Err()
}
