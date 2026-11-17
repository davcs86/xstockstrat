package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"

	"google.golang.org/grpc/metadata"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	marketdatav1 "github.com/xstockstrat/contracts/gen/go/marketdata/v1"
	notifyv1 "github.com/xstockstrat/contracts/gen/go/notify/v1"
	"github.com/xstockstrat/portfolio/internal/repository"
	"github.com/xstockstrat/portfolio/internal/telemetry"
)

const (
	delistingRPCTimeout    = 15 * time.Second
	delistingCallerID      = "portfolio"
	delistingAlertCategory = "symbol_delisting"
)

// delistedCache holds marketdata's last flagged set; the zero value is an empty, usable cache.
type delistedCache struct {
	mu sync.RWMutex
	m  map[string]*commonv1.DelistedState
}

func (c *delistedCache) replace(m map[string]*commonv1.DelistedState) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.m = m
}

// emitDelistingAlert writes no ledger event and returns the send error: the caller acknowledges
// only what was sent.
func (s *PortfolioService) emitDelistingAlert(ctx context.Context, title, body string) error {
	_, err := s.notify.EmitAlert(ctx, &notifyv1.EmitAlertRequest{
		Severity:      notifyv1.AlertSeverity_ALERT_SEVERITY_WARNING,
		Category:      delistingAlertCategory,
		Title:         title,
		Body:          body,
		SourceService: "portfolio",
	})
	return err
}

// syncDelistings never removes on a failed sync, and never removes a PENDING or servable-again symbol:
// marketdata is the only decider.
func (s *PortfolioService) syncDelistings(ctx context.Context) {
	if s.marketdata == nil {
		return
	}
	union, err := s.watchlists.ListAllSymbols(ctx)
	if err != nil {
		slog.WarnContext(ctx, "delisting sync: watchlist symbol union unavailable", "error", err)
		return
	}
	callerCtx := metadata.AppendToOutgoingContext(ctx, HeaderInternalCaller, delistingCallerID)
	rctx, cancel := context.WithTimeout(callerCtx, delistingRPCTimeout)
	resp, err := s.marketdata.SyncWatchlistDelistings(rctx, &marketdatav1.SyncWatchlistDelistingsRequest{Symbols: union})
	timedOut := errors.Is(rctx.Err(), context.DeadlineExceeded)
	cancel()
	if err != nil {
		outcome := "error"
		if timedOut {
			outcome = "timeout"
		}
		slog.WarnContext(ctx, "delisting sync unavailable; nothing removed", "count", len(union), "error", err)
		telemetry.RecordMarketdataFetch(ctx, "delistings", outcome)
		return
	}
	telemetry.RecordMarketdataFetch(ctx, "delistings", "ok")

	flagged := slices.Clone(resp.GetFlagged())
	sort.Slice(flagged, func(i, j int) bool { return flagged[i].GetSymbol() < flagged[j].GetSymbol() })
	states := make(map[string]*commonv1.DelistedState, len(flagged))
	var removalSet []string
	for _, f := range flagged {
		states[f.GetSymbol()] = f.GetState()
		if delistingRemovable(f) {
			removalSet = append(removalSet, f.GetSymbol())
		}
	}
	s.delisted.replace(states)

	removals, err := s.watchlists.RemoveDelistedFromSystemLists(ctx, removalSet)
	if err != nil {
		slog.WarnContext(ctx, "delisting removal failed for some lists", "error", err)
	}
	removed := 0
	for _, r := range removals {
		removed += len(r.Removed)
	}

	alerted, acknowledged := 0, 0
	if s.notify != nil {
		sent := s.sendDelistingAlerts(ctx, flagged, removals)
		alerted = len(sent)
		if alerted > 0 {
			actx, cancel := context.WithTimeout(callerCtx, delistingRPCTimeout)
			_, err := s.marketdata.AckDelistingAlerts(actx, &marketdatav1.AckDelistingAlertsRequest{Symbols: sent})
			cancel()
			if err != nil {
				slog.WarnContext(ctx, "delisting alert acknowledgement failed; the claim is re-delivered after its lease",
					"count", alerted, "error", err)
			} else {
				acknowledged = alerted
			}
		}
	}
	for _, f := range flagged {
		if f.GetAlertState() != marketdatav1.DelistingAlertState_DELISTING_ALERT_STATE_REPORTED {
			continue
		}
		if names := listsWith(removals, f.GetSymbol(), func(r repository.DelistedRemoval) []string { return r.Removed }); len(names) > 0 {
			slog.InfoContext(ctx, "delisted symbol removed from system-managed watchlists",
				"symbol", f.GetSymbol(), "lists", len(names))
		}
	}
	slog.InfoContext(ctx, "delisting sync tick",
		"flagged", len(flagged), "removed", removed, "alerted", alerted, "acknowledged", acknowledged)
}

func delistingRemovable(f *marketdatav1.FlaggedSymbol) bool {
	if !f.GetUnservableInCurrentSet() {
		return false
	}
	switch f.GetAlertState() {
	case marketdatav1.DelistingAlertState_DELISTING_ALERT_STATE_CLAIMED,
		marketdatav1.DelistingAlertState_DELISTING_ALERT_STATE_REDELIVERY,
		marketdatav1.DelistingAlertState_DELISTING_ALERT_STATE_REPORTED:
		return true
	}
	return false
}

// sendDelistingAlerts stops at the first failed send and returns the symbols whose alert was sent.
func (s *PortfolioService) sendDelistingAlerts(ctx context.Context, flagged []*marketdatav1.FlaggedSymbol, removals []repository.DelistedRemoval) []string {
	var sent []string
	for _, f := range flagged {
		var body string
		switch f.GetAlertState() {
		case marketdatav1.DelistingAlertState_DELISTING_ALERT_STATE_CLAIMED:
			body = delistingAlertBody(f, removals, false)
		case marketdatav1.DelistingAlertState_DELISTING_ALERT_STATE_REDELIVERY:
			body = delistingAlertBody(f, removals, true)
		default:
			continue
		}
		sctx, cancel := context.WithTimeout(ctx, delistingRPCTimeout)
		err := s.emitDelistingAlert(sctx, "symbol delisted", body)
		cancel()
		if err != nil {
			slog.WarnContext(ctx, "delisting alert send failed; later alerts wait for the next tick",
				"symbol", f.GetSymbol(), "error", err)
			break
		}
		sent = append(sent, f.GetSymbol())
	}
	return sent
}

// listsWith returns the names of the lists whose pick(r) holds symbol, one per list.
func listsWith(removals []repository.DelistedRemoval, symbol string, pick func(repository.DelistedRemoval) []string) []string {
	var names []string
	for _, r := range removals {
		if slices.Contains(pick(r), symbol) {
			names = append(names, r.Name)
		}
	}
	return names
}

func delistingAlertBody(f *marketdatav1.FlaggedSymbol, removals []repository.DelistedRemoval, redelivery bool) string {
	sym := f.GetSymbol()
	removedFrom := listsWith(removals, sym, func(r repository.DelistedRemoval) []string { return r.Removed })
	var b strings.Builder
	if redelivery {
		b.WriteString("This may repeat an earlier alert. ")
	}
	fmt.Fprintf(&b, "%s is delisted (%s, first unservable %s).", sym,
		f.GetState().GetReason().String(), f.GetState().GetFirstUnservableDate())
	if len(removedFrom) > 0 {
		fmt.Fprintf(&b, " Removed from %d system-managed watchlist(s): %s.", len(removedFrom), strings.Join(removedFrom, ", "))
	}
	if redelivery {
		return b.String()
	}
	left := len(listsWith(removals, sym, func(r repository.DelistedRemoval) []string { return r.Left }))
	switch {
	case left > 0:
		fmt.Fprintf(&b, " %d more system-managed watchlist(s) still hold it and will be updated on a later refresh.", left)
	case len(removedFrom) == 0:
		b.WriteString(" It was on no system-managed watchlist.")
	}
	return b.String()
}
