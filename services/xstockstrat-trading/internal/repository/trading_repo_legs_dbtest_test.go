//go:build dbtest

package repository

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	tradingv1 "github.com/xstockstrat/contracts/gen/go/trading/v1"
)

func TestTradingRepoLegsDB_KnownBrokerOrderIDs(t *testing.T) {
	for _, m := range execModes() {
		t.Run(m.name, func(t *testing.T) {
			pool := testPool(t, m.opt)
			ctx := context.Background()
			acct, other, user := dbtestID(t, "acct"), dbtestID(t, "other"), dbtestID(t, "user")
			repo := NewTradingRepoWithDB(pool)
			brackets := NewBracketRepo(pool)
			sell := tradingv1.OrderSide_ORDER_SIDE_SELL

			seedParentOrder(t, pool, "", acct, user, "b-ord", "AAPL", tradingv1.OrderSide_ORDER_SIDE_BUY, 10, time.Now())
			seedBracket(t, pool, uuid.NewString(), acct, brokerAlpaca, 3, "s-ob", "t-ob")
			// A resize blanks the bracket's copy, leaving the ids only in bracket_legs.
			resizedOrder := uuid.NewString()
			resized := seedBracket(t, pool, resizedOrder, acct, brokerIBKR, 2, "", "")
			if err := brackets.ActivateBracket(ctx, resized, "s-res", "t-res", legParent(acct, resizedOrder, user, "AAPL")); err != nil {
				t.Fatalf("ActivateBracket: %v", err)
			}
			if err := brackets.UpdateBracketStatus(ctx, resized, bracketStatusActive, "", "", ""); err != nil {
				t.Fatalf("UpdateBracketStatus blank: %v", err)
			}
			if _, err := brackets.InsertAdoptedLeg(ctx, &BracketLegRecord{
				AccountID: acct, LegOrderID: "s-ret", OrderID: uuid.NewString(), UserID: user,
				TradingMode: "TRADING_MODE_PAPER", Symbol: "AAPL", Side: sell, Status: LegStatusFilled,
			}); err != nil {
				t.Fatalf("InsertAdoptedLeg retired: %v", err)
			}
			// Leg columns stored as '' (CreateBracket) and as NULL (UpdateBracketStatus with empty ids).
			seedBracket(t, pool, uuid.NewString(), acct, brokerAlpaca, 3, "", "")
			nulled := seedBracket(t, pool, uuid.NewString(), acct, brokerIBKR, 3, "s-tmp", "t-tmp")
			if err := brackets.UpdateBracketStatus(ctx, nulled, bracketStatusActive, "", "", ""); err != nil {
				t.Fatalf("UpdateBracketStatus null: %v", err)
			}

			ids := []string{"b-ord", "s-ob", "t-ob", "s-res", "t-res", "s-ret", "nobody"}
			known, err := repo.KnownBrokerOrderIDs(ctx, acct, ids)
			if err != nil {
				t.Fatalf("KnownBrokerOrderIDs: %v", err)
			}
			want := map[string]bool{"b-ord": true, "s-ob": true, "t-ob": true, "s-res": true, "t-res": true, "s-ret": true}
			if len(known) != len(want) {
				t.Fatalf("KnownBrokerOrderIDs = %v, want %v", known, want)
			}
			for id := range want {
				if !known[id] {
					t.Errorf("KnownBrokerOrderIDs missing %q: %v", id, known)
				}
			}
			if _, ok := known[""]; ok {
				t.Errorf("KnownBrokerOrderIDs has an empty-string member: %v", known)
			}

			otherKnown, err := repo.KnownBrokerOrderIDs(ctx, other, ids)
			if err != nil {
				t.Fatalf("KnownBrokerOrderIDs other account: %v", err)
			}
			if len(otherKnown) != 0 {
				t.Fatalf("KnownBrokerOrderIDs under another account = %v, want empty", otherKnown)
			}
		})
	}
}

func TestTradingRepoLegsDB_NetFilledQtyBySymbol(t *testing.T) {
	for _, m := range execModes() {
		t.Run(m.name, func(t *testing.T) {
			pool := testPool(t, m.opt)
			ctx := context.Background()
			acct, other, user := dbtestID(t, "acct"), dbtestID(t, "other"), dbtestID(t, "user")
			repo := NewTradingRepoWithDB(pool)
			brackets := NewBracketRepo(pool)
			buy, sell := tradingv1.OrderSide_ORDER_SIDE_BUY, tradingv1.OrderSide_ORDER_SIDE_SELL
			now := time.Now()

			seedParentOrder(t, pool, "", acct, user, "", "AAPL", buy, 10, now)
			// One sell order stored twice; only the later row's filled_qty counts.
			sellOrder := seedParentOrder(t, pool, "", acct, user, "", "AAPL", sell, 1, now.Add(-time.Minute))
			seedParentOrder(t, pool, sellOrder, acct, user, "", "AAPL", sell, 3, now)

			leg := func(accountID, legID, symbol string, side tradingv1.OrderSide, observed float64, status string) {
				t.Helper()
				if _, err := brackets.InsertAdoptedLeg(ctx, &BracketLegRecord{
					AccountID: accountID, LegOrderID: legID, OrderID: uuid.NewString(), UserID: user,
					TradingMode: "TRADING_MODE_PAPER", Symbol: symbol, Side: side,
					ObservedFilledQty: observed, Status: status,
				}); err != nil {
					t.Fatalf("InsertAdoptedLeg %s: %v", legID, err)
				}
			}
			// filled_qty (the emit cursor) is 0; the observed column is what counts.
			leg(acct, "l-sell", "AAPL", sell, 4, LegStatusOpen)
			leg(acct, "l-retired", "AAPL", sell, 0, LegStatusFilled)
			leg(other, "l-other", "AAPL", sell, 7, LegStatusOpen)
			leg(acct, "l-outside", "TSLA", sell, 5, LegStatusOpen)
			leg(acct, "l-only", "MSFT", sell, 2, LegStatusOpen)

			net, err := repo.NetFilledQtyBySymbol(ctx, acct, []string{"AAPL", "MSFT"})
			if err != nil {
				t.Fatalf("NetFilledQtyBySymbol: %v", err)
			}
			want := map[string]float64{"AAPL": 3, "MSFT": -2}
			if len(net) != len(want) || net["AAPL"] != want["AAPL"] || net["MSFT"] != want["MSFT"] {
				t.Fatalf("NetFilledQtyBySymbol = %v, want %v (10 - 3 - 4 = 3; MSFT leg-only -2)", net, want)
			}
		})
	}
}
