package service

import (
	"context"
	"testing"

	ledgerv1 "github.com/xstockstrat/contracts/gen/go/ledger/v1"
	"github.com/xstockstrat/portfolio/internal/config"
	"github.com/xstockstrat/portfolio/internal/repository"
)

// Feature 312 @AC-2: an owner-less ledger event is acked and skipped, never filed under a placeholder owner.

func typedSyncEvent(t *testing.T, seq int64, eventType string, payload map[string]interface{}) *ledgerv1.LedgerEvent {
	t.Helper()
	ev := syncEvent(t, seq, payload)
	ev.EventType = eventType
	return ev
}

func hasExecArg(db *syncRecorderDB, want string) bool {
	for _, e := range db.execs {
		for _, a := range e.args {
			if s, ok := a.(string); ok && s == want {
				return true
			}
		}
	}
	return false
}

func warnsForAccount(rec *warnRecorder, accountID string) int {
	rec.mu.Lock()
	defer rec.mu.Unlock()
	n := 0
	for _, r := range rec.recs {
		if r["account_id"] == accountID {
			n++
		}
	}
	return n
}

func TestOwnerlessEvent_AC2_AccountEventsSkipped(t *testing.T) {
	for _, tc := range []struct {
		eventType string
		payload   map[string]interface{}
		handle    func(*PortfolioService, context.Context, *ledgerv1.LedgerEvent) error
	}{
		{"account.positions.synced", map[string]interface{}{
			"account_id": "off-1", "trading_mode": "TRADING_MODE_PAPER", "realized_pnl": 500.0,
			"positions": []interface{}{map[string]interface{}{"symbol": "AAPL", "qty": 10.0, "avg_cost": 150.0}},
		}, (*PortfolioService).processPositionSync},
		{"account.balance.synced", map[string]interface{}{
			"account_id": "off-1", "trading_mode": "TRADING_MODE_PAPER", "cash": 100.0, "equity": 100.0,
		}, func(s *PortfolioService, ctx context.Context, ev *ledgerv1.LedgerEvent) error {
			s.processBalanceSync(ctx, ev)
			return nil
		}},
		{"account.deregistered", map[string]interface{}{"account_id": "off-1"}, (*PortfolioService).processAccountDeregistered},
	} {
		t.Run(tc.eventType, func(t *testing.T) {
			rec := recordWarns(t)
			db := &syncRecorderDB{}
			svc := &PortfolioService{repo: repository.NewPortfolioRepoWithDB(db), ledger: &fakeLedger{}, cfg: &config.Watcher{}}
			if err := tc.handle(svc, context.Background(), typedSyncEvent(t, 1, tc.eventType, tc.payload)); err != nil {
				t.Fatalf("owner-less event must be acked, got %v", err)
			}
			if hasExecArg(db, "default") {
				t.Errorf("owner-less event was filed under the \"default\" owner: %+v", db.execs)
			}
			if len(db.execs) != 0 {
				t.Errorf("owner-less event wrote %d row(s), want none: %+v", len(db.execs), db.execs)
			}
			if got := warnsForAccount(rec, "off-1"); got != 1 {
				t.Errorf("WARN records carrying account_id off-1 = %d, want 1 (records %v)", got, rec.recs)
			}
		})
	}
}

func TestOwnerlessEvent_AC2_FillWithoutAccountSkipped(t *testing.T) {
	recordWarns(t)
	db := &syncRecorderDB{}
	svc := &PortfolioService{repo: repository.NewPortfolioRepoWithDB(db), ledger: &fakeLedger{}, cfg: &config.Watcher{}}
	ev := typedSyncEvent(t, 1, "order.filled", map[string]interface{}{
		"user_id": "u1", "symbol": "AAPL", "qty": 5.0, "fill_price": 100.0,
		"trading_mode": "TRADING_MODE_PAPER", "order_id": "ord-1",
	})
	if err := svc.processOrderFill(context.Background(), ev); err != nil {
		t.Fatalf("fill without account_id must be acked, got %v", err)
	}
	if hasExecArg(db, "alpaca-default") {
		t.Errorf("fill without account_id was filed under \"alpaca-default\": %+v", db.execs)
	}
	if len(db.execs) != 0 {
		t.Errorf("fill without account_id wrote %d row(s), want none: %+v", len(db.execs), db.execs)
	}
}

func TestOwnerlessEvent_AC2_AckedNotParked(t *testing.T) {
	for _, tc := range []struct {
		consumer, eventType string
		ownerless, owned    map[string]interface{}
		handler             func(*PortfolioService) eventHandler
	}{
		{"position sync", "account.positions.synced",
			map[string]interface{}{"account_id": "off-1", "trading_mode": "TRADING_MODE_PAPER", "positions": []interface{}{}, "realized_pnl": 500.0},
			offlineSyncPayload([]interface{}{}),
			func(s *PortfolioService) eventHandler { return s.processPositionSync }},
		{"account deregistration", "account.deregistered",
			map[string]interface{}{"account_id": "off-1"},
			map[string]interface{}{"account_id": "off-1", "user_id": "u1"},
			func(s *PortfolioService) eventHandler { return s.processAccountDeregistered }},
	} {
		t.Run(tc.eventType, func(t *testing.T) {
			rec := recordWarns(t)
			db := &syncRecorderDB{}
			svc := &PortfolioService{repo: repository.NewPortfolioRepoWithDB(db), cfg: &config.Watcher{}, ledger: &streamLedger{events: []*ledgerv1.LedgerEvent{
				typedSyncEvent(t, 3, tc.eventType, tc.ownerless),
				typedSyncEvent(t, 4, tc.eventType, tc.owned),
			}}}
			handle := svc.boundedRetry(tc.consumer, tc.handler(svc))
			last, err := svc.streamEventsFrom(context.Background(), tc.eventType, 2, handle, nil)
			if err != nil {
				t.Fatalf("streamEventsFrom err = %v, want nil", err)
			}
			if last != 4 {
				t.Fatalf("lastSeq = %d, want 4 (owner-less seq 3 acked, seq 4 handled)", last)
			}
			if db.find("offline_account_realized") == nil {
				t.Errorf("the well-formed event at seq 4 wrote nothing: %+v", db.execs)
			}
			if hasExecArg(db, "default") {
				t.Errorf("owner-less event was filed under the \"default\" owner: %+v", db.execs)
			}
			if got := parkedCount(rec); got != 0 {
				t.Errorf("parked = %d, want 0", got)
			}
		})
	}
}
