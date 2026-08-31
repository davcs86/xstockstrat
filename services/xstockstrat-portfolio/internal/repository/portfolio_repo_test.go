package repository

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/pashagolub/pgxmock/v4"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
)

// fakeNoRowsRow simulates a pgx.Row whose Scan reports no matching row.
type fakeNoRowsRow struct{}

func (fakeNoRowsRow) Scan(dest ...any) error { return pgx.ErrNoRows }

// fakeScanErrRow simulates a genuine scan/DB failure, distinct from "no rows".
type fakeScanErrRow struct{}

func (fakeScanErrRow) Scan(dest ...any) error { return errors.New("connection reset") }

func TestScanPositionRow_NoRows_ReturnsErrPositionNotFound(t *testing.T) {
	_, err := scanPositionRow(fakeNoRowsRow{})
	if !errors.Is(err, ErrPositionNotFound) {
		t.Fatalf("expected ErrPositionNotFound, got %v", err)
	}
}

func TestScanPositionRow_OtherScanError_NotErrPositionNotFound(t *testing.T) {
	_, err := scanPositionRow(fakeScanErrRow{})
	if err == nil {
		t.Fatal("expected an error")
	}
	if errors.Is(err, ErrPositionNotFound) {
		t.Fatal("a generic scan failure must not be classified as ErrPositionNotFound")
	}
}

// TestGetPosition_ScopesToRequestedAccount is the feature-125 regression for the account_id
// passthrough fix. Two accounts hold the same (user, symbol, mode); we request the account whose
// row is NOT the most-recently-opened, so the pre-fix query — `ORDER BY opened_at DESC LIMIT 1`
// with no account predicate — would return the other account's row. pgxmock asserts the emitted
// SQL carries the `account_id=$4` predicate, binds the requested account, and that GetPosition
// returns that account's distinguishing value (qty). The service has no live-DB test harness and
// CI provisions no database, so the query is exercised through pgxmock (feature 125, FR-14).
func TestGetPosition_ScopesToRequestedAccount(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	repo := &PortfolioRepo{db: mock}

	// The requested account ("acc-target") holds qty 10; the other account ("acc-other", the
	// most-recently-opened) holds qty 999. Only the account-scoped query returns qty 10.
	rows := mock.NewRows([]string{
		"symbol", "qty", "avg_entry_price", "cost_basis", "opened_at", "trading_mode", "account_id",
		"current_price", "market_value", "unrealized_pnl", "unrealized_pnl_pct", "day_pnl",
		"day_pnl_pct", "stop_order_id", "take_profit_order_id", "source", "as_of",
	}).AddRow(
		"AAPL", 10.0, 150.0, 1500.0, time.Now(), "TRADING_MODE_PAPER", "acc-target",
		0.0, 0.0, 0.0, 0.0, 0.0, 0.0, "", "", 0, nil,
	)

	mock.ExpectQuery(`account_id=\$4`).
		WithArgs("user-1", "AAPL", commonv1.TradingMode_TRADING_MODE_PAPER.String(), "acc-target").
		WillReturnRows(rows)

	pos, err := repo.GetPosition(
		context.Background(), "user-1", "AAPL",
		commonv1.TradingMode_TRADING_MODE_PAPER, "acc-target",
	)
	if err != nil {
		t.Fatalf("GetPosition: %v", err)
	}
	if pos.Qty != 10.0 {
		t.Fatalf("expected qty 10 for the requested account, got %v (wrong account returned)", pos.Qty)
	}
	if pos.AccountId != "acc-target" {
		t.Fatalf("expected account_id acc-target, got %q", pos.AccountId)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("pgxmock expectations unmet (query did not carry the account_id predicate/arg): %v", err)
	}
}

// TestGetFeesAccum is the feature-029 fee-accumulator read (the parallel of GetRealizedAccum). It is
// read just before a full close so the sealed fees_total is accum + the closing fill's fee. The
// service has no live-DB harness, so the query runs through pgxmock (mirrors TestGetPosition above).
func TestGetFeesAccum(t *testing.T) {
	t.Run("returns the accumulated fees", func(t *testing.T) {
		mock, err := pgxmock.NewPool()
		if err != nil {
			t.Fatalf("pgxmock.NewPool: %v", err)
		}
		defer mock.Close()
		repo := &PortfolioRepo{db: mock}

		mock.ExpectQuery(`COALESCE\(fees_accum, 0\)`).
			WithArgs("user-1", "AAPL", commonv1.TradingMode_TRADING_MODE_PAPER.String(), "acc-1").
			WillReturnRows(mock.NewRows([]string{"fees_accum"}).AddRow(3.45))

		got, err := repo.GetFeesAccum(context.Background(), "user-1", "AAPL", commonv1.TradingMode_TRADING_MODE_PAPER, "acc-1")
		if err != nil {
			t.Fatalf("GetFeesAccum: %v", err)
		}
		if got != 3.45 {
			t.Fatalf("fees_accum = %v, want 3.45", got)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatalf("pgxmock expectations unmet: %v", err)
		}
	})

	t.Run("returns 0 when the position row is absent (net == gross, AC-11)", func(t *testing.T) {
		mock, err := pgxmock.NewPool()
		if err != nil {
			t.Fatalf("pgxmock.NewPool: %v", err)
		}
		defer mock.Close()
		repo := &PortfolioRepo{db: mock}

		mock.ExpectQuery(`COALESCE\(fees_accum, 0\)`).
			WithArgs("user-1", "AAPL", commonv1.TradingMode_TRADING_MODE_PAPER.String(), "acc-1").
			WillReturnError(pgx.ErrNoRows)

		got, err := repo.GetFeesAccum(context.Background(), "user-1", "AAPL", commonv1.TradingMode_TRADING_MODE_PAPER, "acc-1")
		if err != nil {
			t.Fatalf("GetFeesAccum on no-rows must not error: %v", err)
		}
		if got != 0 {
			t.Fatalf("fees_accum on no rows = %v, want 0", got)
		}
	})
}
