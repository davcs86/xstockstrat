package repository

import (
	"context"
	"fmt"
	"time"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	portfoliov1 "github.com/xstockstrat/contracts/gen/go/portfolio/v1"
	"github.com/jackc/pgx/v5/pgxpool"
	"google.golang.org/protobuf/types/known/timestamppb"
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
func (r *PortfolioRepo) UpsertPosition(ctx context.Context, userID, symbol string, qty, avgEntry, costBasis float64, mode commonv1.TradingMode) error {
	const q = `
		INSERT INTO portfolio.positions (user_id, symbol, qty, avg_entry_price, cost_basis, trading_mode, opened_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
		ON CONFLICT (user_id, symbol, trading_mode) DO UPDATE
		SET qty=$3, avg_entry_price=$4, cost_basis=$5, updated_at=NOW()`
	_, err := r.pool.Exec(ctx, q, userID, symbol, qty, avgEntry, costBasis, mode.String())
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
		SELECT symbol, qty, avg_entry_price, cost_basis, opened_at, trading_mode
		FROM portfolio.positions
		WHERE user_id=$1 AND symbol=$2 AND trading_mode=$3`
	row := r.pool.QueryRow(ctx, q, userID, symbol, mode.String())
	return scanPositionRow(row)
}

// ListPositions returns paginated positions for a user, optionally filtered by mode.
func (r *PortfolioRepo) ListPositions(ctx context.Context, userID string, mode commonv1.TradingMode, pageSize int, pageToken string) ([]*portfoliov1.Position, string, error) {
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
		const q = `
			SELECT symbol, qty, avg_entry_price, cost_basis, opened_at, trading_mode
			FROM portfolio.positions
			WHERE user_id=$1 AND ($2='' OR symbol > $2)
			ORDER BY symbol ASC LIMIT $3`
		rows, err = r.pool.Query(ctx, q, userID, pageToken, pageSize+1)
	} else {
		const q = `
			SELECT symbol, qty, avg_entry_price, cost_basis, opened_at, trading_mode
			FROM portfolio.positions
			WHERE user_id=$1 AND trading_mode=$2 AND ($3='' OR symbol > $3)
			ORDER BY symbol ASC LIMIT $4`
		rows, err = r.pool.Query(ctx, q, userID, mode.String(), pageToken, pageSize+1)
	}
	if err != nil {
		return nil, "", fmt.Errorf("list positions: %w", err)
	}
	defer rows.Close()

	var positions []*portfoliov1.Position
	for rows.Next() {
		var (
			symbol, modeStr        string
			qty, avgEntry, costBasis float64
			openedAt               time.Time
		)
		if err := rows.Scan(&symbol, &qty, &avgEntry, &costBasis, &openedAt, &modeStr); err != nil {
			return nil, "", fmt.Errorf("scan position: %w", err)
		}
		positions = append(positions, &portfoliov1.Position{
			Symbol:        symbol,
			Qty:           qty,
			AvgEntryPrice: avgEntry,
			CostBasis:     costBasis,
			OpenedAt:      timestamppb.New(openedAt),
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
		symbol, modeStr        string
		qty, avgEntry, costBasis float64
		openedAt               time.Time
	)
	if err := row.Scan(&symbol, &qty, &avgEntry, &costBasis, &openedAt, &modeStr); err != nil {
		return nil, fmt.Errorf("scan position: %w", err)
	}
	return &portfoliov1.Position{
		Symbol:        symbol,
		Qty:           qty,
		AvgEntryPrice: avgEntry,
		CostBasis:     costBasis,
		OpenedAt:      timestamppb.New(openedAt),
	}, nil
}
