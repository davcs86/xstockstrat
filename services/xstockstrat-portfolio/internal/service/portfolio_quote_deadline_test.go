package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/pashagolub/pgxmock/v4"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	marketdatav1 "github.com/xstockstrat/contracts/gen/go/marketdata/v1"
	portfoliov1 "github.com/xstockstrat/contracts/gen/go/portfolio/v1"
	"github.com/xstockstrat/portfolio/internal/repository"
)

// Feature 229 — portfolio quote deadline, union batch, snapshot guard and GetPnL Unavailable.
// slog.SetDefault is process-global, so these tests never call t.Parallel().

type warnRecorder struct {
	mu   sync.Mutex
	recs []map[string]string
}

func (h *warnRecorder) Enabled(context.Context, slog.Level) bool { return true }
func (h *warnRecorder) Handle(_ context.Context, r slog.Record) error {
	if r.Level != slog.LevelWarn {
		return nil
	}
	rec := map[string]string{"msg": r.Message}
	r.Attrs(func(a slog.Attr) bool { rec[a.Key] = fmt.Sprint(a.Value.Resolve().Any()); return true })
	h.mu.Lock()
	h.recs = append(h.recs, rec)
	h.mu.Unlock()
	return nil
}
func (h *warnRecorder) WithAttrs([]slog.Attr) slog.Handler { return h }
func (h *warnRecorder) WithGroup(string) slog.Handler      { return h }
func (h *warnRecorder) find(msg string) map[string]string {
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, r := range h.recs {
		if r["msg"] == msg {
			return r
		}
	}
	return nil
}

func recordWarns(t *testing.T) *warnRecorder {
	t.Helper()
	h := &warnRecorder{}
	prev := slog.Default()
	slog.SetDefault(slog.New(h))
	t.Cleanup(func() { slog.SetDefault(prev) })
	return h
}

// guard fails the test instead of hanging when fn never returns (the bug this feature fixes).
func guard(t *testing.T, fn func()) time.Duration {
	t.Helper()
	done := make(chan struct{})
	start := time.Now()
	go func() { defer close(done); fn() }()
	select {
	case <-done:
		return time.Since(start)
	case <-time.After(5 * time.Second):
		t.Fatal("call did not return within the 5s hang guard")
		return 0
	}
}

func posRow(rows *pgxmock.Rows, sym, account string, qty, avg, current float64) *pgxmock.Rows {
	return rows.AddRow(sym, qty, avg, qty*avg, time.Now(), "TRADING_MODE_PAPER", account,
		current, current*qty, 0.0, 0.0, 0.0, 0.0, "", "", 0, nil)
}

func quote(sym string, mid float64) *marketdatav1.Quote {
	return &marketdatav1.Quote{Symbol: sym, AskPrice: mid + 0.5, BidPrice: mid - 0.5}
}

func newQuoteSvc(t *testing.T, stub *stubMarketData, timeoutMs int64) (*PortfolioService, pgxmock.PgxPoolIface, *fakeLedger) {
	t.Helper()
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mock.Close)
	mock.MatchExpectationsInOrder(false)
	ledger := &fakeLedger{}
	svc := &PortfolioService{
		repo:       repository.NewPortfolioRepoWithDB(mock),
		marketdata: stub,
		ledger:     ledger,
		subs:       map[string]chan *portfoliov1.PortfolioSnapshot{},
	}
	if timeoutMs > 0 {
		svc.quoteCfg = &fakeConfig{vals: map[string]int64{"portfolio.marketdata.quote_timeout_ms": timeoutMs}}
	}
	return svc, mock, ledger
}

// expectAllAccounts registers the all-accounts ListPortfolios reads: balance accounts, their positions, and
// offline accounts with their positions. GetOfflineRealized is left unexpected (its error is ignored).
func expectAllAccounts(mock pgxmock.PgxPoolIface, balance []string, offline []string, positions map[string]*pgxmock.Rows) {
	bal := mock.NewRows([]string{"account_id", "cash", "buying_power", "equity", "last_equity"})
	for _, id := range balance {
		bal.AddRow(id, 1000.0, 1000.0, 1000.0, 1000.0)
	}
	mock.ExpectQuery(`FROM portfolio.account_balances`).WithArgs("u1").WillReturnRows(bal)
	off := mock.NewRows([]string{"account_id"})
	for _, id := range offline {
		off.AddRow(id)
	}
	mock.ExpectQuery(`SELECT account_id FROM portfolio.offline_account_realized`).WithArgs("u1").WillReturnRows(off)
	for id, rows := range positions {
		mock.ExpectQuery(`FROM portfolio.positions`).WithArgs(id).WillReturnRows(rows)
	}
}

func assertUnenriched(t *testing.T, ps []*portfoliov1.Position) {
	t.Helper()
	for _, p := range ps {
		if p.CurrentPrice != 0 || p.MarketValue != 0 {
			t.Fatalf("%s must stay unenriched (never fabricated), got price=%v mv=%v", p.Symbol, p.CurrentPrice, p.MarketValue)
		}
	}
}

func assertDeadlineWarn(t *testing.T, rec *warnRecorder) {
	t.Helper()
	w := rec.find("batch latest quotes unavailable")
	if w == nil || !strings.Contains(w["error"], "DeadlineExceeded") && !strings.Contains(w["error"], "deadline exceeded") {
		t.Fatalf("want a deadline-exceeded quote WARN, got %v", w)
	}
}

// @AC-1 (ListPositions): a marketdata that never answers yields unenriched positions within the deadline.
func TestListPositions_AC1_QuoteDeadline(t *testing.T) {
	rec := recordWarns(t)
	stub := &stubMarketData{block: true}
	svc, mock, _ := newQuoteSvc(t, stub, 2500)
	rows := posRow(posRow(mock.NewRows(positionCols), "AAPL", "acc-off", 1, 100, 0), "MSFT", "acc-off", 1, 200, 0)
	mock.ExpectQuery(`FROM portfolio.positions`).WithArgs(anyArgs(3)...).WillReturnRows(rows)

	var resp *portfoliov1.ListPositionsResponse
	var err error
	elapsed := guard(t, func() { resp, err = svc.ListPositions(ctxWithUser(t, "u1"), &portfoliov1.ListPositionsRequest{}) })
	if err != nil {
		t.Fatalf("ListPositions: %v", err)
	}
	if elapsed > 3*time.Second {
		t.Fatalf("must return within 2500ms + 0.5s, took %v", elapsed)
	}
	assertUnenriched(t, resp.Positions)
	assertDeadlineWarn(t, rec)
}

// @AC-1 (ListPortfolios): the same bound and outcome across a balance account and an offline account.
func TestListPortfolios_AC1_QuoteDeadline(t *testing.T) {
	rec := recordWarns(t)
	stub := &stubMarketData{block: true}
	svc, mock, _ := newQuoteSvc(t, stub, 2500)
	expectAllAccounts(mock, []string{"acc-1"}, []string{"acc-off"}, map[string]*pgxmock.Rows{
		"acc-1":   posRow(mock.NewRows(positionCols), "AAPL", "acc-1", 1, 100, 0),
		"acc-off": posRow(mock.NewRows(positionCols), "MSFT", "acc-off", 1, 200, 0),
	})

	var resp *portfoliov1.ListPortfoliosResponse
	var err error
	elapsed := guard(t, func() { resp, err = svc.ListPortfolios(ctxWithUser(t, "u1"), &portfoliov1.ListPortfoliosRequest{}) })
	if err != nil {
		t.Fatalf("ListPortfolios: %v", err)
	}
	if elapsed > 3*time.Second {
		t.Fatalf("must return within 2500ms + 0.5s, took %v", elapsed)
	}
	if len(resp.Portfolios) != 2 {
		t.Fatalf("want both accounts, got %d", len(resp.Portfolios))
	}
	for _, p := range resp.Portfolios {
		assertUnenriched(t, p.Positions)
	}
	assertDeadlineWarn(t, rec)
}

// C-10(b): one quote batch and one price per symbol across every account of a ListPortfolios read.
func TestListPortfolios_UnionQuoteBatch(t *testing.T) {
	stub := &stubMarketData{quotes: []*marketdatav1.Quote{quote("AAPL", 150), quote("MSFT", 300)}}
	svc, mock, _ := newQuoteSvc(t, stub, 0)
	expectAllAccounts(mock, []string{"acc-1", "acc-2"}, nil, map[string]*pgxmock.Rows{
		"acc-1": posRow(mock.NewRows(positionCols), "AAPL", "acc-1", 1, 100, 0),
		"acc-2": posRow(posRow(mock.NewRows(positionCols), "AAPL", "acc-2", 2, 100, 0), "MSFT", "acc-2", 1, 200, 0),
	})

	resp, err := svc.ListPortfolios(ctxWithUser(t, "u1"), &portfoliov1.ListPortfoliosRequest{})
	if err != nil {
		t.Fatalf("ListPortfolios: %v", err)
	}
	if stub.getLatestQuotesCalls != 1 || strings.Join(stub.requested[0], ",") != "AAPL,MSFT" {
		t.Fatalf("want 1 union call for [AAPL MSFT], got %d calls %v", stub.getLatestQuotesCalls, stub.requested)
	}
	var prices []float64
	for _, p := range resp.Portfolios {
		for _, pos := range p.Positions {
			if pos.Symbol == "AAPL" {
				prices = append(prices, pos.CurrentPrice)
			}
		}
	}
	if len(prices) != 2 || prices[0] != prices[1] || prices[0] != 150 {
		t.Fatalf("AAPL must carry one identical price across accounts, got %v", prices)
	}
}

// Broker-valued positions are never re-priced; a short is never valued at 0 (@AC-12/@AC-14 @feature-157).
func TestApplyQuotes_KeepsBrokerValuedAndSkipsMissing(t *testing.T) {
	ps := []*portfoliov1.Position{
		{Symbol: "BRKR", Qty: 1, AvgEntryPrice: 10, CurrentPrice: 12, MarketValue: 12},
		{Symbol: "SHRT", Qty: -5, AvgEntryPrice: 250},
	}
	if got := unvaluedSymbols(append(ps, &portfoliov1.Position{Symbol: "SHRT"})); strings.Join(got, ",") != "SHRT" {
		t.Fatalf("unvaluedSymbols must dedupe and skip broker-valued positions, got %v", got)
	}
	applyQuotes(ps, map[string]*marketdatav1.Quote{"BRKR": quote("BRKR", 99)})
	if ps[0].CurrentPrice != 12 || ps[1].CurrentPrice != 0 || ps[1].UnrealizedPnl != 0 {
		t.Fatalf("broker value must stay and a quoteless short must stay unenriched, got %+v %+v", ps[0], ps[1])
	}
}

func TestQuoteTimeoutAndEmptyFetch(t *testing.T) {
	cases := map[string]struct {
		cfg  intConfig
		want time.Duration
	}{
		"nil":      {nil, 4000 * time.Millisecond},
		"zero":     {&fakeConfig{vals: map[string]int64{"portfolio.marketdata.quote_timeout_ms": 0}}, 4000 * time.Millisecond},
		"negative": {&fakeConfig{vals: map[string]int64{"portfolio.marketdata.quote_timeout_ms": -1}}, 4000 * time.Millisecond},
		"2500":     {&fakeConfig{vals: map[string]int64{"portfolio.marketdata.quote_timeout_ms": 2500}}, 2500 * time.Millisecond},
	}
	for name, tc := range cases {
		if got := (&PortfolioService{quoteCfg: tc.cfg}).quoteTimeout(); got != tc.want {
			t.Fatalf("%s: quoteTimeout = %v, want %v", name, got, tc.want)
		}
	}
	stub := &stubMarketData{}
	if q, ok := (&PortfolioService{marketdata: stub}).latestQuotesFor(context.Background(), nil); !ok || len(q) != 0 || stub.getLatestQuotesCalls != 0 {
		t.Fatalf("no symbols must mean no RPC and ok=true")
	}
}

func pnlRows(mock pgxmock.PgxPoolIface) *pgxmock.Rows {
	return posRow(posRow(mock.NewRows(positionCols), "AAPL", "acc-off", 1, 100, 0), "MSFT", "acc-off", 1, 200, 0)
}

// @AC-5: GetPnL refuses to report unrealized P&L when a needed quote is unavailable.
func TestGetPnL_AC5_QuotesUnavailable(t *testing.T) {
	for _, tc := range []struct {
		name string
		stub *stubMarketData
	}{
		{"never answers", &stubMarketData{block: true}},
		{"AAPL only", &stubMarketData{quotes: []*marketdatav1.Quote{quote("AAPL", 150)}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			svc, mock, _ := newQuoteSvc(t, tc.stub, 500)
			mock.ExpectQuery(`FROM portfolio.positions`).WithArgs(anyArgs(3)...).WillReturnRows(pnlRows(mock))
			var resp *portfoliov1.PnLResponse
			var err error
			guard(t, func() { resp, err = svc.GetPnL(ctxWithUser(t, "u1"), &portfoliov1.GetPnLRequest{}) })
			if resp != nil || !errors.Is(err, ErrQuotesUnavailable) {
				t.Fatalf("want ErrQuotesUnavailable and no response, got resp=%v err=%v", resp, err)
			}
			if tc.name == "AAPL only" && !strings.Contains(err.Error(), "MSFT") {
				t.Fatalf("error must name the unquoted symbol, got %v", err)
			}
		})
	}
}

// @AC-6: broker-synced positions are valued from the broker price without a quote fetch.
func TestGetPnL_AC6_BrokerValuedWithoutQuoteFetch(t *testing.T) {
	stub := &stubMarketData{}
	svc, mock, _ := newQuoteSvc(t, stub, 0)
	mock.ExpectQuery(`FROM portfolio.positions`).WithArgs(anyArgs(3)...).
		WillReturnRows(posRow(mock.NewRows(positionCols), "AAPL", "acc-1", 10, 150, 200))
	resp, err := svc.GetPnL(ctxWithUser(t, "u1"), &portfoliov1.GetPnLRequest{})
	if err != nil {
		t.Fatalf("GetPnL: %v", err)
	}
	if stub.getLatestQuotesCalls != 0 || resp.UnrealizedPnl != 500 {
		t.Fatalf("want 0 quote calls and unrealized 500, got calls=%d unrealized=%v", stub.getLatestQuotesCalls, resp.UnrealizedPnl)
	}
}

// broadcastSnapshot never persists a fabricated zero-equity snapshot when no position could be priced.
func TestBroadcastSnapshot_SkipsWhenUnpriced(t *testing.T) {
	mode := commonv1.TradingMode_TRADING_MODE_PAPER
	for _, tc := range []struct {
		name   string
		stub   *stubMarketData
		insert bool
	}{
		{"quotes unavailable", &stubMarketData{quotesErr: errors.New("marketdata down")}, false},
		{"no position priced", &stubMarketData{}, false},
		{"priced control", &stubMarketData{quotes: []*marketdatav1.Quote{quote("AAPL", 150)}}, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			svc, mock, ledger := newQuoteSvc(t, tc.stub, 0)
			ch := svc.Subscribe("t")
			mock.ExpectQuery(`FROM portfolio.positions`).WithArgs(anyArgs(4)...).
				WillReturnRows(posRow(mock.NewRows(positionCols), "AAPL", "acc-1", 1, 100, 0))
			if tc.insert {
				mock.ExpectExec(`INSERT INTO portfolio.snapshots`).WithArgs(anyArgs(7)...).
					WillReturnResult(pgxmock.NewResult("INSERT", 1))
			}
			svc.broadcastSnapshot(ctxWithUser(t, "u1"), "u1", mode)
			wantCalls := 0
			if tc.insert {
				wantCalls = 1
			}
			if ledger.calls != wantCalls || len(ch) != wantCalls {
				t.Fatalf("want %d ledger emits and %d snapshots, got %d and %d", wantCalls, wantCalls, ledger.calls, len(ch))
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatalf("pgxmock: %v", err)
			}
		})
	}
}
