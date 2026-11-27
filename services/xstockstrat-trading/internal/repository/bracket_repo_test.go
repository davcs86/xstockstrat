package repository

import (
	"context"
	"errors"
	"testing"

	"github.com/pashagolub/pgxmock/v4"

	tradingv1 "github.com/xstockstrat/contracts/gen/go/trading/v1"
)

func newBracketMock(t *testing.T) (pgxmock.PgxPoolIface, *pgBracketRepo) {
	t.Helper()
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	t.Cleanup(mock.Close)
	return mock, &pgBracketRepo{pool: mock}
}

func testLegParent() BracketLegParent {
	return BracketLegParent{
		AccountID: "acct-1", OrderID: "ord-1", UserID: "user-1",
		TradingMode: "TRADING_MODE_PAPER", Symbol: "AAPL", Side: tradingv1.OrderSide_ORDER_SIDE_SELL,
	}
}

const (
	activateUpdateSQL = `(?s)UPDATE trading\.order_brackets.*SET status = \$2, stop_leg_order_id = NULLIF\(\$3, ''\)`
	legInsertSQL      = `(?s)INSERT INTO trading\.bracket_legs.*ON CONFLICT \(account_id, leg_order_id\) DO NOTHING`
)

func expectActivateLegInsert(mock pgxmock.PgxPoolIface, legID string) *pgxmock.ExpectedExec {
	p := testLegParent()
	return mock.ExpectExec(legInsertSQL).
		WithArgs(p.AccountID, legID, p.OrderID, p.UserID, p.TradingMode, p.Symbol, "sell", 0.0, 0.0, LegStatusOpen, false)
}

// TestActivateBracket_UpdatesAndInsertsBothLegsInOneTx: the ACTIVE update and one OPEN, zero-cursor
// leg row per leg id commit together.
func TestActivateBracket_UpdatesAndInsertsBothLegsInOneTx(t *testing.T) {
	mock, repo := newBracketMock(t)
	mock.ExpectBegin()
	mock.ExpectExec(activateUpdateSQL).WithArgs("brk-1", int32(3), "leg-stop", "leg-tp", "").
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	expectActivateLegInsert(mock, "leg-stop").WillReturnResult(pgxmock.NewResult("INSERT", 1))
	expectActivateLegInsert(mock, "leg-tp").WillReturnResult(pgxmock.NewResult("INSERT", 1))
	mock.ExpectCommit()

	if err := repo.ActivateBracket(context.Background(), "brk-1", "leg-stop", "leg-tp", testLegParent()); err != nil {
		t.Fatalf("ActivateBracket: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// TestActivateBracket_EmptyTakeProfitInsertsOneLeg: a stop-only bracket writes no row for the empty id.
func TestActivateBracket_EmptyTakeProfitInsertsOneLeg(t *testing.T) {
	mock, repo := newBracketMock(t)
	mock.ExpectBegin()
	mock.ExpectExec(activateUpdateSQL).WithArgs("brk-1", int32(3), "leg-stop", "", "").
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	expectActivateLegInsert(mock, "leg-stop").WillReturnResult(pgxmock.NewResult("INSERT", 1))
	mock.ExpectCommit()

	if err := repo.ActivateBracket(context.Background(), "brk-1", "leg-stop", "", testLegParent()); err != nil {
		t.Fatalf("ActivateBracket: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// TestActivateBracket_FailedInsertRollsBack: a leg INSERT error rolls the ACTIVE update back and
// is returned; nothing commits.
func TestActivateBracket_FailedInsertRollsBack(t *testing.T) {
	mock, repo := newBracketMock(t)
	insertErr := errors.New("insert failed")
	mock.ExpectBegin()
	mock.ExpectExec(activateUpdateSQL).WithArgs("brk-1", int32(3), "leg-stop", "leg-tp", "").
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	expectActivateLegInsert(mock, "leg-stop").WillReturnResult(pgxmock.NewResult("INSERT", 1))
	expectActivateLegInsert(mock, "leg-tp").WillReturnError(insertErr)
	mock.ExpectRollback()

	err := repo.ActivateBracket(context.Background(), "brk-1", "leg-stop", "leg-tp", testLegParent())
	if !errors.Is(err, insertErr) {
		t.Fatalf("ActivateBracket err = %v, want %v", err, insertErr)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

var legRowColumns = []string{
	"account_id", "leg_order_id", "order_id", "user_id", "trading_mode", "symbol", "side",
	"filled_qty", "observed_filled_qty", "status", "not_found_ticks", "adopted",
}

// TestListTrackedLegs_BindsRetiredSet: the retired set is a bound argument, not SQL text, and the
// order is non-adopted first, least recently updated first.
func TestListTrackedLegs_BindsRetiredSet(t *testing.T) {
	mock, repo := newBracketMock(t)
	rows := pgxmock.NewRows(legRowColumns).
		AddRow("acct-1", "leg-stop", "ord-1", "user-1", "TRADING_MODE_PAPER", "AAPL", "sell", 4.0, 6.0, LegStatusOpen, 2, false)
	mock.ExpectQuery(`(?s)FROM trading\.bracket_legs.*WHERE status <> ALL\(\$1\).*ORDER BY adopted ASC, updated_at ASC`).
		WithArgs(RetiredLegStatuses).
		WillReturnRows(rows)

	legs, err := repo.ListTrackedLegs(context.Background())
	if err != nil {
		t.Fatalf("ListTrackedLegs: %v", err)
	}
	want := BracketLegRecord{
		AccountID: "acct-1", LegOrderID: "leg-stop", OrderID: "ord-1", UserID: "user-1",
		TradingMode: "TRADING_MODE_PAPER", Symbol: "AAPL", Side: tradingv1.OrderSide_ORDER_SIDE_SELL,
		FilledQty: 4, ObservedFilledQty: 6, Status: LegStatusOpen, NotFoundTicks: 2,
	}
	if len(legs) != 1 || *legs[0] != want {
		t.Fatalf("legs = %+v, want [%+v]", legs, want)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// TestListAdoptionCandidates_BindsStatusesAndFlipsSide: the bracket statuses are bound, the leg side
// is the parent side flipped, and the parent's stored mode is read in the ActivateBracket encoding.
func TestListAdoptionCandidates_BindsStatusesAndFlipsSide(t *testing.T) {
	mock, repo := newBracketMock(t)
	rows := pgxmock.NewRows([]string{"account_id", "leg_order_id", "order_id", "user_id", "trading_mode", "symbol", "side"}).
		AddRow("acct-1", "leg-stop", "ord-1", "user-1", "live", "AAPL", "buy").
		AddRow("acct-2", "leg-tp", "ord-2", "user-2", "paper", "MSFT", "sell")
	mock.ExpectQuery(`(?s)FROM trading\.order_brackets.*status = ANY\(\$1\).*DISTINCT ON \(order_id\).*FROM trading\.orders.*ORDER BY order_id, created_at DESC.*NOT EXISTS.*FROM trading\.bracket_legs`).
		WithArgs([]int32{3, 4}).
		WillReturnRows(rows)

	got, err := repo.ListAdoptionCandidates(context.Background(), []int32{3, 4})
	if err != nil {
		t.Fatalf("ListAdoptionCandidates: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("got %d candidates, want 2", len(got))
	}
	if got[0].Side != tradingv1.OrderSide_ORDER_SIDE_SELL || got[0].TradingMode != "TRADING_MODE_LIVE" {
		t.Errorf("candidate 0 side/mode = %v/%q, want ORDER_SIDE_SELL/TRADING_MODE_LIVE", got[0].Side, got[0].TradingMode)
	}
	if got[1].Side != tradingv1.OrderSide_ORDER_SIDE_BUY || got[1].TradingMode != "TRADING_MODE_PAPER" {
		t.Errorf("candidate 1 side/mode = %v/%q, want ORDER_SIDE_BUY/TRADING_MODE_PAPER", got[1].Side, got[1].TradingMode)
	}
	if got[0].AccountID != "acct-1" || got[0].LegOrderID != "leg-stop" || got[0].OrderID != "ord-1" || got[0].UserID != "user-1" || got[0].Symbol != "AAPL" {
		t.Errorf("candidate 0 = %+v", got[0])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// TestInsertAdoptedLeg_ReportsConflict: the row is written adopted with the record's status and
// quantities; a conflicting second insert reports inserted=false.
func TestInsertAdoptedLeg_ReportsConflict(t *testing.T) {
	mock, repo := newBracketMock(t)
	rec := &BracketLegRecord{
		AccountID: "acct-1", LegOrderID: "leg-stop", OrderID: "ord-1", UserID: "user-1",
		TradingMode: "TRADING_MODE_PAPER", Symbol: "AAPL", Side: tradingv1.OrderSide_ORDER_SIDE_BUY,
		ObservedFilledQty: 3, Status: LegStatusBaselineRetired,
	}
	for _, affected := range []int64{1, 0} {
		mock.ExpectExec(legInsertSQL).
			WithArgs("acct-1", "leg-stop", "ord-1", "user-1", "TRADING_MODE_PAPER", "AAPL", "buy", 0.0, 3.0, LegStatusBaselineRetired, true).
			WillReturnResult(pgxmock.NewResult("INSERT", affected))
	}

	if inserted, err := repo.InsertAdoptedLeg(context.Background(), rec); err != nil || !inserted {
		t.Fatalf("first InsertAdoptedLeg = %v, %v; want true, nil", inserted, err)
	}
	if inserted, err := repo.InsertAdoptedLeg(context.Background(), rec); err != nil || inserted {
		t.Fatalf("second InsertAdoptedLeg = %v, %v; want false, nil", inserted, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// TestLegObservationAndEmitCursor_WriteTheirOwnColumns: an observation writes only the observed
// quantity and not-found count; an emit advance writes only the cursor and status.
func TestLegObservationAndEmitCursor_WriteTheirOwnColumns(t *testing.T) {
	mock, repo := newBracketMock(t)
	mock.ExpectExec(`(?s)UPDATE trading\.bracket_legs\s+SET observed_filled_qty = \$3, not_found_ticks = \$4, updated_at = NOW\(\)\s+WHERE account_id = \$1 AND leg_order_id = \$2`).
		WithArgs("acct-1", "leg-tp", 4.0, 1).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	mock.ExpectExec(`(?s)UPDATE trading\.bracket_legs\s+SET filled_qty = \$3, status = \$4, updated_at = NOW\(\)\s+WHERE account_id = \$1 AND leg_order_id = \$2`).
		WithArgs("acct-1", "leg-tp", 10.0, LegStatusFilled).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	if err := repo.RecordLegObservation(context.Background(), "acct-1", "leg-tp", 4, 1); err != nil {
		t.Fatalf("RecordLegObservation: %v", err)
	}
	if err := repo.AdvanceLegEmit(context.Background(), "acct-1", "leg-tp", 10, LegStatusFilled); err != nil {
		t.Fatalf("AdvanceLegEmit: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}
