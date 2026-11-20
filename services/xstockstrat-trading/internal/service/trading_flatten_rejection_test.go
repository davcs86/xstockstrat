package service

import (
	"context"
	"errors"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"google.golang.org/grpc"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	portfoliov1 "github.com/xstockstrat/contracts/gen/go/portfolio/v1"
	tradingv1 "github.com/xstockstrat/contracts/gen/go/trading/v1"
	"github.com/xstockstrat/trading/internal/broker"
	"github.com/xstockstrat/trading/internal/config"
	"github.com/xstockstrat/trading/internal/repository"
)

// Regression suite for docs/reports/2026-10-02-flatten-rejection-skips-halt-defect.md (pruned
// 2026-10-05; git show 2ce8de0a:<path>): a broker-REJECTED flatten is a failure, and an exhausted
// retry budget always halts the account.

// execOnlyDB lets TradingRepo.UpsertOrder succeed without a database.
type execOnlyDB struct{}

func (execOnlyDB) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	return pgconn.CommandTag{}, nil
}
func (execOnlyDB) QueryRow(context.Context, string, ...any) pgx.Row { panic("unused") }
func (execOnlyDB) Query(context.Context, string, ...any) (pgx.Rows, error) {
	panic("unused")
}

// memIntentRepo is a stateful intent store, so a retry with the same intent id replays the
// stored outcome exactly as the real ON CONFLICT DO NOTHING repository does.
type memIntentRepo struct {
	repository.OrderIntentRepository
	mu   sync.Mutex
	recs map[string]*repository.OrderIntentRecord
}

func (m *memIntentRepo) InsertIntent(_ context.Context, rec *repository.OrderIntentRecord) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.recs[rec.IntentID]; ok {
		return false, nil
	}
	cp := *rec
	cp.State = repository.IntentStatePending
	cp.UpdatedAt = time.Now()
	m.recs[rec.IntentID] = &cp
	return true, nil
}

func (m *memIntentRepo) GetIntentByID(_ context.Context, id string) (*repository.OrderIntentRecord, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	cp := *m.recs[id]
	return &cp, nil
}

func (m *memIntentRepo) ReleasePendingIntent(_ context.Context, id string) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if rec, ok := m.recs[id]; !ok || rec.State != repository.IntentStatePending {
		return false, nil
	}
	delete(m.recs, id)
	return true, nil
}

func (m *memIntentRepo) FinalizeIntent(_ context.Context, id, _ string, state int16, resp []byte) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.recs[id].State = state
	m.recs[id].LatestResponse = resp
	return nil
}

type flattenPortfolio struct {
	portfoliov1.PortfolioServiceClient
}

func (flattenPortfolio) GetPosition(context.Context, *portfoliov1.GetPositionRequest, ...grpc.CallOption) (*portfoliov1.Position, error) {
	return &portfoliov1.Position{Symbol: "AAPL", Qty: 10}, nil
}

type flattenHarness struct {
	svc     *TradingService
	bracket *fakeBracketRepo
	mu      sync.Mutex
	ids     []string // broker client order id per SubmitOrder call
}

func newFlattenHarness(submit func(call int) (*broker.BrokerOrder, error)) *flattenHarness {
	h := &flattenHarness{bracket: &fakeBracketRepo{}}
	fb := &fakeBroker{submitOrderFn: func(_ context.Context, req broker.OrderRequest) (*broker.BrokerOrder, error) {
		h.mu.Lock()
		h.ids = append(h.ids, req.ClientOrderID)
		call := len(h.ids) - 1
		h.mu.Unlock()
		return submit(call)
	}}
	rec := &repository.OrderBracketRecord{AccountID: "acct-1", OrderID: "ord-1", Status: bracketStatusSubmitting}
	_ = h.bracket.CreateBracket(context.Background(), rec)
	h.svc = &TradingService{
		cfg: &config.Config{}, cfgW: &config.Watcher{}, platformCfgW: &config.Watcher{},
		repo: repository.NewTradingRepoWithDB(execOnlyDB{}), orderIntentRepo: &memIntentRepo{recs: map[string]*repository.OrderIntentRecord{}},
		bracketRepo: h.bracket, ledger: &fakeLedgerClient{}, notify: &fakeNotifyClient{}, accountRepo: &fakeAccountRepo{},
		portfolio: flattenPortfolio{},
		brokers:   map[string]brokerPoolEntry{"acct-1": {client: fb, brokerType: int32(commonv1.BrokerType_BROKER_TYPE_ALPACA), userID: "user-1"}},
		orders: map[string]*tradingv1.Order{"ord-1": {
			OrderId: "ord-1", UserId: "user-1", AccountId: "acct-1", Symbol: "AAPL",
			TradingMode: commonv1.TradingMode_TRADING_MODE_PAPER,
		}},
		halted: map[string]bool{}, haltReasons: map[string]string{}, haltedLastPolled: map[string]time.Time{},
	}
	return h
}

func (h *flattenHarness) run(t *testing.T) *repository.OrderBracketRecord {
	t.Helper()
	recs, _ := h.bracket.GetBracketByOrderID(context.Background(), "ord-1")
	h.svc.flattenAndHalt(context.Background(), recs)
	out, _ := h.bracket.GetBracketByOrderID(context.Background(), "ord-1")
	return out
}

var errBuyingPower = errors.New("alpaca order error (status 403): insufficient buying power")

func TestFlattenAndHalt_AlwaysRejected_HaltsAccount(t *testing.T) {
	h := newFlattenHarness(func(int) (*broker.BrokerOrder, error) { return nil, errBuyingPower })
	rec := h.run(t)

	if !h.svc.isAccountHalted("acct-1") {
		t.Fatal("account not halted after every flatten attempt was rejected (pre-fix: attempt 1 replayed REJECTED as success)")
	}
	if rec.Status == bracketStatusCanceled {
		t.Fatal("bracket marked CANCELED although the position was never flattened")
	}
	if len(h.ids) != 4 {
		t.Fatalf("broker submissions = %d, want 4 (one fresh order per attempt after a rejection)", len(h.ids))
	}
	seen := map[string]bool{}
	for _, id := range h.ids {
		if seen[id] {
			t.Fatalf("client order id %s reused after a definitive rejection: %v", id, h.ids)
		}
		seen[id] = true
	}
}

func TestFlattenAndHalt_RejectedThenAccepted_FlattensWithoutHalt(t *testing.T) {
	h := newFlattenHarness(func(call int) (*broker.BrokerOrder, error) {
		if call == 0 {
			return nil, errBuyingPower
		}
		return &broker.BrokerOrder{BrokerOrderID: "b-2", Status: "accepted"}, nil
	})
	rec := h.run(t)

	if h.svc.isAccountHalted("acct-1") {
		t.Fatal("account halted although the retry flattened the position")
	}
	if rec.Status != bracketStatusCanceled {
		t.Fatalf("bracket status = %v, want CANCELED", rec.Status)
	}
	if len(h.ids) != 2 || h.ids[0] == h.ids[1] {
		t.Fatalf("want 2 submissions with distinct client order ids, got %v", h.ids)
	}
}

func TestFlattenAndHalt_BrokerReportsRejectedStatus_IsFailure(t *testing.T) {
	h := newFlattenHarness(func(int) (*broker.BrokerOrder, error) {
		return &broker.BrokerOrder{BrokerOrderID: "b", Status: "rejected"}, nil
	})
	h.run(t)
	if !h.svc.isAccountHalted("acct-1") {
		t.Fatal("a REJECTED order status returned without error must count as a failed flatten")
	}
}

func TestFlattenAndHalt_UncertainTimeout_KeepsClientOrderID(t *testing.T) {
	h := newFlattenHarness(func(int) (*broker.BrokerOrder, error) { return nil, context.DeadlineExceeded })
	h.run(t)
	// The PENDING intent blocks every retry: re-minting here could double-flatten at the broker.
	if len(h.ids) != 1 {
		t.Fatalf("broker submissions = %d, want 1 (same intent id retained after an uncertain outcome)", len(h.ids))
	}
	if !h.svc.isAccountHalted("acct-1") {
		t.Fatal("exhausted retries must halt the account")
	}
}

type scopedFlattenPortfolio struct {
	portfoliov1.PortfolioServiceClient
	got *portfoliov1.GetPositionRequest
}

func (p *scopedFlattenPortfolio) GetPosition(_ context.Context, req *portfoliov1.GetPositionRequest, _ ...grpc.CallOption) (*portfoliov1.Position, error) {
	p.got = req
	return &portfoliov1.Position{Symbol: "AAPL", Qty: 10}, nil
}

// The flatten must size from the bracket's own account position — an unscoped read returns the
// latest row across all the user's accounts and over/under-sells on this one.
func TestFlattenAndHalt_ScopesPositionToBracketAccount(t *testing.T) {
	h := newFlattenHarness(func(int) (*broker.BrokerOrder, error) {
		return &broker.BrokerOrder{BrokerOrderID: "bo-flat", Status: "accepted"}, nil
	})
	pf := &scopedFlattenPortfolio{}
	h.svc.portfolio = pf
	h.run(t)
	if pf.got == nil || pf.got.GetAccountId() != "acct-1" {
		t.Fatalf("flatten GetPosition must be scoped to the bracket account acct-1, got %+v", pf.got)
	}
}

// haltRecordingBroker records each flatten submit's client order id and whether the account was already halted.
type haltRecordingBroker struct {
	broker.Broker
	svc    *TradingService
	mu     sync.Mutex
	ids    []string
	halted []bool
}

func (b *haltRecordingBroker) SubmitOrder(ctx context.Context, req broker.OrderRequest) (*broker.BrokerOrder, error) {
	b.mu.Lock()
	b.ids = append(b.ids, req.ClientOrderID)
	b.halted = append(b.halted, b.svc.isAccountHalted("acct-1"))
	b.mu.Unlock()
	return b.Broker.SubmitOrder(ctx, req)
}

// Feature 347 @AC-28: a rate-limited emergency flatten halts the account first and keeps retrying.
func TestFlattenAndHalt_RateLimitedHaltsFirstAndKeepsRetrying_F347_AC28(t *testing.T) {
	h := newRateLimitHarness(t, 5000, map[string]*tradingv1.Order{"ord-1": {
		OrderId: "ord-1", UserId: "user-1", AccountId: "acct-1", Symbol: "AAPL",
		TradingMode: commonv1.TradingMode_TRADING_MODE_PAPER,
	}}, func(_ int, w http.ResponseWriter, _ *http.Request) {
		rlExhaustedHeaders(w, 50*time.Second)
		w.WriteHeader(http.StatusTooManyRequests)
	})
	h.svc.portfolio, h.svc.accountRepo = flattenPortfolio{}, &fakeAccountRepo{}
	rec := &haltRecordingBroker{Broker: h.client, svc: h.svc}
	h.svc.brokers["acct-1"] = brokerPoolEntry{client: rec, brokerType: int32(commonv1.BrokerType_BROKER_TYPE_ALPACA), userID: "user-1"}
	bracket := &repository.OrderBracketRecord{AccountID: "acct-1", OrderID: "ord-1", Status: bracketStatusSubmitting}
	_ = h.bracket.CreateBracket(context.Background(), bracket)

	h.svc.flattenAndHalt(context.Background(), bracket)

	if len(rec.ids) != 4 {
		t.Fatalf("flatten submits = %d, want 4", len(rec.ids))
	}
	if rec.halted[0] || !rec.halted[1] {
		t.Fatalf("halted at each submit = %v, want the account halted before the second submit", rec.halted)
	}
	distinct := map[string]bool{}
	for _, id := range rec.ids {
		distinct[id] = true
	}
	if len(distinct) != 4 {
		t.Fatalf("client order ids = %v, want 4 distinct", rec.ids)
	}
	rejected := 0
	h.svc.mu.Lock()
	for id, o := range h.svc.orders {
		if id != "ord-1" && o.Status == tradingv1.OrderStatus_ORDER_STATUS_REJECTED {
			rejected++
		}
	}
	h.svc.mu.Unlock()
	if rejected != 4 {
		t.Fatalf("REJECTED flatten orders = %d, want 4", rejected)
	}
	if n := len(h.seen(http.MethodPost, "/v2/orders")); n != 1 {
		t.Fatalf("POSTs that reached the broker host = %d, want exactly 1", n)
	}
	if !h.svc.isAccountHalted("acct-1") {
		t.Fatal("account not halted after the flatten attempts")
	}
}
