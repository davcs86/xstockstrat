package service

import (
	"context"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"google.golang.org/grpc/metadata"
)

const signalPruneIntervalKey = "portfolio.watchlist.signal_prune_interval_seconds"

const (
	defaultPruneIntervalSec = 300
	minPruneIntervalSec     = 60
	maxPruneIntervalSec     = 86400
)

func clampPruneInterval(v int64) time.Duration {
	switch {
	case v <= 0:
		v = defaultPruneIntervalSec
	case v < minPruneIntervalSec:
		v = minPruneIntervalSec
	case v > maxPruneIntervalSec:
		v = maxPruneIntervalSec
	}
	return time.Duration(v) * time.Second
}

func (s *PortfolioService) pruneInterval() time.Duration {
	return clampPruneInterval(s.wlCfg.GetInt(signalPruneIntervalKey, defaultPruneIntervalSec))
}

// PruneExpiredSignalEntries runs one prune tick at startup, then one per interval until ctx is done.
func (s *PortfolioService) PruneExpiredSignalEntries(ctx context.Context) {
	s.pruneOnce(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-time.After(s.pruneInterval()):
			s.pruneOnce(ctx)
		}
	}
}

// pruneOnce emits after the repo committed, so a crash between commit and emit loses the event.
// The background ctx carries no PropagationData, so x-trace-id is set here and the owner rides in UserId.
func (s *PortfolioService) pruneOnce(ctx context.Context) {
	tickCtx := metadata.AppendToOutgoingContext(ctx, "x-trace-id", uuid.NewString())
	res, err := s.watchlists.PruneExpiredSignalEntries(tickCtx)
	if err != nil {
		slog.WarnContext(tickCtx, "signal watchlist prune failed", "error", err)
	}
	for _, e := range res.Removed {
		streamKey := "watchlist:" + e.WatchlistID
		if e.SignalID != nil {
			s.emitEventAs(tickCtx, e.UserID, "portfolio.watchlist.signal_entry_expired", streamKey, map[string]interface{}{
				"user_id":      e.UserID,
				"watchlist_id": e.WatchlistID,
				"symbol":       e.Symbol,
				"strategy_id":  e.StrategyID,
				"signal_id":    *e.SignalID,
				"valid_until":  e.ValidUntil.UTC().Format(time.RFC3339),
			})
			continue
		}
		s.emitEventAs(tickCtx, e.UserID, "portfolio.watchlist.signal_entry_removed_untracked", streamKey, map[string]interface{}{
			"user_id":      e.UserID,
			"watchlist_id": e.WatchlistID,
			"symbol":       e.Symbol,
			"strategy_id":  e.StrategyID,
		})
	}
	slog.InfoContext(tickCtx, "signal watchlist prune tick",
		"lists", res.Lists, "skipped", res.SkippedLists, "removed", len(res.Removed))
}
