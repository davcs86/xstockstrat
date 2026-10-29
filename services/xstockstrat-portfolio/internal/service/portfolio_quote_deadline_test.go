package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/pashagolub/pgxmock/v4"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/proto"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	marketdatav1 "github.com/xstockstrat/contracts/gen/go/marketdata/v1"
	notifyv1 "github.com/xstockstrat/contracts/gen/go/notify/v1"
	portfoliov1 "github.com/xstockstrat/contracts/gen/go/portfolio/v1"
	"github.com/xstockstrat/portfolio/internal/config"
	"github.com/xstockstrat/portfolio/internal/repository"
	"github.com/xstockstrat/portfolio/internal/testdata"
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
		subs:       map[string]snapshotSubscriber{},
	}
	if timeoutMs > 0 {
		svc.quoteCfg = &fakeConfig{vals: map[string]int64{"portfolio.marketdata.quote_timeout_ms": timeoutMs}}
	}
	return svc, mock, ledger
}

// expectAllAccounts registers the all-accounts ListPortfolios reads: balance accounts, their positions, and
// offline accounts with their positions. GetOfflineStates is left unexpected (its error is non-fatal).
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
			ch := svc.Subscribe("t", "u1")
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

// ── feature 231: broker-first snapshot and concentration, skip on any unpriced position ──

// recordingNotify records every alert checkRiskLimits emits.
type recordingNotify struct {
	notifyv1.NotifyServiceClient
	mu     sync.Mutex
	bodies []string
	reqs   []*notifyv1.EmitAlertRequest
}

func (n *recordingNotify) EmitAlert(_ context.Context, in *notifyv1.EmitAlertRequest, _ ...grpc.CallOption) (*notifyv1.EmitAlertResponse, error) {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.bodies = append(n.bodies, in.Body)
	n.reqs = append(n.reqs, in)
	return &notifyv1.EmitAlertResponse{}, nil
}

func lyftMarkQuote() *marketdatav1.Quote {
	return &marketdatav1.Quote{Symbol: testdata.Lyft, AskPrice: testdata.LyftLoneSide, MarkPrice: proto.Float64(testdata.LyftMark)}
}

func elwtOneSidedQuote() *marketdatav1.Quote {
	return &marketdatav1.Quote{Symbol: testdata.Elwt, AskPrice: testdata.ElwtAsk}
}

func expectDrawdowns(mock pgxmock.PgxPoolIface, rows ...[3]any) {
	r := mock.NewRows([]string{"account_id", "equity", "peak_equity"})
	for _, row := range rows {
		r.AddRow(row[0], row[1], row[2])
	}
	mock.ExpectQuery(`FROM portfolio.account_balances`).WithArgs("u1", "TRADING_MODE_PAPER").WillReturnRows(r)
}

func sameSet(got, want []string) bool {
	if len(got) != len(want) {
		return false
	}
	seen := map[string]int{}
	for _, g := range got {
		seen[g]++
	}
	for _, w := range want {
		if seen[w] == 0 {
			return false
		}
		seen[w]--
	}
	return true
}

// @AC-2: snapshot equity is broker-first (MSFT market_value) plus the mark-valued offline LYFT; only LYFT is quoted.
func TestBroadcastSnapshot_AC2_BrokerFirstEquity(t *testing.T) {
	stub := &stubMarketData{quotes: []*marketdatav1.Quote{lyftMarkQuote()}}
	svc, mock, ledger := newQuoteSvc(t, stub, 0)
	ch := svc.Subscribe("t", "u1")
	rows := posRow(mock.NewRows(positionCols), testdata.Lyft, "acc-off", testdata.LyftQty, testdata.LyftAvgEntry, 0)
	rows = posRow(rows, testdata.Msft, "brk-1", testdata.MsftQty, 500, testdata.MsftBrokerPrice)
	mock.ExpectQuery(`FROM portfolio.positions`).WithArgs(anyArgs(4)...).WillReturnRows(rows)
	mock.ExpectExec(`INSERT INTO portfolio.snapshots`).WithArgs(anyArgs(7)...).WillReturnResult(pgxmock.NewResult("INSERT", 1))

	svc.broadcastSnapshot(ctxWithUser(t, "u1"), "u1", commonv1.TradingMode_TRADING_MODE_PAPER)

	if ledger.calls != 1 || len(ch) != 1 {
		t.Fatalf("want 1 ledger emit and 1 snapshot, got %d and %d", ledger.calls, len(ch))
	}
	want := testdata.LyftMark*testdata.LyftQty + testdata.MsftBrokerPrice*testdata.MsftQty
	if snap := <-ch; math.Abs(snap.Equity-want) > 1e-9 {
		t.Fatalf("snapshot equity = %v, want %v", snap.Equity, want)
	}
	if len(stub.requested) != 1 || strings.Join(stub.requested[0], ",") != testdata.Lyft {
		t.Fatalf("only the un-broker-valued LYFT may be quoted, got %v", stub.requested)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("pgxmock: %v", err)
	}
}

// @AC-8: any unpriced position skips the snapshot entirely and the WARN names it.
func TestBroadcastSnapshot_AC8_AnyUnpricedSkips(t *testing.T) {
	rec := recordWarns(t)
	stub := &stubMarketData{quotes: []*marketdatav1.Quote{lyftMarkQuote(), elwtOneSidedQuote()}}
	svc, mock, ledger := newQuoteSvc(t, stub, 0)
	ch := svc.Subscribe("t", "u1")
	rows := posRow(mock.NewRows(positionCols), testdata.Lyft, "acc-off", testdata.LyftQty, testdata.LyftAvgEntry, 0)
	rows = posRow(rows, testdata.Elwt, "acc-off", testdata.ElwtQty, 6.00, 0)
	mock.ExpectQuery(`FROM portfolio.positions`).WithArgs(anyArgs(4)...).WillReturnRows(rows)

	svc.broadcastSnapshot(ctxWithUser(t, "u1"), "u1", commonv1.TradingMode_TRADING_MODE_PAPER)

	if ledger.calls != 0 || len(ch) != 0 {
		t.Fatalf("a partially priced snapshot must be skipped, got %d ledger emits and %d snapshots", ledger.calls, len(ch))
	}
	w := rec.find("portfolio snapshot skipped: positions unpriced")
	if w == nil || !strings.Contains(w["unpriced"], testdata.Elwt) {
		t.Fatalf("want WARN naming ELWT, got %v", w)
	}
}

// @AC-3: concentration sums a symbol across accounts and alerts on the true (broker-first) weights.
func TestCheckRiskLimits_AC3_SumsAcrossAccounts(t *testing.T) {
	stub := &stubMarketData{quotes: []*marketdatav1.Quote{lyftMarkQuote()}}
	svc, mock, _ := newQuoteSvc(t, stub, 0)
	notify := &recordingNotify{}
	svc.cfg, svc.notify = &config.Watcher{}, notify
	rows := posRow(mock.NewRows(positionCols), testdata.Lyft, "acc-1", testdata.LyftQty, testdata.LyftAvgEntry, 0)
	rows = posRow(rows, testdata.Lyft, "acc-2", testdata.LyftQty, testdata.LyftAvgEntry, 0)
	rows = posRow(rows, testdata.Msft, "brk-1", testdata.MsftQty, 500, testdata.MsftBrokerPrice)
	mock.ExpectQuery(`FROM portfolio.positions`).WithArgs(anyArgs(4)...).WillReturnRows(rows)
	expectDrawdowns(mock)

	svc.checkRiskLimits(ctxWithUser(t, "u1"), "u1", commonv1.TradingMode_TRADING_MODE_PAPER)

	want := []string{"concentration limit breach: LYFT at 24.1%", "concentration limit breach: MSFT at 75.9%"}
	if !sameSet(notify.bodies, want) {
		t.Fatalf("alerts = %v, want exactly %v", notify.bodies, want)
	}
	for _, req := range notify.reqs {
		if req.TargetUserId != "u1" || req.Category != "risk" || req.Severity != notifyv1.AlertSeverity_ALERT_SEVERITY_WARNING {
			t.Fatalf("alert %q: target=%q category=%q severity=%v, want target u1, category risk, WARNING", req.Body, req.TargetUserId, req.Category, req.Severity)
		}
	}
}

// @AC-9: any unpriced position skips concentration (WARN names it); drawdown still alerts on broker equity.
func TestCheckRiskLimits_AC9_UnpricedSkipsConcentrationDrawdownStillAlerts(t *testing.T) {
	rec := recordWarns(t)
	stub := &stubMarketData{quotes: []*marketdatav1.Quote{lyftMarkQuote(), elwtOneSidedQuote()}}
	svc, mock, _ := newQuoteSvc(t, stub, 0)
	notify := &recordingNotify{}
	svc.cfg, svc.notify = &config.Watcher{}, notify
	rows := posRow(mock.NewRows(positionCols), testdata.Lyft, "acc-off", testdata.LyftQty, testdata.LyftAvgEntry, 0)
	rows = posRow(rows, testdata.Elwt, "acc-off", testdata.ElwtQty, 6.00, 0)
	mock.ExpectQuery(`FROM portfolio.positions`).WithArgs(anyArgs(4)...).WillReturnRows(rows)
	expectDrawdowns(mock, [3]any{"brk-1", 800.0, 1000.0})

	svc.checkRiskLimits(ctxWithUser(t, "u1"), "u1", commonv1.TradingMode_TRADING_MODE_PAPER)

	want := []string{"drawdown limit breach: account brk-1 at 20.0% (peak 1000.00, current 800.00)"}
	if !sameSet(notify.bodies, want) {
		t.Fatalf("alerts = %v, want exactly %v", notify.bodies, want)
	}
	if got := notify.reqs[0].TargetUserId; got != "u1" {
		t.Fatalf("drawdown alert TargetUserId = %q, want u1", got)
	}
	if w := rec.find("concentration check skipped: positions unpriced"); w == nil || !strings.Contains(w["unpriced"], testdata.Elwt) {
		t.Fatalf("want WARN naming ELWT, got %v", w)
	}
}

// @AC-6: a drawdown breach alert targets the account owner, not an untargeted broadcast.
func TestCheckRiskLimits_242_AC6_DrawdownTargetsOwner(t *testing.T) {
	svc, mock, _ := newQuoteSvc(t, &stubMarketData{}, 0)
	notify := &recordingNotify{}
	svc.cfg, svc.notify = &config.Watcher{}, notify
	mock.ExpectQuery(`FROM portfolio.positions`).WithArgs(anyArgs(4)...).WillReturnRows(mock.NewRows(positionCols))
	balances := mock.NewRows([]string{"account_id", "equity", "peak_equity"}).AddRow("acct-1", 8500.0, 10000.0)
	mock.ExpectQuery(`FROM portfolio.account_balances`).WithArgs("user-42", "TRADING_MODE_PAPER").WillReturnRows(balances)

	svc.checkRiskLimits(ctxWithUser(t, "user-42"), "user-42", commonv1.TradingMode_TRADING_MODE_PAPER)

	if len(notify.reqs) != 1 {
		t.Fatalf("want exactly 1 alert, got %d: %v", len(notify.reqs), notify.bodies)
	}
	req := notify.reqs[0]
	if want := "drawdown limit breach: account acct-1 at 15.0% (peak 10000.00, current 8500.00)"; req.Body != want {
		t.Fatalf("body = %q, want %q", req.Body, want)
	}
	if req.Category != "risk" || req.Severity != notifyv1.AlertSeverity_ALERT_SEVERITY_WARNING || req.TargetUserId != "user-42" {
		t.Fatalf("category=%q severity=%v target=%q, want risk, WARNING, user-42", req.Category, req.Severity, req.TargetUserId)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("pgxmock: %v", err)
	}
}
