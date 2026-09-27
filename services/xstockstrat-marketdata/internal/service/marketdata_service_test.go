package service

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"sync"
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

// TestStaleCheckDue covers feature 140 FR-3's per-(symbol,tf) cooldown: the first check for a key is
// due (and marks it), an immediate repeat within one interval is suppressed, and after one interval
// it is due again. This is the guard that stops a weekend/holiday — where the newest real bar is
// legitimately older than one interval — from refetching from Alpaca on every chart poll.
func TestStaleCheckDue(t *testing.T) {
	s := &MarketDataService{lastStaleCheck: make(map[string]time.Time)}
	interval := 24 * time.Hour
	t0 := time.Date(2026, 8, 18, 12, 0, 0, 0, time.UTC)

	if !s.staleCheckDue("AAPL", "1d", interval, t0) {
		t.Fatal("first check for AAPL|1d should be due")
	}
	if s.staleCheckDue("AAPL", "1d", interval, t0.Add(time.Hour)) {
		t.Error("repeat within one interval should be suppressed")
	}
	if s.staleCheckDue("AAPL", "1d", interval, t0.Add(interval-time.Second)) {
		t.Error("just under one interval should still be suppressed")
	}
	if !s.staleCheckDue("AAPL", "1d", interval, t0.Add(interval+time.Second)) {
		t.Error("after one interval the check should be due again")
	}
	// A different (symbol,tf) key is tracked independently.
	if !s.staleCheckDue("MSFT", "1d", interval, t0.Add(time.Hour)) {
		t.Error("first check for a different symbol should be due")
	}
	if !s.staleCheckDue("AAPL", "1h", interval, t0.Add(time.Hour)) {
		t.Error("first check for a different timeframe on the same symbol should be due")
	}
}

// TestTruncateBars covers feature 140 FR-7's cache-write-failure fallback slice: when serving
// freshly-fetched (ascending) live bars without a DB re-read, the recent path must return the NEWEST
// pageSize bars, the non-recent path the first page, and a short slice passes through untouched.
func TestTruncateBars(t *testing.T) {
	mk := func(n int) []*marketdatav1.Bar {
		out := make([]*marketdatav1.Bar, n)
		for i := range out {
			out[i] = &marketdatav1.Bar{Time: timestamppb.New(time.Unix(int64(i), 0))}
		}
		return out
	}
	live := mk(5)

	recent := truncateBars(live, 2, true)
	if len(recent) != 2 || recent[0].GetTime().AsTime().Unix() != 3 || recent[1].GetTime().AsTime().Unix() != 4 {
		t.Errorf("recent=true should return the newest 2 bars [3,4], got %v", barsSeconds(recent))
	}
	oldest := truncateBars(live, 2, false)
	if len(oldest) != 2 || oldest[0].GetTime().AsTime().Unix() != 0 || oldest[1].GetTime().AsTime().Unix() != 1 {
		t.Errorf("recent=false should return the first 2 bars [0,1], got %v", barsSeconds(oldest))
	}
	if got := truncateBars(mk(2), 5, true); len(got) != 2 {
		t.Errorf("a slice shorter than pageSize should pass through, got len %d", len(got))
	}
}

func barsSeconds(bars []*marketdatav1.Bar) []int64 {
	out := make([]int64, len(bars))
	for i, b := range bars {
		out[i] = b.GetTime().AsTime().Unix()
	}
	return out
}

// TestMarkWarmFeedsIngestSet is a feature-140 regression guard on the autonomous-freshness contract:
// the set markWarm populates is exactly the set the always-on bar ingester consumes (warmSnapshot).
// If these ever diverge, a symbol could be queried yet never get its bars refreshed by the ingester
// — the failure mode the user asked to be protected against.
func TestMarkWarmFeedsIngestSet(t *testing.T) {
	s := &MarketDataService{warmSymbols: make(map[string]struct{})}
	if got := s.warmSnapshot(); len(got) != 0 {
		t.Fatalf("fresh service should have no warm symbols, got %v", got)
	}
	s.markWarm("AAPL")
	s.markWarm("MSFT")
	s.markWarm("AAPL") // idempotent
	s.markWarm("")     // ignored

	got := map[string]bool{}
	for _, sym := range s.warmSnapshot() {
		got[sym] = true
	}
	if len(got) != 2 || !got["AAPL"] || !got["MSFT"] {
		t.Errorf("warmSnapshot should be exactly {AAPL, MSFT}, got %v", got)
	}
}

// TestGetBarsMarksSymbolWarm guards the other half of the feature-140 autonomous-freshness contract:
// GetBars must warm the queried symbol, so that the analysis live loop / opportunities refresh —
// which query GetBars for every symbol they evaluate — thereby register those symbols for the
// always-on ingester WITHOUT any chart view. A structural (source) check because GetBars needs a live
// DB pool to invoke; removing the markWarm call would silently break autonomous bar freshness.
func TestGetBarsMarksSymbolWarm(t *testing.T) {
	src, err := os.ReadFile("marketdata_service.go")
	if err != nil {
		t.Fatalf("read source: %v", err)
	}
	body := funcBody(t, string(src), "func (s *MarketDataService) GetBars(")
	if !strings.Contains(body, "s.markWarm(req.Symbol)") {
		t.Error("GetBars must call s.markWarm(req.Symbol) — the query path feeds the always-on " +
			"ingester's warm set (feature 140 autonomous-freshness contract)")
	}
}

// funcBody returns the source text from the given func signature up to the next top-level `func (`.
func funcBody(t *testing.T, src, signature string) string {
	t.Helper()
	start := strings.Index(src, signature)
	if start < 0 {
		t.Fatalf("signature %q not found in source", signature)
	}
	rest := src[start+len(signature):]
	if end := strings.Index(rest, "\nfunc ("); end >= 0 {
		return rest[:end]
	}
	return rest
}

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

// ── feature 178: GetLatestQuotes batch method (single-flight + null-not-zero) ─────────────────

// fakeMultiSource implements source.DataSourceClient AND source.MultiSymbolSource. It serves only
// the symbols in `quotes` (an absent symbol proves null-not-zero) and counts upstream fetches; the
// optional started/release channels let a test force overlap to prove single-flight coalescing.
type fakeMultiSource struct {
	mu      sync.Mutex
	calls   int
	quotes  map[string]*marketdatav1.Quote
	started chan struct{}
	release chan struct{}
}

func (f *fakeMultiSource) GetLatestQuotesMulti(_ context.Context, symbols []string) (map[string]*marketdatav1.Quote, error) {
	f.mu.Lock()
	f.calls++
	f.mu.Unlock()
	if f.started != nil {
		close(f.started) // single-flight runs the fn once (leader), so this closes exactly once
	}
	if f.release != nil {
		<-f.release
	}
	out := map[string]*marketdatav1.Quote{}
	for _, s := range symbols {
		if q, ok := f.quotes[s]; ok {
			out[s] = q
		}
	}
	return out, nil
}

func (*fakeMultiSource) GetLatestTradesMulti(context.Context, []string) (map[string]*source.Trade, error) {
	return nil, nil
}
func (*fakeMultiSource) GetBarsMulti(context.Context, []string, string, time.Time, time.Time) (map[string][]*marketdatav1.Bar, error) {
	return nil, nil
}
func (*fakeMultiSource) GetBars(context.Context, string, string, time.Time, time.Time) ([]*marketdatav1.Bar, error) {
	return nil, nil
}
func (*fakeMultiSource) GetLatestQuote(context.Context, string) (*marketdatav1.Quote, error) {
	return nil, nil
}
func (*fakeMultiSource) ListAssets(context.Context, string) ([]*commonv1.Asset, error) {
	return nil, nil
}
func (*fakeMultiSource) StreamBars(context.Context, []string, string) (<-chan *marketdatav1.Bar, error) {
	return nil, nil
}
func (*fakeMultiSource) StreamQuotes(context.Context, []string) (<-chan *marketdatav1.Quote, error) {
	return nil, nil
}

// TestGetLatestQuotes_SingleFlightCoalescesColdFetch — @AC-3: five concurrent batch calls for the
// same cold symbol trigger exactly one upstream Alpaca fetch, and all callers receive the quote.
// Drives the no-DB path (nil repo → every symbol is cold) so no database is needed.
func TestGetLatestQuotes_SingleFlightCoalescesColdFetch(t *testing.T) {
	q := &marketdatav1.Quote{Symbol: "ZZZZ", AskPrice: 10, BidPrice: 9}
	fake := &fakeMultiSource{
		quotes:  map[string]*marketdatav1.Quote{"ZZZZ": q},
		started: make(chan struct{}),
		release: make(chan struct{}),
	}
	reg := source.NewRegistry()
	reg.Register("alpaca", fake)
	svc := &MarketDataService{registry: reg, warmSymbols: map[string]struct{}{}}

	const n = 5
	results := make([]*marketdatav1.Quote, n)
	errs := make([]error, n)
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			out, err := svc.GetLatestQuotes(context.Background(), []string{"ZZZZ"})
			errs[i] = err
			if len(out) == 1 {
				results[i] = out[0]
			}
		}(i)
	}
	<-fake.started                    // the leader is inside the upstream fetch
	time.Sleep(25 * time.Millisecond) // let the other four park in singleflight.Do
	close(fake.release)               // let the fetch return
	wg.Wait()

	if fake.calls != 1 {
		t.Fatalf("expected exactly 1 upstream fetch under concurrency, got %d", fake.calls)
	}
	for i := 0; i < n; i++ {
		if errs[i] != nil {
			t.Fatalf("caller %d error: %v", i, errs[i])
		}
		if results[i] == nil || results[i].Symbol != "ZZZZ" {
			t.Fatalf("caller %d got %v, want ZZZZ quote", i, results[i])
		}
	}
}

// TestGetLatestQuotes_OmitsMissingSymbol — @AC-4: a symbol the source can't serve is absent from
// the result (null-not-zero), never a fabricated zero-price Quote.
func TestGetLatestQuotes_OmitsMissingSymbol(t *testing.T) {
	fake := &fakeMultiSource{
		quotes: map[string]*marketdatav1.Quote{
			"AAPL": {Symbol: "AAPL", AskPrice: 190, BidPrice: 189},
		}, // NOQUOTE deliberately absent
	}
	reg := source.NewRegistry()
	reg.Register("alpaca", fake)
	svc := &MarketDataService{registry: reg, warmSymbols: map[string]struct{}{}}

	out, err := svc.GetLatestQuotes(context.Background(), []string{"AAPL", "NOQUOTE"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	bySym := map[string]*marketdatav1.Quote{}
	for _, qq := range out {
		bySym[qq.Symbol] = qq
	}
	if _, ok := bySym["AAPL"]; !ok {
		t.Fatalf("AAPL missing from batch result")
	}
	if _, ok := bySym["NOQUOTE"]; ok {
		t.Fatalf("NOQUOTE must be omitted (null-not-zero), got a Quote")
	}
	if len(out) != 1 {
		t.Fatalf("want exactly 1 quote, got %d", len(out))
	}
}

// ── feature 183: BatchGetBars (opportunities-latency-fix) ─────────────────────

// TestBatchGetBars_MultipleSymbols — @AC-2: batch returns bars for each requested symbol from
// the cold path (nil repo → all cold → fakeMultiSource.GetBarsMulti).
func TestBatchGetBars_MultipleSymbols(t *testing.T) {
	mkBar := func(sym string, ts int64) *marketdatav1.Bar {
		return &marketdatav1.Bar{Symbol: sym, Time: timestamppb.New(time.Unix(ts, 0)), Open: 1, High: 2, Low: 0.5, Close: 1.5, Volume: 100}
	}
	barsSrc := &fakeBatchBarsSource{
		bars: map[string][]*marketdatav1.Bar{
			"AAPL": {mkBar("AAPL", 1000), mkBar("AAPL", 2000)},
			"MSFT": {mkBar("MSFT", 1000)},
			"GOOG": {mkBar("GOOG", 1000), mkBar("GOOG", 2000), mkBar("GOOG", 3000)},
		},
	}
	reg := source.NewRegistry()
	reg.Register("alpaca", barsSrc)
	// nil repo forces all symbols cold → hits GetBarsMulti
	svc := &MarketDataService{registry: reg, warmSymbols: map[string]struct{}{}}

	resp, err := svc.BatchGetBars(context.Background(), &marketdatav1.BatchGetBarsRequest{
		Symbols:   []string{"AAPL", "MSFT", "GOOG"},
		Timeframe: "1d",
		Start:     timestamppb.New(time.Unix(0, 0)),
		End:       timestamppb.New(time.Unix(10000, 0)),
	})
	if err != nil {
		t.Fatalf("BatchGetBars: %v", err)
	}
	bySym := map[string]*marketdatav1.SymbolBars{}
	for _, sb := range resp.Results {
		bySym[sb.Symbol] = sb
	}
	if len(bySym) != 3 {
		t.Fatalf("expected 3 symbols in response, got %d: %v", len(bySym), resp.Results)
	}
	if len(bySym["AAPL"].Bars) != 2 {
		t.Errorf("AAPL: expected 2 bars, got %d", len(bySym["AAPL"].Bars))
	}
	if len(bySym["MSFT"].Bars) != 1 {
		t.Errorf("MSFT: expected 1 bar, got %d", len(bySym["MSFT"].Bars))
	}
	if len(bySym["GOOG"].Bars) != 3 {
		t.Errorf("GOOG: expected 3 bars, got %d", len(bySym["GOOG"].Bars))
	}
}

// TestBatchGetBars_OmitMissingSymbols — @AC-3: a symbol the source can't serve is absent from
// the response (omit-not-fabricate), never a zero-bar entry.
func TestBatchGetBars_OmitMissingSymbols(t *testing.T) {
	barsSrc := &fakeBatchBarsSource{
		bars: map[string][]*marketdatav1.Bar{
			"AAPL": {{Symbol: "AAPL", Time: timestamppb.New(time.Unix(1000, 0)), Close: 150}},
		}, // ZZZZ deliberately absent
	}
	reg := source.NewRegistry()
	reg.Register("alpaca", barsSrc)
	svc := &MarketDataService{registry: reg, warmSymbols: map[string]struct{}{}}

	resp, err := svc.BatchGetBars(context.Background(), &marketdatav1.BatchGetBarsRequest{
		Symbols:   []string{"AAPL", "ZZZZ"},
		Timeframe: "1d",
		Start:     timestamppb.New(time.Unix(0, 0)),
		End:       timestamppb.New(time.Unix(10000, 0)),
	})
	if err != nil {
		t.Fatalf("BatchGetBars: %v", err)
	}
	bySym := map[string]*marketdatav1.SymbolBars{}
	for _, sb := range resp.Results {
		bySym[sb.Symbol] = sb
	}
	if _, ok := bySym["AAPL"]; !ok {
		t.Fatal("AAPL must be present in response")
	}
	if _, ok := bySym["ZZZZ"]; ok {
		t.Fatal("ZZZZ must be omitted (omit-not-fabricate), got an entry")
	}
	if len(resp.Results) != 1 {
		t.Fatalf("expected exactly 1 SymbolBars entry, got %d", len(resp.Results))
	}
}

// TestBatchGetBars_RejectsNonDailyTimeframe — non-daily timeframe must return InvalidArgument.
func TestBatchGetBars_RejectsNonDailyTimeframe(t *testing.T) {
	reg := source.NewRegistry()
	svc := &MarketDataService{registry: reg, warmSymbols: map[string]struct{}{}}

	_, err := svc.BatchGetBars(context.Background(), &marketdatav1.BatchGetBarsRequest{
		Symbols:   []string{"AAPL"},
		Timeframe: "1h",
	})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("want InvalidArgument for non-daily timeframe, got %v (err=%v)", connect.CodeOf(err), err)
	}
}

// TestBatchGetBars_ClampsMaxBarsPerSymbol — the service-level cold path truncates bars to
// maxBarsPerSymbol. The repo-level 5000 clamp is enforced by QueryBarsBatch internally;
// here we verify the service truncation at the cold-path merge (line ~642).
func TestBatchGetBars_ClampsMaxBarsPerSymbol(t *testing.T) {
	// Generate 200 bars for AAPL; request maxBarsPerSymbol=50 to verify truncation.
	bars := make([]*marketdatav1.Bar, 200)
	for i := range bars {
		bars[i] = &marketdatav1.Bar{Symbol: "AAPL", Time: timestamppb.New(time.Unix(int64(i*86400), 0)), Close: float64(i)}
	}
	barsSrc := &fakeBatchBarsSource{
		bars: map[string][]*marketdatav1.Bar{"AAPL": bars},
	}
	reg := source.NewRegistry()
	reg.Register("alpaca", barsSrc)
	svc := &MarketDataService{registry: reg, warmSymbols: map[string]struct{}{}}

	resp, err := svc.BatchGetBars(context.Background(), &marketdatav1.BatchGetBarsRequest{
		Symbols:          []string{"AAPL"},
		Timeframe:        "1d",
		Start:            timestamppb.New(time.Unix(0, 0)),
		End:              timestamppb.New(time.Unix(int64(300*86400), 0)),
		MaxBarsPerSymbol: 50,
	})
	if err != nil {
		t.Fatalf("BatchGetBars: %v", err)
	}
	if len(resp.Results) != 1 {
		t.Fatalf("expected 1 SymbolBars entry, got %d", len(resp.Results))
	}
	if got := int32(len(resp.Results[0].Bars)); got != 50 {
		t.Fatalf("expected bars truncated to maxBarsPerSymbol=50, got %d", got)
	}
}

// TestBatchGetBars_DefaultMaxBars — maxBarsPerSymbol=0 defaults to 500.
func TestBatchGetBars_DefaultMaxBars(t *testing.T) {
	bars := make([]*marketdatav1.Bar, 600)
	for i := range bars {
		bars[i] = &marketdatav1.Bar{Symbol: "AAPL", Time: timestamppb.New(time.Unix(int64(i*86400), 0)), Close: float64(i)}
	}
	barsSrc := &fakeBatchBarsSource{
		bars: map[string][]*marketdatav1.Bar{"AAPL": bars},
	}
	reg := source.NewRegistry()
	reg.Register("alpaca", barsSrc)
	svc := &MarketDataService{registry: reg, warmSymbols: map[string]struct{}{}}

	resp, err := svc.BatchGetBars(context.Background(), &marketdatav1.BatchGetBarsRequest{
		Symbols:   []string{"AAPL"},
		Timeframe: "1d",
		Start:     timestamppb.New(time.Unix(0, 0)),
		End:       timestamppb.New(time.Unix(int64(700*86400), 0)),
		// MaxBarsPerSymbol deliberately unset (0 → default 500)
	})
	if err != nil {
		t.Fatalf("BatchGetBars: %v", err)
	}
	if len(resp.Results) != 1 {
		t.Fatalf("expected 1 SymbolBars entry, got %d", len(resp.Results))
	}
	if got := len(resp.Results[0].Bars); got != 500 {
		t.Fatalf("expected bars truncated to default maxBarsPerSymbol=500, got %d", got)
	}
}

// fakeBatchBarsSource implements source.DataSourceClient + source.MultiSymbolSource for batch
// bars tests. Returns only bars from the pre-seeded `bars` map; absent symbols are omitted.
type fakeBatchBarsSource struct {
	bars map[string][]*marketdatav1.Bar
}

func (f *fakeBatchBarsSource) GetBarsMulti(_ context.Context, symbols []string, _ string, _ time.Time, _ time.Time) (map[string][]*marketdatav1.Bar, error) {
	out := map[string][]*marketdatav1.Bar{}
	for _, s := range symbols {
		if b, ok := f.bars[s]; ok {
			out[s] = b
		}
	}
	return out, nil
}

func (*fakeBatchBarsSource) GetLatestQuotesMulti(context.Context, []string) (map[string]*marketdatav1.Quote, error) {
	return nil, nil
}
func (*fakeBatchBarsSource) GetBars(context.Context, string, string, time.Time, time.Time) ([]*marketdatav1.Bar, error) {
	return nil, nil
}
func (*fakeBatchBarsSource) GetLatestQuote(context.Context, string) (*marketdatav1.Quote, error) {
	return nil, nil
}
func (*fakeBatchBarsSource) ListAssets(context.Context, string) ([]*commonv1.Asset, error) {
	return nil, nil
}
func (*fakeBatchBarsSource) StreamBars(context.Context, []string, string) (<-chan *marketdatav1.Bar, error) {
	return nil, nil
}
func (*fakeBatchBarsSource) StreamQuotes(context.Context, []string) (<-chan *marketdatav1.Quote, error) {
	return nil, nil
}
func (*fakeBatchBarsSource) GetLatestTradesMulti(context.Context, []string) (map[string]*source.Trade, error) {
	return nil, nil
}

// ── feature 183: BatchGetLatestPrice (opportunities-latency-fix) ────────────────

// fakeBatchPriceSource implements source.DataSourceClient + source.MultiSymbolSource for
// BatchGetLatestPrice tests. Returns trades from the pre-seeded map; absent symbols are omitted.
type fakeBatchPriceSource struct {
	trades map[string]*source.Trade
}

func (f *fakeBatchPriceSource) GetLatestTradesMulti(_ context.Context, symbols []string) (map[string]*source.Trade, error) {
	out := make(map[string]*source.Trade, len(symbols))
	for _, s := range symbols {
		if t, ok := f.trades[s]; ok {
			out[s] = t
		}
	}
	return out, nil
}
func (f *fakeBatchPriceSource) GetBarsMulti(context.Context, []string, string, time.Time, time.Time) (map[string][]*marketdatav1.Bar, error) {
	return nil, nil
}
func (f *fakeBatchPriceSource) GetLatestQuotesMulti(context.Context, []string) (map[string]*marketdatav1.Quote, error) {
	return nil, nil
}
func (*fakeBatchPriceSource) GetBars(context.Context, string, string, time.Time, time.Time) ([]*marketdatav1.Bar, error) {
	return nil, nil
}
func (*fakeBatchPriceSource) GetLatestQuote(context.Context, string) (*marketdatav1.Quote, error) {
	return nil, nil
}
func (*fakeBatchPriceSource) ListAssets(context.Context, string) ([]*commonv1.Asset, error) {
	return nil, nil
}
func (*fakeBatchPriceSource) StreamBars(context.Context, []string, string) (<-chan *marketdatav1.Bar, error) {
	return nil, nil
}
func (*fakeBatchPriceSource) StreamQuotes(context.Context, []string) (<-chan *marketdatav1.Quote, error) {
	return nil, nil
}

// fakeLatestTradeOnlySource implements source.DataSourceClient + source.LatestTradeSource but
// NOT source.MultiSymbolSource — used to verify the per-symbol fallback path in BatchGetLatestPrice.
type fakeLatestTradeOnlySource struct {
	trades map[string]*source.Trade
}

func (f *fakeLatestTradeOnlySource) GetLatestTrade(_ context.Context, symbol string) (float64, time.Time, error) {
	if t, ok := f.trades[symbol]; ok {
		return t.Price, t.TradeTime, nil
	}
	return 0, time.Time{}, fmt.Errorf("no trade for %s", symbol)
}
func (*fakeLatestTradeOnlySource) GetBars(context.Context, string, string, time.Time, time.Time) ([]*marketdatav1.Bar, error) {
	return nil, nil
}
func (*fakeLatestTradeOnlySource) GetLatestQuote(context.Context, string) (*marketdatav1.Quote, error) {
	return nil, nil
}
func (*fakeLatestTradeOnlySource) ListAssets(context.Context, string) ([]*commonv1.Asset, error) {
	return nil, nil
}
func (*fakeLatestTradeOnlySource) StreamBars(context.Context, []string, string) (<-chan *marketdatav1.Bar, error) {
	return nil, nil
}
func (*fakeLatestTradeOnlySource) StreamQuotes(context.Context, []string) (<-chan *marketdatav1.Quote, error) {
	return nil, nil
}

// TestBatchGetLatestPrice_MultipleSymbols — @AC-4: batch returns latest price + prev close
// for each requested symbol from the cold path (nil repo → no prev close, trades from source).
func TestBatchGetLatestPrice_MultipleSymbols(t *testing.T) {
	ts := time.Date(2025, 1, 15, 14, 30, 0, 0, time.UTC)
	priceSrc := &fakeBatchPriceSource{
		trades: map[string]*source.Trade{
			"AAPL": {Price: 185.50, TradeTime: ts},
			"MSFT": {Price: 420.10, TradeTime: ts},
		},
	}
	reg := source.NewRegistry()
	reg.Register("alpaca", priceSrc)
	// nil repo → no prev close data, so only trades appear
	svc := &MarketDataService{registry: reg, warmSymbols: map[string]struct{}{}}

	resp, err := svc.BatchGetLatestPrice(context.Background(), &marketdatav1.BatchGetLatestPriceRequest{
		Symbols: []string{"AAPL", "MSFT"},
	})
	if err != nil {
		t.Fatalf("BatchGetLatestPrice: %v", err)
	}
	bySym := map[string]*marketdatav1.LatestPrice{}
	for _, lp := range resp.Results {
		bySym[lp.Symbol] = lp
	}
	if len(bySym) != 2 {
		t.Fatalf("expected 2 results, got %d", len(bySym))
	}
	aaplLP := bySym["AAPL"]
	if aaplLP.LastPrice == nil || *aaplLP.LastPrice != 185.50 {
		t.Errorf("AAPL: want LastPrice=185.50, got %v", aaplLP.LastPrice)
	}
	msftLP := bySym["MSFT"]
	if msftLP.LastPrice == nil || *msftLP.LastPrice != 420.10 {
		t.Errorf("MSFT: want LastPrice=420.10, got %v", msftLP.LastPrice)
	}
	if aaplLP.Source != "alpaca" {
		t.Errorf("AAPL: want Source='alpaca', got %q", aaplLP.Source)
	}
}

// TestBatchGetLatestPrice_OmitMissingSymbols — @AC-5: a symbol the source can't serve is absent
// from the response (omit-not-fabricate, AC-11 pattern).
func TestBatchGetLatestPrice_OmitMissingSymbols(t *testing.T) {
	priceSrc := &fakeBatchPriceSource{
		trades: map[string]*source.Trade{
			"AAPL": {Price: 185.50, TradeTime: time.Now()},
		}, // ZZZZ deliberately absent
	}
	reg := source.NewRegistry()
	reg.Register("alpaca", priceSrc)
	svc := &MarketDataService{registry: reg, warmSymbols: map[string]struct{}{}}

	resp, err := svc.BatchGetLatestPrice(context.Background(), &marketdatav1.BatchGetLatestPriceRequest{
		Symbols: []string{"AAPL", "ZZZZ"},
	})
	if err != nil {
		t.Fatalf("BatchGetLatestPrice: %v", err)
	}
	bySym := map[string]*marketdatav1.LatestPrice{}
	for _, lp := range resp.Results {
		bySym[lp.Symbol] = lp
	}
	if _, ok := bySym["AAPL"]; !ok {
		t.Fatal("AAPL must be present in response")
	}
	if _, ok := bySym["ZZZZ"]; ok {
		t.Fatal("ZZZZ must be omitted (omit-not-fabricate), got an entry")
	}
	if len(resp.Results) != 1 {
		t.Fatalf("expected exactly 1 LatestPrice entry, got %d", len(resp.Results))
	}
}

// TestBatchGetLatestPrice_FallbackWhenNotMultiSymbolSource — source implements only
// LatestTradeSource (not MultiSymbolSource); verify fallback to per-symbol GetLatestTrade.
func TestBatchGetLatestPrice_FallbackWhenNotMultiSymbolSource(t *testing.T) {
	ts := time.Date(2025, 1, 15, 15, 0, 0, 0, time.UTC)
	tradeOnly := &fakeLatestTradeOnlySource{
		trades: map[string]*source.Trade{
			"AAPL": {Price: 186.00, TradeTime: ts},
			"GOOG": {Price: 175.25, TradeTime: ts},
		},
	}
	reg := source.NewRegistry()
	reg.Register("alpaca", tradeOnly)
	svc := &MarketDataService{registry: reg, warmSymbols: map[string]struct{}{}}

	resp, err := svc.BatchGetLatestPrice(context.Background(), &marketdatav1.BatchGetLatestPriceRequest{
		Symbols: []string{"AAPL", "GOOG"},
	})
	if err != nil {
		t.Fatalf("BatchGetLatestPrice: %v", err)
	}
	bySym := map[string]*marketdatav1.LatestPrice{}
	for _, lp := range resp.Results {
		bySym[lp.Symbol] = lp
	}
	if len(bySym) != 2 {
		t.Fatalf("expected 2 results from per-symbol fallback, got %d", len(bySym))
	}
	aaplLP := bySym["AAPL"]
	if aaplLP.LastPrice == nil || *aaplLP.LastPrice != 186.00 {
		t.Errorf("AAPL: want LastPrice=186.00, got %v", aaplLP.LastPrice)
	}
	googLP := bySym["GOOG"]
	if googLP.LastPrice == nil || *googLP.LastPrice != 175.25 {
		t.Errorf("GOOG: want LastPrice=175.25, got %v", googLP.LastPrice)
	}
}

// --- feature 198: historical point-in-time fundamentals ---

type fakeHistRepo struct {
	queryRows []source.HistoricalFundamentalsPeriod
	inserted  []source.HistoricalFundamentalsPeriod
	closeAt   *float64
	nextToken string // token the stub returns (pagination pass-through assertion)
	// captured from the last QueryHistoricalFundamentals call (page-param pass-through assertion)
	gotPageSize  int
	gotPageToken string
	dividends    []source.CashDividend                // in-memory dividend store (feature 211)
	latest       *source.HistoricalFundamentalsPeriod // returned by LatestHistoricalFundamental (feature 211 snapshot dispatch)
}

func (r *fakeHistRepo) InsertHistoricalFundamentals(_ context.Context, p source.HistoricalFundamentalsPeriod) error {
	r.inserted = append(r.inserted, p)
	return nil
}

// QueryHistoricalFundamentals returns the preset rows UNFILTERED — the service's own filterAsOf is
// the no-look-ahead guard under test (AC-3), so the stub must not pre-filter. It records the page
// args so a test can assert the handler's extraction/defaulting, and echoes a preset nextToken.
func (r *fakeHistRepo) QueryHistoricalFundamentals(_ context.Context, _ string, _, _, _ time.Time, _ []string, pageSize int, pageToken string) ([]source.HistoricalFundamentalsPeriod, string, error) {
	r.gotPageSize = pageSize
	r.gotPageToken = pageToken
	return r.queryRows, r.nextToken, nil
}

func (r *fakeHistRepo) CloseAt(_ context.Context, _ string, _ time.Time) (*float64, error) {
	return r.closeAt, nil
}

func (r *fakeHistRepo) UpsertDividends(_ context.Context, divs []source.CashDividend) error {
	r.dividends = append(r.dividends, divs...)
	return nil
}

// SumDividendsInWindow replicates the repo SQL semantics (ex_date <= asOf AND ex_date >= windowStart)
// so the service's no-look-ahead + window logic is exercised without a DB.
func (r *fakeHistRepo) SumDividendsInWindow(_ context.Context, symbol string, asOf, windowStart time.Time) (float64, bool, error) {
	var sum float64
	var any bool
	for _, d := range r.dividends {
		if d.Symbol != symbol {
			continue
		}
		any = true
		if !d.ExDate.After(asOf) && !d.ExDate.Before(windowStart) {
			sum += d.CashAmount
		}
	}
	return sum, any, nil
}

func (r *fakeHistRepo) LatestHistoricalFundamental(_ context.Context, _ string, _ time.Time) (*source.HistoricalFundamentalsPeriod, error) {
	return r.latest, nil
}

func (r *fakeHistRepo) GetHistoricalPriceState(_ context.Context, _, _, _ string) (*source.HistoricalPriceState, error) {
	return &source.HistoricalPriceState{Found: false}, nil
}

func (r *fakeHistRepo) UpdateHistoricalPriceJoin(_ context.Context, _, _, _ string, _, _, _, _, _ *float64) error {
	return nil
}

type fakeHistSource struct {
	periods []source.HistoricalFundamentalsPeriod
	err     error
}

func (s *fakeHistSource) FetchHistorical(_ context.Context, symbol string, _, _ time.Time, _ []string) ([]source.HistoricalFundamentalsPeriod, error) {
	if s.err != nil {
		return nil, s.err
	}
	out := make([]source.HistoricalFundamentalsPeriod, len(s.periods))
	copy(out, s.periods)
	for i := range out {
		out[i].Symbol = symbol
	}
	return out, nil
}

type fakeEnricher struct{ calls int }

func (e *fakeEnricher) Enrich(_ context.Context, p *source.HistoricalFundamentalsPeriod) error {
	e.calls++
	v := 3.5
	p.PBRatio = &v // an FMP-only ratio EDGAR cannot supply
	return nil
}

func hfDate(y int, m time.Month, d int) time.Time { return time.Date(y, m, d, 0, 0, 0, 0, time.UTC) }

// AC-3: the as-of read hides a filing until the trading day AFTER it was filed (T+1 = filed_date < as_of).
func TestGetHistoricalFundamentals_TPlus1_AC3(t *testing.T) {
	filed := hfDate(2020, 1, 29)
	row := source.HistoricalFundamentalsPeriod{
		Symbol: "AAPL", FiscalPeriod: "Q1-2020", PeriodType: "quarterly",
		PeriodEnd: hfDate(2019, 12, 28), FiledDate: filed, Source: "edgar",
	}
	svc := &MarketDataService{histRepo: &fakeHistRepo{queryRows: []source.HistoricalFundamentalsPeriod{row}}}

	call := func(asOf time.Time) int {
		resp, err := svc.GetHistoricalFundamentals(context.Background(), &marketdatav1.GetHistoricalFundamentalsRequest{
			Symbol: "AAPL", AsOfDate: timestamppb.New(asOf),
		})
		if err != nil {
			t.Fatalf("GetHistoricalFundamentals(as-of %s): %v", asOf.Format("2006-01-02"), err)
		}
		return len(resp.GetPeriods())
	}

	if n := call(hfDate(2020, 1, 15)); n != 0 {
		t.Errorf("as-of 2020-01-15: got %d periods, want 0 (before filing)", n)
	}
	if n := call(hfDate(2020, 1, 29)); n != 0 {
		t.Errorf("as-of 2020-01-29 (== filed_date): got %d periods, want 0 (T+1 is strict <)", n)
	}
	resp, err := svc.GetHistoricalFundamentals(context.Background(), &marketdatav1.GetHistoricalFundamentalsRequest{
		Symbol: "AAPL", AsOfDate: timestamppb.New(hfDate(2020, 1, 30)),
	})
	if err != nil {
		t.Fatalf("as-of 2020-01-30: %v", err)
	}
	if len(resp.GetPeriods()) != 1 {
		t.Fatalf("as-of 2020-01-30: got %d periods, want 1", len(resp.GetPeriods()))
	}
	if got := resp.GetPeriods()[0].GetFiledDate().AsTime().Format("2006-01-02"); got != "2020-01-29" {
		t.Errorf("returned filed_date = %s, want 2020-01-29", got)
	}
}

// Step 3 pass-through: the handler extracts page_size/page_token from req.Page (defaulting page_size
// to 50 when Page is nil or page_size is 0) and surfaces the repo's nextToken in Pagination. Feature 204.
func TestGetHistoricalFundamentals_PagePassThrough(t *testing.T) {
	row := source.HistoricalFundamentalsPeriod{
		Symbol: "AAPL", FiscalPeriod: "Q1-2020", PeriodType: "quarterly",
		PeriodEnd: hfDate(2019, 12, 28), FiledDate: hfDate(2020, 1, 29), Source: "edgar",
	}

	// Explicit page: args forwarded verbatim, returned token surfaced in Pagination.
	repo := &fakeHistRepo{queryRows: []source.HistoricalFundamentalsPeriod{row}, nextToken: "2019-12-28T00:00:00Z|Q1-2020"}
	svc := &MarketDataService{histRepo: repo}
	resp, err := svc.GetHistoricalFundamentals(context.Background(), &marketdatav1.GetHistoricalFundamentalsRequest{
		Symbol: "AAPL", Page: &commonv1.PageRequest{PageSize: 10, PageToken: "cursor-in"},
	})
	if err != nil {
		t.Fatalf("GetHistoricalFundamentals: %v", err)
	}
	if repo.gotPageSize != 10 || repo.gotPageToken != "cursor-in" {
		t.Errorf("repo received pageSize=%d pageToken=%q, want 10/\"cursor-in\"", repo.gotPageSize, repo.gotPageToken)
	}
	if got := resp.GetPagination().GetNextPageToken(); got != "2019-12-28T00:00:00Z|Q1-2020" {
		t.Errorf("Pagination.NextPageToken = %q, want the repo token", got)
	}

	// No Page → default page size 50, empty token.
	repo2 := &fakeHistRepo{queryRows: []source.HistoricalFundamentalsPeriod{row}}
	svc2 := &MarketDataService{histRepo: repo2}
	if _, err := svc2.GetHistoricalFundamentals(context.Background(), &marketdatav1.GetHistoricalFundamentalsRequest{Symbol: "AAPL"}); err != nil {
		t.Fatalf("GetHistoricalFundamentals (no page): %v", err)
	}
	if repo2.gotPageSize != 50 || repo2.gotPageToken != "" {
		t.Errorf("default page: repo received pageSize=%d pageToken=%q, want 50/\"\"", repo2.gotPageSize, repo2.gotPageToken)
	}
}

// AC-5: at the FMP daily cap, ratio enrichment is skipped but the EDGAR statement row still persists
// (source "edgar", FMP-only ratio null) — degraded, not failed.
func TestBackfillFundamentals_CapDegrade_AC5(t *testing.T) {
	base := source.HistoricalFundamentalsPeriod{
		FiscalPeriod: "Q1-2020", PeriodType: "quarterly",
		PeriodEnd: hfDate(2019, 12, 28), FiledDate: hfDate(2020, 1, 29),
		Source: "edgar", ExtraMetrics: map[string]float64{},
	}
	// cap = 0 → enrichmentUnderCap() is always false (at cap from the first period).
	atCapCfg := &fakeCfg{
		bools: map[string]bool{
			"marketdata.fundamentals.history.enabled":                  true,
			"marketdata.fundamentals.history.ratio_enrichment.enabled": true,
		},
		ints: map[string]int64{"marketdata.fmp.daily_request_cap": 0},
	}
	repo := &fakeHistRepo{}
	enr := &fakeEnricher{}
	svc := &MarketDataService{
		histFundamentals: &fakeHistSource{periods: []source.HistoricalFundamentalsPeriod{base}},
		histRepo:         repo, ratioEnricher: enr, fundCfg: atCapCfg,
	}
	resp, err := svc.BackfillFundamentals(context.Background(), &marketdatav1.BackfillFundamentalsRequest{Symbols: []string{"AAPL"}})
	if err != nil {
		t.Fatalf("BackfillFundamentals: %v", err)
	}
	if resp.GetPeriodsWritten() != 1 {
		t.Fatalf("periods_written = %d, want 1 (edgar row persisted despite cap)", resp.GetPeriodsWritten())
	}
	if enr.calls != 0 {
		t.Errorf("enricher called %d times, want 0 (cap reached → enrichment skipped)", enr.calls)
	}
	if len(repo.inserted) != 1 || repo.inserted[0].Source != "edgar" {
		t.Fatalf("inserted source = %v, want one row source=edgar", repo.inserted)
	}
	if repo.inserted[0].PBRatio != nil {
		t.Errorf("pb_ratio = %v, want nil (FMP-only field, enrichment skipped)", *repo.inserted[0].PBRatio)
	}

	// Under cap → enrichment runs and tags the row edgar+fmp.
	underCapCfg := &fakeCfg{
		bools: atCapCfg.bools,
		ints:  map[string]int64{"marketdata.fmp.daily_request_cap": 250},
	}
	repo2 := &fakeHistRepo{}
	enr2 := &fakeEnricher{}
	svc2 := &MarketDataService{
		histFundamentals: &fakeHistSource{periods: []source.HistoricalFundamentalsPeriod{base}},
		histRepo:         repo2, ratioEnricher: enr2, fundCfg: underCapCfg,
	}
	if _, err := svc2.BackfillFundamentals(context.Background(), &marketdatav1.BackfillFundamentalsRequest{Symbols: []string{"AAPL"}}); err != nil {
		t.Fatalf("BackfillFundamentals (under cap): %v", err)
	}
	if enr2.calls != 1 {
		t.Errorf("enricher called %d times, want 1 (under cap)", enr2.calls)
	}
	if len(repo2.inserted) != 1 || repo2.inserted[0].Source != "edgar+fmp" {
		t.Errorf("inserted source = %v, want edgar+fmp", repo2.inserted)
	}
}

// --- feature 211: currency-consistent PIT P/B + P/E, no look-ahead (@AC-4) ---

type fakeHistRepo211 struct {
	closeVal   *float64
	queriedFor []time.Time
}

func (r *fakeHistRepo211) InsertHistoricalFundamentals(_ context.Context, _ source.HistoricalFundamentalsPeriod) error {
	return nil
}
func (r *fakeHistRepo211) QueryHistoricalFundamentals(_ context.Context, _ string, _, _, _ time.Time, _ []string, _ int, _ string) ([]source.HistoricalFundamentalsPeriod, string, error) {
	return nil, "", nil
}
func (r *fakeHistRepo211) CloseAt(_ context.Context, _ string, date time.Time) (*float64, error) {
	r.queriedFor = append(r.queriedFor, date)
	return r.closeVal, nil
}
func (r *fakeHistRepo211) UpsertDividends(_ context.Context, _ []source.CashDividend) error {
	return nil
}
func (r *fakeHistRepo211) SumDividendsInWindow(_ context.Context, _ string, _, _ time.Time) (float64, bool, error) {
	return 0, false, nil
}
func (r *fakeHistRepo211) LatestHistoricalFundamental(_ context.Context, _ string, _ time.Time) (*source.HistoricalFundamentalsPeriod, error) {
	return nil, nil
}

func (r *fakeHistRepo211) GetHistoricalPriceState(_ context.Context, _, _, _ string) (*source.HistoricalPriceState, error) {
	return &source.HistoricalPriceState{Found: false}, nil
}

func (r *fakeHistRepo211) UpdateHistoricalPriceJoin(_ context.Context, _, _, _ string, _, _, _, _, _ *float64) error {
	return nil
}

type fakeDividendSrc struct {
	divs []source.CashDividend
	err  error
}

func (s *fakeDividendSrc) GetCashDividends(_ context.Context, _ string, _, _ time.Time) ([]source.CashDividend, error) {
	return s.divs, s.err
}

func TestPriceJoin_PBRatioUSDEquity_NoLookAhead_AC4_feature211(t *testing.T) {
	repo := &fakeHistRepo211{closeVal: f64p(80.0)}
	svc := &MarketDataService{histRepo: repo}
	filed := time.Date(2025, 6, 26, 0, 0, 0, 0, time.UTC)
	p := &source.HistoricalFundamentalsPeriod{
		Symbol: "BABA", PeriodType: "annual", Currency: "CNY", FiledDate: filed,
		SharesOutstanding: f64p(2_400_000_000),
		ExtraMetrics:      map[string]float64{"stockholders_equity": 1_060_886e6, "stockholders_equity_usd": 153_796e6},
	}
	var q []float64
	svc.priceJoin(context.Background(), p, &q)
	if p.PBRatio == nil {
		t.Fatalf("pb_ratio nil, want set from USD equity")
	}
	wantPB := (80.0 * 2_400_000_000) / 153_796e6 // USD market_cap / USD equity
	if got := *p.PBRatio; got < wantPB*0.999 || got > wantPB*1.001 {
		t.Errorf("pb_ratio = %v, want ~%v (single-currency USD)", got, wantPB)
	}
	if len(repo.queriedFor) != 1 || !repo.queriedFor[0].Equal(filed) {
		t.Errorf("CloseAt queried %v, want only filed_date %v (no look-ahead)", repo.queriedFor, filed)
	}
}

func TestPriceJoin_PBNilWhenNoUSDEquity_feature211(t *testing.T) {
	repo := &fakeHistRepo211{closeVal: f64p(80.0)}
	svc := &MarketDataService{histRepo: repo}
	p := &source.HistoricalFundamentalsPeriod{
		Symbol: "BABA", PeriodType: "annual", Currency: "CNY", FiledDate: time.Now(),
		SharesOutstanding: f64p(2_400_000_000),
		ExtraMetrics:      map[string]float64{"stockholders_equity": 1_060_886e6}, // native CNY only, no USD fact
	}
	var q []float64
	svc.priceJoin(context.Background(), p, &q)
	if p.PBRatio != nil {
		t.Errorf("pb_ratio = %v, want nil (non-USD filer, no USD equity → no FX)", *p.PBRatio)
	}
}

func TestPriceJoin_PECurrencyRule_feature211(t *testing.T) {
	// USD filer: USD close / USD native EPS → P/E set.
	repoU := &fakeHistRepo211{closeVal: f64p(100.0)}
	svcU := &MarketDataService{histRepo: repoU}
	pu := &source.HistoricalFundamentalsPeriod{Symbol: "AAPL", PeriodType: "annual", Currency: "USD", FiledDate: time.Now(), EPS: f64p(5.0), ExtraMetrics: map[string]float64{}}
	var qu []float64
	svcU.priceJoin(context.Background(), pu, &qu)
	if pu.PERatio == nil || *pu.PERatio < 19.99 || *pu.PERatio > 20.01 {
		t.Errorf("USD P/E = %v, want ~20 (100/5)", pu.PERatio)
	}
	// Non-USD filer: no USD EPS fact → P/E nil (no cross-currency divide).
	repoC := &fakeHistRepo211{closeVal: f64p(100.0)}
	svcC := &MarketDataService{histRepo: repoC}
	pc := &source.HistoricalFundamentalsPeriod{Symbol: "BABA", PeriodType: "annual", Currency: "CNY", FiledDate: time.Now(), EPS: f64p(5.0), ExtraMetrics: map[string]float64{}}
	var qc []float64
	svcC.priceJoin(context.Background(), pc, &qc)
	if pc.PERatio != nil {
		t.Errorf("non-USD P/E = %v, want nil (no USD eps)", *pc.PERatio)
	}
}

// --- feature 211: PIT T12M dividend yield (@AC-5) + 0-vs-missing + feed-fallback ---

func dividendYieldSvc(divSrc *fakeDividendSrc, dividendsEnabled bool) (*MarketDataService, *fakeHistRepo) {
	period := source.HistoricalFundamentalsPeriod{
		FiscalPeriod: "FY2024", PeriodType: "annual",
		PeriodEnd: hfDate(2025, 3, 31), FiledDate: hfDate(2025, 6, 26),
		SharesOutstanding: f64p(1_000_000), Source: "edgar", ExtraMetrics: map[string]float64{},
	}
	repo := &fakeHistRepo{closeAt: f64p(100.0)} // price-at-filing = 100
	cfg := &fakeCfg{
		bools: map[string]bool{
			"marketdata.fundamentals.history.enabled": true,
			"marketdata.dividends.enabled":            dividendsEnabled,
		},
		// 3yr lookback so divFetchStart (≈2023-09) precedes the T12M window start (2024-06-26)
		// — ensures the coverage guard does not fire for this test period.
		ints: map[string]int64{"marketdata.dividends.backfill_lookback_years": 3},
	}
	svc := &MarketDataService{
		histFundamentals: &fakeHistSource{periods: []source.HistoricalFundamentalsPeriod{period}},
		histRepo:         repo, dividendSrc: divSrc, fundCfg: cfg,
	}
	return svc, repo
}

// @AC-5: T12M yield sums only dividends with ex_date in [filed-365d, filed]; a post-filing payment
// is excluded (no look-ahead, FR-7).
func TestBackfillFundamentals_DividendYieldT12M_AC5_feature211(t *testing.T) {
	div := &fakeDividendSrc{divs: []source.CashDividend{
		{Symbol: "AAPL", ExDate: hfDate(2024, 8, 1), CashAmount: 0.5, Currency: "USD"},
		{Symbol: "AAPL", ExDate: hfDate(2025, 2, 1), CashAmount: 0.5, Currency: "USD"},
		{Symbol: "AAPL", ExDate: hfDate(2025, 8, 15), CashAmount: 0.5, Currency: "USD"}, // post-filing → excluded
	}}
	svc, repo := dividendYieldSvc(div, true)
	if _, err := svc.BackfillFundamentals(context.Background(), &marketdatav1.BackfillFundamentalsRequest{Symbols: []string{"AAPL"}}); err != nil {
		t.Fatalf("BackfillFundamentals: %v", err)
	}
	if len(repo.inserted) != 1 {
		t.Fatalf("inserted %d rows, want 1", len(repo.inserted))
	}
	got := repo.inserted[0].DividendYield
	if got == nil {
		t.Fatalf("dividend_yield nil, want 0.01")
	}
	if *got < 0.0099 || *got > 0.0101 {
		t.Errorf("dividend_yield = %v, want 0.01 ((0.5+0.5)/100; 2025-08-15 post-filing excluded)", *got)
	}
}

// A payer whose only dividend is out-of-window → yield 0 (feed had rows), never missing.
func TestBackfillFundamentals_DividendYieldZeroWhenNoneInWindow_feature211(t *testing.T) {
	div := &fakeDividendSrc{divs: []source.CashDividend{
		{Symbol: "AAPL", ExDate: hfDate(2025, 8, 15), CashAmount: 0.5, Currency: "USD"}, // only post-filing
	}}
	svc, repo := dividendYieldSvc(div, true)
	if _, err := svc.BackfillFundamentals(context.Background(), &marketdatav1.BackfillFundamentalsRequest{Symbols: []string{"AAPL"}}); err != nil {
		t.Fatalf("BackfillFundamentals: %v", err)
	}
	got := repo.inserted[0].DividendYield
	if got == nil || *got != 0 {
		t.Errorf("dividend_yield = %v, want 0 (feed had rows, none in window)", got)
	}
}

// Feed unavailable/unentitled (error) → yield missing (nil), never a fabricated 0 (fallback + audit).
func TestBackfillFundamentals_DividendYieldMissingWhenFeedUnavailable_feature211(t *testing.T) {
	div := &fakeDividendSrc{err: fmt.Errorf("alpaca corporate-actions 403: unentitled")}
	svc, repo := dividendYieldSvc(div, true)
	if _, err := svc.BackfillFundamentals(context.Background(), &marketdatav1.BackfillFundamentalsRequest{Symbols: []string{"AAPL"}}); err != nil {
		t.Fatalf("BackfillFundamentals: %v", err)
	}
	if repo.inserted[0].DividendYield != nil {
		t.Errorf("dividend_yield = %v, want nil (feed unavailable → missing, no fabricated 0)", *repo.inserted[0].DividendYield)
	}
}

// Dividends disabled → yield missing (nil), no feed call consequence.
func TestBackfillFundamentals_DividendYieldMissingWhenDisabled_feature211(t *testing.T) {
	div := &fakeDividendSrc{divs: []source.CashDividend{{Symbol: "AAPL", ExDate: hfDate(2025, 2, 1), CashAmount: 0.5}}}
	svc, repo := dividendYieldSvc(div, false) // dividends.enabled = false
	if _, err := svc.BackfillFundamentals(context.Background(), &marketdatav1.BackfillFundamentalsRequest{Symbols: []string{"AAPL"}}); err != nil {
		t.Fatalf("BackfillFundamentals: %v", err)
	}
	if repo.inserted[0].DividendYield != nil {
		t.Errorf("dividend_yield = %v, want nil (disabled)", *repo.inserted[0].DividendYield)
	}
}

// ── feature 211: EDGAR-canonical snapshot dispatch + disable-safety + parity (@AC-6, @AC-7) ──────

// edgarSnapshotSvc wires a service for the snapshot_source=edgar path: a fake fundamentals cache
// (fundRepo), a fake historical store returning `latest` (histRepo), a registry serving `quote` for
// the live-price join, and the vendor source for the @AC-7 fallback. cfg is supplied per test so the
// zero-value getters exercise the real defaults (edgar.enabled true-by-default trap, FR-8).
func edgarSnapshotSvc(latest *source.HistoricalFundamentalsPeriod, quote *marketdatav1.Quote, cfg *fakeCfg, vendorSrc source.FundamentalsSource, vendorProvider string) (*MarketDataService, *fakeFundRepo) {
	fundRepo := newFakeFundRepo()
	q := map[string]*marketdatav1.Quote{}
	if quote != nil {
		q[quote.Symbol] = quote
	}
	reg := source.NewRegistry()
	reg.Register("alpaca", &fakeMultiSource{quotes: q})
	svc := &MarketDataService{
		registry:     reg,
		warmSymbols:  map[string]struct{}{},
		fundRepo:     fundRepo,
		histRepo:     &fakeHistRepo{latest: latest},
		fundCfg:      cfg,
		fundamentals: vendorSrc,
		fundProvider: vendorProvider,
		notify:       &fakeNotify{},
	}
	return svc, fundRepo
}

func babaEdgarPeriod() *source.HistoricalFundamentalsPeriod {
	return &source.HistoricalFundamentalsPeriod{
		Symbol: "BABA", FiscalPeriod: "FY2026", PeriodType: "annual",
		PeriodEnd: hfDate(2026, 3, 31), FiledDate: hfDate(2026, 7, 1),
		DebtToEquity: f64p(0.053), PBRatio: f64p(2.1), MarketCap: f64p(200e9),
		Price: f64p(70), Currency: "USD", Source: "edgar",
		ExtraMetrics: map[string]float64{"total_debt": 8098e6, "stockholders_equity_usd": 153796e6},
	}
}

// @AC-6 + FR-8: with snapshot_source=edgar and BOTH vendors off, the snapshot is derived from the
// latest EDGAR period (same financial-debt D/E + P/B + currency as the stored period) overlaid with a
// LIVE price, Source=="edgar", and fundamentals are STILL served (no fallthrough to disabled/empty).
// edgar.enabled is deliberately unset here to prove the explicit true default (zero-value trap).
func TestGetFundamentals_EdgarSnapshot_AC6_FR8_feature211(t *testing.T) {
	cfg := &fakeCfg{
		strings: map[string]string{"marketdata.fundamentals.snapshot_source": "edgar"},
		bools:   map[string]bool{"marketdata.finnhub.enabled": false, "marketdata.fmp.enabled": false},
		ints:    map[string]int64{"marketdata.edgar.cache_ttl_hours": 24},
	}
	svc, _ := edgarSnapshotSvc(babaEdgarPeriod(), &marketdatav1.Quote{Symbol: "BABA", AskPrice: 101, BidPrice: 99}, cfg, nil, "finnhub")

	f, err := svc.GetFundamentals(context.Background(), "BABA")
	if err != nil {
		t.Fatalf("GetFundamentals(edgar): %v", err)
	}
	if f == nil {
		t.Fatal("edgar snapshot nil with both vendors off — FR-8 fallthrough regression")
	}
	if f.Source != "edgar" {
		t.Errorf("Source = %q, want \"edgar\"", f.Source)
	}
	if f.DebtToEquity < 0.0529 || f.DebtToEquity > 0.0531 {
		t.Errorf("debt_to_equity = %v, want ~0.053 (same financial-debt convention as stored period, @AC-6)", f.DebtToEquity)
	}
	if f.PbRatio < 2.099 || f.PbRatio > 2.101 {
		t.Errorf("pb_ratio = %v, want ~2.1 (stored, currency-consistent)", f.PbRatio)
	}
	if f.Currency != "USD" {
		t.Errorf("currency = %q, want USD", f.Currency)
	}
	if f.Price < 99.99 || f.Price > 100.01 {
		t.Errorf("price = %v, want ~100 (LIVE mid, not the stored 70)", f.Price)
	}
}

// C-10(b) parity: GetFundamentals and GetFundamentalsMulti return the identical snapshot for a symbol
// under snapshot_source=edgar (both dispatch the same builder).
func TestGetFundamentals_EdgarParity_C10b_feature211(t *testing.T) {
	cfg := &fakeCfg{
		strings: map[string]string{"marketdata.fundamentals.snapshot_source": "edgar"},
		bools:   map[string]bool{"marketdata.edgar.enabled": true},
	}
	svc, _ := edgarSnapshotSvc(babaEdgarPeriod(), &marketdatav1.Quote{Symbol: "BABA", AskPrice: 101, BidPrice: 99}, cfg, nil, "finnhub")

	single, err := svc.GetFundamentals(context.Background(), "BABA")
	if err != nil {
		t.Fatalf("single: %v", err)
	}
	multi, err := svc.GetFundamentalsMulti(context.Background(), []string{"BABA"})
	if err != nil {
		t.Fatalf("multi: %v", err)
	}
	if len(multi) != 1 {
		t.Fatalf("multi returned %d, want 1", len(multi))
	}
	m := multi[0]
	if m.Source != single.Source || m.DebtToEquity != single.DebtToEquity || m.PbRatio != single.PbRatio || m.Price != single.Price || m.Currency != single.Currency {
		t.Errorf("parity break: single=%+v multi=%+v", single, m)
	}
}

// @AC-7: a symbol with ZERO stored EDGAR periods under snapshot_source=edgar, with a vendor enabled,
// falls back to the vendor and the row is marked with the VENDOR name (not "edgar").
func TestGetFundamentals_EdgarFallbackToVendor_AC7_feature211(t *testing.T) {
	cfg := enabledCfg("finnhub") // seeds finnhub.enabled + quota/cache keys
	cfg.strings = map[string]string{"marketdata.fundamentals.snapshot_source": "edgar"}
	cfg.bools["marketdata.edgar.enabled"] = true
	cfg.bools["marketdata.fmp.enabled"] = false
	vendor := &fakeFundSource{resp: &source.Fundamentals{Price: f64p(50)}} // Source empty → toProto uses provider name
	svc, _ := edgarSnapshotSvc(nil, nil, cfg, vendor, "finnhub")

	f, err := svc.GetFundamentals(context.Background(), "NOSEC")
	if err != nil {
		t.Fatalf("GetFundamentals(fallback): %v", err)
	}
	if f == nil || f.Source != "finnhub" {
		t.Fatalf("Source = %v, want \"finnhub\" (vendor fallback, not edgar)", f)
	}
	if vendor.calls != 1 {
		t.Errorf("vendor fetch calls = %d, want 1 (fallback took the vendor)", vendor.calls)
	}
}

// Kill switch: edgar.enabled=false under snapshot_source=edgar → FailedPrecondition (deliberate all-off).
func TestGetFundamentals_EdgarKillSwitch_feature211(t *testing.T) {
	cfg := &fakeCfg{
		strings: map[string]string{"marketdata.fundamentals.snapshot_source": "edgar"},
		bools:   map[string]bool{"marketdata.edgar.enabled": false},
	}
	svc, _ := edgarSnapshotSvc(babaEdgarPeriod(), nil, cfg, nil, "finnhub")

	_, err := svc.GetFundamentals(context.Background(), "BABA")
	if err == nil {
		t.Fatal("edgar.enabled=false must return an error")
	}
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Errorf("code = %v, want FailedPrecondition", connect.CodeOf(err))
	}
}

// Source-aware cache self-heal: a fresh-but-VENDOR-sourced cache row is NOT served under edgar mode —
// the snapshot is re-derived from the EDGAR period (Source flips to edgar), so a cutover heals in one call.
func TestGetFundamentals_EdgarCacheSelfHeal_feature211(t *testing.T) {
	cfg := &fakeCfg{
		strings: map[string]string{"marketdata.fundamentals.snapshot_source": "edgar"},
		bools:   map[string]bool{"marketdata.edgar.enabled": true},
		ints:    map[string]int64{"marketdata.edgar.cache_ttl_hours": 24},
	}
	svc, fundRepo := edgarSnapshotSvc(babaEdgarPeriod(), &marketdatav1.Quote{Symbol: "BABA", AskPrice: 101, BidPrice: 99}, cfg, nil, "finnhub")
	// Pre-seed a FRESH vendor row — under string-inequality invalidation this would be served stale.
	fundRepo.rows["BABA"] = &source.Fundamentals{Symbol: "BABA", Source: "finnhub", DebtToEquity: f64p(9.9)}
	fundRepo.fetchedAt["BABA"] = time.Now()

	f, err := svc.GetFundamentals(context.Background(), "BABA")
	if err != nil {
		t.Fatalf("GetFundamentals: %v", err)
	}
	if f.Source != "edgar" || f.DebtToEquity < 0.0529 || f.DebtToEquity > 0.0531 {
		t.Errorf("got Source=%q d/e=%v, want edgar-derived ~0.053 (stale vendor row must not be served)", f.Source, f.DebtToEquity)
	}
	if got := fundRepo.rows["BABA"].Source; got != "edgar" {
		t.Errorf("cache row Source = %q after self-heal, want edgar", got)
	}
}

// ── feature 216: backfill recovery — @AC-1..@AC-5 + currency-mismatch open-risk ─────────────────

// fakeHistRepo216 is a stateful fake for the feature-216 recovery tests. It stores inserted and
// updated rows in a map keyed on "symbol|fiscal_period|period_type", and serves GetHistoricalPriceState
// from whatever state is already in the store. UpdateHistoricalPriceJoin records the merged values.
type fakeHistRepo216 struct {
	closeAt   *float64
	store     map[string]*source.HistoricalPriceState // keyed "sym|fp|pt"
	updates   []string                                // log of "sym|fp|pt" entries that were updated
	inserted  []source.HistoricalFundamentalsPeriod
	dividends []source.CashDividend
}

func newFakeHistRepo216(closeAt *float64) *fakeHistRepo216 {
	return &fakeHistRepo216{
		closeAt: closeAt,
		store:   map[string]*source.HistoricalPriceState{},
	}
}

func stateKey(sym, fp, pt string) string { return sym + "|" + fp + "|" + pt }

func (r *fakeHistRepo216) InsertHistoricalFundamentals(_ context.Context, p source.HistoricalFundamentalsPeriod) error {
	r.inserted = append(r.inserted, p)
	return nil
}
func (r *fakeHistRepo216) QueryHistoricalFundamentals(_ context.Context, _ string, _, _, _ time.Time, _ []string, _ int, _ string) ([]source.HistoricalFundamentalsPeriod, string, error) {
	return nil, "", nil
}
func (r *fakeHistRepo216) CloseAt(_ context.Context, _ string, _ time.Time) (*float64, error) {
	return r.closeAt, nil
}
func (r *fakeHistRepo216) UpsertDividends(_ context.Context, divs []source.CashDividend) error {
	r.dividends = append(r.dividends, divs...)
	return nil
}
func (r *fakeHistRepo216) SumDividendsInWindow(_ context.Context, symbol string, asOf, windowStart time.Time) (float64, bool, error) {
	var sum float64
	var any bool
	for _, d := range r.dividends {
		if d.Symbol != symbol {
			continue
		}
		any = true
		if !d.ExDate.After(asOf) && !d.ExDate.Before(windowStart) {
			sum += d.CashAmount
		}
	}
	return sum, any, nil
}
func (r *fakeHistRepo216) LatestHistoricalFundamental(_ context.Context, _ string, _ time.Time) (*source.HistoricalFundamentalsPeriod, error) {
	return nil, nil
}
func (r *fakeHistRepo216) GetHistoricalPriceState(_ context.Context, sym, fp, pt string) (*source.HistoricalPriceState, error) {
	if s, ok := r.store[stateKey(sym, fp, pt)]; ok {
		return s, nil
	}
	return &source.HistoricalPriceState{Found: false}, nil
}
func (r *fakeHistRepo216) UpdateHistoricalPriceJoin(_ context.Context, sym, fp, pt string, price, marketCap, peRatio, pbRatio, dividendYield *float64) error {
	k := stateKey(sym, fp, pt)
	r.updates = append(r.updates, k)
	// Reflect the update back into the store so a subsequent GetHistoricalPriceState is coherent.
	r.store[k] = &source.HistoricalPriceState{
		Found:         true,
		Price:         price,
		MarketCap:     marketCap,
		PERatio:       peRatio,
		PBRatio:       pbRatio,
		DividendYield: dividendYield,
	}
	return nil
}

func backfill216Cfg(enabled bool) *fakeCfg {
	return &fakeCfg{
		bools: map[string]bool{"marketdata.fundamentals.history.enabled": enabled},
		// 3yr lookback so the coverage guard never fires for recent test periods.
		ints: map[string]int64{"marketdata.dividends.backfill_lookback_years": 3},
	}
}

func onePeriod216(fp, periodType, currency string, filed time.Time, eps *float64) source.HistoricalFundamentalsPeriod {
	return source.HistoricalFundamentalsPeriod{
		FiscalPeriod: fp, PeriodType: periodType, Currency: currency,
		PeriodEnd: filed.AddDate(0, -3, 0), FiledDate: filed,
		EPS: eps, SharesOutstanding: f64p(1_000_000),
		Source: "edgar", ExtraMetrics: map[string]float64{},
	}
}

// @AC-1: an existing row whose price-join columns are all NULL is recovered by default backfill.
func TestBackfillFundamentals_AC1_RecoveryFillsNilColumns_feature216(t *testing.T) {
	filed := hfDate(2024, 3, 31)
	repo := newFakeHistRepo216(f64p(150.0))
	// Pre-seed an existing row with all 5 price columns NULL.
	repo.store[stateKey("AAPL", "FY2023", "annual")] = &source.HistoricalPriceState{
		Found: true, FiledDate: filed, Currency: "USD",
	}
	svc := &MarketDataService{
		histFundamentals: &fakeHistSource{periods: []source.HistoricalFundamentalsPeriod{onePeriod216("FY2023", "annual", "USD", filed, f64p(6.0))}},
		histRepo:         repo,
		fundCfg:          backfill216Cfg(true),
	}
	resp, err := svc.BackfillFundamentals(context.Background(), &marketdatav1.BackfillFundamentalsRequest{Symbols: []string{"AAPL"}})
	if err != nil {
		t.Fatalf("BackfillFundamentals: %v", err)
	}
	if resp.GetPeriodsWritten() != 1 {
		t.Errorf("periods_written = %d, want 1 (one existing row recovered)", resp.GetPeriodsWritten())
	}
	if len(repo.updates) != 1 {
		t.Fatalf("UpdateHistoricalPriceJoin called %d times, want 1", len(repo.updates))
	}
	updated := repo.store[stateKey("AAPL", "FY2023", "annual")]
	if updated.Price == nil || *updated.Price != 150.0 {
		t.Errorf("price = %v, want 150.0", updated.Price)
	}
	if updated.MarketCap == nil || *updated.MarketCap != 150_000_000.0 {
		t.Errorf("market_cap = %v, want 150_000_000", updated.MarketCap)
	}
}

// @AC-2: rows with all 5 price columns already set are skipped by a default (overwrite=false) run.
func TestBackfillFundamentals_AC2_DefaultSkipsFullyDerivedRow_feature216(t *testing.T) {
	filed := hfDate(2024, 3, 31)
	repo := newFakeHistRepo216(f64p(200.0)) // a different close — should NOT be used
	price := 150.0
	mc := 150_000_000.0
	pe := 25.0
	pb := 3.0
	dy := 0.01
	repo.store[stateKey("AAPL", "FY2023", "annual")] = &source.HistoricalPriceState{
		Found: true, FiledDate: filed, Currency: "USD",
		Price: &price, MarketCap: &mc, PERatio: &pe, PBRatio: &pb, DividendYield: &dy,
	}
	svc := &MarketDataService{
		histFundamentals: &fakeHistSource{periods: []source.HistoricalFundamentalsPeriod{onePeriod216("FY2023", "annual", "USD", filed, f64p(6.0))}},
		histRepo:         repo,
		fundCfg:          backfill216Cfg(true),
	}
	resp, err := svc.BackfillFundamentals(context.Background(), &marketdatav1.BackfillFundamentalsRequest{Symbols: []string{"AAPL"}})
	if err != nil {
		t.Fatalf("BackfillFundamentals: %v", err)
	}
	if resp.GetPeriodsWritten() != 0 {
		t.Errorf("periods_written = %d, want 0 (fully-derived row skipped)", resp.GetPeriodsWritten())
	}
	if len(repo.updates) != 0 {
		t.Errorf("UpdateHistoricalPriceJoin called %d times, want 0", len(repo.updates))
	}
}

// @AC-3: default fill-if-null path fills only nil columns, leaving non-nil columns untouched.
func TestBackfillFundamentals_AC3_DefaultFillIfNull_feature216(t *testing.T) {
	filed := hfDate(2024, 3, 31)
	repo := newFakeHistRepo216(f64p(160.0))
	existingPrice := 150.0
	// Row has price set but market_cap, pe, pb, dividend_yield all NULL.
	repo.store[stateKey("AAPL", "FY2023", "annual")] = &source.HistoricalPriceState{
		Found: true, FiledDate: filed, Currency: "USD",
		Price: &existingPrice, // already set; fill-if-null keeps it
	}
	svc := &MarketDataService{
		histFundamentals: &fakeHistSource{periods: []source.HistoricalFundamentalsPeriod{onePeriod216("FY2023", "annual", "USD", filed, f64p(6.0))}},
		histRepo:         repo,
		fundCfg:          backfill216Cfg(true),
	}
	if _, err := svc.BackfillFundamentals(context.Background(), &marketdatav1.BackfillFundamentalsRequest{Symbols: []string{"AAPL"}}); err != nil {
		t.Fatalf("BackfillFundamentals: %v", err)
	}
	updated := repo.store[stateKey("AAPL", "FY2023", "annual")]
	// fill-if-null: stored price (150) must win over derived (160)
	if updated.Price == nil || *updated.Price != 150.0 {
		t.Errorf("price = %v, want 150.0 (stored wins in fill-if-null)", updated.Price)
	}
	// nil columns should now be populated
	if updated.MarketCap == nil {
		t.Errorf("market_cap should be populated by fill-if-null, got nil")
	}
}

// @AC-4: overwrite=true re-derives and updates existing rows; a stable re-run is idempotent.
func TestBackfillFundamentals_AC4_OverwriteRefreshAndIdempotency_feature216(t *testing.T) {
	filed := hfDate(2024, 3, 31)
	repo := newFakeHistRepo216(f64p(160.0))
	oldPrice := 150.0
	oldMC := 150_000_000.0
	repo.store[stateKey("AAPL", "FY2023", "annual")] = &source.HistoricalPriceState{
		Found: true, FiledDate: filed, Currency: "USD",
		Price: &oldPrice, MarketCap: &oldMC,
	}
	svc := &MarketDataService{
		histFundamentals: &fakeHistSource{periods: []source.HistoricalFundamentalsPeriod{onePeriod216("FY2023", "annual", "USD", filed, f64p(6.0))}},
		histRepo:         repo,
		fundCfg:          backfill216Cfg(true),
	}
	// First run with overwrite=true — should update.
	if _, err := svc.BackfillFundamentals(context.Background(), &marketdatav1.BackfillFundamentalsRequest{
		Symbols: []string{"AAPL"}, Overwrite: true,
	}); err != nil {
		t.Fatalf("BackfillFundamentals (overwrite): %v", err)
	}
	if len(repo.updates) != 1 {
		t.Errorf("overwrite run: UpdateHistoricalPriceJoin called %d times, want 1", len(repo.updates))
	}
	updated := repo.store[stateKey("AAPL", "FY2023", "annual")]
	if updated.Price == nil || *updated.Price != 160.0 {
		t.Errorf("overwrite: price = %v, want 160.0 (derived wins)", updated.Price)
	}

	// Second run with overwrite=true on stable data — should be idempotent (no re-update needed since
	// values haven't changed).
	repo.updates = nil
	if _, err := svc.BackfillFundamentals(context.Background(), &marketdatav1.BackfillFundamentalsRequest{
		Symbols: []string{"AAPL"}, Overwrite: true,
	}); err != nil {
		t.Fatalf("BackfillFundamentals (stable re-run): %v", err)
	}
	if len(repo.updates) != 0 {
		t.Errorf("stable re-run: UpdateHistoricalPriceJoin called %d times, want 0 (idempotent)", len(repo.updates))
	}
}

// @AC-5: overwrite=true never nulls a pre-existing non-nil dividend_yield when derive produces nil.
func TestBackfillFundamentals_AC5_OverwriteNeverNullsDividendYield_feature216(t *testing.T) {
	filed := hfDate(2024, 3, 31)
	repo := newFakeHistRepo216(f64p(150.0))
	existingDY := 0.015
	repo.store[stateKey("AAPL", "FY2023", "annual")] = &source.HistoricalPriceState{
		Found: true, FiledDate: filed, Currency: "USD",
		DividendYield: &existingDY,
	}
	// dividendSrc is nil → dividendsFetched=false → deriveDividendYield is a no-op → p.DividendYield=nil
	svc := &MarketDataService{
		histFundamentals: &fakeHistSource{periods: []source.HistoricalFundamentalsPeriod{onePeriod216("FY2023", "annual", "USD", filed, nil)}},
		histRepo:         repo,
		fundCfg:          backfill216Cfg(true),
	}
	if _, err := svc.BackfillFundamentals(context.Background(), &marketdatav1.BackfillFundamentalsRequest{
		Symbols: []string{"AAPL"}, Overwrite: true,
	}); err != nil {
		t.Fatalf("BackfillFundamentals: %v", err)
	}
	updated := repo.store[stateKey("AAPL", "FY2023", "annual")]
	if updated == nil || updated.DividendYield == nil || *updated.DividendYield != existingDY {
		t.Errorf("overwrite: dividend_yield = %v, want %v (value→nil must be suppressed)", updated.DividendYield, existingDY)
	}
}

// Open risk (feature 216 design.md): currency mismatch between stored row (CNY) and re-fetch (CNY)
// leaves pe_ratio and pb_ratio nil — fail-closed, not fabricated.
func TestBackfillFundamentals_CurrencyMismatchPEPBFailClosed_feature216(t *testing.T) {
	filed := hfDate(2024, 3, 31)
	repo := newFakeHistRepo216(f64p(80.0))
	repo.store[stateKey("BABA", "FY2023", "annual")] = &source.HistoricalPriceState{
		Found: true, FiledDate: filed, Currency: "CNY", // non-USD stored currency
	}
	svc := &MarketDataService{
		histFundamentals: &fakeHistSource{periods: []source.HistoricalFundamentalsPeriod{onePeriod216("FY2023", "annual", "CNY", filed, f64p(10.0))}},
		histRepo:         repo,
		fundCfg:          backfill216Cfg(true),
	}
	if _, err := svc.BackfillFundamentals(context.Background(), &marketdatav1.BackfillFundamentalsRequest{
		Symbols: []string{"BABA"}, Overwrite: true,
	}); err != nil {
		t.Fatalf("BackfillFundamentals: %v", err)
	}
	updated := repo.store[stateKey("BABA", "FY2023", "annual")]
	if updated != nil && updated.PERatio != nil {
		t.Errorf("pe_ratio = %v for non-USD row, want nil (currency-mismatch fail-closed)", *updated.PERatio)
	}
	if updated != nil && updated.PBRatio != nil {
		t.Errorf("pb_ratio = %v for non-USD row, want nil (currency-mismatch fail-closed)", *updated.PBRatio)
	}
	// Price should still be derived (currency check applies only to pe/pb).
	if updated == nil || updated.Price == nil {
		t.Errorf("price should be derived regardless of currency, got nil")
	}
}
