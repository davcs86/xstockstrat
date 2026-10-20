package repository

import (
	"context"
	"testing"

	"github.com/pashagolub/pgxmock/v4"
)

func TestUpsertOfflineRealized_WritesAllFields(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()
	repo := &PortfolioRepo{db: mock}

	fills := []RecentFill{{Symbol: "AAPL", Qty: -4, Price: 110, FilledAt: "2026-10-19T15:00:00Z"}}
	mock.ExpectExec(`(?s)INSERT INTO portfolio\.offline_account_realized.*realized_carried.*fees_since_snapshot.*fees_carried.*recent_fills.*ON CONFLICT \(account_id\) DO UPDATE`).
		WithArgs("off-1", "u1", "TRADING_MODE_PAPER", 100.0, 600.0, 1.5, 3.0,
			[]byte(`[{"symbol":"AAPL","qty":-4,"price":110,"filled_at":"2026-10-19T15:00:00Z"}]`)).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))
	err = repo.UpsertOfflineRealized(context.Background(), "off-1", "u1", "TRADING_MODE_PAPER", OfflineState{
		RealizedPnl: 100, RealizedCarried: 600, FeesSinceSnapshot: 1.5, FeesCarried: 3, RecentFills: fills,
	})
	if err != nil {
		t.Fatalf("UpsertOfflineRealized: %v", err)
	}

	// Absent recent fills are stored as [], never NULL.
	mock.ExpectExec(`INSERT INTO portfolio\.offline_account_realized`).
		WithArgs("off-1", "u1", "TRADING_MODE_PAPER", 0.0, 0.0, 0.0, 0.0, []byte(`[]`)).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))
	if err := repo.UpsertOfflineRealized(context.Background(), "off-1", "u1", "TRADING_MODE_PAPER", OfflineState{}); err != nil {
		t.Fatalf("UpsertOfflineRealized empty: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestGetOfflineStates_UserScoped(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()
	repo := &PortfolioRepo{db: mock}

	// The SQL filter is the scope: the mock returns only what a user_id-filtered query would.
	mock.ExpectQuery(`FROM portfolio\.offline_account_realized WHERE user_id=\$1 AND account_id = ANY\(\$2\)`).
		WithArgs("u1", []string{"off-1", "off-other"}).
		WillReturnRows(mock.NewRows([]string{"account_id", "realized_pnl", "realized_carried", "fees_since_snapshot", "fees_carried", "recent_fills"}).
			AddRow("off-1", 100.0, 600.0, 1.5, 3.0, []byte(`[{"symbol":"AAPL","qty":-4,"price":110,"filled_at":"2026-10-19T15:00:00Z"}]`)))
	got, err := repo.GetOfflineStates(context.Background(), "u1", []string{"off-1", "off-other"})
	if err != nil {
		t.Fatalf("GetOfflineStates: %v", err)
	}
	st, ok := got["off-1"]
	if len(got) != 1 || !ok || st.RealizedPnl != 100 || st.RealizedCarried != 600 || st.FeesSinceSnapshot != 1.5 || st.FeesCarried != 3 {
		t.Fatalf("states = %+v, want only off-1 with its stored values", got)
	}
	if len(st.RecentFills) != 1 || st.RecentFills[0].Qty != -4 || st.RecentFills[0].FilledAt != "2026-10-19T15:00:00Z" {
		t.Errorf("recent fills = %+v", st.RecentFills)
	}
	if _, leaked := got["off-other"]; leaked {
		t.Error("another user's account must not be returned")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestGetOfflineStates_EmptyIDsNoQuery(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()
	got, err := (&PortfolioRepo{db: mock}).GetOfflineStates(context.Background(), "u1", nil)
	if err != nil || len(got) != 0 {
		t.Fatalf("got (%v, %v), want an empty map", got, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expected no query: %v", err)
	}
}
