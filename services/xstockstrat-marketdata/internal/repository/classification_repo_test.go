package repository

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/pashagolub/pgxmock/v4"

	"github.com/xstockstrat/marketdata/internal/classification"
)

func newClassMock(t *testing.T) (pgxmock.PgxPoolIface, *ClassificationRepo) {
	t.Helper()
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	t.Cleanup(mock.Close)
	return mock, &ClassificationRepo{db: mock}
}

// @AC-2: a changed sector closes the open row at the refresh time and opens a new row, in one txn.
func TestApplyObservation_Transition_AC2(t *testing.T) {
	mock, repo := newClassMock(t)
	now := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	mock.ExpectBegin()
	mock.ExpectQuery(`FOR UPDATE`).WithArgs("XYZ").
		WillReturnRows(pgxmock.NewRows([]string{"sector"}).AddRow("TECHNOLOGY"))
	mock.ExpectExec(`UPDATE marketdata.symbol_classification SET valid_to = \$2`).WithArgs("XYZ", now).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	mock.ExpectExec(`INSERT INTO marketdata.symbol_classification`).
		WithArgs("XYZ", "COMMUNICATION_SERVICES", "GICS", "fmp", now).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))
	mock.ExpectCommit()
	mock.ExpectRollback()

	got, err := repo.ApplyObservation(context.Background(), "XYZ", "COMMUNICATION_SERVICES", now)
	if err != nil || got != classification.ActionTransition {
		t.Fatalf("ApplyObservation = %v, %v", got, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// @AC-11: the first post-go-live reclassification closes an epoch-seeded open row the same way —
// valid_to = refresh time — so pre-go-live as-of reads still resolve the seeded sector.
func TestApplyObservation_ClosesEpochSeed_AC11(t *testing.T) {
	mock, repo := newClassMock(t)
	now := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	mock.ExpectBegin()
	mock.ExpectQuery(`FOR UPDATE`).WithArgs("XYZ").
		WillReturnRows(pgxmock.NewRows([]string{"sector"}).AddRow("TECHNOLOGY"))
	mock.ExpectExec(`UPDATE`).WithArgs("XYZ", now).WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	mock.ExpectExec(`INSERT`).WithArgs("XYZ", "ENERGY", "GICS", "fmp", now).WillReturnResult(pgxmock.NewResult("INSERT", 1))
	mock.ExpectCommit()
	mock.ExpectRollback()
	if _, err := repo.ApplyObservation(context.Background(), "XYZ", "ENERGY", now); err != nil {
		t.Fatal(err)
	}
	// as-of reads: [1900, 2026-10-01) → TECHNOLOGY, after → ENERGY (boundary: from inclusive, to exclusive)
	pre := time.Date(2015, 6, 15, 0, 0, 0, 0, time.UTC)
	mock.ExpectQuery(`valid_from <= \$2 AND \(valid_to IS NULL OR valid_to > \$2\)`).WithArgs("XYZ", pre).
		WillReturnRows(pgxmock.NewRows([]string{"sector"}).AddRow("TECHNOLOGY"))
	got, found, err := repo.SectorAsOf(context.Background(), "XYZ", pre)
	if err != nil || !found || got != "TECHNOLOGY" {
		t.Fatalf("SectorAsOf(2015) = %q,%v,%v", got, found, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// @AC-3: an unchanged sector performs no write (no UPDATE/INSERT, txn rolled back).
func TestApplyObservation_Unchanged_AC3(t *testing.T) {
	mock, repo := newClassMock(t)
	mock.ExpectBegin()
	mock.ExpectQuery(`FOR UPDATE`).WithArgs("XYZ").
		WillReturnRows(pgxmock.NewRows([]string{"sector"}).AddRow("TECHNOLOGY"))
	mock.ExpectRollback()
	got, err := repo.ApplyObservation(context.Background(), "XYZ", "TECHNOLOGY", time.Now())
	if err != nil || got != classification.ActionNone {
		t.Fatalf("ApplyObservation = %v, %v", got, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// @AC-12: first observation epoch-seeds via ON CONFLICT DO NOTHING; a concurrent second seed
// affects zero rows, so exactly one open epoch row exists.
func TestSeedEpoch_ConcurrentFirstObservation_AC12(t *testing.T) {
	mock, repo := newClassMock(t)
	mock.ExpectExec(`ON CONFLICT \(symbol\) WHERE valid_to IS NULL DO NOTHING`).
		WithArgs("NEWCO", "HEALTH_CARE", "GICS", "seed", classification.EpochSentinel).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))
	mock.ExpectExec(`ON CONFLICT \(symbol\) WHERE valid_to IS NULL DO NOTHING`).
		WithArgs("NEWCO", "HEALTH_CARE", "GICS", "seed", classification.EpochSentinel).
		WillReturnResult(pgxmock.NewResult("INSERT", 0))
	first, err := repo.SeedEpoch(context.Background(), "NEWCO", "HEALTH_CARE")
	if err != nil || !first {
		t.Fatalf("first seed = %v,%v want inserted", first, err)
	}
	second, err := repo.SeedEpoch(context.Background(), "NEWCO", "HEALTH_CARE")
	if err != nil || second {
		t.Fatalf("second seed = %v,%v want no-op", second, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestApplyObservation_NoOpenRowSeeds(t *testing.T) {
	mock, repo := newClassMock(t)
	mock.ExpectBegin()
	mock.ExpectQuery(`FOR UPDATE`).WithArgs("NEWCO").WillReturnError(pgx.ErrNoRows)
	mock.ExpectExec(`DO NOTHING`).WithArgs("NEWCO", "ENERGY", "GICS", "seed", classification.EpochSentinel).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))
	mock.ExpectCommit()
	mock.ExpectRollback()
	got, err := repo.ApplyObservation(context.Background(), "NEWCO", "ENERGY", time.Now())
	if err != nil || got != classification.ActionSeed {
		t.Fatalf("ApplyObservation = %v, %v", got, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// @AC-5: as-of lookup returns the version valid at the historical timestamp; uncovered → not found.
func TestSectorAsOf_AC5(t *testing.T) {
	mock, repo := newClassMock(t)
	ts := time.Date(2018, 6, 15, 0, 0, 0, 0, time.UTC)
	mock.ExpectQuery(`ORDER BY valid_from DESC LIMIT 1`).WithArgs("XYZ", ts).
		WillReturnRows(pgxmock.NewRows([]string{"sector"}).AddRow("TECHNOLOGY"))
	mock.ExpectQuery(`ORDER BY valid_from DESC LIMIT 1`).WithArgs("NEWCO", ts).WillReturnError(pgx.ErrNoRows)
	if got, found, err := repo.SectorAsOf(context.Background(), "XYZ", ts); err != nil || !found || got != "TECHNOLOGY" {
		t.Fatalf("XYZ = %q,%v,%v", got, found, err)
	}
	if _, found, err := repo.SectorAsOf(context.Background(), "NEWCO", ts); err != nil || found {
		t.Fatalf("NEWCO found=%v err=%v, want not found", found, err)
	}
}

func TestSectorHistoryAndCurrent(t *testing.T) {
	mock, repo := newClassMock(t)
	split := time.Date(2018, 10, 1, 0, 0, 0, 0, time.UTC)
	mock.ExpectQuery(`FROM marketdata.symbol_classification\s+WHERE symbol = ANY\(\$1\)`).
		WithArgs([]string{"XYZ"}, (*time.Time)(nil), (*time.Time)(nil)).
		WillReturnRows(pgxmock.NewRows([]string{"symbol", "sector", "source", "valid_from", "valid_to"}).
			AddRow("XYZ", "TECHNOLOGY", "seed", classification.EpochSentinel, &split).
			AddRow("XYZ", "COMMUNICATION_SERVICES", "fmp", split, (*time.Time)(nil)))
	rows, err := repo.SectorHistory(context.Background(), []string{"XYZ"}, nil, nil)
	if err != nil || len(rows) != 2 || rows[0].ValidTo == nil || rows[1].ValidTo != nil {
		t.Fatalf("SectorHistory = %+v, %v", rows, err)
	}
	mock.ExpectQuery(`valid_to IS NULL`).WithArgs([]string{"XYZ", "NEWCO"}).
		WillReturnRows(pgxmock.NewRows([]string{"symbol", "sector"}).AddRow("XYZ", "ENERGY"))
	cur, err := repo.CurrentSectors(context.Background(), []string{"XYZ", "NEWCO"})
	if err != nil || cur["XYZ"] != "ENERGY" || cur["NEWCO"] != "" {
		t.Fatalf("CurrentSectors = %v, %v", cur, err)
	}
}
