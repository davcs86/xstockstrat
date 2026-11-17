package service

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"sync/atomic"
	"time"

	notifyv1 "github.com/xstockstrat/contracts/gen/go/notify/v1"
	"github.com/xstockstrat/contracts/marketsession"
	"github.com/xstockstrat/marketdata/internal/repository"
	"github.com/xstockstrat/marketdata/internal/telemetry"
)

// Operator-approved fixed values (feature 352 design); only the confirmation window is a config key.
const (
	delistingHookTimeout      = 30 * time.Second
	delistingAlertSendTimeout = 15 * time.Second
	delistingAlertCategory    = "symbol_delisting"
)

// profileStore is the ProfileRepo surface the delisting hook and the sync RPCs use.
type profileStore interface {
	Candidates(ctx context.Context) (symbols []string, watched int, err error)
	ResetServable(ctx context.Context, servable []string) (int64, error)
	ResetUnwatched(ctx context.Context) (int64, error)
	Start(ctx context.Context, day string, unservable []repository.SymbolReason) (int64, error)
	Flag(ctx context.Context, cutoff string, unservable []string) ([]string, error)
	Recover(ctx context.Context, servable []string) ([]repository.RecoveredRow, error)
	FlaggedSymbols(ctx context.Context) ([]string, error)
	ReplaceWatched(ctx context.Context, symbols []string) error
	ClaimableSymbols(ctx context.Context, lease time.Duration) ([]string, error)
	ClaimAlerts(ctx context.Context, symbols []string, lease time.Duration, limit int) ([]repository.ClaimedRow, error)
	FlaggedIn(ctx context.Context, symbols []string) ([]repository.FlaggedRow, error)
	AckAlerts(ctx context.Context, symbols []string) (int64, error)
}

// delistingState: zero value = feature off (no store wired).
type delistingState struct {
	store   profileStore
	flagged atomic.Pointer[map[string]struct{}]
}

// SetSymbolProfiles wires the profile store; call before StartAssetSetRefresher.
func (s *MarketDataService) SetSymbolProfiles(store profileStore) {
	s.delisting.store = store
}

// loadFlaggedSet rebuilds the in-memory flagged set from the store and removes flagged symbols
// from the warm set. warmMu is never held across the database call.
func (s *MarketDataService) loadFlaggedSet(ctx context.Context) error {
	symbols, err := s.delisting.store.FlaggedSymbols(ctx)
	if err != nil {
		return err
	}
	set := make(map[string]struct{}, len(symbols))
	for _, sym := range symbols {
		set[sym] = struct{}{}
	}
	s.delisting.flagged.Store(&set)
	s.warmMu.Lock()
	for sym := range set {
		delete(s.warmSymbols, sym)
	}
	s.warmMu.Unlock()
	return nil
}

// isFlaggedDelisted reads this instance's in-memory flagged set; false when none is loaded.
func (s *MarketDataService) isFlaggedDelisted(sym string) bool {
	set := s.delisting.flagged.Load()
	if set == nil {
		return false
	}
	_, ok := (*set)[strings.ToUpper(strings.TrimSpace(sym))]
	return ok
}

// emitNotice sends one untargeted WARNING alert and returns the send error.
func (s *MarketDataService) emitNotice(ctx context.Context, title, category, body string) error {
	_, err := s.notify.EmitAlert(ctx, &notifyv1.EmitAlertRequest{
		Severity:      notifyv1.AlertSeverity_ALERT_SEVERITY_WARNING,
		Category:      category,
		Title:         title,
		Body:          body,
		SourceService: "marketdata",
	})
	return err
}

type delistingRun struct {
	candidates, watched      int
	reset, unwatched, starts int64
	flagged                  []string
	recovered                []repository.RecoveredRow
}

// runDelistingTransitions runs H1..H5 in order for trading day d and stops at the first error.
func (s *MarketDataService) runDelistingTransitions(ctx context.Context, next *assetSet, d time.Time) (delistingRun, error) {
	store := s.delisting.store
	var (
		run delistingRun
		err error
	)
	candidates, watched, err := store.Candidates(ctx)
	if err != nil {
		return run, err
	}
	run.candidates, run.watched = len(candidates), watched
	var (
		servable, unservableSymbols []string
		unservable                  []repository.SymbolReason
	)
	for _, sym := range candidates {
		ok, reason := next.classify(sym)
		if ok {
			servable = append(servable, sym)
			continue
		}
		unservableSymbols = append(unservableSymbols, sym)
		unservable = append(unservable, repository.SymbolReason{Symbol: sym, Reason: int16(reason)})
	}
	cutoff := d
	n := resolveDelistingConfirmationDays(s.budgetCfg)
	for i := 1; i < n; i++ {
		cutoff = marketsession.PrevTradingDay(cutoff)
	}
	if run.reset, err = store.ResetServable(ctx, servable); err != nil {
		return run, err
	}
	if watched > 0 {
		if run.unwatched, err = store.ResetUnwatched(ctx); err != nil {
			return run, err
		}
	}
	if run.starts, err = store.Start(ctx, d.Format(time.DateOnly), unservable); err != nil {
		return run, err
	}
	if run.flagged, err = store.Flag(ctx, cutoff.Format(time.DateOnly), unservableSymbols); err != nil {
		return run, err
	}
	run.recovered, err = store.Recover(ctx, servable)
	return run, err
}

// runDelistingHook is the only writer of profile state. It returns nothing: it can never fail the
// asset load that calls it.
func (s *MarketDataService) runDelistingHook(ctx context.Context, next *assetSet) {
	if s.delisting.store == nil {
		return
	}
	hookCtx, cancel := context.WithTimeout(ctx, delistingHookTimeout)
	defer cancel()

	var (
		run     delistingRun
		err     error
		skipped string
	)
	d := marketsession.DayStart(s.assets.clock())
	if marketsession.IsTradingDay(d) {
		run, err = s.runDelistingTransitions(hookCtx, next, d)
		if err == nil && run.watched == 0 {
			skipped = "empty_union"
		}
	} else {
		skipped = "closed_day"
	}
	if loadErr := s.loadFlaggedSet(hookCtx); err == nil {
		err = loadErr
	}
	if err != nil {
		reason := telemetry.DelistingHookError
		if hookCtx.Err() != nil {
			reason = telemetry.DelistingHookTimeout
		}
		slog.WarnContext(ctx, "delisting hook failed", "reason", reason, "error", err)
		telemetry.RecordDelistingHookFailure(ctx, reason)
	}
	slog.InfoContext(ctx, "delisting hook", "day", d.Format(time.DateOnly), "skipped", skipped,
		"candidates", run.candidates, "watched", run.watched, "reset_servable", run.reset, "reset_unwatched", run.unwatched,
		"started", run.starts, "flagged", len(run.flagged), "recovered", len(run.recovered))

	for _, r := range run.recovered {
		if !r.AlertClaimed {
			continue
		}
		sendCtx, cancelSend := context.WithTimeout(hookCtx, delistingAlertSendTimeout)
		err := s.emitNotice(sendCtx, "symbol servable again", delistingAlertCategory,
			fmt.Sprintf("%s is servable again: its delisted flag was cleared. It is not re-added to system-managed watchlists.", r.Symbol))
		cancelSend()
		if err != nil {
			slog.WarnContext(ctx, "delisting recovery alert not sent", "symbol", r.Symbol, "error", err)
		}
	}
}
