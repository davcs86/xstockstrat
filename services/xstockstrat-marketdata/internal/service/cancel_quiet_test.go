package service

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"strings"
	"testing"

	marketdatav1 "github.com/xstockstrat/contracts/gen/go/marketdata/v1"
)

// Feature 317 @AC-1: a cancel-caused failure logs Debug with ctx_done, never WARN; a live ctx still WARNs.
// slog.SetDefault is process-global: no t.Parallel().

const (
	cqLiveFetchMsg = "GetBars: live fetch failed"
	cqInsertMsg    = "bar ingest: insert failed"
)

// cqCount counts records at level with message msg (and, when attr is set, attrs[attr] == value).
func cqCount(h *warmLogRecorder, level slog.Level, msg, attr, value string) int {
	h.mu.Lock()
	defer h.mu.Unlock()
	n := 0
	for _, r := range h.recs {
		if r.level == level && r.msg == msg && (attr == "" || r.attrs[attr] == value) {
			n++
		}
	}
	return n
}

func cqTotal(h *warmLogRecorder) int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.recs)
}

func TestFetchAndCacheBars_AC1_CanceledLiveFetchLogsNoWarn(t *testing.T) {
	rec := installWarmLogRecorder(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	svc := cacheBarsSvc(&barsCancelSource{fakeBackfillSource: &fakeBackfillSource{}, cancel: cancel, err: context.Canceled}, &recordingBarsStore{})

	got := fetchAAPLDaily(ctx, svc)

	if n := cqCount(rec, slog.LevelWarn, cqLiveFetchMsg, "", ""); n != 0 {
		t.Errorf("@AC-1: %d WARN %q records for a client-cancelled fetch, want 0", n, cqLiveFetchMsg)
	}
	if n := cqCount(rec, slog.LevelDebug, cqLiveFetchMsg, "ctx_done", "true"); n != 1 {
		t.Errorf("@AC-1: %d Debug %q records with ctx_done=true, want 1", n, cqLiveFetchMsg)
	}
	if len(got.bars) != 0 {
		t.Errorf("@AC-1: %d bars returned for a failed fetch, want 0", len(got.bars))
	}
}

func TestFetchAndCacheBars_AC1_LiveCtxFetchErrorStillWarns(t *testing.T) {
	rec := installWarnRecorder(t)
	svc := cacheBarsSvc(&barsCancelSource{fakeBackfillSource: &fakeBackfillSource{}, err: errors.New("alpaca: 500")}, &recordingBarsStore{})

	fetchAAPLDaily(context.Background(), svc)

	if n := rec.count(cqLiveFetchMsg); n != 1 {
		t.Fatalf("@AC-1 control: %d WARN %q records on a live ctx, want 1", n, cqLiveFetchMsg)
	}
	if sym := rec.find(cqLiveFetchMsg).attrs["symbol"]; sym != "AAPL" {
		t.Errorf("@AC-1 control: WARN symbol = %q, want AAPL", sym)
	}
}

// The helper keys on ctx state, not on the error text: context.Canceled on a live ctx is genuine.
func TestFetchAndCacheBars_AC1_LiveCtxCanceledErrorStillWarns(t *testing.T) {
	rec := installWarnRecorder(t)
	svc := cacheBarsSvc(&barsCancelSource{fakeBackfillSource: &fakeBackfillSource{}, err: context.Canceled}, &recordingBarsStore{})

	fetchAAPLDaily(context.Background(), svc)

	if n := rec.count(cqLiveFetchMsg); n != 1 {
		t.Fatalf("@AC-1 control: %d WARN %q records for context.Canceled on a live ctx, want 1", n, cqLiveFetchMsg)
	}
}

func TestWarnUnlessDone(t *testing.T) {
	const msg = "cancel quiet probe"

	t.Run("live ctx warns", func(t *testing.T) {
		rec := installWarmLogRecorder(t)
		warnUnlessDone(context.Background(), msg, "symbol", "AAPL")
		if n := cqCount(rec, slog.LevelWarn, msg, "symbol", "AAPL"); n != 1 {
			t.Fatalf("%d WARN records with symbol=AAPL, want 1", n)
		}
		if n := cqCount(rec, slog.LevelWarn, msg, "ctx_done", "true"); n != 0 {
			t.Errorf("live-ctx WARN carries ctx_done")
		}
		if n := cqTotal(rec); n != 1 {
			t.Errorf("%d records, want 1", n)
		}
	})

	t.Run("done ctx logs debug", func(t *testing.T) {
		rec := installWarmLogRecorder(t)
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		warnUnlessDone(ctx, msg, "symbol", "AAPL")
		if n := cqCount(rec, slog.LevelWarn, msg, "", ""); n != 0 {
			t.Errorf("%d WARN records on a done ctx, want 0", n)
		}
		if n := cqCount(rec, slog.LevelDebug, msg, "symbol", "AAPL"); n != 1 {
			t.Fatalf("%d Debug records with symbol=AAPL, want 1", n)
		}
		if n := cqCount(rec, slog.LevelDebug, msg, "ctx_done", "true"); n != 1 {
			t.Errorf("%d Debug records with ctx_done=true, want 1", n)
		}
	})
}

func TestIngestRecentBarsForTimeframe_DoneCtxReturnsBeforeFetch(t *testing.T) {
	rec := installWarmLogRecorder(t)
	src := newRecordingBarsSource(bhLive...)
	svc, _, _ := newBarHoldService(bhDMs)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	src.beginCycle(0)
	end := bhEnd(0)
	svc.ingestRecentBarsForTimeframe(ctx, context.Background(), src, bhSymbols, bhTF, end.Add(-bhWindow), end)

	if src.multiCalls != 0 || len(src.requested[0]) != 0 {
		t.Errorf("vendor calls on a done process ctx: multi = %d, requested = %v", src.multiCalls, src.requested[0])
	}
	if n := cqTotal(rec); n != 0 {
		t.Errorf("%d log records on a done process ctx, want 0", n)
	}
	for _, sym := range bhSymbols {
		if _, ok := holdEntry(svc, sym); ok {
			t.Errorf("hold entry recorded for %s on a done process ctx", sym)
		}
	}
}

// cancelingInsertStore cancels the process ctx inside InsertBars and fails the write (a shutdown mid-cycle).
type cancelingInsertStore struct {
	fakeBarsStore
	cancel context.CancelFunc
}

func (s *cancelingInsertStore) InsertBars(context.Context, []*marketdatav1.Bar) error {
	s.cancel()
	return context.Canceled
}

func TestIngestRecentBarsForTimeframe_CancelMidCycleQuietsInsertWarn(t *testing.T) {
	rec := installWarmLogRecorder(t)
	src := newRecordingBarsSource(bhLive...)
	svc, _, _ := newBarHoldService(bhDMs)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	svc.barsStore = &cancelingInsertStore{cancel: cancel}

	src.beginCycle(0)
	end := bhEnd(0)
	svc.ingestRecentBarsForTimeframe(ctx, context.Background(), src, bhSymbols, bhTF, end.Add(-bhWindow), end)

	if n := cqCount(rec, slog.LevelWarn, cqInsertMsg, "", ""); n != 0 {
		t.Errorf("%d WARN %q records after the process ctx was cancelled, want 0", n, cqInsertMsg)
	}
	if n := cqCount(rec, slog.LevelDebug, cqInsertMsg, "ctx_done", "true"); n < 1 {
		t.Errorf("no Debug %q record with ctx_done=true", cqInsertMsg)
	}
	if n := f347CountLogs(rec, bhHeartbeatMsg, "", ""); n != 0 {
		t.Errorf("%d %q records after a mid-cycle cancel, want 0 (applyBarCycle/reportIngestCycle skipped)", n, bhHeartbeatMsg)
	}
}

func TestIngestRecentBarsForTimeframe_LiveCtxInsertFailureStillWarns(t *testing.T) {
	rec := installWarmLogRecorder(t)
	src := newRecordingBarsSource(bhLive...)
	svc, _, _ := newBarHoldService(bhDMs)
	svc.barsStore = &recordingBarsStore{err: errors.New("insert: unique violation")}

	src.beginCycle(0)
	end := bhEnd(0)
	svc.ingestRecentBarsForTimeframe(context.Background(), context.Background(), src, bhSymbols, bhTF, end.Add(-bhWindow), end)

	if n := cqCount(rec, slog.LevelWarn, cqInsertMsg, "", ""); n != len(bhLive) {
		t.Errorf("%d WARN %q records on a live ctx, want %d", n, cqInsertMsg, len(bhLive))
	}
	if n := f347CountLogs(rec, bhHeartbeatMsg, "", ""); n != 1 {
		t.Errorf("%d %q records on a live ctx, want 1", n, bhHeartbeatMsg)
	}
}

// Structural: GetLatestQuote and the two re-reads go through the concrete *repository.MarketDataRepo, so
// they have no behavioural seam.
func TestCancelQuietSites_Structural(t *testing.T) {
	raw, err := os.ReadFile("marketdata_service.go")
	if err != nil {
		t.Fatalf("read source: %v", err)
	}
	src := string(raw)
	check := func(sig, needle string, want int) {
		t.Helper()
		if n := strings.Count(funcBody(t, src, sig), needle); n != want {
			t.Errorf("%s: %d occurrences of %q, want %d", sig, n, needle, want)
		}
	}
	contains := func(sig, needle string) {
		t.Helper()
		if !strings.Contains(funcBody(t, src, sig), needle) {
			t.Errorf("%s: missing %q", sig, needle)
		}
	}

	const fetch = "func (s *MarketDataService) fetchAndCacheBars("
	check(fetch, `warnUnlessDone(ctx, "GetBars: live fetch failed"`, 1)
	check(fetch, `warnUnlessDone(ctx, "GetBars: re-read after cache failed"`, 2)
	contains(fetch, `slog.WarnContext(ctx, "GetBars: cache insert failed"`)

	check("func (s *MarketDataService) GetLatestQuote(", `warnUnlessDone(ctx, "GetLatestQuote: cache insert failed"`, 1)

	const ingest = "func (s *MarketDataService) ingestRecentBarsForTimeframe("
	check(ingest, `warnUnlessDone(ctx, "bar ingest: insert failed"`, 2)
	check(ingest, `warnUnlessDone(ctx, "bar ingest: multi-bar fetch failed, falling back to per-symbol"`, 1)
	check(ingest, `warnUnlessDone(ctx, "bar ingest: live fetch failed"`, 1)
	contains(ingest, `slog.WarnContext(ctx, "bar ingest: cycle deadline passed, timeframe not fetched"`)

	if !strings.Contains(src, `slog.WarnContext(ctx, "warm poller: cache insert failures"`) {
		t.Error(`the aggregate WARN "warm poller: cache insert failures" must stay a WARN`)
	}
}
