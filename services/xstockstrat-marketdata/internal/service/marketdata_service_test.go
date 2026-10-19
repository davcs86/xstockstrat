package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math"
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
	"github.com/xstockstrat/marketdata/internal/testdata"
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
	mu        sync.Mutex
	calls     int
	quotes    map[string]*marketdatav1.Quote
	started   chan struct{}
	release   chan struct{}
	requested [][]string // feature 229: symbols per upstream fetch
	err       error      // feature 229: returned after the release/ctx wait
	honourCtx bool       // feature 229: the wait also ends on ctx.Done (nil release + honourCtx = block until ctx)
}

func (f *fakeMultiSource) GetLatestQuotesMulti(ctx context.Context, symbols []string) (map[string]*marketdatav1.Quote, error) {
	f.mu.Lock()
	f.calls++
	f.requested = append(f.requested, append([]string(nil), symbols...))
	f.mu.Unlock()
	if f.started != nil {
		close(f.started) // single-flight runs the fn once (leader), so this closes exactly once
	}
	switch {
	case f.honourCtx:
		select {
		case <-f.release:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	case f.release != nil:
		<-f.release
	}
	if f.err != nil {
		return nil, f.err
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
	trades     map[string]*source.Trade
	multiErr   error           // returned with a nil map instead of trades
	multiBlock bool            // multi-fetch blocks until ctx is done
	multiGate  <-chan struct{} // multi-fetch blocks until closed (or ctx is done)
	perSymbol  func(ctx context.Context, symbol string) (float64, time.Time, error)
}

func (f *fakeBatchPriceSource) GetLatestTradesMulti(ctx context.Context, symbols []string) (map[string]*source.Trade, error) {
	if f.multiGate != nil {
		select {
		case <-f.multiGate:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	if f.multiBlock {
		<-ctx.Done()
		return nil, ctx.Err()
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if f.multiErr != nil {
		return nil, f.multiErr
	}
	out := make(map[string]*source.Trade, len(symbols))
	for _, s := range symbols {
		if t, ok := f.trades[s]; ok {
			out[s] = t
		}
	}
	return out, nil
}
func (f *fakeBatchPriceSource) GetLatestTrade(ctx context.Context, symbol string) (float64, time.Time, error) {
	if f.perSymbol != nil {
		return f.perSymbol(ctx, symbol)
	}
	if err := ctx.Err(); err != nil {
		return 0, time.Time{}, err
	}
	if t, ok := f.trades[symbol]; ok {
		return t.Price, t.TradeTime, nil
	}
	return 0, time.Time{}, fmt.Errorf("no trade for %s", symbol)
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

// ── feature 227: BatchGetLatestPrice detached budget + dropped-error logs ────────

// recordingWarnHandler keeps WARN records. slog.SetDefault is process-global, so tests using it
// must not call t.Parallel().
type recordingWarnHandler struct {
	mu   sync.Mutex
	recs []recordedWarn
}

type recordedWarn struct {
	msg   string
	attrs map[string]string
}

func (h *recordingWarnHandler) Enabled(context.Context, slog.Level) bool { return true }
func (h *recordingWarnHandler) Handle(_ context.Context, r slog.Record) error {
	if r.Level != slog.LevelWarn {
		return nil
	}
	rec := recordedWarn{msg: r.Message, attrs: map[string]string{}}
	r.Attrs(func(a slog.Attr) bool {
		rec.attrs[a.Key] = fmt.Sprint(a.Value.Resolve().Any())
		return true
	})
	h.mu.Lock()
	h.recs = append(h.recs, rec)
	h.mu.Unlock()
	return nil
}
func (h *recordingWarnHandler) WithAttrs([]slog.Attr) slog.Handler { return h }
func (h *recordingWarnHandler) WithGroup(string) slog.Handler      { return h }

func (h *recordingWarnHandler) find(msg string) *recordedWarn {
	h.mu.Lock()
	defer h.mu.Unlock()
	for i := range h.recs {
		if h.recs[i].msg == msg {
			r := h.recs[i]
			return &r
		}
	}
	return nil
}

func installWarnRecorder(t *testing.T) *recordingWarnHandler {
	t.Helper()
	h := &recordingWarnHandler{}
	prev := slog.Default()
	slog.SetDefault(slog.New(h))
	t.Cleanup(func() { slog.SetDefault(prev) })
	return h
}

type fakeIntGetter map[string]int64

func (f fakeIntGetter) GetInt(key string, defaultVal int64) int64 {
	if v, ok := f[key]; ok {
		return v
	}
	return defaultVal
}

type fakePrevCloseReader struct {
	closes  map[string]float64
	err     error
	once    sync.Once
	entered chan struct{} // closed on first call, when non-nil
}

func (f *fakePrevCloseReader) GetPreviousDailyCloseBatch(context.Context, []string) (map[string]float64, error) {
	if f.entered != nil {
		f.once.Do(func() { close(f.entered) })
	}
	return f.closes, f.err
}

func budgetCfgMs(ms int64) fakeIntGetter {
	return fakeIntGetter{"marketdata.price.batch_timeout_ms": ms}
}

// callBatchPriceGuarded fails the test instead of hanging when BatchGetLatestPrice never returns.
func callBatchPriceGuarded(t *testing.T, svc *MarketDataService, ctx context.Context, symbols []string) (map[string]*marketdatav1.LatestPrice, time.Duration) {
	t.Helper()
	type result struct {
		resp *marketdatav1.BatchGetLatestPriceResponse
		err  error
	}
	ch := make(chan result, 1)
	start := time.Now()
	go func() {
		resp, err := svc.BatchGetLatestPrice(ctx, &marketdatav1.BatchGetLatestPriceRequest{Symbols: symbols})
		ch <- result{resp, err}
	}()
	select {
	case r := <-ch:
		elapsed := time.Since(start)
		if r.err != nil {
			t.Fatalf("BatchGetLatestPrice: %v", r.err)
		}
		bySym := map[string]*marketdatav1.LatestPrice{}
		for _, lp := range r.resp.Results {
			bySym[lp.Symbol] = lp
		}
		return bySym, elapsed
	case <-time.After(5 * time.Second):
		t.Fatal("BatchGetLatestPrice did not return within the 5s hang guard")
		return nil, 0
	}
}

func newBatchPriceSvc(src source.DataSourceClient) *MarketDataService {
	reg := source.NewRegistry()
	if src != nil {
		reg.Register("alpaca", src)
	}
	return &MarketDataService{registry: reg, warmSymbols: map[string]struct{}{}}
}

// TestBatchGetLatestPrice_AC3_LogsMultiFetchErrorAndFallsBack — @AC-3: the vendor error behind the
// per-symbol fallback is logged, and the fallback result is still served.
func TestBatchGetLatestPrice_AC3_LogsMultiFetchErrorAndFallsBack(t *testing.T) {
	rec := installWarnRecorder(t)
	svc := newBatchPriceSvc(&fakeBatchPriceSource{
		trades:   map[string]*source.Trade{"AAPL": {Price: 187.25, TradeTime: time.Now()}},
		multiErr: errors.New("alpaca: 503 service unavailable"),
	})

	bySym, _ := callBatchPriceGuarded(t, svc, context.Background(), []string{"AAPL"})

	r := rec.find("BatchGetLatestPrice: multi-symbol fetch failed; falling back to per-symbol")
	if r == nil {
		t.Fatalf("expected the multi-symbol fetch failure WARN, got %+v", rec.recs)
	}
	if r.attrs["symbols"] != "1" {
		t.Errorf("symbols attr = %q, want 1", r.attrs["symbols"])
	}
	if !strings.Contains(r.attrs["error"], "503") {
		t.Errorf("error attr = %q, want the vendor error", r.attrs["error"])
	}
	if lp := bySym["AAPL"]; lp == nil || lp.LastPrice == nil || *lp.LastPrice != 187.25 {
		t.Fatalf("expected the per-symbol fallback price for AAPL, got %v", lp)
	}
}

// TestBatchGetLatestPrice_StalledMultiFetchHonoursBudget — a multi-fetch that never answers is cut
// off by the budget; the symbol is omitted and the skipped fallback is logged.
func TestBatchGetLatestPrice_StalledMultiFetchHonoursBudget(t *testing.T) {
	rec := installWarnRecorder(t)
	svc := newBatchPriceSvc(&fakeBatchPriceSource{multiBlock: true})
	svc.budgetCfg = budgetCfgMs(50)

	bySym, elapsed := callBatchPriceGuarded(t, svc, context.Background(), []string{"AAPL"})

	if elapsed >= time.Second {
		t.Fatalf("returned after %v, want < 1s under a 50ms budget", elapsed)
	}
	if _, ok := bySym["AAPL"]; ok {
		t.Fatal("AAPL must be omitted when the budget expires (omit-not-fabricate)")
	}
	r := rec.find("BatchGetLatestPrice: budget exhausted by multi-symbol fetch; per-symbol fallback skipped")
	if r == nil {
		t.Fatalf("expected the budget-exhausted WARN, got %+v", rec.recs)
	}
	if r.attrs["budget_ms"] != "50" {
		t.Errorf("budget_ms attr = %q, want 50", r.attrs["budget_ms"])
	}
}

// TestBatchGetLatestPrice_FallbackIncompleteRecord — per-symbol failures plus a mid-loop budget
// expiry produce one aggregate record with the failed/fetched/skipped counts.
func TestBatchGetLatestPrice_FallbackIncompleteRecord(t *testing.T) {
	rec := installWarnRecorder(t)
	ts := time.Now()
	svc := newBatchPriceSvc(&fakeBatchPriceSource{
		multiErr: errors.New("multi down"),
		perSymbol: func(ctx context.Context, sym string) (float64, time.Time, error) {
			switch sym {
			case "AAA":
				return 0, time.Time{}, errors.New("boom")
			case "BBB":
				return 101, ts, nil
			case "CCC":
				select {
				case <-ctx.Done():
					return 0, time.Time{}, ctx.Err()
				case <-time.After(3 * time.Second):
					return 0, time.Time{}, errors.New("stalled")
				}
			default:
				return 102, ts, nil
			}
		},
	})
	svc.budgetCfg = budgetCfgMs(100)

	bySym, _ := callBatchPriceGuarded(t, svc, context.Background(), []string{"AAA", "BBB", "CCC", "DDD"})

	if _, ok := bySym["BBB"]; !ok {
		t.Error("BBB was fetched before the budget expired and must be served")
	}
	if _, ok := bySym["DDD"]; ok {
		t.Error("DDD comes after the budget expiry and must be skipped")
	}
	r := rec.find("BatchGetLatestPrice: per-symbol fallback incomplete")
	if r == nil {
		t.Fatalf("expected the per-symbol fallback incomplete WARN, got %+v", rec.recs)
	}
	want := map[string]string{"failed": "2", "fetched": "1", "skipped": "1", "total": "4", "sample_error": "boom"}
	for k, v := range want {
		if r.attrs[k] != v {
			t.Errorf("%s attr = %q, want %q", k, r.attrs[k], v)
		}
	}
}

// TestBatchGetLatestPrice_LogsSourceLookupFailure — an unresolvable source is logged, not dropped.
func TestBatchGetLatestPrice_LogsSourceLookupFailure(t *testing.T) {
	rec := installWarnRecorder(t)
	svc := newBatchPriceSvc(nil)

	bySym, _ := callBatchPriceGuarded(t, svc, context.Background(), []string{"AAPL"})

	if len(bySym) != 0 {
		t.Fatalf("expected no results without a source, got %d", len(bySym))
	}
	r := rec.find("BatchGetLatestPrice: source lookup failed")
	if r == nil {
		t.Fatalf("expected the source lookup WARN, got %+v", rec.recs)
	}
	if r.attrs["symbols"] != "1" {
		t.Errorf("symbols attr = %q, want 1", r.attrs["symbols"])
	}
}

// TestBatchGetLatestPrice_LogsPrevCloseFailure — a failed previous-close read is logged and the
// trade is still served.
func TestBatchGetLatestPrice_LogsPrevCloseFailure(t *testing.T) {
	rec := installWarnRecorder(t)
	svc := newBatchPriceSvc(&fakeBatchPriceSource{
		trades: map[string]*source.Trade{"AAPL": {Price: 190, TradeTime: time.Now()}},
	})
	svc.prevClose = &fakePrevCloseReader{err: errors.New("db: too many connections")}

	bySym, _ := callBatchPriceGuarded(t, svc, context.Background(), []string{"AAPL"})

	if r := rec.find("BatchGetLatestPrice: previous-close lookup failed"); r == nil {
		t.Fatalf("expected the previous-close WARN, got %+v", rec.recs)
	}
	lp := bySym["AAPL"]
	if lp == nil || lp.LastPrice == nil || *lp.LastPrice != 190 {
		t.Fatalf("the trade must still be served, got %v", lp)
	}
	if lp.PrevClose != nil {
		t.Errorf("prev_close must be omitted on a failed lookup, got %v", *lp.PrevClose)
	}
}

// TestBatchGetLatestPrice_PrevCloseRunsConcurrently — G10: the trade fetch waits for the
// previous-close read to start, so a sequential implementation stalls until the budget expires.
func TestBatchGetLatestPrice_PrevCloseRunsConcurrently(t *testing.T) {
	entered := make(chan struct{})
	svc := newBatchPriceSvc(&fakeBatchPriceSource{
		trades:    map[string]*source.Trade{"AAPL": {Price: 191, TradeTime: time.Now()}},
		multiGate: entered,
	})
	svc.prevClose = &fakePrevCloseReader{closes: map[string]float64{"AAPL": 188}, entered: entered}
	svc.budgetCfg = budgetCfgMs(1000)

	bySym, _ := callBatchPriceGuarded(t, svc, context.Background(), []string{"AAPL"})

	lp := bySym["AAPL"]
	if lp == nil || lp.LastPrice == nil || *lp.LastPrice != 191 {
		t.Fatalf("last_price must be present, got %v", lp)
	}
	if lp.PrevClose == nil || *lp.PrevClose != 188 {
		t.Fatalf("prev_close must be present, got %v", lp.PrevClose)
	}
}

// TestBatchGetLatestPrice_DetachedFromCallerCancel — the shared fetch runs on a context detached
// from the first caller, so an already-cancelled caller still gets results.
func TestBatchGetLatestPrice_DetachedFromCallerCancel(t *testing.T) {
	svc := newBatchPriceSvc(&fakeBatchPriceSource{
		trades: map[string]*source.Trade{"AAPL": {Price: 192, TradeTime: time.Now()}},
	})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	bySym, _ := callBatchPriceGuarded(t, svc, ctx, []string{"AAPL"})

	if lp := bySym["AAPL"]; lp == nil || lp.LastPrice == nil || *lp.LastPrice != 192 {
		t.Fatalf("a cancelled caller must still receive the detached fetch's result, got %v", lp)
	}
}

func TestResolveBatchPriceBudget(t *testing.T) {
	cases := []struct {
		name string
		cfg  intGetter
		want time.Duration
	}{
		{"nil config", nil, 2500 * time.Millisecond},
		{"unset key", fakeIntGetter{}, 2500 * time.Millisecond},
		{"zero", budgetCfgMs(0), 2500 * time.Millisecond},
		{"negative", budgetCfgMs(-5), 2500 * time.Millisecond},
		{"explicit", budgetCfgMs(50), 50 * time.Millisecond},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := resolveBatchPriceBudget(tc.cfg); got != tc.want {
				t.Fatalf("resolveBatchPriceBudget = %v, want %v", got, tc.want)
			}
		})
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

	latestBy map[string]*source.HistoricalFundamentalsPeriod // when non-nil, overrides latest per symbol (feature 215)
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

func (r *fakeHistRepo) LatestHistoricalFundamental(_ context.Context, symbol string, _ time.Time) (*source.HistoricalFundamentalsPeriod, error) {
	if r.latestBy != nil {
		return r.latestBy[symbol], nil
	}
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

// fakeBudget is a fixed shared-FMP-budget snapshot (feature 217).
type fakeBudget struct{ used, cap int }

func (b fakeBudget) BudgetSnapshot() (int, int) { return b.used, b.cap }

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
		fmpBudget: fakeBudget{used: 0, cap: 0},
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
		fmpBudget: fakeBudget{used: 0, cap: 250},
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
	// feature 223
	rederived       []source.HistoricalFundamentalsPeriod
	snapshotDeletes []string
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

// feature 222 @AC-2: the EDGAR snapshot projects the newest stored period's (TTM) roe verbatim.
func TestGetFundamentals_EdgarSnapshotInheritsTTMROE_AC2_feature222(t *testing.T) {
	cfg := &fakeCfg{
		strings: map[string]string{"marketdata.fundamentals.snapshot_source": "edgar"},
		ints:    map[string]int64{"marketdata.edgar.cache_ttl_hours": 24},
	}
	q := &source.HistoricalFundamentalsPeriod{
		Symbol: "AXP", FiscalPeriod: "Q2-2026", PeriodType: "quarterly",
		PeriodEnd: hfDate(2026, 6, 30), FiledDate: hfDate(2026, 7, 24),
		ROE: f64p(10685.0 / 30264.0), Currency: "USD", Source: "edgar",
		ExtraMetrics: map[string]float64{"stockholders_equity_usd": 30264e6},
	}
	svc, _ := edgarSnapshotSvc(q, &marketdatav1.Quote{Symbol: "AXP", AskPrice: 341, BidPrice: 340}, cfg, nil, "finnhub")
	f, err := svc.GetFundamentals(context.Background(), "AXP")
	if err != nil || f == nil {
		t.Fatalf("GetFundamentals(edgar): %v", err)
	}
	if math.Abs(f.Roe-10685.0/30264.0) > 1e-9 {
		t.Fatalf("snapshot roe = %v, want the period's TTM roe ≈0.353", f.Roe)
	}
}

// ── feature 223: derivation-version re-derivation of stored EDGAR periods ───────────────────────

func (r *fakeHistRepo) RederiveHistoricalFundamentals(_ context.Context, _ source.HistoricalFundamentalsPeriod) (bool, error) {
	return false, nil
}
func (r *fakeHistRepo) DeleteEdgarSnapshot(_ context.Context, _ string) error { return nil }
func (r *fakeHistRepo211) RederiveHistoricalFundamentals(_ context.Context, _ source.HistoricalFundamentalsPeriod) (bool, error) {
	return false, nil
}
func (r *fakeHistRepo211) DeleteEdgarSnapshot(_ context.Context, _ string) error { return nil }

// fakeHistRepo216's 223 surfaces: rederive upgrades the stored version (guarded like the SQL) and
// snapshot deletions are logged.
func (r *fakeHistRepo216) RederiveHistoricalFundamentals(_ context.Context, p source.HistoricalFundamentalsPeriod) (bool, error) {
	st, ok := r.store[stateKey(p.Symbol, p.FiscalPeriod, p.PeriodType)]
	if !ok || st.DerivationVersion >= p.DerivationVersion {
		return false, nil
	}
	st.DerivationVersion = p.DerivationVersion
	r.rederived = append(r.rederived, p)
	return true, nil
}
func (r *fakeHistRepo216) DeleteEdgarSnapshot(_ context.Context, symbol string) error {
	r.snapshotDeletes = append(r.snapshotDeletes, symbol)
	return nil
}

func axpQ2Period(version int) source.HistoricalFundamentalsPeriod {
	return source.HistoricalFundamentalsPeriod{
		Symbol: "AXP", FiscalPeriod: "Q2-2026", PeriodType: "quarterly",
		PeriodEnd: hfDate(2026, 6, 30), FiledDate: hfDate(2026, 7, 24), Currency: "USD", Source: "edgar",
		DebtToEquity: f64p(52458e6 / 30264e6), ROE: f64p(10685.0 / 30264.0), DerivationVersion: version,
		ExtraMetrics: map[string]float64{"total_debt": 52458e6},
	}
}

// @AC-1 + @AC-2: a stored pre-211 row (version 0, total-liabilities D/E 8.8) is re-derived on the
// next backfill to financial-debt D/E ≈1.73 (< de_bad 2.0), and the cached edgar snapshot is dropped
// so the next GetFundamentals rebuilds from the re-derived period.
func TestBackfillFundamentals_RederivesStaleStoredPeriods_AC1_AC2_feature223(t *testing.T) {
	repo := newFakeHistRepo216(f64p(340))
	stored := &source.HistoricalPriceState{
		Found: true, FiledDate: hfDate(2026, 7, 24), Currency: "USD",
		Price: f64p(340), MarketCap: f64p(1), PERatio: f64p(15), PBRatio: f64p(3), DividendYield: f64p(0.01),
	}
	repo.store[stateKey("AXP", "Q2-2026", "quarterly")] = stored
	svc := &MarketDataService{
		histFundamentals: &fakeHistSource{periods: []source.HistoricalFundamentalsPeriod{axpQ2Period(1)}},
		histRepo:         repo,
		fundCfg:          &fakeCfg{bools: map[string]bool{"marketdata.fundamentals.history.enabled": true}},
	}
	resp, err := svc.BackfillFundamentals(context.Background(), &marketdatav1.BackfillFundamentalsRequest{Symbols: []string{"AXP"}})
	if err != nil {
		t.Fatalf("BackfillFundamentals: %v", err)
	}
	got := repo.rederived
	if len(got) != 1 || got[0].DebtToEquity == nil || *got[0].DebtToEquity >= 2.0 || *got[0].DebtToEquity < 1.7 {
		t.Fatalf("rederived = %+v, want one AXP row with D/E ≈1.73", got)
	}
	if resp.GetPeriodsWritten() != 1 {
		t.Errorf("periods_written = %d, want 1", resp.GetPeriodsWritten())
	}
	if d := repo.snapshotDeletes; len(d) != 1 || d[0] != "AXP" {
		t.Errorf("edgar snapshot invalidations = %v, want [AXP]", d)
	}
	if len(repo.updates) != 0 {
		t.Errorf("price-join untouched by a derivation upgrade, got updates %v", repo.updates)
	}

	// Drift guard: a second run at the same version re-derives nothing and invalidates nothing.
	repo.rederived, repo.snapshotDeletes = nil, nil
	if _, err := svc.BackfillFundamentals(context.Background(), &marketdatav1.BackfillFundamentalsRequest{Symbols: []string{"AXP"}}); err != nil {
		t.Fatal(err)
	}
	if len(repo.rederived) != 0 || len(repo.snapshotDeletes) != 0 {
		t.Fatalf("idempotent re-run re-derived %d / invalidated %v", len(repo.rederived), repo.snapshotDeletes)
	}
}

// ── feature 196: deprecated Bar.timeframe string omitted on the source-bar response paths ────────

// TestBatchGetBars_ColdPathOmitsDeprecatedTimeframe — source bars (barFromAlpaca keeps the string
// because InsertBars persists it) must not carry it once returned to the caller.
func TestBatchGetBars_ColdPathOmitsDeprecatedTimeframe(t *testing.T) {
	barsSrc := &fakeBatchBarsSource{bars: map[string][]*marketdatav1.Bar{
		"AAPL": {{Symbol: "AAPL", Time: timestamppb.New(time.Unix(1000, 0)), Close: 1, Timeframe: "1d", TimeframeEnum: commonv1.Timeframe_TIMEFRAME_1DAY}}, //nolint:staticcheck // SA1019: source bars carry the deprecated string (feature 196 EXCLUDE edge)
	}}
	reg := source.NewRegistry()
	reg.Register("alpaca", barsSrc)
	svc := &MarketDataService{registry: reg, warmSymbols: map[string]struct{}{}}

	resp, err := svc.BatchGetBars(context.Background(), &marketdatav1.BatchGetBarsRequest{
		Symbols: []string{"AAPL"}, Timeframe: "1d",
		Start: timestamppb.New(time.Unix(0, 0)), End: timestamppb.New(time.Unix(10000, 0)),
	})
	if err != nil {
		t.Fatalf("BatchGetBars: %v", err)
	}
	if len(resp.Results) != 1 || len(resp.Results[0].Bars) != 1 {
		t.Fatalf("expected one AAPL bar, got %v", resp.Results)
	}
	bar := resp.Results[0].Bars[0]
	if bar.Timeframe != "" { //nolint:staticcheck // SA1019: asserting the deprecated string timeframe field is omitted (feature 196)
		t.Errorf("expected deprecated Timeframe string omitted, got %q", bar.Timeframe) //nolint:staticcheck // SA1019: see above
	}
	if bar.TimeframeEnum != commonv1.Timeframe_TIMEFRAME_1DAY {
		t.Errorf("expected TimeframeEnum=TIMEFRAME_1DAY, got %v", bar.TimeframeEnum)
	}
}

// TestTruncateBars_OmitsDeprecatedTimeframe — the GetBars cache-write-failure fallback returns
// source bars directly, so it is a response edge too.
func TestTruncateBars_OmitsDeprecatedTimeframe(t *testing.T) {
	live := []*marketdatav1.Bar{
		{Symbol: "AAPL", Timeframe: "1d", TimeframeEnum: commonv1.Timeframe_TIMEFRAME_1DAY}, //nolint:staticcheck // SA1019: source bars carry the deprecated string (feature 196 EXCLUDE edge)
		{Symbol: "AAPL", Timeframe: "1d", TimeframeEnum: commonv1.Timeframe_TIMEFRAME_1DAY}, //nolint:staticcheck // SA1019: see above
	}
	for _, recent := range []bool{true, false} {
		for _, b := range truncateBars(live, 1, recent) {
			if b.Timeframe != "" { //nolint:staticcheck // SA1019: asserting the deprecated string timeframe field is omitted (feature 196)
				t.Errorf("recent=%v: expected deprecated Timeframe string omitted, got %q", recent, b.Timeframe) //nolint:staticcheck // SA1019: see above
			}
			if b.TimeframeEnum != commonv1.Timeframe_TIMEFRAME_1DAY {
				t.Errorf("recent=%v: expected TimeframeEnum kept, got %v", recent, b.TimeframeEnum)
			}
		}
	}
}

// ── feature 215: fundamentals absence (NotFound/omit) vs outage vs kill switch ─────────────────

// absenceSvc wires an edgar-mode service whose historical store holds a producible BABA period and
// no SCHD history; cfg/vendor vary per case.
func absenceSvc(cfg *fakeCfg, vendor source.FundamentalsSource) (*MarketDataService, *fakeFundRepo) {
	svc, repo := edgarSnapshotSvc(nil, &marketdatav1.Quote{Symbol: "BABA", AskPrice: 101, BidPrice: 99}, cfg, vendor, "finnhub")
	svc.histRepo = &fakeHistRepo{latestBy: map[string]*source.HistoricalFundamentalsPeriod{"BABA": babaEdgarPeriod()}}
	return svc, repo
}

func edgarCfg(edgarOn, finnhubOn bool) *fakeCfg {
	cfg := enabledCfg("finnhub")
	cfg.strings = map[string]string{"marketdata.fundamentals.snapshot_source": "edgar"}
	cfg.bools["marketdata.edgar.enabled"] = edgarOn
	cfg.bools["marketdata.finnhub.enabled"] = finnhubOn
	cfg.bools["marketdata.fmp.enabled"] = false
	return cfg
}

// @AC-7: edgar on, vendors off — an un-producible symbol is omitted from Multi (not a batch failure)
// and is NotFound on the single RPC.
func TestFundamentals_EdgarNoSnapshotIsNotFound_feature215(t *testing.T) {
	svc, _ := absenceSvc(edgarCfg(true, false), nil)

	multi, err := svc.GetFundamentalsMulti(context.Background(), []string{"SCHD", "BABA"})
	if err != nil {
		t.Fatalf("Multi: %v (an absent symbol must be omitted, not fail the batch)", err)
	}
	if len(multi) != 1 || multi[0].Symbol != "BABA" {
		t.Fatalf("Multi = %+v, want only BABA", multi)
	}
	_, err = svc.GetFundamentals(context.Background(), "SCHD")
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("single SCHD code = %v (%v), want NotFound", connect.CodeOf(err), err)
	}
}

// Vendor absence (ErrNoFundamentals) → NotFound in vendor mode and via the edgar fallback; an
// unwrapped vendor error stays Unavailable (outage is not absence, FR-8).
func TestFundamentals_VendorNoFundamentalsIsNotFound_feature215(t *testing.T) {
	absent := fmt.Errorf("vendor: no fundamentals for %q: %w", "SCHD", source.ErrNoFundamentals)
	cases := []struct {
		name     string
		cfg      *fakeCfg
		respErr  error
		wantCode connect.Code
	}{
		{"vendor mode absence", enabledCfg("finnhub"), absent, connect.CodeNotFound},
		{"edgar fallback absence", edgarCfg(true, true), absent, connect.CodeNotFound},
		{"vendor mode outage", enabledCfg("finnhub"), fmt.Errorf("finnhub: /stock/metric returned HTTP 503"), connect.CodeUnavailable},
		{"edgar fallback outage", edgarCfg(true, true), fmt.Errorf("finnhub: /stock/metric returned HTTP 503"), connect.CodeUnavailable},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			svc, _ := absenceSvc(tc.cfg, &fakeFundSource{respErr: tc.respErr})
			_, err := svc.GetFundamentals(context.Background(), "SCHD")
			if got := connect.CodeOf(err); got != tc.wantCode {
				t.Fatalf("code = %v (%v), want %v", got, err, tc.wantCode)
			}
		})
	}
	t.Run("edgar fallback absence omitted from Multi", func(t *testing.T) {
		svc, _ := absenceSvc(edgarCfg(true, true), &fakeFundSource{respErr: absent})
		multi, err := svc.GetFundamentalsMulti(context.Background(), []string{"SCHD", "BABA"})
		if err != nil || len(multi) != 1 || multi[0].Symbol != "BABA" {
			t.Fatalf("Multi = %+v, %v; want only BABA, nil", multi, err)
		}
	})
	t.Run("edgar fallback outage aborts Multi", func(t *testing.T) {
		svc, _ := absenceSvc(edgarCfg(true, true), &fakeFundSource{respErr: errors.New("transport down")})
		_, err := svc.GetFundamentalsMulti(context.Background(), []string{"SCHD", "BABA"})
		if connect.CodeOf(err) != connect.CodeUnavailable {
			t.Fatalf("Multi code = %v (%v), want Unavailable", connect.CodeOf(err), err)
		}
	})
}

// The global kill switch stays FailedPrecondition on both RPCs (deliberate all-off, not absence).
func TestFundamentals_EdgarKillSwitchBothRPCs_feature215(t *testing.T) {
	svc, _ := absenceSvc(edgarCfg(false, true), &fakeFundSource{resp: &source.Fundamentals{}})
	if _, err := svc.GetFundamentals(context.Background(), "SCHD"); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("single code = %v, want FailedPrecondition", connect.CodeOf(err))
	}
	if _, err := svc.GetFundamentalsMulti(context.Background(), []string{"SCHD", "BABA"}); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("multi code = %v, want FailedPrecondition", connect.CodeOf(err))
	}
}

// A vendor at its cap with no cached row is ResourceExhausted on the single RPC and aborts Multi under
// the edgar fallback (quota is an outage, never omitted as absence).
func TestFundamentals_QuotaExhaustedNotOmitted_feature215(t *testing.T) {
	svc, repo := absenceSvc(edgarCfg(true, true), &fakeFundSource{resp: &source.Fundamentals{}})
	repo.sinceCount = 20 // == finnhub symbols_per_minute
	if _, err := svc.GetFundamentals(context.Background(), "SCHD"); connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("single code = %v, want ResourceExhausted", connect.CodeOf(err))
	}
	if _, err := svc.GetFundamentalsMulti(context.Background(), []string{"SCHD", "BABA"}); connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("multi code = %v, want ResourceExhausted (abort, not omit)", connect.CodeOf(err))
	}
}

func TestAtQuotaAlertThreshold_feature215(t *testing.T) {
	cases := []struct {
		count, cap int
		want       bool
	}{{0, 0, false}, {79, 100, false}, {80, 100, true}, {100, 100, true}}
	for _, tc := range cases {
		if got := atQuotaAlertThreshold(tc.count, tc.cap); got != tc.want {
			t.Errorf("atQuotaAlertThreshold(%d,%d) = %v, want %v", tc.count, tc.cap, got, tc.want)
		}
	}
}

// ── feature 229: windowed quote reads, cache-age guard, detached cold budget, partial result ──

// fakeQuoteStore mirrors the repo's `time >= since` window so service tests can prove AC-2 without a database.
type fakeQuoteStore struct {
	mu       sync.Mutex
	rows     map[string]*marketdatav1.Quote
	inserts  []*marketdatav1.Quote
	gotSince time.Time
}

func (f *fakeQuoteStore) GetLatestQuotesBatch(_ context.Context, symbols []string, since time.Time) (map[string]*marketdatav1.Quote, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.gotSince = since
	out := map[string]*marketdatav1.Quote{}
	for _, sym := range symbols {
		if q, ok := f.rows[sym]; ok && !q.GetTime().AsTime().Before(since) {
			out[sym] = q
		}
	}
	return out, nil
}

func (f *fakeQuoteStore) InsertQuote(_ context.Context, q *marketdatav1.Quote) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.inserts = append(f.inserts, q)
	return nil
}

func newQuoteSvc(fake *fakeMultiSource, store *fakeQuoteStore, cfg fakeIntGetter) *MarketDataService {
	reg := source.NewRegistry()
	reg.Register("alpaca", fake)
	svc := &MarketDataService{registry: reg, warmSymbols: map[string]struct{}{}, budgetCfg: cfg}
	if store != nil {
		svc.quoteStore = store
	}
	return svc
}

// guardedGetLatestQuotes fails the test instead of hanging when GetLatestQuotes never returns.
func guardedGetLatestQuotes(t *testing.T, svc *MarketDataService, ctx context.Context, symbols []string) (map[string]*marketdatav1.Quote, time.Duration, error) {
	t.Helper()
	type result struct {
		out []*marketdatav1.Quote
		err error
	}
	ch := make(chan result, 1)
	start := time.Now()
	go func() {
		out, err := svc.GetLatestQuotes(ctx, symbols)
		ch <- result{out, err}
	}()
	select {
	case r := <-ch:
		bySym := map[string]*marketdatav1.Quote{}
		for _, q := range r.out {
			bySym[q.Symbol] = q
		}
		return bySym, time.Since(start), r.err
	case <-time.After(5 * time.Second):
		t.Fatal("GetLatestQuotes did not return within the 5s hang guard")
		return nil, 0, nil
	}
}

func quoteAt(sym string, at time.Time) *marketdatav1.Quote {
	return &marketdatav1.Quote{Symbol: sym, AskPrice: 101, BidPrice: 100, Time: timestamppb.New(at)}
}

// @AC-2: a stored quote older than the 168h window is not served; the symbol goes to the live source.
func TestGetLatestQuotes_AC2_WindowedWarmRead(t *testing.T) {
	store := &fakeQuoteStore{rows: map[string]*marketdatav1.Quote{
		"AAPL": quoteAt("AAPL", time.Now().Add(-2*time.Hour)),
		"MSFT": quoteAt("MSFT", time.Now().Add(-200*time.Hour)),
	}}
	fake := &fakeMultiSource{quotes: map[string]*marketdatav1.Quote{}}
	svc := newQuoteSvc(fake, store, fakeIntGetter{"marketdata.quotes.latest_lookback_hours": 168})

	got, _, err := guardedGetLatestQuotes(t, svc, context.Background(), []string{"AAPL", "MSFT"})
	if err != nil {
		t.Fatalf("GetLatestQuotes: %v", err)
	}
	if got["AAPL"] == nil {
		t.Fatal("AAPL (2h old) must be served from the cache")
	}
	if len(fake.requested) != 1 || len(fake.requested[0]) != 1 || fake.requested[0][0] != "MSFT" {
		t.Fatalf("only MSFT (outside the window) should go live, got %v", fake.requested)
	}
	if d := store.gotSince.Sub(time.Now().Add(-168 * time.Hour)); d > time.Second || d < -time.Second {
		t.Fatalf("warm read since = %v, want now-168h", store.gotSince)
	}
}

// @AC-3: cancelling the first caller does not fail a second caller coalesced onto the same cold fetch.
func TestGetLatestQuotes_AC3_DetachedFromFirstCallerCancel(t *testing.T) {
	fake := &fakeMultiSource{
		quotes: map[string]*marketdatav1.Quote{
			"AAPL": quoteAt("AAPL", time.Now()), "MSFT": quoteAt("MSFT", time.Now()),
		},
		started:   make(chan struct{}),
		release:   make(chan struct{}),
		honourCtx: true,
	}
	svc := newQuoteSvc(fake, nil, nil)

	ctx1, cancel1 := context.WithCancel(context.Background())
	done1 := make(chan struct{})
	go func() {
		defer close(done1)
		_, _ = svc.GetLatestQuotes(ctx1, []string{"AAPL", "MSFT"})
	}()
	<-fake.started
	type res struct {
		got map[string]*marketdatav1.Quote
		err error
	}
	ch2 := make(chan res, 1)
	go func() {
		got, _, err := guardedGetLatestQuotes(t, svc, context.Background(), []string{"AAPL", "MSFT"})
		ch2 <- res{got, err}
	}()
	time.Sleep(25 * time.Millisecond) // caller 2 parks in singleflight.Do
	cancel1()
	time.Sleep(25 * time.Millisecond)
	close(fake.release)
	r := <-ch2
	<-done1

	if r.err != nil || r.got["AAPL"] == nil || r.got["MSFT"] == nil {
		t.Fatalf("second caller must get both quotes despite the leader's cancel, got %v err=%v", r.got, r.err)
	}
	if fake.calls != 1 {
		t.Fatalf("expected 1 upstream fetch, got %d", fake.calls)
	}
}

// @AC-7: a live quote outside the window (or with a zero time) is returned but never cached.
func TestGetLatestQuotes_AC7_OldLiveQuoteNotCached(t *testing.T) {
	for _, tc := range []struct {
		name string
		at   time.Time
	}{
		{"200h old", time.Now().Add(-200 * time.Hour)},
		{"zero time", time.Time{}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			store := &fakeQuoteStore{rows: map[string]*marketdatav1.Quote{}}
			fake := &fakeMultiSource{quotes: map[string]*marketdatav1.Quote{"HALT": quoteAt("HALT", tc.at)}}
			svc := newQuoteSvc(fake, store, fakeIntGetter{"marketdata.quotes.latest_lookback_hours": 168})

			got, _, err := guardedGetLatestQuotes(t, svc, context.Background(), []string{"HALT"})
			if err != nil || got["HALT"] == nil {
				t.Fatalf("HALT must be returned to the caller, got %v err=%v", got, err)
			}
			if len(store.inserts) != 0 {
				t.Fatalf("an out-of-window quote must not be cached, got %d inserts", len(store.inserts))
			}
		})
	}
	t.Run("in-window control is cached", func(t *testing.T) {
		store := &fakeQuoteStore{rows: map[string]*marketdatav1.Quote{}}
		fake := &fakeMultiSource{quotes: map[string]*marketdatav1.Quote{"AAPL": quoteAt("AAPL", time.Now().Add(-time.Minute))}}
		svc := newQuoteSvc(fake, store, nil)
		if _, _, err := guardedGetLatestQuotes(t, svc, context.Background(), []string{"AAPL"}); err != nil {
			t.Fatalf("GetLatestQuotes: %v", err)
		}
		if len(store.inserts) != 1 {
			t.Fatalf("a fresh cold quote must be cached, got %d inserts", len(store.inserts))
		}
	})
}

func TestCacheQuote_Guard(t *testing.T) {
	since := time.Now().Add(-time.Hour)
	store := &fakeQuoteStore{}
	svc := &MarketDataService{quoteStore: store}
	if err := svc.cacheQuote(context.Background(), &marketdatav1.Quote{Symbol: "NILT"}, since); err != nil || len(store.inserts) != 0 {
		t.Fatalf("nil time must not be cached (err=%v inserts=%d)", err, len(store.inserts))
	}
	if err := svc.cacheQuote(context.Background(), nil, since); err != nil || len(store.inserts) != 0 {
		t.Fatalf("nil quote must not be cached")
	}
	if err := (&MarketDataService{}).cacheQuote(context.Background(), quoteAt("X", time.Now()), since); err != nil {
		t.Fatalf("nil store must be a no-op, got %v", err)
	}
}

// @AC-8: a failed or timed-out cold fetch returns the warm subset with the cold symbols omitted, never an error.
func TestGetLatestQuotes_AC8_PartialOnColdFailure(t *testing.T) {
	for _, tc := range []struct {
		name string
		fake *fakeMultiSource
	}{
		{"error", &fakeMultiSource{err: errors.New("alpaca 503")}},
		{"no answer", &fakeMultiSource{honourCtx: true}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rec := installWarnRecorder(t)
			store := &fakeQuoteStore{rows: map[string]*marketdatav1.Quote{"AAPL": quoteAt("AAPL", time.Now().Add(-2*time.Hour))}}
			svc := newQuoteSvc(tc.fake, store, fakeIntGetter{"marketdata.quotes.batch_timeout_ms": 500})

			got, elapsed, err := guardedGetLatestQuotes(t, svc, context.Background(), []string{"AAPL", "MSFT"})
			if err != nil {
				t.Fatalf("cold failure must not fail the batch: %v", err)
			}
			if got["AAPL"] == nil || got["MSFT"] != nil || len(got) != 1 {
				t.Fatalf("want AAPL only (MSFT omitted, never zero), got %v", got)
			}
			w := rec.find("GetLatestQuotes: cold fetch failed")
			if w == nil || w.attrs["cold"] != "1" || w.attrs["error"] == "" {
				t.Fatalf("want at least one cold-fetch WARN with cold=1 and an error, got %+v", w)
			}
			if elapsed > 1500*time.Millisecond {
				t.Fatalf("cold fetch must be bounded by the 500ms budget, took %v", elapsed)
			}
		})
	}
}

func TestResolveQuoteTunables(t *testing.T) {
	if got := resolveQuoteLookback(nil); got != 168*time.Hour {
		t.Fatalf("lookback nil = %v", got)
	}
	for v, want := range map[int64]time.Duration{0: 168 * time.Hour, -1: 168 * time.Hour, 24: 24 * time.Hour} {
		if got := resolveQuoteLookback(fakeIntGetter{"marketdata.quotes.latest_lookback_hours": v}); got != want {
			t.Fatalf("lookback %d = %v, want %v", v, got, want)
		}
	}
	if got := resolveQuoteBatchBudget(nil); got != 2500*time.Millisecond {
		t.Fatalf("budget nil = %v", got)
	}
	for v, want := range map[int64]time.Duration{0: 2500 * time.Millisecond, 500: 500 * time.Millisecond} {
		if got := resolveQuoteBatchBudget(fakeIntGetter{"marketdata.quotes.batch_timeout_ms": v}); got != want {
			t.Fatalf("budget %d = %v, want %v", v, got, want)
		}
	}
	if got := resolveQuoteRetentionDays(nil); got != 90 {
		t.Fatalf("retention nil = %d", got)
	}
	for v, want := range map[int64]int64{0: 90, 31: 31, 7: 7} {
		if got := resolveQuoteRetentionDays(fakeIntGetter{"marketdata.retention.quotes_days": v}); got != want {
			t.Fatalf("retention %d = %d, want %d (no clamp)", v, got, want)
		}
	}
}

// fakeRetention records the cutoff and the per-run deadline the retention step passes to the repo.
// StartQuoteRetention's 1h ticker is not driven here; its ctx.Done exit mirrors the reviewed StartWarmQuotePoller shape.
type fakeRetention struct {
	calls       int
	cutoff      time.Time
	hadDeadline bool
	deadline    time.Time
	n           int64
	err         error
}

func (f *fakeRetention) DropQuoteChunksBefore(ctx context.Context, cutoff time.Time) (int64, error) {
	f.calls++
	f.cutoff = cutoff
	f.deadline, f.hadDeadline = ctx.Deadline()
	return f.n, f.err
}

// @AC-4: the retention step drops up to now - quotes_days, never inside the read window, and never panics.
func TestRunQuoteRetentionStep(t *testing.T) {
	now := time.Date(2026, 10, 18, 12, 0, 0, 0, time.UTC)

	t.Run("AC-4 cutoff", func(t *testing.T) {
		fr := &fakeRetention{n: 1}
		svc := &MarketDataService{retention: fr, budgetCfg: fakeIntGetter{
			"marketdata.retention.quotes_days": 90, "marketdata.quotes.latest_lookback_hours": 168}}
		start := time.Now()
		svc.runQuoteRetentionStep(context.Background(), now)
		if fr.calls != 1 || !fr.cutoff.Equal(now.Add(-90*24*time.Hour)) {
			t.Fatalf("want 1 call with cutoff now-90d, got calls=%d cutoff=%v", fr.calls, fr.cutoff)
		}
		if !fr.hadDeadline || fr.deadline.Sub(start) > quoteRetentionBackstop+time.Second {
			t.Fatalf("drop must run under the 30s backstop, deadline=%v had=%v", fr.deadline, fr.hadDeadline)
		}
	})

	for _, tc := range []struct {
		days, lookback int64
		wantCalls      int
	}{{7, 168, 0}, {7, 200, 0}, {8, 168, 1}} {
		t.Run(fmt.Sprintf("guard days=%d lookback=%d", tc.days, tc.lookback), func(t *testing.T) {
			rec := installWarnRecorder(t)
			fr := &fakeRetention{}
			svc := &MarketDataService{retention: fr, budgetCfg: fakeIntGetter{
				"marketdata.retention.quotes_days": tc.days, "marketdata.quotes.latest_lookback_hours": tc.lookback}}
			svc.runQuoteRetentionStep(context.Background(), now)
			if fr.calls != tc.wantCalls {
				t.Fatalf("calls = %d, want %d", fr.calls, tc.wantCalls)
			}
			skipped := rec.find("quote retention skipped: retention within lookback window") != nil
			if skipped != (tc.wantCalls == 0) {
				t.Fatalf("skip WARN logged=%v, want %v", skipped, tc.wantCalls == 0)
			}
		})
	}

	t.Run("defaults", func(t *testing.T) {
		fr := &fakeRetention{}
		(&MarketDataService{retention: fr}).runQuoteRetentionStep(context.Background(), now)
		if fr.calls != 1 || !fr.cutoff.Equal(now.Add(-90*24*time.Hour)) {
			t.Fatalf("nil config must default to 90d, got calls=%d cutoff=%v", fr.calls, fr.cutoff)
		}
	})

	t.Run("error is logged, not raised", func(t *testing.T) {
		rec := installWarnRecorder(t)
		fr := &fakeRetention{err: errors.New("permission denied for hypertable")}
		(&MarketDataService{retention: fr}).runQuoteRetentionStep(context.Background(), now)
		if rec.find("quote retention failed") == nil {
			t.Fatal("a drop error must be logged as WARN")
		}
	})

	t.Run("nil seam", func(t *testing.T) {
		rec := installWarnRecorder(t)
		(&MarketDataService{}).runQuoteRetentionStep(context.Background(), now)
		if len(rec.recs) != 0 {
			t.Fatalf("nil retention seam must be a silent no-op, got %+v", rec.recs)
		}
	})
}

// ── feature 231: valuation mark ──

type closeRow struct {
	close float64
	at    time.Time
}

// fakeDailyCloseReader mirrors the repo's `time >= since` window; block/waitFor drive the AC-11/12/15 timing cases.
type fakeDailyCloseReader struct {
	mu       sync.Mutex
	rows     map[string]closeRow
	gotSince time.Time
	calls    int
	once     sync.Once
	entered  chan struct{} // closed on the first call, when non-nil
	waitFor  <-chan struct{}
	block    bool
	err      error
}

func (f *fakeDailyCloseReader) GetLatestDailyClosesBatch(ctx context.Context, symbols []string, since time.Time) (map[string]float64, error) {
	f.mu.Lock()
	f.calls++
	f.gotSince = since
	f.mu.Unlock()
	if f.entered != nil {
		f.once.Do(func() { close(f.entered) })
	}
	if f.waitFor != nil {
		select {
		case <-f.waitFor:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	if f.block {
		<-ctx.Done()
		return nil, ctx.Err()
	}
	if f.err != nil {
		return nil, f.err
	}
	out := map[string]float64{}
	for _, sym := range symbols {
		if r, ok := f.rows[sym]; ok && !r.at.Before(since) {
			out[sym] = r.close
		}
	}
	return out, nil
}

func liveQuote(sym string, ask, bid float64) *marketdatav1.Quote {
	return &marketdatav1.Quote{Symbol: sym, AskPrice: ask, BidPrice: bid, Time: timestamppb.Now()}
}

func newMarkSvc(multi *fakeMultiSource, store *fakeQuoteStore, cfg fakeIntGetter, closes *fakeDailyCloseReader) *MarketDataService {
	svc := newQuoteSvc(multi, store, cfg)
	if closes != nil {
		svc.dailyCloses = closes
	}
	return svc
}

func lyftCloseAgo(d time.Duration) map[string]closeRow {
	return map[string]closeRow{testdata.Lyft: {close: testdata.LyftDailyClose, at: time.Now().Add(-d)}}
}

// @AC-1: a one-sided quote (either side) is marked at the stored daily close; the raw sides are untouched.
func TestGetLatestQuotes_AC1_OneSidedMarkedAtDailyClose(t *testing.T) {
	for _, tc := range []struct {
		name     string
		ask, bid float64
	}{
		{"bid_zero", testdata.LyftLoneSide, 0},
		{"ask_zero", 0, testdata.LyftLoneSide},
	} {
		t.Run(tc.name, func(t *testing.T) {
			multi := &fakeMultiSource{quotes: map[string]*marketdatav1.Quote{testdata.Lyft: liveQuote(testdata.Lyft, tc.ask, tc.bid)}}
			svc := newMarkSvc(multi, nil, fakeIntGetter{}, &fakeDailyCloseReader{rows: lyftCloseAgo(24 * time.Hour)})
			got, _, err := guardedGetLatestQuotes(t, svc, context.Background(), []string{testdata.Lyft})
			if err != nil {
				t.Fatalf("GetLatestQuotes: %v", err)
			}
			q := got[testdata.Lyft]
			if q == nil || q.MarkPrice == nil || *q.MarkPrice != testdata.LyftDailyClose {
				t.Fatalf("expected mark %v, got %+v", testdata.LyftDailyClose, q)
			}
			if q.AskPrice != tc.ask || q.BidPrice != tc.bid {
				t.Fatalf("raw sides changed: ask %v bid %v", q.AskPrice, q.BidPrice)
			}
		})
	}
}

// @AC-5: a two-sided quote's mark is its mid, not the stored close.
func TestGetLatestQuotes_AC5_TwoSidedMarkIsMid(t *testing.T) {
	multi := &fakeMultiSource{quotes: map[string]*marketdatav1.Quote{
		testdata.Lyft: liveQuote(testdata.Lyft, testdata.LyftTwoSidedAsk, testdata.LyftTwoSidedBid)}}
	svc := newMarkSvc(multi, nil, fakeIntGetter{}, &fakeDailyCloseReader{rows: lyftCloseAgo(24 * time.Hour)})
	got, _, _ := guardedGetLatestQuotes(t, svc, context.Background(), []string{testdata.Lyft})
	want := (testdata.LyftTwoSidedAsk + testdata.LyftTwoSidedBid) / 2
	if q := got[testdata.Lyft]; q == nil || q.MarkPrice == nil || math.Abs(*q.MarkPrice-want) > 1e-9 {
		t.Fatalf("expected mid mark %v, got %+v", want, q)
	}
}

// @AC-6: a one-sided quote whose only close is older than the bound has no mark.
func TestGetLatestQuotes_AC6_StaleCloseLeavesMarkUnset(t *testing.T) {
	multi := &fakeMultiSource{quotes: map[string]*marketdatav1.Quote{testdata.Elwt: liveQuote(testdata.Elwt, testdata.ElwtAsk, 0)}}
	closes := &fakeDailyCloseReader{rows: map[string]closeRow{testdata.Elwt: {close: testdata.ElwtDailyClose, at: time.Now().Add(-200 * time.Hour)}}}
	svc := newMarkSvc(multi, nil, fakeIntGetter{"marketdata.quotes.mark_close_max_age_hours": testdata.MarkCloseMaxAgeHours}, closes)
	got, _, _ := guardedGetLatestQuotes(t, svc, context.Background(), []string{testdata.Elwt})
	if q := got[testdata.Elwt]; q == nil || q.MarkPrice != nil {
		t.Fatalf("expected ELWT returned with no mark, got %+v", q)
	}
}

// @AC-7: only a close inside the staleness bound becomes the mark; the bound is now − 168h.
func TestGetLatestQuotes_AC7_StalenessBoundary(t *testing.T) {
	for _, tc := range []struct {
		name string
		rows map[string]closeRow
		want *float64
	}{
		{"167h", lyftCloseAgo(167 * time.Hour), f64p(testdata.LyftDailyClose)},
		{"169h", lyftCloseAgo(169 * time.Hour), nil},
		{"absent", nil, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			multi := &fakeMultiSource{quotes: map[string]*marketdatav1.Quote{testdata.Lyft: liveQuote(testdata.Lyft, testdata.LyftLoneSide, 0)}}
			closes := &fakeDailyCloseReader{rows: tc.rows}
			svc := newMarkSvc(multi, nil, fakeIntGetter{}, closes)
			got, _, _ := guardedGetLatestQuotes(t, svc, context.Background(), []string{testdata.Lyft})
			q := got[testdata.Lyft]
			if q == nil || q.AskPrice != testdata.LyftLoneSide || q.BidPrice != 0 {
				t.Fatalf("raw quote not returned intact: %+v", q)
			}
			if (tc.want == nil) != (q.MarkPrice == nil) || (tc.want != nil && *q.MarkPrice != *tc.want) {
				t.Fatalf("mark = %v, want %v", q.MarkPrice, tc.want)
			}
			wantSince := time.Now().Add(-testdata.MarkCloseMaxAgeHours * time.Hour)
			if d := closes.gotSince.Sub(wantSince); d > time.Second || d < -time.Second {
				t.Fatalf("since = %v, want ≈ %v", closes.gotSince, wantSince)
			}
		})
	}
}

// @AC-11: a failed close lookup keeps two-sided marks, leaves one-sided marks unset, and WARNs.
func TestGetLatestQuotes_AC11_LookupFailureKeepsTwoSidedMarks(t *testing.T) {
	for _, tc := range []struct {
		name   string
		closes *fakeDailyCloseReader
	}{
		{"timeout", &fakeDailyCloseReader{block: true}},
		{"error", &fakeDailyCloseReader{err: errors.New("pool exhausted")}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rec := installWarnRecorder(t)
			now := timestamppb.Now()
			store := &fakeQuoteStore{rows: map[string]*marketdatav1.Quote{
				testdata.Lyft: {Symbol: testdata.Lyft, AskPrice: testdata.LyftLoneSide, Time: now},
				testdata.Msft: {Symbol: testdata.Msft, AskPrice: testdata.MsftAsk, BidPrice: testdata.MsftBid, Time: now},
			}}
			svc := newMarkSvc(&fakeMultiSource{}, store, fakeIntGetter{"marketdata.quotes.mark_timeout_ms": 100}, tc.closes)
			got, _, err := guardedGetLatestQuotes(t, svc, context.Background(), []string{testdata.Lyft, testdata.Msft})
			if err != nil {
				t.Fatalf("GetLatestQuotes: %v", err)
			}
			wantMsft := (testdata.MsftAsk + testdata.MsftBid) / 2
			if q := got[testdata.Msft]; q == nil || q.MarkPrice == nil || math.Abs(*q.MarkPrice-wantMsft) > 1e-9 {
				t.Fatalf("MSFT mark: want %v, got %+v", wantMsft, q)
			}
			if q := got[testdata.Lyft]; q == nil || q.MarkPrice != nil {
				t.Fatalf("LYFT: want returned with no mark, got %+v", q)
			}
			w := rec.find("GetLatestQuotes: mark lookup failed")
			if w == nil {
				t.Fatal("expected WARN GetLatestQuotes: mark lookup failed")
			}
			if _, ok := w.attrs["error"]; !ok {
				t.Fatalf("WARN missing error attr: %v", w.attrs)
			}
		})
	}
}

// @AC-12: the close lookup runs concurrently with the cold fetch — each fake waits for the other to start, so
// cold-first serial deadlocks (the guard fails it) and close-first serial times the lookup out (mark nil).
func TestGetLatestQuotes_AC12_CloseLookupConcurrentWithColdFetch(t *testing.T) {
	closes := &fakeDailyCloseReader{rows: lyftCloseAgo(24 * time.Hour), entered: make(chan struct{})}
	multi := &fakeMultiSource{
		quotes:  map[string]*marketdatav1.Quote{testdata.Lyft: liveQuote(testdata.Lyft, testdata.LyftLoneSide, 0)},
		started: make(chan struct{}),
		release: closes.entered,
	}
	closes.waitFor = multi.started
	svc := newMarkSvc(multi, nil, fakeIntGetter{"marketdata.quotes.mark_timeout_ms": 2500}, closes)
	got, _, err := guardedGetLatestQuotes(t, svc, context.Background(), []string{testdata.Lyft})
	if err != nil {
		t.Fatalf("GetLatestQuotes: %v", err)
	}
	if q := got[testdata.Lyft]; q == nil || q.MarkPrice == nil || *q.MarkPrice != testdata.LyftDailyClose {
		t.Fatalf("expected LYFT mark %v, got %+v", testdata.LyftDailyClose, q)
	}
}

// @AC-15: a hanging close lookup is bounded by mark_timeout_ms.
func TestGetLatestQuotes_AC15_HangingLookupBounded(t *testing.T) {
	multi := &fakeMultiSource{quotes: map[string]*marketdatav1.Quote{testdata.Lyft: liveQuote(testdata.Lyft, testdata.LyftLoneSide, 0)}}
	svc := newMarkSvc(multi, nil, fakeIntGetter{"marketdata.quotes.mark_timeout_ms": 100}, &fakeDailyCloseReader{block: true})
	got, elapsed, _ := guardedGetLatestQuotes(t, svc, context.Background(), []string{testdata.Lyft})
	if q := got[testdata.Lyft]; q == nil || q.MarkPrice != nil {
		t.Fatalf("expected LYFT with no mark, got %+v", q)
	}
	if elapsed >= time.Second {
		t.Fatalf("expected < 1s with a 100ms mark budget, took %v", elapsed)
	}
}

// Cold quotes are shared across singleflight waiters and the store returns its own pointers: never mutate them.
func TestGetLatestQuotes_MarkDoesNotMutateSharedQuotes(t *testing.T) {
	coldQ := liveQuote(testdata.Lyft, testdata.LyftLoneSide, 0)
	warmQ := &marketdatav1.Quote{Symbol: testdata.Msft, AskPrice: testdata.MsftAsk, BidPrice: testdata.MsftBid, Time: timestamppb.Now()}
	store := &fakeQuoteStore{rows: map[string]*marketdatav1.Quote{testdata.Msft: warmQ}}
	multi := &fakeMultiSource{quotes: map[string]*marketdatav1.Quote{testdata.Lyft: coldQ}}
	svc := newMarkSvc(multi, store, fakeIntGetter{}, &fakeDailyCloseReader{rows: lyftCloseAgo(24 * time.Hour)})
	got, _, _ := guardedGetLatestQuotes(t, svc, context.Background(), []string{testdata.Lyft, testdata.Msft})
	if got[testdata.Lyft].GetMarkPrice() == 0 || got[testdata.Msft].GetMarkPrice() == 0 {
		t.Fatalf("expected both returned quotes marked, got %+v", got)
	}
	if coldQ.MarkPrice != nil || warmQ.MarkPrice != nil {
		t.Fatalf("shared quote pointers mutated: cold %v warm %v", coldQ.MarkPrice, warmQ.MarkPrice)
	}
}

// Without a close reader (test literals / no repo) marks are mid-only: two-sided → mid, one-sided → unset.
func TestGetLatestQuotes_NilCloseReaderMidOnly(t *testing.T) {
	multi := &fakeMultiSource{quotes: map[string]*marketdatav1.Quote{
		testdata.Msft: liveQuote(testdata.Msft, testdata.MsftAsk, testdata.MsftBid),
		testdata.Lyft: liveQuote(testdata.Lyft, testdata.LyftLoneSide, 0),
	}}
	svc := newMarkSvc(multi, nil, fakeIntGetter{}, nil)
	got, _, _ := guardedGetLatestQuotes(t, svc, context.Background(), []string{testdata.Lyft, testdata.Msft})
	if want := (testdata.MsftAsk + testdata.MsftBid) / 2; math.Abs(got[testdata.Msft].GetMarkPrice()-want) > 1e-9 {
		t.Fatalf("MSFT mark %v, want %v", got[testdata.Msft].GetMarkPrice(), want)
	}
	if got[testdata.Lyft].MarkPrice != nil {
		t.Fatalf("LYFT one-sided must stay unmarked without a close reader, got %v", *got[testdata.Lyft].MarkPrice)
	}
}

func TestResolveMarkTunables(t *testing.T) {
	if got := resolveQuoteMarkBudget(nil); got != 500*time.Millisecond {
		t.Fatalf("mark budget nil = %v", got)
	}
	for v, want := range map[int64]time.Duration{0: 500 * time.Millisecond, -1: 500 * time.Millisecond, 100: 100 * time.Millisecond} {
		if got := resolveQuoteMarkBudget(fakeIntGetter{"marketdata.quotes.mark_timeout_ms": v}); got != want {
			t.Fatalf("mark budget %d = %v, want %v", v, got, want)
		}
	}
	if got := resolveMarkCloseMaxAge(nil); got != 168*time.Hour {
		t.Fatalf("max age nil = %v", got)
	}
	for v, want := range map[int64]time.Duration{0: 168 * time.Hour, 120: 120 * time.Hour} {
		if got := resolveMarkCloseMaxAge(fakeIntGetter{"marketdata.quotes.mark_close_max_age_hours": v}); got != want {
			t.Fatalf("max age %d = %v, want %v", v, got, want)
		}
	}
}
