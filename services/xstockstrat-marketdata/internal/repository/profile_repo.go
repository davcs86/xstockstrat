package repository

import (
	"context"
	"fmt"
	"time"
)

// profileDB is the pool subset ProfileRepo needs (pgxmock-substitutable).
type profileDB interface {
	execer
}

// FlaggedRow is one flagged-delisted symbol; FirstUnservableDate is YYYY-MM-DD.
type FlaggedRow struct {
	Symbol              string
	FirstUnservableDate string
	Reason              int16
	AlertClaimed        bool
	AlertAcked          bool
}

// ClaimedRow is a row whose alert this call claimed; Reclaim = it had been claimed before.
type ClaimedRow struct {
	FlaggedRow
	Reclaim bool
}

// RecoveredRow is a symbol whose flag was cleared; AlertClaimed is its state before the clear.
type RecoveredRow struct {
	Symbol       string
	AlertClaimed bool
}

// SymbolReason pairs a symbol with its common.v1.UnservableReason number.
type SymbolReason struct {
	Symbol string
	Reason int16
}

// ProfileRepo reads/writes marketdata.symbol_profile and marketdata.watched_symbol on the shared
// pool. Every method is autocommitted statements only: PgBouncer keeps no session state between them.
type ProfileRepo struct {
	db profileDB
}

// NewProfileRepo shares the MarketDataRepo pool so the DB connection budget is unchanged.
func NewProfileRepo(r *MarketDataRepo) *ProfileRepo {
	return &ProfileRepo{db: r.pool}
}

func (r *ProfileRepo) queryStrings(ctx context.Context, what, sql string, args ...any) ([]string, error) {
	rows, err := r.db.Query(ctx, sql, args...)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", what, err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			return nil, fmt.Errorf("%s: scan: %w", what, err)
		}
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("%s: %w", what, err)
	}
	return out, nil
}

func (r *ProfileRepo) exec(ctx context.Context, what, sql string, args ...any) (int64, error) {
	tag, err := r.db.Exec(ctx, sql, args...)
	if err != nil {
		return 0, fmt.Errorf("%s: %w", what, err)
	}
	return tag.RowsAffected(), nil
}

// Candidates returns the watched symbols plus every symbol with a first-unservable date, sorted,
// and the number of watched symbols.
func (r *ProfileRepo) Candidates(ctx context.Context) ([]string, int, error) {
	rows, err := r.db.Query(ctx, `SELECT symbol, bool_or(watched) FROM (
			SELECT symbol, true AS watched FROM marketdata.watched_symbol
			UNION ALL
			SELECT symbol, false FROM marketdata.symbol_profile WHERE first_unservable_date IS NOT NULL
		) u GROUP BY symbol ORDER BY symbol`)
	if err != nil {
		return nil, 0, fmt.Errorf("delisting candidates: %w", err)
	}
	defer rows.Close()
	var (
		symbols []string
		watched int
	)
	for rows.Next() {
		var (
			s string
			w bool
		)
		if err := rows.Scan(&s, &w); err != nil {
			return nil, 0, fmt.Errorf("delisting candidates: scan: %w", err)
		}
		symbols = append(symbols, s)
		if w {
			watched++
		}
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("delisting candidates: %w", err)
	}
	return symbols, watched, nil
}

// ResetServable clears the first-unservable date of unflagged started rows among servable.
func (r *ProfileRepo) ResetServable(ctx context.Context, servable []string) (int64, error) {
	if len(servable) == 0 {
		return 0, nil
	}
	return r.exec(ctx, "reset servable profiles", `WITH t AS (
			SELECT symbol FROM marketdata.symbol_profile
			WHERE delisted_at IS NULL AND first_unservable_date IS NOT NULL AND symbol = ANY($1)
			ORDER BY symbol FOR UPDATE)
		UPDATE marketdata.symbol_profile p
		SET first_unservable_date = NULL, unservable_reason = NULL, updated_at = now()
		FROM t WHERE p.symbol = t.symbol AND p.delisted_at IS NULL AND p.first_unservable_date IS NOT NULL`, servable)
}

// ResetUnwatched clears unflagged started rows whose symbol left the union. An empty union resets
// nothing: an unsynced or cleared union must not erase running windows.
func (r *ProfileRepo) ResetUnwatched(ctx context.Context) (int64, error) {
	return r.exec(ctx, "reset unwatched profiles", `WITH t AS (
			SELECT p.symbol FROM marketdata.symbol_profile p
			WHERE p.delisted_at IS NULL AND p.first_unservable_date IS NOT NULL
			  AND EXISTS (SELECT 1 FROM marketdata.watched_symbol)
			  AND NOT EXISTS (SELECT 1 FROM marketdata.watched_symbol w WHERE w.symbol = p.symbol)
			ORDER BY p.symbol FOR UPDATE OF p)
		UPDATE marketdata.symbol_profile p
		SET first_unservable_date = NULL, unservable_reason = NULL, updated_at = now()
		FROM t WHERE p.symbol = t.symbol AND p.delisted_at IS NULL AND p.first_unservable_date IS NOT NULL`)
}

// Start records day (YYYY-MM-DD) as the first-unservable date of each watched symbol given; a
// started or flagged row is left as is. Symbols must be distinct.
func (r *ProfileRepo) Start(ctx context.Context, day string, unservable []SymbolReason) (int64, error) {
	if len(unservable) == 0 {
		return 0, nil
	}
	symbols := make([]string, len(unservable))
	reasons := make([]int16, len(unservable))
	for i, u := range unservable {
		symbols[i], reasons[i] = u.Symbol, u.Reason
	}
	return r.exec(ctx, "start unservable profiles", `INSERT INTO marketdata.symbol_profile (symbol, first_unservable_date, unservable_reason)
		SELECT u.symbol, $3::date, u.reason
		FROM unnest($1::text[], $2::smallint[]) AS u(symbol, reason)
		JOIN marketdata.watched_symbol w ON w.symbol = u.symbol
		ORDER BY u.symbol
		ON CONFLICT (symbol) DO UPDATE
		SET first_unservable_date = EXCLUDED.first_unservable_date, unservable_reason = EXCLUDED.unservable_reason, updated_at = now()
		WHERE symbol_profile.first_unservable_date IS NULL`, symbols, reasons, day)
}

// Flag marks as delisted the watched, unflagged rows among unservable whose first-unservable date
// is on or before cutoff (YYYY-MM-DD), and returns their symbols.
func (r *ProfileRepo) Flag(ctx context.Context, cutoff string, unservable []string) ([]string, error) {
	if len(unservable) == 0 {
		return nil, nil
	}
	return r.queryStrings(ctx, "flag delisted profiles", `WITH t AS (
			SELECT p.symbol FROM marketdata.symbol_profile p
			WHERE p.delisted_at IS NULL AND p.first_unservable_date <= $1::date AND p.symbol = ANY($2)
			  AND EXISTS (SELECT 1 FROM marketdata.watched_symbol w WHERE w.symbol = p.symbol)
			ORDER BY p.symbol FOR UPDATE OF p)
		UPDATE marketdata.symbol_profile p SET delisted_at = now(), updated_at = now()
		FROM t WHERE p.symbol = t.symbol AND p.delisted_at IS NULL AND p.first_unservable_date <= $1::date
		RETURNING p.symbol`, cutoff, unservable)
}

// Recover clears every state column of the flagged rows among servable.
func (r *ProfileRepo) Recover(ctx context.Context, servable []string) ([]RecoveredRow, error) {
	if len(servable) == 0 {
		return nil, nil
	}
	rows, err := r.db.Query(ctx, `WITH t AS (
			SELECT symbol, alert_claimed_at IS NOT NULL AS claimed FROM marketdata.symbol_profile
			WHERE delisted_at IS NOT NULL AND symbol = ANY($1)
			ORDER BY symbol FOR UPDATE)
		UPDATE marketdata.symbol_profile p
		SET first_unservable_date = NULL, unservable_reason = NULL, delisted_at = NULL, alert_claimed_at = NULL, alert_acked_at = NULL, updated_at = now()
		FROM t WHERE p.symbol = t.symbol AND p.delisted_at IS NOT NULL
		RETURNING p.symbol, t.claimed`, servable)
	if err != nil {
		return nil, fmt.Errorf("recover delisted profiles: %w", err)
	}
	defer rows.Close()
	var out []RecoveredRow
	for rows.Next() {
		var row RecoveredRow
		if err := rows.Scan(&row.Symbol, &row.AlertClaimed); err != nil {
			return nil, fmt.Errorf("recover delisted profiles: scan: %w", err)
		}
		out = append(out, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("recover delisted profiles: %w", err)
	}
	return out, nil
}

// FlaggedSymbols returns every flagged-delisted symbol.
func (r *ProfileRepo) FlaggedSymbols(ctx context.Context) ([]string, error) {
	return r.queryStrings(ctx, "flagged symbols", `SELECT symbol FROM marketdata.symbol_profile WHERE delisted_at IS NOT NULL ORDER BY symbol`)
}

// ReplaceWatched makes marketdata.watched_symbol equal to symbols; an empty slice clears it.
func (r *ProfileRepo) ReplaceWatched(ctx context.Context, symbols []string) error {
	if symbols == nil {
		symbols = []string{}
	}
	if _, err := r.exec(ctx, "replace watched symbols: insert", `INSERT INTO marketdata.watched_symbol (symbol)
		SELECT DISTINCT s FROM unnest($1::text[]) AS s
		WHERE NOT EXISTS (SELECT 1 FROM marketdata.watched_symbol w WHERE w.symbol = s)
		ORDER BY s
		ON CONFLICT (symbol) DO NOTHING`, symbols); err != nil {
		return err
	}
	_, err := r.exec(ctx, "replace watched symbols: delete", `DELETE FROM marketdata.watched_symbol w
		WHERE NOT EXISTS (SELECT 1 FROM unnest($1::text[]) AS s WHERE s = w.symbol)`, symbols)
	return err
}

const claimablePredicate = `delisted_at IS NOT NULL AND alert_acked_at IS NULL
	AND (alert_claimed_at IS NULL OR alert_claimed_at < now() - make_interval(secs => %s))`

// ClaimableSymbols returns flagged symbols whose alert is unacknowledged and unclaimed or claimed
// longer ago than lease.
func (r *ProfileRepo) ClaimableSymbols(ctx context.Context, lease time.Duration) ([]string, error) {
	return r.queryStrings(ctx, "claimable delisting alerts",
		`SELECT symbol FROM marketdata.symbol_profile WHERE `+fmt.Sprintf(claimablePredicate, "$1")+` ORDER BY symbol`,
		lease.Seconds())
}

// ClaimAlerts claims at most limit claimable alerts among symbols; rows locked by another claimer
// are skipped, never waited on.
func (r *ProfileRepo) ClaimAlerts(ctx context.Context, symbols []string, lease time.Duration, limit int) ([]ClaimedRow, error) {
	if len(symbols) == 0 {
		return nil, nil
	}
	rows, err := r.db.Query(ctx, `WITH t AS (
			SELECT symbol, alert_claimed_at IS NOT NULL AS reclaim FROM marketdata.symbol_profile
			WHERE `+fmt.Sprintf(claimablePredicate, "$2")+` AND symbol = ANY($1)
			ORDER BY symbol LIMIT $3 FOR UPDATE SKIP LOCKED)
		UPDATE marketdata.symbol_profile p SET alert_claimed_at = now(), updated_at = now()
		FROM t WHERE p.symbol = t.symbol AND p.delisted_at IS NOT NULL AND p.alert_acked_at IS NULL
		RETURNING p.symbol, p.first_unservable_date::text, p.unservable_reason, t.reclaim`,
		symbols, lease.Seconds(), limit)
	if err != nil {
		return nil, fmt.Errorf("claim delisting alerts: %w", err)
	}
	defer rows.Close()
	var out []ClaimedRow
	for rows.Next() {
		row := ClaimedRow{FlaggedRow: FlaggedRow{AlertClaimed: true}}
		if err := rows.Scan(&row.Symbol, &row.FirstUnservableDate, &row.Reason, &row.Reclaim); err != nil {
			return nil, fmt.Errorf("claim delisting alerts: scan: %w", err)
		}
		out = append(out, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("claim delisting alerts: %w", err)
	}
	return out, nil
}

// FlaggedIn returns the flagged rows among symbols.
func (r *ProfileRepo) FlaggedIn(ctx context.Context, symbols []string) ([]FlaggedRow, error) {
	if len(symbols) == 0 {
		return nil, nil
	}
	rows, err := r.db.Query(ctx, `SELECT symbol, first_unservable_date::text, unservable_reason,
			alert_claimed_at IS NOT NULL, alert_acked_at IS NOT NULL
		FROM marketdata.symbol_profile
		WHERE delisted_at IS NOT NULL AND symbol = ANY($1)
		ORDER BY symbol`, symbols)
	if err != nil {
		return nil, fmt.Errorf("flagged profiles: %w", err)
	}
	defer rows.Close()
	var out []FlaggedRow
	for rows.Next() {
		var row FlaggedRow
		if err := rows.Scan(&row.Symbol, &row.FirstUnservableDate, &row.Reason, &row.AlertClaimed, &row.AlertAcked); err != nil {
			return nil, fmt.Errorf("flagged profiles: scan: %w", err)
		}
		out = append(out, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("flagged profiles: %w", err)
	}
	return out, nil
}

// AckAlerts acknowledges the claimed, unacknowledged alerts of the flagged rows among symbols.
func (r *ProfileRepo) AckAlerts(ctx context.Context, symbols []string) (int64, error) {
	if len(symbols) == 0 {
		return 0, nil
	}
	return r.exec(ctx, "ack delisting alerts", `WITH t AS (
			SELECT symbol FROM marketdata.symbol_profile
			WHERE delisted_at IS NOT NULL AND alert_claimed_at IS NOT NULL AND alert_acked_at IS NULL AND symbol = ANY($1)
			ORDER BY symbol FOR UPDATE)
		UPDATE marketdata.symbol_profile p SET alert_acked_at = now(), updated_at = now()
		FROM t WHERE p.symbol = t.symbol AND p.delisted_at IS NOT NULL AND p.alert_claimed_at IS NOT NULL AND p.alert_acked_at IS NULL`, symbols)
}
