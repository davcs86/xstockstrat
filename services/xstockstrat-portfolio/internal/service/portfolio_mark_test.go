package service

import (
	"errors"
	"math"
	"testing"

	"github.com/pashagolub/pgxmock/v4"
	"google.golang.org/protobuf/proto"

	marketdatav1 "github.com/xstockstrat/contracts/gen/go/marketdata/v1"
	portfoliov1 "github.com/xstockstrat/contracts/gen/go/portfolio/v1"
	"github.com/xstockstrat/portfolio/internal/testdata"
)

// Feature 231 — every portfolio read values a non-broker position from the marketdata mark (else the two-sided mid,
// else unpriced); a one-sided quote is never averaged.

func lyftQuote(ask, bid float64, mark *float64) *marketdatav1.Quote {
	return &marketdatav1.Quote{Symbol: testdata.Lyft, AskPrice: ask, BidPrice: bid, MarkPrice: mark}
}

func near(t *testing.T, what string, got, want float64) {
	t.Helper()
	if math.Abs(got-want) > 1e-9 {
		t.Fatalf("%s = %v, want %v", what, got, want)
	}
}

var (
	lyftMarkMV  = testdata.LyftMark * testdata.LyftQty
	lyftMarkPnL = testdata.LyftMark*testdata.LyftQty - testdata.LyftAvgEntry*testdata.LyftQty
)

// markOf: the mark wins; without one only a two-sided quote prices (AC-14 rule); a one-sided quote never averages.
func TestMarkOf(t *testing.T) {
	mid := (testdata.LyftTwoSidedAsk + testdata.LyftTwoSidedBid) / 2
	for _, tc := range []struct {
		name   string
		q      *marketdatav1.Quote
		want   float64
		wantOK bool
	}{
		{"mark_one_sided", lyftQuote(testdata.LyftLoneSide, 0, proto.Float64(testdata.LyftMark)), testdata.LyftMark, true},
		{"zero_mark_two_sided", lyftQuote(testdata.LyftTwoSidedAsk, testdata.LyftTwoSidedBid, proto.Float64(0)), mid, true},
		{"no_mark_two_sided", lyftQuote(testdata.LyftTwoSidedAsk, testdata.LyftTwoSidedBid, nil), mid, true},
		{"no_mark_bid_zero", lyftQuote(testdata.LyftLoneSide, 0, nil), 0, false},
		{"no_mark_ask_zero", lyftQuote(0, testdata.LyftLoneSide, nil), 0, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := markOf(tc.q)
			if ok != tc.wantOK || math.Abs(got-tc.want) > 1e-9 {
				t.Fatalf("markOf = (%v, %v), want (%v, %v)", got, ok, tc.want, tc.wantOK)
			}
		})
	}
}

// @AC-1: a one-sided quote (either side) values the position at the marketdata mark (stored daily close).
func TestListPositions_AC1_OneSidedValuedAtMark(t *testing.T) {
	for _, tc := range []struct {
		name     string
		ask, bid float64
	}{
		{"bid_zero", testdata.LyftLoneSide, 0},
		{"ask_zero", 0, testdata.LyftLoneSide},
	} {
		t.Run(tc.name, func(t *testing.T) {
			stub := &stubMarketData{quotes: []*marketdatav1.Quote{lyftQuote(tc.ask, tc.bid, proto.Float64(testdata.LyftMark))}}
			svc, mock, _ := newQuoteSvc(t, stub, 0)
			mock.ExpectQuery(`FROM portfolio.positions`).WithArgs(anyArgs(3)...).
				WillReturnRows(posRow(mock.NewRows(positionCols), testdata.Lyft, "acc-off", testdata.LyftQty, testdata.LyftAvgEntry, 0))
			resp, err := svc.ListPositions(ctxWithUser(t, "u1"), &portfoliov1.ListPositionsRequest{})
			if err != nil {
				t.Fatalf("ListPositions: %v", err)
			}
			p := resp.Positions[0]
			near(t, "current_price", p.CurrentPrice, testdata.LyftMark)
			near(t, "market_value", p.MarketValue, lyftMarkMV)
			near(t, "unrealized_pnl", p.UnrealizedPnl, lyftMarkPnL)
		})
	}
}

// @AC-14: without a mark (marketdata deploy skew) only a two-sided quote prices, at its mid.
func TestListPositions_AC14_NoMarkFallsBackToTwoSidedMidOnly(t *testing.T) {
	for _, tc := range []struct {
		name      string
		ask, bid  float64
		wantPrice float64
	}{
		{"two_sided", testdata.LyftTwoSidedAsk, testdata.LyftTwoSidedBid, (testdata.LyftTwoSidedAsk + testdata.LyftTwoSidedBid) / 2},
		{"one_sided", testdata.LyftLoneSide, 0, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			stub := &stubMarketData{quotes: []*marketdatav1.Quote{lyftQuote(tc.ask, tc.bid, nil)}}
			svc, mock, _ := newQuoteSvc(t, stub, 0)
			mock.ExpectQuery(`FROM portfolio.positions`).WithArgs(anyArgs(3)...).
				WillReturnRows(posRow(mock.NewRows(positionCols), testdata.Lyft, "acc-off", testdata.LyftQty, testdata.LyftAvgEntry, 0))
			resp, err := svc.ListPositions(ctxWithUser(t, "u1"), &portfoliov1.ListPositionsRequest{})
			if err != nil {
				t.Fatalf("ListPositions: %v", err)
			}
			p := resp.Positions[0]
			near(t, "current_price", p.CurrentPrice, tc.wantPrice)
			near(t, "market_value", p.MarketValue, tc.wantPrice*testdata.LyftQty)
		})
	}
}

// @AC-6: a one-sided quote with no mark leaves the position unpriced, and GetPnL refuses (UNAVAILABLE).
func TestAC6_OneSidedNoMarkUnpricedAndPnLUnavailable(t *testing.T) {
	stub := &stubMarketData{quotes: []*marketdatav1.Quote{{Symbol: testdata.Elwt, AskPrice: testdata.ElwtAsk}}}
	svc, mock, _ := newQuoteSvc(t, stub, 0)
	for i := 0; i < 2; i++ {
		mock.ExpectQuery(`FROM portfolio.positions`).WithArgs(anyArgs(3)...).
			WillReturnRows(posRow(mock.NewRows(positionCols), testdata.Elwt, "acc-off", testdata.ElwtQty, 6.00, 0))
	}
	resp, err := svc.ListPositions(ctxWithUser(t, "u1"), &portfoliov1.ListPositionsRequest{})
	if err != nil {
		t.Fatalf("ListPositions: %v", err)
	}
	assertUnenriched(t, resp.Positions)
	if _, err := svc.GetPnL(ctxWithUser(t, "u1"), &portfoliov1.GetPnLRequest{}); !errors.Is(err, ErrQuotesUnavailable) {
		t.Fatalf("GetPnL: want ErrQuotesUnavailable, got %v", err)
	}
}

// @AC-13: every portfolio read path values the one-sided position identically (C-10(b) parity).
func TestAC13_ReadPathParity(t *testing.T) {
	stub := &stubMarketData{quotes: []*marketdatav1.Quote{lyftQuote(testdata.LyftLoneSide, 0, proto.Float64(testdata.LyftMark))}}
	svc, mock, _ := newQuoteSvc(t, stub, 0)
	lyftRows := func() *pgxmock.Rows {
		return posRow(mock.NewRows(positionCols), testdata.Lyft, "acc-off", testdata.LyftQty, testdata.LyftAvgEntry, 0)
	}
	for i := 0; i < 4; i++ { // ListPositions, GetPosition, GetPortfolio, GetPnL
		mock.ExpectQuery(`FROM portfolio.positions`).WithArgs(anyArgs(3)...).WillReturnRows(lyftRows())
	}
	expectAllAccounts(mock, nil, []string{"acc-off"}, map[string]*pgxmock.Rows{"acc-off": lyftRows()})
	// GetPortfolio without account_id also reads the caller's account universe (feature 230).
	expectBalanceList(mock, "u1")
	expectOfflineIDList(mock, "u1", "acc-off")
	ctx := ctxWithUser(t, "u1")

	lp, err := svc.ListPositions(ctx, &portfoliov1.ListPositionsRequest{})
	if err != nil {
		t.Fatalf("ListPositions: %v", err)
	}
	gp, err := svc.GetPosition(ctx, &portfoliov1.GetPositionRequest{Symbol: testdata.Lyft})
	if err != nil {
		t.Fatalf("GetPosition: %v", err)
	}
	pf, err := svc.GetPortfolio(ctx, &portfoliov1.GetPortfolioRequest{})
	if err != nil {
		t.Fatalf("GetPortfolio: %v", err)
	}
	lpf, err := svc.ListPortfolios(ctx, &portfoliov1.ListPortfoliosRequest{})
	if err != nil {
		t.Fatalf("ListPortfolios: %v", err)
	}
	pnl, err := svc.GetPnL(ctx, &portfoliov1.GetPnLRequest{})
	if err != nil {
		t.Fatalf("GetPnL: %v", err)
	}
	for name, price := range map[string]float64{
		"ListPositions":  lp.Positions[0].CurrentPrice,
		"GetPosition":    gp.CurrentPrice,
		"GetPortfolio":   pf.Positions[0].CurrentPrice,
		"ListPortfolios": lpf.Portfolios[0].Positions[0].CurrentPrice,
	} {
		near(t, name+" current_price", price, testdata.LyftMark)
	}
	near(t, "GetPnL unrealized_pnl", pnl.UnrealizedPnl, lyftMarkPnL)
	near(t, "ListPortfolios equity", lpf.Portfolios[0].Equity, lyftMarkMV)
}
