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
	"testing"
	"time"

	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	"google.golang.org/grpc"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	notifyv1 "github.com/xstockstrat/contracts/gen/go/notify/v1"
	"github.com/xstockstrat/marketdata/internal/repository"
	"github.com/xstockstrat/marketdata/internal/testdata"
)

const (
	delistingHookInfo = "delisting hook"
	delistingHookWarn = "delisting hook failed"
	delistingAlertOp  = "EmitAlert"

	reasonNotTradable = int16(commonv1.UnservableReason_UNSERVABLE_REASON_NOT_TRADABLE)
)

// delistingLog is the shared, ordered record of store calls and alert sends.
type delistingLog struct {
	mu     sync.Mutex
	events []string
}

func (l *delistingLog) add(e string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.events = append(l.events, e)
}

func (l *delistingLog) snapshot() []string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return slices.Clone(l.events)
}

func (l *delistingLog) reset() {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.events = nil
}

type fakeProfileRow struct {
	date                    string
	reason                  int16
	flagged, claimed, acked bool
	claimedAt               time.Time
}

type fakeProfileCall struct {
	method   string
	symbols  []string
	day      string
	entered  time.Time
	deadline time.Time
}

// fakeProfileStore is an in-memory model of marketdata.symbol_profile and marketdata.watched_symbol
// with ProfileRepo's statement semantics. Slice arguments are snapshotted at call entry.
type fakeProfileStore struct {
	mu      sync.Mutex
	log     *delistingLog
	rows    map[string]*fakeProfileRow
	watched map[string]struct{}
	calls   []fakeProfileCall
	failOn  map[string]error
	blockOn string
	now     func() time.Time
	onClaim func()
}

func newFakeProfileStore() *fakeProfileStore {
	return &fakeProfileStore{log: &delistingLog{}, rows: map[string]*fakeProfileRow{}, watched: map[string]struct{}{}, failOn: map[string]error{}, now: time.Now}
}

func (f *fakeProfileStore) enter(ctx context.Context, method, day string, symbols []string) error {
	call := fakeProfileCall{method: method, symbols: slices.Clone(symbols), day: day, entered: time.Now()}
	call.deadline, _ = ctx.Deadline()
	f.mu.Lock()
	f.calls = append(f.calls, call)
	err, block := f.failOn[method], f.blockOn == method
	f.mu.Unlock()
	f.log.add(method)
	if block {
		<-ctx.Done()
		return ctx.Err()
	}
	return err
}

func (f *fakeProfileStore) watch(symbols ...string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, s := range symbols {
		f.watched[s] = struct{}{}
	}
}

func (f *fakeProfileStore) seedStarted(sym, date string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.rows[sym] = &fakeProfileRow{date: date, reason: reasonNotTradable}
}

func (f *fakeProfileStore) seedFlagged(sym, date string, claimed bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.rows[sym] = &fakeProfileRow{date: date, reason: reasonNotTradable, flagged: true, claimed: claimed, claimedAt: f.now()}
}

func (f *fakeProfileStore) row(sym string) (fakeProfileRow, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	r, ok := f.rows[sym]
	if !ok {
		return fakeProfileRow{}, false
	}
	return *r, true
}

func (f *fakeProfileStore) methods() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]string, len(f.calls))
	for i, c := range f.calls {
		out[i] = c.method
	}
	return out
}

func (f *fakeProfileStore) callsOf(method string) []fakeProfileCall {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []fakeProfileCall
	for _, c := range f.calls {
		if c.method == method {
			out = append(out, c)
		}
	}
	return out
}

func (f *fakeProfileStore) resetCalls() {
	f.mu.Lock()
	f.calls = nil
	f.mu.Unlock()
	f.log.reset()
}

func (f *fakeProfileStore) claimable(r *fakeProfileRow, lease time.Duration) bool {
	return r.flagged && !r.acked && (!r.claimed || r.claimedAt.Before(f.now().Add(-lease)))
}

func sortedKeys[V any](m map[string]V) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func (f *fakeProfileStore) Candidates(ctx context.Context) ([]string, int, error) {
	if err := f.enter(ctx, "Candidates", "", nil); err != nil {
		return nil, 0, err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	set := map[string]struct{}{}
	for s := range f.watched {
		set[s] = struct{}{}
	}
	for s, r := range f.rows {
		if r.date != "" {
			set[s] = struct{}{}
		}
	}
	return sortedKeys(set), len(f.watched), nil
}

func (f *fakeProfileStore) ResetServable(ctx context.Context, servable []string) (int64, error) {
	if err := f.enter(ctx, "ResetServable", "", servable); err != nil {
		return 0, err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	var n int64
	for _, s := range servable {
		if r, ok := f.rows[s]; ok && !r.flagged && r.date != "" {
			r.date, r.reason = "", 0
			n++
		}
	}
	return n, nil
}

func (f *fakeProfileStore) ResetUnwatched(ctx context.Context) (int64, error) {
	if err := f.enter(ctx, "ResetUnwatched", "", nil); err != nil {
		return 0, err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.watched) == 0 {
		return 0, nil
	}
	var n int64
	for s, r := range f.rows {
		if _, watched := f.watched[s]; !watched && !r.flagged && r.date != "" {
			r.date, r.reason = "", 0
			n++
		}
	}
	return n, nil
}

func (f *fakeProfileStore) Start(ctx context.Context, day string, unservable []repository.SymbolReason) (int64, error) {
	symbols := make([]string, len(unservable))
	for i, u := range unservable {
		symbols[i] = u.Symbol
	}
	if err := f.enter(ctx, "Start", day, symbols); err != nil {
		return 0, err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	var n int64
	for _, u := range unservable {
		if _, watched := f.watched[u.Symbol]; !watched {
			continue
		}
		r, ok := f.rows[u.Symbol]
		if !ok {
			r = &fakeProfileRow{}
			f.rows[u.Symbol] = r
		}
		if r.date == "" {
			r.date, r.reason = day, u.Reason
			n++
		}
	}
	return n, nil
}

func (f *fakeProfileStore) Flag(ctx context.Context, cutoff string, unservable []string) ([]string, error) {
	if err := f.enter(ctx, "Flag", cutoff, unservable); err != nil {
		return nil, err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []string
	for _, s := range unservable {
		r, ok := f.rows[s]
		if _, watched := f.watched[s]; ok && watched && !r.flagged && r.date != "" && r.date <= cutoff {
			r.flagged = true
			out = append(out, s)
		}
	}
	sort.Strings(out)
	return out, nil
}

func (f *fakeProfileStore) Recover(ctx context.Context, servable []string) ([]repository.RecoveredRow, error) {
	if err := f.enter(ctx, "Recover", "", servable); err != nil {
		return nil, err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []repository.RecoveredRow
	for _, s := range servable {
		if r, ok := f.rows[s]; ok && r.flagged {
			out = append(out, repository.RecoveredRow{Symbol: s, AlertClaimed: r.claimed})
			*r = fakeProfileRow{}
		}
	}
	return out, nil
}

func (f *fakeProfileStore) FlaggedSymbols(ctx context.Context) ([]string, error) {
	if err := f.enter(ctx, "FlaggedSymbols", "", nil); err != nil {
		return nil, err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []string
	for _, s := range sortedKeys(f.rows) {
		if f.rows[s].flagged {
			out = append(out, s)
		}
	}
	return out, nil
}

func (f *fakeProfileStore) ReplaceWatched(ctx context.Context, symbols []string) error {
	if err := f.enter(ctx, "ReplaceWatched", "", symbols); err != nil {
		return err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.watched = map[string]struct{}{}
	for _, s := range symbols {
		f.watched[s] = struct{}{}
	}
	return nil
}

func (f *fakeProfileStore) ClaimableSymbols(ctx context.Context, lease time.Duration) ([]string, error) {
	if err := f.enter(ctx, "ClaimableSymbols", "", nil); err != nil {
		return nil, err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []string
	for _, s := range sortedKeys(f.rows) {
		if f.claimable(f.rows[s], lease) {
			out = append(out, s)
		}
	}
	return out, nil
}

func (f *fakeProfileStore) ClaimAlerts(ctx context.Context, symbols []string, lease time.Duration, limit int) ([]repository.ClaimedRow, error) {
	if err := f.enter(ctx, "ClaimAlerts", "", symbols); err != nil {
		return nil, err
	}
	if f.onClaim != nil {
		f.onClaim()
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	sorted := slices.Clone(symbols)
	sort.Strings(sorted)
	var out []repository.ClaimedRow
	for _, s := range sorted {
		r, ok := f.rows[s]
		if !ok || !f.claimable(r, lease) || len(out) == limit {
			continue
		}
		out = append(out, repository.ClaimedRow{
			FlaggedRow: repository.FlaggedRow{Symbol: s, FirstUnservableDate: r.date, Reason: r.reason, AlertClaimed: true},
			Reclaim:    r.claimed,
		})
		r.claimed, r.claimedAt = true, f.now()
	}
	return out, nil
}

func (f *fakeProfileStore) FlaggedIn(ctx context.Context, symbols []string) ([]repository.FlaggedRow, error) {
	if err := f.enter(ctx, "FlaggedIn", "", symbols); err != nil {
		return nil, err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	sorted := slices.Clone(symbols)
	sort.Strings(sorted)
	var out []repository.FlaggedRow
	for _, s := range sorted {
		if r, ok := f.rows[s]; ok && r.flagged {
			out = append(out, repository.FlaggedRow{Symbol: s, FirstUnservableDate: r.date, Reason: r.reason, AlertClaimed: r.claimed, AlertAcked: r.acked})
		}
	}
	return out, nil
}

func (f *fakeProfileStore) AckAlerts(ctx context.Context, symbols []string) (int64, error) {
	if err := f.enter(ctx, "AckAlerts", "", symbols); err != nil {
		return 0, err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	var n int64
	for _, s := range symbols {
		if r, ok := f.rows[s]; ok && r.flagged && r.claimed && !r.acked {
			r.acked = true
			n++
		}
	}
	return n, nil
}

// delistingNotify records every alert and can block a send until its context ends.
type delistingNotify struct {
	notifyv1.NotifyServiceClient
	mu     sync.Mutex
	log    *delistingLog
	alerts []*notifyv1.EmitAlertRequest
	block  bool
}

func (n *delistingNotify) EmitAlert(ctx context.Context, in *notifyv1.EmitAlertRequest, _ ...grpc.CallOption) (*notifyv1.EmitAlertResponse, error) {
	n.log.add(delistingAlertOp)
	n.mu.Lock()
	n.alerts = append(n.alerts, in)
	block := n.block
	n.mu.Unlock()
	if block {
		<-ctx.Done()
		return nil, ctx.Err()
	}
	return &notifyv1.EmitAlertResponse{}, nil
}

func (n *delistingNotify) sent() []*notifyv1.EmitAlertRequest {
	n.mu.Lock()
	defer n.mu.Unlock()
	return slices.Clone(n.alerts)
}

type delistingRig struct {
	svc    *MarketDataService
	src    *fakeAssetSource
	store  *fakeProfileStore
	notify *delistingNotify
	cfg    fakeIntGetter
	mu     sync.Mutex
	now    time.Time
}

func nyTime(t *testing.T, y int, m time.Month, d, hour, minute int) time.Time {
	t.Helper()
	loc, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Fatalf("load America/New_York: %v", err)
	}
	return time.Date(y, m, d, hour, minute, 0, 0, loc)
}

// nov is noon New York time on a November 2026 day (2026-11-09 is a Monday).
func nov(t *testing.T, day int) time.Time { return nyTime(t, 2026, time.November, day, 12, 0) }

func novDate(day int) string { return fmt.Sprintf("2026-11-%02d", day) }

// newDelistingRig builds a service over store (a fresh one when nil) with the clock fixed at now.
func newDelistingRig(now time.Time, store *fakeProfileStore) *delistingRig {
	if store == nil {
		store = newFakeProfileStore()
	}
	svc, src := newAssetSvc()
	rig := &delistingRig{svc: svc, src: src, store: store, notify: &delistingNotify{log: store.log}, cfg: fakeIntGetter{}, now: now}
	svc.notify = rig.notify
	svc.budgetCfg = rig.cfg
	svc.barsStore = &holdRecordingBarsStore{}
	svc.assets.now = func() time.Time {
		rig.mu.Lock()
		defer rig.mu.Unlock()
		return rig.now
	}
	svc.SetSymbolProfiles(store)
	return rig
}

func (r *delistingRig) queue(now time.Time, reply assetReply) {
	r.mu.Lock()
	r.now = now
	r.mu.Unlock()
	r.src.mu.Lock()
	r.src.replies = append(r.src.replies, reply)
	r.src.mu.Unlock()
}

// load runs one successful asset-set load at now through refreshAssets.
func (r *delistingRig) load(t *testing.T, now time.Time, assets []*commonv1.Asset) {
	t.Helper()
	r.queue(now, assetReply{assets: assets})
	mustRefresh(t, r.svc)
}

func (r *delistingRig) flaggedSet() []string {
	set := r.svc.delisting.flagged.Load()
	if set == nil {
		return nil
	}
	return sortedKeys(*set)
}

func requireRow(t *testing.T, store *fakeProfileStore, sym, wantDate string, wantFlagged bool) {
	t.Helper()
	row, ok := store.row(sym)
	if !ok || row.date != wantDate || row.flagged != wantFlagged {
		t.Fatalf("%s row = %+v (present %v), want date %q flagged %v", sym, row, ok, wantDate, wantFlagged)
	}
}

func delistingFailures(t *testing.T, reader *sdkmetric.ManualReader) map[string]int64 {
	t.Helper()
	var rm metricdata.ResourceMetrics
	if err := reader.Collect(context.Background(), &rm); err != nil {
		t.Fatalf("collect: %v", err)
	}
	out := map[string]int64{}
	for _, sm := range rm.ScopeMetrics {
		for _, m := range sm.Metrics {
			sum, ok := m.Data.(metricdata.Sum[int64])
			if !ok || m.Name != "marketdata.delisting.hook_failures" {
				continue
			}
			for _, dp := range sum.DataPoints {
				reason, _ := dp.Attributes.Value("reason")
				out[reason.AsString()] += dp.Value
			}
		}
	}
	return out
}

var (
	withRoku    = testdata.ServableAssetsWith(testdata.Roku)
	withoutRoku = testdata.ServableAssets()
)

// @AC-1: unservable in every load of five consecutive trading days → flagged on the fifth, with
// the first unservable day and the reason observed then.
func TestDelisting_AC1_FlaggedAfterFiveTradingDays(t *testing.T) {
	rig := newDelistingRig(nov(t, 6), nil)
	rig.store.watch(testdata.Roku, testdata.Aapl)
	rig.load(t, nov(t, 6), withRoku)
	for day := 9; day <= 12; day++ {
		rig.load(t, nov(t, day), withoutRoku)
		requireRow(t, rig.store, testdata.Roku, novDate(9), false)
	}
	rig.load(t, nov(t, 13), withoutRoku)
	requireRow(t, rig.store, testdata.Roku, novDate(9), true)
	if row, _ := rig.store.row(testdata.Roku); row.reason != reasonNotTradable {
		t.Errorf("reason = %d, want UNSERVABLE_REASON_NOT_TRADABLE", row.reason)
	}
	if got := rig.flaggedSet(); !slices.Equal(got, []string{testdata.Roku}) {
		t.Errorf("flagged set = %v, want [ROKU]", got)
	}
}

// @AC-2: one unservable day is not a delisting; the symbol stays in the warm set.
func TestDelisting_AC2_OneDayOutageIsNotFlagged(t *testing.T) {
	rig := newDelistingRig(nov(t, 13), nil)
	rig.store.watch(testdata.Roku)
	rig.load(t, nov(t, 13), withRoku)
	rig.svc.markWarm(testdata.Roku)
	rig.load(t, nov(t, 16), withoutRoku)
	rig.load(t, nov(t, 17), withoutRoku)
	requireRow(t, rig.store, testdata.Roku, novDate(16), false)
	if !isWarm(rig.svc, testdata.Roku) {
		t.Error("ROKU left the warm set before it was flagged")
	}
}

// @AC-3: a refresh rejected by the shrink guard never reaches the hook.
func TestDelisting_AC3_RejectedRefreshStartsNothing(t *testing.T) {
	rig := newDelistingRig(nov(t, 9), nil)
	rig.store.watch(testdata.Aapl)
	full := append(testdata.SyntheticAssets(13500), testdata.ServableAssets()...)
	rig.load(t, nov(t, 9), full)
	rig.store.resetCalls()

	rig.queue(nov(t, 10), assetReply{assets: testdata.SyntheticAssets(100)})
	if err := rig.svc.refreshAssets(context.Background()); err == nil {
		t.Fatal("a 100-asset refresh after 13506 was accepted")
	}
	if calls := rig.store.methods(); len(calls) != 0 {
		t.Fatalf("store calls after a rejected refresh = %v, want none", calls)
	}

	rig.load(t, nov(t, 11), testdata.SyntheticAssets(13500))
	starts := rig.store.callsOf("Start")
	if len(starts) != 1 || !slices.Contains(starts[0].symbols, testdata.Aapl) {
		t.Fatalf("Start calls after the accepted refresh = %+v, want one naming AAPL", starts)
	}
	requireRow(t, rig.store, testdata.Aapl, novDate(11), false)
}

// @AC-4: a flagged watchlist symbol that is servable again is cleared by the next trading-day load.
func TestDelisting_AC4_RecoveryClearsFlagOfWatchedSymbol(t *testing.T) {
	rig := newDelistingRig(nov(t, 13), nil)
	rig.store.watch(testdata.Roku)
	rig.store.seedFlagged(testdata.Roku, novDate(9), false)
	rig.load(t, nov(t, 13), withRoku)
	requireRow(t, rig.store, testdata.Roku, "", false)
	if got := rig.flaggedSet(); len(got) != 0 {
		t.Errorf("flagged set = %v, want empty", got)
	}
}

// @AC-5: recovery ignores the union and never re-adds the symbol to it.
func TestDelisting_AC5_RecoveryOffWatchlistWritesNoUnion(t *testing.T) {
	rig := newDelistingRig(nov(t, 13), nil)
	rig.store.watch(testdata.Aapl)
	rig.store.seedFlagged(testdata.Roku, novDate(9), false)
	rig.load(t, nov(t, 13), withRoku)
	requireRow(t, rig.store, testdata.Roku, "", false)
	if calls := rig.store.callsOf("ReplaceWatched"); len(calls) != 0 {
		t.Errorf("the hook wrote the union: %+v", calls)
	}
	if _, watched := rig.store.watched[testdata.Roku]; watched {
		t.Error("ROKU was added to the union by its recovery")
	}
}

// @AC-8: the load that flags a symbol removes it from the warm set, so the bar ingester stops
// requesting it.
func TestDelisting_AC8_FlaggedSymbolLeavesWarmSetAndIngester(t *testing.T) {
	rig := newDelistingRig(nov(t, 12), nil)
	rig.store.watch(testdata.Roku)
	rig.load(t, nov(t, 12), withRoku)
	rig.svc.markWarm(testdata.Aapl)
	rig.svc.markWarm(testdata.Roku)
	rig.store.seedStarted(testdata.Roku, novDate(9))

	rig.load(t, nov(t, 13), withoutRoku)
	requireRow(t, rig.store, testdata.Roku, novDate(9), true)
	if isWarm(rig.svc, testdata.Roku) {
		t.Error("ROKU still warm after the load that flagged it")
	}
	if got := rig.svc.warmSnapshot(); !slices.Equal(got, []string{testdata.Aapl}) {
		t.Fatalf("warmSnapshot = %v, want [AAPL]", got)
	}
	src := newRecordingBarsSource(testdata.Aapl)
	src.beginCycle(0)
	end := bhEnd(0)
	rig.svc.ingestRecentBarsForTimeframe(context.Background(), context.Background(), src, rig.svc.warmSnapshot(), bhTF, end.Add(-bhWindow), end)
	if req := src.requested[0]; !slices.Contains(req, testdata.Aapl) || slices.Contains(req, testdata.Roku) {
		t.Errorf("ingest request = %v, want AAPL and not ROKU", req)
	}
}

// @AC-10 (guard): the quote/price path still warms a flagged symbol; the next load removes it again.
func TestDelisting_AC10_QuotePathStillWarmsFlaggedSymbol(t *testing.T) {
	rig := newDelistingRig(nov(t, 12), nil)
	rig.store.watch(testdata.Nwe)
	rig.store.seedFlagged(testdata.Nwe, novDate(2), true)
	rig.load(t, nov(t, 12), testdata.ServableAssets())

	rig.svc.markWarm(testdata.Nwe)
	if !isWarm(rig.svc, testdata.Nwe) {
		t.Fatal("markWarm refused a flagged symbol")
	}
	rig.load(t, nov(t, 13), testdata.ServableAssets())
	if isWarm(rig.svc, testdata.Nwe) {
		t.Error("the next load left the flagged symbol in the warm set")
	}
	requireRow(t, rig.store, testdata.Nwe, novDate(2), true)
}

// @AC-19: the flagged set comes from the database at boot, with no successful asset load.
func TestDelisting_AC19_FlaggedSetLoadedAtBootFromStore(t *testing.T) {
	first := newDelistingRig(nov(t, 13), nil)
	first.store.watch(testdata.Roku)
	first.store.seedStarted(testdata.Roku, novDate(9))
	first.load(t, nov(t, 13), withoutRoku)

	second := newDelistingRig(nov(t, 13), first.store)
	second.queue(nov(t, 13), assetReply{err: errors.New("alpaca down")})
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		second.svc.StartAssetSetRefresher(ctx)
	}()
	deadline := time.Now().Add(5 * time.Second)
	for len(second.flaggedSet()) == 0 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	cancel()
	<-done
	if got := second.flaggedSet(); !slices.Equal(got, []string{testdata.Roku}) {
		t.Fatalf("second instance flagged set = %v, want [ROKU]", got)
	}
	if second.svc.assets.snap.Load() != nil {
		t.Error("the asset set loaded; the boot read must not depend on it")
	}
}

// @AC-20: trading days are counted, so a weekend does not shorten the window.
func TestDelisting_AC20_WeekendDaysAreNotCounted(t *testing.T) {
	rig := newDelistingRig(nov(t, 12), nil)
	rig.store.watch(testdata.Roku)
	rig.load(t, nov(t, 12), withRoku)
	for _, day := range []int{13, 16, 17, 18} {
		rig.load(t, nov(t, day), withoutRoku)
	}
	requireRow(t, rig.store, testdata.Roku, novDate(13), false)
	rig.load(t, nov(t, 19), withoutRoku)
	requireRow(t, rig.store, testdata.Roku, novDate(13), true)
}

// @AC-21: the profile row is created on the first unservable observation, and only for that symbol.
func TestDelisting_AC21_RowCreatedOnFirstUnservableObservation(t *testing.T) {
	rig := newDelistingRig(nov(t, 9), nil)
	rig.store.watch(testdata.Roku, testdata.Aapl)
	rig.load(t, nov(t, 9), withoutRoku)
	requireRow(t, rig.store, testdata.Roku, novDate(9), false)
	if row, _ := rig.store.row(testdata.Roku); row.reason != reasonNotTradable {
		t.Errorf("reason = %d, want UNSERVABLE_REASON_NOT_TRADABLE", row.reason)
	}
	if _, ok := rig.store.row(testdata.Aapl); ok {
		t.Error("a servable symbol got a profile row")
	}
}

// @AC-25: a servable day in between restarts the count.
func TestDelisting_AC25_ServableDayRestartsTheWindow(t *testing.T) {
	rig := newDelistingRig(nov(t, 13), nil)
	rig.store.watch(testdata.Roku)
	rig.load(t, nov(t, 13), withRoku)
	rig.load(t, nov(t, 16), withoutRoku)
	rig.load(t, nov(t, 17), withoutRoku)
	rig.load(t, nov(t, 18), withRoku)
	requireRow(t, rig.store, testdata.Roku, "", false)
	for _, day := range []int{19, 20, 23, 24} {
		rig.load(t, nov(t, day), withoutRoku)
	}
	requireRow(t, rig.store, testdata.Roku, novDate(19), false)
	rig.load(t, nov(t, 25), withoutRoku)
	requireRow(t, rig.store, testdata.Roku, novDate(19), true)
}

// @AC-27: a flag persists while the symbol is on no watchlist and clears only on recovery.
func TestDelisting_AC27_FlagPersistsOffWatchlistUntilRecovery(t *testing.T) {
	rig := newDelistingRig(nov(t, 12), nil)
	rig.store.watch(testdata.Aapl)
	rig.store.seedFlagged(testdata.Roku, novDate(2), false)
	rig.load(t, nov(t, 12), withoutRoku)
	rig.load(t, nov(t, 13), withoutRoku)
	requireRow(t, rig.store, testdata.Roku, novDate(2), true)
	rig.load(t, nov(t, 16), withRoku)
	requireRow(t, rig.store, testdata.Roku, "", false)
}

// @AC-28: days without a load still count; the window is measured from the first unservable day.
func TestDelisting_AC28_MissedLoadsDoNotRestartTheWindow(t *testing.T) {
	rig := newDelistingRig(nov(t, 6), nil)
	rig.store.watch(testdata.Roku)
	rig.load(t, nov(t, 6), withRoku)
	rig.load(t, nov(t, 9), withoutRoku)
	requireRow(t, rig.store, testdata.Roku, novDate(9), false)
	rig.load(t, nov(t, 13), withoutRoku)
	requireRow(t, rig.store, testdata.Roku, novDate(9), true)
}

// @AC-29: recovery of a symbol whose flag alert was claimed sends exactly one recovery alert.
func TestDelisting_AC29_RecoveryAlertOnlyForClaimedFlagAlert(t *testing.T) {
	rig := newDelistingRig(nov(t, 13), nil)
	rig.store.watch(testdata.Kpti, testdata.Nwe)
	rig.store.seedFlagged(testdata.Kpti, novDate(2), true)
	rig.store.seedFlagged(testdata.Nwe, novDate(2), false)
	rig.load(t, nov(t, 13), testdata.ServableAssetsWith(testdata.Kpti, testdata.Nwe))

	alerts := rig.notify.sent()
	if len(alerts) != 1 {
		t.Fatalf("alerts = %d, want 1 (only KPTI's flag alert was claimed)", len(alerts))
	}
	a := alerts[0]
	if a.GetSeverity() != notifyv1.AlertSeverity_ALERT_SEVERITY_WARNING || a.GetCategory() != "symbol_delisting" ||
		a.GetTargetUserId() != "" || a.GetSourceService() != "marketdata" || !strings.Contains(a.GetBody(), testdata.Kpti) {
		t.Errorf("recovery alert = %+v", a)
	}
	rig.load(t, nov(t, 16), testdata.ServableAssetsWith(testdata.Kpti, testdata.Nwe))
	if got := len(rig.notify.sent()); got != 1 {
		t.Errorf("alerts after the next load = %d, want still 1", got)
	}
}

func TestDelisting_TruthTable(t *testing.T) {
	const (
		absent   = "absent"
		reset    = "reset"
		started  = "started"
		elapsed  = "started-elapsed"
		flagged  = "flagged"
		inUnion  = "in"
		notIn    = "not-in"
		emptySet = "empty"
	)
	cases := []struct {
		state, union string
		servable     bool
		want         string
	}{
		{absent, inUnion, false, started},
		{absent, notIn, false, absent},
		{absent, emptySet, false, absent},
		{absent, inUnion, true, absent},
		{absent, notIn, true, absent},
		{absent, emptySet, true, absent},
		{reset, inUnion, false, started},
		{reset, notIn, false, reset},
		{reset, emptySet, false, reset},
		{reset, inUnion, true, reset},
		{started, inUnion, false, started},
		{elapsed, inUnion, false, flagged},
		{started, notIn, false, reset},
		{started, emptySet, false, started},
		{started, inUnion, true, reset},
		{started, notIn, true, reset},
		{started, emptySet, true, reset},
		{flagged, inUnion, false, flagged},
		{flagged, notIn, false, flagged},
		{flagged, emptySet, false, flagged},
		{flagged, inUnion, true, reset},
		{flagged, notIn, true, reset},
		{flagged, emptySet, true, reset},
	}
	for _, tc := range cases {
		t.Run(fmt.Sprintf("%s/servable=%v/%s", tc.state, tc.servable, tc.union), func(t *testing.T) {
			rig := newDelistingRig(nov(t, 13), nil)
			switch tc.union {
			case inUnion:
				rig.store.watch(testdata.Roku)
			case notIn:
				rig.store.watch(testdata.Aapl)
			}
			seededDate := novDate(12)
			switch tc.state {
			case reset:
				rig.store.rows[testdata.Roku] = &fakeProfileRow{}
			case started:
				rig.store.seedStarted(testdata.Roku, seededDate)
			case elapsed:
				seededDate = novDate(9)
				rig.store.seedStarted(testdata.Roku, seededDate)
			case flagged:
				seededDate = novDate(2)
				rig.store.seedFlagged(testdata.Roku, seededDate, false)
			}
			assets := withoutRoku
			if tc.servable {
				assets = withRoku
			}
			rig.load(t, nov(t, 13), assets)

			row, ok := rig.store.row(testdata.Roku)
			var got string
			switch {
			case !ok:
				got = absent
			case row.flagged:
				got = flagged
			case row.date != "":
				got = started
			default:
				got = reset
			}
			if got != tc.want {
				t.Fatalf("row after the load = %s (%+v), want %s", got, row, tc.want)
			}
			if tc.want == started && tc.state != started && row.date != novDate(13) {
				t.Errorf("a new window started on %s, want %s", row.date, novDate(13))
			}
			if (tc.want == flagged || (tc.want == started && tc.state == started)) && row.date != seededDate {
				t.Errorf("first-unservable date changed to %s, want %s", row.date, seededDate)
			}
		})
	}
}

func TestDelisting_StatementOrderThenRebuildThenAlert(t *testing.T) {
	rig := newDelistingRig(nov(t, 13), nil)
	rig.store.watch(testdata.Aapl)
	rig.store.seedFlagged(testdata.Roku, novDate(2), true)
	rig.load(t, nov(t, 13), withRoku)
	want := []string{"Candidates", "ResetServable", "ResetUnwatched", "Start", "Flag", "Recover", "FlaggedSymbols", delistingAlertOp}
	if got := rig.store.log.snapshot(); !slices.Equal(got, want) {
		t.Fatalf("order = %v, want %v", got, want)
	}
}

func TestDelisting_ClosedDayRunsNoTransition(t *testing.T) {
	logs := installLogRecorder(t, slog.LevelInfo)
	rig := newDelistingRig(nov(t, 14), nil)
	rig.store.watch(testdata.Roku)
	rig.store.seedFlagged(testdata.Nwe, novDate(2), false)
	rig.load(t, nov(t, 14), withoutRoku)
	if got := rig.store.methods(); !slices.Equal(got, []string{"FlaggedSymbols"}) {
		t.Fatalf("store calls on a Saturday = %v, want only the rebuild", got)
	}
	if got := rig.flaggedSet(); !slices.Equal(got, []string{testdata.Nwe}) {
		t.Errorf("flagged set = %v, want [NWE]", got)
	}
	if rec := logs.find(delistingHookInfo); rec == nil || rec.attrs["skipped"] != "closed_day" {
		t.Errorf("INFO %q = %+v, want skipped=closed_day", delistingHookInfo, rec)
	}
}

func TestDelisting_EmptyUnionIsNamedInTheInfo(t *testing.T) {
	logs := installLogRecorder(t, slog.LevelInfo)
	rig := newDelistingRig(nov(t, 13), nil)
	rig.load(t, nov(t, 13), withoutRoku)
	if rec := logs.find(delistingHookInfo); rec == nil || rec.attrs["skipped"] != "empty_union" || rec.attrs["watched"] != "0" {
		t.Errorf("INFO %q = %+v, want skipped=empty_union watched=0", delistingHookInfo, rec)
	}
	if slices.Contains(rig.store.methods(), "ResetUnwatched") {
		t.Error("H2 ran with an empty union")
	}
}

func TestDelisting_UsesTheNewYorkCalendarDate(t *testing.T) {
	for _, at := range []struct{ hour, minute int }{{17, 59}, {18, 1}} {
		rig := newDelistingRig(nov(t, 13), nil)
		rig.store.watch(testdata.Roku)
		rig.load(t, nyTime(t, 2026, time.November, 13, at.hour, at.minute), withoutRoku)
		starts := rig.store.callsOf("Start")
		if len(starts) != 1 || starts[0].day != novDate(13) {
			t.Errorf("load at Friday %02d:%02d New York: Start = %+v, want day %s", at.hour, at.minute, starts, novDate(13))
		}
	}
}

func TestDelisting_ResolveConfirmationDays(t *testing.T) {
	cases := []struct {
		name string
		cfg  intGetter
		want int
	}{
		{"nil cfg reads as 5", nil, 5},
		{"unset reads as 5", fakeIntGetter{}, 5},
		{"zero reads as 5", fakeIntGetter{delistingConfirmationDaysKey: 0}, 5},
		{"negative reads as 5", fakeIntGetter{delistingConfirmationDaysKey: -1}, 5},
		{"31 reads as 30", fakeIntGetter{delistingConfirmationDaysKey: 31}, 30},
		{"7 reads as 7", fakeIntGetter{delistingConfirmationDaysKey: 7}, 7},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := resolveDelistingConfirmationDays(tc.cfg); got != tc.want {
				t.Errorf("resolveDelistingConfirmationDays = %d, want %d", got, tc.want)
			}
		})
	}
}

// Config-key wiring (b): the reader reads exactly the key the config migration seeds (literal, not the const).
func TestResolveDelistingConfirmationDays_ReadsSeededKey(t *testing.T) {
	cfg := fakeIntGetter{"assets.delisting_confirmation_trading_days": 7}
	if got := resolveDelistingConfirmationDays(cfg); got != 7 {
		t.Errorf("resolveDelistingConfirmationDays = %d, want 7", got)
	}
}

func TestDelisting_WindowOfOneStartsAndFlagsOnTheSameLoad(t *testing.T) {
	rig := newDelistingRig(nov(t, 13), nil)
	rig.cfg[delistingConfirmationDaysKey] = 1
	rig.store.watch(testdata.Roku)
	rig.load(t, nov(t, 13), withoutRoku)
	requireRow(t, rig.store, testdata.Roku, novDate(13), true)
}

func TestDelisting_ChangedWindowAppliesOnTheNextLoad(t *testing.T) {
	rig := newDelistingRig(nov(t, 9), nil)
	rig.store.watch(testdata.Roku)
	rig.load(t, nov(t, 9), withoutRoku)
	rig.load(t, nov(t, 10), withoutRoku)
	requireRow(t, rig.store, testdata.Roku, novDate(9), false)
	rig.cfg[delistingConfirmationDaysKey] = 3
	rig.load(t, nov(t, 11), withoutRoku)
	requireRow(t, rig.store, testdata.Roku, novDate(9), true)
}

func TestDelisting_StatementErrorStopsTransitionsButRebuilds(t *testing.T) {
	reader := serviceMetricReader(t)
	logs := installWarnRecorder(t)
	rig := newDelistingRig(nov(t, 13), nil)
	rig.store.watch(testdata.Roku)
	rig.store.seedFlagged(testdata.Nwe, novDate(2), false)
	rig.store.failOn["Start"] = errors.New("deadlock detected")
	rig.queue(nov(t, 13), assetReply{assets: withoutRoku})
	if err := rig.svc.refreshAssets(context.Background()); err != nil {
		t.Fatalf("refreshAssets = %v, want nil: the hook must never fail the load", err)
	}
	want := []string{"Candidates", "ResetServable", "ResetUnwatched", "Start", "FlaggedSymbols"}
	if got := rig.store.methods(); !slices.Equal(got, want) {
		t.Fatalf("store calls = %v, want %v", got, want)
	}
	if got := rig.flaggedSet(); !slices.Equal(got, []string{testdata.Nwe}) {
		t.Errorf("flagged set = %v, want [NWE]", got)
	}
	if got := delistingFailures(t, reader); got["error"] != 1 || got["timeout"] != 0 {
		t.Errorf("hook_failures = %v, want error=1", got)
	}
	if logs.count(delistingHookWarn) != 1 {
		t.Errorf("WARN %q logged %d times, want 1", delistingHookWarn, logs.count(delistingHookWarn))
	}
}

func TestDelisting_TimeoutIsCountedAndNeverFailsTheLoad(t *testing.T) {
	reader := serviceMetricReader(t)
	rig := newDelistingRig(nov(t, 13), nil)
	rig.store.watch(testdata.Roku)
	rig.store.blockOn = "Candidates"
	rig.queue(nov(t, 13), assetReply{assets: withoutRoku})
	const budget = 40 * time.Millisecond
	ctx, cancel := context.WithTimeout(context.Background(), budget)
	defer cancel()
	if err := rig.svc.refreshAssets(ctx); err != nil {
		t.Fatalf("refreshAssets = %v, want nil", err)
	}
	calls := rig.store.callsOf("Candidates")
	if len(calls) != 1 {
		t.Fatalf("Candidates calls = %d, want 1", len(calls))
	}
	if calls[0].deadline.IsZero() || calls[0].deadline.Sub(calls[0].entered) > budget {
		t.Errorf("deadline is %v after call entry, want within the %v parent budget", calls[0].deadline.Sub(calls[0].entered), budget)
	}
	if got := delistingFailures(t, reader); got["timeout"] != 1 || got["error"] != 0 {
		t.Errorf("hook_failures = %v, want timeout=1", got)
	}
}

func TestDelisting_HookContextIsBoundedAtThirtySeconds(t *testing.T) {
	rig := newDelistingRig(nov(t, 13), nil)
	rig.store.watch(testdata.Roku)
	rig.load(t, nov(t, 13), withoutRoku)
	call := rig.store.callsOf("Candidates")[0]
	if d := call.deadline.Sub(call.entered); call.deadline.IsZero() || d > delistingHookTimeout || d < delistingHookTimeout-5*time.Second {
		t.Errorf("hook deadline is %v after call entry, want about %v", d, delistingHookTimeout)
	}
}

func TestDelisting_BlockedRecoveryAlertDoesNotPreventTheRebuild(t *testing.T) {
	logs := installWarnRecorder(t)
	rig := newDelistingRig(nov(t, 13), nil)
	rig.store.watch(testdata.Aapl)
	rig.store.seedFlagged(testdata.Roku, novDate(2), true)
	rig.store.seedFlagged(testdata.Nwe, novDate(2), false)
	rig.notify.block = true
	rig.queue(nov(t, 13), assetReply{assets: withRoku})
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Millisecond)
	defer cancel()
	if err := rig.svc.refreshAssets(ctx); err != nil {
		t.Fatalf("refreshAssets = %v, want nil", err)
	}
	if got := rig.flaggedSet(); !slices.Equal(got, []string{testdata.Nwe}) {
		t.Errorf("flagged set = %v, want [NWE] (rebuilt before the alert)", got)
	}
	if logs.count("delisting recovery alert not sent") != 1 {
		t.Error("the cut-off recovery alert was not logged at WARN")
	}
	if logs.count(delistingHookWarn) != 0 {
		t.Error("a cut-off alert was reported as a hook failure")
	}
}

func TestDelisting_NoStoreWiredIsANoOp(t *testing.T) {
	svc, _ := newAssetSvc(assetReply{assets: withRoku}, assetReply{assets: withoutRoku})
	mustRefresh(t, svc)
	mustRefresh(t, svc)
	if svc.delisting.flagged.Load() != nil {
		t.Error("a flagged set was built with no store wired")
	}
}

func TestDelisting_QuotaWarningKeepsItsTitleAndCategory(t *testing.T) {
	rig := newDelistingRig(nov(t, 13), nil)
	rig.svc.emitWarning(context.Background(), "fmp", "usage at 200/250")
	alerts := rig.notify.sent()
	if len(alerts) != 1 || alerts[0].GetCategory() != "system" || alerts[0].GetTitle() != "marketdata FMP quota warning" ||
		alerts[0].GetBody() != "usage at 200/250" || alerts[0].GetSeverity() != notifyv1.AlertSeverity_ALERT_SEVERITY_WARNING {
		t.Errorf("quota warning = %+v", alerts)
	}
}
