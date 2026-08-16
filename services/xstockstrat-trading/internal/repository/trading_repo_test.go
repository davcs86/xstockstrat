package repository

import (
	"context"
	"testing"
	"time"

	"github.com/pashagolub/pgxmock/v4"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	tradingv1 "github.com/xstockstrat/contracts/gen/go/trading/v1"
	"github.com/xstockstrat/trading/internal/testdata"
)

// TestGetOrder_ExercisesIntentLateralJoin is the red-before-green regression guard for the
// intentLateralJoinSQL ambiguous-column fix (trading_repo.go:87): the ExpectQuery regex requires
// the literal substring "intent_updated_at" — before the Step 1 rename, GetOrder's emitted SQL
// text still reads bare "updated_at" and this test fails red (pgxmock: "call to QueryRow was not
// expected"); after the rename, it matches green.
func TestGetOrder_ExercisesIntentLateralJoin(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	repo := &TradingRepo{db: mock}
	updatedAt := time.Now().Truncate(time.Second)
	rows := pgxmock.NewRows(testdata.OrderRowColumns).AddRow(testdata.NewOrderRow("order-1", updatedAt, 2)...)

	mock.ExpectQuery(`(?s)LEFT JOIN LATERAL.*intent_updated_at.*WHERE order_id = \$1`).
		WithArgs("order-1").
		WillReturnRows(rows)

	o, err := repo.GetOrder(context.Background(), "order-1")
	if err != nil {
		t.Fatalf("GetOrder: %v", err)
	}
	if !o.UpdatedAt.AsTime().Equal(updatedAt) {
		t.Errorf("UpdatedAt = %v, want %v (trading.orders' own value, unaffected by the intent_updated_at rename)", o.UpdatedAt.AsTime(), updatedAt)
	}
	if int16(o.IntentState) != 2 {
		t.Errorf("IntentState = %v, want 2", o.IntentState)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// TestListOrders_ExercisesIntentLateralJoinWithMultipleFilters is defensive coverage (beyond
// this bug's literal scope, per design.md) for the positional $N filter builder fails.md already
// flagged once in this function (2026-08-06: a missing i++ went unnoticed until a later feature
// extended it) — asserting two simultaneous optional filters land on distinct, correctly-ordered
// placeholders catches a future arg-index-skip regression the same way the historical bug would
// have been caught.
func TestListOrders_ExercisesIntentLateralJoinWithMultipleFilters(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	repo := &TradingRepo{db: mock}
	updatedAt := time.Now().Truncate(time.Second)
	rows := pgxmock.NewRows(testdata.OrderRowColumns).AddRow(testdata.NewOrderRow("order-2", updatedAt, 1)...)

	mock.ExpectQuery(`(?s)LEFT JOIN LATERAL.*intent_updated_at.*AND user_id = \$1.*AND status = \$2`).
		WithArgs("user-1", "new").
		WillReturnRows(rows)

	orders, err := repo.ListOrders(
		context.Background(),
		"user-1",
		tradingv1.OrderStatus_ORDER_STATUS_NEW,
		commonv1.TradingMode_TRADING_MODE_UNSPECIFIED,
		"", "", tradingv1.OrderSide_ORDER_SIDE_UNSPECIFIED, tradingv1.OrderType_ORDER_TYPE_UNSPECIFIED,
		"", nil,
	)
	if err != nil {
		t.Fatalf("ListOrders: %v", err)
	}
	if len(orders) != 1 {
		t.Fatalf("len(orders) = %d, want 1", len(orders))
	}
	if !orders[0].UpdatedAt.AsTime().Equal(updatedAt) {
		t.Errorf("UpdatedAt = %v, want %v", orders[0].UpdatedAt.AsTime(), updatedAt)
	}
	if int16(orders[0].IntentState) != 1 {
		t.Errorf("IntentState = %v, want 1", orders[0].IntentState)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// TestListSubmittedOrders_ExercisesIntentLateralJoin covers the third and final caller of
// intentLateralJoinSQL — no filter args, but the same LATERAL-join ambiguity risk.
func TestListSubmittedOrders_ExercisesIntentLateralJoin(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	repo := &TradingRepo{db: mock}
	updatedAt := time.Now().Truncate(time.Second)
	rows := pgxmock.NewRows(testdata.OrderRowColumns).AddRow(testdata.NewOrderRow("order-3", updatedAt, 2)...)

	mock.ExpectQuery(`(?s)LEFT JOIN LATERAL.*intent_updated_at.*status IN \('new', 'partially_filled'\)`).
		WillReturnRows(rows)

	orders, err := repo.ListSubmittedOrders(context.Background())
	if err != nil {
		t.Fatalf("ListSubmittedOrders: %v", err)
	}
	if len(orders) != 1 {
		t.Fatalf("len(orders) = %d, want 1", len(orders))
	}
	if !orders[0].UpdatedAt.AsTime().Equal(updatedAt) {
		t.Errorf("UpdatedAt = %v, want %v", orders[0].UpdatedAt.AsTime(), updatedAt)
	}
	if int16(orders[0].IntentState) != 2 {
		t.Errorf("IntentState = %v, want 2", orders[0].IntentState)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}
