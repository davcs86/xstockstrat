package service

// Risk/factor + resting-stop learning tests (feature 083).
//
// New logic lives in the CI-excluded `service/` package, so no coverage threshold applies;
// these unit tests verify the behavior directly (stop-distance math off the shared broker
// CurrentPrice, the STOP_NEAR flag, factor mapping, and the ledger boot-replay).

import (
	"context"
	"testing"

	"google.golang.org/grpc"
	"google.golang.org/protobuf/types/known/structpb"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	ledgerv1 "github.com/xstockstrat/contracts/gen/go/ledger/v1"
	portfoliov1 "github.com/xstockstrat/contracts/gen/go/portfolio/v1"
)

func TestApplyStopRisk_DistanceOffCurrentPrice(t *testing.T) {
	p := &portfoliov1.Position{Qty: 10, CurrentPrice: 100}
	applyStopRisk(p, 90)
	if p.StopPrice != 90 {
		t.Fatalf("StopPrice = %v, want 90", p.StopPrice)
	}
	// stop_distance_pct = (current - stop) / current = (100-90)/100 = 0.10
	if p.StopDistancePct < 0.099 || p.StopDistancePct > 0.101 {
		t.Fatalf("StopDistancePct = %v, want ~0.10", p.StopDistancePct)
	}
	// risk_at_stop = qty * (current - stop) = 10 * 10 = 100
	if p.RiskAtStop != 100 {
		t.Fatalf("RiskAtStop = %v, want 100", p.RiskAtStop)
	}
	if p.Flag == portfoliov1.PositionRiskFlag_POSITION_RISK_FLAG_STOP_NEAR {
		t.Fatalf("stop 10%% away should NOT be STOP_NEAR")
	}
	if p.ExitRule == "" {
		t.Fatalf("ExitRule should describe the stop")
	}
}

func TestApplyStopRisk_StopNearFires(t *testing.T) {
	p := &portfoliov1.Position{Qty: 5, CurrentPrice: 100}
	applyStopRisk(p, 98) // 2% away → within the 3% near-threshold
	if p.Flag != portfoliov1.PositionRiskFlag_POSITION_RISK_FLAG_STOP_NEAR {
		t.Fatalf("Flag = %v, want STOP_NEAR", p.Flag)
	}
}

func TestApplyStopRisk_NoopWithoutPrices(t *testing.T) {
	p := &portfoliov1.Position{Qty: 5, CurrentPrice: 0}
	applyStopRisk(p, 98)
	if p.StopPrice != 0 || p.RiskAtStop != 0 {
		t.Fatalf("no CurrentPrice → risk fields must stay zero")
	}
}

func TestStopStore_SetGetDelete(t *testing.T) {
	st := newStopStore()
	k := stopKey{user: "u1", symbol: "AAPL", mode: commonv1.TradingMode_TRADING_MODE_PAPER}
	if _, ok := st.get(k); ok {
		t.Fatalf("empty store should miss")
	}
	st.set(k, 90)
	if v, ok := st.get(k); !ok || v != 90 {
		t.Fatalf("get after set = (%v,%v), want (90,true)", v, ok)
	}
	st.set(k, 0) // zero clears
	if _, ok := st.get(k); ok {
		t.Fatalf("set(0) should delete the entry")
	}
}

func TestEnrichPositionRisk_FactorAndStop(t *testing.T) {
	st := newStopStore()
	st.set(stopKey{user: "u1", symbol: "AAPL", mode: commonv1.TradingMode_TRADING_MODE_PAPER}, 90)
	p := &portfoliov1.Position{
		Symbol:       "AAPL",
		Qty:          10,
		CurrentPrice: 100,
		TradingMode:  commonv1.TradingMode_TRADING_MODE_PAPER,
	}
	enrichPositionRisk(p, "u1", map[string]string{"AAPL": "Tech"}, st)
	if p.Factor != "Tech" {
		t.Fatalf("Factor = %q, want Tech", p.Factor)
	}
	if p.StopPrice != 90 {
		t.Fatalf("stop not applied: StopPrice = %v", p.StopPrice)
	}
}

func TestEnrichPositionRisk_EmptyFactorMap(t *testing.T) {
	p := &portfoliov1.Position{Symbol: "AAPL", Qty: 10, CurrentPrice: 100}
	enrichPositionRisk(p, "u1", map[string]string{}, newStopStore())
	if p.Factor != "" {
		t.Fatalf("empty factor map → Factor must stay \"\", got %q", p.Factor)
	}
}

// stopLedger stubs QueryEvents for the HydrateStops boot-replay test.
type stopLedger struct {
	ledgerv1.LedgerServiceClient
	events []*ledgerv1.LedgerEvent
}

func (f *stopLedger) QueryEvents(_ context.Context, _ *ledgerv1.QueryEventsRequest, _ ...grpc.CallOption) (*ledgerv1.QueryEventsResponse, error) {
	return &ledgerv1.QueryEventsResponse{Events: f.events}, nil
}

func _stopEvent(t *testing.T, user, symbol, mode string, stop float64) *ledgerv1.LedgerEvent {
	t.Helper()
	payload, err := structpb.NewStruct(map[string]interface{}{
		"user_id":      user,
		"symbol":       symbol,
		"trading_mode": mode,
		"stop_price":   stop,
	})
	if err != nil {
		t.Fatalf("build payload: %v", err)
	}
	return &ledgerv1.LedgerEvent{Payload: payload}
}

func TestHydrateStops_ReplaysFromLedger(t *testing.T) {
	svc := &PortfolioService{
		stops: newStopStore(),
		ledger: &stopLedger{events: []*ledgerv1.LedgerEvent{
			_stopEvent(t, "u1", "AAPL", "TRADING_MODE_PAPER", 95),
			_stopEvent(t, "u2", "TSLA", "TRADING_MODE_LIVE", 210),
			_stopEvent(t, "u3", "MSFT", "TRADING_MODE_PAPER", 0), // no stop → ignored
		}},
	}
	svc.HydrateStops(context.Background())

	if v, ok := svc.stops.get(stopKey{user: "u1", symbol: "AAPL", mode: commonv1.TradingMode_TRADING_MODE_PAPER}); !ok || v != 95 {
		t.Fatalf("AAPL stop = (%v,%v), want (95,true)", v, ok)
	}
	if v, ok := svc.stops.get(stopKey{user: "u2", symbol: "TSLA", mode: commonv1.TradingMode_TRADING_MODE_LIVE}); !ok || v != 210 {
		t.Fatalf("TSLA stop = (%v,%v), want (210,true)", v, ok)
	}
	if _, ok := svc.stops.get(stopKey{user: "u3", symbol: "MSFT", mode: commonv1.TradingMode_TRADING_MODE_PAPER}); ok {
		t.Fatalf("zero-stop event should not populate the store")
	}
}
