package service

import (
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/pashagolub/pgxmock/v4"
	"google.golang.org/protobuf/proto"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	marketdatav1 "github.com/xstockstrat/contracts/gen/go/marketdata/v1"
	portfoliov1 "github.com/xstockstrat/contracts/gen/go/portfolio/v1"
	"github.com/xstockstrat/portfolio/internal/config"
	"github.com/xstockstrat/portfolio/internal/repository"
	"github.com/xstockstrat/portfolio/internal/testdata"
)

// Feature 240 — account-level offline P&L on GetPortfolio / ListPortfolios and FR-9 read parity.

type posSpec struct {
	sym      string
	qty, avg float64
}

type acctScenario struct {
	positions []posSpec
	state     *repository.OfflineState // nil → no offline_account_realized row
	quotes    []*marketdatav1.Quote
	bars      []*marketdatav1.Bar
	statesErr error // non-nil → the GetOfflineStates query fails
}

func (sc acctScenario) stub() *stubMarketData {
	st := &stubMarketData{quotes: sc.quotes, bars: map[string][]*marketdatav1.Bar{}}
	for _, b := range sc.bars {
		st.bars[b.Symbol] = append(st.bars[b.Symbol], b)
	}
	return st
}

func (sc acctScenario) rows(mock pgxmock.PgxPoolIface, account string) *pgxmock.Rows {
	rows := mock.NewRows(positionCols)
	for _, p := range sc.positions {
		rows = offlinePosRow(rows, p.sym, account, p.qty, p.avg, 1)
	}
	return rows
}

var stateCols = []string{"account_id", "realized_pnl", "realized_carried", "fees_since_snapshot", "fees_carried", "recent_fills"}

func expectStates(mock pgxmock.PgxPoolIface, userID string, states map[string]repository.OfflineState) *pgxmock.ExpectedQuery {
	rows := mock.NewRows(stateCols)
	for id, st := range states {
		fills := st.RecentFills
		if fills == nil {
			fills = []repository.RecentFill{}
		}
		b, _ := json.Marshal(fills)
		rows.AddRow(id, st.RealizedPnl, st.RealizedCarried, st.FeesSinceSnapshot, st.FeesCarried, b)
	}
	return mock.ExpectQuery(`FROM portfolio\.offline_account_realized WHERE user_id=\$1 AND account_id = ANY`).
		WithArgs(userID, pgxmock.AnyArg()).WillReturnRows(rows)
}

type balSpec struct {
	id                 string
	equity, lastEquity float64
}

func expectBalanceList(mock pgxmock.PgxPoolIface, userID string, bals ...balSpec) {
	rows := mock.NewRows([]string{"account_id", "cash", "buying_power", "equity", "last_equity"})
	for _, b := range bals {
		rows.AddRow(b.id, 0.0, 0.0, b.equity, b.lastEquity)
	}
	mock.ExpectQuery(`FROM portfolio.account_balances`).WithArgs(userID).WillReturnRows(rows)
}

func expectOfflineIDList(mock pgxmock.PgxPoolIface, userID string, ids ...string) {
	rows := mock.NewRows([]string{"account_id"})
	for _, id := range ids {
		rows.AddRow(id)
	}
	mock.ExpectQuery(`SELECT account_id FROM portfolio.offline_account_realized`).WithArgs(userID).WillReturnRows(rows)
}

func (sc acctScenario) expectStates(mock pgxmock.PgxPoolIface) {
	q := expectStates(mock, "u1", sc.states())
	if sc.statesErr != nil {
		q.WillReturnError(sc.statesErr)
	}
}

func (sc acctScenario) states() map[string]repository.OfflineState {
	if sc.state == nil {
		return nil
	}
	return map[string]repository.OfflineState{offAcct: *sc.state}
}

func acctSvc(t *testing.T, stub *stubMarketData, timeoutMs int64) (*PortfolioService, pgxmock.PgxPoolIface) {
	t.Helper()
	svc, mock, _ := newQuoteSvc(t, stub, timeoutMs)
	svc.now = func() time.Time { return testdata.ReadLive }
	return svc, mock
}

// getPortfolioAcc runs GetPortfolio(account_id=acc-1) for an offline-only user.
func getPortfolioAcc(t *testing.T, sc acctScenario) *portfoliov1.Portfolio {
	t.Helper()
	svc, mock := acctSvc(t, sc.stub(), 0)
	mock.ExpectQuery(`FROM portfolio.positions`).WithArgs(anyArgs(4)...).WillReturnRows(sc.rows(mock, offAcct))
	expectBalanceList(mock, "u1")
	sc.expectStates(mock)
	pf, err := svc.GetPortfolio(ctxWithUser(t, "u1"), &portfoliov1.GetPortfolioRequest{AccountId: proto.String(offAcct)})
	if err != nil {
		t.Fatalf("GetPortfolio: %v", err)
	}
	return pf
}

// listPortfoliosAcc runs ListPortfolios(account_id=acc-1) for the same offline-only user.
func listPortfoliosAcc(t *testing.T, sc acctScenario) *portfoliov1.Portfolio {
	t.Helper()
	svc, mock := acctSvc(t, sc.stub(), 0)
	expectBalanceList(mock, "u1")
	expectOfflineIDList(mock, "u1", offAcct)
	mock.ExpectQuery(`FROM portfolio.account_balances`).WithArgs(offAcct).WillReturnRows(mock.NewRows([]string{"cash", "buying_power", "equity", "last_equity"}))
	mock.ExpectQuery(`FROM portfolio.positions`).WithArgs(offAcct).WillReturnRows(sc.rows(mock, offAcct))
	sc.expectStates(mock)
	resp, err := svc.ListPortfolios(ctxWithUser(t, "u1"), &portfoliov1.ListPortfoliosRequest{AccountId: proto.String(offAcct)})
	if err != nil {
		t.Fatalf("ListPortfolios: %v", err)
	}
	return resp.Portfolios[0]
}

func bothReads(t *testing.T, sc acctScenario, check func(t *testing.T, pf *portfoliov1.Portfolio)) {
	t.Run("GetPortfolio", func(t *testing.T) { check(t, getPortfolioAcc(t, sc)) })
	t.Run("ListPortfolios", func(t *testing.T) { check(t, listPortfoliosAcc(t, sc)) })
}

func assertDay(t *testing.T, pf *portfoliov1.Portfolio, day, pct float64) {
	t.Helper()
	approx(t, "account day_pnl", pf.DayPnl, day)
	approx(t, "account day_pnl_pct", pf.DayPnlPct, pct)
}

func assertTotal(t *testing.T, pf *portfoliov1.Portfolio, total float64, pct *float64) {
	t.Helper()
	approx(t, "total_pnl", pf.TotalPnl, total)
	switch {
	case pct == nil && pf.TotalPnlPct != nil:
		t.Errorf("total_pnl_pct = %v, want unset", pf.GetTotalPnlPct())
	case pct != nil && pf.TotalPnlPct == nil:
		t.Errorf("total_pnl_pct unset, want %v", *pct)
	case pct != nil:
		approx(t, "total_pnl_pct", pf.GetTotalPnlPct(), *pct)
	}
}

func pct(v float64) *float64 { return &v }

var aaplPC = testdata.DailyBar(testdata.Aapl, 10, 16, testdata.AaplPrevClose)

func TestAccountPnL_AC1_OvernightAccountDay(t *testing.T) {
	sc := acctScenario{positions: []posSpec{{testdata.Aapl, 100, 150}}, state: &repository.OfflineState{},
		quotes: []*marketdatav1.Quote{testdata.LiveQuote(testdata.Aapl, testdata.AaplMid)}, bars: []*marketdatav1.Bar{aaplPC}}
	bothReads(t, sc, func(t *testing.T, pf *portfoliov1.Portfolio) { assertDay(t, pf, 400, 0.0250) })
}

func TestAccountPnL_AC3_SessionSellCounts(t *testing.T) {
	sc := acctScenario{positions: []posSpec{{testdata.Aapl, 60, 150}},
		state:  &repository.OfflineState{RecentFills: []repository.RecentFill{fill(testdata.Aapl, -40, 165, "2026-10-19T15:00:00Z")}},
		quotes: []*marketdatav1.Quote{testdata.LiveQuote(testdata.Aapl, testdata.AaplMidAfterClose)}, bars: []*marketdatav1.Bar{aaplPC}}
	approx(t, "account day_pnl", getPortfolioAcc(t, sc).DayPnl, 380)
}

func TestAccountPnL_AC34_FlatAccountKeepsSessionDay(t *testing.T) {
	sc := acctScenario{state: &repository.OfflineState{RecentFills: []repository.RecentFill{fill(testdata.Aapl, -100, 166, "2026-10-19T15:00:00Z")}},
		bars: []*marketdatav1.Bar{aaplPC}}
	bothReads(t, sc, func(t *testing.T, pf *portfoliov1.Portfolio) {
		if len(pf.Positions) != 0 {
			t.Errorf("positions = %v, want none", pf.Positions)
		}
		assertDay(t, pf, 600, 0.0375)
	})
}

func TestAccountPnL_AC38_NoPrevCloseOutOfBase(t *testing.T) {
	sc := acctScenario{positions: []posSpec{{testdata.Aapl, 100, 150}, {testdata.Newco, 10, 40}}, state: &repository.OfflineState{},
		quotes: []*marketdatav1.Quote{testdata.LiveQuote(testdata.Aapl, testdata.AaplMid), testdata.LiveQuote(testdata.Newco, testdata.NewcoMid)},
		bars:   []*marketdatav1.Bar{aaplPC}}
	assertDay(t, getPortfolioAcc(t, sc), 400, 0.0250)
}

func TestAccountPnL_AC51_BarsErrorZeroPct(t *testing.T) {
	sc := acctScenario{positions: []posSpec{{testdata.Aapl, 100, 150}}, state: &repository.OfflineState{},
		quotes: []*marketdatav1.Quote{testdata.LiveQuote(testdata.Aapl, testdata.AaplMid)}}
	svc, mock := acctSvc(t, sc.stub(), 0)
	svc.marketdata.(*stubMarketData).barsErr = errors.New("bars down")
	mock.ExpectQuery(`FROM portfolio.positions`).WithArgs(anyArgs(4)...).WillReturnRows(sc.rows(mock, offAcct))
	expectBalanceList(mock, "u1")
	expectStates(mock, "u1", sc.states())
	pf, err := svc.GetPortfolio(ctxWithUser(t, "u1"), &portfoliov1.GetPortfolioRequest{AccountId: proto.String(offAcct)})
	if err != nil {
		t.Fatalf("GetPortfolio: %v", err)
	}
	assertMark(t, pf.Positions[0], testdata.AaplMid, portfoliov1.MarkSource_MARK_SOURCE_QUOTE, testdata.QuoteTime)
	assertDay(t, pf, 0, 0)
}

func TestAccountPnL_AC4_TotalIsLifetimePlusUnrealized(t *testing.T) {
	sc := acctScenario{positions: []posSpec{{testdata.Aapl, 70, 150}},
		state:  &repository.OfflineState{RealizedPnl: 200, RealizedCarried: 400},
		quotes: []*marketdatav1.Quote{testdata.LiveQuote(testdata.Aapl, testdata.AaplPrevClose)}}
	bothReads(t, sc, func(t *testing.T, pf *portfoliov1.Portfolio) {
		assertTotal(t, pf, 1300, pct(0.1238))
		approx(t, "realized_pnl", pf.GetRealizedPnl(), 200)
		approx(t, "realized_pnl_lifetime", pf.GetRealizedPnlLifetime(), 600)
	})
}

func TestAccountPnL_AC6_FlatAccountTotal(t *testing.T) {
	sc := acctScenario{state: &repository.OfflineState{RealizedCarried: 250}}
	bothReads(t, sc, func(t *testing.T, pf *portfoliov1.Portfolio) { assertTotal(t, pf, 250, pct(0)) })
}

func TestAccountPnL_FeesGrossAndLifetime(t *testing.T) {
	sc := acctScenario{state: &repository.OfflineState{RealizedPnl: 600, RealizedCarried: 300, FeesSinceSnapshot: 3, FeesCarried: 1.5}}
	pf := getPortfolioAcc(t, sc)
	approx(t, "fees_since_snapshot", pf.GetFeesSinceSnapshot(), 3)
	approx(t, "fees_lifetime", pf.GetFeesLifetime(), 4.5)
	approx(t, "realized_pnl_lifetime", pf.GetRealizedPnlLifetime(), 900)
}

// degradedSc: realized 500.00 sits in the unreadable state; AAPL 10 @ 154 marked at 164 is 100.00 unrealized.
var degradedSc = acctScenario{positions: []posSpec{{testdata.Aapl, 10, 154}},
	state:  &repository.OfflineState{RealizedPnl: 500},
	quotes: []*marketdatav1.Quote{testdata.LiveQuote(testdata.Aapl, testdata.AaplMid)}, bars: []*marketdatav1.Bar{aaplPC},
	statesErr: errors.New("db down")}

// assertDegraded is the AC-3 contract for an offline Portfolio whose state could not be read.
func assertDegraded(t *testing.T, pf *portfoliov1.Portfolio, equity float64) {
	t.Helper()
	if !pf.OfflineStateUnavailable {
		t.Error("offline_state_unavailable = false, want true")
	}
	approx(t, "total_pnl", pf.TotalPnl, 0)
	assertDay(t, pf, 0, 0)
	approx(t, "equity", pf.Equity, equity)
	if pf.TotalPnlPct != nil || pf.RealizedPnl != nil || pf.RealizedPnlLifetime != nil || pf.FeesSinceSnapshot != nil || pf.FeesLifetime != nil {
		t.Errorf("degraded optionals must stay unset: %+v", pf)
	}
	for _, p := range pf.Positions {
		assertDegradedPos(t, p)
	}
}

func assertDegradedPos(t *testing.T, p *portfoliov1.Position) {
	t.Helper()
	if !p.OfflineStateUnavailable || p.DayPnl != 0 || p.DayPnlPct != 0 {
		t.Errorf("%s/%s: marker=%v day_pnl=%v day_pnl_pct=%v, want marked with zero Day P&L",
			p.AccountId, p.Symbol, p.OfflineStateUnavailable, p.DayPnl, p.DayPnlPct)
	}
}

func TestGetPortfolio_AC3_OfflineStateErrorMarksDegraded(t *testing.T) {
	warns := recordWarns(t)
	pf := getPortfolioAcc(t, degradedSc)
	assertMark(t, pf.Positions[0], testdata.AaplMid, portfoliov1.MarkSource_MARK_SOURCE_QUOTE, testdata.QuoteTime)
	assertDegraded(t, pf, 10*testdata.AaplMid)
	if warns.find("offline state unavailable") == nil {
		t.Error("want WARN offline state unavailable")
	}
}

func TestListPortfolios_AC3_OfflineStateErrorMarksDegraded(t *testing.T) {
	t.Run("scoped", func(t *testing.T) { assertDegraded(t, listPortfoliosAcc(t, degradedSc), 10*testdata.AaplMid) })
	t.Run("all accounts", func(t *testing.T) {
		svc, mock := acctSvc(t, degradedSc.stub(), 0)
		expectBalanceList(mock, "u1")
		expectOfflineIDList(mock, "u1", offAcct)
		mock.ExpectQuery(`FROM portfolio.positions`).WithArgs(offAcct).WillReturnRows(degradedSc.rows(mock, offAcct))
		degradedSc.expectStates(mock)
		resp, err := svc.ListPortfolios(ctxWithUser(t, "u1"), &portfoliov1.ListPortfoliosRequest{})
		if err != nil {
			t.Fatalf("ListPortfolios: %v", err)
		}
		assertDegraded(t, resp.Portfolios[0], 10*testdata.AaplMid)
	})
}

func TestPositionReads_AC3_OfflineStateErrorMarksDegraded(t *testing.T) {
	svc, mock := acctSvc(t, degradedSc.stub(), 0)
	for i := 0; i < 2; i++ { // ListPositions, GetPosition
		mock.ExpectQuery(`FROM portfolio.positions`).WithArgs(anyArgs(3)...).WillReturnRows(degradedSc.rows(mock, offAcct))
		degradedSc.expectStates(mock)
	}
	ctx := ctxWithUser(t, "u1")
	lp, err := svc.ListPositions(ctx, &portfoliov1.ListPositionsRequest{})
	if err != nil {
		t.Fatalf("ListPositions must stay OK: %v", err)
	}
	pos, err := svc.GetPosition(ctx, &portfoliov1.GetPositionRequest{Symbol: testdata.Aapl})
	if err != nil {
		t.Fatalf("GetPosition must stay OK: %v", err)
	}
	for _, p := range []*portfoliov1.Position{lp.Positions[0], pos} {
		assertDegradedPos(t, p)
		approx(t, "unrealized_pnl", p.UnrealizedPnl, 100)
	}
}

// brokerPosRow is a broker-valued MSFT row (source 0, priced 150, unrealized 500).
func brokerPosRow(rows *pgxmock.Rows, account string) *pgxmock.Rows {
	return rows.AddRow("MSFT", 10.0, 100.0, 1000.0, time.Now(), "TRADING_MODE_PAPER", account, 150.0, 1500.0, 500.0, 0.5, 0.0, 0.0, "", "", 0, nil)
}

func TestListPortfolios_AC8_UndecodableRowDegradesOnlyItsAccount(t *testing.T) {
	svc, mock := acctSvc(t, degradedSc.stub(), 0)
	expectBalanceList(mock, "u1", balSpec{"acct-alp-1", 10120, 10000})
	mock.ExpectQuery(`FROM portfolio.positions`).WithArgs("acct-alp-1").WillReturnRows(brokerPosRow(mock.NewRows(positionCols), "acct-alp-1"))
	expectOfflineIDList(mock, "u1", "acct-off-1", "acct-off-2")
	mock.ExpectQuery(`FROM portfolio.positions`).WithArgs("acct-off-1").WillReturnRows(degradedSc.rows(mock, "acct-off-1"))
	mock.ExpectQuery(`FROM portfolio.positions`).WithArgs("acct-off-2").WillReturnRows(mock.NewRows(positionCols))
	mock.ExpectQuery(`FROM portfolio\.offline_account_realized WHERE user_id=\$1 AND account_id = ANY`).WithArgs("u1", pgxmock.AnyArg()).
		WillReturnRows(mock.NewRows(stateCols).
			AddRow("acct-off-1", 500.0, 0.0, 0.0, 0.0, []byte("{not json")).
			AddRow("acct-off-2", 200.0, 0.0, 0.0, 0.0, []byte(`[]`)))
	resp, err := svc.ListPortfolios(ctxWithUser(t, "u1"), &portfoliov1.ListPortfoliosRequest{})
	if err != nil {
		t.Fatalf("ListPortfolios: %v", err)
	}
	by := map[string]*portfoliov1.Portfolio{}
	for _, pf := range resp.Portfolios {
		by[pf.AccountId] = pf
	}
	assertDegraded(t, by["acct-off-1"], 10*testdata.AaplMid)
	if by["acct-off-2"].OfflineStateUnavailable {
		t.Error("acct-off-2 must not be marked")
	}
	assertTotal(t, by["acct-off-2"], 200, pct(0))
	brk := by["acct-alp-1"]
	if brk.OfflineStateUnavailable || brk.Positions[0].OfflineStateUnavailable {
		t.Error("broker account must never be marked")
	}
	assertDay(t, brk, 120, 0.0120)
	approx(t, "broker equity", brk.Equity, 10120)
	approx(t, "broker total_pnl", brk.TotalPnl, 500)
}

func TestListPositions_DegradedOfflineKeepsBrokerRows(t *testing.T) {
	svc, mock := acctSvc(t, degradedSc.stub(), 0)
	mock.ExpectQuery(`FROM portfolio.positions`).WithArgs(anyArgs(3)...).
		WillReturnRows(brokerPosRow(degradedSc.rows(mock, offAcct), "alp-1"))
	degradedSc.expectStates(mock)
	resp, err := svc.ListPositions(ctxWithUser(t, "u1"), &portfoliov1.ListPositionsRequest{})
	if err != nil {
		t.Fatalf("ListPositions: %v", err)
	}
	if len(resp.Positions) != 2 {
		t.Fatalf("positions = %d, want broker and offline rows", len(resp.Positions))
	}
	for _, p := range resp.Positions {
		if p.AccountId == offAcct {
			assertDegradedPos(t, p)
		} else if p.OfflineStateUnavailable {
			t.Errorf("broker row %s must not be marked", p.Symbol)
		}
	}
}

func TestGetPortfolio_AggregateExcludesDegradedAccount(t *testing.T) {
	svc, mock := acctSvc(t, degradedSc.stub(), 0)
	mock.ExpectQuery(`FROM portfolio.positions`).WithArgs(anyArgs(3)...).
		WillReturnRows(brokerPosRow(degradedSc.rows(mock, offAcct), "alp-1"))
	expectBalanceList(mock, "u1", balSpec{"alp-1", 10120, 10000})
	expectOfflineIDList(mock, "u1", offAcct)
	degradedSc.expectStates(mock)
	all, err := svc.GetPortfolio(ctxWithUser(t, "u1"), &portfoliov1.GetPortfolioRequest{})
	if err != nil {
		t.Fatalf("GetPortfolio: %v", err)
	}
	if !all.OfflineStateUnavailable {
		t.Error("aggregate offline_state_unavailable = false, want true")
	}
	assertDay(t, all, 120, 0.0120)
	assertTotal(t, all, 500, nil)
	approx(t, "aggregate equity", all.Equity, 1500+10*testdata.AaplMid)
}

func TestAccountPnL_AC25_MixedBookAbsCostBasis(t *testing.T) {
	sc := acctScenario{positions: []posSpec{{testdata.Aapl, 10, 100}, {testdata.Tsla, -10, 100}}, state: &repository.OfflineState{},
		quotes: []*marketdatav1.Quote{testdata.LiveQuote(testdata.Aapl, 110), testdata.LiveQuote(testdata.Tsla, 95)}}
	assertTotal(t, getPortfolioAcc(t, sc), 150, pct(0.0750))
}

func TestAccountPnL_AC13_UnpricedListedButExcluded(t *testing.T) {
	sc := acctScenario{positions: []posSpec{{testdata.Aapl, 10, 150}, {testdata.Zzzz, 5, 30}}, state: &repository.OfflineState{},
		quotes: []*marketdatav1.Quote{testdata.LiveQuote(testdata.Aapl, testdata.AaplPrevClose)}}
	pf := getPortfolioAcc(t, sc)
	var zzzz *portfoliov1.Position
	for _, p := range pf.Positions {
		if p.Symbol == testdata.Zzzz {
			zzzz = p
		}
	}
	if zzzz == nil || zzzz.Qty != 5 || zzzz.CurrentPrice != 0 || zzzz.MarkSource != portfoliov1.MarkSource_MARK_SOURCE_NONE {
		t.Fatalf("ZZZZ = %+v, want listed with qty 5, price 0, MARK_SOURCE_NONE", zzzz)
	}
	assertTotal(t, pf, 100, pct(100.0/1500))
	approx(t, "equity", pf.Equity, 1600)
}

func TestListPortfolios_AC27_QuoteErrorFallsBackToLastClose(t *testing.T) {
	stub := &stubMarketData{quotesErr: errors.New("quotes down"), bars: map[string][]*marketdatav1.Bar{
		testdata.Aapl: {testdata.DailyBar(testdata.Aapl, 10, 16, testdata.AaplClose1015)}}}
	svc, mock := acctSvc(t, stub, 2500)
	expectBalanceList(mock, "u1")
	expectOfflineIDList(mock, "u1", offAcct)
	mock.ExpectQuery(`FROM portfolio.positions`).WithArgs(offAcct).
		WillReturnRows(offlinePosRow(mock.NewRows(positionCols), testdata.Aapl, offAcct, 10, 150, 1))
	expectStates(mock, "u1", map[string]repository.OfflineState{offAcct: {}})
	var resp *portfoliov1.ListPortfoliosResponse
	elapsed := guard(t, func() {
		var err error
		if resp, err = svc.ListPortfolios(ctxWithUser(t, "u1"), &portfoliov1.ListPortfoliosRequest{}); err != nil {
			t.Errorf("ListPortfolios: %v", err)
		}
	})
	if elapsed > 3000*time.Millisecond {
		t.Errorf("ListPortfolios took %v, want ≤ 3000ms", elapsed)
	}
	assertMark(t, resp.Portfolios[0].Positions[0], testdata.AaplClose1015, portfoliov1.MarkSource_MARK_SOURCE_LAST_CLOSE, testdata.Session(10, 16))
	if stub.getLatestQuotesCalls != 1 || stub.barsCalls != 1 {
		t.Errorf("quote batches %d, bars batches %d; want one of each for the whole read", stub.getLatestQuotesCalls, stub.barsCalls)
	}
}

func TestGetPnL_AC28_OfflineUnquotedStaysUnavailable(t *testing.T) {
	stub := &stubMarketData{bars: map[string][]*marketdatav1.Bar{testdata.Zzzz: {testdata.DailyBar(testdata.Zzzz, 10, 16, 30)}}}
	svc, mock := acctSvc(t, stub, 0)
	mock.ExpectQuery(`FROM portfolio.positions`).WithArgs(anyArgs(3)...).
		WillReturnRows(offlinePosRow(mock.NewRows(positionCols), testdata.Zzzz, offAcct, 5, 30, 1))
	resp, err := svc.GetPnL(ctxWithUser(t, "u1"), &portfoliov1.GetPnLRequest{})
	if resp != nil || !errors.Is(err, ErrQuotesUnavailable) {
		t.Fatalf("GetPnL = (%v, %v), want ErrQuotesUnavailable", resp, err)
	}
	if stub.barsCalls != 0 {
		t.Errorf("GetPnL made %d bars calls, want 0", stub.barsCalls)
	}
}

func TestBackgroundPathsMakeNoBarsCalls(t *testing.T) {
	stub := &stubMarketData{bars: map[string][]*marketdatav1.Bar{testdata.Aapl: {aaplPC}}}
	svc, mock := acctSvc(t, stub, 0)
	svc.cfg, svc.notify = &config.Watcher{}, &recordingNotify{}
	for i := 0; i < 2; i++ {
		mock.ExpectQuery(`FROM portfolio.positions`).WithArgs(anyArgs(4)...).
			WillReturnRows(offlinePosRow(mock.NewRows(positionCols), testdata.Aapl, offAcct, 10, 150, 1))
	}
	expectDrawdowns(mock)
	svc.broadcastSnapshot(ctxWithUser(t, "u1"), "u1", commonv1.TradingMode_TRADING_MODE_PAPER)
	svc.checkRiskLimits(ctxWithUser(t, "u1"), "u1", commonv1.TradingMode_TRADING_MODE_PAPER)
	if stub.barsCalls != 0 {
		t.Errorf("background paths made %d bars calls, want 0", stub.barsCalls)
	}
}

// AC-29 (FR-9): every read reports the same offline P&L for the same state.
func TestAC29_OfflineReadParity(t *testing.T) {
	sc := acctScenario{positions: []posSpec{{testdata.Aapl, 100, 150}}, state: &repository.OfflineState{},
		quotes: []*marketdatav1.Quote{testdata.LiveQuote(testdata.Aapl, testdata.AaplMidAfterClose)}, bars: []*marketdatav1.Bar{aaplPC}}
	stub := sc.stub()
	svc, mock := acctSvc(t, stub, 0)
	for _, n := range []int{4, 4, 3, 3} { // GetPortfolio(acc), ListPositions(acc), GetPortfolio(all), GetPosition
		mock.ExpectQuery(`FROM portfolio.positions`).WithArgs(anyArgs(n)...).WillReturnRows(sc.rows(mock, offAcct))
	}
	for i := 0; i < 2; i++ { // ListPortfolios(acc), ListPortfolios(all)
		mock.ExpectQuery(`FROM portfolio.positions`).WithArgs(offAcct).WillReturnRows(sc.rows(mock, offAcct))
	}
	for i := 0; i < 4; i++ {
		expectBalanceList(mock, "u1")
	}
	for i := 0; i < 3; i++ {
		expectOfflineIDList(mock, "u1", offAcct)
	}
	mock.ExpectQuery(`FROM portfolio.account_balances`).WithArgs(offAcct).WillReturnRows(mock.NewRows([]string{"cash", "buying_power", "equity", "last_equity"}))
	for i := 0; i < 6; i++ {
		expectStates(mock, "u1", sc.states())
	}
	ctx := ctxWithUser(t, "u1")

	pfAcc, err1 := svc.GetPortfolio(ctx, &portfoliov1.GetPortfolioRequest{AccountId: proto.String(offAcct)})
	pfAll, err2 := svc.GetPortfolio(ctx, &portfoliov1.GetPortfolioRequest{})
	pos, err3 := svc.GetPosition(ctx, &portfoliov1.GetPositionRequest{Symbol: testdata.Aapl})
	lp, err4 := svc.ListPositions(ctx, &portfoliov1.ListPositionsRequest{AccountId: proto.String(offAcct)})
	lpfAcc, err5 := svc.ListPortfolios(ctx, &portfoliov1.ListPortfoliosRequest{AccountId: proto.String(offAcct)})
	lpfAll, err6 := svc.ListPortfolios(ctx, &portfoliov1.ListPortfoliosRequest{})
	if err := errors.Join(err1, err2, err3, err4, err5, err6); err != nil {
		t.Fatal(err)
	}
	for name, p := range map[string]*portfoliov1.Position{
		"GetPortfolio(acc)": pfAcc.Positions[0], "GetPortfolio(all)": pfAll.Positions[0], "GetPosition": pos,
		"ListPositions": lp.Positions[0], "ListPortfolios(acc)": lpfAcc.Portfolios[0].Positions[0], "ListPortfolios(all)": lpfAll.Portfolios[0].Positions[0],
	} {
		approx(t, name+" current_price", p.CurrentPrice, testdata.AaplMidAfterClose)
		approx(t, name+" day_pnl", p.DayPnl, 300)
		approx(t, name+" unrealized_pnl", p.UnrealizedPnl, 1300)
	}
	for name, pf := range map[string]*portfoliov1.Portfolio{
		"GetPortfolio(acc)": pfAcc, "GetPortfolio(all)": pfAll, "ListPortfolios(acc)": lpfAcc.Portfolios[0], "ListPortfolios(all)": lpfAll.Portfolios[0],
	} {
		approx(t, name+" day_pnl", pf.DayPnl, 300)
		approx(t, name+" total_pnl", pf.TotalPnl, 1300)
	}
}

// AC-39: GetPortfolio carries broker and offline P&L, and aggregates them.
func TestGetPortfolio_AC39_BrokerOfflineAndAggregate(t *testing.T) {
	sc := acctScenario{positions: []posSpec{{testdata.Aapl, 100, 150}}, state: &repository.OfflineState{},
		quotes: []*marketdatav1.Quote{testdata.LiveQuote(testdata.Aapl, testdata.AaplMid)}, bars: []*marketdatav1.Bar{aaplPC}}
	svc, mock := acctSvc(t, sc.stub(), 0)
	brokerRow := func(rows *pgxmock.Rows) *pgxmock.Rows {
		return rows.AddRow("MSFT", 10.0, 100.0, 1000.0, time.Now(), "TRADING_MODE_PAPER", "alp-1", 150.0, 1500.0, 500.0, 0.5, 0.0, 0.0, "", "", 0, nil)
	}
	alp := balSpec{"alp-1", 10120, 10000}
	mock.ExpectQuery(`FROM portfolio.positions`).WithArgs("u1", "alp-1", "", 501).WillReturnRows(brokerRow(mock.NewRows(positionCols)))
	mock.ExpectQuery(`FROM portfolio.positions`).WithArgs("u1", offAcct, "", 501).WillReturnRows(sc.rows(mock, offAcct))
	mock.ExpectQuery(`FROM portfolio.positions`).WithArgs(anyArgs(3)...).WillReturnRows(brokerRow(sc.rows(mock, offAcct)))
	for i := 0; i < 3; i++ {
		expectBalanceList(mock, "u1", alp)
	}
	expectOfflineIDList(mock, "u1", offAcct)
	for i := 0; i < 2; i++ {
		expectStates(mock, "u1", sc.states())
	}
	ctx := ctxWithUser(t, "u1")

	broker, err := svc.GetPortfolio(ctx, &portfoliov1.GetPortfolioRequest{AccountId: proto.String("alp-1")})
	if err != nil {
		t.Fatal(err)
	}
	assertDay(t, broker, 120, 0.0120)
	assertTotal(t, broker, 500, nil)

	offline, err := svc.GetPortfolio(ctx, &portfoliov1.GetPortfolioRequest{AccountId: proto.String(offAcct)})
	if err != nil {
		t.Fatal(err)
	}
	approx(t, "acc-1 day_pnl", offline.DayPnl, 400)
	assertTotal(t, offline, 1400, pct(0.0933))

	all, err := svc.GetPortfolio(ctx, &portfoliov1.GetPortfolioRequest{})
	if err != nil {
		t.Fatal(err)
	}
	assertDay(t, all, 520, 0.0200)
	assertTotal(t, all, 1900, nil)
	if all.RealizedPnl != nil || all.FeesSinceSnapshot != nil {
		t.Errorf("aggregate realized/fees optionals must stay unset: %v %v", all.RealizedPnl, all.FeesSinceSnapshot)
	}
}

// AC-52: an account the caller has no rows in reveals nothing, and the state read is bound to the caller.
func TestGetPortfolio_AC52_NoRowsRevealsNothing(t *testing.T) {
	for _, account := range []string{"acc-2", "acc-9"} {
		t.Run(account, func(t *testing.T) {
			svc, mock := acctSvc(t, &stubMarketData{}, 0)
			mock.ExpectQuery(`FROM portfolio.positions`).WithArgs("u-1", account, "", 501).WillReturnRows(mock.NewRows(positionCols))
			expectBalanceList(mock, "u-1")
			mock.ExpectQuery(`FROM portfolio\.offline_account_realized WHERE user_id=\$1 AND account_id = ANY`).
				WithArgs("u-1", []string{account}).WillReturnRows(mock.NewRows(stateCols))
			pf, err := svc.GetPortfolio(ctxWithUser(t, "u-1"), &portfoliov1.GetPortfolioRequest{AccountId: proto.String(account)})
			if err != nil {
				t.Fatalf("GetPortfolio: %v", err)
			}
			if len(pf.Positions) != 0 || pf.RealizedPnl != nil || pf.RealizedPnlLifetime != nil || pf.FeesSinceSnapshot != nil ||
				pf.FeesLifetime != nil || pf.TotalPnlPct != nil || pf.Equity != 0 || pf.DayPnl != 0 || pf.TotalPnl != 0 {
				t.Errorf("portfolio = %+v, want empty with optionals unset", pf)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Error(err)
			}
		})
	}
}
