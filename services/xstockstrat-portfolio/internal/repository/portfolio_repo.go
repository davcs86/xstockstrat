package repository

import (
	"context"
	"errors"
	"fmt"
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
	pool, err := pgxpool.New(context.Background(), connStr)
	if err != nil {
		return nil, fmt.Errorf("pgxpool.New: %w", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		return nil, fmt.Errorf("db ping: %w", err)
	}
	return &PortfolioRepo{pool: pool}, nil
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
	const q = `
		SELECT symbol, qty, avg_entry_price, cost_basis, opened_at, trading_mode, account_id
		FROM portfolio.positions
		WHERE user_id=$1 AND symbol=$2 AND trading_mode=$3
		ORDER BY opened_at DESC LIMIT 1`
	row := r.pool.QueryRow(ctx, q, userID, symbol, mode.String())
	return scanPositionRow(row)
}

// ListPositions returns paginated positions for a user, optionally filtered by mode and accountID.
func (r *PortfolioRepo) ListPositions(ctx context.Context, userID string, mode commonv1.TradingMode, pageSize int, pageToken string, accountID string) ([]*portfoliov1.Position, string, error) {
	if pageSize <= 0 || pageSize > 500 {
		pageSize = 100
	}

	var rows interface {
		Next() bool
		Scan(dest ...any) error
		Close()
		Err() error
	}
	var err error

	if mode == commonv1.TradingMode_TRADING_MODE_UNSPECIFIED {
		if accountID == "" {
			const q = `
				SELECT symbol, qty, avg_entry_price, cost_basis, opened_at, trading_mode, account_id
				FROM portfolio.positions
				WHERE user_id=$1 AND ($2='' OR symbol > $2)
				ORDER BY symbol ASC LIMIT $3`
			rows, err = r.pool.Query(ctx, q, userID, pageToken, pageSize+1)
		} else {
			const q = `
				SELECT symbol, qty, avg_entry_price, cost_basis, opened_at, trading_mode, account_id
				FROM portfolio.positions
				WHERE user_id=$1 AND account_id=$2 AND ($3='' OR symbol > $3)
				ORDER BY symbol ASC LIMIT $4`
			rows, err = r.pool.Query(ctx, q, userID, accountID, pageToken, pageSize+1)
		}
	} else {
		if accountID == "" {
			const q = `
				SELECT symbol, qty, avg_entry_price, cost_basis, opened_at, trading_mode, account_id
				FROM portfolio.positions
				WHERE user_id=$1 AND trading_mode=$2 AND ($3='' OR symbol > $3)
				ORDER BY symbol ASC LIMIT $4`
			rows, err = r.pool.Query(ctx, q, userID, mode.String(), pageToken, pageSize+1)
		} else {
			const q = `
				SELECT symbol, qty, avg_entry_price, cost_basis, opened_at, trading_mode, account_id
				FROM portfolio.positions
				WHERE user_id=$1 AND trading_mode=$2 AND account_id=$3 AND ($4='' OR symbol > $4)
				ORDER BY symbol ASC LIMIT $5`
			rows, err = r.pool.Query(ctx, q, userID, mode.String(), accountID, pageToken, pageSize+1)
		}
	}
	if err != nil {
		return nil, "", fmt.Errorf("list positions: %w", err)
	}
	defer rows.Close()

	var positions []*portfoliov1.Position
	for rows.Next() {
		var (
			symbol, modeStr, acctID  string
			qty, avgEntry, costBasis float64
			openedAt                 time.Time
		)
		if err := rows.Scan(&symbol, &qty, &avgEntry, &costBasis, &openedAt, &modeStr, &acctID); err != nil {
			return nil, "", fmt.Errorf("scan position: %w", err)
		}
		positions = append(positions, &portfoliov1.Position{
			Symbol:        symbol,
			Qty:           qty,
			AvgEntryPrice: avgEntry,
			CostBasis:     costBasis,
			OpenedAt:      timestamppb.New(openedAt),
			AccountId:     acctID,
		})
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
		symbol, modeStr, accountID string
		qty, avgEntry, costBasis   float64
		openedAt                   time.Time
	)
	if err := row.Scan(&symbol, &qty, &avgEntry, &costBasis, &openedAt, &modeStr, &accountID); err != nil {
		return nil, fmt.Errorf("scan position: %w", err)
	}
	return &portfoliov1.Position{
		Symbol:        symbol,
		Qty:           qty,
		AvgEntryPrice: avgEntry,
		CostBasis:     costBasis,
		OpenedAt:      timestamppb.New(openedAt),
		AccountId:     accountID,
	}, nil
}

// UpsertPositionFromSync inserts or updates a position from a broker position sync.
// Unlike UpsertPosition, opened_at is never overwritten on conflict. cost_basis is
// the total cost (qty × avg_cost) to match the per-fill path and the P&L math in
// GetPortfolio/ListPortfolios (which compute market_value − cost_basis).
func (r *PortfolioRepo) UpsertPositionFromSync(ctx context.Context, userID, symbol, tradingMode, accountID string, qty, avgCost float64) error {
	costBasis := qty * avgCost
	const q = `
		INSERT INTO portfolio.positions (user_id, symbol, qty, avg_entry_price, cost_basis, trading_mode, account_id, opened_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
		ON CONFLICT (user_id, symbol, trading_mode, account_id) DO UPDATE
		SET qty=$3, avg_entry_price=$4, cost_basis=$5, updated_at=NOW()`
	_, err := r.pool.Exec(ctx, q, userID, symbol, qty, avgCost, costBasis, tradingMode, accountID)
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
		const q = `
			SELECT symbol, qty, avg_entry_price, cost_basis, opened_at, trading_mode, account_id
			FROM portfolio.positions
			WHERE account_id=$1
			ORDER BY symbol ASC`
		rows, err = r.pool.Query(ctx, q, accountID)
	} else {
		const q = `
			SELECT symbol, qty, avg_entry_price, cost_basis, opened_at, trading_mode, account_id
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
