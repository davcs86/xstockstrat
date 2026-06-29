package service

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/types/known/timestamppb"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	notifyv1 "github.com/xstockstrat/contracts/gen/go/notify/v1"
	"github.com/xstockstrat/marketdata/internal/source"
)

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
	bools map[string]bool
	ints  map[string]int64
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
func (c *fakeCfg) GetString(_, d string) string { return d }

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

func enabledCfg() *fakeCfg {
	return &fakeCfg{
		bools: map[string]bool{"marketdata.fmp.enabled": true},
		ints:  map[string]int64{"marketdata.fmp.cache_ttl_hours": 24, "marketdata.fmp.daily_request_cap": 250},
	}
}

func newFundSvc(cfg *fakeCfg, repo *fakeFundRepo, src source.FundamentalsSource, notify notifyv1.NotifyServiceClient) *MarketDataService {
	return &MarketDataService{fundamentals: src, fundCfg: cfg, fundRepo: repo, notify: notify}
}

// Acceptance #2: a within-TTL second call issues zero FMP calls.
func TestGetFundamentals_CacheHitNoFMP(t *testing.T) {
	repo := newFakeFundRepo()
	repo.rows["AAPL"] = &source.Fundamentals{Symbol: "AAPL", Price: 100}
	repo.fetchedAt["AAPL"] = time.Now()
	src := &fakeFundSource{resp: &source.Fundamentals{Price: 200}}
	svc := newFundSvc(enabledCfg(), repo, src, &fakeNotify{})

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

// Acceptance #3a: at-cap miss with a stale cache returns stale=true.
func TestGetFundamentals_AtCapStale(t *testing.T) {
	repo := newFakeFundRepo()
	repo.rows["AAPL"] = &source.Fundamentals{Symbol: "AAPL", Price: 100}
	repo.fetchedAt["AAPL"] = time.Now().Add(-48 * time.Hour)
	repo.todayCount = 250
	src := &fakeFundSource{resp: &source.Fundamentals{Price: 200}}
	svc := newFundSvc(enabledCfg(), repo, src, &fakeNotify{})

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
	src := &fakeFundSource{resp: &source.Fundamentals{Price: 200}}
	svc := newFundSvc(enabledCfg(), repo, src, &fakeNotify{})

	_, err := svc.GetFundamentals(context.Background(), "AAPL")
	if connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("expected ResourceExhausted, got %v", err)
	}
}

// Acceptance #4: enabled=false returns FailedPrecondition and makes zero FMP calls.
func TestGetFundamentals_DisabledFailedPrecondition(t *testing.T) {
	repo := newFakeFundRepo()
	src := &fakeFundSource{resp: &source.Fundamentals{Price: 200}}
	cfg := &fakeCfg{bools: map[string]bool{"marketdata.fmp.enabled": false}}
	svc := newFundSvc(cfg, repo, src, &fakeNotify{})

	_, err := svc.GetFundamentals(context.Background(), "AAPL")
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("expected FailedPrecondition, got %v", err)
	}
	if src.calls != 0 {
		t.Fatalf("disabled must not call FMP, got %d", src.calls)
	}
}

// Acceptance #5: miss + under cap fetches and upserts.
func TestGetFundamentals_MissFetchesAndUpserts(t *testing.T) {
	repo := newFakeFundRepo()
	src := &fakeFundSource{resp: &source.Fundamentals{Price: 200}}
	svc := newFundSvc(enabledCfg(), repo, src, &fakeNotify{})

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
	src := &fakeFundSource{resp: &source.Fundamentals{Price: 200}}
	notify := &fakeNotify{}
	svc := newFundSvc(enabledCfg(), repo, src, notify)

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

// FR-6: enabled but nil source (not built) → FailedPrecondition, no panic.
func TestGetFundamentals_NilSourceFailedPrecondition(t *testing.T) {
	svc := newFundSvc(enabledCfg(), newFakeFundRepo(), nil, &fakeNotify{})
	_, err := svc.GetFundamentals(context.Background(), "AAPL")
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("expected FailedPrecondition for nil source, got %v", err)
	}
}
