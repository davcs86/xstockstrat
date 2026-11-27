//go:build dbtest

package repository

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"google.golang.org/protobuf/types/known/timestamppb"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	tradingv1 "github.com/xstockstrat/contracts/gen/go/trading/v1"
)

// dbtestUserPrefix scopes every seeded row so cleanup never touches data the tests did not create.
const dbtestUserPrefix = "it-311-"

// testPool connects to the migrated database at TRADING_DB_TEST_URL. lock_timeout makes any
// lock wait fail fast, so a test that would block reports an error instead of hanging.
func testPool(t *testing.T, opts ...func(*pgxpool.Config)) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("TRADING_DB_TEST_URL")
	if url == "" {
		if os.Getenv("CI") == "true" {
			t.Fatal("TRADING_DB_TEST_URL is unset under CI=true; the trading-db-test job must provide it")
		}
		t.Skip("TRADING_DB_TEST_URL unset; skipping real-Postgres test")
	}
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatalf("pgxpool.ParseConfig: %v", err)
	}
	cfg.ConnConfig.RuntimeParams["lock_timeout"] = "500ms"
	for _, opt := range opts {
		opt(cfg)
	}
	ctx := context.Background()
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatalf("pgxpool.NewWithConfig: %v", err)
	}
	t.Cleanup(pool.Close)
	t.Cleanup(func() {
		if _, err := pool.Exec(context.Background(),
			`DELETE FROM trading.orders WHERE user_id LIKE $1`, dbtestUserPrefix+"%"); err != nil {
			t.Errorf("cleanup orders: %v", err)
		}
	})
	t.Cleanup(func() {
		if _, err := pool.Exec(context.Background(),
			`DELETE FROM trading.order_brackets WHERE account_id LIKE $1`, dbtestUserPrefix+"%"); err != nil {
			t.Errorf("cleanup order_brackets: %v", err)
		}
	})
	t.Cleanup(func() {
		if _, err := pool.Exec(context.Background(),
			`DELETE FROM trading.bracket_legs WHERE user_id LIKE $1`, dbtestUserPrefix+"%"); err != nil {
			t.Errorf("cleanup bracket_legs: %v", err)
		}
	})
	return pool
}

// execModes runs each case once per pgx query mode; exec is the DB_PGBOUNCER mode (pool.go).
func execModes() []struct {
	name string
	opt  func(*pgxpool.Config)
} {
	return []struct {
		name string
		opt  func(*pgxpool.Config)
	}{
		{name: "default", opt: func(*pgxpool.Config) {}},
		{name: "exec", opt: func(c *pgxpool.Config) { c.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeExec }},
	}
}

// dbtestID returns a cleanup-scoped id unique to this test and role, so cases never share rows.
func dbtestID(t *testing.T, role string) string {
	t.Helper()
	return fmt.Sprintf("%s%s-%s-%d", dbtestUserPrefix, t.Name(), role, time.Now().UnixNano())
}

// seedParentOrder writes one trading.orders row and returns its order id; an empty orderID gets a
// fresh UUID, and reusing an id with another createdAt adds a second row for the same order.
func seedParentOrder(t *testing.T, pool *pgxpool.Pool, orderID, accountID, userID, brokerOrderID, symbol string,
	side tradingv1.OrderSide, filledQty float64, createdAt time.Time) string {
	t.Helper()
	if orderID == "" {
		orderID = uuid.NewString()
	}
	err := NewTradingRepoWithDB(pool).UpsertOrder(context.Background(), &tradingv1.Order{
		OrderId:       orderID,
		AccountId:     accountID,
		UserId:        userID,
		BrokerOrderId: brokerOrderID,
		Symbol:        symbol,
		Side:          side,
		OrderType:     tradingv1.OrderType_ORDER_TYPE_MARKET,
		Status:        tradingv1.OrderStatus_ORDER_STATUS_FILLED,
		Qty:           filledQty,
		FilledQty:     filledQty,
		TradingMode:   commonv1.TradingMode_TRADING_MODE_PAPER,
		CreatedAt:     timestamppb.New(createdAt),
	})
	if err != nil {
		t.Fatalf("seedParentOrder %s: %v", orderID, err)
	}
	return orderID
}

const (
	brokerAlpaca int32 = 1
	brokerIBKR   int32 = 2
)

func legParent(accountID, orderID, userID, symbol string) BracketLegParent {
	return BracketLegParent{
		AccountID: accountID, OrderID: orderID, UserID: userID,
		TradingMode: "TRADING_MODE_PAPER", Symbol: symbol, Side: tradingv1.OrderSide_ORDER_SIDE_SELL,
	}
}

// seedBracket writes one trading.order_brackets row for orderID and returns the bracket id.
func seedBracket(t *testing.T, pool *pgxpool.Pool, orderID, accountID string, brokerType, status int32,
	stopLegID, takeProfitLegID string) string {
	t.Helper()
	rec := &OrderBracketRecord{
		OrderID:              orderID,
		AccountID:            accountID,
		BrokerType:           brokerType,
		Status:               status,
		BracketStopPrice:     95,
		StopLegOrderID:       stopLegID,
		TakeProfitLegOrderID: takeProfitLegID,
		ProtectionDeadline:   time.Now().Add(time.Minute),
	}
	if err := NewBracketRepo(pool).CreateBracket(context.Background(), rec); err != nil {
		t.Fatalf("seedBracket %s: %v", orderID, err)
	}
	return rec.ID
}
