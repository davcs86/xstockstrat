//go:build dbtest

package repository

import (
	"context"
	"errors"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	tradingv1 "github.com/xstockstrat/contracts/gen/go/trading/v1"
)

// readLegs returns the account's bracket_legs rows ordered by leg id.
func readLegs(t *testing.T, pool *pgxpool.Pool, accountID string) []BracketLegRecord {
	t.Helper()
	rows, err := pool.Query(context.Background(), `
		SELECT account_id, leg_order_id, order_id::text, user_id, trading_mode, symbol, side,
		       filled_qty, observed_filled_qty, status, not_found_ticks, adopted
		FROM trading.bracket_legs WHERE account_id = $1 ORDER BY leg_order_id`, accountID)
	if err != nil {
		t.Fatalf("readLegs: %v", err)
	}
	defer rows.Close()
	var out []BracketLegRecord
	for rows.Next() {
		var (
			rec  BracketLegRecord
			side string
		)
		if err := rows.Scan(&rec.AccountID, &rec.LegOrderID, &rec.OrderID, &rec.UserID, &rec.TradingMode,
			&rec.Symbol, &side, &rec.FilledQty, &rec.ObservedFilledQty, &rec.Status, &rec.NotFoundTicks,
			&rec.Adopted); err != nil {
			t.Fatalf("readLegs scan: %v", err)
		}
		rec.Side = parseSide(side)
		out = append(out, rec)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("readLegs rows: %v", err)
	}
	return out
}

func readLeg(t *testing.T, pool *pgxpool.Pool, accountID, legID string) (BracketLegRecord, bool) {
	t.Helper()
	for _, l := range readLegs(t, pool, accountID) {
		if l.LegOrderID == legID {
			return l, true
		}
	}
	return BracketLegRecord{}, false
}

// trackedLegIDs returns the account's ListTrackedLegs ids in the order the repository returned them.
func trackedLegIDs(t *testing.T, repo BracketRepository, accountID string) []string {
	t.Helper()
	legs, err := repo.ListTrackedLegs(context.Background())
	if err != nil {
		t.Fatalf("ListTrackedLegs: %v", err)
	}
	var ids []string
	for _, l := range legs {
		if l.AccountID == accountID {
			ids = append(ids, l.LegOrderID)
		}
	}
	return ids
}

// candidateKeys returns the account's adoption candidates as sorted "leg|side|symbol" strings.
func candidateKeys(t *testing.T, repo BracketRepository, accountID string, statuses []int32) []string {
	t.Helper()
	cands, err := repo.ListAdoptionCandidates(context.Background(), statuses)
	if err != nil {
		t.Fatalf("ListAdoptionCandidates: %v", err)
	}
	var keys []string
	for _, c := range cands {
		if c.AccountID == accountID {
			keys = append(keys, c.LegOrderID+"|"+sideStr(c.Side)+"|"+c.Symbol)
		}
	}
	sort.Strings(keys)
	return keys
}

func equalStrings(a, b []string) bool {
	return strings.Join(a, ",") == strings.Join(b, ",")
}

func TestBracketLegsDB_ActivateRows(t *testing.T) {
	for _, m := range execModes() {
		t.Run(m.name, func(t *testing.T) {
			pool := testPool(t, m.opt)
			ctx := context.Background()
			acct, user := dbtestID(t, "acct"), dbtestID(t, "user")
			orderID := uuid.NewString()
			id := seedBracket(t, pool, orderID, acct, brokerAlpaca, 2, "", "")
			repo := NewBracketRepo(pool)

			if err := repo.ActivateBracket(ctx, id, "s1", "t1", legParent(acct, orderID, user, "AAPL")); err != nil {
				t.Fatalf("ActivateBracket: %v", err)
			}
			b, err := repo.GetBracketByOrderID(ctx, orderID)
			if err != nil || b == nil {
				t.Fatalf("GetBracketByOrderID = %v, %v", b, err)
			}
			if b.Status != bracketStatusActive || b.StopLegOrderID != "s1" || b.TakeProfitLegOrderID != "t1" {
				t.Fatalf("bracket = status %d legs %q/%q, want 3 s1/t1", b.Status, b.StopLegOrderID, b.TakeProfitLegOrderID)
			}
			legs := readLegs(t, pool, acct)
			if len(legs) != 2 {
				t.Fatalf("bracket_legs rows = %d, want 2", len(legs))
			}
			for i, want := range []string{"s1", "t1"} {
				got := legs[i]
				if got.LegOrderID != want || got.FilledQty != 0 || got.ObservedFilledQty != 0 ||
					got.Status != LegStatusOpen || got.Adopted || got.AccountID != acct || got.OrderID != orderID ||
					got.UserID != user || got.TradingMode != "TRADING_MODE_PAPER" || got.Symbol != "AAPL" ||
					got.Side != tradingv1.OrderSide_ORDER_SIDE_SELL {
					t.Errorf("leg %d = %+v", i, got)
				}
			}
		})
	}
}

func TestBracketLegsDB_ActivateDuplicateGuard(t *testing.T) {
	for _, m := range execModes() {
		t.Run(m.name, func(t *testing.T) {
			pool := testPool(t, m.opt)
			ctx := context.Background()
			acct, user := dbtestID(t, "acct"), dbtestID(t, "user")
			orderID := uuid.NewString()
			id := seedBracket(t, pool, orderID, acct, brokerIBKR, 2, "", "")
			repo := NewBracketRepo(pool)
			parent := legParent(acct, orderID, user, "AAPL")

			if err := repo.ActivateBracket(ctx, id, "s1", "t1", parent); err != nil {
				t.Fatalf("first ActivateBracket: %v", err)
			}
			if err := repo.AdvanceLegEmit(ctx, acct, "s1", 4, LegStatusOpen); err != nil {
				t.Fatalf("AdvanceLegEmit: %v", err)
			}
			if err := repo.ActivateBracket(ctx, id, "s1", "t1", parent); err != nil {
				t.Fatalf("second ActivateBracket: %v", err)
			}
			if n := len(readLegs(t, pool, acct)); n != 2 {
				t.Fatalf("bracket_legs rows = %d, want 2", n)
			}
			if leg, _ := readLeg(t, pool, acct, "s1"); leg.FilledQty != 4 {
				t.Fatalf("s1 filled_qty = %v, want 4 (ON CONFLICT DO NOTHING keeps the cursor)", leg.FilledQty)
			}
		})
	}
}

func TestBracketLegsDB_ActivateEmptyTakeProfit(t *testing.T) {
	for _, m := range execModes() {
		t.Run(m.name, func(t *testing.T) {
			pool := testPool(t, m.opt)
			ctx := context.Background()
			acct, user := dbtestID(t, "acct"), dbtestID(t, "user")
			orderID := uuid.NewString()
			id := seedBracket(t, pool, orderID, acct, brokerIBKR, 2, "", "")

			if err := NewBracketRepo(pool).ActivateBracket(ctx, id, "s1", "", legParent(acct, orderID, user, "AAPL")); err != nil {
				t.Fatalf("ActivateBracket: %v", err)
			}
			legs := readLegs(t, pool, acct)
			if len(legs) != 1 || legs[0].LegOrderID != "s1" {
				t.Fatalf("bracket_legs = %+v, want only s1", legs)
			}
			var tpNull bool
			if err := pool.QueryRow(ctx,
				`SELECT take_profit_leg_order_id IS NULL FROM trading.order_brackets WHERE id = $1`, id).Scan(&tpNull); err != nil {
				t.Fatalf("select take_profit_leg_order_id: %v", err)
			}
			if !tpNull {
				t.Fatal("take_profit_leg_order_id is not NULL after an empty take-profit id")
			}
		})
	}
}

func TestBracketLegsDB_ActivateRollsBack(t *testing.T) {
	for _, m := range execModes() {
		t.Run(m.name, func(t *testing.T) {
			pool := testPool(t, m.opt)
			ctx := context.Background()
			acct, user := dbtestID(t, "acct"), dbtestID(t, "user")
			orderID := uuid.NewString()
			id := seedBracket(t, pool, orderID, acct, brokerAlpaca, 2, "", "")
			readBracket := func() (int32, *string, *string) {
				var (
					status   int32
					stop, tp *string
				)
				if err := pool.QueryRow(ctx,
					`SELECT status, stop_leg_order_id, take_profit_leg_order_id FROM trading.order_brackets WHERE id = $1`,
					id).Scan(&status, &stop, &tp); err != nil {
					t.Fatalf("read bracket: %v", err)
				}
				return status, stop, tp
			}
			preStatus, preStop, preTP := readBracket()

			// Only the leg INSERT binds Symbol, so the UPDATE runs first and the INSERT fails.
			err := NewBracketRepo(pool).ActivateBracket(ctx, id, "s1", "t1", legParent(acct, orderID, user, "AA\x00PL"))
			var pgErr *pgconn.PgError
			if !errors.As(err, &pgErr) {
				t.Fatalf("ActivateBracket err = %v, want a server *pgconn.PgError", err)
			}
			if pgErr.Code != "22021" {
				t.Fatalf("SQLSTATE = %s, want 22021", pgErr.Code)
			}
			status, stop, tp := readBracket()
			if status != preStatus || !equalNullable(stop, preStop) || !equalNullable(tp, preTP) {
				t.Fatalf("bracket after failure = %d %v %v, want pre-call %d %v %v (UPDATE rolled back)",
					status, stop, tp, preStatus, preStop, preTP)
			}
			if legs := readLegs(t, pool, acct); len(legs) != 0 {
				t.Fatalf("bracket_legs rows = %+v, want none", legs)
			}
		})
	}
}

func equalNullable(a, b *string) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

func TestBracketLegsDB_ListTrackedLegs(t *testing.T) {
	for _, m := range execModes() {
		t.Run(m.name, func(t *testing.T) {
			pool := testPool(t, m.opt)
			ctx := context.Background()
			acct, user := dbtestID(t, "acct"), dbtestID(t, "user")
			repo := NewBracketRepo(pool)

			// The adopted OPEN leg is written first, so only the adopted key can sort it last.
			if _, err := repo.InsertAdoptedLeg(ctx, &BracketLegRecord{
				AccountID: acct, LegOrderID: "adopted-open", OrderID: uuid.NewString(), UserID: user,
				TradingMode: "TRADING_MODE_PAPER", Symbol: "AAPL", Side: tradingv1.OrderSide_ORDER_SIDE_SELL,
				Status: LegStatusOpen,
			}); err != nil {
				t.Fatalf("InsertAdoptedLeg open: %v", err)
			}
			for _, leg := range []string{"first", "second"} {
				orderID := uuid.NewString()
				id := seedBracket(t, pool, orderID, acct, brokerAlpaca, 2, "", "")
				if err := repo.ActivateBracket(ctx, id, leg, "", legParent(acct, orderID, user, "AAPL")); err != nil {
					t.Fatalf("ActivateBracket %s: %v", leg, err)
				}
			}
			for _, st := range RetiredLegStatuses {
				if _, err := repo.InsertAdoptedLeg(ctx, &BracketLegRecord{
					AccountID: acct, LegOrderID: "retired-" + st, OrderID: uuid.NewString(), UserID: user,
					TradingMode: "TRADING_MODE_PAPER", Symbol: "AAPL", Side: tradingv1.OrderSide_ORDER_SIDE_SELL,
					Status: st,
				}); err != nil {
					t.Fatalf("InsertAdoptedLeg %s: %v", st, err)
				}
			}

			got := trackedLegIDs(t, repo, acct)
			want := []string{"first", "second", "adopted-open"}
			if !equalStrings(got, want) {
				t.Fatalf("ListTrackedLegs = %v, want %v", got, want)
			}
		})
	}
}

func TestBracketLegsDB_ListAdoptionCandidates(t *testing.T) {
	for _, m := range execModes() {
		t.Run(m.name, func(t *testing.T) {
			pool := testPool(t, m.opt)
			ctx := context.Background()
			acct, user := dbtestID(t, "acct"), dbtestID(t, "user")
			repo := NewBracketRepo(pool)
			now := time.Now()
			buy, sell := tradingv1.OrderSide_ORDER_SIDE_BUY, tradingv1.OrderSide_ORDER_SIDE_SELL

			// (a) ACTIVE; the parent's later row is a sell, so both legs close with a buy.
			a := seedParentOrder(t, pool, "", acct, user, "", "AAPL", buy, 10, now.Add(-time.Hour))
			seedParentOrder(t, pool, a, acct, user, "", "AAPL", sell, 10, now)
			seedBracket(t, pool, a, acct, brokerAlpaca, 3, "s-a", "t-a")
			// (b) CANCELING.
			b := seedParentOrder(t, pool, "", acct, user, "", "MSFT", buy, 5, now)
			seedBracket(t, pool, b, acct, brokerIBKR, 4, "s-b", "")
			// (c) CANCELED.
			c := seedParentOrder(t, pool, "", acct, user, "", "AMZN", buy, 5, now)
			seedBracket(t, pool, c, acct, brokerAlpaca, 5, "s-c", "t-c")
			// (d) ACTIVE with only a stop id: CreateBracket stores '' for the take-profit.
			d := seedParentOrder(t, pool, "", acct, user, "", "NVDA", buy, 5, now)
			seedBracket(t, pool, d, acct, brokerIBKR, 3, "s-d", "")
			// (e) ACTIVE whose stop id is already tracked.
			e := seedParentOrder(t, pool, "", acct, user, "", "TSLA", buy, 5, now)
			seedBracket(t, pool, e, acct, brokerAlpaca, 3, "s-e", "t-e")
			if _, err := repo.InsertAdoptedLeg(ctx, &BracketLegRecord{
				AccountID: acct, LegOrderID: "s-e", OrderID: e, UserID: user, TradingMode: "TRADING_MODE_PAPER",
				Symbol: "TSLA", Side: sell, Status: LegStatusOpen,
			}); err != nil {
				t.Fatalf("InsertAdoptedLeg s-e: %v", err)
			}
			// (f) ACTIVE with no parent order.
			seedBracket(t, pool, uuid.NewString(), acct, brokerIBKR, 3, "s-f", "t-f")

			got := candidateKeys(t, repo, acct, []int32{3, 4})
			want := []string{"s-a|buy|AAPL", "s-b|sell|MSFT", "s-d|sell|NVDA", "t-a|buy|AAPL", "t-e|sell|TSLA"}
			if !equalStrings(got, want) {
				t.Fatalf("candidates {3,4} = %v, want %v", got, want)
			}
			got = candidateKeys(t, repo, acct, []int32{3})
			want = []string{"s-a|buy|AAPL", "s-d|sell|NVDA", "t-a|buy|AAPL", "t-e|sell|TSLA"}
			if !equalStrings(got, want) {
				t.Fatalf("candidates {3} = %v, want %v", got, want)
			}
		})
	}
}

func TestBracketLegsDB_InsertAdoptedLeg(t *testing.T) {
	for _, m := range execModes() {
		t.Run(m.name, func(t *testing.T) {
			pool := testPool(t, m.opt)
			ctx := context.Background()
			acct, user := dbtestID(t, "acct"), dbtestID(t, "user")
			repo := NewBracketRepo(pool)
			rec := &BracketLegRecord{
				AccountID: acct, LegOrderID: "a1", OrderID: uuid.NewString(), UserID: user,
				TradingMode: "TRADING_MODE_PAPER", Symbol: "AAPL", Side: tradingv1.OrderSide_ORDER_SIDE_SELL,
				FilledQty: 2, ObservedFilledQty: 3, Status: LegStatusOpen,
			}
			inserted, err := repo.InsertAdoptedLeg(ctx, rec)
			if err != nil || !inserted {
				t.Fatalf("first InsertAdoptedLeg = %v, %v; want true, nil", inserted, err)
			}
			leg, _ := readLeg(t, pool, acct, "a1")
			if !leg.Adopted || leg.Status != LegStatusOpen || leg.FilledQty != 2 || leg.ObservedFilledQty != 3 {
				t.Fatalf("adopted leg = %+v", leg)
			}
			again := *rec
			again.FilledQty, again.ObservedFilledQty, again.Status = 9, 9, LegStatusFilled
			inserted, err = repo.InsertAdoptedLeg(ctx, &again)
			if err != nil || inserted {
				t.Fatalf("second InsertAdoptedLeg = %v, %v; want false, nil", inserted, err)
			}
			if after, _ := readLeg(t, pool, acct, "a1"); after != leg {
				t.Fatalf("leg after conflict = %+v, want unchanged %+v", after, leg)
			}

			// A retired insert removes an existing candidate and is not tracked.
			parent := seedParentOrder(t, pool, "", acct, user, "", "MSFT", tradingv1.OrderSide_ORDER_SIDE_BUY, 5, time.Now())
			seedBracket(t, pool, parent, acct, brokerAlpaca, 3, "r1", "")
			if got := candidateKeys(t, repo, acct, []int32{3, 4}); !equalStrings(got, []string{"r1|sell|MSFT"}) {
				t.Fatalf("candidates before retired insert = %v, want [r1|sell|MSFT]", got)
			}
			if _, err := repo.InsertAdoptedLeg(ctx, &BracketLegRecord{
				AccountID: acct, LegOrderID: "r1", OrderID: parent, UserID: user, TradingMode: "TRADING_MODE_PAPER",
				Symbol: "MSFT", Side: tradingv1.OrderSide_ORDER_SIDE_SELL, Status: LegStatusNotOpenAtAdoption,
			}); err != nil {
				t.Fatalf("InsertAdoptedLeg retired: %v", err)
			}
			if got := candidateKeys(t, repo, acct, []int32{3, 4}); len(got) != 0 {
				t.Fatalf("candidates after retired insert = %v, want none", got)
			}
			if got := trackedLegIDs(t, repo, acct); !equalStrings(got, []string{"a1"}) {
				t.Fatalf("ListTrackedLegs = %v, want [a1]", got)
			}
		})
	}
}

func TestBracketLegsDB_ObservationAndEmitCursor(t *testing.T) {
	for _, m := range execModes() {
		t.Run(m.name, func(t *testing.T) {
			pool := testPool(t, m.opt)
			ctx := context.Background()
			acct, user := dbtestID(t, "acct"), dbtestID(t, "user")
			orderID := uuid.NewString()
			id := seedBracket(t, pool, orderID, acct, brokerAlpaca, 2, "", "")
			repo := NewBracketRepo(pool)
			if err := repo.ActivateBracket(ctx, id, "tp1", "", legParent(acct, orderID, user, "AAPL")); err != nil {
				t.Fatalf("ActivateBracket: %v", err)
			}

			if err := repo.RecordLegObservation(ctx, acct, "tp1", 4, 2); err != nil {
				t.Fatalf("RecordLegObservation: %v", err)
			}
			leg, _ := readLeg(t, pool, acct, "tp1")
			if leg.ObservedFilledQty != 4 || leg.NotFoundTicks != 2 || leg.FilledQty != 0 {
				t.Fatalf("after observation = %+v, want observed 4, not_found 2, filled 0", leg)
			}

			// @AC-5 at the SQL layer: the cursor moves to the partial 4, then the full 10.
			if err := repo.AdvanceLegEmit(ctx, acct, "tp1", 4, LegStatusOpen); err != nil {
				t.Fatalf("AdvanceLegEmit 4: %v", err)
			}
			if leg, _ = readLeg(t, pool, acct, "tp1"); leg.FilledQty != 4 || leg.Status != LegStatusOpen {
				t.Fatalf("after partial = %+v, want filled 4 OPEN", leg)
			}
			if got := trackedLegIDs(t, repo, acct); !equalStrings(got, []string{"tp1"}) {
				t.Fatalf("ListTrackedLegs after partial = %v, want [tp1]", got)
			}
			if err := repo.AdvanceLegEmit(ctx, acct, "tp1", 10, LegStatusFilled); err != nil {
				t.Fatalf("AdvanceLegEmit 10: %v", err)
			}
			if leg, _ = readLeg(t, pool, acct, "tp1"); leg.FilledQty != 10 || leg.Status != LegStatusFilled {
				t.Fatalf("after fill = %+v, want filled 10 FILLED", leg)
			}
			if got := trackedLegIDs(t, repo, acct); len(got) != 0 {
				t.Fatalf("ListTrackedLegs after fill = %v, want none", got)
			}
		})
	}
}
