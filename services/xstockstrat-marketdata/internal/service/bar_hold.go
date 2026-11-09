package service

import (
	"sort"
	"time"
)

const (
	barIngestBackoffKey             = "stream.bar_ingest_backoff_ms"
	defaultBarIngestBackoffMs int64 = 21600000
)

// barHoldEntry is one (symbol, timeframe) no-bars streak; nextProbe.IsZero() means not yet held.
type barHoldEntry struct {
	emptySince, lastEmpty, nextProbe time.Time
}

// barPlan is one cycle's vendor request: requested is what to fetch, probes the held symbols due a probe.
type barPlan struct {
	requested []string
	probes    map[string]bool
}

// barOutcome is what one cycle's fetch returned: got has bars, errored failed to fetch.
type barOutcome struct {
	got, errored map[string]bool
}

type barCycleResult struct {
	missing, newlyHeld, recovered []string
	active, held                  int
}

// resolveBarIngestBackoff reads the hold period live; unlike resolvePositiveInt, <= 0 means disabled, not default.
func resolveBarIngestBackoff(cfg intGetter) time.Duration {
	v := defaultBarIngestBackoffMs
	if cfg != nil {
		v = cfg.GetInt(barIngestBackoffKey, defaultBarIngestBackoffMs)
	}
	if v <= 0 {
		return 0
	}
	return time.Duration(v) * time.Millisecond
}

// planBarRequest drops entries for symbols no longer listed and omits held symbols not yet due a probe.
func (s *MarketDataService) planBarRequest(symbols []string, tf string, end time.Time, d time.Duration) barPlan {
	s.warmMu.Lock()
	defer s.warmMu.Unlock()
	if d <= 0 {
		s.barHold = nil
		return barPlan{requested: symbols}
	}
	listed := make(map[string]bool, len(symbols))
	for _, sym := range symbols {
		listed[sym] = true
	}
	for sym := range s.barHold {
		if !listed[sym] {
			s.deleteBarHold(sym, tf)
		}
	}
	plan := barPlan{requested: make([]string, 0, len(symbols))}
	for _, sym := range symbols {
		e := s.barHold[sym][tf]
		if e == nil || e.nextProbe.IsZero() {
			plan.requested = append(plan.requested, sym)
			continue
		}
		if !end.Before(e.nextProbe) {
			if plan.probes == nil {
				plan.probes = map[string]bool{}
			}
			plan.probes[sym] = true
			plan.requested = append(plan.requested, sym)
		}
	}
	return plan
}

// applyBarCycle folds one cycle's outcome into the hold state. A cycle is informative only when a
// strict majority of the active symbols returned bars; a streak restarts after a gap wider than the window.
func (s *MarketDataService) applyBarCycle(tf string, symbols []string, plan barPlan, out barOutcome, start, end time.Time, d time.Duration) barCycleResult {
	s.warmMu.Lock()
	defer s.warmMu.Unlock()
	var res barCycleResult
	var active []string
	hits := 0
	for _, sym := range plan.requested {
		if plan.probes[sym] || out.errored[sym] {
			continue
		}
		active = append(active, sym)
		if out.got[sym] {
			hits++
		} else {
			res.missing = append(res.missing, sym)
		}
	}
	sort.Strings(res.missing)
	if d <= 0 {
		res.active = len(plan.requested)
		return res
	}
	res.active = len(active)
	if s.barHold == nil {
		s.barHold = map[string]map[string]*barHoldEntry{}
	}
	for sym := range plan.probes {
		switch {
		case out.got[sym]:
			s.deleteBarHold(sym, tf)
			res.recovered = append(res.recovered, sym)
		case !out.errored[sym]:
			if e := s.barHold[sym][tf]; e != nil {
				e.nextProbe = end.Add(d)
			}
		}
	}
	if hits*2 > len(active) {
		window := end.Sub(start)
		for _, sym := range active {
			if out.got[sym] {
				s.deleteBarHold(sym, tf)
				continue
			}
			e := s.barHold[sym][tf]
			if e == nil || end.Sub(e.lastEmpty) > window {
				e = &barHoldEntry{emptySince: end}
				if s.barHold[sym] == nil {
					s.barHold[sym] = map[string]*barHoldEntry{}
				}
				s.barHold[sym][tf] = e
			}
			e.lastEmpty = end
			if end.Sub(e.emptySince) >= d {
				e.nextProbe = end.Add(d)
				res.newlyHeld = append(res.newlyHeld, sym)
			}
		}
	} else {
		for sym, byTF := range s.barHold {
			if e := byTF[tf]; e != nil && e.nextProbe.IsZero() {
				s.deleteBarHold(sym, tf)
			}
		}
	}
	for _, sym := range symbols {
		if e := s.barHold[sym][tf]; e != nil && !e.nextProbe.IsZero() {
			res.held++
		}
	}
	sort.Strings(res.newlyHeld)
	sort.Strings(res.recovered)
	return res
}

// deleteBarHold removes one (symbol, timeframe) entry; callers hold warmMu.
func (s *MarketDataService) deleteBarHold(sym, tf string) {
	delete(s.barHold[sym], tf)
	if len(s.barHold[sym]) == 0 {
		delete(s.barHold, sym)
	}
}

// barSample caps the symbols named in one bar-ingest log line.
func barSample(syms []string) []string {
	if len(syms) > barIngestNoBarsSample {
		return syms[:barIngestNoBarsSample]
	}
	return syms
}
