package service

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/pashagolub/pgxmock/v4"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"

	ledgerv1 "github.com/xstockstrat/contracts/gen/go/ledger/v1"
	"github.com/xstockstrat/portfolio/internal/config"
	"github.com/xstockstrat/portfolio/internal/repository"
	"github.com/xstockstrat/portfolio/internal/testdata"
)

const (
	appliedSelectSQL  = `FROM portfolio\.consumer_applied_events`
	appliedInsertSQL  = `INSERT INTO portfolio\.consumer_applied_events`
	advisoryLockSQL   = `pg_advisory_xact_lock`
	lockedReadSQL     = `FOR UPDATE`
	positionUpsertSQL = `INSERT INTO portfolio\.positions`
	positionDeleteSQL = `DELETE FROM portfolio\.positions`
	pendingSetSQL     = `SET pending_closed = \$5::jsonb`
	pendingClearSQL   = `SET pending_closed = NULL`
	parkSQL           = `'parked'`

	foldUser    = "u1"
	foldSymbol  = "AAPL"
	foldAccount = "acc-1"
	foldPaper   = "TRADING_MODE_PAPER"
)

var (
	appliedCols = []string{"event_id", "outcome", "pending_closed"}
	lockedCols  = []string{"qty", "avg_entry_price", "cost_basis", "realized_accum", "fees_accum", "opened_at"}
	foldOpened  = time.Date(2026, 11, 2, 14, 30, 0, 0, time.UTC)
)

// recordingDB records the SQL of every pool-level call (transaction statements are not recorded).
type recordingDB struct {
	pgxmock.PgxPoolIface
	mu   sync.Mutex
	sqls []string
}

func (d *recordingDB) note(sql string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.sqls = append(d.sqls, sql)
}

func (d *recordingDB) calls() []string {
	d.mu.Lock()
	defer d.mu.Unlock()
	return append([]string(nil), d.sqls...)
}

func (d *recordingDB) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	d.note(sql)
	return d.PgxPoolIface.QueryRow(ctx, sql, args...)
}

func (d *recordingDB) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	d.note(sql)
	return d.PgxPoolIface.Query(ctx, sql, args...)
}

func (d *recordingDB) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	d.note(sql)
	return d.PgxPoolIface.Exec(ctx, sql, args...)
}

func (d *recordingDB) Begin(ctx context.Context) (pgx.Tx, error) {
	d.note("BEGIN")
	return d.PgxPoolIface.Begin(ctx)
}

// readSideEffects counts the risk and snapshot reads, the only pool calls that touch positions or balances.
func (d *recordingDB) readSideEffects() int {
	n := 0
	for _, sql := range d.calls() {
		if strings.Contains(sql, "FROM portfolio.positions") || strings.Contains(sql, "portfolio.account_balances") {
			n++
		}
	}
	return n
}

func newFoldSvc(t *testing.T) (*PortfolioService, pgxmock.PgxPoolIface, *recordingDB, *fakeLedger) {
	t.Helper()
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mock.Close)
	db := &recordingDB{PgxPoolIface: mock}
	ledger := &fakeLedger{}
	svc := &PortfolioService{
		repo: repository.NewPortfolioRepoWithDB(db), ledger: ledger, cfg: &config.Watcher{},
		marketdata: &stubMarketData{}, subs: map[string]snapshotSubscriber{},
	}
	return svc, mock, db, ledger
}

func foldFill(seq int64, orderID string, qty, price float64, side string) *ledgerv1.LedgerEvent {
	return testdata.FilledEvent(seq, orderID, foldUser, foldSymbol, foldAccount, foldPaper, qty, price, side)
}

func withFees(ev *ledgerv1.LedgerEvent, fees float64) *ledgerv1.LedgerEvent {
	ev.Payload.Fields["fees"] = structpb.NewNumberValue(fees)
	return ev
}

func lockedRow(mock pgxmock.PgxPoolIface, qty, cost, realized, fees float64) *pgxmock.Rows {
	return mock.NewRows(lockedCols).AddRow(qty, cost/qty, cost, realized, fees, foldOpened)
}

func expectNotApplied(mock pgxmock.PgxPoolIface) {
	mock.ExpectQuery(appliedSelectSQL).WithArgs(anyArgs(4)...).WillReturnRows(mock.NewRows(appliedCols))
}

// expectLockedRead expects ApplyFill up to its FOR UPDATE read; row nil means no position row.
func expectLockedRead(mock pgxmock.PgxPoolIface, row *pgxmock.Rows) {
	mock.ExpectBegin()
	mock.ExpectExec(appliedInsertSQL).WithArgs(anyArgs(5)...).WillReturnResult(pgxmock.NewResult("INSERT", 1))
	mock.ExpectExec(advisoryLockSQL).WithArgs(pgxmock.AnyArg()).WillReturnResult(pgxmock.NewResult("SELECT", 1))
	if row == nil {
		row = mock.NewRows(lockedCols)
	}
	mock.ExpectQuery(lockedReadSQL).WithArgs(anyArgs(4)...).WillReturnRows(row)
}

func expectUpsert(mock pgxmock.PgxPoolIface, qty, avg, cost, realized, fees float64) {
	mock.ExpectExec(positionUpsertSQL).
		WithArgs(foldUser, foldSymbol, qty, avg, cost, foldPaper, foldAccount, realized, fees).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))
}

func expectCloseCommitted(mock pgxmock.PgxPoolIface) {
	mock.ExpectExec(positionDeleteSQL).WithArgs(anyArgs(4)...).WillReturnResult(pgxmock.NewResult("DELETE", 1))
	mock.ExpectExec(pendingSetSQL).WithArgs(anyArgs(5)...).WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	mock.ExpectCommit()
	mock.ExpectExec(pendingClearSQL).WithArgs(anyArgs(4)...).WillReturnResult(pgxmock.NewResult("UPDATE", 1))
}

func positionEmits(ledger *fakeLedger) []*ledgerv1.AppendEventRequest {
	var out []*ledgerv1.AppendEventRequest
	for _, r := range ledger.reqs {
		if strings.HasPrefix(r.EventType, "portfolio.position.") {
			out = append(out, r)
		}
	}
	return out
}

func num(req *ledgerv1.AppendEventRequest, key string) float64 {
	return req.GetPayload().GetFields()[key].GetNumberValue()
}

func metOrFatal(t *testing.T, mock pgxmock.PgxPoolIface) {
	t.Helper()
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// @AC-3: a sell of the whole long closes it and seals realized P&L.
func TestFillFold_AC3_SellClosesAndSealsRealized(t *testing.T) {
	svc, mock, _, ledger := newFoldSvc(t)
	ev := foldFill(7, "ord-sell", 10, 150, "ORDER_SIDE_SELL")
	expectNotApplied(mock)
	expectLockedRead(mock, lockedRow(mock, 10, 1000, 0, 0))
	expectCloseCommitted(mock)

	if err := svc.processOrderFill(context.Background(), ev); err != nil {
		t.Fatalf("processOrderFill: %v", err)
	}
	metOrFatal(t, mock)
	emits := positionEmits(ledger)
	if len(emits) != 1 || emits[0].EventType != "portfolio.position.closed" {
		t.Fatalf("position emits = %v, want one portfolio.position.closed", emits)
	}
	if got := num(emits[0], "realized_pnl"); got != 500 {
		t.Errorf("realized_pnl = %v, want 500", got)
	}
	if emits[0].IdempotencyKey != "position.closed:"+ev.EventId {
		t.Errorf("idempotency key = %q, want position.closed:%s", emits[0].IdempotencyKey, ev.EventId)
	}
	if got := emits[0].GetPayload().GetFields()["opened_at"].GetStringValue(); got != foldOpened.Format(time.RFC3339) {
		t.Errorf("opened_at = %q, want the locked row's %s", got, foldOpened.Format(time.RFC3339))
	}
}

// @AC-1: a redelivered fill hits the pre-check and changes nothing.
func TestFillFold_AC1_DuplicateHitsPreCheck(t *testing.T) {
	svc, mock, db, ledger := newFoldSvc(t)
	mock.ExpectQuery(appliedSelectSQL).WithArgs(repository.ConsumerOrderFill, foldUser, foldAccount, "ord-sell").
		WillReturnRows(mock.NewRows(appliedCols).AddRow("ev-7", "applied", nil))

	err := svc.processOrderFill(context.Background(), foldFill(9, "ord-sell", 10, 150, "ORDER_SIDE_SELL"))
	if !errors.Is(err, errFillAcked) {
		t.Fatalf("err = %v, want errFillAcked", err)
	}
	metOrFatal(t, mock)
	if calls := db.calls(); len(calls) != 1 {
		t.Fatalf("pool calls = %v, want only the pre-check (no transaction, no position write)", calls)
	}
	if ledger.calls != 0 {
		t.Fatalf("ledger AppendEvent calls = %d, want 0", ledger.calls)
	}
}

// @AC-1: a below-floor fill is acked with zero queries.
func TestFillFold_AC1_BelowFloorNoQuery(t *testing.T) {
	svc, mock, db, ledger := newFoldSvc(t)
	svc.fillFloor = testFillFloor
	ev := testdata.Stamped(foldFill(9, "ord-sell", 10, 150, "ORDER_SIDE_SELL"), testFillFloor.Add(-time.Second))

	if err := svc.processOrderFill(context.Background(), ev); !errors.Is(err, errFillAcked) {
		t.Fatalf("err = %v, want errFillAcked", err)
	}
	metOrFatal(t, mock)
	if calls := db.calls(); len(calls) != 0 || ledger.calls != 0 {
		t.Fatalf("pool calls = %v, ledger calls = %d, want none", calls, ledger.calls)
	}
}

// @AC-4 and @AC-5 (fold half): a take-profit leg's order.filled closes the long the entry opened.
func TestFillFold_AC4_AC5_LegFillClosesEntry(t *testing.T) {
	svc, mock, _, ledger := newFoldSvc(t)
	expectNotApplied(mock)
	expectLockedRead(mock, nil)
	expectUpsert(mock, 10, 100, 1000, 0, 0)
	mock.ExpectCommit()
	expectNotApplied(mock)
	expectLockedRead(mock, lockedRow(mock, 10, 1000, 0, 0))
	expectCloseCommitted(mock)

	if err := svc.processOrderFill(context.Background(), foldFill(1, "ord-entry", 10, 100, "ORDER_SIDE_BUY")); err != nil {
		t.Fatalf("entry fill: %v", err)
	}
	if err := svc.processOrderFill(context.Background(), foldFill(2, "leg-tp-1", 10, 110, "ORDER_SIDE_SELL")); err != nil {
		t.Fatalf("leg fill: %v", err)
	}
	metOrFatal(t, mock)
	emits := positionEmits(ledger)
	if len(emits) != 2 || emits[0].EventType != "portfolio.position.opened" || emits[1].EventType != "portfolio.position.closed" {
		t.Fatalf("position emits = %v, want opened then closed", emits)
	}
	if got := num(emits[1], "realized_pnl"); got != 100 {
		t.Errorf("sealed realized_pnl = %v, want 100", got)
	}
}

func TestFillFold_BuyAddsFromLockedRow(t *testing.T) {
	svc, mock, _, ledger := newFoldSvc(t)
	expectNotApplied(mock)
	expectLockedRead(mock, lockedRow(mock, 10, 1000, 5, 1))
	expectUpsert(mock, 15, 110, 1650, 5, 1.5)
	mock.ExpectCommit()

	if err := svc.processOrderFill(context.Background(), withFees(foldFill(3, "ord-add", 5, 130, "ORDER_SIDE_BUY"), 0.5)); err != nil {
		t.Fatalf("processOrderFill: %v", err)
	}
	metOrFatal(t, mock)
	emits := positionEmits(ledger)
	if len(emits) != 1 || emits[0].EventType != "portfolio.position.updated" || num(emits[0], "qty") != 15 {
		t.Fatalf("position emits = %v, want one portfolio.position.updated with qty 15", emits)
	}
}

// The sell is signed from side: before the fix it was added as a buy of 4.
func TestFillFold_PartialSellReducesWithLockedAccumulators(t *testing.T) {
	svc, mock, _, ledger := newFoldSvc(t)
	expectNotApplied(mock)
	expectLockedRead(mock, lockedRow(mock, 10, 1000, 5, 1))
	expectUpsert(mock, 6, 100, 600, 85, 1.25)
	mock.ExpectCommit()

	if err := svc.processOrderFill(context.Background(), withFees(foldFill(4, "ord-trim", 4, 120, "ORDER_SIDE_SELL"), 0.25)); err != nil {
		t.Fatalf("processOrderFill: %v", err)
	}
	metOrFatal(t, mock)
	if emits := positionEmits(ledger); len(emits) != 1 || emits[0].EventType != "portfolio.position.updated" || num(emits[0], "qty") != 6 {
		t.Fatalf("position emits = %v, want one portfolio.position.updated with qty 6", emits)
	}
}

func TestFillFold_FlipClosesLongThenOpensFreshShort(t *testing.T) {
	svc, mock, _, ledger := newFoldSvc(t)
	ev := foldFill(5, "ord-flip", 15, 120, "ORDER_SIDE_SELL")
	expectNotApplied(mock)
	expectLockedRead(mock, lockedRow(mock, 10, 1000, 7, 2))
	mock.ExpectExec(positionDeleteSQL).WithArgs(anyArgs(4)...).WillReturnResult(pgxmock.NewResult("DELETE", 1))
	expectUpsert(mock, -5, 120, -600, 0, 0)
	mock.ExpectExec(pendingSetSQL).WithArgs(anyArgs(5)...).WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	mock.ExpectCommit()
	mock.ExpectExec(pendingClearSQL).WithArgs(anyArgs(4)...).WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	if err := svc.processOrderFill(context.Background(), ev); err != nil {
		t.Fatalf("processOrderFill: %v", err)
	}
	metOrFatal(t, mock)
	emits := positionEmits(ledger)
	if len(emits) != 2 || emits[0].EventType != "portfolio.position.closed" || emits[1].EventType != "portfolio.position.opened" {
		t.Fatalf("position emits = %v, want closed then opened", emits)
	}
	if got := num(emits[0], "realized_pnl"); got != 207 {
		t.Errorf("closed realized_pnl = %v, want 207 (accum 7 + 10 x 20)", got)
	}
	if got := num(emits[0], "fees_total"); got != 2 {
		t.Errorf("closed fees_total = %v, want 2", got)
	}
	if got := num(emits[1], "qty"); got != -5 {
		t.Errorf("opened qty = %v, want -5", got)
	}
}

// 029 @AC-10: the close payload carries fees_total, and realized_pnl stays gross.
func TestFillFold_029AC10_CloseCarriesFeesTotalAndGrossRealized(t *testing.T) {
	svc, mock, _, ledger := newFoldSvc(t)
	expectNotApplied(mock)
	expectLockedRead(mock, lockedRow(mock, 10, 1000, 0, 2))
	expectCloseCommitted(mock)

	if err := svc.processOrderFill(context.Background(), withFees(foldFill(6, "ord-out", 10, 150, "ORDER_SIDE_SELL"), 1)); err != nil {
		t.Fatalf("processOrderFill: %v", err)
	}
	metOrFatal(t, mock)
	emits := positionEmits(ledger)
	if len(emits) != 1 {
		t.Fatalf("position emits = %v, want one", emits)
	}
	if got := num(emits[0], "realized_pnl"); got != 500 {
		t.Errorf("realized_pnl = %v, want gross 500", got)
	}
	if got := num(emits[0], "fees_total"); got != 3 {
		t.Errorf("fees_total = %v, want 3", got)
	}
	if got := num(emits[0], "cost_basis"); got != 1000 {
		t.Errorf("cost_basis = %v, want 1000", got)
	}
}

func TestFillFold_SideFallbackResolvesThroughOrderSide(t *testing.T) {
	svc, mock, _, _ := newFoldSvc(t)
	svc.ledger = &testdata.Ledger{Events: []*ledgerv1.LedgerEvent{testdata.CreatedEvent(1, "ord-old", foldSymbol, "ORDER_SIDE_SELL", 4)}}
	expectNotApplied(mock)
	expectLockedRead(mock, lockedRow(mock, 10, 1000, 0, 0))
	expectUpsert(mock, 6, 100, 600, 80, 0)
	mock.ExpectCommit()

	if err := svc.processOrderFill(context.Background(), foldFill(2, "ord-old", 4, 120, "")); err != nil {
		t.Fatalf("processOrderFill: %v", err)
	}
	metOrFatal(t, mock)
}

func TestFillFold_UnattributableParksOnceThenAcks(t *testing.T) {
	svc, mock, _, ledger := newFoldSvc(t)
	svc.ledger = &testdata.Ledger{}
	ev := foldFill(3, "ord-lost", 4, 120, "")
	expectNotApplied(mock)
	mock.ExpectQuery(parkSQL).WithArgs(repository.ConsumerOrderFill, foldUser, foldAccount, "ord-lost", ev.EventId, pgxmock.AnyArg()).
		WillReturnRows(mock.NewRows([]string{"consumer"}).AddRow(repository.ConsumerOrderFill))
	mock.ExpectQuery(appliedSelectSQL).WithArgs(anyArgs(4)...).
		WillReturnRows(mock.NewRows(appliedCols).AddRow(ev.EventId, "parked", nil))

	if err := svc.processOrderFill(context.Background(), ev); !errors.Is(err, ErrFillUnattributable) {
		t.Fatalf("first delivery err = %v, want ErrFillUnattributable", err)
	}
	if err := svc.processOrderFill(context.Background(), ev); !errors.Is(err, errFillAcked) {
		t.Fatalf("second delivery err = %v, want errFillAcked", err)
	}
	metOrFatal(t, mock)
	if ledger.calls != 0 {
		t.Fatalf("ledger AppendEvent calls = %d, want 0", ledger.calls)
	}
}

func TestFillFold_ParkConflictAcks(t *testing.T) {
	svc, mock, _, _ := newFoldSvc(t)
	svc.ledger = &testdata.Ledger{}
	expectNotApplied(mock)
	mock.ExpectQuery(parkSQL).WithArgs(anyArgs(6)...).WillReturnRows(mock.NewRows([]string{"consumer"}))

	if err := svc.processOrderFill(context.Background(), foldFill(3, "ord-lost", 4, 120, "")); !errors.Is(err, errFillAcked) {
		t.Fatalf("err = %v, want errFillAcked (another delivery parked it)", err)
	}
	metOrFatal(t, mock)
}

func TestFillFold_SideLookupLedgerUnavailableParksNothing(t *testing.T) {
	svc, mock, db, _ := newFoldSvc(t)
	svc.ledger = &testdata.Ledger{OnQuery: func(context.Context, *ledgerv1.QueryEventsRequest) error {
		return status.Error(codes.Unavailable, "ledger down")
	}}
	expectNotApplied(mock)

	err := svc.processOrderFill(context.Background(), foldFill(3, "ord-old", 4, 120, ""))
	if !errors.Is(err, ErrLedgerUnavailable) {
		t.Fatalf("err = %v, want ErrLedgerUnavailable", err)
	}
	metOrFatal(t, mock)
	if calls := db.calls(); len(calls) != 1 {
		t.Fatalf("pool calls = %v, want only the pre-check (nothing parked)", calls)
	}
}

const storedClosed = `{"user_id":"u1","symbol":"AAPL","account_id":"acc-1","trading_mode":"TRADING_MODE_PAPER","realized_pnl":500,"fees_total":0}`

func TestFillFold_PendingClosedReEmittedUnderStoredEventID(t *testing.T) {
	svc, mock, db, ledger := newFoldSvc(t)
	mock.ExpectQuery(appliedSelectSQL).WithArgs(anyArgs(4)...).
		WillReturnRows(mock.NewRows(appliedCols).AddRow("ev-original", "applied", new(storedClosed)))
	mock.ExpectExec(pendingClearSQL).WithArgs(anyArgs(4)...).WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	if err := svc.processOrderFill(context.Background(), foldFill(9, "ord-sell", 10, 150, "ORDER_SIDE_SELL")); !errors.Is(err, errFillAcked) {
		t.Fatalf("err = %v, want errFillAcked", err)
	}
	metOrFatal(t, mock)
	emits := positionEmits(ledger)
	if len(emits) != 1 || emits[0].EventType != "portfolio.position.closed" || emits[0].IdempotencyKey != "position.closed:ev-original" {
		t.Fatalf("emits = %v, want one position.closed keyed position.closed:ev-original", emits)
	}
	if got := num(emits[0], "realized_pnl"); got != 500 {
		t.Errorf("realized_pnl = %v, want the stored 500", got)
	}
	if n := db.readSideEffects(); n != 0 {
		t.Fatalf("risk/snapshot reads = %d, want 0 on a pre-check hit", n)
	}
}

func TestFillFold_PendingClosedFailedAppendKeepsOutbox(t *testing.T) {
	svc, mock, _, ledger := newFoldSvc(t)
	ledger.err = status.Error(codes.Internal, "ledger rejected")
	mock.ExpectQuery(appliedSelectSQL).WithArgs(anyArgs(4)...).
		WillReturnRows(mock.NewRows(appliedCols).AddRow("ev-original", "applied", new(storedClosed)))

	if err := svc.processOrderFill(context.Background(), foldFill(9, "ord-sell", 10, 150, "ORDER_SIDE_SELL")); !errors.Is(err, errFillAcked) {
		t.Fatalf("err = %v, want errFillAcked", err)
	}
	metOrFatal(t, mock) // no ClearPendingClosed expected: a failed append leaves pending_closed set
	if ledger.calls != 1 {
		t.Fatalf("ledger AppendEvent calls = %d, want 1", ledger.calls)
	}
}

func TestFillFold_PendingClosedFailedClearIsNotAnError(t *testing.T) {
	svc, mock, _, ledger := newFoldSvc(t)
	mock.ExpectQuery(appliedSelectSQL).WithArgs(anyArgs(4)...).
		WillReturnRows(mock.NewRows(appliedCols).AddRow("ev-original", "applied", new(storedClosed)))
	mock.ExpectExec(pendingClearSQL).WithArgs(anyArgs(4)...).WillReturnError(errDBBlip)

	if err := svc.processOrderFill(context.Background(), foldFill(9, "ord-sell", 10, 150, "ORDER_SIDE_SELL")); !errors.Is(err, errFillAcked) {
		t.Fatalf("err = %v, want errFillAcked (a failed clear is a WARN only)", err)
	}
	metOrFatal(t, mock)
	if ledger.calls != 1 {
		t.Fatalf("ledger AppendEvent calls = %d, want 1", ledger.calls)
	}
}

func TestFillFold_InsertConflictAcksWithNoSideEffects(t *testing.T) {
	svc, mock, db, ledger := newFoldSvc(t)
	expectNotApplied(mock)
	mock.ExpectBegin()
	mock.ExpectExec(appliedInsertSQL).WithArgs(anyArgs(5)...).WillReturnResult(pgxmock.NewResult("INSERT", 0))
	mock.ExpectRollback()

	if err := svc.processOrderFill(context.Background(), foldFill(7, "ord-race", 10, 150, "ORDER_SIDE_SELL")); !errors.Is(err, errFillAcked) {
		t.Fatalf("err = %v, want errFillAcked", err)
	}
	metOrFatal(t, mock)
	if ledger.calls != 0 {
		t.Fatalf("ledger AppendEvent calls = %d, want 0 (the committing process owns the emit)", ledger.calls)
	}
	if n := db.readSideEffects(); n != 0 {
		t.Fatalf("risk/snapshot reads = %d, want 0", n)
	}
}

func TestFillFold_SkipClassNoQueryNoAppend(t *testing.T) {
	for name, ev := range map[string]*ledgerv1.LedgerEvent{
		"qty 0":          foldFill(1, "ord-1", 0, 100, "ORDER_SIDE_BUY"),
		"empty order_id": foldFill(1, "", 5, 100, "ORDER_SIDE_BUY"),
		"empty user_id":  testdata.FilledEvent(1, "ord-1", "", foldSymbol, foldAccount, foldPaper, 5, 100, "ORDER_SIDE_BUY"),
		"empty symbol":   testdata.FilledEvent(1, "ord-1", foldUser, "", foldAccount, foldPaper, 5, 100, "ORDER_SIDE_BUY"),
	} {
		t.Run(name, func(t *testing.T) {
			svc, mock, db, ledger := newFoldSvc(t)
			if err := svc.processOrderFill(context.Background(), ev); err != nil {
				t.Fatalf("err = %v, want nil", err)
			}
			metOrFatal(t, mock)
			if calls := db.calls(); len(calls) != 0 || ledger.calls != 0 {
				t.Fatalf("pool calls = %v, ledger calls = %d, want none", calls, ledger.calls)
			}
		})
	}
}

func TestFillFold_RiskAndSnapshotRunAfterCommit(t *testing.T) {
	svc, mock, _, ledger := newFoldSvc(t)
	expectNotApplied(mock)
	expectLockedRead(mock, nil)
	expectUpsert(mock, 5, 100, 500, 0, 0)
	mock.ExpectCommit()
	mock.ExpectQuery(`FROM portfolio\.positions`).WithArgs(anyArgs(4)...).WillReturnRows(mock.NewRows(positionCols))
	mock.ExpectQuery(`FROM portfolio\.account_balances`).WithArgs(anyArgs(2)...).
		WillReturnRows(mock.NewRows([]string{"account_id", "equity", "peak_equity"}))
	mock.ExpectQuery(`FROM portfolio\.positions`).WithArgs(anyArgs(4)...).WillReturnRows(mock.NewRows(positionCols))
	mock.ExpectExec(`INSERT INTO portfolio\.snapshots`).WithArgs(anyArgs(7)...).WillReturnResult(pgxmock.NewResult("INSERT", 1))

	if err := svc.processOrderFill(context.Background(), foldFill(1, "ord-new", 5, 100, "ORDER_SIDE_BUY")); err != nil {
		t.Fatalf("processOrderFill: %v", err)
	}
	metOrFatal(t, mock)
	var types []string
	for _, r := range ledger.reqs {
		types = append(types, r.EventType)
	}
	if strings.Join(types, ",") != "portfolio.position.opened,portfolio.snapshot" {
		t.Fatalf("emits = %v, want position.opened then portfolio.snapshot", types)
	}
}
