package service

import (
	"math"
	"testing"
	"time"

	"github.com/pashagolub/pgxmock/v4"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"

	marketdatav1 "github.com/xstockstrat/contracts/gen/go/marketdata/v1"
	portfoliov1 "github.com/xstockstrat/contracts/gen/go/portfolio/v1"
	"github.com/xstockstrat/portfolio/internal/repository"
	"github.com/xstockstrat/portfolio/internal/testdata"
)

// Feature 230 — offline position valuation: marks with provenance and broker-style Day P&L.

const offAcct = "acc-1"

func offPos(sym string, qty, avg float64) *portfoliov1.Position {
	return &portfoliov1.Position{Symbol: sym, Qty: qty, AvgEntryPrice: avg, CostBasis: qty * avg, AccountId: offAcct,
		Source: portfoliov1.PositionSource_POSITION_SOURCE_ORDERS}
}

func fill(sym string, qty, price float64, at string) repository.RecentFill {
	return repository.RecentFill{Symbol: sym, Qty: qty, Price: price, FilledAt: at}
}

type valuationCase struct {
	now       time.Time
	positions []*portfoliov1.Position
	fills     []repository.RecentFill
	quotes    []*marketdatav1.Quote
	bars      []*marketdatav1.Bar
}

func (c valuationCase) run() accountVal {
	quotes := map[string]*marketdatav1.Quote{}
	for _, q := range c.quotes {
		quotes[q.Symbol] = q
	}
	bySym := map[string]*marketdatav1.SymbolBars{}
	var results []*marketdatav1.SymbolBars
	for _, b := range c.bars {
		if bySym[b.Symbol] == nil {
			bySym[b.Symbol] = &marketdatav1.SymbolBars{Symbol: b.Symbol}
			results = append(results, bySym[b.Symbol])
		}
		bySym[b.Symbol].Bars = append(bySym[b.Symbol].Bars, b)
	}
	states := map[string]repository.OfflineState{offAcct: {RecentFills: c.fills}}
	return valueOffline(c.now, c.positions, []string{offAcct}, states, quotes, indexBars(results))[offAcct]
}

func approx(t *testing.T, what string, got, want float64) {
	t.Helper()
	if math.Abs(got-want) > 5e-5 {
		t.Errorf("%s = %v, want %v", what, got, want)
	}
}

func assertMark(t *testing.T, p *portfoliov1.Position, price float64, src portfoliov1.MarkSource, asOf time.Time) {
	t.Helper()
	approx(t, p.Symbol+" current_price", p.CurrentPrice, price)
	if p.MarkSource != src {
		t.Errorf("%s mark_source = %v, want %v", p.Symbol, p.MarkSource, src)
	}
	if !asOf.IsZero() && !p.GetMarkAsOf().AsTime().Equal(asOf) {
		t.Errorf("%s mark_as_of = %v, want %v", p.Symbol, p.GetMarkAsOf().AsTime(), asOf)
	}
}

var pcBar = testdata.DailyBar(testdata.Aapl, 10, 16, testdata.AaplPrevClose)

func TestValuation_AC1_OvernightUsesPreviousClose(t *testing.T) {
	p := offPos(testdata.Aapl, 100, 150)
	acct := valuationCase{now: testdata.ReadLive, positions: []*portfoliov1.Position{p},
		quotes: []*marketdatav1.Quote{testdata.LiveQuote(testdata.Aapl, testdata.AaplMid)}, bars: []*marketdatav1.Bar{pcBar}}.run()
	assertMark(t, p, testdata.AaplMid, portfoliov1.MarkSource_MARK_SOURCE_QUOTE, testdata.QuoteTime)
	approx(t, "day_pnl", p.DayPnl, 400)
	approx(t, "day_pnl_pct", p.DayPnlPct, 0.0250)
	approx(t, "account day", acct.dayPnl, 400)
	approx(t, "account pct", acct.dayPnl/acct.base, 0.0250)
}

func TestValuation_AC2_SameSessionBuyUsesFillPrice(t *testing.T) {
	p := offPos(testdata.Aapl, 150, 152)
	valuationCase{now: testdata.ReadLive, positions: []*portfoliov1.Position{p},
		fills:  []repository.RecentFill{fill(testdata.Aapl, 50, 162, "2026-10-19T15:00:00Z")},
		quotes: []*marketdatav1.Quote{testdata.LiveQuote(testdata.Aapl, testdata.AaplMidAfterClose)}, bars: []*marketdatav1.Bar{pcBar}}.run()
	approx(t, "day_pnl", p.DayPnl, 350)
}

func TestValuation_AC22_CoverOvernightShortBelowPrevClose(t *testing.T) {
	p := offPos(testdata.Tsla, -6, 210)
	valuationCase{now: testdata.ReadLive, positions: []*portfoliov1.Position{p},
		fills:  []repository.RecentFill{fill(testdata.Tsla, 4, 190, "2026-10-19T15:00:00Z")},
		quotes: []*marketdatav1.Quote{testdata.LiveQuote(testdata.Tsla, 185)},
		bars:   []*marketdatav1.Bar{testdata.DailyBar(testdata.Tsla, 10, 16, 200)}}.run()
	approx(t, "day_pnl", p.DayPnl, 130)
}

func TestValuation_AC23_RoundTripOvernightFirst(t *testing.T) {
	p := offPos(testdata.Aapl, 30, 150)
	valuationCase{now: testdata.ReadLive, positions: []*portfoliov1.Position{p},
		fills: []repository.RecentFill{
			fill(testdata.Aapl, 50, 162, "2026-10-19T14:00:00Z"), fill(testdata.Aapl, -120, 165, "2026-10-19T16:00:00Z")},
		quotes: []*marketdatav1.Quote{testdata.LiveQuote(testdata.Aapl, testdata.AaplMidAfterClose)}, bars: []*marketdatav1.Bar{pcBar}}.run()
	approx(t, "qty", p.Qty, 30)
	approx(t, "day_pnl", p.DayPnl, 590)
}

func TestValuation_AC40_NoPrevCloseOvernightFirst(t *testing.T) {
	p := offPos(testdata.Newco, 10, 45)
	valuationCase{now: testdata.ReadLive, positions: []*portfoliov1.Position{p},
		fills: []repository.RecentFill{
			fill(testdata.Newco, 5, 48, "2026-10-19T14:00:00Z"), fill(testdata.Newco, -5, 51, "2026-10-19T16:00:00Z")},
		quotes: []*marketdatav1.Quote{testdata.LiveQuote(testdata.Newco, testdata.NewcoMid)}}.run()
	approx(t, "day_pnl", p.DayPnl, 10)
}

// AC-36: a baseline seeded inside the session is not a fill, so its shares count as overnight.
func TestValuation_AC36_InSessionBaselineIsOvernight(t *testing.T) {
	p := offPos(testdata.Aapl, 100, 150)
	p.Source = portfoliov1.PositionSource_POSITION_SOURCE_BASELINE
	valuationCase{now: testdata.ReadLive, positions: []*portfoliov1.Position{p},
		quotes: []*marketdatav1.Quote{testdata.LiveQuote(testdata.Aapl, testdata.AaplMidAfterClose)}, bars: []*marketdatav1.Bar{pcBar}}.run()
	approx(t, "day_pnl", p.DayPnl, 300)
}

func TestValuation_AC24_AC31_WeekendReadUsesLastCompletedSession(t *testing.T) {
	aapl := offPos(testdata.Aapl, 100, 150)
	tsla := offPos(testdata.Tsla, testdata.TslaShortQty, testdata.TslaShortAvg)
	valuationCase{now: testdata.ReadSaturday, positions: []*portfoliov1.Position{aapl, tsla}, bars: []*marketdatav1.Bar{
		testdata.DailyBar(testdata.Aapl, 10, 15, testdata.AaplClose1015), pcBar,
		testdata.DailyBar(testdata.Tsla, 10, 15, testdata.TslaClose1015), testdata.DailyBar(testdata.Tsla, 10, 16, testdata.TslaClose1016),
	}}.run()
	assertMark(t, aapl, testdata.AaplPrevClose, portfoliov1.MarkSource_MARK_SOURCE_LAST_CLOSE, testdata.Session(10, 16))
	approx(t, "AAPL day_pnl", aapl.DayPnl, 200)
	assertMark(t, tsla, testdata.TslaClose1016, portfoliov1.MarkSource_MARK_SOURCE_LAST_CLOSE, testdata.Session(10, 16))
	approx(t, "TSLA day_pnl", tsla.DayPnl, 50)
	approx(t, "TSLA unrealized", tsla.UnrealizedPnl, 200)
	approx(t, "TSLA unrealized pct", tsla.UnrealizedPnlPct, 0.10)
}

func TestValuation_AC35_AfterCloseRead(t *testing.T) {
	t.Run("session bar present", func(t *testing.T) {
		p := offPos(testdata.Aapl, 100, 150)
		valuationCase{now: testdata.ReadAfterClose, positions: []*portfoliov1.Position{p},
			quotes: []*marketdatav1.Quote{testdata.LiveQuote(testdata.Aapl, testdata.AaplMidAfterClose)},
			bars:   []*marketdatav1.Bar{pcBar, testdata.DailyBar(testdata.Aapl, 10, 19, testdata.AaplSessionClose)}}.run()
		assertMark(t, p, testdata.AaplSessionClose, portfoliov1.MarkSource_MARK_SOURCE_LAST_CLOSE, testdata.Session(10, 19))
		approx(t, "day_pnl", p.DayPnl, 200)
	})
	t.Run("session bar not yet available", func(t *testing.T) {
		p := offPos(testdata.Aapl, 100, 150)
		valuationCase{now: testdata.ReadAfterClose, positions: []*portfoliov1.Position{p},
			quotes: []*marketdatav1.Quote{testdata.LiveQuote(testdata.Aapl, testdata.AaplMidAfterClose)}, bars: []*marketdatav1.Bar{pcBar}}.run()
		assertMark(t, p, testdata.AaplMidAfterClose, portfoliov1.MarkSource_MARK_SOURCE_QUOTE, testdata.QuoteTime)
		approx(t, "day_pnl", p.DayPnl, 300)
	})
}

func TestValuation_AC49_FormingBarIgnoredDuringSession(t *testing.T) {
	p := offPos(testdata.Aapl, 100, 150)
	valuationCase{now: testdata.ReadLive, positions: []*portfoliov1.Position{p}, bars: []*marketdatav1.Bar{
		testdata.DailyBar(testdata.Aapl, 10, 16, testdata.AaplClose1015), testdata.DailyBar(testdata.Aapl, 10, 19, testdata.AaplFormingBar)}}.run()
	assertMark(t, p, testdata.AaplClose1015, portfoliov1.MarkSource_MARK_SOURCE_LAST_CLOSE, testdata.Session(10, 16))
	approx(t, "day_pnl", p.DayPnl, 0)
}

func TestValuation_AC50_WeekendFillAfterReference(t *testing.T) {
	p := offPos(testdata.Aapl, 50, 150)
	valuationCase{now: testdata.ReadSaturday, positions: []*portfoliov1.Position{p},
		fills: []repository.RecentFill{fill(testdata.Aapl, -50, 161, "2026-10-17T15:00:00Z")},
		bars:  []*marketdatav1.Bar{testdata.DailyBar(testdata.Aapl, 10, 15, testdata.AaplClose1015), pcBar}}.run()
	approx(t, "qty", p.Qty, 50)
	approx(t, "day_pnl", p.DayPnl, 200)
}

func TestValuation_AC51_NoBarsStillQuoteMarked(t *testing.T) {
	p := offPos(testdata.Aapl, 100, 150)
	acct := valuationCase{now: testdata.ReadLive, positions: []*portfoliov1.Position{p},
		quotes: []*marketdatav1.Quote{testdata.LiveQuote(testdata.Aapl, testdata.AaplMid)}}.run()
	assertMark(t, p, testdata.AaplMid, portfoliov1.MarkSource_MARK_SOURCE_QUOTE, testdata.QuoteTime)
	approx(t, "day_pnl", p.DayPnl, 0)
	if acct.base != 0 || acct.dayPnl != 0 {
		t.Errorf("account = %+v, want day 0 over base 0", acct)
	}
}

func TestValuation_AC12_MissingQuoteMarksAtLastClose(t *testing.T) {
	p := offPos(testdata.Xyz, 10, 20)
	valuationCase{now: testdata.ReadLive, positions: []*portfoliov1.Position{p},
		quotes: []*marketdatav1.Quote{testdata.LiveQuote(testdata.Aapl, testdata.AaplMid)},
		bars:   []*marketdatav1.Bar{testdata.DailyBar(testdata.Xyz, 10, 16, testdata.XyzClose)}}.run()
	assertMark(t, p, testdata.XyzClose, portfoliov1.MarkSource_MARK_SOURCE_LAST_CLOSE, testdata.Session(10, 16))
	approx(t, "unrealized", p.UnrealizedPnl, 20)
}

func TestValuation_AC38_NoPrevCloseAddsNothing(t *testing.T) {
	aapl, newco := offPos(testdata.Aapl, 100, 150), offPos(testdata.Newco, 10, 40)
	acct := valuationCase{now: testdata.ReadLive, positions: []*portfoliov1.Position{aapl, newco},
		quotes: []*marketdatav1.Quote{testdata.LiveQuote(testdata.Aapl, testdata.AaplMid), testdata.LiveQuote(testdata.Newco, testdata.NewcoMid)},
		bars:   []*marketdatav1.Bar{pcBar}}.run()
	assertMark(t, newco, testdata.NewcoMid, portfoliov1.MarkSource_MARK_SOURCE_QUOTE, testdata.QuoteTime)
	approx(t, "NEWCO day_pnl", newco.DayPnl, 0)
	approx(t, "account day", acct.dayPnl, 400)
	approx(t, "account pct", acct.dayPnl/acct.base, 0.0250)
}

func TestValuation_AC5_ShortPctSigned(t *testing.T) {
	p := offPos(testdata.Tsla, testdata.TslaShortQty, testdata.TslaShortAvg)
	valuationCase{now: testdata.ReadLive, positions: []*portfoliov1.Position{p},
		quotes: []*marketdatav1.Quote{testdata.LiveQuote(testdata.Tsla, testdata.TslaMid)}}.run()
	approx(t, "unrealized", p.UnrealizedPnl, 200)
	approx(t, "unrealized pct", p.UnrealizedPnlPct, 0.1000)
}

func TestValuation_AC13_NoQuoteNoBarsIsUnpriced(t *testing.T) {
	p := offPos(testdata.Zzzz, 5, 30)
	valuationCase{now: testdata.ReadLive, positions: []*portfoliov1.Position{p}}.run()
	if p.MarkSource != portfoliov1.MarkSource_MARK_SOURCE_NONE || p.CurrentPrice != 0 || p.Qty != 5 || p.MarkAsOf != nil {
		t.Errorf("ZZZZ = %+v, want qty 5, current_price 0, MARK_SOURCE_NONE", p)
	}
}

// AC-34: a symbol fully closed in session has no position row but still counts in account Day P&L.
func TestValuation_AC34_ClosedInSessionCountsAtAccount(t *testing.T) {
	acct := valuationCase{now: testdata.ReadLive,
		fills: []repository.RecentFill{fill(testdata.Aapl, -100, 166, "2026-10-19T15:00:00Z")}, bars: []*marketdatav1.Bar{pcBar}}.run()
	approx(t, "account day", acct.dayPnl, 600)
	approx(t, "account pct", acct.dayPnl/acct.base, 0.0375)
}

// D-1: for an offline position a one-sided quote is not live even with a marketdata mark_price.
func TestValuation_D1_OneSidedQuoteFallsBackToLastClose(t *testing.T) {
	p := offPos(testdata.Aapl, 100, 150)
	oneSided := &marketdatav1.Quote{Symbol: testdata.Aapl, Time: timestamppb.New(testdata.QuoteTime), AskPrice: testdata.AaplMid, MarkPrice: proto.Float64(testdata.AaplMid)}
	valuationCase{now: testdata.ReadLive, positions: []*portfoliov1.Position{p}, quotes: []*marketdatav1.Quote{oneSided},
		bars: []*marketdatav1.Bar{testdata.DailyBar(testdata.Aapl, 10, 16, testdata.AaplClose1015)}}.run()
	assertMark(t, p, testdata.AaplClose1015, portfoliov1.MarkSource_MARK_SOURCE_LAST_CLOSE, testdata.Session(10, 16))

	// The same quote on a non-offline position keeps feature 231's markOf (mark_price) path.
	brk := &portfoliov1.Position{Symbol: testdata.Aapl, Qty: 100, CostBasis: 15000}
	applyQuotes([]*portfoliov1.Position{brk}, map[string]*marketdatav1.Quote{testdata.Aapl: oneSided})
	assertMark(t, brk, testdata.AaplMid, portfoliov1.MarkSource_MARK_SOURCE_QUOTE, testdata.QuoteTime)
}

// AC-26: the |cost_basis| fix also corrects an order-fill-valued broker short.
func TestApplyQuotes_AC26_BrokerShortPct(t *testing.T) {
	p := &portfoliov1.Position{Symbol: testdata.Tsla, Qty: testdata.TslaShortQty, CostBasis: testdata.TslaShortQty * testdata.TslaShortAvg}
	applyQuotes([]*portfoliov1.Position{p}, map[string]*marketdatav1.Quote{testdata.Tsla: testdata.LiveQuote(testdata.Tsla, testdata.TslaMid)})
	approx(t, "unrealized pct", p.UnrealizedPnlPct, 0.1000)
}

// ─── service-level: fetch boundaries ────────────────────────────────────────

// offlinePosRow is posRow with an explicit PositionSource (posRow pins source 0 for the 229/231 tests).
func offlinePosRow(rows *pgxmock.Rows, sym, account string, qty, avg float64, source int) *pgxmock.Rows {
	return rows.AddRow(sym, qty, avg, qty*avg, time.Now(), "TRADING_MODE_PAPER", account,
		0.0, 0.0, 0.0, 0.0, 0.0, 0.0, "", "", source, nil)
}

func expectOfflineStates(mock pgxmock.PgxPoolIface, userID string) {
	mock.ExpectQuery(`FROM portfolio\.offline_account_realized WHERE user_id=\$1 AND account_id = ANY`).WithArgs(userID, pgxmock.AnyArg()).
		WillReturnRows(mock.NewRows([]string{"account_id", "realized_pnl", "realized_carried", "fees_since_snapshot", "fees_carried", "recent_fills"}).
			AddRow(offAcct, 0.0, 0.0, 0.0, 0.0, []byte(`[]`)))
}

func offlineListSvc(t *testing.T, stub *stubMarketData, cfg map[string]int64) (*PortfolioService, pgxmock.PgxPoolIface) {
	t.Helper()
	svc, mock, _ := newQuoteSvc(t, stub, 0)
	if cfg != nil {
		svc.quoteCfg = &fakeConfig{vals: cfg}
	}
	svc.now = func() time.Time { return testdata.ReadLive }
	mock.ExpectQuery(`FROM portfolio.positions`).WithArgs(anyArgs(3)...).
		WillReturnRows(offlinePosRow(mock.NewRows(positionCols), testdata.Aapl, offAcct, 10, 150, 1))
	expectOfflineStates(mock, "u1")
	return svc, mock
}

func TestListPositions_AC27_QuoteHangFallsBackToLastClose(t *testing.T) {
	stub := &stubMarketData{block: true, bars: map[string][]*marketdatav1.Bar{
		testdata.Aapl: {testdata.DailyBar(testdata.Aapl, 10, 16, testdata.AaplClose1015)}}}
	svc, _ := offlineListSvc(t, stub, map[string]int64{"portfolio.marketdata.quote_timeout_ms": 2500})
	var resp *portfoliov1.ListPositionsResponse
	elapsed := guard(t, func() {
		var err error
		if resp, err = svc.ListPositions(ctxWithUser(t, "u1"), &portfoliov1.ListPositionsRequest{}); err != nil {
			t.Errorf("ListPositions: %v", err)
		}
	})
	if elapsed > 3000*time.Millisecond {
		t.Errorf("ListPositions took %v, want ≤ 2500ms + 0.5s", elapsed)
	}
	assertMark(t, resp.Positions[0], testdata.AaplClose1015, portfoliov1.MarkSource_MARK_SOURCE_LAST_CLOSE, testdata.Session(10, 16))
}

func TestListPositions_BarsRequestShape(t *testing.T) {
	for _, tc := range []struct {
		name     string
		cfg      map[string]int64
		wantMax  int32
		wantDays int
	}{
		{"default lookback 21", nil, 22, 21},
		{"lookback 5", map[string]int64{"portfolio.marketdata.last_close_lookback_days": 5}, 6, 5},
	} {
		t.Run(tc.name, func(t *testing.T) {
			stub := &stubMarketData{quotes: []*marketdatav1.Quote{testdata.LiveQuote(testdata.Aapl, testdata.AaplMid)}}
			svc, _ := offlineListSvc(t, stub, tc.cfg)
			if _, err := svc.ListPositions(ctxWithUser(t, "u1"), &portfoliov1.ListPositionsRequest{}); err != nil {
				t.Fatalf("ListPositions: %v", err)
			}
			if len(stub.barsReqs) != 1 {
				t.Fatalf("BatchGetBars calls = %d, want 1", len(stub.barsReqs))
			}
			req := stub.barsReqs[0]
			wantStart := testdata.Session(10, 19).AddDate(0, 0, -tc.wantDays)
			if !req.AllowPartial || req.Timeframe != "1d" || req.MaxBarsPerSymbol != tc.wantMax || !req.Start.AsTime().Equal(wantStart) {
				t.Errorf("BatchGetBars request = %+v, want allow_partial 1d max %d from %v", req, tc.wantMax, wantStart)
			}
		})
	}
}

// AC-19: a broker-synced position keeps its broker mark and day P&L, and a broker-only read makes no
// offline-state or bars calls.
func TestListPositions_AC19_BrokerOnlyNoOfflineCalls(t *testing.T) {
	stub := &stubMarketData{}
	svc, mock, _ := newQuoteSvc(t, stub, 0)
	warns := recordWarns(t)
	mock.ExpectQuery(`FROM portfolio.positions`).WithArgs(anyArgs(3)...).
		WillReturnRows(mock.NewRows(positionCols).AddRow(testdata.Aapl, 10.0, 150.0, 1500.0, time.Now(), "TRADING_MODE_PAPER", "alp-1",
			testdata.AaplMidAfterClose, 1630.0, 130.0, 0.0867, 120.0, 0.0074, "", "", 0, nil))
	resp, err := svc.ListPositions(ctxWithUser(t, "u1"), &portfoliov1.ListPositionsRequest{})
	if err != nil {
		t.Fatalf("ListPositions: %v", err)
	}
	p := resp.Positions[0]
	assertMark(t, p, testdata.AaplMidAfterClose, portfoliov1.MarkSource_MARK_SOURCE_BROKER, time.Time{})
	approx(t, "day_pnl", p.DayPnl, 120)
	if stub.barsCalls != 0 || warns.find("offline state unavailable") != nil {
		t.Errorf("broker-only read: bars calls %d, offline-state lookup attempted %v; want neither", stub.barsCalls, warns.find("offline state unavailable") != nil)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Error(err)
	}
}
