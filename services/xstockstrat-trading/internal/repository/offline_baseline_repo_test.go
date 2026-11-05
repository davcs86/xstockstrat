package repository

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/pashagolub/pgxmock/v4"
)

const (
	headerQueryRe = `(?s)FROM trading\.offline_snapshot_headers.*ORDER BY as_of DESC, created_at DESC LIMIT 1`
	rowsQueryRe   = `(?s)FROM trading\.offline_position_baselines.*client_snapshot_id = \$2.*qty <> 0`
)

// UpsertBaselineSnapshot and DeleteBaselinesByAccount run on r.pool (not mockable); their transaction
// SQL is proven by SQL-shape review only, and their rules at the service level via fakeBaselineStore.
func TestEffectiveBaseline_HeaderThenRows(t *testing.T) {
	asOf := time.Date(2026, 9, 30, 20, 0, 0, 0, time.UTC)

	t.Run("header carry and non-zero rows", func(t *testing.T) {
		mock, err := pgxmock.NewPool()
		if err != nil {
			t.Fatalf("pgxmock.NewPool: %v", err)
		}
		defer mock.Close()
		mock.ExpectQuery(headerQueryRe).WithArgs("acct-1").
			WillReturnRows(pgxmock.NewRows([]string{"client_snapshot_id", "as_of", "realized_carried", "fees_carried"}).
				AddRow("snap-2", asOf, 125.5, 3.25))
		mock.ExpectQuery(rowsQueryRe).WithArgs("acct-1", "snap-2").
			WillReturnRows(pgxmock.NewRows([]string{"symbol", "qty", "avg_cost_per_share"}).
				AddRow("AAPL", 10.0, 150.0).
				AddRow("MSFT", 0.0, 300.0))

		hdr, ok, err := NewTradingRepoWithDB(mock).EffectiveBaselineByAccount(context.Background(), "acct-1")
		if err != nil || !ok {
			t.Fatalf("EffectiveBaselineByAccount: ok=%v err=%v", ok, err)
		}
		if hdr.ClientSnapshotID != "snap-2" || !hdr.AsOf.Equal(asOf) || hdr.RealizedCarried != 125.5 || hdr.FeesCarried != 3.25 {
			t.Errorf("header = %+v", hdr)
		}
		if len(hdr.Lots) != 1 || hdr.Lots["AAPL"].Qty != 10 || hdr.Lots["AAPL"].CostBasis != 1500 {
			t.Errorf("lots = %+v, want only AAPL{10,1500}", hdr.Lots)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Error(err)
		}
	})

	t.Run("header without rows is a full flatten", func(t *testing.T) {
		mock, err := pgxmock.NewPool()
		if err != nil {
			t.Fatalf("pgxmock.NewPool: %v", err)
		}
		defer mock.Close()
		mock.ExpectQuery(headerQueryRe).WithArgs("acct-1").
			WillReturnRows(pgxmock.NewRows([]string{"client_snapshot_id", "as_of", "realized_carried", "fees_carried"}).
				AddRow("snap-flat", asOf, 40.0, 1.0))
		mock.ExpectQuery(rowsQueryRe).WithArgs("acct-1", "snap-flat").
			WillReturnRows(pgxmock.NewRows([]string{"symbol", "qty", "avg_cost_per_share"}))

		hdr, ok, err := NewTradingRepoWithDB(mock).EffectiveBaselineByAccount(context.Background(), "acct-1")
		if err != nil || !ok {
			t.Fatalf("full flatten: ok=%v err=%v, want ok=true", ok, err)
		}
		if len(hdr.Lots) != 0 || hdr.RealizedCarried != 40 {
			t.Errorf("full flatten header = %+v", hdr)
		}
	})

	t.Run("no header means no baseline", func(t *testing.T) {
		mock, err := pgxmock.NewPool()
		if err != nil {
			t.Fatalf("pgxmock.NewPool: %v", err)
		}
		defer mock.Close()
		mock.ExpectQuery(headerQueryRe).WithArgs("acct-1").WillReturnError(pgx.ErrNoRows)

		_, ok, err := NewTradingRepoWithDB(mock).EffectiveBaselineByAccount(context.Background(), "acct-1")
		if err != nil || ok {
			t.Fatalf("no header: ok=%v err=%v, want ok=false err=nil", ok, err)
		}
	})
}
