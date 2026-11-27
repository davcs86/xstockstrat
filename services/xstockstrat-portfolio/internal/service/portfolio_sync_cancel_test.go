package service

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/pashagolub/pgxmock/v4"

	"github.com/xstockstrat/portfolio/internal/config"
	"github.com/xstockstrat/portfolio/internal/repository"
)

// cancelingDB cancels the sync's context at the cancelAtExec-th Exec (1-based).
type cancelingDB struct {
	syncRecorderDB
	cancel       context.CancelFunc
	cancelAtExec int
	failOnCancel bool
}

func (d *cancelingDB) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	_, _ = d.syncRecorderDB.Exec(ctx, sql, args...)
	if len(d.execs) == d.cancelAtExec {
		d.cancel()
		if d.failOnCancel {
			return pgconn.CommandTag{}, ctx.Err()
		}
	}
	return pgconn.CommandTag{}, nil
}

func cancelSyncSvc(repo *repository.PortfolioRepo) *PortfolioService {
	return &PortfolioService{repo: repo, ledger: &fakeLedger{}, cfg: &config.Watcher{}}
}

func threePositions() []interface{} {
	return []interface{}{
		map[string]interface{}{"symbol": "AAPL", "qty": 10.0, "avg_cost": 150.0},
		map[string]interface{}{"symbol": "MSFT", "qty": 5.0, "avg_cost": 300.0},
		map[string]interface{}{"symbol": "NVDA", "qty": 2.0, "avg_cost": 900.0},
	}
}

func brokerSyncPayload(positions []interface{}) map[string]interface{} {
	return map[string]interface{}{
		"account_id": "brk-1", "user_id": "u1", "trading_mode": "TRADING_MODE_PAPER", "positions": positions,
	}
}

func warnCount(rec *warnRecorder) int {
	rec.mu.Lock()
	defer rec.mu.Unlock()
	return len(rec.recs)
}

func canceledCtx() context.Context {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	return ctx
}

func TestProcessPositionSync_AC1_CanceledCtxStopsLoopAfterFirstUpsert(t *testing.T) {
	rec := recordWarns(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	db := &cancelingDB{cancel: cancel, cancelAtExec: 1}

	err := cancelSyncSvc(repository.NewPortfolioRepoWithDB(db)).processPositionSync(ctx, syncEvent(t, 1, offlineSyncPayload(threePositions())))
	if len(db.execs) != 1 {
		t.Errorf("@AC-1: execs = %d, want 1 (no write after cancellation)", len(db.execs))
	}
	if !errors.Is(err, context.Canceled) {
		t.Errorf("@AC-1: err = %v, want context.Canceled", err)
	}
	if n := warnCount(rec); n != 0 {
		t.Errorf("@AC-1: %d WARN records, want 0: %v", n, rec.recs)
	}
}

func TestProcessPositionSync_AC2_WriteThatSeesCancellationStopsWithoutWarn(t *testing.T) {
	rec := recordWarns(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	db := &cancelingDB{cancel: cancel, cancelAtExec: 1, failOnCancel: true}

	err := cancelSyncSvc(repository.NewPortfolioRepoWithDB(db)).processPositionSync(ctx, syncEvent(t, 1, offlineSyncPayload(threePositions())))
	if len(db.execs) != 1 {
		t.Errorf("@AC-2: execs = %d, want 1", len(db.execs))
	}
	if db.find("DELETE FROM portfolio.positions") != nil {
		t.Errorf("@AC-2: DELETE ran after cancellation")
	}
	if n := warnCount(rec); n != 0 {
		t.Errorf("@AC-2: %d WARN records, want 0: %v", n, rec.recs)
	}
	if !errors.Is(err, context.Canceled) {
		t.Errorf("@AC-2: err = %v, want context.Canceled", err)
	}
}

func TestProcessPositionSync_AC3_CanceledOfflineSyncIsNeverParked(t *testing.T) {
	rec := recordWarns(t)
	db := &syncRecorderDB{}
	svc := cancelSyncSvc(repository.NewPortfolioRepoWithDB(db))
	handle := svc.boundedRetry("position sync", svc.processPositionSync)
	ev := syncEvent(t, 1, offlineSyncPayload([]interface{}{
		map[string]interface{}{"symbol": "AAPL", "qty": 10.0, "avg_cost": 150.0},
	}))

	err := handle(canceledCtx(), ev)
	if !errors.Is(err, context.Canceled) {
		t.Errorf("@AC-3: err = %v, want context.Canceled (cursor withheld)", err)
	}
	if db.find("offline_account_realized") != nil {
		t.Errorf("@AC-3: offline_account_realized written on a canceled ctx")
	}
	if len(db.execs) != 0 {
		t.Errorf("@AC-3: execs = %d, want 0", len(db.execs))
	}
	if n := parkedCount(rec); n != 0 {
		t.Errorf("@AC-3: event parked %d times, want 0", n)
	}
}

// Characterization guard (passes before and after Step 1): a live ctx whose write returns
// context.Canceled is keyed on ctx state, not error text, so the broker WARN-and-continue stays.
func TestProcessPositionSync_AC4_LiveCtxCanceledErrorStillWarns(t *testing.T) {
	rec := recordWarns(t)
	svc, mock, _ := newFillSvc(t)
	mock.ExpectExec("INSERT INTO portfolio.positions").WithArgs(anyArgs(15)...).WillReturnError(context.Canceled)
	mock.ExpectExec("DELETE FROM portfolio.positions").WithArgs(anyArgs(3)...).WillReturnResult(pgxmock.NewResult("DELETE", 0))

	pos := []interface{}{map[string]interface{}{"symbol": "AAPL", "qty": 10.0, "avg_cost": 150.0}}
	if err := svc.processPositionSync(context.Background(), syncEvent(t, 1, brokerSyncPayload(pos))); err != nil {
		t.Errorf("@AC-4: err = %v, want nil (broker sync is warn-and-continue)", err)
	}
	w := rec.find("upsert position from sync failed")
	if w == nil || w["symbol"] != "AAPL" {
		t.Errorf("@AC-4: upsert WARN for AAPL = %v, want recorded", w)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("@AC-4: %v", err)
	}
}

// Characterization guard (passes before and after Step 1): the feature-206 empty broker snapshot
// skip returns before any ctx check.
func TestProcessPositionSync_AC5_CanceledEmptyBrokerSnapshotStillSkips(t *testing.T) {
	recordWarns(t)
	db := &syncRecorderDB{}
	err := cancelSyncSvc(repository.NewPortfolioRepoWithDB(db)).processPositionSync(canceledCtx(), syncEvent(t, 1, brokerSyncPayload([]interface{}{})))
	if len(db.execs) != 0 {
		t.Errorf("@AC-5: execs = %d, want 0", len(db.execs))
	}
	if err != nil {
		t.Errorf("@AC-5: err = %v, want nil", err)
	}
}

func TestProcessPositionSync_AC10_CanceledBrokerSyncReturnsCancellation(t *testing.T) {
	rec := recordWarns(t)
	db := &syncRecorderDB{}
	pos := []interface{}{map[string]interface{}{"symbol": "AAPL", "qty": 10.0, "avg_cost": 150.0}}

	err := cancelSyncSvc(repository.NewPortfolioRepoWithDB(db)).processPositionSync(canceledCtx(), syncEvent(t, 1, brokerSyncPayload(pos)))
	if !errors.Is(err, context.Canceled) {
		t.Errorf("@AC-10: err = %v, want context.Canceled", err)
	}
	if len(db.execs) != 0 {
		t.Errorf("@AC-10: execs = %d, want 0", len(db.execs))
	}
	if n := warnCount(rec); n != 0 {
		t.Errorf("@AC-10: %d WARN records, want 0: %v", n, rec.recs)
	}
}

func deregisterPayload() map[string]interface{} {
	return map[string]interface{}{"account_id": "off-1", "user_id": "u1"}
}

func bracketPayload() map[string]interface{} {
	return map[string]interface{}{
		"user_id": "u1", "account_id": "brk-1", "symbol": "AAPL", "trading_mode": "TRADING_MODE_PAPER",
		"stop_order_id": "stop-1", "take_profit_order_id": "tp-1",
	}
}

func balancePayload() map[string]interface{} {
	return map[string]interface{}{
		"account_id": "brk-1", "user_id": "u1", "trading_mode": "TRADING_MODE_PAPER",
		"cash": 1000.0, "buying_power": 2000.0, "equity": 1500.0, "last_equity": 1400.0,
	}
}

// failingCanceledDB's first Exec cancels the returned ctx and fails with its error.
func failingCanceledDB() (context.Context, *cancelingDB) {
	ctx, cancel := context.WithCancel(context.Background())
	return ctx, &cancelingDB{cancel: cancel, cancelAtExec: 1, failOnCancel: true}
}

func TestProcessAccountDeregistered_CanceledCtxMakesNoWrite(t *testing.T) {
	rec := recordWarns(t)
	db := &syncRecorderDB{}

	err := cancelSyncSvc(repository.NewPortfolioRepoWithDB(db)).processAccountDeregistered(canceledCtx(), syncEvent(t, 1, deregisterPayload()))
	if !errors.Is(err, context.Canceled) {
		t.Errorf("err = %v, want context.Canceled", err)
	}
	if len(db.execs) != 0 {
		t.Errorf("execs = %d, want 0", len(db.execs))
	}
	if n := warnCount(rec); n != 0 {
		t.Errorf("%d WARN records, want 0: %v", n, rec.recs)
	}
}

func TestProcessAccountDeregistered_WriteThatSeesCancellationStopsWithoutWarn(t *testing.T) {
	rec := recordWarns(t)
	ctx, db := failingCanceledDB()

	err := cancelSyncSvc(repository.NewPortfolioRepoWithDB(db)).processAccountDeregistered(ctx, syncEvent(t, 1, deregisterPayload()))
	if len(db.execs) != 1 {
		t.Errorf("execs = %d, want 1", len(db.execs))
	}
	if db.find("DELETE FROM portfolio.offline_account_realized") != nil {
		t.Errorf("offline realized DELETE ran after cancellation")
	}
	if n := warnCount(rec); n != 0 {
		t.Errorf("%d WARN records, want 0: %v", n, rec.recs)
	}
	if !errors.Is(err, context.Canceled) {
		t.Errorf("err = %v, want context.Canceled", err)
	}
}

func TestProcessAccountDeregistered_CanceledIsNeverParked(t *testing.T) {
	rec := recordWarns(t)
	svc := cancelSyncSvc(repository.NewPortfolioRepoWithDB(&syncRecorderDB{}))
	handle := svc.boundedRetry("account deregistration", svc.processAccountDeregistered)

	if err := handle(canceledCtx(), syncEvent(t, 1, deregisterPayload())); !errors.Is(err, context.Canceled) {
		t.Errorf("err = %v, want context.Canceled (cursor withheld)", err)
	}
	if n := parkedCount(rec); n != 0 {
		t.Errorf("event parked %d times, want 0", n)
	}
}

// Characterization: keyed on ctx state, not error text, so a live ctx whose delete returns context.Canceled WARNs.
func TestProcessAccountDeregistered_LiveCtxCanceledErrorStillWarns(t *testing.T) {
	rec := recordWarns(t)
	svc, mock, _ := newFillSvc(t)
	mock.ExpectExec("DELETE FROM portfolio.positions").WithArgs("off-1").WillReturnError(context.Canceled)
	mock.ExpectExec("DELETE FROM portfolio.offline_account_realized").WithArgs("off-1").WillReturnResult(pgxmock.NewResult("DELETE", 0))

	if err := svc.processAccountDeregistered(context.Background(), syncEvent(t, 1, deregisterPayload())); err == nil {
		t.Errorf("err = nil, want the delete failure")
	}
	if w := rec.find("deregister: delete positions failed"); w == nil {
		t.Errorf("delete positions WARN not recorded: %v", rec.recs)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Error(err)
	}
}

func TestProcessBracketUpdate_DoneCtxWriteFailureLogsNoWarn(t *testing.T) {
	rec := recordWarns(t)
	ctx, db := failingCanceledDB()

	cancelSyncSvc(repository.NewPortfolioRepoWithDB(db)).processBracketUpdate(ctx, syncEvent(t, 1, bracketPayload()))
	if len(db.execs) != 1 {
		t.Errorf("execs = %d, want 1", len(db.execs))
	}
	if n := warnCount(rec); n != 0 {
		t.Errorf("%d WARN records, want 0: %v", n, rec.recs)
	}
}

func TestProcessBracketUpdate_LiveCtxWriteFailureStillWarns(t *testing.T) {
	rec := recordWarns(t)
	svc, mock, _ := newFillSvc(t)
	mock.ExpectExec("UPDATE portfolio.positions").WithArgs(anyArgs(6)...).WillReturnError(errDBBlip)

	svc.processBracketUpdate(context.Background(), syncEvent(t, 1, bracketPayload()))
	if w := rec.find("update position bracket failed"); w == nil || w["symbol"] != "AAPL" {
		t.Errorf("bracket WARN for AAPL = %v, want recorded", w)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Error(err)
	}
}

func TestProcessBalanceSync_DoneCtxWriteFailureLogsNoWarn(t *testing.T) {
	rec := recordWarns(t)
	ctx, db := failingCanceledDB()

	cancelSyncSvc(repository.NewPortfolioRepoWithDB(db)).processBalanceSync(ctx, syncEvent(t, 1, balancePayload()))
	if len(db.execs) != 1 {
		t.Errorf("execs = %d, want 1", len(db.execs))
	}
	if n := warnCount(rec); n != 0 {
		t.Errorf("%d WARN records, want 0: %v", n, rec.recs)
	}
}

// Characterization: a live-ctx balance write failure keeps its WARN.
func TestProcessBalanceSync_LiveCtxWriteFailureStillWarns(t *testing.T) {
	rec := recordWarns(t)
	svc, mock, _ := newFillSvc(t)
	mock.ExpectExec("INSERT INTO portfolio.account_balances").WithArgs(anyArgs(7)...).WillReturnError(errDBBlip)

	svc.processBalanceSync(context.Background(), syncEvent(t, 1, balancePayload()))
	if w := rec.find("upsert account balance failed"); w == nil || w["account_id"] != "brk-1" {
		t.Errorf("balance WARN for brk-1 = %v, want recorded", w)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Error(err)
	}
}

// Characterization (R-2): a done-ctx write failure is still acked, so the feature-294 outcome stays "acked".
func TestAckAlwaysConsumers_DoneCtxStillAck(t *testing.T) {
	recordWarns(t)
	for name, tc := range map[string]struct {
		handler func(*PortfolioService) eventHandler
		payload map[string]interface{}
	}{
		"bracket": {func(s *PortfolioService) eventHandler { return ackAlways(s.processBracketUpdate) }, bracketPayload()},
		"balance": {func(s *PortfolioService) eventHandler { return ackAlways(s.processBalanceSync) }, balancePayload()},
	} {
		ctx, db := failingCanceledDB()
		db.cancel()
		svc := cancelSyncSvc(repository.NewPortfolioRepoWithDB(db))
		if err := tc.handler(svc)(ctx, syncEvent(t, 1, tc.payload)); err != nil {
			t.Errorf("%s: err = %v, want nil (acked)", name, err)
		}
		if len(db.execs) != 1 {
			t.Errorf("%s: execs = %d, want 1 (the failing write ran)", name, len(db.execs))
		}
	}
}
