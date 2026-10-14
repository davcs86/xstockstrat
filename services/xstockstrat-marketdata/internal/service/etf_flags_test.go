package service

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	marketdatav1 "github.com/xstockstrat/contracts/gen/go/marketdata/v1"
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

	svc.fillEtfFlag(context.Background(), "NEW")

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
