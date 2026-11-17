package service

import (
	"errors"
	"fmt"
	"math"
	"testing"

	"github.com/pashagolub/pgxmock/v4"
	"google.golang.org/protobuf/proto"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	marketdatav1 "github.com/xstockstrat/contracts/gen/go/marketdata/v1"
	portfoliov1 "github.com/xstockstrat/contracts/gen/go/portfolio/v1"
)

// Feature 357 — GetPortfolio and GetPnL read every ListPositions page, not only the first 500 rows.

// listPositionsSQL matches only the ListPositions SELECT, so no other positions query can take a page expectation.
const listPositionsSQL = `(?s)cardinality\(\$\d+::text\[\]\)`

func drainRows(mock pgxmock.PgxPoolIface, account string, n int, current func(i int) float64) (*pgxmock.Rows, []string) {
	rows := mock.NewRows(positionCols)
	syms := make([]string, 0, n)
	for i := 0; i < n; i++ {
		sym := fmt.Sprintf("S%03d", i)
		posRow(rows, sym, account, 1, 10, current(i))
		syms = append(syms, sym)
	}
	return rows, syms
}

func pageTwoCursor(syms []string, account string) []string {
	return []string{syms[499], "TRADING_MODE_PAPER", account}
}

// expectTwoPages registers a 501-row page 1 (500 rows plus the probe row) and a page 2 whose cursor slot is pinned.
// accountScoped pins account at arg index 2 on both pages. page2Err, when set, fails page 2.
func expectTwoPages(mock pgxmock.PgxPoolIface, account string, accountScoped bool, current func(i int) float64, page2Err error) []string {
	k, cursorIdx := 4, 2
	if accountScoped {
		k, cursorIdx = 5, 3
	}
	rows, syms := drainRows(mock, account, 501, current)
	page1 := anyArgs(k)
	if accountScoped {
		page1[2] = account
	}
	mock.ExpectQuery(listPositionsSQL).WithArgs(page1...).WillReturnRows(rows)

	page2 := anyArgs(k)
	if accountScoped {
		page2[2] = account
	}
	page2[cursorIdx] = pageTwoCursor(syms, account)
	e := mock.ExpectQuery(listPositionsSQL).WithArgs(page2...)
	if page2Err != nil {
		e.WillReturnError(page2Err)
	} else {
		e.WillReturnRows(posRow(mock.NewRows(positionCols), syms[500], account, 1, 10, current(500)))
	}
	return syms
}

// brokerValued prices S000..S499 at 11 (unrealized 1 each) and S500 at 1010 (unrealized 1000).
func brokerValued(i int) float64 {
	if i == 500 {
		return 1010
	}
	return 11
}

var paperMode = commonv1.TradingMode_TRADING_MODE_PAPER

func TestGetPnL_357_AC1_DrainsPastFirstPage(t *testing.T) {
	stub := &stubMarketData{}
	svc, mock, _ := newQuoteSvc(t, stub, 0)
	expectTwoPages(mock, "acc-1", false, brokerValued, nil)

	resp, err := svc.GetPnL(ctxWithUser(t, "u1"), &portfoliov1.GetPnLRequest{TradingMode: paperMode})
	if err != nil {
		t.Fatalf("GetPnL: %v", err)
	}
	if resp.UnrealizedPnl != 1500 {
		t.Errorf("UnrealizedPnl = %v, want 1500 (all 501 positions)", resp.UnrealizedPnl)
	}
	if stub.getLatestQuotesCalls != 0 {
		t.Errorf("getLatestQuotesCalls = %d, want 0 (all broker-valued)", stub.getLatestQuotesCalls)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestGetPortfolio_357_AC1_DrainsPastFirstPage(t *testing.T) {
	stub := &stubMarketData{}
	svc, mock, _ := newQuoteSvc(t, stub, 0)
	expectTwoPages(mock, "acc-1", false, brokerValued, nil)
	expectBalanceList(mock, "u1", balSpec{id: "acc-1", equity: 1, lastEquity: 1})
	expectOfflineIDList(mock, "u1")

	p, err := svc.GetPortfolio(ctxWithUser(t, "u1"), &portfoliov1.GetPortfolioRequest{TradingMode: paperMode})
	if err != nil {
		t.Fatalf("GetPortfolio: %v", err)
	}
	if len(p.Positions) != 501 {
		t.Errorf("len(Positions) = %d, want 501", len(p.Positions))
	}
	found := false
	for _, pos := range p.Positions {
		if pos.Symbol == "S500" {
			found = true
		}
	}
	if !found {
		t.Error("S500 (the 501st position) missing from Positions")
	}
	if want := 500*11.0 + 1010; math.Abs(p.Equity-want) > 1e-9 {
		t.Errorf("Equity = %v, want %v", p.Equity, want)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestGetPortfolio_357_AC3_AccountScopedDrainsPastFirstPage(t *testing.T) {
	stub := &stubMarketData{}
	svc, mock, _ := newQuoteSvc(t, stub, 0)
	expectTwoPages(mock, "acct-a", true, brokerValued, nil)
	expectBalanceList(mock, "u1", balSpec{id: "acct-a", equity: 1, lastEquity: 1})

	p, err := svc.GetPortfolio(ctxWithUser(t, "u1"), &portfoliov1.GetPortfolioRequest{TradingMode: paperMode, AccountId: proto.String("acct-a")})
	if err != nil {
		t.Fatalf("GetPortfolio: %v", err)
	}
	if len(p.Positions) != 501 {
		t.Errorf("len(Positions) = %d, want 501", len(p.Positions))
	}
	for _, pos := range p.Positions {
		if pos.AccountId != "acct-a" {
			t.Errorf("position %s has AccountId %q, want acct-a", pos.Symbol, pos.AccountId)
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestGetPortfolio_357_AC4_OneQuoteBatchFor501Unpriced(t *testing.T) {
	stub := &stubMarketData{}
	svc, mock, _ := newQuoteSvc(t, stub, 0)
	syms := expectTwoPages(mock, "acc-1", false, func(int) float64 { return 0 }, nil)
	expectBalanceList(mock, "u1", balSpec{id: "acc-1", equity: 1, lastEquity: 1})
	expectOfflineIDList(mock, "u1")
	stub.quotes = make([]*marketdatav1.Quote, 0, len(syms))
	for _, sym := range syms {
		stub.quotes = append(stub.quotes, quote(sym, 11))
	}

	if _, err := svc.GetPortfolio(ctxWithUser(t, "u1"), &portfoliov1.GetPortfolioRequest{TradingMode: paperMode}); err != nil {
		t.Fatalf("GetPortfolio: %v", err)
	}
	if stub.getLatestQuotesCalls > 1 {
		t.Errorf("getLatestQuotesCalls = %d, want <= 1 (one batch over the drained set)", stub.getLatestQuotesCalls)
	}
	if stub.getLatestQuoteCalls != 0 {
		t.Errorf("getLatestQuoteCalls = %d, want 0", stub.getLatestQuoteCalls)
	}
	if len(stub.requested) == 0 || len(stub.requested[0]) != 501 {
		got := 0
		if len(stub.requested) > 0 {
			got = len(stub.requested[0])
		}
		t.Errorf("first quote batch requested %d symbols, want 501", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestGetPortfolio_357_AC2_PageTwoErrorReturnsError(t *testing.T) {
	errPageTwo := errors.New("page two down")
	svc, mock, _ := newQuoteSvc(t, &stubMarketData{}, 0)
	expectTwoPages(mock, "acc-1", false, brokerValued, errPageTwo)

	p, err := svc.GetPortfolio(ctxWithUser(t, "u1"), &portfoliov1.GetPortfolioRequest{TradingMode: paperMode})
	if p != nil {
		t.Errorf("GetPortfolio returned a portfolio over a failed page: %d positions", len(p.Positions))
	}
	if !errors.Is(err, errPageTwo) {
		t.Errorf("err = %v, want errors.Is(err, errPageTwo)", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestGetPnL_357_AC2_PageTwoErrorReturnsError(t *testing.T) {
	errPageTwo := errors.New("page two down")
	svc, mock, _ := newQuoteSvc(t, &stubMarketData{}, 0)
	expectTwoPages(mock, "acc-1", false, brokerValued, errPageTwo)

	resp, err := svc.GetPnL(ctxWithUser(t, "u1"), &portfoliov1.GetPnLRequest{TradingMode: paperMode})
	if resp != nil {
		t.Errorf("GetPnL returned a response over a failed page: %+v", resp)
	}
	if !errors.Is(err, errPageTwo) {
		t.Errorf("err = %v, want errors.Is(err, errPageTwo)", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}
