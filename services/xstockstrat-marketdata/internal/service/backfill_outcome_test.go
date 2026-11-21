package service

import (
	"context"
	"errors"
	"slices"
	"strings"
	"testing"
	"time"

	"google.golang.org/grpc"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	ledgerv1 "github.com/xstockstrat/contracts/gen/go/ledger/v1"
	marketdatav1 "github.com/xstockstrat/contracts/gen/go/marketdata/v1"
	"github.com/xstockstrat/marketdata/internal/source"
	"github.com/xstockstrat/marketdata/internal/testdata"
)

const (
	outcomeEmpty   = commonv1.BackfillSymbolOutcome_BACKFILL_SYMBOL_OUTCOME_EMPTY
	outcomeSkipped = commonv1.BackfillSymbolOutcome_BACKFILL_SYMBOL_OUTCOME_SKIPPED
	outcomeFailed  = commonv1.BackfillSymbolOutcome_BACKFILL_SYMBOL_OUTCOME_FAILED
)

// outcomeBarsSource serves bar counts per symbol; a symbol in errs fails with that error.
type outcomeBarsSource struct {
	*fakeBackfillSource
	bars map[string]int
	errs map[string]error
}

func (f *outcomeBarsSource) GetBars(_ context.Context, sym, _ string, _, _ time.Time) ([]*marketdatav1.Bar, error) {
	if err := f.errs[sym]; err != nil {
		return nil, err
	}
	out := make([]*marketdatav1.Bar, 0, f.bars[sym])
	for i := 0; i < f.bars[sym]; i++ {
		out = append(out, &marketdatav1.Bar{Symbol: sym})
	}
	return out, nil
}

// outcomeHistSource serves the same periods for every symbol in writes; a symbol in errs fails.
type outcomeHistSource struct {
	periods []source.HistoricalFundamentalsPeriod
	writes  map[string]bool
	errs    map[string]error
}

func (s *outcomeHistSource) FetchHistorical(_ context.Context, symbol string, _, _ time.Time, _ []string) ([]source.HistoricalFundamentalsPeriod, error) {
	if err := s.errs[symbol]; err != nil {
		return nil, err
	}
	if !s.writes[symbol] {
		return nil, nil
	}
	out := slices.Clone(s.periods)
	for i := range out {
		out[i].Symbol = symbol
	}
	return out, nil
}

// failingListHistRepo fails the stored-row read that follows the source fetch.
type failingListHistRepo struct {
	*fakeHistRepo
	err error
}

func (r failingListHistRepo) ListHistoricalRows(context.Context, string) ([]source.HistoricalPriceState, error) {
	return nil, r.err
}

type recordingLedger struct {
	ledgerv1.LedgerServiceClient
	types []string
}

func (l *recordingLedger) AppendEvent(_ context.Context, in *ledgerv1.AppendEventRequest, _ ...grpc.CallOption) (*ledgerv1.AppendEventResponse, error) {
	l.types = append(l.types, in.GetEventType())
	return &ledgerv1.AppendEventResponse{}, nil
}

// flagDelisted loads the service's flagged set from a store holding the given flagged symbols.
func flagDelisted(t *testing.T, svc *MarketDataService, symbols ...string) {
	t.Helper()
	store := newFakeProfileStore()
	for _, sym := range symbols {
		store.seedFlagged(sym, novDate(9), true)
	}
	svc.SetSymbolProfiles(store)
	if err := svc.loadFlaggedSet(context.Background()); err != nil {
		t.Fatalf("loadFlaggedSet: %v", err)
	}
}

func newOutcomeBarsSvc(src *outcomeBarsSource, inserter barInserter) (*MarketDataService, *recordingLedger) {
	if src.fakeBackfillSource == nil {
		src.fakeBackfillSource = &fakeBackfillSource{}
	}
	reg := source.NewRegistry()
	reg.Register("alpaca", src)
	ledger := &recordingLedger{}
	return &MarketDataService{registry: reg, ledger: ledger, barInserter: inserter}, ledger
}

func newOutcomeFundSvc(src *outcomeHistSource, repo histFundamentalsRepo) *MarketDataService {
	src.periods = []source.HistoricalFundamentalsPeriod{{
		FiscalPeriod: "Q1-2020", PeriodType: "quarterly",
		PeriodEnd: hfDate(2019, 12, 28), FiledDate: hfDate(2020, 1, 29),
		Source: "edgar", ExtraMetrics: map[string]float64{},
	}}
	cfg := &fakeCfg{
		bools: map[string]bool{"fundamentals.history.enabled": true},
		ints:  map[string]int64{"fundamentals.history.backfill.max_lookback_years": 100},
	}
	return &MarketDataService{histFundamentals: src, histRepo: repo, fundCfg: cfg}
}

func backfillBars(t *testing.T, svc *MarketDataService, symbols ...string) *marketdatav1.BackfillBarsResponse {
	t.Helper()
	resp, err := svc.BackfillBars(context.Background(), &marketdatav1.BackfillBarsRequest{Symbols: symbols, TimeframeEnum: commonv1.Timeframe_TIMEFRAME_1DAY})
	if err != nil {
		t.Fatalf("BackfillBars: %v", err)
	}
	requireOutcomeInvariant(t, resp.GetFailedSymbols(), resp.GetSymbolResults())
	return resp
}

func backfillFundamentals(t *testing.T, svc *MarketDataService, symbols ...string) *marketdatav1.BackfillFundamentalsResponse {
	t.Helper()
	resp, err := svc.BackfillFundamentals(context.Background(), &marketdatav1.BackfillFundamentalsRequest{Symbols: symbols})
	if err != nil {
		t.Fatalf("BackfillFundamentals: %v", err)
	}
	requireOutcomeInvariant(t, resp.GetFailedSymbols(), resp.GetSymbolResults())
	return resp
}

// requireOutcomeInvariant is the design §6 invariant: every failed symbol has exactly one FAILED
// result, no SKIPPED or EMPTY symbol is failed, a FAILED symbol is failed, no symbol has two results.
func requireOutcomeInvariant(t *testing.T, failed []string, results []*commonv1.BackfillSymbolResult) {
	t.Helper()
	bySymbol := map[string]commonv1.BackfillSymbolOutcome{}
	for _, r := range results {
		if _, dup := bySymbol[r.GetSymbol()]; dup {
			t.Fatalf("symbol %s has two results", r.GetSymbol())
		}
		bySymbol[r.GetSymbol()] = r.GetOutcome()
	}
	for _, sym := range failed {
		if bySymbol[sym] != outcomeFailed {
			t.Fatalf("%s is in failed_symbols with result %v, want FAILED", sym, bySymbol[sym])
		}
	}
	for sym, outcome := range bySymbol {
		if isFailed := slices.Contains(failed, sym); isFailed != (outcome == outcomeFailed) {
			t.Fatalf("%s has result %v and failed_symbols membership %v", sym, outcome, isFailed)
		}
	}
}

func resultFor(t *testing.T, results []*commonv1.BackfillSymbolResult, sym string) *commonv1.BackfillSymbolResult {
	t.Helper()
	for _, r := range results {
		if r.GetSymbol() == sym {
			return r
		}
	}
	t.Fatalf("no result for %s in %v", sym, results)
	return nil
}

func requireNoResult(t *testing.T, results []*commonv1.BackfillSymbolResult, sym string) {
	t.Helper()
	for _, r := range results {
		if r.GetSymbol() == sym {
			t.Fatalf("%s has a result %v, want none (it was written)", sym, r)
		}
	}
}

var errNoCIK = errors.New(`no CIK for ticker "PSKY"`)

// @AC-11: a flagged symbol the fundamentals source cannot serve is skipped with the source's reason
// and does not fail the job.
func TestBackfillOutcome_AC11_FlaggedFundamentalsSourceErrorIsSkipped(t *testing.T) {
	reader := serviceMetricReader(t)
	svc := newOutcomeFundSvc(&outcomeHistSource{
		writes: map[string]bool{testdata.Aapl: true},
		errs:   map[string]error{testdata.Psky: errNoCIK},
	}, &fakeHistRepo{})
	flagDelisted(t, svc, testdata.Psky)

	resp := backfillFundamentals(t, svc, testdata.Aapl, testdata.Psky)
	if len(resp.GetFailedSymbols()) != 0 {
		t.Fatalf("failed_symbols = %v, want empty (PSKY is flagged delisted)", resp.GetFailedSymbols())
	}
	if r := resultFor(t, resp.GetSymbolResults(), testdata.Psky); r.GetOutcome() != outcomeSkipped || r.GetReason() != errNoCIK.Error() {
		t.Errorf("PSKY result = %v, want SKIPPED with the source's error text", r)
	}
	requireNoResult(t, resp.GetSymbolResults(), testdata.Aapl)
	if resp.GetPeriodsWritten() != 1 {
		t.Errorf("periods_written = %d, want 1", resp.GetPeriodsWritten())
	}
	counts := backfillSymbolCounts(t, reader)
	if counts["fundamentals/skipped"] != 1 || counts["fundamentals/failed"] != 0 || counts["fundamentals/written"] != 1 {
		t.Errorf("backfill.symbols = %v, want 1 skipped, 0 failed, 1 written", counts)
	}
}

// @AC-12 (guard): a flagged symbol the source still serves is backfilled like any other. Passes
// before and after; it fails only if a flag-based filter is added to the backfill path.
func TestBackfillOutcome_AC12_FlaggedSymbolIsStillAttempted(t *testing.T) {
	reader := serviceMetricReader(t)
	repo := &fakeHistRepo{}
	svc := newOutcomeFundSvc(&outcomeHistSource{writes: map[string]bool{testdata.Roku: true}}, repo)
	flagDelisted(t, svc, testdata.Roku)

	resp := backfillFundamentals(t, svc, testdata.Roku)
	if resp.GetPeriodsWritten() != 1 || len(repo.inserted) != 1 {
		t.Fatalf("periods_written = %d, inserted = %d, want 1 and 1", resp.GetPeriodsWritten(), len(repo.inserted))
	}
	requireNoResult(t, resp.GetSymbolResults(), testdata.Roku)
	if counts := backfillSymbolCounts(t, reader); counts["fundamentals/written"] != 1 {
		t.Errorf("backfill.symbols = %v, want 1 written", counts)
	}
}

// @AC-13: the same source error on a symbol that is not flagged still fails it.
func TestBackfillOutcome_AC13_UnflaggedSourceErrorStillFails(t *testing.T) {
	reader := serviceMetricReader(t)
	noCIK := errors.New(`no CIK for ticker "AXIA"`)
	svc := newOutcomeFundSvc(&outcomeHistSource{errs: map[string]error{testdata.Axia: noCIK}}, &fakeHistRepo{})
	flagDelisted(t, svc, testdata.Psky)

	resp := backfillFundamentals(t, svc, testdata.Axia)
	if !slices.Equal(resp.GetFailedSymbols(), []string{testdata.Axia}) {
		t.Fatalf("failed_symbols = %v, want [AXIA]", resp.GetFailedSymbols())
	}
	if r := resultFor(t, resp.GetSymbolResults(), testdata.Axia); r.GetOutcome() != outcomeFailed || r.GetReason() != noCIK.Error() {
		t.Errorf("AXIA result = %v, want FAILED with the reason", r)
	}
	if counts := backfillSymbolCounts(t, reader); counts["fundamentals/failed"] != 1 || counts["fundamentals/skipped"] != 0 {
		t.Errorf("backfill.symbols = %v, want 1 failed", counts)
	}
}

// @AC-23: a bars backfill skips a flagged symbol the source cannot serve and still completes.
func TestBackfillOutcome_AC23_FlaggedBarsSourceErrorIsSkipped(t *testing.T) {
	reader := serviceMetricReader(t)
	svc, ledger := newOutcomeBarsSvc(&outcomeBarsSource{
		bars: map[string]int{testdata.Aapl: 2},
		errs: map[string]error{testdata.Psky: errors.New("asset not found")},
	}, failingBarInserter{})
	flagDelisted(t, svc, testdata.Psky)

	resp := backfillBars(t, svc, testdata.Aapl, testdata.Psky)
	if len(resp.GetFailedSymbols()) != 0 {
		t.Fatalf("failed_symbols = %v, want empty", resp.GetFailedSymbols())
	}
	if r := resultFor(t, resp.GetSymbolResults(), testdata.Psky); r.GetOutcome() != outcomeSkipped || r.GetReason() != "asset not found" {
		t.Errorf("PSKY result = %v, want SKIPPED", r)
	}
	counts := backfillSymbolCounts(t, reader)
	if counts["bars/skipped"] != 1 || counts["bars/failed"] != 0 || counts["bars/written"] != 1 {
		t.Errorf("backfill.symbols = %v, want 1 skipped, 0 failed, 1 written", counts)
	}
	if want := []string{"marketdata.backfill.started", "marketdata.backfill.completed"}; !slices.Equal(ledger.types, want) {
		t.Errorf("ledger events = %v, want %v", ledger.types, want)
	}
}

// @AC-24: a symbol for which the source has nothing is EMPTY with no reason, not a failure.
func TestBackfillOutcome_AC24_ZeroPeriodsIsEmpty(t *testing.T) {
	svc := newOutcomeFundSvc(&outcomeHistSource{}, &fakeHistRepo{})
	resp := backfillFundamentals(t, svc, testdata.Kpti)
	if len(resp.GetFailedSymbols()) != 0 {
		t.Fatalf("failed_symbols = %v, want empty", resp.GetFailedSymbols())
	}
	if r := resultFor(t, resp.GetSymbolResults(), testdata.Kpti); r.GetOutcome() != outcomeEmpty || r.GetReason() != "" {
		t.Errorf("KPTI result = %v, want EMPTY with an empty reason", r)
	}
}

// @AC-26: any source error on a flagged symbol is skipped — a rate-limit text included — and the
// text is kept as the reason.
func TestBackfillOutcome_AC26_FlaggedRateLimitErrorIsSkippedWithItsText(t *testing.T) {
	svc := newOutcomeFundSvc(&outcomeHistSource{
		errs: map[string]error{testdata.Psky: errors.New("edgar: HTTP 429 too many requests")},
	}, &fakeHistRepo{})
	flagDelisted(t, svc, testdata.Psky)
	resp := backfillFundamentals(t, svc, testdata.Psky)
	if r := resultFor(t, resp.GetSymbolResults(), testdata.Psky); r.GetOutcome() != outcomeSkipped || !strings.Contains(r.GetReason(), "429") {
		t.Errorf("PSKY result = %v, want SKIPPED with a reason containing 429", r)
	}
}

func TestBackfillOutcome_BarsInsertErrorOnFlaggedSymbolIsFailed(t *testing.T) {
	svc, ledger := newOutcomeBarsSvc(&outcomeBarsSource{bars: map[string]int{testdata.Psky: 1}},
		failingBarInserter{fail: map[string]bool{testdata.Psky: true}})
	flagDelisted(t, svc, testdata.Psky)
	resp := backfillBars(t, svc, testdata.Psky)
	if !slices.Equal(resp.GetFailedSymbols(), []string{testdata.Psky}) {
		t.Fatalf("failed_symbols = %v, want [PSKY]: a write to our own database is never skipped", resp.GetFailedSymbols())
	}
	if r := resultFor(t, resp.GetSymbolResults(), testdata.Psky); r.GetOutcome() != outcomeFailed || r.GetReason() == "" {
		t.Errorf("PSKY result = %v, want FAILED with a reason", r)
	}
	if !slices.Contains(ledger.types, "marketdata.backfill.failed") {
		t.Errorf("ledger events = %v, want marketdata.backfill.failed", ledger.types)
	}
}

func TestBackfillOutcome_BarsZeroBarsIsEmpty(t *testing.T) {
	svc, _ := newOutcomeBarsSvc(&outcomeBarsSource{}, failingBarInserter{})
	resp := backfillBars(t, svc, testdata.Nwe)
	if r := resultFor(t, resp.GetSymbolResults(), testdata.Nwe); r.GetOutcome() != outcomeEmpty || r.GetReason() != "" {
		t.Errorf("NWE result = %v, want EMPTY with an empty reason", r)
	}
}

func TestBackfillOutcome_FundamentalsErrorAfterTheFetchOnFlaggedSymbolIsFailed(t *testing.T) {
	svc := newOutcomeFundSvc(&outcomeHistSource{writes: map[string]bool{testdata.Psky: true}},
		failingListHistRepo{fakeHistRepo: &fakeHistRepo{}, err: errors.New("connection reset")})
	flagDelisted(t, svc, testdata.Psky)
	resp := backfillFundamentals(t, svc, testdata.Psky)
	if !slices.Equal(resp.GetFailedSymbols(), []string{testdata.Psky}) {
		t.Fatalf("failed_symbols = %v, want [PSKY]: only the source fetch can be skipped", resp.GetFailedSymbols())
	}
	if r := resultFor(t, resp.GetSymbolResults(), testdata.Psky); r.GetOutcome() != outcomeFailed {
		t.Errorf("PSKY result = %v, want FAILED", r)
	}
}

func TestBackfillOutcome_NoStoreWiredTreatsEverySymbolAsUnflagged(t *testing.T) {
	svc, _ := newOutcomeBarsSvc(&outcomeBarsSource{errs: map[string]error{testdata.Psky: errors.New("asset not found")}}, failingBarInserter{})
	resp := backfillBars(t, svc, testdata.Psky)
	if !slices.Equal(resp.GetFailedSymbols(), []string{testdata.Psky}) {
		t.Fatalf("failed_symbols = %v, want [PSKY]", resp.GetFailedSymbols())
	}
	fund := newOutcomeFundSvc(&outcomeHistSource{errs: map[string]error{testdata.Psky: errNoCIK}}, &fakeHistRepo{})
	if got := backfillFundamentals(t, fund, testdata.Psky).GetFailedSymbols(); !slices.Equal(got, []string{testdata.Psky}) {
		t.Fatalf("fundamentals failed_symbols = %v, want [PSKY]", got)
	}
}

func TestBackfillOutcome_ResultsComeBackInRequestOrder(t *testing.T) {
	svc, _ := newOutcomeBarsSvc(&outcomeBarsSource{
		bars: map[string]int{testdata.Aapl: 1},
		errs: map[string]error{testdata.Psky: errors.New("asset not found"), testdata.Axia: errors.New("asset not found")},
	}, failingBarInserter{})
	flagDelisted(t, svc, testdata.Psky)
	resp := backfillBars(t, svc, testdata.Psky, testdata.Aapl, testdata.Nwe, testdata.Axia)
	var got []string
	for _, r := range resp.GetSymbolResults() {
		got = append(got, r.GetSymbol()+"="+r.GetOutcome().String())
	}
	want := []string{
		testdata.Psky + "=" + outcomeSkipped.String(),
		testdata.Nwe + "=" + outcomeEmpty.String(),
		testdata.Axia + "=" + outcomeFailed.String(),
	}
	if !slices.Equal(got, want) {
		t.Fatalf("results = %v, want %v", got, want)
	}

	fund := newOutcomeFundSvc(&outcomeHistSource{
		writes: map[string]bool{testdata.Aapl: true},
		errs:   map[string]error{testdata.Psky: errNoCIK},
	}, &fakeHistRepo{})
	fresp := backfillFundamentals(t, fund, testdata.Kpti, testdata.Aapl, testdata.Psky)
	if rs := fresp.GetSymbolResults(); len(rs) != 2 || rs[0].GetSymbol() != testdata.Kpti || rs[1].GetSymbol() != testdata.Psky {
		t.Fatalf("fundamentals results = %v, want KPTI then PSKY", rs)
	}
}
