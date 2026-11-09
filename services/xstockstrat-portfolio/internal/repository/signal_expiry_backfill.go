package repository

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrBackfillRefused wraps every refusal RunBackfill returns before its first write.
var ErrBackfillRefused = errors.New("backfill refused")

const (
	BackfillModeReport = "report"
	BackfillModeApply  = "apply"
)

// BackfillOptions configures one backfill-signal-expiry run. ExpectUntracked and ExpectSeedExpired
// are the at-most bounds REPORT printed; APPLY refuses when either is nil or exceeded.
type BackfillOptions struct {
	Mode                               string
	LegacyOwner                        string
	ExpectUntracked, ExpectSeedExpired *int64
}

// BackfillResult counts what APPLY wrote; Report is the full text written to out (both modes).
type BackfillResult struct {
	Seeded, Marked, SkippedChanged int
	Report                         string
}

type backfillClass int

const (
	classOpenEnded backfillClass = iota
	classSeed
	classUntracked
)

type backfillCandidate struct {
	owner, watchlistID, symbol, strategyID string
	class                                  backfillClass
	validUntil                             time.Time
	signalID                               int64
	seedExpired                            bool
	legacyRows, legacyLive                 int64
}

type backfillOwner struct {
	owner                      string
	signalEntries, ownRowTotal int64
}

// ownWatchlistSignals matches the owner's watchlist-direction ingest rows for binding s of list w;
// ingest stores symbols as supplied, hence the normalization.
const ownWatchlistSignals = `ingest.newsletter_signals n
	WHERE n.user_id = w.user_id AND lower(n.direction) = 'watchlist' AND upper(btrim(n.symbol)) = s.symbol`

const backfillCandidatesSQL = `
SELECT w.user_id, s.watchlist_id::text, s.symbol, s.strategy_id,
       o.own_rows, COALESCE(o.open_ended, false),
       m.valid_until, m.id, COALESCE(m.valid_until <= now(), false),
       l.legacy_rows, l.legacy_live
FROM portfolio.watchlist_symbols s
JOIN portfolio.watchlists w ON w.watchlist_id = s.watchlist_id AND w.system_managed
CROSS JOIN LATERAL (
  SELECT count(*) AS own_rows, bool_or(n.valid_until IS NULL) AS open_ended FROM ` + ownWatchlistSignals + `
) o
LEFT JOIN LATERAL (
  SELECT n.valid_until, n.id FROM ` + ownWatchlistSignals + ` AND n.valid_until IS NOT NULL
  ORDER BY n.valid_until DESC, n.id DESC LIMIT 1
) m ON true
CROSS JOIN LATERAL (
  SELECT count(*) AS legacy_rows,
         count(*) FILTER (WHERE n.valid_until IS NULL OR n.valid_until > now()) AS legacy_live
  FROM ingest.newsletter_signals n
  WHERE n.user_id = $1 AND lower(n.direction) = 'watchlist' AND upper(btrim(n.symbol)) = s.symbol
) l
WHERE s.source = 2
  AND NOT EXISTS (SELECT 1 FROM portfolio.watchlist_signal_expiry e
                  WHERE e.watchlist_id = s.watchlist_id AND e.symbol = s.symbol)
ORDER BY s.watchlist_id, s.symbol`

const backfillOwnersSQL = `
SELECT w.user_id, count(*),
       (SELECT count(*) FROM ingest.newsletter_signals n
        WHERE n.user_id = w.user_id AND lower(n.direction) = 'watchlist')
FROM portfolio.watchlist_symbols s
JOIN portfolio.watchlists w ON w.watchlist_id = s.watchlist_id AND w.system_managed
WHERE s.source = 2
GROUP BY w.user_id
ORDER BY w.user_id`

// The APPLY statements recompute the class from ingest at statement time; zero rows inserted means
// the binding left the class REPORT named (or gained an expiry row) and is counted as changed.
const backfillSeedSQL = `
INSERT INTO portfolio.watchlist_signal_expiry (watchlist_id, symbol, valid_until, signal_id)
SELECT s.watchlist_id, s.symbol, m.valid_until, m.id
FROM portfolio.watchlist_symbols s
JOIN portfolio.watchlists w ON w.watchlist_id = s.watchlist_id AND w.system_managed
CROSS JOIN LATERAL (
  SELECT n.valid_until, n.id FROM ` + ownWatchlistSignals + ` AND n.valid_until IS NOT NULL
  ORDER BY n.valid_until DESC, n.id DESC LIMIT 1
) m
WHERE s.watchlist_id = $1 AND s.symbol = $2 AND s.source = 2
  AND NOT EXISTS (SELECT 1 FROM ` + ownWatchlistSignals + ` AND n.valid_until IS NULL)
ON CONFLICT DO NOTHING`

const backfillMarkSQL = `
INSERT INTO portfolio.watchlist_signal_expiry (watchlist_id, symbol, valid_until, signal_id)
SELECT s.watchlist_id, s.symbol, now(), NULL
FROM portfolio.watchlist_symbols s
JOIN portfolio.watchlists w ON w.watchlist_id = s.watchlist_id AND w.system_managed
WHERE s.watchlist_id = $1 AND s.symbol = $2 AND s.source = 2
  AND NOT EXISTS (SELECT 1 FROM ` + ownWatchlistSignals + `)
ON CONFLICT DO NOTHING`

// RunBackfill seeds expiry rows for legacy SIGNAL entries (REPORT reads only; APPLY inserts one
// autocommit row at a time). It never deletes a binding: marked entries are removed by the prune tick.
func RunBackfill(ctx context.Context, pool *pgxpool.Pool, opts BackfillOptions, out io.Writer) (res BackfillResult, err error) {
	if err := validateBackfillOptions(opts); err != nil {
		return res, err
	}
	if out == nil {
		out = io.Discard
	}
	var buf strings.Builder
	w := io.MultiWriter(out, &buf)
	defer func() { res.Report = buf.String() }()

	cands, owners, err := readBackfillState(ctx, pool, opts.LegacyOwner)
	if err != nil {
		return res, err
	}
	untracked, seedExpired := countBackfill(cands)

	if opts.Mode == BackfillModeReport {
		writeBackfillReport(w, opts.LegacyOwner, cands, owners, untracked, seedExpired)
		return res, nil
	}

	printTo(w, "backfill-signal-expiry mode=apply legacy_owner=%s expect_untracked=%d expect_seed_expired=%d\n",
		opts.LegacyOwner, *opts.ExpectUntracked, *opts.ExpectSeedExpired)
	printTo(w, "live untracked=%d seed_expired=%d\n", untracked, seedExpired)
	if untracked > *opts.ExpectUntracked || seedExpired > *opts.ExpectSeedExpired {
		printTo(w, "REFUSED: live counts exceed the approved bounds; nothing written\n")
		return res, fmt.Errorf("%w: untracked %d (approved %d), seed_expired %d (approved %d)",
			ErrBackfillRefused, untracked, *opts.ExpectUntracked, seedExpired, *opts.ExpectSeedExpired)
	}

	printTo(w, "RESULT\twatchlist_id\tsymbol\toutcome\n")
	for _, c := range cands {
		var stmt, outcome string
		switch c.class {
		case classSeed:
			stmt, outcome = backfillSeedSQL, "seeded"
		case classUntracked:
			stmt, outcome = backfillMarkSQL, "marked"
		default:
			continue
		}
		tag, err := pool.Exec(ctx, stmt, c.watchlistID, c.symbol)
		if err != nil {
			printTo(w, "ABORTED seeded=%d marked=%d changed_since_report=%d (re-run is idempotent)\n",
				res.Seeded, res.Marked, res.SkippedChanged)
			return res, fmt.Errorf("apply %s %s: %w", c.watchlistID, c.symbol, err)
		}
		switch {
		case tag.RowsAffected() == 0:
			res.SkippedChanged++
			outcome = "changed since REPORT"
		case c.class == classSeed:
			res.Seeded++
		default:
			res.Marked++
		}
		printTo(w, "RESULT\t%s\t%s\t%s\n", c.watchlistID, c.symbol, outcome)
	}
	printTo(w, "DONE seeded=%d marked=%d changed_since_report=%d\n", res.Seeded, res.Marked, res.SkippedChanged)
	return res, nil
}

func validateBackfillOptions(opts BackfillOptions) error {
	if opts.Mode != BackfillModeReport && opts.Mode != BackfillModeApply {
		return fmt.Errorf("%w: --mode must be %q or %q, got %q", ErrBackfillRefused, BackfillModeReport, BackfillModeApply, opts.Mode)
	}
	if strings.TrimSpace(opts.LegacyOwner) == "" {
		return fmt.Errorf("%w: --legacy-owner is required", ErrBackfillRefused)
	}
	if opts.Mode == BackfillModeApply && (opts.ExpectUntracked == nil || opts.ExpectSeedExpired == nil) {
		return fmt.Errorf("%w: apply requires --expect-untracked and --expect-seed-expired from REPORT", ErrBackfillRefused)
	}
	return nil
}

// readBackfillState reads candidates and per-owner totals in one read-only snapshot (no locks).
func readBackfillState(ctx context.Context, pool *pgxpool.Pool, legacyOwner string) ([]backfillCandidate, []backfillOwner, error) {
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, nil, fmt.Errorf("begin read-only: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	rows, err := tx.Query(ctx, backfillCandidatesSQL, legacyOwner)
	if err != nil {
		return nil, nil, fmt.Errorf("query candidates: %w", err)
	}
	var cands []backfillCandidate
	for rows.Next() {
		var (
			c         backfillCandidate
			ownRows   int64
			openEnded bool
			vu        *time.Time
			sid       *int64
		)
		if err := rows.Scan(&c.owner, &c.watchlistID, &c.symbol, &c.strategyID, &ownRows, &openEnded,
			&vu, &sid, &c.seedExpired, &c.legacyRows, &c.legacyLive); err != nil {
			rows.Close()
			return nil, nil, fmt.Errorf("scan candidate: %w", err)
		}
		switch {
		case openEnded:
			c.class = classOpenEnded
		case ownRows == 0 || vu == nil || sid == nil:
			c.class = classUntracked
		default:
			c.class, c.validUntil, c.signalID = classSeed, *vu, *sid
		}
		cands = append(cands, c)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, nil, fmt.Errorf("candidates rows: %w", err)
	}

	orows, err := tx.Query(ctx, backfillOwnersSQL)
	if err != nil {
		return nil, nil, fmt.Errorf("query owners: %w", err)
	}
	var owners []backfillOwner
	for orows.Next() {
		var o backfillOwner
		if err := orows.Scan(&o.owner, &o.signalEntries, &o.ownRowTotal); err != nil {
			orows.Close()
			return nil, nil, fmt.Errorf("scan owner: %w", err)
		}
		owners = append(owners, o)
	}
	orows.Close()
	if err := orows.Err(); err != nil {
		return nil, nil, fmt.Errorf("owners rows: %w", err)
	}
	return cands, owners, nil
}

func countBackfill(cands []backfillCandidate) (untracked, seedExpired int64) {
	for _, c := range cands {
		switch {
		case c.class == classUntracked:
			untracked++
		case c.class == classSeed && c.seedExpired:
			seedExpired++
		}
	}
	return untracked, seedExpired
}

func yn(b bool) string {
	if b {
		return "Y"
	}
	return "N"
}

// printTo writes operator output; a failed stdout write must not abort an APPLY mid-run.
func printTo(w io.Writer, format string, a ...any) {
	_, _ = fmt.Fprintf(w, format, a...)
}

func writeBackfillReport(w io.Writer, legacyOwner string, cands []backfillCandidate, owners []backfillOwner, untracked, seedExpired int64) {
	printTo(w, "backfill-signal-expiry mode=report legacy_owner=%s (read-only)\n", legacyOwner)

	type ownerCounts struct{ seed, seedExpired, untracked int64 }
	per := map[string]*ownerCounts{}
	at := func(o string) *ownerCounts {
		if per[o] == nil {
			per[o] = &ownerCounts{}
		}
		return per[o]
	}
	var seeds, openEnded, withLiveLegacy int64

	printTo(w, "SEED\towner\twatchlist_id\tsymbol\tvalid_until\tsignal_id\tseed_expired\n")
	for _, c := range cands {
		if c.class != classSeed {
			continue
		}
		seeds++
		pc := at(c.owner)
		pc.seed++
		if c.seedExpired {
			pc.seedExpired++
		}
		printTo(w, "SEED\t%s\t%s\t%s\t%s\t%d\t%s\n", c.owner, c.watchlistID, c.symbol,
			c.validUntil.UTC().Format(time.RFC3339), c.signalID, yn(c.seedExpired))
	}

	printTo(w, "UNTRACKED\towner\twatchlist_id\tsymbol\tstrategy_id\tlegacy_rows\tlegacy_live\n")
	for _, c := range cands {
		switch c.class {
		case classOpenEnded:
			openEnded++
			continue
		case classSeed:
			continue
		}
		at(c.owner).untracked++
		if c.legacyLive > 0 {
			withLiveLegacy++
		}
		printTo(w, "UNTRACKED\t%s\t%s\t%s\t%s\t%d\t%s\n", c.owner, c.watchlistID, c.symbol, c.strategyID,
			c.legacyRows, yn(c.legacyLive > 0))
	}
	printTo(w, "with_live_legacy_signal=%d\n", withLiveLegacy)

	printTo(w, "PER-OWNER\towner\tsignal_entries\tseed\tseed_expired\tuntracked\town_signal_rows_total\tflag\n")
	for _, o := range owners {
		pc := at(o.owner)
		flag := ""
		if o.ownRowTotal == 0 {
			flag = "NO_OWN_SIGNALS"
		}
		printTo(w, "PER-OWNER\t%s\t%d\t%d\t%d\t%d\t%d\t%s\n", o.owner, o.signalEntries, pc.seed, pc.seedExpired,
			pc.untracked, o.ownRowTotal, flag)
	}

	printTo(w, "TOTALS seed=%d seed_expired=%d untracked=%d open_ended_skipped=%d\n", seeds, seedExpired, untracked, openEnded)
	printTo(w, "NEXT: portfolio backfill-signal-expiry --mode=apply --legacy-owner %s --expect-untracked %d --expect-seed-expired %d\n",
		legacyOwner, untracked, seedExpired)
}
