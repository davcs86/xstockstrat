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

	"google.golang.org/grpc/metadata"

	marketdatav1 "github.com/xstockstrat/contracts/gen/go/marketdata/v1"
	"github.com/xstockstrat/marketdata/internal/fmp"
	"github.com/xstockstrat/marketdata/internal/middleware"
)

// fakeEtfSource counts FetchIsEtf calls and answers from a per-symbol table.
type fakeEtfSource struct {
	mu    sync.Mutex
	calls map[string]int
	resp  map[string]*bool
	err   error
}

func (f *fakeEtfSource) FetchIsEtf(_ context.Context, symbol string) (*bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.calls == nil {
		f.calls = map[string]int{}
	}
	f.calls[symbol]++
	if f.err != nil {
		return nil, f.err
	}
	return f.resp[symbol], nil
}

func (f *fakeEtfSource) total() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := 0
	for _, c := range f.calls {
		n += c
	}
	return n
}

func boolp(b bool) *bool { return &b }

type etfClock struct{ t time.Time }

func (c *etfClock) now() time.Time { return c.t }

func newEtfSvc(src *fakeEtfSource, budget fmpBudget, fmpOn bool) (*MarketDataService, *etfClock) {
	clk := &etfClock{t: time.Date(2026, 10, 11, 0, 0, 0, 0, time.UTC)}
	svc := &MarketDataService{
		fundCfg:   &fakeCfg{bools: map[string]bool{"marketdata.fmp.enabled": fmpOn}},
		fmpBudget: budget,
	}
	svc.SetEtfFlagSource(src)
	svc.etf.now = clk.now
	return svc, clk
}

func etfFlags(t *testing.T, svc *MarketDataService, symbols ...string) []*marketdatav1.EtfFlag {
	t.Helper()
	resp, err := svc.GetEtfFlags(context.Background(), &marketdatav1.GetEtfFlagsRequest{Symbols: symbols})
	if err != nil {
		t.Fatalf("GetEtfFlags: %v", err)
	}
	return resp.GetFlags()
}

// (a) A miss is unset, never calls the source, and enqueues exactly once.
func TestGetEtfFlags_MissIsCacheOnlyAndEnqueuesOnce(t *testing.T) {
	src := &fakeEtfSource{}
	svc, _ := newEtfSvc(src, fakeBudget{used: 0, cap: 100}, true)

	flags := etfFlags(t, svc, " schd ")
	if len(flags) != 1 || flags[0].GetSymbol() != "SCHD" || flags[0].IsEtf != nil {
		t.Fatalf("flags = %+v, want one unset SCHD flag", flags)
	}
	etfFlags(t, svc, "SCHD")
	if src.total() != 0 {
		t.Fatalf("source calls = %d, want 0 (GetEtfFlags is cache-only)", src.total())
	}
	if n := len(svc.etf.queue); n != 1 {
		t.Fatalf("queue len = %d, want 1 (deduped enqueue)", n)
	}
}

// (b) A full queue drops the symbol without blocking (and does not mark it pending).
func TestGetEtfFlags_FullQueueDrops(t *testing.T) {
	svc, _ := newEtfSvc(&fakeEtfSource{}, fakeBudget{cap: 100}, true)
	for i := 0; i < etfFlagQueueCap; i++ {
		etfFlags(t, svc, fmt.Sprintf("S%d", i))
	}
	done := make(chan struct{})
	go func() {
		etfFlags(t, svc, "OVERFLOW")
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("GetEtfFlags blocked on a full queue")
	}
	if n := len(svc.etf.queue); n != etfFlagQueueCap {
		t.Fatalf("queue len = %d, want %d", n, etfFlagQueueCap)
	}
	svc.etf.mu.Lock()
	_, pending := svc.etf.pending["OVERFLOW"]
	svc.etf.mu.Unlock()
	if pending {
		t.Fatal("dropped symbol must not stay pending (it could never be retried)")
	}
}

// (c) @AC-14: the filler never spends the last 20% of the shared FMP budget, an uncapped/zero budget,
// or a disabled FMP gate; it fetches below 80%.
func TestEtfFlagFiller_HeadroomGate_AC14(t *testing.T) {
	cases := []struct {
		name      string
		budget    fmpBudget
		fmpOn     bool
		wantCalls int
	}{
		{"at 80% of cap", fakeBudget{used: 80, cap: 100}, true, 0},
		{"zero cap is zero budget", fakeBudget{used: 0, cap: 0}, true, 0},
		{"fmp disabled", fakeBudget{used: 0, cap: 100}, false, 0},
		{"no budget wired", nil, true, 0},
		{"below 80%", fakeBudget{used: 79, cap: 100}, true, 1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			src := &fakeEtfSource{resp: map[string]*bool{"SCHD": boolp(true)}}
			svc, _ := newEtfSvc(src, tc.budget, tc.fmpOn)
			etfFlags(t, svc, "SCHD")
			svc.fillEtfFlag(context.Background(), <-svc.etf.queue)
			if got := src.total(); got != tc.wantCalls {
				t.Fatalf("source calls = %d, want %d", got, tc.wantCalls)
			}
			svc.etf.mu.Lock()
			_, pending := svc.etf.pending["SCHD"]
			svc.etf.mu.Unlock()
			if pending {
				t.Fatal("pending not cleared after the fill attempt")
			}
		})
	}
}

// (d) A cached flag is served for < 30 days with no re-fetch, then re-queued after the TTL.
func TestGetEtfFlags_TTL(t *testing.T) {
	src := &fakeEtfSource{resp: map[string]*bool{"SCHD": boolp(true), "AAPL": boolp(false)}}
	svc, clk := newEtfSvc(src, fakeBudget{cap: 100}, true)
	etfFlags(t, svc, "SCHD", "AAPL")
	for len(svc.etf.queue) > 0 {
		svc.fillEtfFlag(context.Background(), <-svc.etf.queue)
	}

	clk.t = clk.t.Add(etfFlagTTL - time.Hour)
	flags := etfFlags(t, svc, "SCHD", "AAPL")
	if flags[0].IsEtf == nil || !flags[0].GetIsEtf() || flags[1].IsEtf == nil || flags[1].GetIsEtf() {
		t.Fatalf("flags = %+v, want SCHD=true AAPL=false", flags)
	}
	if len(svc.etf.queue) != 0 || src.total() != 2 {
		t.Fatalf("fresh hit re-queued (len %d) or re-fetched (calls %d)", len(svc.etf.queue), src.total())
	}

	clk.t = clk.t.Add(2 * time.Hour)
	flags = etfFlags(t, svc, "SCHD")
	if flags[0].IsEtf != nil {
		t.Fatalf("expired entry served: %+v", flags[0])
	}
	if len(svc.etf.queue) != 1 {
		t.Fatalf("expired entry not re-queued (len %d)", len(svc.etf.queue))
	}
}

// (e) An empty profile is negative-cached: unset, and not re-fetched within the TTL.
func TestGetEtfFlags_EmptyProfileNegativeCached(t *testing.T) {
	src := &fakeEtfSource{resp: map[string]*bool{}}
	svc, clk := newEtfSvc(src, fakeBudget{cap: 100}, true)
	etfFlags(t, svc, "NOPROF")
	svc.fillEtfFlag(context.Background(), <-svc.etf.queue)

	clk.t = clk.t.Add(24 * time.Hour)
	flags := etfFlags(t, svc, "NOPROF")
	if flags[0].IsEtf != nil {
		t.Fatalf("empty profile must stay unset, got %v", flags[0].GetIsEtf())
	}
	if len(svc.etf.queue) != 0 || src.total() != 1 {
		t.Fatalf("negative cache not honoured: queue %d, calls %d", len(svc.etf.queue), src.total())
	}
}

// (f) A source error is not cached; the symbol is re-queued on the next read.
func TestEtfFlagFiller_ErrorNotCached(t *testing.T) {
	src := &fakeEtfSource{err: errors.New("fmp: /stable/profile returned HTTP 503")}
	svc, _ := newEtfSvc(src, fakeBudget{cap: 100}, true)
	etfFlags(t, svc, "SCHD")
	svc.fillEtfFlag(context.Background(), <-svc.etf.queue)

	svc.etf.mu.Lock()
	_, cached := svc.etf.entries["SCHD"]
	svc.etf.mu.Unlock()
	if cached {
		t.Fatal("source error was cached")
	}
	etfFlags(t, svc, "SCHD")
	if len(svc.etf.queue) != 1 {
		t.Fatalf("errored symbol not re-queued (len %d)", len(svc.etf.queue))
	}
}

// (g) At the size bound the oldest entry is evicted before inserting.
func TestEtfFlagFiller_EvictsOldestAtBound(t *testing.T) {
	src := &fakeEtfSource{resp: map[string]*bool{"NEW": boolp(true)}}
	svc, clk := newEtfSvc(src, fakeBudget{cap: 100}, true)
	svc.etf.mu.Lock()
	for i := 0; i < etfFlagCacheMax; i++ {
		svc.etf.entries[fmt.Sprintf("S%d", i)] = etfFlagEntry{fetchedAt: clk.t.Add(time.Duration(i+1) * time.Second)}
	}
	svc.etf.entries["OLDEST"] = etfFlagEntry{fetchedAt: clk.t}
	delete(svc.etf.entries, "S0")
	svc.etf.mu.Unlock()

	svc.fillEtfFlag(context.Background(), etfFillItem{sym: "NEW"})

	svc.etf.mu.Lock()
	defer svc.etf.mu.Unlock()
	if len(svc.etf.entries) != etfFlagCacheMax {
		t.Fatalf("entries = %d, want %d", len(svc.etf.entries), etfFlagCacheMax)
	}
	if _, ok := svc.etf.entries["OLDEST"]; ok {
		t.Fatal("oldest entry not evicted")
	}
	if _, ok := svc.etf.entries["NEW"]; !ok {
		t.Fatal("new entry not inserted")
	}
}

// (h) Concurrent GetEtfFlags + the running filler are race-free (run under -race).
func TestEtfFlags_ConcurrentReadersAndFiller(t *testing.T) {
	src := &fakeEtfSource{resp: map[string]*bool{"A": boolp(true), "B": boolp(false)}}
	svc, _ := newEtfSvc(src, fakeBudget{cap: 1000}, true)
	ctx, cancel := context.WithCancel(context.Background())
	stopped := make(chan struct{})
	go func() {
		svc.StartEtfFlagFiller(ctx)
		close(stopped)
	}()
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			for j := 0; j < 50; j++ {
				etfFlags(t, svc, "A", "B", fmt.Sprintf("C%d", (i+j)%5))
			}
		}(i)
	}
	wg.Wait()
	cancel()
	select {
	case <-stopped:
	case <-time.After(2 * time.Second):
		t.Fatal("filler did not stop on ctx.Done()")
	}
}

// ── feature 230: fill visibility (Info records, rate-limited, trace-carrying) ────

func etfInfo(t *testing.T) *recordingLogHandler {
	t.Helper()
	return installLogRecorder(t, slog.LevelInfo)
}

// noSecret fails when any record's msg or attribute value carries the API key (a *url.Error leaks apikey=).
func noSecret(t *testing.T, rec *recordingLogHandler) {
	t.Helper()
	rec.mu.Lock()
	defer rec.mu.Unlock()
	for _, r := range rec.recs {
		vals := []string{r.msg}
		for _, v := range r.attrs {
			vals = append(vals, v)
		}
		for _, v := range vals {
			if strings.Contains(v, "apikey=") || strings.Contains(v, "SECRET") {
				t.Fatalf("record leaks secret material: %q %v", r.msg, r.attrs)
			}
		}
	}
}

func etfDrain(svc *MarketDataService) {
	for len(svc.etf.queue) > 0 {
		svc.fillEtfFlag(context.Background(), <-svc.etf.queue)
	}
}

// @AC-3: a closed gate is skipped at Info with its reason; used/cap only when the budget was read.
func TestEtfFlagFiller_SkipReasonLogged_AC3(t *testing.T) {
	cases := []struct {
		reason    string
		budget    fmpBudget
		fmpOn     bool
		used, cap string
	}{
		{"fmp_disabled", fakeBudget{used: 0, cap: 100}, false, "", ""},
		{"no_cap", fakeBudget{used: 0, cap: 0}, true, "0", "0"},
		{"budget", fakeBudget{used: 80, cap: 100}, true, "80", "100"},
		{"not_wired", nil, true, "", ""},
	}
	for _, tc := range cases {
		t.Run(tc.reason, func(t *testing.T) {
			rec := etfInfo(t)
			src := &fakeEtfSource{resp: map[string]*bool{"SCHD": boolp(true)}}
			svc, _ := newEtfSvc(src, tc.budget, tc.fmpOn)
			etfFlags(t, svc, "SCHD")
			svc.fillEtfFlag(context.Background(), <-svc.etf.queue)

			if n := rec.count("etf flag fill skipped"); n != 1 {
				t.Fatalf("@AC-3: skipped records = %d, want 1 (%v)", n, rec.recs)
			}
			r := rec.find("etf flag fill skipped")
			if r.attrs["symbol"] != "SCHD" || r.attrs["reason"] != tc.reason {
				t.Fatalf("@AC-3: attrs = %v, want symbol=SCHD reason=%s", r.attrs, tc.reason)
			}
			used, hasUsed := r.attrs["used"]
			capV, hasCap := r.attrs["cap"]
			if wantSnap := tc.used != ""; hasUsed != wantSnap || hasCap != wantSnap || used != tc.used || capV != tc.cap {
				t.Fatalf("@AC-3: used/cap = %q/%q (present %v/%v), want %q/%q", used, capV, hasUsed, hasCap, tc.used, tc.cap)
			}
			if src.total() != 0 {
				t.Fatalf("@AC-3: source calls = %d, want 0", src.total())
			}
			svc.etf.mu.Lock()
			_, pending := svc.etf.pending["SCHD"]
			svc.etf.mu.Unlock()
			if pending {
				t.Fatal("@AC-3: pending not cleared")
			}
		})
	}
}

// @AC-5: a failed fill logs only the error class, never the error text, and is not cached.
func TestEtfFlagFiller_FailLogsClassOnly_AC5(t *testing.T) {
	cases := []struct {
		class string
		err   error
	}{
		{"ctx", fmt.Errorf("fmp: /stable/profile?apikey=SECRET: %w", context.DeadlineExceeded)},
		{"cap", fmt.Errorf("fmp: /stable/profile?apikey=SECRET: %w", fmp.ErrFMPDailyCapExceeded)},
		{"other", errors.New("fmp: /stable/profile?apikey=SECRET build request")},
	}
	for _, tc := range cases {
		t.Run(tc.class, func(t *testing.T) {
			rec := etfInfo(t)
			src := &fakeEtfSource{err: tc.err}
			svc, _ := newEtfSvc(src, fakeBudget{cap: 100}, true)
			etfFlags(t, svc, "SCHD")
			svc.fillEtfFlag(context.Background(), <-svc.etf.queue)

			if n := rec.count("etf flag fill failed"); n != 1 {
				t.Fatalf("@AC-5: failed records = %d, want 1 (%v)", n, rec.recs)
			}
			r := rec.find("etf flag fill failed")
			if r.attrs["symbol"] != "SCHD" || r.attrs["class"] != tc.class || r.attrs["class"] == "" {
				t.Fatalf("@AC-5: attrs = %v, want symbol=SCHD class=%s", r.attrs, tc.class)
			}
			if _, ok := r.attrs["error"]; ok {
				t.Fatalf("@AC-5: error attribute present: %v", r.attrs)
			}
			noSecret(t, rec)
			svc.etf.mu.Lock()
			_, cached := svc.etf.entries["SCHD"]
			svc.etf.mu.Unlock()
			if cached {
				t.Fatal("@AC-5: failed fill was cached")
			}
			etfFlags(t, svc, "SCHD")
			if len(svc.etf.queue) != 1 || src.total() != 1 {
				t.Fatalf("@AC-5: not re-queued (len %d) or extra fetch (calls %d)", len(svc.etf.queue), src.total())
			}
		})
	}
}

// @AC-4: an empty profile logs an unlabelled record (symbol only) and stays negative-cached.
func TestEtfFlagFiller_UnlabelledLogged_AC4(t *testing.T) {
	rec := etfInfo(t)
	src := &fakeEtfSource{resp: map[string]*bool{}}
	svc, clk := newEtfSvc(src, fakeBudget{cap: 100}, true)
	etfFlags(t, svc, "NOPROF")
	svc.fillEtfFlag(context.Background(), <-svc.etf.queue)

	if n := rec.count("etf flag fill unlabelled"); n != 1 {
		t.Fatalf("@AC-4: unlabelled records = %d, want 1 (%v)", n, rec.recs)
	}
	r := rec.find("etf flag fill unlabelled")
	if len(r.attrs) != 1 || r.attrs["symbol"] != "NOPROF" {
		t.Fatalf("@AC-4: attrs = %v, want exactly {symbol: NOPROF}", r.attrs)
	}

	// The window checks run before the 24h advance, which would itself close the window.
	etfFlags(t, svc, "NOPROF2")
	etfDrain(svc)
	if n := rec.count("etf flag fill unlabelled"); n != 1 {
		t.Fatalf("@AC-4: unlabelled records inside the window = %d, want 1", n)
	}
	clk.t = clk.t.Add(etfFlagLogEvery)
	etfFlags(t, svc, "NOPROF3")
	etfDrain(svc)
	if n := rec.count("etf flag fill unlabelled"); n != 2 {
		t.Fatalf("@AC-4: unlabelled records after the window = %d, want 2", n)
	}

	clk.t = clk.t.Add(24 * time.Hour)
	flags := etfFlags(t, svc, "NOPROF")
	if flags[0].IsEtf != nil || len(svc.etf.queue) != 0 || src.total() != 3 {
		t.Fatalf("@AC-4: negative cache lost: flag %v, queue %d, calls %d", flags[0].IsEtf, len(svc.etf.queue), src.total())
	}
}

// @AC-6: each log slot (skip reason, fail class, unlabelled) is rate-limited independently.
func TestEtfFlagFiller_RateLimitSlots_AC6(t *testing.T) {
	closed := fakeBudget{used: 80, cap: 100}
	open := fakeBudget{used: 0, cap: 100}
	fill := func(t *testing.T, svc *MarketDataService, sym string) {
		t.Helper()
		etfFlags(t, svc, sym)
		etfDrain(svc)
	}
	setFMP := func(svc *MarketDataService, on bool) {
		svc.fundCfg = &fakeCfg{bools: map[string]bool{"marketdata.fmp.enabled": on}}
	}
	setErr := func(src *fakeEtfSource, err error) {
		src.mu.Lock()
		src.err = err
		src.mu.Unlock()
	}

	t.Run("5 budget skips log once", func(t *testing.T) {
		rec := etfInfo(t)
		src := &fakeEtfSource{}
		svc, _ := newEtfSvc(src, closed, true)
		for i := 0; i < 5; i++ {
			fill(t, svc, fmt.Sprintf("B%d", i))
		}
		if n := rec.count("etf flag fill skipped"); n != 1 || src.total() != 0 {
			t.Fatalf("@AC-6: skipped = %d (calls %d), want 1 (0)", n, src.total())
		}
	})

	t.Run("budget logs again after the window", func(t *testing.T) {
		rec := etfInfo(t)
		src := &fakeEtfSource{}
		svc, clk := newEtfSvc(src, closed, true)
		for i := 0; i < 5; i++ {
			fill(t, svc, fmt.Sprintf("B%d", i))
		}
		clk.t = clk.t.Add(etfFlagLogEvery)
		fill(t, svc, "B5")
		if n := rec.count("etf flag fill skipped"); n != 2 || src.total() != 0 {
			t.Fatalf("@AC-6: skipped = %d (calls %d), want 2 (0)", n, src.total())
		}
	})

	t.Run("a config reason logs on change only", func(t *testing.T) {
		rec := etfInfo(t)
		src := &fakeEtfSource{}
		svc, clk := newEtfSvc(src, open, false)
		for i := 0; i < 5; i++ {
			fill(t, svc, fmt.Sprintf("D%d", i))
			clk.t = clk.t.Add(time.Minute)
		}
		if n := rec.count("etf flag fill skipped"); n != 1 || src.total() != 0 {
			t.Fatalf("@AC-6: skipped = %d (calls %d), want 1 (0)", n, src.total())
		}
	})

	t.Run("each reason change logs", func(t *testing.T) {
		rec := etfInfo(t)
		src := &fakeEtfSource{}
		svc, _ := newEtfSvc(src, closed, false)
		fill(t, svc, "R1")
		setFMP(svc, true)
		fill(t, svc, "R2")
		setFMP(svc, false)
		fill(t, svc, "R3")
		if n := rec.count("etf flag fill skipped"); n != 3 || src.total() != 0 {
			t.Fatalf("@AC-6: skipped = %d (calls %d), want 3 (0)", n, src.total())
		}
	})

	t.Run("an open gate clears the last skip reason", func(t *testing.T) {
		rec := etfInfo(t)
		src := &fakeEtfSource{resp: map[string]*bool{"OK": boolp(true)}}
		svc, _ := newEtfSvc(src, closed, true)
		fill(t, svc, "G1")
		svc.fmpBudget = open
		fill(t, svc, "OK")
		svc.fmpBudget = closed
		fill(t, svc, "G2")
		if n := rec.count("etf flag fill skipped"); n != 2 || src.total() != 1 {
			t.Fatalf("@AC-6: skipped = %d (calls %d), want 2 (1)", n, src.total())
		}
	})

	t.Run("fail slots are per class", func(t *testing.T) {
		rec := etfInfo(t)
		src := &fakeEtfSource{err: fmt.Errorf("fmp: /stable/profile: %w", context.DeadlineExceeded)}
		svc, _ := newEtfSvc(src, open, true)
		fill(t, svc, "F1")
		fill(t, svc, "F2")
		setErr(src, fmt.Errorf("fmp: /stable/profile: %w", fmp.ErrFMPDailyCapExceeded))
		fill(t, svc, "F3")
		if n := rec.count("etf flag fill failed"); n != 2 || src.total() != 3 {
			t.Fatalf("@AC-6: failed = %d (calls %d), want 2 (3)", n, src.total())
		}
	})

	t.Run("slots are independent", func(t *testing.T) {
		rec := etfInfo(t)
		src := &fakeEtfSource{resp: map[string]*bool{}}
		svc, _ := newEtfSvc(src, closed, true)
		fill(t, svc, "I1")
		svc.fmpBudget = open
		setErr(src, fmt.Errorf("fmp: /stable/profile: %w", context.DeadlineExceeded))
		fill(t, svc, "I2")
		setErr(src, nil)
		fill(t, svc, "I3")
		skipped, failed, unlabelled := rec.count("etf flag fill skipped"), rec.count("etf flag fill failed"), rec.count("etf flag fill unlabelled")
		if skipped != 1 || failed != 1 || unlabelled != 1 || src.total() != 2 {
			t.Fatalf("@AC-6: skipped/failed/unlabelled = %d/%d/%d (calls %d), want 1/1/1 (2)", skipped, failed, unlabelled, src.total())
		}
	})
}

// @AC-7: the fill record carries the enqueuing request's trace id, and omits the key when there is none.
func TestEtfFlagFiller_CarriesTraceID_AC7(t *testing.T) {
	rec := etfInfo(t)
	svc, _ := newEtfSvc(&fakeEtfSource{}, fakeBudget{used: 80, cap: 100}, true)
	incoming := metadata.NewIncomingContext(context.Background(), metadata.Pairs("x-trace-id", "t-1"))
	var serverCtx context.Context
	_, _ = middleware.UnaryServerInterceptor(incoming, nil, nil, func(c context.Context, _ interface{}) (interface{}, error) {
		serverCtx = c
		return nil, nil
	})
	if _, err := svc.GetEtfFlags(serverCtx, &marketdatav1.GetEtfFlagsRequest{Symbols: []string{"SCHD"}}); err != nil {
		t.Fatalf("GetEtfFlags: %v", err)
	}
	svc.fillEtfFlag(context.Background(), <-svc.etf.queue)
	if r := rec.find("etf flag fill skipped"); r == nil || r.attrs["trace_id"] != "t-1" {
		t.Fatalf("@AC-7: skipped record = %v, want trace_id=t-1", r)
	}

	rec2 := etfInfo(t)
	svc2, _ := newEtfSvc(&fakeEtfSource{}, fakeBudget{used: 80, cap: 100}, true)
	etfFlags(t, svc2, "SCHD")
	svc2.fillEtfFlag(context.Background(), <-svc2.etf.queue)
	r2 := rec2.find("etf flag fill skipped")
	if r2 == nil {
		t.Fatalf("@AC-7: no skipped record (%v)", rec2.recs)
	}
	if _, ok := r2.attrs["trace_id"]; ok {
		t.Fatalf("@AC-7: trace_id present without a trace: %v", r2.attrs)
	}
}
