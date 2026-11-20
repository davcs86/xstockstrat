package service

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"testing"
	"time"

	"connectrpc.com/connect"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	marketdatav1 "github.com/xstockstrat/contracts/gen/go/marketdata/v1"
	"github.com/xstockstrat/marketdata/internal/testdata"
)

const (
	alertPending    = marketdatav1.DelistingAlertState_DELISTING_ALERT_STATE_PENDING
	alertClaimed    = marketdatav1.DelistingAlertState_DELISTING_ALERT_STATE_CLAIMED
	alertRedelivery = marketdatav1.DelistingAlertState_DELISTING_ALERT_STATE_REDELIVERY
	alertReported   = marketdatav1.DelistingAlertState_DELISTING_ALERT_STATE_REPORTED
)

// newSyncRig is a delisting rig whose asset set is assets (nil = not loaded), set without running the hook.
func newSyncRig(t *testing.T, assets []*commonv1.Asset) *delistingRig {
	t.Helper()
	rig := newDelistingRig(nov(t, 13), nil)
	if assets != nil {
		rig.svc.assets.snap.Store(newAssetSet(assets))
	}
	return rig
}

func syncDelistings(t *testing.T, rig *delistingRig, symbols ...string) map[string]*marketdatav1.FlaggedSymbol {
	t.Helper()
	resp, err := rig.svc.SyncWatchlistDelistings(portfolioCtx(), &marketdatav1.SyncWatchlistDelistingsRequest{Symbols: symbols})
	if err != nil {
		t.Fatalf("SyncWatchlistDelistings: %v", err)
	}
	out := map[string]*marketdatav1.FlaggedSymbol{}
	var order []string
	for _, f := range resp.GetFlagged() {
		if _, dup := out[f.GetSymbol()]; dup {
			t.Fatalf("symbol %s appears twice in the response", f.GetSymbol())
		}
		out[f.GetSymbol()] = f
		order = append(order, f.GetSymbol())
	}
	if !slices.IsSorted(order) {
		t.Fatalf("response is not sorted by symbol: %v", order)
	}
	return out
}

func requireEntry(t *testing.T, got map[string]*marketdatav1.FlaggedSymbol, sym string, state marketdatav1.DelistingAlertState, unservable bool) {
	t.Helper()
	e, ok := got[sym]
	if !ok {
		t.Fatalf("%s is not in the response %v", sym, got)
	}
	if e.GetAlertState() != state || e.GetUnservableInCurrentSet() != unservable {
		t.Fatalf("%s = {%v unservable=%v}, want {%v unservable=%v}", sym, e.GetAlertState(), e.GetUnservableInCurrentSet(), state, unservable)
	}
}

func TestSyncWatchlistDelistings_DeniedCallerTouchesNoStore(t *testing.T) {
	rig := newSyncRig(t, testdata.ServableAssets())
	for name, ctx := range map[string]context.Context{
		"no grant":        context.Background(),
		"header only":     callerCtx("portfolio", nil, false),
		"wrong peer SAN":  callerCtx("portfolio", []string{"xstockstrat-analysis"}, false),
		"peer SAN only":   callerCtx("", []string{"xstockstrat-portfolio"}, false),
		"unverified peer": callerCtx("portfolio", []string{"xstockstrat-portfolio"}, true),
	} {
		_, err := rig.svc.SyncWatchlistDelistings(ctx, &marketdatav1.SyncWatchlistDelistingsRequest{Symbols: []string{testdata.Roku}})
		if connect.CodeOf(err) != connect.CodePermissionDenied {
			t.Errorf("%s: err = %v, want PermissionDenied", name, err)
		}
	}
	if calls := rig.store.methods(); len(calls) != 0 {
		t.Errorf("store calls for denied callers = %v, want none", calls)
	}
}

func TestSyncWatchlistDelistings_NoStoreWiredIsUnavailable(t *testing.T) {
	svc, _ := newAssetSvc()
	_, err := svc.SyncWatchlistDelistings(portfolioCtx(), &marketdatav1.SyncWatchlistDelistingsRequest{})
	if connect.CodeOf(err) != connect.CodeUnavailable {
		t.Fatalf("err = %v, want Unavailable", err)
	}
}

func TestSyncWatchlistDelistings_BoundsAndNormalizesTheUnion(t *testing.T) {
	rig := newSyncRig(t, testdata.ServableAssets())
	tooMany := make([]string, syncMaxSymbols+1)
	for i := range tooMany {
		tooMany[i] = fmt.Sprintf("S%05d", i)
	}
	_, err := rig.svc.SyncWatchlistDelistings(portfolioCtx(), &marketdatav1.SyncWatchlistDelistingsRequest{Symbols: tooMany})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("20001 symbols: err = %v, want InvalidArgument", err)
	}
	if calls := rig.store.methods(); len(calls) != 0 {
		t.Fatalf("store calls for an over-limit request = %v, want none", calls)
	}

	syncDelistings(t, rig, " roku ", testdata.Aapl, "aapl", "", testdata.Roku)
	replaced := rig.store.callsOf("ReplaceWatched")
	if len(replaced) != 1 || !slices.Equal(replaced[0].symbols, []string{testdata.Aapl, testdata.Roku}) {
		t.Fatalf("ReplaceWatched = %+v, want one call with [AAPL ROKU]", replaced)
	}

	syncDelistings(t, rig)
	if len(rig.store.watched) != 0 {
		t.Errorf("an empty request left %d symbols in the union", len(rig.store.watched))
	}
}

func TestSyncWatchlistDelistings_UnloadedAssetSetClaimsNothing(t *testing.T) {
	rig := newSyncRig(t, nil)
	rig.store.seedFlagged(testdata.Roku, novDate(9), false)
	rig.store.seedFlagged(testdata.Nwe, novDate(9), true)
	rig.store.rows[testdata.Nwe].acked = true

	got := syncDelistings(t, rig, testdata.Roku, testdata.Nwe)
	requireEntry(t, got, testdata.Roku, alertPending, false)
	requireEntry(t, got, testdata.Nwe, alertReported, false)
	if calls := rig.store.callsOf("ClaimAlerts"); len(calls) != 0 {
		t.Errorf("ClaimAlerts ran with no asset set loaded: %+v", calls)
	}
	if row, _ := rig.store.row(testdata.Roku); row.claimed {
		t.Error("ROKU was claimed with no asset set loaded")
	}
}

func TestSyncWatchlistDelistings_ClaimThenPendingThenRedelivery(t *testing.T) {
	rig := newSyncRig(t, testdata.ServableAssets())
	now := time.Date(2026, 11, 13, 15, 0, 0, 0, time.UTC)
	rig.store.now = func() time.Time { return now }
	rig.store.seedFlagged(testdata.Roku, novDate(9), false)

	got := syncDelistings(t, rig, testdata.Roku)
	requireEntry(t, got, testdata.Roku, alertClaimed, true)
	state := got[testdata.Roku].GetState()
	if state.GetFirstUnservableDate() != novDate(9) || state.GetReason() != commonv1.UnservableReason_UNSERVABLE_REASON_NOT_TRADABLE {
		t.Errorf("state = %+v, want the stored date and reason", state)
	}

	now = now.Add(delistingAlertLease - time.Second)
	requireEntry(t, syncDelistings(t, rig, testdata.Roku), testdata.Roku, alertPending, true)

	now = now.Add(2 * time.Second)
	requireEntry(t, syncDelistings(t, rig, testdata.Roku), testdata.Roku, alertRedelivery, true)
}

// @AC-17: once the flag alert is acknowledged, no later sync claims it again.
func TestSyncWatchlistDelistings_AC17_AcknowledgedAlertIsNeverClaimedAgain(t *testing.T) {
	rig := newSyncRig(t, testdata.ServableAssets())
	now := time.Date(2026, 11, 13, 15, 0, 0, 0, time.UTC)
	rig.store.now = func() time.Time { return now }
	rig.store.seedFlagged(testdata.Roku, novDate(9), false)
	requireEntry(t, syncDelistings(t, rig, testdata.Roku), testdata.Roku, alertClaimed, true)

	if _, err := rig.svc.AckDelistingAlerts(portfolioCtx(), &marketdatav1.AckDelistingAlertsRequest{Symbols: []string{testdata.Roku}}); err != nil {
		t.Fatalf("AckDelistingAlerts: %v", err)
	}
	for i := 0; i < 3; i++ {
		now = now.Add(delistingAlertLease + time.Minute)
		requireEntry(t, syncDelistings(t, rig, testdata.Roku), testdata.Roku, alertReported, true)
	}
}

func TestSyncWatchlistDelistings_ServableFlaggedSymbolIsNotClaimed(t *testing.T) {
	rig := newSyncRig(t, testdata.ServableAssetsWith(testdata.Roku))
	rig.store.seedFlagged(testdata.Roku, novDate(9), false)
	requireEntry(t, syncDelistings(t, rig, testdata.Roku), testdata.Roku, alertPending, false)
	if row, _ := rig.store.row(testdata.Roku); row.claimed {
		t.Error("a flagged symbol that is servable in the current set was claimed")
	}
}

func TestSyncWatchlistDelistings_ClaimedSymbolOutsideTheRequestIsReturned(t *testing.T) {
	rig := newSyncRig(t, testdata.ServableAssets())
	rig.store.seedFlagged(testdata.Roku, novDate(9), false)
	got := syncDelistings(t, rig, testdata.Aapl)
	requireEntry(t, got, testdata.Roku, alertClaimed, true)
	if len(got) != 1 {
		t.Errorf("response = %v, want only ROKU", got)
	}
}

func TestSyncWatchlistDelistings_ClaimsAtMostOneHundredPerCall(t *testing.T) {
	rig := newSyncRig(t, testdata.ServableAssets())
	symbols := make([]string, delistingClaimLimit+1)
	for i := range symbols {
		symbols[i] = fmt.Sprintf("DEAD%03d", i)
		rig.store.seedFlagged(symbols[i], novDate(9), false)
	}
	got := syncDelistings(t, rig, symbols...)
	counts := map[marketdatav1.DelistingAlertState]int{}
	for _, e := range got {
		counts[e.GetAlertState()]++
		if !e.GetUnservableInCurrentSet() {
			t.Errorf("%s is not reported unservable", e.GetSymbol())
		}
	}
	if counts[alertClaimed] != delistingClaimLimit || counts[alertPending] != 1 || len(got) != delistingClaimLimit+1 {
		t.Fatalf("alert states = %v, want %d CLAIMED and 1 PENDING", counts, delistingClaimLimit)
	}
}

// @AC-19: the response is read from the database, not from this instance's in-memory flagged set.
func TestSyncWatchlistDelistings_AC19_ReadsFlaggedRowsFromTheStore(t *testing.T) {
	rig := newSyncRig(t, testdata.ServableAssets())
	rig.store.seedFlagged(testdata.Roku, novDate(9), true)
	rig.store.rows[testdata.Roku].acked = true
	if rig.svc.delisting.flagged.Load() != nil {
		t.Fatal("precondition: the in-memory flagged set must be empty")
	}
	requireEntry(t, syncDelistings(t, rig, testdata.Roku), testdata.Roku, alertReported, true)
}

func TestSyncWatchlistDelistings_UsesOneAssetSetSnapshotPerCall(t *testing.T) {
	rig := newSyncRig(t, testdata.ServableAssets())
	rig.store.seedFlagged(testdata.Roku, novDate(9), false)
	rig.store.seedFlagged(testdata.Nwe, novDate(9), true)
	rig.store.rows[testdata.Nwe].acked = true
	rig.store.onClaim = func() {
		rig.svc.assets.snap.Store(newAssetSet(testdata.ServableAssetsWith(testdata.Roku, testdata.Nwe)))
	}
	got := syncDelistings(t, rig, testdata.Roku, testdata.Nwe)
	requireEntry(t, got, testdata.Roku, alertClaimed, true)
	requireEntry(t, got, testdata.Nwe, alertReported, true)
}

func TestSyncWatchlistDelistings_StoreErrorIsInternal(t *testing.T) {
	for _, method := range []string{"ReplaceWatched", "ClaimableSymbols", "ClaimAlerts", "FlaggedIn"} {
		rig := newSyncRig(t, testdata.ServableAssets())
		rig.store.seedFlagged(testdata.Roku, novDate(9), false)
		rig.store.failOn[method] = errors.New("connection reset")
		_, err := rig.svc.SyncWatchlistDelistings(portfolioCtx(), &marketdatav1.SyncWatchlistDelistingsRequest{Symbols: []string{testdata.Roku}})
		if connect.CodeOf(err) != connect.CodeInternal {
			t.Errorf("%s error: err = %v, want Internal", method, err)
		}
	}
}

func TestAckDelistingAlerts_DeniedWithoutTheGrant(t *testing.T) {
	rig := newSyncRig(t, testdata.ServableAssets())
	rig.store.seedFlagged(testdata.Roku, novDate(9), true)
	_, err := rig.svc.AckDelistingAlerts(callerCtx("portfolio", nil, false), &marketdatav1.AckDelistingAlertsRequest{Symbols: []string{testdata.Roku}})
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("err = %v, want PermissionDenied", err)
	}
	if row, _ := rig.store.row(testdata.Roku); row.acked || len(rig.store.methods()) != 0 {
		t.Error("a denied caller reached the store")
	}
}

func TestAckDelistingAlerts_AcknowledgesOnlyTheGivenSymbols(t *testing.T) {
	rig := newSyncRig(t, testdata.ServableAssets())
	rig.store.seedFlagged(testdata.Roku, novDate(9), true)
	rig.store.seedFlagged(testdata.Nwe, novDate(9), true)
	if _, err := rig.svc.AckDelistingAlerts(portfolioCtx(), &marketdatav1.AckDelistingAlertsRequest{Symbols: []string{" roku ", "roku"}}); err != nil {
		t.Fatalf("AckDelistingAlerts: %v", err)
	}
	acks := rig.store.callsOf("AckAlerts")
	if len(acks) != 1 || !slices.Equal(acks[0].symbols, []string{testdata.Roku}) {
		t.Fatalf("AckAlerts = %+v, want one call with [ROKU]", acks)
	}
	if roku, _ := rig.store.row(testdata.Roku); !roku.acked {
		t.Error("ROKU was not acknowledged")
	}
	if nwe, _ := rig.store.row(testdata.Nwe); nwe.acked {
		t.Error("NWE was acknowledged without being named")
	}

	tooMany := make([]string, syncMaxSymbols+1)
	_, err := rig.svc.AckDelistingAlerts(portfolioCtx(), &marketdatav1.AckDelistingAlertsRequest{Symbols: tooMany})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Errorf("20001 symbols: err = %v, want InvalidArgument", err)
	}

	rig.store.failOn["AckAlerts"] = errors.New("connection reset")
	_, err = rig.svc.AckDelistingAlerts(portfolioCtx(), &marketdatav1.AckDelistingAlertsRequest{Symbols: []string{testdata.Nwe}})
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Errorf("store error: err = %v, want Internal", err)
	}
}
