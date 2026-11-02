//go:build dbtest

package repository

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	portfoliov1 "github.com/xstockstrat/contracts/gen/go/portfolio/v1"
)

// RunBackfill classifies every SIGNAL binding in the database, not only this test's, so bounds are
// taken from a REPORT of the live state and assertions read this test's rows only.

// seedWatchSignal inserts one watchlist-direction ingest row; offset is relative to DB now(), nil = open-ended.
func seedWatchSignal(t *testing.T, pool *pgxpool.Pool, userID, symbol string, offset *string) (int64, *time.Time) {
	t.Helper()
	cleanupIngest(t, pool, userID)
	var (
		id int64
		vu *time.Time
	)
	if err := pool.QueryRow(context.Background(),
		`INSERT INTO ingest.newsletter_signals (user_id, source, symbol, direction, valid_from, valid_until)
		 VALUES ($1, 'mcp_client', $2, 'watchlist', now() - interval '90 days', now() + $3::interval)
		 RETURNING id, valid_until`, userID, symbol, offset).Scan(&id, &vu); err != nil {
		t.Fatalf("seedWatchSignal: %v", err)
	}
	return id, vu
}

func cleanupIngest(t *testing.T, pool *pgxpool.Pool, userID string) {
	t.Cleanup(func() {
		if _, err := pool.Exec(context.Background(),
			`DELETE FROM ingest.newsletter_signals WHERE user_id = $1`, userID); err != nil {
			t.Errorf("cleanup ingest signals: %v", err)
		}
	})
}

func offset(s string) *string { return &s }

func expiryCount(t *testing.T, pool *pgxpool.Pool) int64 {
	t.Helper()
	var n int64
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM portfolio.watchlist_signal_expiry`).Scan(&n); err != nil {
		t.Fatalf("expiryCount: %v", err)
	}
	return n
}

type backfillTotals struct{ seed, seedExpired, untracked, openEnded int64 }

func backfillReport(t *testing.T, pool *pgxpool.Pool, legacyOwner string) (BackfillResult, backfillTotals) {
	t.Helper()
	res, err := RunBackfill(context.Background(), pool, BackfillOptions{Mode: BackfillModeReport, LegacyOwner: legacyOwner}, nil)
	if err != nil {
		t.Fatalf("RunBackfill report: %v", err)
	}
	var tot backfillTotals
	for _, line := range strings.Split(res.Report, "\n") {
		if strings.HasPrefix(line, "TOTALS ") {
			if _, err := fmt.Sscanf(line, "TOTALS seed=%d seed_expired=%d untracked=%d open_ended_skipped=%d",
				&tot.seed, &tot.seedExpired, &tot.untracked, &tot.openEnded); err != nil {
				t.Fatalf("parse %q: %v", line, err)
			}
			return res, tot
		}
	}
	t.Fatalf("REPORT has no TOTALS line:\n%s", res.Report)
	return res, tot
}

func backfillApply(pool *pgxpool.Pool, legacyOwner string, untracked, seedExpired int64) (BackfillResult, error) {
	return RunBackfill(context.Background(), pool, BackfillOptions{
		Mode: BackfillModeApply, LegacyOwner: legacyOwner, ExpectUntracked: &untracked, ExpectSeedExpired: &seedExpired,
	}, nil)
}

// mustApply runs REPORT then APPLY with exactly the bounds REPORT printed, as the runbook does.
func mustApply(t *testing.T, pool *pgxpool.Pool, legacyOwner string) BackfillResult {
	t.Helper()
	_, tot := backfillReport(t, pool, legacyOwner)
	res, err := backfillApply(pool, legacyOwner, tot.untracked, tot.seedExpired)
	if err != nil {
		t.Fatalf("RunBackfill apply: %v\n%s", err, res.Report)
	}
	return res
}

func assertRefused(t *testing.T, err error, what string) {
	t.Helper()
	if !errors.Is(err, ErrBackfillRefused) {
		t.Fatalf("%s: err = %v, want ErrBackfillRefused", what, err)
	}
}

func assertReportLine(t *testing.T, report, want string) {
	t.Helper()
	for _, line := range strings.Split(report, "\n") {
		if line == want {
			return
		}
	}
	t.Fatalf("REPORT lacks line %q:\n%s", want, report)
}

func TestBackfill_ReportIsReadOnly(t *testing.T) {
	pool := testPool(t)
	userID := testUserID(t)
	wlID := seedWatchlist(t, pool, userID, true)
	seedBinding(t, pool, wlID, "AAPL", "", int16(srcSignal))
	seedBinding(t, pool, wlID, "PLTR", "", int16(srcSignal))
	seedWatchSignal(t, pool, userID, "AAPL", offset("30 days"))

	before := expiryCount(t, pool)
	res, tot := backfillReport(t, pool, "SEED")
	if after := expiryCount(t, pool); after != before {
		t.Fatalf("expiry rows %d → %d across REPORT, want unchanged", before, after)
	}
	if res.Seeded != 0 || res.Marked != 0 || res.SkippedChanged != 0 {
		t.Fatalf("REPORT result = %+v, want no writes", res)
	}
	if tot.seed < 1 || tot.untracked < 1 || !strings.Contains(res.Report, "legacy_owner=SEED (read-only)") {
		t.Fatalf("REPORT totals = %+v, header missing or counts too low:\n%s", tot, res.Report)
	}
	assertNoExpiry(t, pool, wlID, "AAPL")
	assertNoExpiry(t, pool, wlID, "PLTR")
}

func TestBackfill_BoundsRefuseBeforeWrite(t *testing.T) {
	pool := testPool(t)
	userID := testUserID(t)
	wlID := seedWatchlist(t, pool, userID, true)
	seedBinding(t, pool, wlID, "PLTR", "", int16(srcSignal))
	seedBinding(t, pool, wlID, "AAPL", "", int16(srcSignal))
	seedWatchSignal(t, pool, userID, "AAPL", offset("-10 days"))

	_, tot := backfillReport(t, pool, "SEED")
	before := expiryCount(t, pool)
	for _, c := range []struct {
		name                   string
		untracked, seedExpired int64
	}{
		{"untracked exceeded", tot.untracked - 1, tot.seedExpired},
		{"seed_expired exceeded", tot.untracked, tot.seedExpired - 1},
	} {
		_, err := backfillApply(pool, "SEED", c.untracked, c.seedExpired)
		assertRefused(t, err, c.name)
		if after := expiryCount(t, pool); after != before {
			t.Fatalf("%s: expiry rows %d → %d, want nothing written", c.name, before, after)
		}
	}
	assertNoExpiry(t, pool, wlID, "PLTR")
	assertNoExpiry(t, pool, wlID, "AAPL")
}

func TestBackfill_LegacyOwnerRequired(t *testing.T) {
	pool := testPool(t)
	wlID := seedWatchlist(t, pool, testUserID(t), true)
	seedBinding(t, pool, wlID, "PLTR", "", int16(srcSignal))
	zero := int64(0)
	before := expiryCount(t, pool)

	for _, c := range []struct {
		name string
		opts BackfillOptions
	}{
		{"report empty owner", BackfillOptions{Mode: BackfillModeReport}},
		{"report blank owner", BackfillOptions{Mode: BackfillModeReport, LegacyOwner: "  "}},
		{"apply empty owner", BackfillOptions{Mode: BackfillModeApply, ExpectUntracked: &zero, ExpectSeedExpired: &zero}},
		{"apply nil expect-untracked", BackfillOptions{Mode: BackfillModeApply, LegacyOwner: "SEED", ExpectSeedExpired: &zero}},
		{"apply nil expect-seed-expired", BackfillOptions{Mode: BackfillModeApply, LegacyOwner: "SEED", ExpectUntracked: &zero}},
	} {
		_, err := RunBackfill(context.Background(), pool, c.opts, nil)
		assertRefused(t, err, c.name)
	}
	if after := expiryCount(t, pool); after != before {
		t.Fatalf("expiry rows %d → %d, want nothing written", before, after)
	}
	assertNoExpiry(t, pool, wlID, "PLTR")
}

// AC-15: the latest dated own row wins, matched through upper(btrim()) (" aapl").
func TestBackfill_SeedsFromOwnerRows(t *testing.T) {
	pool := testPool(t)
	userID := testUserID(t)
	wlID := seedWatchlist(t, pool, userID, true)
	seedBinding(t, pool, wlID, "AAPL", "", int16(srcSignal))
	liveID, liveUntil := seedWatchSignal(t, pool, userID, " aapl", offset("30 days"))
	seedWatchSignal(t, pool, userID, "AAPL", offset("-60 days"))

	before := expiryCount(t, pool)
	rep, _ := backfillReport(t, pool, "SEED")
	if after := expiryCount(t, pool); after != before {
		t.Fatalf("REPORT wrote rows: %d → %d", before, after)
	}
	assertReportLine(t, rep.Report, fmt.Sprintf("SEED\t%s\t%s\tAAPL\t%s\t%d\tN",
		userID, wlID, liveUntil.UTC().Format(time.RFC3339), liveID))

	if res := mustApply(t, pool, "SEED"); res.Seeded < 1 {
		t.Fatalf("APPLY result = %+v, want at least one seeded", res)
	}
	assertExpiry(t, pool, wlID, "AAPL", *liveUntil, sigID(liveID))
}

// AC-16: no own rows ⇒ marked (even with a live legacy row); the next tick removes it with nil SignalID.
func TestBackfill_StrictUntrackedRemoval(t *testing.T) {
	pool := testPool(t)
	repo := NewWatchlistRepo(pool)
	userID := testUserID(t)
	legacy := userID + "-legacy"
	wlID := seedWatchlist(t, pool, userID, true)
	seedBinding(t, pool, wlID, "PLTR", "strat-3", int16(srcSignal))
	seedWatchSignal(t, pool, legacy, "PLTR", offset("30 days"))

	rep, tot := backfillReport(t, pool, legacy)
	assertReportLine(t, rep.Report, fmt.Sprintf("UNTRACKED\t%s\t%s\tPLTR\tstrat-3\t1\tY", userID, wlID))
	assertReportLine(t, rep.Report, fmt.Sprintf("PER-OWNER\t%s\t1\t0\t0\t1\t0\tNO_OWN_SIGNALS", userID))

	before := expiryCount(t, pool)
	_, err := backfillApply(pool, legacy, tot.untracked-1, tot.seedExpired)
	assertRefused(t, err, "untracked bound below live count")
	if after := expiryCount(t, pool); after != before {
		t.Fatalf("refused APPLY wrote rows: %d → %d", before, after)
	}
	assertNoExpiry(t, pool, wlID, "PLTR")

	res, err := backfillApply(pool, legacy, tot.untracked, tot.seedExpired)
	if err != nil || res.Marked < 1 {
		t.Fatalf("APPLY = %+v, %v; want at least one marked", res, err)
	}
	rec := dueRow(t, pool, wlID, "PLTR")
	if rec.SignalID != nil {
		t.Fatalf("marked row signal_id = %v, want NULL", *rec.SignalID)
	}
	assertPruned(t, mustPrune(t, repo, wlID), PrunedEntry{
		UserID: userID, WatchlistID: wlID, Symbol: "PLTR", StrategyID: "strat-3", ValidUntil: rec.ValidUntil,
	})
	assertBindingGone(t, pool, wlID, "PLTR")
}

// AC-17: a live dated renewal rescues a marked entry; an already-past renewal does not.
func TestBackfill_MarkedEntryRescued(t *testing.T) {
	cases := []struct {
		name     string
		signalID int64
		offset   time.Duration
		removed  bool
	}{
		{"live renewal rescues", 110, 30 * 24 * time.Hour, false},
		{"past renewal is no rescue", 111, -24 * time.Hour, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			pool := testPool(t)
			repo := NewWatchlistRepo(pool)
			userID := testUserID(t)
			wlID := seedWatchlist(t, pool, userID, true)
			seedBinding(t, pool, wlID, "ORCL", "", int16(srcSignal))

			mustApply(t, pool, "SEED")
			if rec := dueRow(t, pool, wlID, "ORCL"); rec.SignalID != nil {
				t.Fatalf("ORCL not marked: signal_id = %v", *rec.SignalID)
			}

			until := dbNow(t, pool).Add(tc.offset)
			mustAdd(t, repo, wlID, []*portfoliov1.WatchlistBinding{addBinding("ORCL", srcSignal)},
				provenanceIntent("ORCL", tc.signalID, until))
			rec := dueRow(t, pool, wlID, "ORCL")
			got := mustPrune(t, repo, wlID)
			if !tc.removed {
				if len(got) != 0 {
					t.Fatalf("rescued entry removed: %+v", got)
				}
				assertSource(t, pool, wlID, "ORCL", srcSignal)
				assertExpiry(t, pool, wlID, "ORCL", rec.ValidUntil, sigID(tc.signalID))
				return
			}
			assertPruned(t, got, PrunedEntry{
				UserID: userID, WatchlistID: wlID, Symbol: "ORCL", SignalID: sigID(tc.signalID), ValidUntil: rec.ValidUntil,
			})
			assertBindingGone(t, pool, wlID, "ORCL")
		})
	}
}

func TestBackfill_OpenEndedStaysUntracked(t *testing.T) {
	pool := testPool(t)
	repo := NewWatchlistRepo(pool)
	userID := testUserID(t)
	wlID := seedWatchlist(t, pool, userID, true)
	seedBinding(t, pool, wlID, "NVDA", "", int16(srcSignal))
	seedWatchSignal(t, pool, userID, "NVDA", nil)
	seedWatchSignal(t, pool, userID, "NVDA", offset("-10 days"))

	rep, _ := backfillReport(t, pool, "SEED")
	for _, line := range strings.Split(rep.Report, "\n") {
		if strings.Contains(line, "\t"+wlID+"\tNVDA\t") {
			t.Fatalf("open-ended entry listed in REPORT: %q", line)
		}
	}
	mustApply(t, pool, "SEED")
	assertNoExpiry(t, pool, wlID, "NVDA")
	if got := mustPrune(t, repo, wlID); len(got) != 0 {
		t.Fatalf("open-ended entry removed: %+v", got)
	}
	assertSource(t, pool, wlID, "NVDA", srcSignal)
}

func TestBackfill_Idempotent(t *testing.T) {
	pool := testPool(t)
	userID := testUserID(t)
	wlID := seedWatchlist(t, pool, userID, true)
	seedBinding(t, pool, wlID, "AAPL", "", int16(srcSignal))
	seedBinding(t, pool, wlID, "PLTR", "", int16(srcSignal))
	liveID, liveUntil := seedWatchSignal(t, pool, userID, "AAPL", offset("30 days"))

	first := mustApply(t, pool, "SEED")
	if first.Seeded < 1 || first.Marked < 1 {
		t.Fatalf("first APPLY = %+v, want a seed and a mark", first)
	}
	marked := dueRow(t, pool, wlID, "PLTR")
	before := expiryCount(t, pool)

	second := mustApply(t, pool, "SEED")
	if second.Seeded != 0 || second.Marked != 0 || second.SkippedChanged != 0 {
		t.Fatalf("second APPLY = %+v, want nothing written", second)
	}
	if after := expiryCount(t, pool); after != before {
		t.Fatalf("second APPLY changed row count %d → %d", before, after)
	}
	assertExpiry(t, pool, wlID, "AAPL", *liveUntil, sigID(liveID))
	assertExpiry(t, pool, wlID, "PLTR", marked.ValidUntil, nil)
}

// Design T4: a live signal + renewal committed while APPLY runs never leaves the entry removable.
// Whichever side wins, the entry ends untracked, seeded live, or rescued, and the tick keeps it.
func TestBackfill_IngestInterleavingSkipsChanged(t *testing.T) {
	pool := testPool(t)
	repo := NewWatchlistRepo(pool)
	baseUser := testUserID(t)
	skipped := 0
	for i := 0; i < 10; i++ {
		userID := fmt.Sprintf("%s-%d", baseUser, i)
		cleanupIngest(t, pool, userID)
		wlID := seedWatchlist(t, pool, userID, true)
		seedBinding(t, pool, wlID, "META", "", int16(srcSignal))
		_, tot := backfillReport(t, pool, "SEED")

		ctx := context.Background()
		var (
			wg               sync.WaitGroup
			start            = make(chan struct{})
			applyRes         BackfillResult
			applyErr, addErr error
		)
		wg.Add(2)
		go func() {
			defer wg.Done()
			<-start
			applyRes, applyErr = backfillApply(pool, "SEED", tot.untracked, tot.seedExpired)
		}()
		go func() {
			defer wg.Done()
			<-start
			var (
				id    int64
				until time.Time
			)
			if addErr = pool.QueryRow(ctx,
				`INSERT INTO ingest.newsletter_signals (user_id, source, symbol, direction, valid_from, valid_until)
				 VALUES ($1, 'mcp_client', 'META', 'watchlist', now(), now() + interval '30 days')
				 RETURNING id, valid_until`, userID).Scan(&id, &until); addErr != nil {
				return
			}
			_, addErr = repo.AddSymbols(ctx, wlID, []*portfoliov1.WatchlistBinding{addBinding("META", srcSignal)},
				provenanceIntent("META", id, until))
		}()
		close(start)
		wg.Wait()
		if applyErr != nil || addErr != nil {
			t.Fatalf("iteration %d: apply err = %v (code %s), add err = %v (code %s); want neither",
				i, applyErr, pgCode(applyErr), addErr, pgCode(addErr))
		}
		skipped += applyRes.SkippedChanged

		now := dbNow(t, pool)
		if rec, ok := expiryRow(t, pool, wlID, "META"); ok && !rec.ValidUntil.After(now) {
			t.Fatalf("iteration %d: entry left due (valid_until=%v signal_id=%v) while a live signal exists",
				i, rec.ValidUntil, ptrVal(rec.SignalID))
		}
		if got := mustPrune(t, repo, wlID); len(got) != 0 {
			t.Fatalf("iteration %d: tick removed %+v despite a live signal", i, got)
		}
		assertSource(t, pool, wlID, "META", srcSignal)
	}
	t.Logf("APPLY rows skipped as changed since REPORT across iterations: %d", skipped)
}
