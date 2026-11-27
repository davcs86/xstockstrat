package service

import (
	"context"
	"errors"
	"log/slog"
	"testing"
	"time"

	configv1 "github.com/xstockstrat/contracts/gen/go/config/v1"
	marketdatav1 "github.com/xstockstrat/contracts/gen/go/marketdata/v1"
	"github.com/xstockstrat/marketdata/internal/config"
)

// Feature 317 @AC-2: the GetBars miss-path negative cache. slog.SetDefault is process-global: no t.Parallel().

const (
	bmSym     = "DNB"
	bmTF      = "1d"
	bmMissMsg = "GetBars: no bars stored and live fetch returned none"
	bmWindow  = 30 * time.Minute
)

var bmT0 = time.Date(2026, 11, 2, 15, 0, 0, 0, time.UTC)

func bmKey(tf string) string { return bmSym + "|" + tf }

// bmEmptySource is a servable symbol the vendor has no bars for.
func bmEmptySource() *barsCancelSource {
	return &barsCancelSource{fakeBackfillSource: &fakeBackfillSource{}, newBars: func() []*marketdatav1.Bar { return nil }}
}

func bmCall(ctx context.Context, s *MarketDataService, tf string, implicit bool, stored []*marketdatav1.Bar, token string, now time.Time) ([]*marketdatav1.Bar, string) {
	start := now.Add(-72 * time.Hour)
	return s.liveRefetch(ctx, bmSym, tf, start, start, now, 500, implicit, stored, token, now)
}

func bmWarns(rec *warmLogRecorder, tf string) int {
	return cqCount(rec, slog.LevelWarn, bmMissMsg, "timeframe", tf)
}

func bmDebugs(rec *warmLogRecorder, tf string) int {
	return cqCount(rec, slog.LevelDebug, bmMissMsg, "timeframe", tf)
}

// @AC-2
func TestLiveRefetch_AC2_ThreeCallsOneVendorFetchOneWarn(t *testing.T) {
	rec := installWarmLogRecorder(t)
	src := bmEmptySource()
	s := cacheBarsSvc(src, &recordingBarsStore{})

	for i := 0; i < 3; i++ {
		bars, token := bmCall(context.Background(), s, bmTF, true, nil, "", bmT0.Add(time.Duration(i)*time.Minute))
		if len(bars) != 0 || token != "" {
			t.Errorf("call %d returned %d bars, token %q; want none", i+1, len(bars), token)
		}
	}
	if src.calls != 1 {
		t.Errorf("vendor calls = %d, want 1", src.calls)
	}
	if n := bmWarns(rec, bmTF); n != 1 {
		t.Errorf("miss WARNs = %d, want 1", n)
	}
}

func TestLiveRefetch_WindowExpiry_RefetchesOnceWithDebug(t *testing.T) {
	rec := installWarmLogRecorder(t)
	src := bmEmptySource()
	s := cacheBarsSvc(src, &recordingBarsStore{})

	bmCall(context.Background(), s, bmTF, true, nil, "", bmT0)
	after := bmT0.Add(bmWindow + time.Second)
	bmCall(context.Background(), s, bmTF, true, nil, "", after)
	if src.calls != 2 {
		t.Fatalf("vendor calls after the window = %d, want 2", src.calls)
	}
	if n := bmWarns(rec, bmTF); n != 1 {
		t.Errorf("miss WARNs = %d, want 1 (the refetch after the window logs Debug)", n)
	}
	if n := bmDebugs(rec, bmTF); n != 1 {
		t.Errorf("miss Debug lines = %d, want 1", n)
	}
	bmCall(context.Background(), s, bmTF, true, nil, "", after.Add(time.Second))
	if src.calls != 2 {
		t.Errorf("vendor calls inside the new window = %d, want 2", src.calls)
	}
}

func TestLiveRefetch_CrossKeySweep_ExpiredEntryWarnsAgain(t *testing.T) {
	rec := installWarmLogRecorder(t)
	src := bmEmptySource()
	s := cacheBarsSvc(src, &recordingBarsStore{})
	const tfB = "1h"

	bmCall(context.Background(), s, bmTF, true, nil, "", bmT0)
	later := bmT0.Add(bmWindow + time.Second)
	bmCall(context.Background(), s, tfB, true, nil, "", later)
	if _, ok := s.lastEmptyFetch[bmKey(bmTF)]; ok {
		t.Fatal("key B's write must sweep key A's expired entry")
	}
	bmCall(context.Background(), s, bmTF, true, nil, "", later)
	if src.calls != 3 {
		t.Errorf("vendor calls = %d, want 3", src.calls)
	}
	if n := bmWarns(rec, bmTF); n != 2 {
		t.Errorf("key A miss WARNs = %d, want 2 (its swept entry makes the refetch WARN again)", n)
	}
	if n := bmDebugs(rec, bmTF); n != 0 {
		t.Errorf("key A miss Debug lines = %d, want 0", n)
	}
	bmCall(context.Background(), s, tfB, true, nil, "", later.Add(time.Second))
	if src.calls != 3 {
		t.Errorf("key B inside its window made a vendor call: calls = %d, want 3", src.calls)
	}
}

func TestLiveRefetch_WindowZero_FetchesAndWarnsEveryCall(t *testing.T) {
	for _, v := range []int64{0, -1} {
		rec := installWarmLogRecorder(t)
		src := bmEmptySource()
		s := cacheBarsSvc(src, &recordingBarsStore{})
		s.budgetCfg = &fakeCfg{ints: map[string]int64{barsMissBackoffKey: v}}

		for i := 0; i < 3; i++ {
			bmCall(context.Background(), s, bmTF, true, nil, "", bmT0)
		}
		if src.calls != 3 {
			t.Errorf("window %d: vendor calls = %d, want 3", v, src.calls)
		}
		if n := bmWarns(rec, bmTF); n != 3 {
			t.Errorf("window %d: miss WARNs = %d, want 3", v, n)
		}
		if len(s.lastEmptyFetch) != 0 {
			t.Errorf("window %d: lastEmptyFetch holds %d entries, want 0", v, len(s.lastEmptyFetch))
		}
	}
}

func TestLiveRefetch_ExplicitRangeMiss_StillFetchesWithLiveEntry(t *testing.T) {
	rec := installWarmLogRecorder(t)
	src := bmEmptySource()
	s := cacheBarsSvc(src, &recordingBarsStore{})

	bmCall(context.Background(), s, bmTF, true, nil, "", bmT0)
	bmCall(context.Background(), s, bmTF, false, nil, "", bmT0.Add(time.Minute))
	if src.calls != 2 {
		t.Errorf("vendor calls = %d, want 2 (an explicit-range miss always fetches)", src.calls)
	}
	if n := bmWarns(rec, bmTF); n != 2 {
		t.Errorf("miss WARNs = %d, want 2", n)
	}
	if got := s.lastEmptyFetch[bmKey(bmTF)]; !got.Equal(bmT0) {
		t.Errorf("entry = %v, want unchanged %v", got, bmT0)
	}
}

func TestLiveRefetch_CancelPlusEmpty_RecordsNoEntry(t *testing.T) {
	rec := installWarmLogRecorder(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	src := bmEmptySource()
	src.cancel = cancel
	s := cacheBarsSvc(src, &recordingBarsStore{})

	bmCall(ctx, s, bmTF, true, nil, "", bmT0)
	if _, ok := s.lastEmptyFetch[bmKey(bmTF)]; ok {
		t.Error("a cancelled empty fetch must record no entry")
	}
	if n := bmWarns(rec, bmTF); n != 0 {
		t.Errorf("miss WARNs on a cancelled ctx = %d, want 0", n)
	}
	src.cancel = nil
	bmCall(context.Background(), s, bmTF, true, nil, "", bmT0.Add(time.Minute))
	if src.calls != 2 {
		t.Errorf("vendor calls = %d, want 2 (the next call fetches again)", src.calls)
	}
}

func TestLiveRefetch_FetchError_RecordsNoEntry(t *testing.T) {
	installWarmLogRecorder(t)
	src := bmEmptySource()
	src.err = errors.New("vendor unavailable")
	s := cacheBarsSvc(src, &recordingBarsStore{})

	bmCall(context.Background(), s, bmTF, true, nil, "", bmT0)
	if _, ok := s.lastEmptyFetch[bmKey(bmTF)]; ok {
		t.Error("a failed fetch must record no entry")
	}
	bmCall(context.Background(), s, bmTF, true, nil, "", bmT0.Add(time.Minute))
	if src.calls != 2 {
		t.Errorf("vendor calls = %d, want 2 (the next call fetches again)", src.calls)
	}
}

func TestLiveRefetch_StaleBranch_NeverTouchesEntry(t *testing.T) {
	rec := installWarmLogRecorder(t)
	src := bmEmptySource()
	s := cacheBarsSvc(src, &recordingBarsStore{})
	s.lastEmptyFetch = map[string]time.Time{bmKey(bmTF): bmT0}
	stored := aaplDailyBars()

	bars, token := bmCall(context.Background(), s, bmTF, true, stored, "tok", bmT0.Add(time.Minute))
	if src.calls != 1 {
		t.Errorf("vendor calls = %d, want 1 (a stale page always refetches)", src.calls)
	}
	if len(bars) != len(stored) || bars[0] != stored[0] || token != "tok" {
		t.Errorf("got %d bars, token %q; want the stored page and its token", len(bars), token)
	}
	if got := s.lastEmptyFetch[bmKey(bmTF)]; !got.Equal(bmT0) || len(s.lastEmptyFetch) != 1 {
		t.Errorf("entry = %v (map size %d), want unchanged %v", got, len(s.lastEmptyFetch), bmT0)
	}
	if n := bmWarns(rec, bmTF) + bmDebugs(rec, bmTF); n != 0 {
		t.Errorf("miss lines on a stale page = %d, want 0", n)
	}
}

func TestMissFetchDue(t *testing.T) {
	s := &MarketDataService{lastEmptyFetch: make(map[string]time.Time)}
	key := bmKey(bmTF)

	for i := 0; i < 2; i++ {
		if !s.missFetchDue(key, bmWindow, bmT0) {
			t.Errorf("no entry: check %d is not due", i+1)
		}
	}
	if len(s.lastEmptyFetch) != 0 {
		t.Error("a check must not reserve the key")
	}
	s.lastEmptyFetch[key] = bmT0
	for _, tc := range []struct {
		name string
		key  string
		now  time.Time
		want bool
	}{
		{"inside the window", key, bmT0.Add(bmWindow - time.Second), false},
		{"at the window", key, bmT0.Add(bmWindow), true},
		{"past the window", key, bmT0.Add(bmWindow + time.Second), true},
		{"a different timeframe is independent", bmKey("1h"), bmT0.Add(time.Minute), true},
		{"a different symbol is independent", "XYZ|" + bmTF, bmT0.Add(time.Minute), true},
	} {
		if got := s.missFetchDue(tc.key, bmWindow, tc.now); got != tc.want {
			t.Errorf("%s: due = %v, want %v", tc.name, got, tc.want)
		}
	}
	if !s.missFetchDue(key, 0, bmT0.Add(time.Minute)) {
		t.Error("window 0: always due")
	}
	if len(s.lastEmptyFetch) != 0 {
		t.Errorf("window 0 must clear the map; %d entries left", len(s.lastEmptyFetch))
	}
}

func TestNoteMissResult(t *testing.T) {
	s := &MarketDataService{}
	key, other := bmKey(bmTF), bmKey("1h")
	empty := barsFetch{confirmedEmpty: true}

	if !s.noteMissResult(key, bmWindow, bmT0, empty) {
		t.Error("a first confirmed empty reports firstEmpty")
	}
	if got := s.lastEmptyFetch[key]; !got.Equal(bmT0) {
		t.Fatalf("entry = %v, want %v (nil map created on first write)", got, bmT0)
	}
	t1 := bmT0.Add(time.Minute)
	if s.noteMissResult(key, bmWindow, t1, empty) {
		t.Error("a confirmed empty with a prior entry is not firstEmpty")
	}
	if got := s.lastEmptyFetch[key]; !got.Equal(t1) {
		t.Errorf("entry = %v, want %v", got, t1)
	}
	// A fetch error and a cancelled empty fetch both come back as the zero barsFetch.
	s.noteMissResult(key, bmWindow, t1.Add(time.Second), barsFetch{})
	if got := s.lastEmptyFetch[key]; !got.Equal(t1) {
		t.Errorf("an error/cancel result changed the entry to %v", got)
	}
	s.noteMissResult(key, bmWindow, t1.Add(time.Second), barsFetch{bars: aaplDailyBars()})
	if _, ok := s.lastEmptyFetch[key]; ok {
		t.Error("a result with bars must delete the entry")
	}

	s.lastEmptyFetch = map[string]time.Time{other: bmT0, key: bmT0.Add(bmWindow)}
	s.noteMissResult(bmKey("15m"), bmWindow, bmT0.Add(bmWindow+time.Second), empty)
	if _, ok := s.lastEmptyFetch[other]; ok {
		t.Error("a write must sweep another key's entry older than the window")
	}
	if _, ok := s.lastEmptyFetch[key]; !ok {
		t.Error("a write must keep an entry still inside the window")
	}
}

func TestResolveBarsMissBackoff(t *testing.T) {
	snapshot := func(v int64) *config.Watcher {
		return config.MustSnapshotWatcher("marketdata", map[string]*configv1.ConfigValue{barsMissBackoffKey: {Value: &configv1.ConfigValue_IntVal{IntVal: v}}})
	}
	for _, tc := range []struct {
		name string
		cfg  intGetter
		want time.Duration
	}{
		{"nil cfg uses the 30m default", nil, 30 * time.Minute},
		{"absent key uses the 30m default", &fakeCfg{}, 30 * time.Minute},
		{"stored 0 disables", &fakeCfg{ints: map[string]int64{barsMissBackoffKey: 0}}, 0},
		{"negative disables, never the default", &fakeCfg{ints: map[string]int64{barsMissBackoffKey: -5}}, 0},
		{"stored 60000 is 1m", &fakeCfg{ints: map[string]int64{barsMissBackoffKey: 60000}}, time.Minute},
		{"snapshot-built Watcher 600000 is 10m", snapshot(600000), 10 * time.Minute},
		{"snapshot-built Watcher stored 0 disables", snapshot(0), 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := resolveBarsMissBackoff(tc.cfg); got != tc.want {
				t.Errorf("resolveBarsMissBackoff = %v, want %v", got, tc.want)
			}
		})
	}
}
