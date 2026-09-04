package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/xstockstrat/contracts/pnl"
)

// BaselineRow is a single position row from a brokerage statement baseline snapshot.
type BaselineRow struct {
	Symbol          string
	Qty             float64
	AvgCostPerShare float64
}

// UpsertBaselineSnapshot atomically replaces all baseline rows for (accountID, clientSnapshotID)
// in one transaction — a re-submit that drops a symbol removes it (replace, not ON CONFLICT).
func (r *TradingRepo) UpsertBaselineSnapshot(ctx context.Context, accountID, clientSnapshotID string, asOf time.Time, rows []BaselineRow) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // best-effort on error path

	_, err = tx.Exec(ctx, `
		DELETE FROM trading.offline_position_baselines
		WHERE account_id = $1 AND client_snapshot_id = $2
	`, accountID, clientSnapshotID)
	if err != nil {
		return fmt.Errorf("delete existing baseline: %w", err)
	}

	for _, row := range rows {
		_, err = tx.Exec(ctx, `
			INSERT INTO trading.offline_position_baselines
				(account_id, client_snapshot_id, as_of, symbol, qty, avg_cost_per_share)
			VALUES ($1, $2, $3, $4, $5, $6)
		`, accountID, clientSnapshotID, asOf, row.Symbol, row.Qty, row.AvgCostPerShare)
		if err != nil {
			return fmt.Errorf("insert baseline row %s: %w", row.Symbol, err)
		}
	}

	return tx.Commit(ctx)
}

// EffectiveBaselineByAccount returns the effective baseline (rows of greatest as_of; qty=0 rows
// dropped as flatten phantoms). ok=false when no baseline rows exist.
func (r *TradingRepo) EffectiveBaselineByAccount(ctx context.Context, accountID string) (asOf time.Time, lots map[string]pnl.Lot, ok bool, err error) {
	rows, err := r.db.Query(ctx, `
		SELECT as_of, symbol, qty, avg_cost_per_share
		FROM trading.offline_position_baselines
		WHERE account_id = $1
		  AND (as_of, created_at) = (
		      SELECT as_of, max(created_at)
		      FROM trading.offline_position_baselines
		      WHERE account_id = $1
		      GROUP BY as_of
		      ORDER BY as_of DESC, max(created_at) DESC
		      LIMIT 1
		  )
	`, accountID)
	if err != nil {
		return time.Time{}, nil, false, fmt.Errorf("query effective baseline: %w", err)
	}
	defer rows.Close()

	lots = make(map[string]pnl.Lot)
	for rows.Next() {
		var (
			rowAsOf      time.Time
			symbol       string
			qty, avgCost float64
		)
		if err := rows.Scan(&rowAsOf, &symbol, &qty, &avgCost); err != nil {
			return time.Time{}, nil, false, fmt.Errorf("scan baseline row: %w", err)
		}
		asOf = rowAsOf
		// Drop qty=0 rows — a zero seed must never reach Positions as a phantom.
		if qty == 0 {
			continue
		}
		lots[symbol] = pnl.Lot{Qty: qty, CostBasis: qty * avgCost}
	}
	if err := rows.Err(); err != nil {
		return time.Time{}, nil, false, fmt.Errorf("rows iteration: %w", err)
	}

	if len(lots) == 0 && asOf.IsZero() {
		return time.Time{}, nil, false, nil
	}

	return asOf, lots, true, nil
}

// DeleteBaselinesByAccount removes all baseline rows for an account (deregister purge).
func (r *TradingRepo) DeleteBaselinesByAccount(ctx context.Context, accountID string) error {
	_, err := r.pool.Exec(ctx, `
		DELETE FROM trading.offline_position_baselines WHERE account_id = $1
	`, accountID)
	return err
}

// HasUnconfirmedOfflineOrders returns true if any NEW (unconfirmed) offline order exists for
// the account (SnapshotOfflinePositions uses it to emit a warning).
func (r *TradingRepo) HasUnconfirmedOfflineOrders(ctx context.Context, accountID string) (bool, error) {
	var count int
	err := r.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM trading.orders
		WHERE account_id = $1 AND status = 'new'
	`, accountID).Scan(&count)
	if err != nil {
		return false, fmt.Errorf("count unconfirmed orders: %w", err)
	}
	return count > 0, nil
}
