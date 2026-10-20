package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/xstockstrat/contracts/pnl"
)

// BaselineRow is a single position row from a brokerage statement baseline snapshot.
type BaselineRow struct {
	Symbol          string
	Qty             float64
	AvgCostPerShare float64
}

// SnapshotHeader is one offline snapshot's header: its as_of and the realized P&L / fees carried
// into it; Lots holds the snapshot's non-zero rows when loaded.
type SnapshotHeader struct {
	ClientSnapshotID string
	AsOf             time.Time
	RealizedCarried  float64
	FeesCarried      float64
	Lots             map[string]pnl.Lot
}

// CarryFunc computes the carry for a snapshot at asOf from its predecessor (nil = none). It runs inside
// the upsert transaction, so it must not call back into the baseline store.
type CarryFunc func(pred *SnapshotHeader, asOf time.Time) (realized, fees float64, err error)

// ErrSnapshotAsOfConflict rejects an as_of change on a snapshot that is not the latest, or that would
// move it behind another snapshot.
var ErrSnapshotAsOfConflict = errors.New("snapshot as_of change not allowed")

type storedHeader struct {
	id        string
	asOf      time.Time
	realized  float64
	fees      float64
	createdAt time.Time
}

func headerAfter(a, b storedHeader) bool {
	return a.asOf.After(b.asOf) || (a.asOf.Equal(b.asOf) && a.createdAt.After(b.createdAt))
}

// UpsertBaselineSnapshot writes the header (carry resolved per the snapshot rules) and replaces all
// baseline rows for (accountID, clientSnapshotID) in one transaction. A nil carry carries 0, 0.
func (r *TradingRepo) UpsertBaselineSnapshot(ctx context.Context, accountID, clientSnapshotID string, asOf time.Time, rows []BaselineRow, carry CarryFunc) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // best-effort on error path

	hrows, err := tx.Query(ctx, `
		SELECT client_snapshot_id, as_of, realized_carried, fees_carried, created_at
		FROM trading.offline_snapshot_headers
		WHERE account_id = $1
		FOR UPDATE
	`, accountID)
	if err != nil {
		return fmt.Errorf("lock snapshot headers: %w", err)
	}
	var headers []storedHeader
	for hrows.Next() {
		var h storedHeader
		if err := hrows.Scan(&h.id, &h.asOf, &h.realized, &h.fees, &h.createdAt); err != nil {
			hrows.Close()
			return fmt.Errorf("scan snapshot header: %w", err)
		}
		headers = append(headers, h)
	}
	hrows.Close()
	if err := hrows.Err(); err != nil {
		return fmt.Errorf("snapshot headers iteration: %w", err)
	}

	var own, latest *storedHeader
	for i := range headers {
		h := &headers[i]
		if h.id == clientSnapshotID {
			own = h
		}
		if latest == nil || headerAfter(*h, *latest) {
			latest = h
		}
	}

	var realized, fees float64
	if own != nil && own.asOf.Equal(asOf) {
		realized, fees = own.realized, own.fees
	} else {
		if own != nil {
			if latest.id != own.id {
				return ErrSnapshotAsOfConflict
			}
			for _, h := range headers {
				if h.id != own.id && h.asOf.After(asOf) {
					return ErrSnapshotAsOfConflict
				}
			}
		}
		var pred *storedHeader
		for i := range headers {
			h := &headers[i]
			if h.id == clientSnapshotID || !h.asOf.Before(asOf) {
				continue
			}
			if pred == nil || headerAfter(*h, *pred) {
				pred = h
			}
		}
		if carry != nil {
			var predHdr *SnapshotHeader
			if pred != nil {
				lots, err := snapshotLots(ctx, tx, accountID, pred.id)
				if err != nil {
					return err
				}
				predHdr = &SnapshotHeader{
					ClientSnapshotID: pred.id, AsOf: pred.asOf,
					RealizedCarried: pred.realized, FeesCarried: pred.fees, Lots: lots,
				}
			}
			if realized, fees, err = carry(predHdr, asOf); err != nil {
				return fmt.Errorf("compute snapshot carry: %w", err)
			}
		}
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO trading.offline_snapshot_headers
			(account_id, client_snapshot_id, as_of, realized_carried, fees_carried)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (account_id, client_snapshot_id) DO UPDATE
		SET as_of = EXCLUDED.as_of,
		    realized_carried = EXCLUDED.realized_carried,
		    fees_carried = EXCLUDED.fees_carried
	`, accountID, clientSnapshotID, asOf, realized, fees)
	if err != nil {
		return fmt.Errorf("upsert snapshot header: %w", err)
	}

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

// snapshotLots loads one snapshot's non-zero rows; qty=0 rows are flatten markers, never phantom lots.
func snapshotLots(ctx context.Context, q dbQuerier, accountID, clientSnapshotID string) (map[string]pnl.Lot, error) {
	rows, err := q.Query(ctx, `
		SELECT symbol, qty, avg_cost_per_share
		FROM trading.offline_position_baselines
		WHERE account_id = $1 AND client_snapshot_id = $2 AND qty <> 0
	`, accountID, clientSnapshotID)
	if err != nil {
		return nil, fmt.Errorf("query snapshot rows: %w", err)
	}
	defer rows.Close()

	lots := make(map[string]pnl.Lot)
	for rows.Next() {
		var (
			symbol       string
			qty, avgCost float64
		)
		if err := rows.Scan(&symbol, &qty, &avgCost); err != nil {
			return nil, fmt.Errorf("scan baseline row: %w", err)
		}
		if qty == 0 {
			continue
		}
		lots[symbol] = pnl.Lot{Qty: qty, CostBasis: qty * avgCost}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rows iteration: %w", err)
	}
	return lots, nil
}

// EffectiveBaselineByAccount returns the latest snapshot header (greatest as_of, then created_at) with
// its non-zero rows. A header with no rows is a full flatten (ok=true, empty Lots); ok=false = none.
func (r *TradingRepo) EffectiveBaselineByAccount(ctx context.Context, accountID string) (hdr SnapshotHeader, ok bool, err error) {
	err = r.db.QueryRow(ctx, `
		SELECT client_snapshot_id, as_of, realized_carried, fees_carried
		FROM trading.offline_snapshot_headers
		WHERE account_id = $1
		ORDER BY as_of DESC, created_at DESC LIMIT 1
	`, accountID).Scan(&hdr.ClientSnapshotID, &hdr.AsOf, &hdr.RealizedCarried, &hdr.FeesCarried)
	if errors.Is(err, pgx.ErrNoRows) {
		return SnapshotHeader{}, false, nil
	}
	if err != nil {
		return SnapshotHeader{}, false, fmt.Errorf("query latest snapshot header: %w", err)
	}

	if hdr.Lots, err = snapshotLots(ctx, r.db, accountID, hdr.ClientSnapshotID); err != nil {
		return SnapshotHeader{}, false, err
	}
	return hdr, true, nil
}

// DeleteBaselinesByAccount removes all baseline rows and snapshot headers for an account in one
// transaction (deregister purge).
func (r *TradingRepo) DeleteBaselinesByAccount(ctx context.Context, accountID string) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // best-effort on error path

	if _, err := tx.Exec(ctx, `
		DELETE FROM trading.offline_position_baselines WHERE account_id = $1
	`, accountID); err != nil {
		return fmt.Errorf("delete baseline rows: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		DELETE FROM trading.offline_snapshot_headers WHERE account_id = $1
	`, accountID); err != nil {
		return fmt.Errorf("delete snapshot headers: %w", err)
	}
	return tx.Commit(ctx)
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
