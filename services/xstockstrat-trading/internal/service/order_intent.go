package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"google.golang.org/protobuf/proto"

	tradingv1 "github.com/xstockstrat/contracts/gen/go/trading/v1"
	"github.com/xstockstrat/trading/internal/broker"
	"github.com/xstockstrat/trading/internal/config"
	"github.com/xstockstrat/trading/internal/repository"
)

// computeRequestHash marshals msg deterministically and returns its sha256 digest —
// the content-identity check for order-intent dedup.
func computeRequestHash(msg proto.Message) ([]byte, error) {
	b, err := proto.MarshalOptions{Deterministic: true}.Marshal(msg)
	if err != nil {
		return nil, fmt.Errorf("compute request hash: %w", err)
	}
	sum := sha256.Sum256(b)
	return sum[:], nil
}

// placeOrderRequestHash hashes a PlaceOrderRequest with ClientOrderId cleared — the nonce is the
// intent ID, not hashed content, so the hash tracks logical order content independent of the nonce.
func placeOrderRequestHash(req *tradingv1.PlaceOrderRequest) ([]byte, error) {
	clone, ok := proto.Clone(req).(*tradingv1.PlaceOrderRequest)
	if !ok {
		return nil, fmt.Errorf("placeOrderRequestHash: unexpected clone type")
	}
	clone.ClientOrderId = ""
	return computeRequestHash(clone)
}

// deriveReplaceCancelIntentID derives a server-side, content-hashed intent ID for Replace/Cancel —
// no client nonce needed, since a content-identical replace/cancel on the same order safely collapses.
func deriveReplaceCancelIntentID(msg proto.Message) (intentID string, hashHex string, err error) {
	sum, err := computeRequestHash(msg)
	if err != nil {
		return "", "", err
	}
	intentID = uuid.NewSHA1(uuid.NameSpaceOID, sum).String()
	hashHex = hex.EncodeToString(sum)
	return intentID, hashHex, nil
}

// intentAction is classifyIntentLookup's decision output.
type intentAction int

const (
	intentActionProceedNew intentAction = iota
	intentActionReturnStored
	intentActionRejectHashMismatch
	intentActionRejectUnknown
	intentActionRejectPending
)

// classifyIntentLookup decides what to do with an existing order_intents row (reactive dedup path).
// isStale is meaningful only for intentActionRejectPending — whether to attempt ReclaimOrphanIntent
// before returning the rejection, not which action to return.
func classifyIntentLookup(existing *repository.OrderIntentRecord, requestHashHex string, now time.Time, staleThreshold time.Duration) (action intentAction, isStale bool) {
	if existing.RequestHash != requestHashHex {
		return intentActionRejectHashMismatch, false
	}
	switch existing.State {
	case repository.IntentStateCompleted, repository.IntentStateRejected:
		return intentActionReturnStored, false
	case repository.IntentStateUnknown:
		return intentActionRejectUnknown, false
	default: // IntentStatePending
		isStale = now.Sub(existing.UpdatedAt) >= staleThreshold
		return intentActionRejectPending, isStale
	}
}

// computeStaleThreshold applies the floor-clamped multiplier formula — a pure function so the
// clamp is unit-testable (config.Watcher has no exported snapshot setter to inject through).
func computeStaleThreshold(floorMs int64, multiplier float64) time.Duration {
	if multiplier < 1.5 {
		multiplier = 1.5
	}
	return time.Duration(float64(floorMs)*multiplier) * time.Millisecond
}

// staleThreshold derives the PENDING-intent staleness threshold live: floor = max(live
// trading.broker.timeout_ms, IBKRRequestTimeout), multiplier clamped >=1.5 (never below the floor).
func staleThreshold(cfgW *config.Watcher) time.Duration {
	brokerMs := cfgW.GetInt("trading.broker.timeout_ms", 5000)
	floorMs := brokerMs
	if ibkrMs := int64(broker.IBKRRequestTimeout / time.Millisecond); ibkrMs > floorMs {
		floorMs = ibkrMs
	}
	multiplier := cfgW.GetFloat("trading.order_intent.stale_multiplier", 3.0)
	return computeStaleThreshold(floorMs, multiplier)
}

// StartOrderIntentSweeper proactively reclaims orphaned PENDING intents — closing the
// unattended-crash gap the reactive (retry-driven) reclaim cannot (no resubmit, no reclaim).
func (s *TradingService) StartOrderIntentSweeper(ctx context.Context) {
	const defaultIntervalMs = 5000.0
	currentInterval := time.Duration(defaultIntervalMs) * time.Millisecond
	ticker := time.NewTicker(currentInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.sweepOrderIntents(ctx)
			intervalMs := s.cfgW.GetFloat("trading.order_intent.sweep_interval_ms", defaultIntervalMs)
			if intervalMs > 0 {
				newInterval := time.Duration(intervalMs) * time.Millisecond
				if newInterval != currentInterval {
					currentInterval = newInterval
					ticker.Reset(currentInterval)
				}
			}
		}
	}
}

// sweepOrderIntents runs one sweep tick: select up to 100 stale PENDING intents, then call the
// identical CAS the reactive path uses — a row that changed state before its UPDATE is a safe no-op.
func (s *TradingService) sweepOrderIntents(ctx context.Context) {
	staleBefore := time.Now().Add(-staleThreshold(s.cfgW))
	stale, err := s.orderIntentRepo.SweepStalePending(ctx, staleBefore, 100)
	if err != nil {
		slog.Warn("order intent sweep: select failed", "error", err)
		return
	}
	for _, rec := range stale {
		reclaimed, out, err := s.orderIntentRepo.ReclaimOrphanIntent(ctx, rec.IntentID, staleBefore)
		if err != nil {
			slog.Warn("order intent sweep: reclaim failed", "intent_id", rec.IntentID, "error", err)
			continue
		}
		if !reclaimed {
			continue
		}
		s.emitLedgerEvent(ctx, "order_intent.reclaimed_unknown", fmt.Sprintf("order:%s", out.OrderID), "", map[string]interface{}{
			"trigger":           "sweep",
			"order_id":          out.OrderID,
			"intent_id":         out.IntentID,
			"was_pending_since": out.UpdatedAt,
		})
	}
}
