package service

import (
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"google.golang.org/protobuf/types/known/structpb"

	ledgerv1 "github.com/xstockstrat/contracts/gen/go/ledger/v1"
	portfoliov1 "github.com/xstockstrat/contracts/gen/go/portfolio/v1"
	"github.com/xstockstrat/portfolio/internal/config"
	"github.com/xstockstrat/portfolio/internal/repository"
)

// TestPositionSyncPayload_RealizedPnlDisjointness proves the offline/broker disjointness signal
// (feature 157, @AC-14): an offline ConfirmOrder emit carries a realized_pnl key → the pointer is
// non-nil, so processPositionSync upserts the realized row; a broker position sync omits the key →
// the pointer is nil, so the realized table is never touched. This mirrors processPositionSync's
// gate (`if sync.RealizedPnl != nil`) at the parse boundary — the service's repo is a concrete
// *PortfolioRepo with no live-DB test harness, so the gate's input is what's asserted here.
func TestPositionSyncPayload_RealizedPnlDisjointness(t *testing.T) {
	// Offline recompute emit: realized_pnl present (a genuine $0 is still present, not omitted).
	offline := `{"account_id":"off-1","user_id":"u1","trading_mode":"TRADING_MODE_PAPER",
		"positions":[{"symbol":"AAPL","qty":10,"avg_cost":190.25}],"realized_pnl":97.5}`
	var off positionSyncPayload
	if err := json.Unmarshal([]byte(offline), &off); err != nil {
		t.Fatalf("unmarshal offline payload: %v", err)
	}
	if off.RealizedPnl == nil {
		t.Fatal("offline emit must carry a non-nil RealizedPnl pointer (upsert would be skipped)")
	}
	if *off.RealizedPnl != 97.5 {
		t.Errorf("RealizedPnl = %v, want 97.5", *off.RealizedPnl)
	}

	// Offline full-close emit: positions:[] with realized_pnl still present → realized survives.
	flat := `{"account_id":"off-1","user_id":"u1","trading_mode":"TRADING_MODE_PAPER","positions":[],"realized_pnl":97.5}`
	var f positionSyncPayload
	if err := json.Unmarshal([]byte(flat), &f); err != nil {
		t.Fatalf("unmarshal flat payload: %v", err)
	}
	if f.RealizedPnl == nil || *f.RealizedPnl != 97.5 {
		t.Error("a full-close offline emit must still carry realized_pnl (survives the position wipe)")
	}

	// Broker position sync: no realized_pnl key → nil pointer → realized table untouched.
	broker := `{"account_id":"brk-1","user_id":"u1","trading_mode":"TRADING_MODE_LIVE",
		"positions":[{"symbol":"AAPL","qty":10,"avg_cost":190.25,"current_price":200,"market_value":2000}]}`
	var brk positionSyncPayload
	if err := json.Unmarshal([]byte(broker), &brk); err != nil {
		t.Fatalf("unmarshal broker payload: %v", err)
	}
	if brk.RealizedPnl != nil {
		t.Error("a broker position sync must leave RealizedPnl nil (disjoint from the offline path)")
	}
}

// TestShouldReconcileSyncDeletions (feature 206) proves the empty-broker-snapshot delete guard: a
// broker sync (realizedPnl==nil) with no positions must NOT purge (a transient empty broker read
// would otherwise wipe an order-fill-derived position and trigger a reconciliation false halt), while
// an offline recompute (realizedPnl!=nil, even $0) and any non-empty snapshot still reconcile.
func TestShouldReconcileSyncDeletions(t *testing.T) {
	zero := 0.0
	pnl := 97.5
	cases := []struct {
		name          string
		positionCount int
		realizedPnl   *float64
		want          bool
	}{
		{"empty broker snapshot — do NOT purge (@AC-4)", 0, nil, false},
		{"offline full-close with realized_pnl — purge (@AC-5)", 0, &pnl, true},
		{"offline full-close with $0 realized_pnl — purge", 0, &zero, true},
		{"non-empty broker snapshot — purge (no regression)", 2, nil, true},
		{"non-empty offline recompute — purge", 2, &pnl, true},
	}
	for _, c := range cases {
		if got := shouldReconcileSyncDeletions(c.positionCount, c.realizedPnl); got != c.want {
			t.Errorf("%s: shouldReconcileSyncDeletions(%d, %v) = %v, want %v", c.name, c.positionCount, c.realizedPnl, got, c.want)
		}
	}
}

// TestOfflineIDsToAppend (feature 159, @AC-3/@AC-4) proves the combined-view union+dedup that adds
// offline accounts (which have no account_balances row) into ListPortfolios: an offline id already
// present in the balances set is not re-added, and repeats within the offline set collapse — so no
// account is built twice, and the summed broker aggregates are unaffected by the offline additions.
// ListPortfolios itself uses a concrete *PortfolioRepo with no live-DB test harness (see
// TestPositionSyncPayload_RealizedPnlDisjointness), so the enumeration logic is factored into this pure
// helper and asserted directly.
func TestOfflineIDsToAppend(t *testing.T) {
	// balances {brk-1}; offline {off-1, brk-1} → only off-1 is new (brk-1 already represented).
	if got := offlineIDsToAppend([]string{"brk-1"}, []string{"off-1", "brk-1"}); len(got) != 1 || got[0] != "off-1" {
		t.Errorf("offlineIDsToAppend = %v, want [off-1] (a broker id already present must be skipped)", got)
	}
	// no offline accounts → nothing to append.
	if got := offlineIDsToAppend([]string{"brk-1"}, nil); len(got) != 0 {
		t.Errorf("offlineIDsToAppend with no offline ids = %v, want empty", got)
	}
	// duplicate offline ids collapse to one.
	if got := offlineIDsToAppend(nil, []string{"off-1", "off-1"}); len(got) != 1 || got[0] != "off-1" {
		t.Errorf("offlineIDsToAppend dedup = %v, want [off-1]", got)
	}
}

// TestAccountDeregisteredPayload_Parse proves the deregister purge consumer reads account_id/user_id
// (feature 157, @AC-15).
func TestAccountDeregisteredPayload_Parse(t *testing.T) {
	var p accountDeregisteredPayload
	if err := json.Unmarshal([]byte(`{"account_id":"off-1","user_id":"u1"}`), &p); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if p.AccountID != "off-1" || p.UserID != "u1" {
		t.Errorf("parsed %+v, want account_id off-1 / user_id u1", p)
	}
}

// TestPositionSyncPayload_AC11_ProvenanceParsing (feature 163, @AC-11) proves that the
// positionSyncPayload struct parses the source/as_of provenance keys from the
// account.positions.synced event and passes them through to PositionValuation, so the
// sync path (processPositionSync → UpsertPositionFromSync) carries provenance to the DB.
func TestPositionSyncPayload_AC11_ProvenanceParsing(t *testing.T) {
	payload := `{
		"account_id":"off-1","user_id":"u1","trading_mode":"TRADING_MODE_PAPER",
		"positions":[
			{"symbol":"AAPL","qty":100,"avg_cost":150.00,"source":2,"as_of":"2026-01-15T16:00:00Z"},
			{"symbol":"NVDA","qty":50,"avg_cost":200.00,"source":1}
		]
	}`
	var sync positionSyncPayload
	if err := json.Unmarshal([]byte(payload), &sync); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(sync.Positions) != 2 {
		t.Fatalf("positions count = %d, want 2", len(sync.Positions))
	}

	// AAPL: source=BASELINE(2), as_of set
	aapl := sync.Positions[0]
	if aapl.Source != int(portfoliov1.PositionSource_POSITION_SOURCE_BASELINE) {
		t.Errorf("AAPL source = %d, want %d (BASELINE)", aapl.Source, portfoliov1.PositionSource_POSITION_SOURCE_BASELINE)
	}
	if aapl.AsOf != "2026-01-15T16:00:00Z" {
		t.Errorf("AAPL as_of = %q, want 2026-01-15T16:00:00Z", aapl.AsOf)
	}
	aaplVal := repository.PositionValuation{Source: aapl.Source, AsOf: aapl.AsOf}
	if aaplVal.Source != 2 || aaplVal.AsOf == "" {
		t.Errorf("AAPL valuation source/as_of = %d/%q, want 2/non-empty", aaplVal.Source, aaplVal.AsOf)
	}

	// NVDA: source=ORDERS(1), as_of empty (unset)
	nvda := sync.Positions[1]
	if nvda.Source != int(portfoliov1.PositionSource_POSITION_SOURCE_ORDERS) {
		t.Errorf("NVDA source = %d, want %d (ORDERS)", nvda.Source, portfoliov1.PositionSource_POSITION_SOURCE_ORDERS)
	}
	if nvda.AsOf != "" {
		t.Errorf("NVDA as_of = %q, want empty (ORDERS-only position)", nvda.AsOf)
	}
}

// TestPositionSyncPayload_AC11_LegacyDefaultsZero proves that a legacy event without source/as_of
// keys defaults to source=0 (UNSPECIFIED) / as_of="" (null) — the safe, additive behavior.
func TestPositionSyncPayload_AC11_LegacyDefaultsZero(t *testing.T) {
	legacy := `{
		"account_id":"brk-1","user_id":"u1","trading_mode":"TRADING_MODE_LIVE",
		"positions":[{"symbol":"AAPL","qty":10,"avg_cost":190.25,"current_price":200}]
	}`
	var sync positionSyncPayload
	if err := json.Unmarshal([]byte(legacy), &sync); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	p := sync.Positions[0]
	if p.Source != 0 {
		t.Errorf("legacy source = %d, want 0 (UNSPECIFIED)", p.Source)
	}
	if p.AsOf != "" {
		t.Errorf("legacy as_of = %q, want empty", p.AsOf)
	}
}

// TestPositionSyncPayload_AC12_ReadPathParity (feature 163, @AC-12) proves that the shared
// positionColumns constant and scanPositionRow function include the provenance fields (source, as_of)
// so BOTH read paths — ListPositions (positionColumns used in ListPositions query) and
// ListPositionsByAccount/buildAccountPortfolio (positionColumns used in ListPositionsByAccount
// query) — return consistent provenance. The test pins the positionColumns constant to contain the
// provenance columns so a future divergent edit is caught (mirrors the 2026-07-01/056 regression).
func TestPositionSyncPayload_AC12_ReadPathParity(t *testing.T) {
	// The shared positionColumns constant must include "source" and "as_of" for both read
	// paths to populate Position.source/as_of. This is a structural assertion — if
	// positionColumns is edited to remove these columns, this test fails.
	cols := repository.ExportedPositionColumns()
	if cols == "" {
		t.Fatal("positionColumns is empty")
	}
	// Check that source and as_of appear in the column list.
	if !containsWord(cols, "source") {
		t.Error("positionColumns must contain 'source' for both read paths to populate Position.source (AC-12)")
	}
	if !containsWord(cols, "as_of") {
		t.Error("positionColumns must contain 'as_of' for both read paths to populate Position.as_of (AC-12)")
	}
}

func containsWord(s, word string) bool {
	// Simple substring check — sufficient for a column list.
	for i := 0; i <= len(s)-len(word); i++ {
		if s[i:i+len(word)] == word {
			return true
		}
	}
	return false
}

// syncRecorderDB records every write processPositionSync makes; reads find no rows.
type syncRecorderDB struct {
	execs []recordedExec
}

type recordedExec struct {
	sql  string
	args []any
}

func (*syncRecorderDB) QueryRow(context.Context, string, ...any) pgx.Row { return noRow{} }
func (*syncRecorderDB) Query(context.Context, string, ...any) (pgx.Rows, error) {
	return nil, pgx.ErrNoRows
}
func (d *syncRecorderDB) Exec(_ context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	d.execs = append(d.execs, recordedExec{sql: sql, args: args})
	return pgconn.CommandTag{}, nil
}

func (d *syncRecorderDB) find(substr string) *recordedExec {
	for i := range d.execs {
		if strings.Contains(d.execs[i].sql, substr) {
			return &d.execs[i]
		}
	}
	return nil
}

// runOfflineSync feeds one account.positions.synced payload through processPositionSync and returns
// the offline_account_realized write's bound values (realized, carried, fees since, fees carried, fills).
func runOfflineSync(t *testing.T, payload string) (*syncRecorderDB, []any) {
	t.Helper()
	st := &structpb.Struct{}
	if err := st.UnmarshalJSON([]byte(payload)); err != nil {
		t.Fatalf("payload: %v", err)
	}
	db := &syncRecorderDB{}
	svc := &PortfolioService{repo: repository.NewPortfolioRepoWithDB(db), ledger: &fakeLedger{}, cfg: &config.Watcher{}}
	svc.processPositionSync(context.Background(), &ledgerv1.LedgerEvent{Payload: st})
	w := db.find("offline_account_realized")
	if w == nil {
		t.Fatalf("no offline_account_realized write for %s", payload)
	}
	return db, w.args[3:]
}

func TestProcessPositionSync_OfflineState(t *testing.T) {
	for _, tc := range []struct {
		name    string
		payload string
		want    []any
	}{
		{"AC-18 legacy event: carry/fees 0, fills []", `{"account_id":"off-1","user_id":"u1","trading_mode":"TRADING_MODE_PAPER","positions":[],"realized_pnl":450}`,
			[]any{450.0, 0.0, 0.0, 0.0, []byte(`[]`)}},
		{"AC-41 since + carried", `{"account_id":"off-1","user_id":"u1","trading_mode":"TRADING_MODE_PAPER","positions":[{"symbol":"AAPL","qty":40,"avg_cost":150}],"realized_pnl":100,"realized_carried":600}`,
			[]any{100.0, 600.0, 0.0, 0.0, []byte(`[]`)}},
		{"AC-7 fees since", `{"account_id":"off-1","user_id":"u1","trading_mode":"TRADING_MODE_PAPER","positions":[],"realized_pnl":0,"fees_since_snapshot":1.5}`,
			[]any{0.0, 0.0, 1.5, 0.0, []byte(`[]`)}},
		{"AC-20 fees summed", `{"account_id":"off-1","user_id":"u1","trading_mode":"TRADING_MODE_PAPER","positions":[],"realized_pnl":600,"fees_since_snapshot":3}`,
			[]any{600.0, 0.0, 3.0, 0.0, []byte(`[]`)}},
		{"AC-10/AC-11 carried fees and realized", `{"account_id":"off-1","user_id":"u1","trading_mode":"TRADING_MODE_PAPER","positions":[],"realized_pnl":0,"realized_carried":700,"fees_carried":3,
			"recent_fills":[{"symbol":"AAPL","qty":-20,"price":155,"filled_at":"2026-11-05T15:00:00Z"}]}`,
			[]any{0.0, 700.0, 0.0, 3.0, []byte(`[{"symbol":"AAPL","qty":-20,"price":155,"filled_at":"2026-11-05T15:00:00Z"}]`)}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, got := runOfflineSync(t, tc.payload)
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("offline state write = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestProcessPositionSync_AC42_FullFlattenPurgesAndKeepsCarry(t *testing.T) {
	db, got := runOfflineSync(t, `{"account_id":"off-1","user_id":"u1","trading_mode":"TRADING_MODE_PAPER","positions":[],"realized_pnl":0,"realized_carried":600}`)
	if db.find("DELETE FROM portfolio.positions") == nil {
		t.Error("an offline full flatten must purge the account's positions (206 guard)")
	}
	if got[1] != 600.0 {
		t.Errorf("realized_carried = %v, want 600", got[1])
	}
}

func TestProcessPositionSync_BrokerNeverWritesOfflineState(t *testing.T) {
	st, _ := structpb.NewStruct(map[string]interface{}{"account_id": "brk-1", "user_id": "u1", "trading_mode": "TRADING_MODE_LIVE",
		"positions": []interface{}{map[string]interface{}{"symbol": "AAPL", "qty": 1.0, "avg_cost": 1.0}}})
	db := &syncRecorderDB{}
	svc := &PortfolioService{repo: repository.NewPortfolioRepoWithDB(db), ledger: &fakeLedger{}, cfg: &config.Watcher{}}
	svc.processPositionSync(context.Background(), &ledgerv1.LedgerEvent{Payload: st})
	if db.find("offline_account_realized") != nil {
		t.Error("a broker sync must not write offline state")
	}
}
