package service

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/xstockstrat/portfolio/internal/repository"
)

func int64p(v int64) *int64 { return &v }

func pruneSvc(res repository.PruneResult, cfg intConfig, ledger *fakeLedger) *PortfolioService {
	store := newFakeStore()
	store.pruneResult = res
	return newSvc(store, cfg, ledger)
}

func assertPruneEvent(t *testing.T, ledger *fakeLedger, i int, eventType, watchlistID, symbol string) map[string]any {
	t.Helper()
	req := ledger.reqs[i]
	if req.GetEventType() != eventType {
		t.Fatalf("event %d type = %q, want %q", i, req.GetEventType(), eventType)
	}
	if req.GetUserId() != "user-1" {
		t.Fatalf("event %d UserId = %q, want user-1", i, req.GetUserId())
	}
	if req.GetStreamKey() != "watchlist:"+watchlistID {
		t.Fatalf("event %d stream key = %q", i, req.GetStreamKey())
	}
	if tr := ledger.outMD[i].Get("x-trace-id"); len(tr) != 1 || tr[0] == "" {
		t.Fatalf("event %d x-trace-id = %v, want one non-empty value", i, tr)
	}
	p := req.GetPayload().AsMap()
	if p["user_id"] != "user-1" || p["watchlist_id"] != watchlistID || p["symbol"] != symbol || p["strategy_id"] != "strat-9" {
		t.Fatalf("event %d payload = %v", i, p)
	}
	return p
}

func TestClampPruneInterval(t *testing.T) {
	cases := []struct {
		in   int64
		want time.Duration
	}{
		{0, 300 * time.Second},
		{-5, 300 * time.Second},
		{1, 60 * time.Second},
		{30, 60 * time.Second},
		{59, 60 * time.Second},
		{60, 60 * time.Second},
		{86400, 86400 * time.Second},
		{90000, 86400 * time.Second},
	}
	for _, c := range cases {
		if got := clampPruneInterval(c.in); got != c.want {
			t.Errorf("clampPruneInterval(%d) = %v, want %v", c.in, got, c.want)
		}
	}
}

func TestSignalPrune_ExpiredEventPayload(t *testing.T) {
	validUntil := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	cases := []struct {
		name     string
		signalID int64
	}{
		{"expired", 101},
		{"renewed", 102},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ledger := &fakeLedger{}
			s := pruneSvc(repository.PruneResult{Lists: 1, Removed: []repository.PrunedEntry{{
				UserID: "user-1", WatchlistID: "wl-1", Symbol: "AAPL", StrategyID: "strat-9",
				SignalID: int64p(c.signalID), ValidUntil: validUntil,
			}}}, &fakeConfig{}, ledger)

			s.pruneOnce(context.Background())

			if ledger.calls != 1 {
				t.Fatalf("AppendEvent calls = %d, want 1", ledger.calls)
			}
			p := assertPruneEvent(t, ledger, 0, "portfolio.watchlist.signal_entry_expired", "wl-1", "AAPL")
			if p["signal_id"] != float64(c.signalID) {
				t.Fatalf("signal_id = %v, want %d", p["signal_id"], c.signalID)
			}
			if p["valid_until"] != "2026-10-01T00:00:00Z" {
				t.Fatalf("valid_until = %v", p["valid_until"])
			}
		})
	}
}

func TestSignalPrune_UntrackedEventPayload(t *testing.T) {
	ledger := &fakeLedger{}
	s := pruneSvc(repository.PruneResult{Lists: 1, Removed: []repository.PrunedEntry{{
		UserID: "user-1", WatchlistID: "wl-2", Symbol: "ORCL", StrategyID: "strat-9",
	}}}, &fakeConfig{}, ledger)

	s.pruneOnce(context.Background())

	if ledger.calls != 1 {
		t.Fatalf("AppendEvent calls = %d, want 1", ledger.calls)
	}
	p := assertPruneEvent(t, ledger, 0, "portfolio.watchlist.signal_entry_removed_untracked", "wl-2", "ORCL")
	for _, k := range []string{"signal_id", "valid_until"} {
		if _, ok := p[k]; ok {
			t.Fatalf("untracked payload has %s: %v", k, p)
		}
	}
}

func TestSignalPrune_LedgerErrorIsBestEffort(t *testing.T) {
	ledger := &fakeLedger{err: status.Error(codes.Internal, "boom")}
	s := pruneSvc(repository.PruneResult{Lists: 2, Removed: []repository.PrunedEntry{
		{UserID: "user-1", WatchlistID: "wl-1", Symbol: "AAPL", StrategyID: "strat-9", SignalID: int64p(101), ValidUntil: time.Now()},
		{UserID: "user-1", WatchlistID: "wl-2", Symbol: "ORCL", StrategyID: "strat-9"},
	}}, &fakeConfig{}, ledger)

	s.pruneOnce(context.Background())

	if ledger.calls != 2 {
		t.Fatalf("AppendEvent calls = %d, want 2 (one per pruned entry despite errors)", ledger.calls)
	}
}

func TestSignalPrune_NoopTickEmitsNothing(t *testing.T) {
	ledger := &fakeLedger{}
	s := pruneSvc(repository.PruneResult{}, &fakeConfig{}, ledger)

	s.pruneOnce(context.Background())

	if ledger.calls != 0 {
		t.Fatalf("AppendEvent calls = %d, want 0", ledger.calls)
	}
}

func TestSignalPrune_IntervalDefaultsWhenUnset(t *testing.T) {
	s := pruneSvc(repository.PruneResult{}, &fakeConfig{}, &fakeLedger{})
	if got := s.pruneInterval(); got != 300*time.Second {
		t.Fatalf("pruneInterval() = %v, want 300s", got)
	}
}

func TestSignalPrune_IntervalReadsConfig(t *testing.T) {
	cases := []struct {
		v    int64
		want time.Duration
	}{
		{0, 300 * time.Second},
		{30, 60 * time.Second},
		{90000, 86400 * time.Second},
	}
	for _, c := range cases {
		cfg := &fakeConfig{vals: map[string]int64{signalPruneIntervalKey: c.v}}
		s := pruneSvc(repository.PruneResult{}, cfg, &fakeLedger{})
		if got := s.pruneInterval(); got != c.want {
			t.Errorf("pruneInterval() with %d = %v, want %v", c.v, got, c.want)
		}
	}
}

// The reader's key and the generated stored set's seeded row are the same contract: if the stored key,
// type or value drifts from what GetInt reads, GetInt silently returns the code default. The stored set
// (scripts/config-wiring-stored.json) is derived from the migrations, so no applied .up.sql is read or edited (F-01).
func TestSignalPrune_IntervalReadsSeededRow(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "scripts", "config-wiring-stored.json"))
	if err != nil {
		t.Fatalf("read the generated stored set: %v", err)
	}
	var stored struct {
		Rows []struct {
			Namespace    string `json:"namespace"`
			Key          string `json:"key"`
			ValueType    string `json:"value_type"`
			DefaultValue string `json:"default_value"`
		} `json:"rows"`
	}
	if err := json.Unmarshal(raw, &stored); err != nil {
		t.Fatalf("parse the stored set: %v", err)
	}
	var typ, val string
	for _, r := range stored.Rows {
		if r.Namespace == "portfolio" && r.Key == signalPruneIntervalKey {
			typ, val = r.ValueType, r.DefaultValue
			break
		}
	}
	if typ != "int" {
		t.Fatalf("stored set has no int row (portfolio, %q), got type %q", signalPruneIntervalKey, typ)
	}
	seeded, err := strconv.ParseInt(val, 10, 64)
	if err != nil {
		t.Fatalf("stored default %q: %v", val, err)
	}
	cfg := &fakeConfig{vals: map[string]int64{signalPruneIntervalKey: seeded}}
	s := pruneSvc(repository.PruneResult{}, cfg, &fakeLedger{})
	if got, want := s.pruneInterval(), time.Duration(seeded)*time.Second; got != want {
		t.Fatalf("pruneInterval() with the stored %d = %v, want %v (stored value outside the clamp?)", seeded, got, want)
	}
}
