package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	configv1 "github.com/xstockstrat/contracts/gen/go/config/v1"
	marketdatav1 "github.com/xstockstrat/contracts/gen/go/marketdata/v1"
	"github.com/xstockstrat/marketdata/internal/config"
)

// Feature 291 fixtures: cycle k ends at bhEnd(k) (5-minute cycles from a Wednesday session) with a
// 48h window, and a 1h back-off (12 cycles). Every "no hold" test carries a positive control.
const (
	bhKey    = "marketdata.stream.bar_ingest_backoff_ms"
	bhTF     = "1d"
	bhCycle  = 5 * time.Minute
	bhWindow = 48 * time.Hour
	bhD      = time.Hour
	bhDMs    = int64(3600000)

	bhHoldingMsg   = "bar ingest: holding symbols that returned no bars"
	bhRecoveredMsg = "bar ingest: held symbols returned bars"
	bhNoBarsMsg    = "bar ingest: symbols returned no bars"
	bhHeartbeatMsg = "bar ingest: cycle complete"
)

var (
	bhEnd0    = time.Date(2026, 11, 4, 15, 0, 0, 0, time.UTC)
	bhLive    = []string{"LIVE1", "LIVE2", "LIVE3"}
	bhSymbols = []string{"LIVE1", "LIVE2", "LIVE3", "DEAD"}
)

func bhEnd(k int) time.Time { return bhEnd0.Add(time.Duration(k) * bhCycle) }

// recordingBarsSource records each cycle's vendor request, keyed by cycle number; multiErr forces the
// per-symbol path and errs makes a per-symbol fetch fail.
type recordingBarsSource struct {
	*fakeBatchBarsSource
	requested  map[int][]string
	cur        int
	multiCalls int
	multiErr   error
	errs       map[string]error
}

func newRecordingBarsSource(withBars ...string) *recordingBarsSource {
	src := &recordingBarsSource{fakeBatchBarsSource: &fakeBatchBarsSource{}, requested: map[int][]string{}}
	src.setBars(withBars...)
	return src
}

// setBars makes exactly syms return one bar each; every other symbol returns none.
func (r *recordingBarsSource) setBars(syms ...string) {
	r.bars = map[string][]*marketdatav1.Bar{}
	for _, sym := range syms {
		r.bars[sym] = []*marketdatav1.Bar{{Symbol: sym, Close: 1}}
	}
}

func (r *recordingBarsSource) beginCycle(k int) {
	r.cur = k
	r.requested[k] = []string{}
}

func (r *recordingBarsSource) GetBarsMulti(ctx context.Context, symbols []string, tf string, start, end time.Time) (map[string][]*marketdatav1.Bar, error) {
	r.multiCalls++
	if r.multiErr != nil {
		return nil, r.multiErr
	}
	r.requested[r.cur] = append(r.requested[r.cur], symbols...)
	return r.fakeBatchBarsSource.GetBarsMulti(ctx, symbols, tf, start, end)
}

func (r *recordingBarsSource) GetBars(_ context.Context, sym, _ string, _, _ time.Time) ([]*marketdatav1.Bar, error) {
	r.requested[r.cur] = append(r.requested[r.cur], sym)
	if err := r.errs[sym]; err != nil {
		return nil, err
	}
	return r.bars[sym], nil
}

// holdRecordingBarsStore records inserted bars (fakeBarsStore's InsertBars is a no-op and proves nothing).
type holdRecordingBarsStore struct {
	fakeBarsStore
	mu   sync.Mutex
	bars []*marketdatav1.Bar
}

func (r *holdRecordingBarsStore) InsertBars(_ context.Context, bars []*marketdatav1.Bar) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.bars = append(r.bars, bars...)
	return nil
}

func (r *holdRecordingBarsStore) countFor(sym string) int {
	r.mu.Lock()
	defer r.mu.Unlock()
	n := 0
	for _, b := range r.bars {
		if b.Symbol == sym {
			n++
		}
	}
	return n
}

func newBarHoldService(backoffMs int64) (*MarketDataService, *fakeCfg, *holdRecordingBarsStore) {
	cfg := &fakeCfg{ints: map[string]int64{bhKey: backoffMs}}
	store := &holdRecordingBarsStore{}
	return &MarketDataService{budgetCfg: cfg, barsStore: store}, cfg, store
}

// runCycles runs cycles from..from+n-1; perCycle (optional) runs before each cycle to change what the source returns.
func runCycles(s *MarketDataService, src *recordingBarsSource, symbols []string, from, n int, perCycle func(k int)) {
	for k := from; k < from+n; k++ {
		if perCycle != nil {
			perCycle(k)
		}
		src.beginCycle(k)
		end := bhEnd(k)
		s.ingestRecentBarsForTimeframe(context.Background(), src, symbols, bhTF, end.Add(-bhWindow), end)
	}
}

func holdEntry(s *MarketDataService, sym string) (barHoldEntry, bool) {
	s.warmMu.Lock()
	defer s.warmMu.Unlock()
	e := s.barHold[sym][bhTF]
	if e == nil {
		return barHoldEntry{}, false
	}
	return *e, true
}

func isHeld(s *MarketDataService, sym string) bool {
	e, ok := holdEntry(s, sym)
	return ok && !e.nextProbe.IsZero()
}

func holdSymbols(s *MarketDataService) int {
	s.warmMu.Lock()
	defer s.warmMu.Unlock()
	return len(s.barHold)
}

func requireNextProbe(t *testing.T, s *MarketDataService, sym string, want time.Time) {
	t.Helper()
	e, ok := holdEntry(s, sym)
	if !ok || !e.nextProbe.Equal(want) {
		t.Fatalf("%s: want held with nextProbe %v, got entry %+v (present %v)", sym, want, e, ok)
	}
}

// requireRequested asserts sym's presence in the request lists of cycles from..to (each must have run).
func requireRequested(t *testing.T, src *recordingBarsSource, sym string, from, to int, want bool) {
	t.Helper()
	for k := from; k <= to; k++ {
		req, ran := src.requested[k]
		if !ran {
			t.Fatalf("cycle %d did not run", k)
		}
		if got := slices.Contains(req, sym); got != want {
			t.Errorf("cycle %d: %s requested = %v, want %v (request %v)", k, sym, got, want, req)
		}
	}
}

// requireHeldAfterBackoff is the positive control: sym is not held after 12 cycles and is held after the 13th.
func requireHeldAfterBackoff(t *testing.T, s *MarketDataService, src *recordingBarsSource, symbols []string, sym string, from int) {
	t.Helper()
	runCycles(s, src, symbols, from, 12, nil)
	if isHeld(s, sym) {
		t.Fatalf("positive control: %s held before the back-off elapsed", sym)
	}
	runCycles(s, src, symbols, from+12, 1, nil)
	if !isHeld(s, sym) {
		t.Fatalf("positive control: %s not held once the back-off elapsed", sym)
	}
}

// fanoutHandler hands every record to each handler; recordingLogHandler keeps exactly one level.
type fanoutHandler []slog.Handler

func (f fanoutHandler) Enabled(context.Context, slog.Level) bool { return true }
func (f fanoutHandler) Handle(ctx context.Context, r slog.Record) error {
	for _, h := range f {
		if err := h.Handle(ctx, r.Clone()); err != nil {
			return err
		}
	}
	return nil
}
func (f fanoutHandler) WithAttrs([]slog.Attr) slog.Handler { return f }
func (f fanoutHandler) WithGroup(string) slog.Handler      { return f }

// installBothLevelRecorders records WARN and INFO at once; slog.SetDefault is global, so no t.Parallel().
func installBothLevelRecorders(t *testing.T) (warn, info *recordingLogHandler) {
	t.Helper()
	warn, info = &recordingLogHandler{level: slog.LevelWarn}, &recordingLogHandler{level: slog.LevelInfo}
	prev := slog.Default()
	slog.SetDefault(slog.New(fanoutHandler{warn, info}))
	t.Cleanup(func() { slog.SetDefault(prev) })
	return warn, info
}

func recsNamed(h *recordingLogHandler, msg string) []recordedLog {
	h.mu.Lock()
	defer h.mu.Unlock()
	var out []recordedLog
	for _, r := range h.recs {
		if r.msg == msg {
			out = append(out, r)
		}
	}
	return out
}

// @AC-1 @AC-9
func TestBarHold_HoldsAfterWallClockSpan(t *testing.T) {
	warn, _ := installBothLevelRecorders(t)
	s, _, _ := newBarHoldService(bhDMs)
	src := newRecordingBarsSource(bhLive...)

	runCycles(s, src, bhSymbols, 0, 12, nil)
	if isHeld(s, "DEAD") || warn.count(bhHoldingMsg) != 0 {
		t.Fatalf("DEAD held before 1h of informative-cycle evidence")
	}
	runCycles(s, src, bhSymbols, 12, 1, nil)
	requireNextProbe(t, s, "DEAD", bhEnd(24))
	if w := warn.find(bhHoldingMsg); w == nil || w.attrs["sample"] != "[DEAD]" || w.attrs["newly_held"] != "1" || w.attrs["probe_every_ms"] != "3600000" {
		t.Fatalf("want holding WARN naming DEAD with probe_every_ms=3600000, got %+v", w)
	}
	runCycles(s, src, bhSymbols, 13, 12, nil)
	requireNextProbe(t, s, "DEAD", bhEnd(36)) // empty probe at cycle 24 reschedules exactly end + D
	runCycles(s, src, bhSymbols, 25, 12, nil)
	requireNextProbe(t, s, "DEAD", bhEnd(48)) // the period is never doubled

	requireRequested(t, src, "DEAD", 0, 12, true)
	requireRequested(t, src, "DEAD", 13, 23, false)
	requireRequested(t, src, "DEAD", 24, 24, true)
	requireRequested(t, src, "DEAD", 25, 35, false)
	requireRequested(t, src, "DEAD", 36, 36, true)
	for _, sym := range bhLive {
		requireRequested(t, src, sym, 0, 36, true)
	}
}

// @AC-1
func TestBarHold_ReportsOnce(t *testing.T) {
	warn, info := installBothLevelRecorders(t)
	s, _, _ := newBarHoldService(bhDMs)
	src := newRecordingBarsSource(bhLive...)
	runCycles(s, src, bhSymbols, 0, 40, nil)

	holding := recsNamed(warn, bhHoldingMsg)
	if len(holding) != 1 || holding[0].attrs["sample"] != "[DEAD]" {
		t.Fatalf("want exactly one holding WARN naming DEAD over 40 cycles, got %v", holding)
	}
	afterHold := map[string]bool{}
	for k := 13; k < 40; k++ {
		afterHold[fmt.Sprint(bhEnd(k))] = true
	}
	named := 0
	for _, r := range recsNamed(warn, bhNoBarsMsg) {
		if !strings.Contains(r.attrs["sample"], "DEAD") {
			continue
		}
		named++
		if afterHold[r.attrs["window_end"]] {
			t.Errorf("no-bars WARN still names held DEAD at window_end %s: %v", r.attrs["window_end"], r.attrs)
		}
	}
	if named != 13 {
		t.Errorf("want the no-bars WARN to name DEAD in cycles 0-12 only (13 times), got %d", named)
	}
	beats := recsNamed(info, bhHeartbeatMsg)
	if len(beats) != 40 {
		t.Fatalf("want a heartbeat every cycle (40), got %d", len(beats))
	}
	for k, b := range beats {
		wantHeld := "0"
		if k >= 12 {
			wantHeld = "1"
		}
		if b.attrs["symbols"] != "4" || b.attrs["held"] != wantHeld {
			t.Errorf("cycle %d heartbeat: want symbols=4 held=%s, got %v", k, wantHeld, b.attrs)
		}
	}
}

// @AC-4
func TestBarHold_RecoveryClearsAndStoresBars(t *testing.T) {
	info := installLogRecorder(t, slog.LevelInfo)
	s, _, store := newBarHoldService(bhDMs)
	src := newRecordingBarsSource(bhLive...)
	runCycles(s, src, bhSymbols, 0, 24, nil)
	if !isHeld(s, "DEAD") || store.countFor("DEAD") != 0 {
		t.Fatalf("setup: want DEAD held with no stored bars before its probe")
	}

	runCycles(s, src, bhSymbols, 24, 1, func(int) { src.setBars("LIVE1", "LIVE2", "LIVE3", "DEAD") })
	if got := store.countFor("DEAD"); got != 1 {
		t.Errorf("want the probe's 1 DEAD bar stored, got %d", got)
	}
	recs := recsNamed(info, bhRecoveredMsg)
	if len(recs) != 1 || recs[0].attrs["sample"] != "[DEAD]" || recs[0].attrs["recovered"] != "1" {
		t.Errorf("want exactly one recovered INFO naming DEAD, got %v", recs)
	}
	if _, ok := holdEntry(s, "DEAD"); ok {
		t.Errorf("recovery must clear DEAD's hold entry")
	}
	runCycles(s, src, bhSymbols, 25, 1, nil)
	requireRequested(t, src, "DEAD", 25, 25, true)
}

// @AC-2 @AC-9
func TestBarHold_WholeEmptyCyclesNeutral(t *testing.T) {
	t.Run("whole-empty cycles never hold", func(t *testing.T) {
		warn := installWarnRecorder(t)
		s, _, _ := newBarHoldService(bhDMs)
		src := newRecordingBarsSource()
		runCycles(s, src, bhSymbols, 0, 36, nil)
		for _, sym := range bhSymbols {
			requireRequested(t, src, sym, 0, 35, true)
		}
		if n := warn.count(bhHoldingMsg); n != 0 || holdSymbols(s) != 0 {
			t.Errorf("whole-empty cycles must create no hold state: %d holding WARNs, %d entries", n, holdSymbols(s))
		}
	})
	t.Run("positive control: a live majority holds DEAD", func(t *testing.T) {
		warn := installWarnRecorder(t)
		s, _, _ := newBarHoldService(bhDMs)
		src := newRecordingBarsSource(bhLive...)
		runCycles(s, src, bhSymbols, 0, 36, nil)
		if !isHeld(s, "DEAD") || warn.count(bhHoldingMsg) != 1 {
			t.Errorf("positive control: want DEAD held with one holding WARN, got held=%v warns=%d", isHeld(s, "DEAD"), warn.count(bhHoldingMsg))
		}
	})
	t.Run("a held probe in a whole-empty cycle stays held", func(t *testing.T) {
		s, _, _ := newBarHoldService(bhDMs)
		src := newRecordingBarsSource(bhLive...)
		requireHeldAfterBackoff(t, s, src, bhSymbols, "DEAD", 0)
		runCycles(s, src, bhSymbols, 13, 12, func(int) { src.setBars() })
		requireRequested(t, src, "DEAD", 24, 24, true)
		requireNextProbe(t, s, "DEAD", bhEnd(24).Add(bhD))
	})
}

// @AC-3
func TestBarHold_PartialOutageNeverHolds(t *testing.T) {
	syms := []string{"A", "B", "C", "D"}
	for _, tc := range []struct {
		name string
		live []string
	}{
		{"one of four returns bars", []string{"A"}},
		{"exactly half is not informative", []string{"A", "B"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, _, _ := newBarHoldService(bhDMs)
			src := newRecordingBarsSource(tc.live...)
			runCycles(s, src, syms, 0, 36, nil)
			for _, sym := range syms {
				requireRequested(t, src, sym, 0, 35, true)
				if isHeld(s, sym) {
					t.Errorf("%s held during a partial outage", sym)
				}
			}
			if holdSymbols(s) != 0 {
				t.Errorf("non-informative cycles must leave no streak entries, got %d", holdSymbols(s))
			}
		})
	}
	t.Run("positive control: three of four holds D", func(t *testing.T) {
		s, _, _ := newBarHoldService(bhDMs)
		requireHeldAfterBackoff(t, s, newRecordingBarsSource("A", "B", "C"), syms, "D", 0)
	})
}

// @AC-5
func TestBarHold_FetchErrorsNotCounted(t *testing.T) {
	syms := []string{"AAA", "LIVE1", "LIVE2", "LIVE3", "DEAD"}
	vendorErr := errors.New("vendor 500")
	t.Run("errored fetches never create, advance or reset an entry", func(t *testing.T) {
		s, _, _ := newBarHoldService(bhDMs)
		src := newRecordingBarsSource(bhLive...)
		src.multiErr = errors.New("multi down")
		src.errs = map[string]error{"AAA": vendorErr}
		runCycles(s, src, syms, 0, 36, func(k int) {
			if _, ok := holdEntry(s, "AAA"); ok {
				t.Errorf("before cycle %d: errored AAA has a hold entry", k)
			}
			switch k {
			case 24:
				src.errs["DEAD"] = vendorErr
			case 25:
				delete(src.errs, "DEAD")
				requireNextProbe(t, s, "DEAD", bhEnd(24)) // errored probe left untouched: retried next cycle
			}
		})
		if _, ok := holdEntry(s, "AAA"); ok {
			t.Errorf("errored AAA has a hold entry")
		}
		requireRequested(t, src, "AAA", 0, 35, true)
		requireRequested(t, src, "DEAD", 24, 25, true)
		requireNextProbe(t, s, "DEAD", bhEnd(25).Add(bhD))
	})
	t.Run("positive control: AAA empty, not errored, is held", func(t *testing.T) {
		s, _, _ := newBarHoldService(bhDMs)
		src := newRecordingBarsSource(bhLive...)
		src.multiErr = errors.New("multi down")
		requireHeldAfterBackoff(t, s, src, syms, "AAA", 0)
	})
}

// @AC-1 @AC-4 — the zero-value service (nil budgetCfg = 6h default, nil maps) reaches hold and recovery.
func TestBarHold_ZeroValueServiceReachesHoldAndRecovery(t *testing.T) {
	store := &holdRecordingBarsStore{}
	s := &MarketDataService{barsStore: store}
	syms := []string{"LIVE1", "LIVE2", "DEAD"}
	src := newRecordingBarsSource("LIVE1", "LIVE2")

	runCycles(s, src, syms, 0, 72, nil)
	if isHeld(s, "DEAD") {
		t.Fatalf("DEAD held before the 6h default elapsed")
	}
	runCycles(s, src, syms, 72, 1, nil)
	requireNextProbe(t, s, "DEAD", bhEnd(144))
	runCycles(s, src, syms, 73, 71, nil)
	requireRequested(t, src, "DEAD", 73, 143, false)

	runCycles(s, src, syms, 144, 1, func(int) { src.setBars("LIVE1", "LIVE2", "DEAD") })
	if _, ok := holdEntry(s, "DEAD"); ok || store.countFor("DEAD") != 1 {
		t.Fatalf("want recovery at cycle 144 (entry cleared, 1 DEAD bar stored), got entry=%v stored=%d", ok, store.countFor("DEAD"))
	}
	runCycles(s, src, syms, 145, 6, nil)
	requireRequested(t, src, "DEAD", 144, 150, true)
}

// @AC-6 — characterization (not RED): the hold never evicts from the warm set.
func TestBarHold_HeldSymbolStaysWarm(t *testing.T) {
	s, _, _ := newBarHoldService(bhDMs)
	s.warmSymbols = map[string]struct{}{}
	for _, sym := range bhSymbols {
		s.markWarm(sym)
	}
	src := newRecordingBarsSource(bhLive...)
	for k := 0; k <= 12; k++ {
		runCycles(s, src, s.warmSnapshot(), k, 1, nil)
	}
	if !isHeld(s, "DEAD") {
		t.Fatalf("setup: DEAD not held at cycle 12")
	}
	s.markWarm("DEAD") // the exact call GetBars makes at its warm site
	if !slices.Contains(s.warmSnapshot(), "DEAD") {
		t.Fatalf("held DEAD left the warm set")
	}
	for k := 13; k <= 24; k++ {
		runCycles(s, src, s.warmSnapshot(), k, 1, nil)
	}
	requireRequested(t, src, "DEAD", 13, 13, false)
	requireRequested(t, src, "DEAD", 24, 24, true)
}

// @AC-7
func TestBarHold_EntryDroppedWhenSymbolLeavesList(t *testing.T) {
	s, _, _ := newBarHoldService(bhDMs)
	src := newRecordingBarsSource(bhLive...)
	requireHeldAfterBackoff(t, s, src, bhSymbols, "DEAD", 0)

	runCycles(s, src, bhLive, 13, 1, nil)
	if _, ok := holdEntry(s, "DEAD"); ok {
		t.Fatalf("DEAD's entry survived a cycle whose symbol list omitted it")
	}
	runCycles(s, src, bhSymbols, 14, 1, nil)
	requireRequested(t, src, "DEAD", 14, 14, true)
}

// @AC-8 @AC-10
func TestBarHold_DisabledAndLoneSymbol(t *testing.T) {
	for _, v := range []int64{0, -5} {
		t.Run(fmt.Sprintf("key %d disables and clears", v), func(t *testing.T) {
			s, cfg, _ := newBarHoldService(bhDMs)
			src := newRecordingBarsSource(bhLive...)
			requireHeldAfterBackoff(t, s, src, bhSymbols, "DEAD", 0)

			warn := installWarnRecorder(t)
			cfg.ints[bhKey] = v
			runCycles(s, src, bhSymbols, 13, 36, nil)
			for _, sym := range bhSymbols {
				requireRequested(t, src, sym, 13, 48, true)
			}
			if n := warn.count(bhHoldingMsg); n != 0 {
				t.Errorf("want no holding WARN while disabled, got %d", n)
			}
			s.warmMu.Lock()
			cleared := s.barHold == nil
			s.warmMu.Unlock()
			if !cleared {
				t.Errorf("want s.barHold nil while disabled")
			}
		})
	}
	t.Run("a lone dead symbol is never held", func(t *testing.T) {
		warn := installWarnRecorder(t)
		s, _, _ := newBarHoldService(bhDMs)
		src := newRecordingBarsSource()
		runCycles(s, src, []string{"DEAD"}, 0, 36, nil)
		requireRequested(t, src, "DEAD", 0, 35, true)
		if isHeld(s, "DEAD") || warn.count(bhHoldingMsg) != 0 || holdSymbols(s) != 0 {
			t.Errorf("lone DEAD must never be held or tracked")
		}
	})
	t.Run("positive control: DEAD with live peers is held", func(t *testing.T) {
		s, _, _ := newBarHoldService(bhDMs)
		requireHeldAfterBackoff(t, s, newRecordingBarsSource(bhLive...), bhSymbols, "DEAD", 0)
	})
}

// @AC-1 — accepted behaviour: a held symbol leaves active, so the informative ratio rises for the rest.
func TestBarHold_PositiveFeedbackLiftsRatio(t *testing.T) {
	t.Run("held DEAD leaves active and a second dark symbol becomes holdable", func(t *testing.T) {
		warn := installWarnRecorder(t)
		s, _, _ := newBarHoldService(bhDMs)
		src := newRecordingBarsSource(bhLive...)
		requireHeldAfterBackoff(t, s, src, bhSymbols, "DEAD", 0)

		dark := func(int) { src.setBars("LIVE1", "LIVE2") }
		runCycles(s, src, bhSymbols, 13, 12, dark)
		if isHeld(s, "LIVE3") {
			t.Fatalf("LIVE3 held before 1h of evidence")
		}
		runCycles(s, src, bhSymbols, 25, 1, dark)
		if !isHeld(s, "LIVE3") {
			t.Fatalf("want LIVE3 held at cycle 25: 2 of 3 active symbols is a strict majority once DEAD is held")
		}
		for _, r := range recsNamed(warn, bhNoBarsMsg) {
			if r.attrs["window_end"] == fmt.Sprint(bhEnd(13)) && r.attrs["total"] != "3" {
				t.Errorf("cycle 13 no-bars WARN: want total=3 (held DEAD not active), got %v", r.attrs)
			}
		}
	})
	t.Run("contrast: with DEAD still active the same outage is exactly half and never holds", func(t *testing.T) {
		s, _, _ := newBarHoldService(bhDMs)
		src := newRecordingBarsSource("LIVE1", "LIVE2")
		runCycles(s, src, bhSymbols, 0, 36, nil)
		if holdSymbols(s) != 0 {
			t.Errorf("2 of 4 hits is non-informative; want no entries, got %d", holdSymbols(s))
		}
	})
}

// @AC-11
func TestResolveBarIngestBackoff(t *testing.T) {
	snapshot := func(v int64) *config.Watcher {
		return config.NewSnapshotWatcher(map[string]*configv1.ConfigValue{bhKey: {Value: &configv1.ConfigValue_IntVal{IntVal: v}}})
	}
	for _, tc := range []struct {
		name string
		cfg  intGetter
		want time.Duration
	}{
		{"nil cfg uses the 6h default", nil, 6 * time.Hour},
		{"absent key uses the 6h default", &fakeCfg{}, 6 * time.Hour},
		{"stored 0 disables", &fakeCfg{ints: map[string]int64{bhKey: 0}}, 0},
		{"negative disables, never the default", &fakeCfg{ints: map[string]int64{bhKey: -5}}, 0},
		{"stored 1800000 is 30m", &fakeCfg{ints: map[string]int64{bhKey: 1800000}}, 30 * time.Minute},
		{"snapshot-built Watcher 1800000 is 30m", snapshot(1800000), 30 * time.Minute},
		{"snapshot-built Watcher stored 0 disables", snapshot(0), 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := resolveBarIngestBackoff(tc.cfg); got != tc.want {
				t.Errorf("resolveBarIngestBackoff = %v, want %v", got, tc.want)
			}
		})
	}
}

// @AC-12
func TestBarHold_ProbesOnlyRequestKeepsHold(t *testing.T) {
	t.Run("a probes-only request creates no entry and keeps the hold", func(t *testing.T) {
		warn := installWarnRecorder(t)
		s, _, _ := newBarHoldService(bhDMs)
		src := newRecordingBarsSource(bhLive...)
		requireHeldAfterBackoff(t, s, src, bhSymbols, "DEAD", 0)

		calls := src.multiCalls
		runCycles(s, src, []string{"DEAD"}, 13, 11, nil)
		if src.multiCalls != calls {
			t.Errorf("an empty request list must skip the vendor call, got %d calls", src.multiCalls-calls)
		}
		runCycles(s, src, []string{"DEAD"}, 24, 1, nil)
		if got := src.requested[24]; !slices.Equal(got, []string{"DEAD"}) {
			t.Errorf("cycle 24: want request [DEAD], got %v", got)
		}
		requireNextProbe(t, s, "DEAD", bhEnd(36))
		if holdSymbols(s) != 1 || warn.count(bhHoldingMsg) != 1 {
			t.Errorf("want only DEAD's entry and only the cycle-12 holding WARN, got %d entries, %d WARNs", holdSymbols(s), warn.count(bhHoldingMsg))
		}
	})
	t.Run("positive control: live peers present behave per AC-9", func(t *testing.T) {
		s, _, _ := newBarHoldService(bhDMs)
		src := newRecordingBarsSource(bhLive...)
		runCycles(s, src, bhSymbols, 0, 25, nil)
		requireNextProbe(t, s, "DEAD", bhEnd(36))
		if holdSymbols(s) != 1 {
			t.Errorf("want only DEAD's entry, got %d", holdSymbols(s))
		}
	})
}

// @AC-13
func TestBarHold_NonInformativeCycleResetsStreak(t *testing.T) {
	t.Run("a whole-empty cycle 8 discards the streak", func(t *testing.T) {
		s, _, _ := newBarHoldService(bhDMs)
		src := newRecordingBarsSource(bhLive...)
		weekendAt8 := func(k int) {
			if k == 8 {
				src.setBars()
			} else {
				src.setBars(bhLive...)
			}
		}
		runCycles(s, src, bhSymbols, 0, 13, weekendAt8)
		if isHeld(s, "DEAD") {
			t.Fatalf("DEAD held at cycle 12 on a streak the non-informative cycle 8 should have discarded")
		}
		runCycles(s, src, bhSymbols, 13, 8, weekendAt8)
		if isHeld(s, "DEAD") {
			t.Fatalf("DEAD held before cycle 21")
		}
		runCycles(s, src, bhSymbols, 21, 1, weekendAt8)
		if e, ok := holdEntry(s, "DEAD"); !ok || e.nextProbe.IsZero() || !e.emptySince.Equal(bhEnd(9)) {
			t.Fatalf("want DEAD first held at cycle 21 on a streak started at cycle 9, got %+v", e)
		}
		runCycles(s, src, bhSymbols, 22, 1, weekendAt8)
		requireRequested(t, src, "DEAD", 0, 21, true)
		requireRequested(t, src, "DEAD", 22, 22, false)
	})
	t.Run("positive control: without cycle 8 DEAD is held at cycle 12", func(t *testing.T) {
		s, _, _ := newBarHoldService(bhDMs)
		requireHeldAfterBackoff(t, s, newRecordingBarsSource(bhLive...), bhSymbols, "DEAD", 0)
	})
}

// @AC-14
func TestBarHold_StreakGapRestartsStreak(t *testing.T) {
	pausedRun := func(pause time.Duration) (*MarketDataService, *recordingBarsSource, int) {
		s, _, _ := newBarHoldService(bhDMs)
		src := newRecordingBarsSource(bhLive...)
		runCycles(s, src, bhSymbols, 0, 6, nil)
		return s, src, 5 + int(pause/bhCycle)
	}
	t.Run("a 49h pause (wider than the 48h window) restarts the streak", func(t *testing.T) {
		s, src, resume := pausedRun(49 * time.Hour)
		runCycles(s, src, bhSymbols, resume, 12, nil)
		if isHeld(s, "DEAD") {
			t.Fatalf("DEAD held on the stale pre-pause streak")
		}
		if e, _ := holdEntry(s, "DEAD"); !e.emptySince.Equal(bhEnd(resume)) {
			t.Fatalf("want the streak restarted at the first resumed cycle, emptySince=%v", e.emptySince)
		}
		runCycles(s, src, bhSymbols, resume+12, 1, nil)
		if !isHeld(s, "DEAD") {
			t.Fatalf("want DEAD held 12 cycles after the resume")
		}
	})
	t.Run("positive control: a 30h pause continues the streak", func(t *testing.T) {
		s, src, resume := pausedRun(30 * time.Hour)
		runCycles(s, src, bhSymbols, resume, 1, nil)
		if e, ok := holdEntry(s, "DEAD"); !ok || e.nextProbe.IsZero() || !e.emptySince.Equal(bhEnd(0)) {
			t.Fatalf("want DEAD held at the first resumed cycle on the original streak, got %+v", e)
		}
	})
}
