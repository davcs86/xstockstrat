package service

import (
	"context"
	"log/slog"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/types/known/timestamppb"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	ledgerv1 "github.com/xstockstrat/contracts/gen/go/ledger/v1"
	marketdatav1 "github.com/xstockstrat/contracts/gen/go/marketdata/v1"
	notifyv1 "github.com/xstockstrat/contracts/gen/go/notify/v1"
	"github.com/xstockstrat/marketdata/internal/source"
)

// f64p returns a pointer to v — source.Fundamentals' metric fields are *float64 so a
// present-but-genuinely-missing value is distinguishable from a real 0 (bug fix).
func f64p(v float64) *float64 { return &v }

func TestEstimateExpectedBars(t *testing.T) {
	// Mon 2024-01-01 .. Fri 2024-01-05 inclusive = 5 weekdays (no weekend).
	monStart := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	friEnd := time.Date(2024, 1, 5, 0, 0, 0, 0, time.UTC)
	// Mon 2024-01-01 .. Sun 2024-01-07 inclusive = 5 weekdays (Sat+Sun excluded).
	weekEnd := time.Date(2024, 1, 7, 0, 0, 0, 0, time.UTC)

	tests := []struct {
		name      string
		symbols   []string
		timeframe string
		start     time.Time
		end       time.Time
		want      int64
	}{
		{"1d single symbol 5 weekdays", []string{"AAPL"}, "1d", monStart, friEnd, 5},
		{"1d two symbols", []string{"AAPL", "TSLA"}, "1d", monStart, friEnd, 10},
		{"weekend excluded", []string{"AAPL"}, "1d", monStart, weekEnd, 5},
		{"1h factor 7", []string{"AAPL"}, "1h", monStart, friEnd, 35},
		{"15m factor 26", []string{"AAPL"}, "15m", monStart, friEnd, 130},
		// Removed sub-15m timeframes are unrecognized → default factor 1.
		{"5m removed defaults to 1", []string{"AAPL"}, "5m", monStart, friEnd, 5},
		{"1m removed defaults to 1", []string{"AAPL"}, "1m", monStart, friEnd, 5},
		{"1Day alias", []string{"AAPL"}, "1Day", monStart, friEnd, 5},
		{"unknown timeframe defaults to 1", []string{"AAPL"}, "monthly", monStart, friEnd, 5},
		{"no symbols", []string{}, "1d", monStart, friEnd, 0},
		{"end before start", []string{"AAPL"}, "1d", friEnd, monStart, 0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := estimateExpectedBars(tt.symbols, tt.timeframe, tt.start, tt.end)
			if got != tt.want {
				t.Errorf("estimateExpectedBars(%v, %q) = %d, want %d", tt.symbols, tt.timeframe, got, tt.want)
			}
		})
	}
}

// TestDefaultBarLookback verifies the implicit history window scales with timeframe and bar
// count (so a daily chart looks back ~months, not the old flat 24h that returned ~0 bars),
// and that unknown timeframes fall back to a day-sized interval.
func TestDefaultBarLookback(t *testing.T) {
	tests := []struct {
		name string
		tf   string
		bars int
		want time.Duration
	}{
		{"daily_100_bars", "1d", 100, 100 * 24 * time.Hour * 3},
		{"hourly_50_bars", "1h", 50, 50 * time.Hour * 3},
		{"fifteen_min_200_bars", "15m", 200, 200 * 15 * time.Minute * 3},
		{"unknown_tf_falls_back_to_day", "1Day", 100, 100 * 24 * time.Hour * 3},
		{"nonpositive_bars_defaults_to_100", "1d", 0, 100 * 24 * time.Hour * 3},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := defaultBarLookback(tt.tf, tt.bars)
			if got != tt.want {
				t.Errorf("defaultBarLookback(%q, %d) = %v, want %v", tt.tf, tt.bars, got, tt.want)
			}
			// Regression guard: a daily window must dwarf the old flat 24h default.
			if tt.tf == "1d" && got <= 24*time.Hour {
				t.Errorf("defaultBarLookback(%q, %d) = %v, want >> 24h", tt.tf, tt.bars, got)
			}
		})
	}
}

// rng builds a common.v1.TimeRange from two times (nil-safe via zero check).
func rng(start, end time.Time) *commonv1.TimeRange {
	return &commonv1.TimeRange{Start: timestamppb.New(start), End: timestamppb.New(end)}
}

// TestResolveDeletePlan exercises the FR-5 server-side guards for DeleteBackfilledData without a
// DB or config server: symbol required (unbounded reject), admin-only (0x04), the delete-window
// cap, and timeframe/range resolution.
func TestResolveDeletePlan(t *testing.T) {
	day := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)

	t.Run("empty symbol is rejected as InvalidArgument", func(t *testing.T) {
		_, _, _, err := resolveDeletePlan("", "4", commonv1.Timeframe_TIMEFRAME_UNSPECIFIED, nil, 0)
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("want InvalidArgument, got %v (err=%v)", connect.CodeOf(err), err)
		}
	})

	t.Run("missing admin bit is rejected as PermissionDenied", func(t *testing.T) {
		_, _, _, err := resolveDeletePlan("AAPL", "0", commonv1.Timeframe_TIMEFRAME_UNSPECIFIED, nil, 0)
		if connect.CodeOf(err) != connect.CodePermissionDenied {
			t.Fatalf("want PermissionDenied, got %v (err=%v)", connect.CodeOf(err), err)
		}
	})

	t.Run("empty access scope is rejected as PermissionDenied", func(t *testing.T) {
		_, _, _, err := resolveDeletePlan("AAPL", "", commonv1.Timeframe_TIMEFRAME_UNSPECIFIED, nil, 0)
		if connect.CodeOf(err) != connect.CodePermissionDenied {
			t.Fatalf("want PermissionDenied, got %v", connect.CodeOf(err))
		}
	})

	t.Run("admin whole-symbol (no range, all timeframes) is accepted", func(t *testing.T) {
		canonical, start, end, err := resolveDeletePlan("AAPL", "4", commonv1.Timeframe_TIMEFRAME_UNSPECIFIED, nil, 0)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if canonical != "" || !start.IsZero() || !end.IsZero() {
			t.Fatalf("want empty plan, got canonical=%q start=%v end=%v", canonical, start, end)
		}
	})

	t.Run("timeframe is resolved to canonical string", func(t *testing.T) {
		canonical, _, _, err := resolveDeletePlan("AAPL", "4", commonv1.Timeframe_TIMEFRAME_1DAY, nil, 0)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if canonical != "1d" {
			t.Fatalf("want canonical 1d, got %q", canonical)
		}
	})

	t.Run("range within max_delete_days is accepted", func(t *testing.T) {
		_, start, end, err := resolveDeletePlan("AAPL", "4", commonv1.Timeframe_TIMEFRAME_UNSPECIFIED, rng(day, day.AddDate(0, 0, 5)), 30)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if start.IsZero() || end.IsZero() {
			t.Fatalf("want parsed range, got start=%v end=%v", start, end)
		}
	})

	t.Run("range exceeding max_delete_days is rejected as InvalidArgument", func(t *testing.T) {
		_, _, _, err := resolveDeletePlan("AAPL", "4", commonv1.Timeframe_TIMEFRAME_UNSPECIFIED, rng(day, day.AddDate(0, 0, 30)), 7)
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("want InvalidArgument, got %v (err=%v)", connect.CodeOf(err), err)
		}
	})

	t.Run("max_delete_days=0 disables the window guard", func(t *testing.T) {
		_, _, _, err := resolveDeletePlan("AAPL", "4", commonv1.Timeframe_TIMEFRAME_UNSPECIFIED, rng(day, day.AddDate(5, 0, 0)), 0)
		if err != nil {
			t.Fatalf("window guard should be off, got %v", err)
		}
	})
}

// ── Fundamentals (feature 059) ───────────────────────────────────────────────

type fakeFundRepo struct {
	rows       map[string]*source.Fundamentals
	fetchedAt  map[string]time.Time
	todayCount int
	sinceCount int
	upserts    int
}

func newFakeFundRepo() *fakeFundRepo {
	return &fakeFundRepo{rows: map[string]*source.Fundamentals{}, fetchedAt: map[string]time.Time{}}
}

func (r *fakeFundRepo) GetFundamentals(_ context.Context, symbol string) (*source.Fundamentals, time.Time, bool, error) {
	f, ok := r.rows[symbol]
	if !ok || f == nil {
		return nil, time.Time{}, false, nil
	}
	return f, r.fetchedAt[symbol], true, nil
}

func (r *fakeFundRepo) UpsertFundamentals(_ context.Context, f *source.Fundamentals) error {
	r.upserts++
	r.rows[f.Symbol] = f
	r.fetchedAt[f.Symbol] = time.Now()
	r.todayCount++
	return nil
}

func (r *fakeFundRepo) CountFundamentalsFetchedToday(_ context.Context) (int, error) {
	return r.todayCount, nil
}

// CountFundamentalsFetchedSince is the rolling-window sibling (feature 129, Step 4).
// Tests set sinceCount directly, mirroring how todayCount is set directly today rather
// than derived from real timestamps — the dispatch logic under test (fundamentalsQuota)
// only cares which repo method gets called for which provider, not real time math.
func (r *fakeFundRepo) CountFundamentalsFetchedSince(_ context.Context, _ time.Time) (int, error) {
	return r.sinceCount, nil
}

type fakeFundSource struct {
	calls   int
	resp    *source.Fundamentals
	respErr error
}

func (s *fakeFundSource) GetFundamentals(_ context.Context, symbol string) (*source.Fundamentals, error) {
	s.calls++
	if s.respErr != nil {
		return nil, s.respErr
	}
	r := *s.resp
	r.Symbol = symbol
	return &r, nil
}

func (s *fakeFundSource) GetFundamentalsMulti(_ context.Context, symbols []string) ([]*source.Fundamentals, error) {
	s.calls++
	if s.respErr != nil {
		return nil, s.respErr
	}
	out := make([]*source.Fundamentals, 0, len(symbols))
	for _, sym := range symbols {
		r := *s.resp
		r.Symbol = sym
		out = append(out, &r)
	}
	return out, nil
}

type fakeCfg struct {
	bools   map[string]bool
	ints    map[string]int64
	strings map[string]string
}

func (c *fakeCfg) GetBool(k string, d bool) bool {
	if v, ok := c.bools[k]; ok {
		return v
	}
	return d
}
func (c *fakeCfg) GetInt(k string, d int64) int64 {
	if v, ok := c.ints[k]; ok {
		return v
	}
	return d
}
func (c *fakeCfg) GetString(k, d string) string {
	if v, ok := c.strings[k]; ok {
		return v
	}
	return d
}

type fakeNotify struct {
	notifyv1.NotifyServiceClient
	warnings int
}

func (n *fakeNotify) EmitAlert(_ context.Context, in *notifyv1.EmitAlertRequest, _ ...grpc.CallOption) (*notifyv1.EmitAlertResponse, error) {
	if in.Severity == notifyv1.AlertSeverity_ALERT_SEVERITY_WARNING {
		n.warnings++
	}
	return &notifyv1.EmitAlertResponse{}, nil
}

// enabledCfg seeds the enabled/cache/quota keys for the given provider ("fmp" or
// "finnhub", feature 129) — each provider's key set and quota shape differ (FMP:
// daily_request_cap; Finnhub: symbols_per_minute + rate_window_seconds).
func enabledCfg(provider string) *fakeCfg {
	switch provider {
	case "finnhub":
		return &fakeCfg{
			bools: map[string]bool{"marketdata.finnhub.enabled": true},
			ints: map[string]int64{
				"marketdata.finnhub.cache_ttl_hours":     24,
				"marketdata.finnhub.symbols_per_minute":  20,
				"marketdata.finnhub.rate_window_seconds": 60,
			},
		}
	default:
		return &fakeCfg{
			bools: map[string]bool{"marketdata.fmp.enabled": true},
			ints:  map[string]int64{"marketdata.fmp.cache_ttl_hours": 24, "marketdata.fmp.daily_request_cap": 250},
		}
	}
}

func newFundSvc(cfg *fakeCfg, repo *fakeFundRepo, src source.FundamentalsSource, notify notifyv1.NotifyServiceClient, provider string) *MarketDataService {
	return &MarketDataService{fundamentals: src, fundProvider: provider, fundCfg: cfg, fundRepo: repo, notify: notify}
}

// Acceptance #2: a within-TTL second call issues zero FMP calls.
func TestGetFundamentals_CacheHitNoFMP(t *testing.T) {
	repo := newFakeFundRepo()
	repo.rows["AAPL"] = &source.Fundamentals{Symbol: "AAPL", Price: f64p(100)}
	repo.fetchedAt["AAPL"] = time.Now()
	src := &fakeFundSource{resp: &source.Fundamentals{Price: f64p(200)}}
	svc := newFundSvc(enabledCfg("fmp"), repo, src, &fakeNotify{}, "fmp")

	f, err := svc.GetFundamentals(context.Background(), "AAPL")
	if err != nil {
		t.Fatalf("GetFundamentals: %v", err)
	}
	if f.Price != 100 || f.Stale {
		t.Fatalf("expected fresh cache hit, got %+v", f)
	}
	if src.calls != 0 {
		t.Fatalf("cache hit should issue zero FMP calls, got %d", src.calls)
	}
}

// TestToProtoFundamentals_MissingMetrics is the regression test for the null-as-zero bug
// fix: a nil metric pointer must surface in the wire message's missing_metrics list (and
// nowhere else does the wire carry that distinction, since the numeric field itself stays
// 0.0 either way — a consumer that skips missing_metrics silently gets the old buggy
// behavior back).
func TestToProtoFundamentals_MissingMetrics(t *testing.T) {
	repo := newFakeFundRepo()
	repo.rows["AAPL"] = &source.Fundamentals{
		Symbol:    "AAPL",
		Price:     f64p(100),
		MarketCap: f64p(2.5e12),
		ROE:       f64p(0), // genuine zero — must NOT appear in missing_metrics
		// PERatio, PBRatio, DividendYield, EPS, Beta, DebtToEquity, YearHigh, YearLow: nil
	}
	repo.fetchedAt["AAPL"] = time.Now()
	svc := newFundSvc(enabledCfg("fmp"), repo, &fakeFundSource{}, &fakeNotify{}, "fmp")

	f, err := svc.GetFundamentals(context.Background(), "AAPL")
	if err != nil {
		t.Fatalf("GetFundamentals: %v", err)
	}
	want := map[string]bool{
		"pe_ratio": true, "pb_ratio": true, "dividend_yield": true, "eps": true,
		"beta": true, "debt_to_equity": true, "year_high": true, "year_low": true,
	}
	if len(f.MissingMetrics) != len(want) {
		t.Fatalf("missing_metrics: got %v, want exactly %v", f.MissingMetrics, want)
	}
	for _, m := range f.MissingMetrics {
		if !want[m] {
			t.Errorf("unexpected metric %q in missing_metrics: %v", m, f.MissingMetrics)
		}
	}
	for _, present := range []string{"market_cap", "price", "roe"} {
		for _, m := range f.MissingMetrics {
			if m == present {
				t.Errorf("%q has a real value and must not be in missing_metrics: %v", present, f.MissingMetrics)
			}
		}
	}
	if f.Roe != 0 {
		t.Fatalf("Roe: expected wire value 0 (genuine zero), got %v", f.Roe)
	}
}

// Acceptance #3a: at-cap miss with a stale cache returns stale=true.
func TestGetFundamentals_AtCapStale(t *testing.T) {
	repo := newFakeFundRepo()
	repo.rows["AAPL"] = &source.Fundamentals{Symbol: "AAPL", Price: f64p(100)}
	repo.fetchedAt["AAPL"] = time.Now().Add(-48 * time.Hour)
	repo.todayCount = 250
	src := &fakeFundSource{resp: &source.Fundamentals{Price: f64p(200)}}
	svc := newFundSvc(enabledCfg("fmp"), repo, src, &fakeNotify{}, "fmp")

	f, err := svc.GetFundamentals(context.Background(), "AAPL")
	if err != nil {
		t.Fatalf("GetFundamentals: %v", err)
	}
	if !f.Stale {
		t.Fatalf("expected stale=true under quota exhaustion, got %+v", f)
	}
	if src.calls != 0 {
		t.Fatalf("at-cap must not call FMP, got %d", src.calls)
	}
}

// Acceptance #3b: at-cap miss with NO cache returns ResourceExhausted.
func TestGetFundamentals_AtCapNoCacheResourceExhausted(t *testing.T) {
	repo := newFakeFundRepo()
	repo.todayCount = 250
	src := &fakeFundSource{resp: &source.Fundamentals{Price: f64p(200)}}
	svc := newFundSvc(enabledCfg("fmp"), repo, src, &fakeNotify{}, "fmp")

	_, err := svc.GetFundamentals(context.Background(), "AAPL")
	if connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("expected ResourceExhausted, got %v", err)
	}
}

// Acceptance #4: enabled=false returns FailedPrecondition and makes zero FMP calls.
func TestGetFundamentals_DisabledFailedPrecondition(t *testing.T) {
	repo := newFakeFundRepo()
	src := &fakeFundSource{resp: &source.Fundamentals{Price: f64p(200)}}
	cfg := &fakeCfg{bools: map[string]bool{"marketdata.fmp.enabled": false}}
	svc := newFundSvc(cfg, repo, src, &fakeNotify{}, "fmp")

	_, err := svc.GetFundamentals(context.Background(), "AAPL")
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("expected FailedPrecondition, got %v", err)
	}
	if src.calls != 0 {
		t.Fatalf("disabled must not call FMP, got %d", src.calls)
	}
}

// TestGetFundamentals_LiveToggle_NoRestart proves the acceptance criteria (feature 082):
// flipping marketdata.fmp.enabled live, on the SAME svc/cfg object — no restart — takes
// effect on the very next call, in both directions.
func TestGetFundamentals_LiveToggle_NoRestart(t *testing.T) {
	repo := newFakeFundRepo()
	src := &fakeFundSource{resp: &source.Fundamentals{Price: f64p(200)}}
	cfg := &fakeCfg{bools: map[string]bool{"marketdata.fmp.enabled": false}}
	svc := newFundSvc(cfg, repo, src, &fakeNotify{}, "fmp")

	// starts disabled: FailedPrecondition, zero FMP calls
	if _, err := svc.GetFundamentals(context.Background(), "AAPL"); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("expected FailedPrecondition while disabled, got %v", err)
	}
	if src.calls != 0 {
		t.Fatalf("disabled must not call FMP, got %d", src.calls)
	}

	// flip live, same cfg/svc, no restart: next call attempts a fetch
	cfg.bools["marketdata.fmp.enabled"] = true
	if _, err := svc.GetFundamentals(context.Background(), "AAPL"); err != nil {
		t.Fatalf("expected live-enabled fetch to succeed, got %v", err)
	}
	if src.calls != 1 {
		t.Fatalf("expected exactly 1 FMP call after live-enable, got %d", src.calls)
	}

	// flip back, same cfg/svc, no restart: short-circuits again, no further call
	cfg.bools["marketdata.fmp.enabled"] = false
	if _, err := svc.GetFundamentals(context.Background(), "AAPL"); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("expected FailedPrecondition after live-disable, got %v", err)
	}
	if src.calls != 1 {
		t.Fatalf("disabled again must not call FMP, got %d", src.calls)
	}
}

// Acceptance #5: miss + under cap fetches and upserts.
func TestGetFundamentals_MissFetchesAndUpserts(t *testing.T) {
	repo := newFakeFundRepo()
	src := &fakeFundSource{resp: &source.Fundamentals{Price: f64p(200)}}
	svc := newFundSvc(enabledCfg("fmp"), repo, src, &fakeNotify{}, "fmp")

	f, err := svc.GetFundamentals(context.Background(), "AAPL")
	if err != nil {
		t.Fatalf("GetFundamentals: %v", err)
	}
	if f.Price != 200 || f.Stale {
		t.Fatalf("expected fresh fetch, got %+v", f)
	}
	if src.calls != 1 || repo.upserts != 1 {
		t.Fatalf("expected 1 fetch + 1 upsert, got calls=%d upserts=%d", src.calls, repo.upserts)
	}
}

// FR-7: crossing 80% of the cap emits exactly one WARNING (deduped per day).
func TestGetFundamentals_QuotaWarningEmittedOnce(t *testing.T) {
	repo := newFakeFundRepo()
	repo.todayCount = 199 // post-fetch 200 == 80% of 250
	src := &fakeFundSource{resp: &source.Fundamentals{Price: f64p(200)}}
	notify := &fakeNotify{}
	svc := newFundSvc(enabledCfg("fmp"), repo, src, notify, "fmp")

	if _, err := svc.GetFundamentals(context.Background(), "AAPL"); err != nil {
		t.Fatalf("first fetch: %v", err)
	}
	if _, err := svc.GetFundamentals(context.Background(), "MSFT"); err != nil {
		t.Fatalf("second fetch: %v", err)
	}
	if notify.warnings != 1 {
		t.Fatalf("expected exactly 1 WARNING, got %d", notify.warnings)
	}
}

// FR-6 / feature-082: enabled but nil source — defensive-only guard. Since feature 082,
// fundamentalsSrc is always non-nil via newFundamentalsSource (cmd/server/main.go), so
// this path is unreachable through the current sole construction call site; kept as a
// guard against a future direct NewMarketDataService caller passing a nil source.
func TestGetFundamentals_NilSourceFailedPrecondition(t *testing.T) {
	svc := newFundSvc(enabledCfg("fmp"), newFakeFundRepo(), nil, &fakeNotify{}, "fmp")
	_, err := svc.GetFundamentals(context.Background(), "AAPL")
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("expected FailedPrecondition for nil source, got %v", err)
	}
}

// ── Fundamentals, Finnhub path (feature 129) ─────────────────────────────────
// Mirrors the 8 FMP-path tests above 1:1, proving Step 5's provider-dispatch
// generalization behaves identically in shape for a second provider while exercising
// the genuinely NEW behavior: the rolling-window quota shape (vs. FMP's fixed UTC day).

// Mirrors TestGetFundamentals_CacheHitNoFMP.
func TestGetFundamentals_Finnhub_CacheHitNoFetch(t *testing.T) {
	repo := newFakeFundRepo()
	repo.rows["AAPL"] = &source.Fundamentals{Symbol: "AAPL", Price: f64p(100)}
	repo.fetchedAt["AAPL"] = time.Now()
	src := &fakeFundSource{resp: &source.Fundamentals{Price: f64p(200)}}
	svc := newFundSvc(enabledCfg("finnhub"), repo, src, &fakeNotify{}, "finnhub")

	f, err := svc.GetFundamentals(context.Background(), "AAPL")
	if err != nil {
		t.Fatalf("GetFundamentals: %v", err)
	}
	if f.Price != 100 || f.Stale {
		t.Fatalf("expected fresh cache hit, got %+v", f)
	}
	if src.calls != 0 {
		t.Fatalf("cache hit should issue zero Finnhub calls, got %d", src.calls)
	}
}

// Mirrors TestGetFundamentals_AtCapStale, using the rolling-window counter
// (sinceCount) against marketdata.finnhub.symbols_per_minute (20) instead of FMP's
// todayCount against daily_request_cap.
func TestGetFundamentals_Finnhub_AtCapStale(t *testing.T) {
	repo := newFakeFundRepo()
	repo.rows["AAPL"] = &source.Fundamentals{Symbol: "AAPL", Price: f64p(100)}
	repo.fetchedAt["AAPL"] = time.Now().Add(-48 * time.Hour)
	repo.sinceCount = 20
	src := &fakeFundSource{resp: &source.Fundamentals{Price: f64p(200)}}
	svc := newFundSvc(enabledCfg("finnhub"), repo, src, &fakeNotify{}, "finnhub")

	f, err := svc.GetFundamentals(context.Background(), "AAPL")
	if err != nil {
		t.Fatalf("GetFundamentals: %v", err)
	}
	if !f.Stale {
		t.Fatalf("expected stale=true under quota exhaustion, got %+v", f)
	}
	if src.calls != 0 {
		t.Fatalf("at-cap must not call Finnhub, got %d", src.calls)
	}
}

// Mirrors TestGetFundamentals_AtCapNoCacheResourceExhausted.
func TestGetFundamentals_Finnhub_AtCapNoCacheResourceExhausted(t *testing.T) {
	repo := newFakeFundRepo()
	repo.sinceCount = 20
	src := &fakeFundSource{resp: &source.Fundamentals{Price: f64p(200)}}
	svc := newFundSvc(enabledCfg("finnhub"), repo, src, &fakeNotify{}, "finnhub")

	_, err := svc.GetFundamentals(context.Background(), "AAPL")
	if connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("expected ResourceExhausted, got %v", err)
	}
}

// Mirrors TestGetFundamentals_DisabledFailedPrecondition, and additionally asserts the
// error text names "finnhub" — proving Step 5.6's fundamentalsEnabled() generalization
// actually dispatches on the active provider rather than hardcoding "fmp".
func TestGetFundamentals_Finnhub_DisabledFailedPrecondition(t *testing.T) {
	repo := newFakeFundRepo()
	src := &fakeFundSource{resp: &source.Fundamentals{Price: f64p(200)}}
	cfg := &fakeCfg{bools: map[string]bool{"marketdata.finnhub.enabled": false}}
	svc := newFundSvc(cfg, repo, src, &fakeNotify{}, "finnhub")

	_, err := svc.GetFundamentals(context.Background(), "AAPL")
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("expected FailedPrecondition, got %v", err)
	}
	if !strings.Contains(err.Error(), "finnhub fundamentals source disabled") {
		t.Fatalf("expected provider-specific error text, got %v", err)
	}
	if src.calls != 0 {
		t.Fatalf("disabled must not call Finnhub, got %d", src.calls)
	}
}

// Mirrors TestGetFundamentals_MissFetchesAndUpserts, and additionally asserts
// toProtoFundamentals' empty-Source fallback is "finnhub" not "fmp" (Step 5.9) when the
// fake source returns an empty Source, exactly as the existing FMP test's fake does.
func TestGetFundamentals_Finnhub_MissFetchesAndUpserts(t *testing.T) {
	repo := newFakeFundRepo()
	src := &fakeFundSource{resp: &source.Fundamentals{Price: f64p(200)}} // Source left empty
	svc := newFundSvc(enabledCfg("finnhub"), repo, src, &fakeNotify{}, "finnhub")

	f, err := svc.GetFundamentals(context.Background(), "AAPL")
	if err != nil {
		t.Fatalf("GetFundamentals: %v", err)
	}
	if f.Price != 200 || f.Stale {
		t.Fatalf("expected fresh fetch, got %+v", f)
	}
	if src.calls != 1 || repo.upserts != 1 {
		t.Fatalf("expected 1 fetch + 1 upsert, got calls=%d upserts=%d", src.calls, repo.upserts)
	}
	if f.Source != "finnhub" {
		t.Fatalf("expected empty-Source fallback to be the active provider %q, got %q", "finnhub", f.Source)
	}
}

// TestGetFundamentals_Finnhub_QuotaWarningRefiresPerWindow proves the NEW behavior
// design.md called for: unlike FMP's UTC-day dedup (which fires once and stays silent
// for the rest of the day), Finnhub's rolling-window dedup must re-fire once the window
// bucket changes. There is no injectable clock on maybeAlertQuota, so — exactly like
// repo.sinceCount/todayCount are set directly elsewhere in this suite to force a quota
// precondition without issuing real requests — this test forces the bucket-changed
// precondition directly by overwriting quotaAlertBucket between calls, isolating the
// exact comparison branch under test (see the 2026-07-30 082-fix-fmp-config-boot-only
// insight on composing a proof from narrower unit facts instead of a fragile/disproportionate
// end-to-end test — here, a real 60s sleep to observe a genuine new window).
func TestGetFundamentals_Finnhub_QuotaWarningRefiresPerWindow(t *testing.T) {
	repo := newFakeFundRepo()
	repo.sinceCount = 15 // post-fetch 16 == 80% of 20
	src := &fakeFundSource{resp: &source.Fundamentals{Price: f64p(200)}}
	notify := &fakeNotify{}
	svc := newFundSvc(enabledCfg("finnhub"), repo, src, notify, "finnhub")

	if _, err := svc.GetFundamentals(context.Background(), "AAPL"); err != nil {
		t.Fatalf("first fetch: %v", err)
	}
	if notify.warnings != 1 {
		t.Fatalf("expected exactly 1 WARNING after crossing 80%%, got %d", notify.warnings)
	}
	// Same window: a second crossing must NOT re-fire (dedup still holds).
	if _, err := svc.GetFundamentals(context.Background(), "MSFT"); err != nil {
		t.Fatalf("second fetch (same window): %v", err)
	}
	if notify.warnings != 1 {
		t.Fatalf("expected dedup to hold within the same window, got %d warnings", notify.warnings)
	}

	// Simulate the rolling window having moved on to a new bucket.
	svc.quotaAlertBucket = "stale-bucket-forces-refire"
	if _, err := svc.GetFundamentals(context.Background(), "GOOG"); err != nil {
		t.Fatalf("third fetch (new window): %v", err)
	}
	if notify.warnings != 2 {
		t.Fatalf("expected a second WARNING once the window bucket changed, got %d", notify.warnings)
	}
}

// TestGetFundamentals_Finnhub_ThreeCallsPerSymbolCostsQuota is a service-level sanity
// check (not a duplicate of Step 3's client-level HTTP-call-count test): fetching N
// symbols via GetFundamentalsMulti against a Finnhub-backed service correctly advances
// the quota-crossing math by len(fetched) — the service layer only ever sees "N symbols
// fetched", never the raw per-symbol HTTP call count, which finnhub_client_test.go's
// TestGetFundamentalsMulti_ThreeCallsPerSymbol proves separately at the client level.
func TestGetFundamentals_Finnhub_ThreeCallsPerSymbolCostsQuota(t *testing.T) {
	repo := newFakeFundRepo()
	repo.sinceCount = 17 // 17 + 3 fetched == 20 == 100% of cap, crosses the 80% (16) threshold
	src := &fakeFundSource{resp: &source.Fundamentals{Price: f64p(200)}}
	notify := &fakeNotify{}
	svc := newFundSvc(enabledCfg("finnhub"), repo, src, notify, "finnhub")

	out, err := svc.GetFundamentalsMulti(context.Background(), []string{"AAPL", "MSFT", "GOOG"})
	if err != nil {
		t.Fatalf("GetFundamentalsMulti: %v", err)
	}
	if len(out) != 3 {
		t.Fatalf("expected 3 results, got %d", len(out))
	}
	if src.calls != 1 {
		t.Fatalf("expected exactly 1 GetFundamentalsMulti call to the source, got %d", src.calls)
	}
	if notify.warnings != 1 {
		t.Fatalf("expected quota WARNING once count+len(fetched) crosses 80%% of cap, got %d", notify.warnings)
	}
}

// ── BackfillBars (feature 080 AC-11) ─────────────────────────────────────────

// fakeLedger overrides only AppendEvent; emitEvent (marketdata_service.go:774) calls it
// unconditionally before BackfillBars ever resolves the source.
type fakeLedger struct {
	ledgerv1.LedgerServiceClient
}

func (*fakeLedger) AppendEvent(context.Context, *ledgerv1.AppendEventRequest, ...grpc.CallOption) (*ledgerv1.AppendEventResponse, error) {
	return &ledgerv1.AppendEventResponse{}, nil
}

// fakeBackfillSource implements source.DataSourceClient and records the timeframe string
// BackfillBars hands to GetBars. Returns zero bars so InsertBars — nil s.repo in this test —
// is never reached. The other four methods are unused by BackfillBars.
type fakeBackfillSource struct {
	gotTimeframe string
}

func (f *fakeBackfillSource) GetBars(_ context.Context, _ string, timeframe string, _ time.Time, _ time.Time) ([]*marketdatav1.Bar, error) {
	f.gotTimeframe = timeframe
	return nil, nil
}
func (*fakeBackfillSource) GetLatestQuote(context.Context, string) (*marketdatav1.Quote, error) {
	return nil, nil
}
func (*fakeBackfillSource) ListAssets(context.Context, string) ([]*commonv1.Asset, error) {
	return nil, nil
}
func (*fakeBackfillSource) StreamBars(context.Context, []string, string) (<-chan *marketdatav1.Bar, error) {
	return nil, nil
}
func (*fakeBackfillSource) StreamQuotes(context.Context, []string) (<-chan *marketdatav1.Quote, error) {
	return nil, nil
}

// TestBackfillBars_EnumOnlyRequestResolves is the missing AC-11 verification: "a request
// carrying only timeframe_enum (no string) succeeds — the condition that is broken today
// and is the whole point of the migration." Red against the pre-Step-3 tree: BackfillBars
// passes req.Timeframe raw, so the fake records "".
func TestBackfillBars_EnumOnlyRequestResolves(t *testing.T) {
	reg := source.NewRegistry()
	fake := &fakeBackfillSource{}
	reg.Register("alpaca", fake)

	svc := &MarketDataService{registry: reg, ledger: &fakeLedger{}}

	req := &marketdatav1.BackfillBarsRequest{
		Symbols:       []string{"AAPL"},
		TimeframeEnum: commonv1.Timeframe_TIMEFRAME_1DAY,
		// Timeframe (deprecated string) deliberately left unset — this is the shape an
		// enum-only caller sends.
	}
	if _, err := svc.BackfillBars(context.Background(), req); err != nil {
		t.Fatalf("BackfillBars failed: %v", err)
	}
	if fake.gotTimeframe != "1d" {
		t.Errorf("expected GetBars to receive canonical timeframe %q, got %q", "1d", fake.gotTimeframe)
	}
}

// TestGetBars_RejectsNon1d / TestBackfillBars_RejectsNon1d — feature 143: only "1d" is
// servable going forward; GetBars/BackfillBars reject any other requested timeframe with
// InvalidArgument.
func TestGetBars_RejectsNon1d(t *testing.T) {
	svc := &MarketDataService{registry: source.NewRegistry(), ledger: &fakeLedger{}}
	req := &marketdatav1.GetBarsRequest{
		Symbol:        "AAPL",
		TimeframeEnum: commonv1.Timeframe_TIMEFRAME_15MIN, //nolint:staticcheck // SA1019: deliberately sends a now-deprecated (feature 143) timeframe to prove it is rejected
	}
	_, err := svc.GetBars(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("want InvalidArgument, got %v (err=%v)", connect.CodeOf(err), err)
	}
}

func TestBackfillBars_RejectsNon1d(t *testing.T) {
	svc := &MarketDataService{registry: source.NewRegistry(), ledger: &fakeLedger{}}
	req := &marketdatav1.BackfillBarsRequest{
		Symbols:       []string{"AAPL"},
		TimeframeEnum: commonv1.Timeframe_TIMEFRAME_1HOUR, //nolint:staticcheck // SA1019: deliberately sends a now-deprecated (feature 143) timeframe to prove it is rejected
	}
	_, err := svc.BackfillBars(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("want InvalidArgument, got %v (err=%v)", connect.CodeOf(err), err)
	}
}

// TestMinIngestLookback is the regression test for the second half of the OHLCV-staleness
// bug fix: the configured marketdata.stream.bar_ingest_lookback_ms (900000ms = 15min
// default) is sized for the "15m" timeframe and is far too short to ever re-cover a "1d"
// bar (24h interval) — ingestRecentBars must widen the window per timeframe rather than
// applying that flat value to every configured timeframe.
func TestMinIngestLookback(t *testing.T) {
	cases := []struct {
		tf   string
		want time.Duration
	}{
		{"15m", 30 * time.Minute},
		{"1h", 2 * time.Hour},
		{"1d", 48 * time.Hour}, // >> the 15min-sized configured default — the actual bug fix
		{"unknown", 0},
	}
	for _, tc := range cases {
		t.Run(tc.tf, func(t *testing.T) {
			if got := minIngestLookback(tc.tf); got != tc.want {
				t.Errorf("minIngestLookback(%q) = %v, want %v", tc.tf, got, tc.want)
			}
		})
	}
	// The actual defect: the flat 15-min-sized default must not be used unmodified for "1d".
	const defaultLookback = 900000 * time.Millisecond
	if got := minIngestLookback("1d"); got <= defaultLookback {
		t.Fatalf("minIngestLookback(\"1d\") = %v, must exceed the 15m-sized default %v", got, defaultLookback)
	}
}

// countingWarnHandler counts slog.LevelWarn records. slog.SetDefault is process-global, so
// this test (and its subtests) must not call t.Parallel() — see resolveIngestTimeframes'
// doc comment and feature 080 implementation-spec.md Step 4 instruction 5.
type countingWarnHandler struct {
	count *int
}

func (h *countingWarnHandler) Enabled(context.Context, slog.Level) bool { return true }
func (h *countingWarnHandler) Handle(_ context.Context, r slog.Record) error {
	if r.Level == slog.LevelWarn {
		*h.count++
	}
	return nil
}
func (h *countingWarnHandler) WithAttrs([]slog.Attr) slog.Handler { return h }
func (h *countingWarnHandler) WithGroup(string) slog.Handler      { return h }

// TestResolveIngestTimeframes covers AC-10's three cases plus the list-parsing bug fix
// (a single configured timeframe used to leave every OTHER continuously-consumed
// timeframe — "1d" in particular — permanently stale; see defaultBarIngestTimeframe's doc
// comment), with the paired "something does change" WARN assertion (insights.md
// 2026-07-27, teeth test).
func TestResolveIngestTimeframes(t *testing.T) {
	cases := []struct {
		name     string
		raw      string
		want     []string
		wantWarn int
	}{
		{"empty falls back to default list", "", []string{"1d"}, 0}, // feature 143: default narrowed 15m,1d → 1d
		{"canonical 1d passes through", "1d", []string{"1d"}, 0},
		{"canonical 1h passes through", "1h", []string{"1h"}, 0},
		{"canonical 15m passes through", "15m", []string{"15m"}, 0},
		{"alias 1Day resolves", "1Day", []string{"1d"}, 0},
		{"alias 1Hour resolves", "1Hour", []string{"1h"}, 0},
		{"alias 15Min resolves", "15Min", []string{"15m"}, 0},
		{"comma list resolves in order", "15m,1d", []string{"15m", "1d"}, 0},
		{"comma list tolerates whitespace", "15m, 1d", []string{"15m", "1d"}, 0},
		{"duplicates deduped", "15m,15m,1d", []string{"15m", "1d"}, 0},
		{"unresolvable entry skipped, valid entries kept", "15m,10Min", []string{"15m"}, 1},
		{"wholly unresolvable falls back to default and warns twice", "10Min", []string{"1d"}, 2}, // feature 143: default narrowed 15m,1d → 1d
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			warnCount := 0
			prev := slog.Default()
			slog.SetDefault(slog.New(&countingWarnHandler{count: &warnCount}))
			t.Cleanup(func() { slog.SetDefault(prev) })

			got := resolveIngestTimeframes(tc.raw)
			if len(got) != len(tc.want) {
				t.Fatalf("resolveIngestTimeframes(%q) = %v, want %v", tc.raw, got, tc.want)
			}
			for i := range got {
				if got[i] != tc.want[i] {
					t.Errorf("resolveIngestTimeframes(%q) = %v, want %v", tc.raw, got, tc.want)
				}
			}
			if warnCount != tc.wantWarn {
				t.Errorf("resolveIngestTimeframes(%q): expected %d WARN record(s), got %d", tc.raw, tc.wantWarn, warnCount)
			}
		})
	}
}
