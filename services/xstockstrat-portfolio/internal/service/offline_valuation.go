package service

import (
	"context"
	"log/slog"
	"math"
	"sort"
	"sync"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"

	marketdatav1 "github.com/xstockstrat/contracts/gen/go/marketdata/v1"
	portfoliov1 "github.com/xstockstrat/contracts/gen/go/portfolio/v1"
	"github.com/xstockstrat/contracts/pnl"
	"github.com/xstockstrat/portfolio/internal/marketsession"
	"github.com/xstockstrat/portfolio/internal/middleware"
	"github.com/xstockstrat/portfolio/internal/repository"
)

// accountVal is one offline account's Day P&L for the reference session and the base its % is over.
type accountVal struct {
	dayPnl float64
	base   float64
}

// readValuation is one read's shared valuation result: the caller's offline states and per-account Day P&L.
type readValuation struct {
	states   map[string]repository.OfflineState
	accounts map[string]accountVal
}

// closeBar is a daily close keyed by its session date (00:00 America/New_York).
type closeBar struct {
	date  time.Time
	close float64
}

type datedFill struct {
	at    time.Time
	qty   float64
	price float64
}

func (s *PortfolioService) clock() time.Time {
	if s.now != nil {
		return s.now()
	}
	return time.Now()
}

// lastCloseLookbackDays is portfolio.marketdata.last_close_lookback_days (default 21; ≤ 0 or unset → 21).
func (s *PortfolioService) lastCloseLookbackDays() int {
	const defaultDays = 21
	if s.quoteCfg == nil {
		return defaultDays
	}
	if d := s.quoteCfg.GetInt("portfolio.marketdata.last_close_lookback_days", defaultDays); d > 0 {
		return int(d)
	}
	return defaultDays
}

// valueRead runs the one shared valuation step of a read: broker and order-fill positions take the quote
// rule, offline positions (and the given offline accounts) take marks with provenance plus Day P&L.
func (s *PortfolioService) valueRead(ctx context.Context, positions []*portfoliov1.Position, offlineAccountIDs []string) readValuation {
	var offline, other []*portfoliov1.Position
	ids := dedupe(offlineAccountIDs)
	seen := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		seen[id] = struct{}{}
	}
	for _, p := range positions {
		if p.Source == portfoliov1.PositionSource_POSITION_SOURCE_UNSPECIFIED {
			other = append(other, p)
			continue
		}
		offline = append(offline, p)
		if _, ok := seen[p.AccountId]; !ok {
			seen[p.AccountId] = struct{}{}
			ids = append(ids, p.AccountId)
		}
	}
	if len(ids) == 0 {
		quotes, _ := s.latestQuotesFor(ctx, unvaluedSymbols(positions))
		applyQuotes(positions, quotes)
		return readValuation{}
	}

	states, err := s.repo.GetOfflineStates(ctx, middleware.FromContext(ctx).UserID, ids)
	if err != nil {
		slog.Warn("offline state unavailable", "accounts", len(ids), "error", err)
		states = map[string]repository.OfflineState{}
	}
	now := s.clock()
	ref, _ := marketsession.Reference(now)
	d0 := marketsession.DayStart(ref)
	barSyms := make([]string, 0, len(offline))
	for _, p := range offline {
		barSyms = append(barSyms, p.Symbol)
	}
	for _, st := range states {
		for _, f := range st.RecentFills {
			if at, err := time.Parse(time.RFC3339Nano, f.FilledAt); err == nil && !at.Before(d0) {
				barSyms = append(barSyms, f.Symbol)
			}
		}
	}

	quotes, bars := s.fetchMarks(ctx, now, unvaluedSymbols(positions), dedupe(barSyms))
	applyQuotes(other, quotes)
	return readValuation{states: states, accounts: valueOffline(now, offline, ids, states, quotes, bars)}
}

// fetchMarks runs the quote batch and the allow_partial daily-bars batch concurrently, each under the
// quote deadline; a bars failure leaves every symbol without a close (never a read failure).
func (s *PortfolioService) fetchMarks(ctx context.Context, now time.Time, quoteSyms, barSyms []string) (map[string]*marketdatav1.Quote, map[string][]closeBar) {
	var (
		quotes map[string]*marketdatav1.Quote
		wg     sync.WaitGroup
	)
	wg.Add(1)
	go func() {
		defer wg.Done()
		quotes, _ = s.latestQuotesFor(ctx, quoteSyms)
	}()

	bars := map[string][]closeBar{}
	if len(barSyms) > 0 {
		days := s.lastCloseLookbackDays()
		bctx, cancel := context.WithTimeout(ctx, s.quoteTimeout())
		resp, err := s.marketdata.BatchGetBars(bctx, &marketdatav1.BatchGetBarsRequest{
			Symbols:          barSyms,
			Timeframe:        "1d",
			Start:            timestamppb.New(marketsession.DayStart(now).AddDate(0, 0, -days)),
			End:              timestamppb.New(now.Truncate(time.Minute)),
			MaxBarsPerSymbol: int32(days + 1),
			AllowPartial:     true,
		})
		cancel()
		if err != nil {
			slog.Warn("offline last-close bars unavailable", "count", len(barSyms), "error", err)
		} else {
			bars = indexBars(resp.Results)
		}
	}
	wg.Wait()
	return quotes, bars
}

// indexBars keys each symbol's positive daily closes by session date, oldest first.
func indexBars(results []*marketdatav1.SymbolBars) map[string][]closeBar {
	out := make(map[string][]closeBar, len(results))
	for _, sb := range results {
		for _, b := range sb.Bars {
			if b.Time == nil || b.Close <= 0 {
				continue
			}
			out[sb.Symbol] = append(out[sb.Symbol], closeBar{date: marketsession.SessionDate(b.Time.AsTime()), close: b.Close})
		}
		sort.Slice(out[sb.Symbol], func(i, j int) bool { return out[sb.Symbol][i].date.Before(out[sb.Symbol][j].date) })
	}
	return out
}

// valueOffline marks the offline positions (with provenance) and computes broker-style Day P&L for the
// reference session per position and per account; symbols closed in session count at the account only.
func valueOffline(now time.Time, positions []*portfoliov1.Position, accountIDs []string, states map[string]repository.OfflineState,
	quotes map[string]*marketdatav1.Quote, bars map[string][]closeBar) map[string]accountVal {
	ref, live := marketsession.Reference(now)
	d0 := marketsession.DayStart(ref)
	d1 := marketsession.DayStart(ref.AddDate(0, 0, 1))
	prev := marketsession.PrevTradingDay(ref)
	open := marketsession.Open(ref)

	type key struct{ account, symbol string }
	held := make(map[key]*portfoliov1.Position, len(positions))
	keys := make([]key, 0, len(positions))
	for _, p := range positions {
		k := key{p.AccountId, p.Symbol}
		held[k] = p
		keys = append(keys, k)
	}
	fills := map[key][]datedFill{}
	for _, id := range accountIDs {
		for _, f := range states[id].RecentFills {
			at, err := time.Parse(time.RFC3339Nano, f.FilledAt)
			if err != nil || at.Before(d0) {
				continue
			}
			k := key{id, f.Symbol}
			if _, ok := held[k]; !ok && fills[k] == nil {
				keys = append(keys, k)
			}
			fills[k] = append(fills[k], datedFill{at: at, qty: f.Qty, price: f.Price})
		}
	}

	accounts := make(map[string]accountVal, len(accountIDs))
	for _, id := range accountIDs {
		accounts[id] = accountVal{}
	}
	for _, k := range keys {
		symBars := bars[k.symbol]
		mark, src, asOf := pickMark(quotes[k.symbol], symBars, ref, live, open)
		p := held[k]
		if p != nil {
			p.MarkSource = src
			if src == portfoliov1.MarkSource_MARK_SOURCE_NONE {
				continue // an unpriced position adds nothing to day P&L or its base
			}
			markAt(p, mark)
			p.MarkAsOf = timestamppb.New(asOf)
		}

		qNow := 0.0
		if p != nil {
			qNow = p.Qty
		}
		sf := fills[k]
		sort.SliceStable(sf, func(i, j int) bool { return sf[i].at.Before(sf[j].at) })
		var in []datedFill
		qOpen := qNow
		for _, f := range sf {
			qOpen -= f.qty
			if f.at.Before(d1) {
				in = append(in, f)
			}
		}
		pc, hasPC := closeOn(symBars, prev)
		day, base := sessionDay(qOpen, in, pc, hasPC, mark, src != portfoliov1.MarkSource_MARK_SOURCE_NONE)
		if p != nil {
			p.DayPnl, p.DayPnlPct = day, ratio(day, base)
		}
		a := accounts[k.account]
		a.dayPnl += day
		a.base += base
		accounts[k.account] = a
	}
	return accounts
}

// pickMark: live session → fresh quote, last close; off-session → the reference session's close, fresh
// quote, last close. A quote is fresh only if two-sided and from the reference session (operator D-1).
func pickMark(q *marketdatav1.Quote, bars []closeBar, ref time.Time, live bool, open time.Time) (float64, portfoliov1.MarkSource, time.Time) {
	if !live {
		if c, ok := closeOn(bars, ref); ok {
			return c, portfoliov1.MarkSource_MARK_SOURCE_LAST_CLOSE, ref
		}
	}
	if q != nil && q.AskPrice > 0 && q.BidPrice > 0 && q.Time != nil && !q.Time.AsTime().Before(open) {
		if price, ok := markOf(q); ok {
			return price, portfoliov1.MarkSource_MARK_SOURCE_QUOTE, q.Time.AsTime()
		}
	}
	for i := len(bars) - 1; i >= 0; i-- {
		if bars[i].date.Before(ref) || (!live && bars[i].date.Equal(ref)) {
			return bars[i].close, portfoliov1.MarkSource_MARK_SOURCE_LAST_CLOSE, bars[i].date
		}
	}
	return 0, portfoliov1.MarkSource_MARK_SOURCE_NONE, time.Time{}
}

func closeOn(bars []closeBar, date time.Time) (float64, bool) {
	for _, b := range bars {
		if b.date.Equal(date) {
			return b.close, true
		}
	}
	return 0, false
}

// sessionDay is FR-1's Day P&L for one symbol: reductions consume overnight shares first, then
// same-session lots (FIFO); overnight terms need the previous close and are otherwise 0 and out of base.
func sessionDay(qOpen float64, in []datedFill, pc float64, hasPC bool, mark float64, hasMark bool) (day, base float64) {
	type lot struct{ qty, price float64 }
	ovn := qOpen
	if math.Abs(ovn) < pnl.QtyEpsilon {
		ovn = 0
	}
	if hasPC {
		base += math.Abs(ovn * pc)
	}
	var lots []lot
	for _, f := range in {
		rem := f.qty
		if ovn != 0 && rem*ovn < 0 {
			red := math.Copysign(math.Min(math.Abs(rem), math.Abs(ovn)), ovn)
			if hasPC {
				day += (f.price - pc) * red
			}
			ovn -= red
			rem += red
			if math.Abs(ovn) < pnl.QtyEpsilon {
				ovn = 0
			}
		}
		for math.Abs(rem) >= pnl.QtyEpsilon && len(lots) > 0 && rem*lots[0].qty < 0 {
			closed := math.Copysign(math.Min(math.Abs(rem), math.Abs(lots[0].qty)), lots[0].qty)
			day += (f.price - lots[0].price) * closed
			lots[0].qty -= closed
			rem += closed
			if math.Abs(lots[0].qty) < pnl.QtyEpsilon {
				lots = lots[1:]
			}
		}
		if math.Abs(rem) >= pnl.QtyEpsilon {
			lots = append(lots, lot{rem, f.price})
			base += math.Abs(rem * f.price)
		}
	}
	if hasMark {
		if hasPC {
			day += (mark - pc) * ovn
		}
		for _, l := range lots {
			day += (mark - l.price) * l.qty
		}
	}
	return day, base
}

func ratio(num, den float64) float64 {
	if den == 0 {
		return 0
	}
	return num / den
}

func dedupe(in []string) []string {
	seen := make(map[string]struct{}, len(in))
	out := make([]string, 0, len(in))
	for _, v := range in {
		if _, ok := seen[v]; ok {
			continue
		}
		seen[v] = struct{}{}
		out = append(out, v)
	}
	return out
}
