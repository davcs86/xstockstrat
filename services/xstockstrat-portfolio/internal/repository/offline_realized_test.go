package repository

import (
	"context"
	"testing"

	"github.com/pashagolub/pgxmock/v4"
)

// TestGetOfflineRealized_FoundAndMissing covers the offline account-grain realized read (feature
// 157): a present row returns (value, true); no row returns (0, false) — not an error — so a broker
// account (which never has a row) leaves Portfolio.realized_pnl unset. The service has no live-DB
// harness and CI provisions no database, so the query runs through pgxmock.
func TestGetOfflineRealized_FoundAndMissing(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()
	repo := &PortfolioRepo{db: mock}

	// Found: a genuine $0 realized is still a present row (offline distinguishability).
	mock.ExpectQuery(`realized_pnl FROM portfolio.offline_account_realized WHERE account_id=\$1`).
		WithArgs("off-1").
		WillReturnRows(mock.NewRows([]string{"realized_pnl"}).AddRow(97.50))
	v, ok, err := repo.GetOfflineRealized(context.Background(), "off-1")
	if err != nil || !ok || v != 97.50 {
		t.Fatalf("found: got (%v, %v, %v), want (97.5, true, nil)", v, ok, err)
	}

	// Missing: no row → (0, false, nil), never an error.
	mock.ExpectQuery(`offline_account_realized WHERE account_id=\$1`).
		WithArgs("brk-1").
		WillReturnRows(mock.NewRows([]string{"realized_pnl"}))
	v, ok, err = repo.GetOfflineRealized(context.Background(), "brk-1")
	if err != nil || ok || v != 0 {
		t.Fatalf("missing: got (%v, %v, %v), want (0, false, nil)", v, ok, err)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("pgxmock expectations unmet: %v", err)
	}
}

// TestGetOfflineRealized_EmptyAccountID short-circuits without a query (all-accounts GetPortfolio).
func TestGetOfflineRealized_EmptyAccountID(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()
	repo := &PortfolioRepo{db: mock}

	v, ok, err := repo.GetOfflineRealized(context.Background(), "")
	if err != nil || ok || v != 0 {
		t.Fatalf("empty accountID: got (%v, %v, %v), want (0, false, nil)", v, ok, err)
	}
	// No query should have been issued.
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expected no query for empty accountID: %v", err)
	}
}
