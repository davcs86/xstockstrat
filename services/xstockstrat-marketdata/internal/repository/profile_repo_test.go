package repository

import (
	"context"
	"errors"
	"slices"
	"testing"
	"time"

	"github.com/pashagolub/pgxmock/v4"
)

var errProfileDriver = errors.New("driver down")

func newProfileMock(t *testing.T) (pgxmock.PgxPoolIface, *ProfileRepo) {
	t.Helper()
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	t.Cleanup(mock.Close)
	return mock, &ProfileRepo{db: mock}
}

func profileMet(t *testing.T, mock pgxmock.PgxPoolIface) {
	t.Helper()
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func profileWrapped(t *testing.T, err error) {
	t.Helper()
	if !errors.Is(err, errProfileDriver) || err.Error() == errProfileDriver.Error() {
		t.Fatalf("err = %v, want the driver error wrapped", err)
	}
}

func TestProfileRepo_Candidates(t *testing.T) {
	mock, repo := newProfileMock(t)
	mock.ExpectQuery(`FROM marketdata.watched_symbol[\s\S]+first_unservable_date IS NOT NULL[\s\S]+ORDER BY symbol`).
		WillReturnRows(pgxmock.NewRows([]string{"symbol", "watched"}).AddRow("AAPL", true).AddRow("ATCH", false).AddRow("ROKU", true))
	symbols, watched, err := repo.Candidates(context.Background())
	if err != nil || !slices.Equal(symbols, []string{"AAPL", "ATCH", "ROKU"}) || watched != 2 {
		t.Fatalf("Candidates = %v, %d, %v", symbols, watched, err)
	}
	profileMet(t, mock)

	mock.ExpectQuery(`watched_symbol`).WillReturnError(errProfileDriver)
	_, _, err = repo.Candidates(context.Background())
	profileWrapped(t, err)
}

func TestProfileRepo_ResetServable(t *testing.T) {
	mock, repo := newProfileMock(t)
	mock.ExpectExec(`ORDER BY symbol FOR UPDATE[\s\S]+SET first_unservable_date = NULL, unservable_reason = NULL`).
		WithArgs([]string{"AAPL", "ROKU"}).WillReturnResult(pgxmock.NewResult("UPDATE", 2))
	n, err := repo.ResetServable(context.Background(), []string{"AAPL", "ROKU"})
	if err != nil || n != 2 {
		t.Fatalf("ResetServable = %d, %v", n, err)
	}
	profileMet(t, mock)

	mock.ExpectExec(`UPDATE`).WithArgs([]string{"AAPL"}).WillReturnError(errProfileDriver)
	_, err = repo.ResetServable(context.Background(), []string{"AAPL"})
	profileWrapped(t, err)
}

func TestProfileRepo_ResetUnwatched(t *testing.T) {
	mock, repo := newProfileMock(t)
	mock.ExpectExec(`EXISTS \(SELECT 1 FROM marketdata.watched_symbol\)[\s\S]+ORDER BY p.symbol FOR UPDATE`).
		WillReturnResult(pgxmock.NewResult("UPDATE", 3))
	n, err := repo.ResetUnwatched(context.Background())
	if err != nil || n != 3 {
		t.Fatalf("ResetUnwatched = %d, %v", n, err)
	}
	profileMet(t, mock)

	mock.ExpectExec(`UPDATE`).WillReturnError(errProfileDriver)
	_, err = repo.ResetUnwatched(context.Background())
	profileWrapped(t, err)
}

func TestProfileRepo_Start(t *testing.T) {
	mock, repo := newProfileMock(t)
	mock.ExpectExec(`INSERT INTO marketdata.symbol_profile[\s\S]+\$3::date[\s\S]+ORDER BY u.symbol[\s\S]+WHERE symbol_profile.first_unservable_date IS NULL`).
		WithArgs([]string{"ATCH", "ROKU"}, []int16{1, 2}, "2026-11-09").WillReturnResult(pgxmock.NewResult("INSERT", 2))
	n, err := repo.Start(context.Background(), "2026-11-09", []SymbolReason{{Symbol: "ATCH", Reason: 1}, {Symbol: "ROKU", Reason: 2}})
	if err != nil || n != 2 {
		t.Fatalf("Start = %d, %v", n, err)
	}
	profileMet(t, mock)

	mock.ExpectExec(`INSERT`).WithArgs([]string{"ROKU"}, []int16{2}, "2026-11-09").WillReturnError(errProfileDriver)
	_, err = repo.Start(context.Background(), "2026-11-09", []SymbolReason{{Symbol: "ROKU", Reason: 2}})
	profileWrapped(t, err)
}

func TestProfileRepo_Flag(t *testing.T) {
	mock, repo := newProfileMock(t)
	mock.ExpectQuery(`first_unservable_date <= \$1::date[\s\S]+marketdata.watched_symbol[\s\S]+FOR UPDATE[\s\S]+SET delisted_at = now\(\)[\s\S]+RETURNING p.symbol`).
		WithArgs("2026-11-09", []string{"ATCH", "ROKU"}).
		WillReturnRows(pgxmock.NewRows([]string{"symbol"}).AddRow("ROKU"))
	got, err := repo.Flag(context.Background(), "2026-11-09", []string{"ATCH", "ROKU"})
	if err != nil || !slices.Equal(got, []string{"ROKU"}) {
		t.Fatalf("Flag = %v, %v", got, err)
	}
	profileMet(t, mock)

	mock.ExpectQuery(`UPDATE`).WithArgs("2026-11-09", []string{"ROKU"}).WillReturnError(errProfileDriver)
	_, err = repo.Flag(context.Background(), "2026-11-09", []string{"ROKU"})
	profileWrapped(t, err)
}

func TestProfileRepo_Recover(t *testing.T) {
	mock, repo := newProfileMock(t)
	mock.ExpectQuery(`alert_claimed_at IS NOT NULL AS claimed[\s\S]+ORDER BY symbol FOR UPDATE[\s\S]+delisted_at = NULL, alert_claimed_at = NULL, alert_acked_at = NULL[\s\S]+RETURNING p.symbol, t.claimed`).
		WithArgs([]string{"KPTI", "NWE"}).
		WillReturnRows(pgxmock.NewRows([]string{"symbol", "claimed"}).AddRow("KPTI", true).AddRow("NWE", false))
	got, err := repo.Recover(context.Background(), []string{"KPTI", "NWE"})
	want := []RecoveredRow{{Symbol: "KPTI", AlertClaimed: true}, {Symbol: "NWE"}}
	if err != nil || !slices.Equal(got, want) {
		t.Fatalf("Recover = %v, %v", got, err)
	}
	profileMet(t, mock)

	mock.ExpectQuery(`UPDATE`).WithArgs([]string{"NWE"}).WillReturnError(errProfileDriver)
	_, err = repo.Recover(context.Background(), []string{"NWE"})
	profileWrapped(t, err)
}

func TestProfileRepo_FlaggedSymbols(t *testing.T) {
	mock, repo := newProfileMock(t)
	mock.ExpectQuery(`SELECT symbol FROM marketdata.symbol_profile WHERE delisted_at IS NOT NULL`).
		WillReturnRows(pgxmock.NewRows([]string{"symbol"}).AddRow("NWE").AddRow("ROKU"))
	got, err := repo.FlaggedSymbols(context.Background())
	if err != nil || !slices.Equal(got, []string{"NWE", "ROKU"}) {
		t.Fatalf("FlaggedSymbols = %v, %v", got, err)
	}
	profileMet(t, mock)

	mock.ExpectQuery(`SELECT symbol`).WillReturnError(errProfileDriver)
	_, err = repo.FlaggedSymbols(context.Background())
	profileWrapped(t, err)
}

func TestProfileRepo_ReplaceWatched(t *testing.T) {
	mock, repo := newProfileMock(t)
	mock.ExpectExec(`INSERT INTO marketdata.watched_symbol[\s\S]+ORDER BY s[\s\S]+ON CONFLICT \(symbol\) DO NOTHING`).
		WithArgs([]string{"AAPL", "ROKU"}).WillReturnResult(pgxmock.NewResult("INSERT", 1))
	mock.ExpectExec(`DELETE FROM marketdata.watched_symbol`).
		WithArgs([]string{"AAPL", "ROKU"}).WillReturnResult(pgxmock.NewResult("DELETE", 4))
	if err := repo.ReplaceWatched(context.Background(), []string{"AAPL", "ROKU"}); err != nil {
		t.Fatalf("ReplaceWatched: %v", err)
	}
	profileMet(t, mock)

	mock.ExpectExec(`INSERT INTO marketdata.watched_symbol`).WithArgs([]string{}).WillReturnResult(pgxmock.NewResult("INSERT", 0))
	mock.ExpectExec(`DELETE FROM marketdata.watched_symbol`).WithArgs([]string{}).WillReturnResult(pgxmock.NewResult("DELETE", 2))
	if err := repo.ReplaceWatched(context.Background(), nil); err != nil {
		t.Fatalf("ReplaceWatched(empty): %v", err)
	}
	profileMet(t, mock)

	mock.ExpectExec(`INSERT`).WithArgs([]string{"AAPL"}).WillReturnResult(pgxmock.NewResult("INSERT", 0))
	mock.ExpectExec(`DELETE`).WithArgs([]string{"AAPL"}).WillReturnError(errProfileDriver)
	profileWrapped(t, repo.ReplaceWatched(context.Background(), []string{"AAPL"}))
}

func TestProfileRepo_ClaimableSymbols(t *testing.T) {
	mock, repo := newProfileMock(t)
	mock.ExpectQuery(`alert_acked_at IS NULL[\s\S]+make_interval\(secs => \$1\)`).WithArgs(float64(600)).
		WillReturnRows(pgxmock.NewRows([]string{"symbol"}).AddRow("ROKU"))
	got, err := repo.ClaimableSymbols(context.Background(), 10*time.Minute)
	if err != nil || !slices.Equal(got, []string{"ROKU"}) {
		t.Fatalf("ClaimableSymbols = %v, %v", got, err)
	}
	profileMet(t, mock)

	mock.ExpectQuery(`SELECT symbol`).WithArgs(float64(600)).WillReturnError(errProfileDriver)
	_, err = repo.ClaimableSymbols(context.Background(), 10*time.Minute)
	profileWrapped(t, err)
}

func TestProfileRepo_ClaimAlerts(t *testing.T) {
	mock, repo := newProfileMock(t)
	mock.ExpectQuery(`make_interval\(secs => \$2\)[\s\S]+ORDER BY symbol LIMIT \$3 FOR UPDATE SKIP LOCKED[\s\S]+SET alert_claimed_at = now\(\)[\s\S]+RETURNING`).
		WithArgs([]string{"ATCH", "ROKU"}, float64(600), 100).
		WillReturnRows(pgxmock.NewRows([]string{"symbol", "first", "reason", "reclaim"}).
			AddRow("ATCH", "2026-11-09", int16(1), false).AddRow("ROKU", "2026-11-10", int16(2), true))
	got, err := repo.ClaimAlerts(context.Background(), []string{"ATCH", "ROKU"}, 10*time.Minute, 100)
	want := []ClaimedRow{
		{FlaggedRow: FlaggedRow{Symbol: "ATCH", FirstUnservableDate: "2026-11-09", Reason: 1, AlertClaimed: true}},
		{FlaggedRow: FlaggedRow{Symbol: "ROKU", FirstUnservableDate: "2026-11-10", Reason: 2, AlertClaimed: true}, Reclaim: true},
	}
	if err != nil || !slices.Equal(got, want) {
		t.Fatalf("ClaimAlerts = %+v, %v", got, err)
	}
	profileMet(t, mock)

	mock.ExpectQuery(`UPDATE`).WithArgs([]string{"ROKU"}, float64(600), 100).WillReturnError(errProfileDriver)
	_, err = repo.ClaimAlerts(context.Background(), []string{"ROKU"}, 10*time.Minute, 100)
	profileWrapped(t, err)
}

func TestProfileRepo_FlaggedIn(t *testing.T) {
	mock, repo := newProfileMock(t)
	mock.ExpectQuery(`first_unservable_date::text[\s\S]+delisted_at IS NOT NULL AND symbol = ANY\(\$1\)`).
		WithArgs([]string{"AAPL", "ROKU"}).
		WillReturnRows(pgxmock.NewRows([]string{"symbol", "first", "reason", "claimed", "acked"}).
			AddRow("ROKU", "2026-11-09", int16(2), true, true))
	got, err := repo.FlaggedIn(context.Background(), []string{"AAPL", "ROKU"})
	want := []FlaggedRow{{Symbol: "ROKU", FirstUnservableDate: "2026-11-09", Reason: 2, AlertClaimed: true, AlertAcked: true}}
	if err != nil || !slices.Equal(got, want) {
		t.Fatalf("FlaggedIn = %+v, %v", got, err)
	}
	profileMet(t, mock)

	mock.ExpectQuery(`SELECT symbol`).WithArgs([]string{"ROKU"}).WillReturnError(errProfileDriver)
	_, err = repo.FlaggedIn(context.Background(), []string{"ROKU"})
	profileWrapped(t, err)
}

func TestProfileRepo_AckAlerts(t *testing.T) {
	mock, repo := newProfileMock(t)
	mock.ExpectExec(`alert_claimed_at IS NOT NULL AND alert_acked_at IS NULL[\s\S]+ORDER BY symbol FOR UPDATE[\s\S]+SET alert_acked_at = now\(\)`).
		WithArgs([]string{"ROKU"}).WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	n, err := repo.AckAlerts(context.Background(), []string{"ROKU"})
	if err != nil || n != 1 {
		t.Fatalf("AckAlerts = %d, %v", n, err)
	}
	profileMet(t, mock)

	mock.ExpectExec(`UPDATE`).WithArgs([]string{"ROKU"}).WillReturnError(errProfileDriver)
	_, err = repo.AckAlerts(context.Background(), []string{"ROKU"})
	profileWrapped(t, err)
}
