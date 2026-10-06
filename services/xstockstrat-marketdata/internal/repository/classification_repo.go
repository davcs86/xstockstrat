package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/xstockstrat/marketdata/internal/classification"
)

// classificationDB is the pool subset ClassificationRepo needs (pgxmock-substitutable).
type classificationDB interface {
	execer
	Begin(ctx context.Context) (pgx.Tx, error)
}

// ClassificationRow is one Type-2 SCD version of a symbol's sector (feature 217).
type ClassificationRow struct {
	Symbol    string
	Sector    string // stored enum-name text, e.g. "TECHNOLOGY"
	Source    string
	ValidFrom time.Time
	ValidTo   *time.Time // nil = open row
}

// ClassificationRepo reads/writes marketdata.symbol_classification on the shared pool (no new pool).
type ClassificationRepo struct {
	db classificationDB
}

// NewClassificationRepo shares the MarketDataRepo pool so the DB connection budget is unchanged.
func NewClassificationRepo(r *MarketDataRepo) *ClassificationRepo {
	return &ClassificationRepo{db: r.pool}
}

// CurrentSectors returns symbol → open-row sector text for the classified subset of symbols.
func (r *ClassificationRepo) CurrentSectors(ctx context.Context, symbols []string) (map[string]string, error) {
	out := make(map[string]string, len(symbols))
	if len(symbols) == 0 {
		return out, nil
	}
	rows, err := r.db.Query(ctx, `SELECT symbol, sector FROM marketdata.symbol_classification
		WHERE symbol = ANY($1) AND valid_to IS NULL`, symbols)
	if err != nil {
		return nil, fmt.Errorf("current sectors: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var sym, sector string
		if err := rows.Scan(&sym, &sector); err != nil {
			return nil, fmt.Errorf("scan current sector: %w", err)
		}
		out[sym] = sector
	}
	return out, rows.Err()
}

// SectorAsOf returns the sector valid at ts (valid_from inclusive, valid_to exclusive); found=false
// when no version covers ts.
func (r *ClassificationRepo) SectorAsOf(ctx context.Context, symbol string, ts time.Time) (string, bool, error) {
	var sector string
	err := r.db.QueryRow(ctx, `SELECT sector FROM marketdata.symbol_classification
		WHERE symbol = $1 AND valid_from <= $2 AND (valid_to IS NULL OR valid_to > $2)
		ORDER BY valid_from DESC LIMIT 1`, symbol, ts).Scan(&sector)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("sector as-of %s: %w", symbol, err)
	}
	return sector, true, nil
}

// SectorHistory returns every version intersecting [start, end] for the symbols, ordered by
// (symbol, valid_from). A nil bound is unbounded.
func (r *ClassificationRepo) SectorHistory(ctx context.Context, symbols []string, start, end *time.Time) ([]ClassificationRow, error) {
	if len(symbols) == 0 {
		return nil, nil
	}
	rows, err := r.db.Query(ctx, `SELECT symbol, sector, source, valid_from, valid_to
		FROM marketdata.symbol_classification
		WHERE symbol = ANY($1)
		  AND ($2::timestamptz IS NULL OR valid_to IS NULL OR valid_to > $2)
		  AND ($3::timestamptz IS NULL OR valid_from <= $3)
		ORDER BY symbol, valid_from`, symbols, start, end)
	if err != nil {
		return nil, fmt.Errorf("sector history: %w", err)
	}
	defer rows.Close()
	var out []ClassificationRow
	for rows.Next() {
		var row ClassificationRow
		if err := rows.Scan(&row.Symbol, &row.Sector, &row.Source, &row.ValidFrom, &row.ValidTo); err != nil {
			return nil, fmt.Errorf("scan sector history: %w", err)
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

const seedEpochSQL = `INSERT INTO marketdata.symbol_classification
	(symbol, sector, taxonomy, source, valid_from, valid_to)
	VALUES ($1, $2, $3, $4, $5, NULL)
	ON CONFLICT (symbol) WHERE valid_to IS NULL DO NOTHING`

// SeedEpoch inserts an epoch-seed open row unless the symbol already has one; concurrent first
// observations converge on exactly one open row via the partial-unique index.
func (r *ClassificationRepo) SeedEpoch(ctx context.Context, symbol, sector string) (bool, error) {
	tag, err := r.db.Exec(ctx, seedEpochSQL, symbol, sector, classification.TaxonomyGICS, classification.SourceSeed, classification.EpochSentinel)
	if err != nil {
		return false, fmt.Errorf("seed classification %s: %w", symbol, err)
	}
	return tag.RowsAffected() == 1, nil
}

// ApplyObservation runs the refresh job's three-way branch for one symbol in one transaction,
// locking the open row so a concurrent observation cannot double-transition.
func (r *ClassificationRepo) ApplyObservation(ctx context.Context, symbol, sector string, now time.Time) (classification.Action, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return classification.ActionNone, fmt.Errorf("begin classification tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var open string
	err = tx.QueryRow(ctx, `SELECT sector FROM marketdata.symbol_classification
		WHERE symbol = $1 AND valid_to IS NULL FOR UPDATE`, symbol).Scan(&open)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return classification.ActionNone, fmt.Errorf("lock open classification %s: %w", symbol, err)
	}
	action := classification.Decide(open, sector)
	switch action {
	case classification.ActionNone:
		return action, nil
	case classification.ActionSeed:
		if _, err := tx.Exec(ctx, seedEpochSQL, symbol, sector, classification.TaxonomyGICS, classification.SourceSeed, classification.EpochSentinel); err != nil {
			return action, fmt.Errorf("seed classification %s: %w", symbol, err)
		}
	case classification.ActionTransition:
		if _, err := tx.Exec(ctx, `UPDATE marketdata.symbol_classification SET valid_to = $2
			WHERE symbol = $1 AND valid_to IS NULL`, symbol, now); err != nil {
			return action, fmt.Errorf("close classification %s: %w", symbol, err)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO marketdata.symbol_classification
			(symbol, sector, taxonomy, source, valid_from, valid_to) VALUES ($1, $2, $3, $4, $5, NULL)`,
			symbol, sector, classification.TaxonomyGICS, classification.SourceFMP, now); err != nil {
			return action, fmt.Errorf("open classification %s: %w", symbol, err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return action, fmt.Errorf("commit classification %s: %w", symbol, err)
	}
	return action, nil
}
