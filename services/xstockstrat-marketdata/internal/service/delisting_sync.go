package service

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"connectrpc.com/connect"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	marketdatav1 "github.com/xstockstrat/contracts/gen/go/marketdata/v1"
	"github.com/xstockstrat/marketdata/internal/repository"
)

// Operator-approved fixed values (feature 352 design).
const (
	syncMaxSymbols      = 20000
	delistingAlertLease = 10 * time.Minute
	delistingClaimLimit = 100
)

// delistingRequestSymbols applies the caller check, the store check and the symbol bound shared
// by the two internal RPCs, and returns the request symbols normalized, de-duplicated and sorted.
func (s *MarketDataService) delistingRequestSymbols(ctx context.Context, rpc string, raw []string) ([]string, error) {
	if !hasInternalCallerAuthority(ctx, rpc) {
		return nil, connect.NewError(connect.CodePermissionDenied, fmt.Errorf("%s is internal to xstockstrat-portfolio", rpc))
	}
	if s.delisting.store == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("symbol profile store is not wired"))
	}
	if n := len(raw); n > syncMaxSymbols {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("at most %d symbols per request, got %d", syncMaxSymbols, n))
	}
	symbols := normalizeSymbols(raw)
	slices.Sort(symbols)
	return slices.Compact(symbols), nil
}

// SyncWatchlistDelistings replaces the watched union with the request, claims due flag alerts and
// returns the flagged symbols. Every servability decision of one call uses one asset-set snapshot.
func (s *MarketDataService) SyncWatchlistDelistings(ctx context.Context, req *marketdatav1.SyncWatchlistDelistingsRequest) (*marketdatav1.SyncWatchlistDelistingsResponse, error) {
	symbols, err := s.delistingRequestSymbols(ctx, rpcSyncWatchlistDelistings, req.GetSymbols())
	if err != nil {
		return nil, err
	}
	store := s.delisting.store
	if err := store.ReplaceWatched(ctx, symbols); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	snap := s.assets.snap.Load()
	unservable := func(sym string) bool { return snap != nil && !snap.servable(sym) }

	var claimed []repository.ClaimedRow
	if snap != nil {
		claimable, err := store.ClaimableSymbols(ctx, delistingAlertLease)
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
		due := claimable[:0:0]
		for _, sym := range claimable {
			if unservable(sym) {
				due = append(due, sym)
			}
		}
		if claimed, err = store.ClaimAlerts(ctx, due, delistingAlertLease, delistingClaimLimit); err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
	}
	rows, err := store.FlaggedIn(ctx, symbols)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Built from the claim's own rows: a symbol recovered mid-call still gets its response entry.
	entries := make(map[string]*marketdatav1.FlaggedSymbol, len(rows)+len(claimed))
	entry := func(row repository.FlaggedRow, state marketdatav1.DelistingAlertState) {
		entries[row.Symbol] = &marketdatav1.FlaggedSymbol{
			Symbol: row.Symbol,
			State: &commonv1.DelistedState{
				Reason:              commonv1.UnservableReason(row.Reason),
				FirstUnservableDate: row.FirstUnservableDate,
			},
			AlertState:             state,
			UnservableInCurrentSet: unservable(row.Symbol),
		}
	}
	for _, row := range rows {
		state := marketdatav1.DelistingAlertState_DELISTING_ALERT_STATE_PENDING
		if row.AlertAcked {
			state = marketdatav1.DelistingAlertState_DELISTING_ALERT_STATE_REPORTED
		}
		entry(row, state)
	}
	for _, c := range claimed {
		state := marketdatav1.DelistingAlertState_DELISTING_ALERT_STATE_CLAIMED
		if c.Reclaim {
			state = marketdatav1.DelistingAlertState_DELISTING_ALERT_STATE_REDELIVERY
		}
		entry(c.FlaggedRow, state)
	}
	resp := &marketdatav1.SyncWatchlistDelistingsResponse{Flagged: make([]*marketdatav1.FlaggedSymbol, 0, len(entries))}
	for _, e := range entries {
		resp.Flagged = append(resp.Flagged, e)
	}
	slices.SortFunc(resp.Flagged, func(a, b *marketdatav1.FlaggedSymbol) int {
		return strings.Compare(a.GetSymbol(), b.GetSymbol())
	})
	return resp, nil
}

// AckDelistingAlerts acknowledges the claimed flag alerts of the given symbols.
func (s *MarketDataService) AckDelistingAlerts(ctx context.Context, req *marketdatav1.AckDelistingAlertsRequest) (*marketdatav1.AckDelistingAlertsResponse, error) {
	symbols, err := s.delistingRequestSymbols(ctx, rpcAckDelistingAlerts, req.GetSymbols())
	if err != nil {
		return nil, err
	}
	if _, err := s.delisting.store.AckAlerts(ctx, symbols); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return &marketdatav1.AckDelistingAlertsResponse{}, nil
}
