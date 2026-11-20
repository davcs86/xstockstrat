//go:build dbtest

package repository

import (
	"context"
	"errors"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"google.golang.org/protobuf/types/known/timestamppb"

	marketdatav1 "github.com/xstockstrat/contracts/gen/go/marketdata/v1"
	"github.com/xstockstrat/marketdata/internal/source"
)

// profileDBSymbolPrefix scopes every row these tests create; cleanup deletes exactly that prefix.
const profileDBSymbolPrefix = "ZZ352_"

const (
	profileDBDay       = "2026-11-09"
	profileDBDayBefore = "2026-11-08"
	profileDBLease     = 10 * time.Minute
)

func profileDBRepo(t *testing.T) (*ProfileRepo, *MarketDataRepo) {
	t.Helper()
	repo := dbtestRepo(t)
	cleanup := func() {
		for _, table := range []string{"symbol_profile", "watched_symbol", "ohlcv", "fundamentals_history"} {
			if _, err := repo.db.Exec(context.Background(), `DELETE FROM marketdata.`+table+` WHERE symbol LIKE $1`, profileDBSymbolPrefix+"%"); err != nil {
				t.Errorf("cleanup %s: %v", table, err)
			}
		}
	}
	cleanup()
	t.Cleanup(cleanup)
	return NewProfileRepo(repo), repo
}

func profileDBExec(t *testing.T, repo *MarketDataRepo, sql string, args ...any) {
	t.Helper()
	if _, err := repo.db.Exec(context.Background(), sql, args...); err != nil {
		t.Fatalf("exec %q: %v", sql, err)
	}
}

func profileDBWatch(t *testing.T, repo *MarketDataRepo, symbols ...string) {
	t.Helper()
	for _, s := range symbols {
		profileDBExec(t, repo, `INSERT INTO marketdata.watched_symbol (symbol) VALUES ($1) ON CONFLICT (symbol) DO NOTHING`, s)
	}
}

func profileDBUnwatch(t *testing.T, repo *MarketDataRepo, symbols ...string) {
	t.Helper()
	for _, s := range symbols {
		profileDBExec(t, repo, `DELETE FROM marketdata.watched_symbol WHERE symbol = $1`, s)
	}
}

// profileDBStarted creates watched, started rows dated profileDBDay.
func profileDBStarted(t *testing.T, profiles *ProfileRepo, repo *MarketDataRepo, symbols ...string) {
	t.Helper()
	profileDBWatch(t, repo, symbols...)
	in := make([]SymbolReason, len(symbols))
	for i, s := range symbols {
		in[i] = SymbolReason{Symbol: s, Reason: 2}
	}
	n, err := profiles.Start(context.Background(), profileDBDay, in)
	if err != nil || n != int64(len(symbols)) {
		t.Fatalf("Start = %d, %v, want %d rows", n, err, len(symbols))
	}
}

// profileDBFlagged creates watched, flagged rows.
func profileDBFlagged(t *testing.T, profiles *ProfileRepo, repo *MarketDataRepo, symbols ...string) {
	t.Helper()
	profileDBStarted(t, profiles, repo, symbols...)
	got, err := profiles.Flag(context.Background(), profileDBDay, symbols)
	if err != nil || len(got) != len(symbols) {
		t.Fatalf("Flag = %v, %v, want %d symbols", got, err, len(symbols))
	}
}

type profileDBState struct {
	found                  bool
	date                   string
	reason                 int16
	flagged, claimed, sent bool
}

func profileDBRead(t *testing.T, repo *MarketDataRepo, symbol string) profileDBState {
	t.Helper()
	var (
		st     profileDBState
		date   *string
		reason *int16
	)
	err := repo.db.QueryRow(context.Background(), `SELECT first_unservable_date::text, unservable_reason,
			delisted_at IS NOT NULL, alert_claimed_at IS NOT NULL, alert_acked_at IS NOT NULL
		FROM marketdata.symbol_profile WHERE symbol = $1`, symbol).Scan(&date, &reason, &st.flagged, &st.claimed, &st.sent)
	if errors.Is(err, pgx.ErrNoRows) {
		return st
	}
	if err != nil {
		t.Fatalf("read profile %s: %v", symbol, err)
	}
	st.found = true
	if date != nil {
		st.date = *date
	}
	if reason != nil {
		st.reason = *reason
	}
	return st
}

// @AC-21: the first unservable observation of a watched symbol creates a row with the date and
// reason and no flag; a symbol outside the union gets none.
func TestProfileDB_AC21_StartCreatesRowForWatchedSymbolOnly(t *testing.T) {
	profiles, repo := profileDBRepo(t)
	watched, unwatched := profileDBSymbolPrefix+"ROKU", profileDBSymbolPrefix+"AAPL"
	profileDBWatch(t, repo, watched)
	n, err := profiles.Start(context.Background(), profileDBDay, []SymbolReason{{Symbol: unwatched, Reason: 2}, {Symbol: watched, Reason: 1}})
	if err != nil || n != 1 {
		t.Fatalf("Start = %d, %v, want 1 row", n, err)
	}
	if got, want := profileDBRead(t, repo, watched), (profileDBState{found: true, date: profileDBDay, reason: 1}); got != want {
		t.Errorf("watched row = %+v, want %+v", got, want)
	}
	if got := profileDBRead(t, repo, unwatched); got.found {
		t.Errorf("unwatched symbol got a row: %+v", got)
	}
	// A started row keeps its date and reason on a later Start.
	if n, err := profiles.Start(context.Background(), "2026-11-10", []SymbolReason{{Symbol: watched, Reason: 2}}); err != nil || n != 0 {
		t.Fatalf("second Start = %d, %v, want 0 rows", n, err)
	}
	if got := profileDBRead(t, repo, watched); got.date != profileDBDay || got.reason != 1 {
		t.Errorf("started row changed: %+v", got)
	}
}

// @AC-1: the window test is inside the statement — a cutoff equal to the row's date flags it, a
// cutoff one day earlier does not, and a started row outside the union is never flagged.
func TestProfileDB_AC1_FlagHonoursCutoffAndUnion(t *testing.T) {
	profiles, repo := profileDBRepo(t)
	watched, unwatched := profileDBSymbolPrefix+"ROKU", profileDBSymbolPrefix+"ATCH"
	profileDBStarted(t, profiles, repo, watched, unwatched)
	profileDBUnwatch(t, repo, unwatched)
	both := []string{unwatched, watched}

	got, err := profiles.Flag(context.Background(), profileDBDayBefore, both)
	if err != nil || len(got) != 0 {
		t.Fatalf("Flag(day before) = %v, %v, want none", got, err)
	}
	got, err = profiles.Flag(context.Background(), profileDBDay, both)
	if err != nil || !slices.Equal(got, []string{watched}) {
		t.Fatalf("Flag(day) = %v, %v, want [%s]", got, err, watched)
	}
	if st := profileDBRead(t, repo, watched); !st.flagged || st.date != profileDBDay {
		t.Errorf("watched row = %+v, want flagged with date %s", st, profileDBDay)
	}
	if st := profileDBRead(t, repo, unwatched); st.flagged {
		t.Errorf("unwatched started row was flagged: %+v", st)
	}
	flagged, err := profiles.FlaggedSymbols(context.Background())
	if err != nil || !slices.Contains(flagged, watched) || slices.Contains(flagged, unwatched) {
		t.Errorf("FlaggedSymbols = %v, %v", flagged, err)
	}
}

// @AC-27: a flag survives leaving the union; only an unflagged started row is reset by it, and an
// empty union resets nothing. Recover clears a flagged row whatever the union holds.
func TestProfileDB_AC27_FlagPersistsOffWatchlist(t *testing.T) {
	profiles, repo := profileDBRepo(t)
	ctx := context.Background()
	flagged, started, other := profileDBSymbolPrefix+"NWE", profileDBSymbolPrefix+"SHPH", profileDBSymbolPrefix+"AAPL"
	profileDBFlagged(t, profiles, repo, flagged)
	profileDBStarted(t, profiles, repo, started)
	profileDBUnwatch(t, repo, flagged, started)
	profileDBWatch(t, repo, other)

	if _, err := profiles.ResetUnwatched(ctx); err != nil {
		t.Fatalf("ResetUnwatched: %v", err)
	}
	if st := profileDBRead(t, repo, flagged); !st.flagged || st.date != profileDBDay {
		t.Errorf("flagged row after ResetUnwatched = %+v, want untouched", st)
	}
	if st := profileDBRead(t, repo, started); !st.found || st.date != "" || st.reason != 0 {
		t.Errorf("started row after ResetUnwatched = %+v, want reset and kept", st)
	}

	profileDBUnwatch(t, repo, other)
	var watchedRows int
	if err := repo.db.QueryRow(ctx, `SELECT count(*) FROM marketdata.watched_symbol`).Scan(&watchedRows); err != nil {
		t.Fatalf("count watched: %v", err)
	}
	if watchedRows != 0 {
		t.Fatalf("marketdata.watched_symbol holds %d foreign rows; the empty-union case needs an empty table", watchedRows)
	}
	held := profileDBSymbolPrefix + "PSKY"
	profileDBStarted(t, profiles, repo, held)
	profileDBUnwatch(t, repo, held)
	if _, err := profiles.ResetUnwatched(ctx); err != nil {
		t.Fatalf("ResetUnwatched(empty union): %v", err)
	}
	if st := profileDBRead(t, repo, held); st.date != profileDBDay {
		t.Errorf("empty union reset a started row: %+v", st)
	}

	claimed := profileDBSymbolPrefix + "KPTI"
	profileDBFlagged(t, profiles, repo, claimed)
	profileDBUnwatch(t, repo, claimed)
	if rows, err := profiles.ClaimAlerts(ctx, []string{claimed}, profileDBLease, 10); err != nil || len(rows) != 1 {
		t.Fatalf("ClaimAlerts = %+v, %v", rows, err)
	}
	got, err := profiles.Recover(ctx, []string{claimed, flagged, held})
	want := []RecoveredRow{{Symbol: claimed, AlertClaimed: true}, {Symbol: flagged}}
	slices.SortFunc(got, func(a, b RecoveredRow) int { return strings.Compare(a.Symbol, b.Symbol) })
	if err != nil || !slices.Equal(got, want) {
		t.Fatalf("Recover = %+v, %v, want %+v", got, err, want)
	}
	for _, s := range []string{claimed, flagged} {
		if st, cleared := profileDBRead(t, repo, s), (profileDBState{found: true}); st != cleared {
			t.Errorf("recovered row %s = %+v, want every state column NULL", s, st)
		}
	}
	if st := profileDBRead(t, repo, held); st.date != profileDBDay {
		t.Errorf("Recover touched an unflagged row: %+v", st)
	}
}

func TestProfileDB_ResetServableResetsOnlyUnflaggedStartedRows(t *testing.T) {
	profiles, repo := profileDBRepo(t)
	started, flagged := profileDBSymbolPrefix+"ROKU", profileDBSymbolPrefix+"NWE"
	profileDBStarted(t, profiles, repo, started)
	profileDBFlagged(t, profiles, repo, flagged)
	n, err := profiles.ResetServable(context.Background(), []string{flagged, started, profileDBSymbolPrefix + "AAPL"})
	if err != nil || n != 1 {
		t.Fatalf("ResetServable = %d, %v, want 1", n, err)
	}
	if st, reset := profileDBRead(t, repo, started), (profileDBState{found: true}); st != reset {
		t.Errorf("started row = %+v, want reset", st)
	}
	if st := profileDBRead(t, repo, flagged); !st.flagged {
		t.Errorf("flagged row was reset: %+v", st)
	}
	symbols, watched, err := profiles.Candidates(context.Background())
	if err != nil || watched < 2 || !slices.Contains(symbols, started) || !slices.IsSorted(symbols) {
		t.Errorf("Candidates = %v, %d, %v", symbols, watched, err)
	}
}

func TestProfileDB_ClaimLifecycle(t *testing.T) {
	profiles, repo := profileDBRepo(t)
	ctx := context.Background()
	a, b, c := profileDBSymbolPrefix+"A", profileDBSymbolPrefix+"B", profileDBSymbolPrefix+"C"
	all := []string{a, b, c}
	profileDBFlagged(t, profiles, repo, all...)

	first, err := profiles.ClaimAlerts(ctx, all, profileDBLease, 2)
	if err != nil || len(first) != 2 {
		t.Fatalf("ClaimAlerts(limit 2) = %+v, %v, want 2 rows", first, err)
	}
	slices.SortFunc(first, func(x, y ClaimedRow) int { return strings.Compare(x.Symbol, y.Symbol) })
	want := ClaimedRow{FlaggedRow: FlaggedRow{Symbol: a, FirstUnservableDate: profileDBDay, Reason: 2, AlertClaimed: true}}
	if first[0] != want || first[1].Symbol != b || first[1].Reclaim {
		t.Errorf("first claim = %+v, want %s and %s, neither a re-claim", first, a, b)
	}
	if again, err := profiles.ClaimAlerts(ctx, []string{a, b}, profileDBLease, 10); err != nil || len(again) != 0 {
		t.Errorf("claim inside the lease = %+v, %v, want none", again, err)
	}
	claimable, err := profiles.ClaimableSymbols(ctx, profileDBLease)
	if err != nil || !slices.Contains(claimable, c) || slices.Contains(claimable, a) {
		t.Errorf("ClaimableSymbols = %v, %v, want %s and not %s", claimable, err, c, a)
	}
	expired, err := profiles.ClaimAlerts(ctx, []string{a}, 0, 10)
	if err != nil || len(expired) != 1 || !expired[0].Reclaim {
		t.Fatalf("claim after the lease = %+v, %v, want one re-claim", expired, err)
	}

	if n, err := profiles.AckAlerts(ctx, []string{a, c}); err != nil || n != 1 {
		t.Fatalf("AckAlerts = %d, %v, want 1 (an unclaimed row is not acknowledged)", n, err)
	}
	if after, err := profiles.ClaimAlerts(ctx, []string{a}, 0, 10); err != nil || len(after) != 0 {
		t.Errorf("claim after the acknowledgement = %+v, %v, want none", after, err)
	}
	rows, err := profiles.FlaggedIn(ctx, []string{a, c, profileDBSymbolPrefix + "AAPL"})
	wantRows := []FlaggedRow{
		{Symbol: a, FirstUnservableDate: profileDBDay, Reason: 2, AlertClaimed: true, AlertAcked: true},
		{Symbol: c, FirstUnservableDate: profileDBDay, Reason: 2},
	}
	if err != nil || !slices.Equal(rows, wantRows) {
		t.Errorf("FlaggedIn = %+v, %v, want %+v", rows, err, wantRows)
	}
}

func TestProfileDB_ReplaceWatched(t *testing.T) {
	profiles, repo := profileDBRepo(t)
	ctx := context.Background()
	kept, dropped, added := profileDBSymbolPrefix+"AAPL", profileDBSymbolPrefix+"ROKU", profileDBSymbolPrefix+"NWE"
	profileDBWatch(t, repo, kept, dropped)
	if err := profiles.ReplaceWatched(ctx, []string{added, kept, kept}); err != nil {
		t.Fatalf("ReplaceWatched: %v", err)
	}
	var got []string
	rows, err := repo.db.Query(ctx, `SELECT symbol FROM marketdata.watched_symbol ORDER BY symbol`)
	if err != nil {
		t.Fatalf("read watched: %v", err)
	}
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			t.Fatalf("scan watched: %v", err)
		}
		got = append(got, s)
	}
	rows.Close()
	if want := []string{kept, added}; !slices.Equal(got, want) {
		t.Errorf("watched = %v, want %v", got, want)
	}
	if err := profiles.ReplaceWatched(ctx, nil); err != nil {
		t.Fatalf("ReplaceWatched(empty): %v", err)
	}
	var n int
	if err := repo.db.QueryRow(ctx, `SELECT count(*) FROM marketdata.watched_symbol`).Scan(&n); err != nil || n != 0 {
		t.Errorf("watched rows after an empty replace = %d, %v, want 0", n, err)
	}
}

func TestProfileDB_CheckConstraints(t *testing.T) {
	_, repo := profileDBRepo(t)
	symbol := profileDBSymbolPrefix + "CHK"
	cases := map[string]string{
		"date without reason":   `INSERT INTO marketdata.symbol_profile (symbol, first_unservable_date) VALUES ($1, '2026-11-09')`,
		"reason not positive":   `INSERT INTO marketdata.symbol_profile (symbol, first_unservable_date, unservable_reason) VALUES ($1, '2026-11-09', 0)`,
		"flag without date":     `INSERT INTO marketdata.symbol_profile (symbol, delisted_at) VALUES ($1, now())`,
		"claim without flag":    `INSERT INTO marketdata.symbol_profile (symbol, first_unservable_date, unservable_reason, alert_claimed_at) VALUES ($1, '2026-11-09', 2, now())`,
		"ack without the claim": `INSERT INTO marketdata.symbol_profile (symbol, first_unservable_date, unservable_reason, delisted_at, alert_acked_at) VALUES ($1, '2026-11-09', 2, now(), now())`,
	}
	for name, sql := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := repo.db.Exec(context.Background(), sql, symbol)
			var pgErr *pgconn.PgError
			if !errors.As(err, &pgErr) || pgErr.Code != "23514" {
				t.Fatalf("err = %v, want a check violation (23514)", err)
			}
		})
	}
}

// @AC-9 (guard): flagging a symbol deletes none of its stored bars or fundamentals. Passes on
// today's code; it fails only if a profile statement starts touching stored data.
func TestProfileDB_AC9_FlaggingKeepsStoredData(t *testing.T) {
	profiles, repo := profileDBRepo(t)
	ctx := context.Background()
	symbol := profileDBSymbolPrefix + "ROKU"
	day := hfDay(2026, 11, 2)
	bar := &marketdatav1.Bar{Time: timestamppb.New(day), Symbol: symbol, Timeframe: "1d", Open: 1, High: 2, Low: 1, Close: 2, Volume: 10, Source: "alpaca"} //nolint:staticcheck // SA1019: stored canonical timeframe string
	if err := repo.InsertBars(ctx, []*marketdatav1.Bar{bar}); err != nil {
		t.Fatalf("InsertBars: %v", err)
	}
	period := dbtestPeriod(symbol, "Q3-2026", hfDay(2026, 9, 30), hfDay(2026, 10, 30), 3, 1, 2)
	if err := repo.ReplaceHistoricalFundamentals(ctx, symbol, nil, []source.HistoricalFundamentalsPeriod{period}); err != nil {
		t.Fatalf("seed fundamentals: %v", err)
	}

	profileDBFlagged(t, profiles, repo, symbol)

	bars, _, err := repo.QueryBars(ctx, symbol, "1d", day.Add(-time.Hour), day.Add(time.Hour), 10, "")
	if err != nil || len(bars) != 1 {
		t.Errorf("QueryBars after the flag = %d bars, %v, want 1", len(bars), err)
	}
	history, err := repo.ListHistoricalRows(ctx, symbol)
	if err != nil || len(history) != 1 {
		t.Errorf("ListHistoricalRows after the flag = %d rows, %v, want 1", len(history), err)
	}
}
