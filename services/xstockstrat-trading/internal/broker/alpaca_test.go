package broker_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/xstockstrat/trading/internal/broker"
)

// makeTestServer returns a mock Alpaca API server that responds with the given
// handler for POST /v2/orders and DELETE /v2/orders/:id.
func makeTestServer(t *testing.T, handler http.HandlerFunc) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/v2/orders", handler)
	mux.HandleFunc("/v2/orders/", handler)
	return httptest.NewServer(mux)
}

func TestSubmitOrder_Paper(t *testing.T) {
	var gotURL string
	var gotBody map[string]interface{}

	srv := makeTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		gotURL = r.URL.Path
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(broker.AlpacaOrder{
			ID:     "alpaca-order-123",
			Status: "new",
		})
	})
	defer srv.Close()

	c := broker.NewClient(broker.ClientConfig{
		APIKey:    "test-key",
		APISecret: "test-secret",
		PaperURL:  srv.URL,
		LiveURL:   "http://should-not-be-called",
		Paper:     true,
	})

	order, err := c.SubmitOrder(context.Background(), broker.OrderRequest{
		Symbol:      "AAPL",
		Qty:         10,
		Side:        "buy",
		OrderType:   "market",
		TimeInForce: "day",
	})
	if err != nil {
		t.Fatalf("SubmitOrder failed: %v", err)
	}
	if order.BrokerOrderID != "alpaca-order-123" {
		t.Errorf("expected broker order ID alpaca-order-123, got %s", order.BrokerOrderID)
	}
	if gotURL != "/v2/orders" {
		t.Errorf("expected POST /v2/orders, got %s", gotURL)
	}
	if gotBody["symbol"] != "AAPL" {
		t.Errorf("expected symbol AAPL in request body, got %v", gotBody["symbol"])
	}
}

func TestSubmitOrder_Live(t *testing.T) {
	var calledLive bool

	srv := makeTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		calledLive = true
		_ = json.NewEncoder(w).Encode(broker.AlpacaOrder{ID: "live-order-456", Status: "new"})
	})
	defer srv.Close()

	c := broker.NewClient(broker.ClientConfig{
		APIKey:    "test-key",
		APISecret: "test-secret",
		PaperURL:  "http://should-not-be-called",
		LiveURL:   srv.URL,
		Paper:     false,
	})

	if _, err := c.SubmitOrder(context.Background(), broker.OrderRequest{
		Symbol: "TSLA", Qty: 5, Side: "sell", OrderType: "market", TimeInForce: "day",
	}); err != nil {
		t.Fatalf("SubmitOrder failed: %v", err)
	}
	if !calledLive {
		t.Error("expected live URL to be called, but it was not")
	}
}

func TestCancelOrder(t *testing.T) {
	var canceledID string

	srv := makeTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodDelete {
			canceledID = r.URL.Path // e.g. /v2/orders/alpaca-order-123
			w.WriteHeader(http.StatusNoContent)
		}
	})
	defer srv.Close()

	c := broker.NewClient(broker.ClientConfig{
		APIKey: "k", APISecret: "s", PaperURL: srv.URL, LiveURL: srv.URL, Paper: true,
	})

	if err := c.CancelOrder(context.Background(), "alpaca-order-123"); err != nil {
		t.Fatalf("CancelOrder failed: %v", err)
	}
	if canceledID != "/v2/orders/alpaca-order-123" {
		t.Errorf("expected DELETE /v2/orders/alpaca-order-123, got %s", canceledID)
	}
}

func TestSubmitOrder_BrokerError(t *testing.T) {
	srv := makeTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"message":"forbidden"}`))
	})
	defer srv.Close()

	c := broker.NewClient(broker.ClientConfig{
		APIKey: "k", APISecret: "s", PaperURL: srv.URL, LiveURL: srv.URL, Paper: true,
	})

	_, err := c.SubmitOrder(context.Background(), broker.OrderRequest{
		Symbol: "AAPL", Qty: 1, Side: "buy", OrderType: "market", TimeInForce: "day",
	})
	if err == nil {
		t.Fatal("expected error for 403 response, got nil")
	}
}

func TestSubmitOrder_TrailingStopAndClientOrderID(t *testing.T) {
	var gotBody map[string]interface{}
	srv := makeTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		_ = json.NewEncoder(w).Encode(broker.AlpacaOrder{ID: "o1", Status: "new"})
	})
	defer srv.Close()

	c := broker.NewClient(broker.ClientConfig{
		APIKey: "k", APISecret: "s", PaperURL: srv.URL, LiveURL: srv.URL, Paper: true,
	})

	_, err := c.SubmitOrder(context.Background(), broker.OrderRequest{
		Symbol: "AAPL", Qty: 10, Side: "sell", OrderType: "trailing_stop",
		TimeInForce: "day", TrailPercent: 2.5, ClientOrderID: "internal-order-uuid",
	})
	if err != nil {
		t.Fatalf("SubmitOrder failed: %v", err)
	}
	if gotBody["type"] != "trailing_stop" {
		t.Errorf("expected type trailing_stop, got %v", gotBody["type"])
	}
	if gotBody["trail_percent"] != "2.5" {
		t.Errorf("expected trail_percent \"2.5\", got %v", gotBody["trail_percent"])
	}
	if _, ok := gotBody["trail_price"]; ok {
		t.Errorf("trail_price should be omitted when zero, got %v", gotBody["trail_price"])
	}
	if gotBody["client_order_id"] != "internal-order-uuid" {
		t.Errorf("expected client_order_id forwarded, got %v", gotBody["client_order_id"])
	}
}

func TestSubmitOrder_TrailPrice(t *testing.T) {
	var gotBody map[string]interface{}
	srv := makeTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		_ = json.NewEncoder(w).Encode(broker.AlpacaOrder{ID: "o1", Status: "new"})
	})
	defer srv.Close()

	c := broker.NewClient(broker.ClientConfig{APIKey: "k", APISecret: "s", PaperURL: srv.URL, LiveURL: srv.URL, Paper: true})
	if _, err := c.SubmitOrder(context.Background(), broker.OrderRequest{
		Symbol: "AAPL", Qty: 10, Side: "sell", OrderType: "trailing_stop", TimeInForce: "gtc", TrailPrice: 1.25,
	}); err != nil {
		t.Fatalf("SubmitOrder failed: %v", err)
	}
	if gotBody["trail_price"] != "1.25" {
		t.Errorf("expected trail_price \"1.25\", got %v", gotBody["trail_price"])
	}
	if _, ok := gotBody["trail_percent"]; ok {
		t.Errorf("trail_percent should be omitted when zero, got %v", gotBody["trail_percent"])
	}
}

func TestReplaceOrder_Trail(t *testing.T) {
	var gotBody map[string]interface{}
	srv := makeTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		_ = json.NewEncoder(w).Encode(broker.AlpacaOrder{ID: "o1", Status: "new"})
	})
	defer srv.Close()

	c := broker.NewClient(broker.ClientConfig{APIKey: "k", APISecret: "s", PaperURL: srv.URL, LiveURL: srv.URL, Paper: true})
	if _, err := c.ReplaceOrder(context.Background(), "o1", broker.OrderRequest{Trail: 3.0}); err != nil {
		t.Fatalf("ReplaceOrder failed: %v", err)
	}
	if gotBody["trail"] != "3" {
		t.Errorf("expected trail \"3\", got %v", gotBody["trail"])
	}
	if _, ok := gotBody["qty"]; ok {
		t.Errorf("qty should be omitted when zero, got %v", gotBody["qty"])
	}
}

func TestNewClient_TimeoutFromConfig(t *testing.T) {
	// A configured timeout is applied; a nil Timeout falls back to the documented default.
	c := broker.NewClient(broker.ClientConfig{APIKey: "k", APISecret: "s", Timeout: func() time.Duration { return 1234 * time.Millisecond }})
	if got := c.HTTPTimeout(); got != 1234*time.Millisecond {
		t.Errorf("expected timeout 1234ms, got %v", got)
	}
	d := broker.NewClient(broker.ClientConfig{APIKey: "k", APISecret: "s"})
	if got := d.HTTPTimeout(); got != 5000*time.Millisecond {
		t.Errorf("expected default timeout 5000ms, got %v", got)
	}
}

func TestSubmitOrder_TimeoutIsLive(t *testing.T) {
	var timeout atomic.Int64
	timeout.Store(int64(5000 * time.Millisecond))

	srv := makeTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-time.After(6 * time.Second):
		case <-r.Context().Done():
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(broker.AlpacaOrder{ID: "alpaca-order-slow", Status: "new"})
	})
	defer srv.Close()

	c := broker.NewClient(broker.ClientConfig{
		APIKey:    "test-key",
		APISecret: "test-secret",
		PaperURL:  srv.URL,
		LiveURL:   "http://should-not-be-called",
		Paper:     true,
		Timeout:   func() time.Duration { return time.Duration(timeout.Load()) },
	})
	req := broker.OrderRequest{Symbol: "AAPL", Qty: 10, Side: "buy", OrderType: "market", TimeInForce: "day"}

	if _, err := c.SubmitOrder(context.Background(), req); err == nil {
		t.Fatal("expected the 6s response to exceed the 5000ms deadline")
	}

	timeout.Store(int64(8000 * time.Millisecond))
	order, err := c.SubmitOrder(context.Background(), req)
	if err != nil {
		t.Fatalf("expected the same client to honour the raised 8000ms deadline, got %v", err)
	}
	if order.BrokerOrderID != "alpaca-order-slow" {
		t.Errorf("expected broker order ID alpaca-order-slow, got %s", order.BrokerOrderID)
	}
}

func TestIsPaper(t *testing.T) {
	paper := broker.NewClient(broker.ClientConfig{Paper: true})
	live := broker.NewClient(broker.ClientConfig{Paper: false})
	if !paper.IsPaper() {
		t.Error("expected IsPaper=true")
	}
	if live.IsPaper() {
		t.Error("expected IsPaper=false")
	}
}

func TestGetOrder_AlpacaFilledAvgPrice(t *testing.T) {
	srv := makeTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("expected GET, got %s", r.Method)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(broker.AlpacaOrder{
			ID:             "order-abc",
			Status:         "filled",
			FilledAvgPrice: "75.50",
		})
	})
	defer srv.Close()

	c := broker.NewClient(broker.ClientConfig{
		APIKey: "k", APISecret: "s", PaperURL: srv.URL, LiveURL: srv.URL, Paper: true,
	})

	o, err := c.GetOrder(context.Background(), "order-abc")
	if err != nil {
		t.Fatalf("GetOrder failed: %v", err)
	}
	if o.FilledAvgPrice != 75.50 {
		t.Errorf("expected FilledAvgPrice 75.50, got %f", o.FilledAvgPrice)
	}
	if o.Status != "filled" {
		t.Errorf("expected status filled, got %s", o.Status)
	}
}

func TestGetAccount_Alpaca(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/v2/account", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		// Alpaca returns monetary fields as decimal strings.
		_, _ = w.Write([]byte(`{
			"cash": "1000.50",
			"buying_power": "4000.00",
			"equity": "2500.25",
			"last_equity": "2400.00"
		}`))
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	c := broker.NewClient(broker.ClientConfig{
		APIKey: "k", APISecret: "s", PaperURL: srv.URL, LiveURL: srv.URL, Paper: true,
	})

	bal, err := c.GetAccount(context.Background())
	if err != nil {
		t.Fatalf("GetAccount failed: %v", err)
	}
	if bal.Cash != 1000.50 {
		t.Errorf("Cash: got %v, want 1000.50", bal.Cash)
	}
	if bal.BuyingPower != 4000.00 {
		t.Errorf("BuyingPower: got %v, want 4000.00", bal.BuyingPower)
	}
	if bal.Equity != 2500.25 {
		t.Errorf("Equity: got %v, want 2500.25", bal.Equity)
	}
	if bal.LastEquity != 2400.00 {
		t.Errorf("LastEquity: got %v, want 2400.00", bal.LastEquity)
	}
}

func TestGetPositions_Alpaca_BrokerValuation(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/v2/positions", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		// Alpaca returns qty, avg_entry_price, and the mark-to-market valuation fields as
		// decimal strings. The valuation fields are what let the portfolio card reconcile
		// with broker equity, so they must be parsed rather than dropped.
		_, _ = w.Write([]byte(`[{
			"symbol": "AMZN",
			"qty": "2",
			"avg_entry_price": "331.20",
			"current_price": "200.00",
			"market_value": "400.00",
			"unrealized_pl": "-262.39",
			"unrealized_plpc": "-0.396",
			"unrealized_intraday_pl": "12.50",
			"unrealized_intraday_plpc": "0.032"
		}]`))
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	c := broker.NewClient(broker.ClientConfig{
		APIKey: "k", APISecret: "s", PaperURL: srv.URL, LiveURL: srv.URL, Paper: true,
	})

	positions, err := c.GetPositions(context.Background())
	if err != nil {
		t.Fatalf("GetPositions failed: %v", err)
	}
	if len(positions) != 1 {
		t.Fatalf("positions: got %d, want 1", len(positions))
	}
	p := positions[0]
	if p.Symbol != "AMZN" || p.Quantity != 2 || p.AvgCost != 331.20 {
		t.Errorf("base fields wrong: %+v", p)
	}
	if p.CurrentPrice != 200.00 {
		t.Errorf("CurrentPrice: got %v, want 200.00", p.CurrentPrice)
	}
	if p.MarketValue != 400.00 {
		t.Errorf("MarketValue: got %v, want 400.00", p.MarketValue)
	}
	if p.UnrealizedPnl != -262.39 {
		t.Errorf("UnrealizedPnl: got %v, want -262.39", p.UnrealizedPnl)
	}
	if p.UnrealizedPnlPct != -0.396 {
		t.Errorf("UnrealizedPnlPct: got %v, want -0.396", p.UnrealizedPnlPct)
	}
	if p.DayPnl != 12.50 {
		t.Errorf("DayPnl: got %v, want 12.50", p.DayPnl)
	}
	if p.DayPnlPct != 0.032 {
		t.Errorf("DayPnlPct: got %v, want 0.032", p.DayPnlPct)
	}
}

func TestGetAccount_Alpaca_LastEquityFallback(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/v2/account", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		// No last_equity reported → falls back to equity (day P&L = 0).
		_, _ = w.Write([]byte(`{"cash": "0", "buying_power": "0", "equity": "500.00"}`))
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	c := broker.NewClient(broker.ClientConfig{
		APIKey: "k", APISecret: "s", PaperURL: srv.URL, LiveURL: srv.URL, Paper: true,
	})

	bal, err := c.GetAccount(context.Background())
	if err != nil {
		t.Fatalf("GetAccount failed: %v", err)
	}
	if bal.LastEquity != 500.00 {
		t.Errorf("LastEquity fallback: got %v, want 500.00", bal.LastEquity)
	}
}

func TestGetOrder_AlpacaFilledQty(t *testing.T) {
	srv := makeTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(broker.AlpacaOrder{
			ID:             "order-xyz",
			Status:         "filled",
			Qty:            "10",
			FilledQty:      "10",
			FilledAvgPrice: "42.00",
		})
	})
	defer srv.Close()

	c := broker.NewClient(broker.ClientConfig{
		APIKey: "k", APISecret: "s", PaperURL: srv.URL, LiveURL: srv.URL, Paper: true,
	})

	o, err := c.GetOrder(context.Background(), "order-xyz")
	if err != nil {
		t.Fatalf("GetOrder failed: %v", err)
	}
	if o.FilledQty != 10 {
		t.Errorf("expected FilledQty 10, got %f", o.FilledQty)
	}
}

func TestReplaceOrder_Alpaca(t *testing.T) {
	var gotMethod, gotURL string
	var gotBody map[string]interface{}

	srv := makeTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotURL = r.URL.Path
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(broker.AlpacaOrder{ID: "alpaca-order-123", Status: "new"})
	})
	defer srv.Close()

	c := broker.NewClient(broker.ClientConfig{
		APIKey:    "test-key",
		APISecret: "test-secret",
		PaperURL:  srv.URL,
		LiveURL:   "http://should-not-be-called",
		Paper:     true,
	})

	order, err := c.ReplaceOrder(context.Background(), "alpaca-order-123", broker.OrderRequest{
		Qty:        5,
		LimitPrice: 101,
	})
	if err != nil {
		t.Fatalf("ReplaceOrder failed: %v", err)
	}
	if gotMethod != http.MethodPatch {
		t.Errorf("expected PATCH, got %s", gotMethod)
	}
	if gotURL != "/v2/orders/alpaca-order-123" {
		t.Errorf("expected path /v2/orders/alpaca-order-123, got %s", gotURL)
	}
	// Only the changed fields should be present.
	if gotBody["qty"] != "5" {
		t.Errorf("expected qty \"5\", got %v", gotBody["qty"])
	}
	if gotBody["limit_price"] != "101" {
		t.Errorf("expected limit_price \"101\", got %v", gotBody["limit_price"])
	}
	if _, ok := gotBody["stop_price"]; ok {
		t.Errorf("stop_price should be omitted when zero, got %v", gotBody["stop_price"])
	}
	if _, ok := gotBody["time_in_force"]; ok {
		t.Errorf("time_in_force should be omitted when empty, got %v", gotBody["time_in_force"])
	}
	if order.BrokerOrderID != "alpaca-order-123" {
		t.Errorf("expected broker order ID alpaca-order-123, got %s", order.BrokerOrderID)
	}
	if order.Status != "new" {
		t.Errorf("expected status new, got %s", order.Status)
	}
}

// TestSubmitOrder_BracketAttachesAtomically (feature 030): a non-zero BracketStopPrice
// requests an Alpaca-native bracket order, attached at entry submission.
func TestSubmitOrder_BracketAttachesAtomically(t *testing.T) {
	var gotBody map[string]interface{}

	srv := makeTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(broker.AlpacaOrder{
			ID:     "alpaca-order-bracket-1",
			Status: "new",
			Legs: []struct {
				ID   string `json:"id"`
				Type string `json:"type"`
			}{
				{ID: "leg-stop-1", Type: "stop"},
				{ID: "leg-tp-1", Type: "limit"},
			},
		})
	})
	defer srv.Close()

	c := broker.NewClient(broker.ClientConfig{
		APIKey: "test-key", APISecret: "test-secret", PaperURL: srv.URL, Paper: true,
	})

	order, err := c.SubmitOrder(context.Background(), broker.OrderRequest{
		Symbol: "AAPL", Side: "buy", OrderType: "market", Qty: 10,
		BracketStopPrice: 178.0, BracketTakeProfitPrice: 210.0,
	})
	if err != nil {
		t.Fatalf("SubmitOrder failed: %v", err)
	}

	orderClass, _ := gotBody["order_class"].(string)
	if orderClass != "bracket" {
		t.Errorf("expected order_class \"bracket\", got %v", gotBody["order_class"])
	}
	stopLoss, _ := gotBody["stop_loss"].(map[string]interface{})
	if stopLoss == nil || stopLoss["stop_price"] != "178" {
		t.Errorf("expected stop_loss.stop_price \"178\", got %v", gotBody["stop_loss"])
	}
	takeProfit, _ := gotBody["take_profit"].(map[string]interface{})
	if takeProfit == nil || takeProfit["limit_price"] != "210" {
		t.Errorf("expected take_profit.limit_price \"210\", got %v", gotBody["take_profit"])
	}
	if order.StopLegOrderID != "leg-stop-1" {
		t.Errorf("expected StopLegOrderID leg-stop-1, got %s", order.StopLegOrderID)
	}
	if order.TakeProfitLegOrderID != "leg-tp-1" {
		t.Errorf("expected TakeProfitLegOrderID leg-tp-1, got %s", order.TakeProfitLegOrderID)
	}
}

// TestSubmitOrder_BracketWithNoTakeProfit confirms take_profit is omitted from the
// request JSON (omitempty) when BracketTakeProfitPrice is 0, and no legs are parsed
// from a response that carries none.
func TestSubmitOrder_BracketWithNoTakeProfit(t *testing.T) {
	var gotBody map[string]interface{}

	srv := makeTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(broker.AlpacaOrder{ID: "alpaca-order-bracket-2", Status: "new"})
	})
	defer srv.Close()

	c := broker.NewClient(broker.ClientConfig{
		APIKey: "test-key", APISecret: "test-secret", PaperURL: srv.URL, Paper: true,
	})

	order, err := c.SubmitOrder(context.Background(), broker.OrderRequest{
		Symbol: "AAPL", Side: "buy", OrderType: "market", Qty: 10, BracketStopPrice: 178.0,
	})
	if err != nil {
		t.Fatalf("SubmitOrder failed: %v", err)
	}
	if _, ok := gotBody["take_profit"]; ok {
		t.Errorf("take_profit should be omitted when BracketTakeProfitPrice is 0, got %v", gotBody["take_profit"])
	}
	if order.StopLegOrderID != "" || order.TakeProfitLegOrderID != "" {
		t.Errorf("expected no leg IDs when response has no legs, got stop=%s tp=%s", order.StopLegOrderID, order.TakeProfitLegOrderID)
	}
}

// TestSubmitBracketLegs_AlpacaUnsupported confirms Alpaca's bracket attaches at entry
// submission, never via a follow-up SubmitBracketLegs call.
func TestSubmitBracketLegs_AlpacaUnsupported(t *testing.T) {
	c := broker.NewClient(broker.ClientConfig{APIKey: "test-key", APISecret: "test-secret", PaperURL: "http://unused", Paper: true})
	_, err := c.SubmitBracketLegs(context.Background(), "brk-1", "coid-1", broker.BracketLegsRequest{
		Symbol: "AAPL", Side: "sell", Qty: 10, StopPrice: 178.0,
	})
	if err == nil {
		t.Fatal("expected a non-nil error, got nil")
	}
}

func TestAlpacaListOrders_ParsesMultipleStatuses(t *testing.T) {
	srv := makeTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode([]broker.AlpacaOrder{
			{ID: "o-1", ClientOrderID: "coid-1", Status: "filled", FilledQty: "10", FilledAvgPrice: "150.00"},
			{ID: "o-2", ClientOrderID: "coid-2", Status: "new"},
			{ID: "o-3", ClientOrderID: "coid-3", Status: "partially_filled", FilledQty: "5"},
		})
	})
	defer srv.Close()

	c := broker.NewClient(broker.ClientConfig{APIKey: "k", APISecret: "s", PaperURL: srv.URL, Paper: true})
	orders, err := c.ListOrders(context.Background())
	if err != nil {
		t.Fatalf("ListOrders failed: %v", err)
	}
	if len(orders) != 3 {
		t.Fatalf("expected 3 orders, got %d", len(orders))
	}
	for i, wantCOID := range []string{"coid-1", "coid-2", "coid-3"} {
		if orders[i].ClientOrderID != wantCOID {
			t.Errorf("order %d: ClientOrderID = %q, want %q", i, orders[i].ClientOrderID, wantCOID)
		}
	}
}

func TestAlpacaListOrders_QueryParams(t *testing.T) {
	var gotQuery string
	srv := makeTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		gotQuery = r.URL.RawQuery
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode([]broker.AlpacaOrder{})
	})
	defer srv.Close()

	c := broker.NewClient(broker.ClientConfig{APIKey: "k", APISecret: "s", PaperURL: srv.URL, Paper: true})
	if _, err := c.ListOrders(context.Background()); err != nil {
		t.Fatalf("ListOrders failed: %v", err)
	}
	q, err := url.ParseQuery(gotQuery)
	if err != nil {
		t.Fatalf("parse query: %v", err)
	}
	if q.Get("status") != "all" {
		t.Errorf("status = %q, want %q", q.Get("status"), "all")
	}
	if q.Get("limit") != "500" {
		t.Errorf("limit = %q, want %q", q.Get("limit"), "500")
	}
}

func TestAlpacaListOrders_HTTPError(t *testing.T) {
	srv := makeTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"message":"boom"}`))
	})
	defer srv.Close()

	c := broker.NewClient(broker.ClientConfig{APIKey: "k", APISecret: "s", PaperURL: srv.URL, Paper: true})
	orders, err := c.ListOrders(context.Background())
	if err == nil {
		t.Fatal("expected a non-nil error")
	}
	if len(orders) != 0 {
		t.Errorf("expected an empty/nil slice on error, got %d orders", len(orders))
	}
}

// 422 ("already filled/canceled") is not a successful cancel: the caller must re-read the order.
func TestCancelOrder_422ReturnsNotCancelable(t *testing.T) {
	srv := makeTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnprocessableEntity)
	})
	defer srv.Close()

	c := broker.NewClient(broker.ClientConfig{APIKey: "k", APISecret: "s", PaperURL: srv.URL, Paper: true})
	err := c.CancelOrder(context.Background(), "alpaca-order-123")
	if !errors.Is(err, broker.ErrOrderNotCancelable) {
		t.Fatalf("err = %v, want ErrOrderNotCancelable", err)
	}
}

// ── feature 347: adaptive rate limit at do() ────────────────────────────────

const (
	f347PaperHost = "paper-api.alpaca.markets"
	f347LiveHost  = "api.alpaca.markets"
	f347Account   = `{"cash":"1","buying_power":"1","portfolio_value":"1"}`
)

var f347Start = time.Unix(1_800_000_000, 0)

type f347Clock struct {
	mu      sync.Mutex
	now     time.Time
	sleeps  []time.Duration
	onSleep func()
}

func (c *f347Clock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *f347Clock) Sleep(ctx context.Context, d time.Duration) error {
	if c.onSleep != nil {
		c.onSleep()
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.sleeps = append(c.sleeps, d)
	c.now = c.now.Add(d)
	return nil
}

func (c *f347Clock) recorded() []time.Duration {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]time.Duration(nil), c.sleeps...)
}

type f347Attempt struct {
	method, host, path, body string
	at                       time.Time
}

// f347RT answers from a script and keeps the request's real Alpaca host.
type f347RT struct {
	mu       sync.Mutex
	now      func() time.Time
	attempts []f347Attempt
	respond  func(n int, req *http.Request) (*http.Response, error)
}

func (rt *f347RT) RoundTrip(req *http.Request) (*http.Response, error) {
	var body []byte
	if req.Body != nil {
		body, _ = io.ReadAll(req.Body)
	}
	rt.mu.Lock()
	n := len(rt.attempts)
	rt.attempts = append(rt.attempts, f347Attempt{method: req.Method, host: req.URL.Host, path: req.URL.Path, body: string(body), at: rt.now()})
	rt.mu.Unlock()
	return rt.respond(n, req)
}

func (rt *f347RT) seen() []f347Attempt {
	rt.mu.Lock()
	defer rt.mu.Unlock()
	return append([]f347Attempt(nil), rt.attempts...)
}

func f347Resp(status int, body string, headers ...string) (*http.Response, error) {
	h := http.Header{}
	for i := 0; i+1 < len(headers); i += 2 {
		h.Set(headers[i], headers[i+1])
	}
	return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(body)), Header: h}, nil
}

func f347RateHeaders(limit, remaining int, reset time.Time) []string {
	return []string{
		"X-RateLimit-Limit", strconv.Itoa(limit),
		"X-RateLimit-Remaining", strconv.Itoa(remaining),
		"X-RateLimit-Reset", strconv.FormatInt(reset.Unix(), 10),
	}
}

func f347ResetOnly(reset time.Time) []string {
	return []string{"X-RateLimit-Reset", strconv.FormatInt(reset.Unix(), 10)}
}

type f347Opts struct {
	key     string
	live    bool
	timeout time.Duration
	budget  func() time.Duration
}

func f347Budget(d time.Duration) func() time.Duration { return func() time.Duration { return d } }

// f347Client builds a client behind rt. A nil clock keeps the real clock and sleep; jitter is fixed at 0.
func f347Client(rt *f347RT, clock *f347Clock, o f347Opts) *broker.Client {
	if o.key == "" {
		o.key = "KEY-A"
	}
	if o.timeout == 0 {
		o.timeout = 5 * time.Second
	}
	c := broker.NewClient(broker.ClientConfig{
		APIKey: o.key, APISecret: "s", Paper: !o.live,
		Timeout:         func() time.Duration { return o.timeout },
		RateLimitBudget: o.budget,
	})
	broker.SetTransport(c, rt)
	broker.SetJitter(c, func() time.Duration { return 0 })
	rt.now = time.Now
	if clock != nil {
		broker.SetNow(c, clock.Now)
		broker.SetSleep(c, clock.Sleep)
		rt.now = clock.Now
	}
	return c
}

func f347Market(clientOrderID string) broker.OrderRequest {
	return broker.OrderRequest{Symbol: "AAPL", Qty: 10, Side: "buy", OrderType: "market", TimeInForce: "day", ClientOrderID: clientOrderID}
}

func f347WantRateLimited(t *testing.T, err error, host string) {
	t.Helper()
	if !errors.Is(err, broker.ErrRateLimited) {
		t.Fatalf("error = %v, want broker.ErrRateLimited", err)
	}
	for _, want := range []string{"rate limited", host} {
		if !strings.Contains(err.Error(), want) {
			t.Fatalf("error %q does not contain %q", err, want)
		}
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) || errors.Is(err, broker.ErrInvalidCredentials) {
		t.Fatalf("a rate-limit refusal must wrap only ErrRateLimited, got %v", err)
	}
}

type f347WarnHandler struct {
	mu    *sync.Mutex
	warns *[]map[string]string
}

func (h f347WarnHandler) Enabled(_ context.Context, l slog.Level) bool { return l >= slog.LevelWarn }
func (h f347WarnHandler) WithAttrs([]slog.Attr) slog.Handler           { return h }
func (h f347WarnHandler) WithGroup(string) slog.Handler                { return h }
func (h f347WarnHandler) Handle(_ context.Context, r slog.Record) error {
	attrs := map[string]string{}
	r.Attrs(func(a slog.Attr) bool {
		attrs[a.Key] = a.Value.String()
		return true
	})
	h.mu.Lock()
	defer h.mu.Unlock()
	*h.warns = append(*h.warns, attrs)
	return nil
}

func f347RecordWarns(t *testing.T) func() []map[string]string {
	t.Helper()
	var mu sync.Mutex
	var warns []map[string]string
	prev := slog.Default()
	slog.SetDefault(slog.New(f347WarnHandler{mu: &mu, warns: &warns}))
	t.Cleanup(func() { slog.SetDefault(prev) })
	return func() []map[string]string {
		mu.Lock()
		defer mu.Unlock()
		return append([]map[string]string(nil), warns...)
	}
}

// @AC-10 (guard): the kill switch restores the single attempt. Red under an "ignore the budget" mutant.
func TestDo_KillSwitchOffIsASingleAttempt_F347_AC10(t *testing.T) {
	for name, budget := range map[string]func() time.Duration{"nil budget": nil, "zero budget": f347Budget(0)} {
		rt := &f347RT{respond: func(int, *http.Request) (*http.Response, error) {
			return f347Resp(429, `{}`, f347ResetOnly(time.Now().Add(2*time.Second))...)
		}}
		c := f347Client(rt, nil, f347Opts{budget: budget})
		_, err := c.GetAccount(context.Background())
		if err == nil || !strings.Contains(err.Error(), "status 429") {
			t.Fatalf("%s: error = %v, want one containing \"status 429\"", name, err)
		}
		if n := len(rt.seen()); n != 1 {
			t.Fatalf("%s: attempts = %d, want exactly 1", name, n)
		}
	}
}

// @AC-12 (client side): a rate-limited submit is resent with the same client_order_id and body.
func TestSubmitOrder_RetriedWithIdenticalBody_F347_AC12(t *testing.T) {
	for name, req := range map[string]broker.OrderRequest{
		"market": f347Market("c-42"),
		"limit":  {Symbol: "AAPL", Qty: 10, Side: "buy", OrderType: "limit", LimitPrice: 150.00, TimeInForce: "day", ClientOrderID: "c-42"},
	} {
		clock := &f347Clock{now: f347Start}
		rt := &f347RT{respond: func(n int, _ *http.Request) (*http.Response, error) {
			if n == 0 {
				return f347Resp(429, `{}`, f347ResetOnly(f347Start.Add(time.Second))...)
			}
			return f347Resp(200, `{"id":"b-1","status":"new"}`)
		}}
		c := f347Client(rt, clock, f347Opts{budget: f347Budget(20 * time.Second)})
		order, err := c.SubmitOrder(context.Background(), req)
		if err != nil || order.BrokerOrderID != "b-1" {
			t.Fatalf("%s: order = %+v, err = %v; want broker order id b-1", name, order, err)
		}
		got := rt.seen()
		if len(got) != 2 || got[0].method != http.MethodPost {
			t.Fatalf("%s: attempts = %+v, want 2 POSTs", name, got)
		}
		if got[0].body == "" || got[0].body != got[1].body || !strings.Contains(got[1].body, `"client_order_id":"c-42"`) {
			t.Fatalf("%s: bodies differ or lack client_order_id c-42:\n%s\n%s", name, got[0].body, got[1].body)
		}
	}
}

// @AC-13: a broker call never outlives its retry budget. Row 1 pins the inclusive fit rule (7 + 8 + 5 = 20).
func TestSubmitOrder_NeverOutlivesItsBudget_F347_AC13(t *testing.T) {
	for _, row := range []struct {
		name            string
		timeout, budget time.Duration
		attempts        int
		lastStart       time.Duration
	}{
		{"5000ms x3.0", 5 * time.Second, 20 * time.Second, 5, 15 * time.Second},
		{"5000ms x1.5", 5 * time.Second, 5 * time.Second, 1, 0},
		{"10000ms x1.5", 10 * time.Second, 10 * time.Second, 1, 0},
		{"1000ms x3.0", time.Second, 28 * time.Second, 6, 23 * time.Second},
	} {
		t.Run(row.name, func(t *testing.T) {
			clock := &f347Clock{now: f347Start}
			rt := &f347RT{respond: func(int, *http.Request) (*http.Response, error) { return f347Resp(429, `{}`) }}
			c := f347Client(rt, clock, f347Opts{timeout: row.timeout, budget: f347Budget(row.budget)})
			_, err := c.SubmitOrder(context.Background(), f347Market("c-13"))
			f347WantRateLimited(t, err, f347PaperHost)
			got := rt.seen()
			if len(got) != row.attempts {
				t.Fatalf("attempts = %d, want %d", len(got), row.attempts)
			}
			if d := got[len(got)-1].at.Sub(f347Start); d != row.lastStart {
				t.Fatalf("last attempt started %v after the first, want %v", d, row.lastStart)
			}
			if d := clock.Now().Sub(f347Start); d != row.lastStart {
				t.Fatalf("error returned %v after the call began on the client clock, want %v", d, row.lastStart)
			}
		})
	}
}

// @AC-15: a rate-limited cancel takes effect exactly once.
func TestCancelOrder_RetriedOnce_F347_AC15(t *testing.T) {
	clock := &f347Clock{now: f347Start}
	rt := &f347RT{respond: func(n int, _ *http.Request) (*http.Response, error) {
		if n == 0 {
			return f347Resp(429, `{}`, f347ResetOnly(f347Start.Add(time.Second))...)
		}
		return f347Resp(204, ``)
	}}
	c := f347Client(rt, clock, f347Opts{budget: f347Budget(20 * time.Second)})
	if err := c.CancelOrder(context.Background(), "b-1"); err != nil {
		t.Fatalf("CancelOrder: %v", err)
	}
	got := rt.seen()
	if len(got) != 2 || got[0].method != http.MethodDelete || got[1].method != http.MethodDelete || got[1].path != "/v2/orders/b-1" {
		t.Fatalf("attempts = %+v, want exactly 2 DELETEs for b-1", got)
	}
}

// @AC-16: a rate-limited replace is retried with the same body.
func TestReplaceOrder_RetriedWithIdenticalBody_F347_AC16(t *testing.T) {
	clock := &f347Clock{now: f347Start}
	rt := &f347RT{respond: func(n int, _ *http.Request) (*http.Response, error) {
		if n == 0 {
			return f347Resp(429, `{}`, f347ResetOnly(f347Start.Add(time.Second))...)
		}
		return f347Resp(200, `{"id":"b-2","status":"new"}`)
	}}
	c := f347Client(rt, clock, f347Opts{budget: f347Budget(20 * time.Second)})
	order, err := c.ReplaceOrder(context.Background(), "b-1", broker.OrderRequest{Qty: 7})
	if err != nil || order.BrokerOrderID != "b-2" {
		t.Fatalf("order = %+v, err = %v; want broker order id b-2", order, err)
	}
	got := rt.seen()
	if len(got) != 2 || got[0].method != http.MethodPatch || got[0].body != got[1].body || !strings.Contains(got[1].body, `"qty":"7"`) {
		t.Fatalf("attempts = %+v, want 2 PATCHes with an identical body carrying qty \"7\"", got)
	}
}

// @AC-17: paper and live hosts are handled the same and tracked separately.
func TestGetAccount_PaperAndLiveTrackedSeparately_F347_AC17(t *testing.T) {
	clock := &f347Clock{now: f347Start}
	paperRT := &f347RT{respond: func(int, *http.Request) (*http.Response, error) {
		return f347Resp(200, f347Account, f347RateHeaders(200, 0, f347Start.Add(5*time.Second))...)
	}}
	paper := f347Client(paperRT, clock, f347Opts{budget: f347Budget(20 * time.Second)})
	if _, err := paper.GetAccount(context.Background()); err != nil {
		t.Fatalf("paper priming request: %v", err)
	}
	liveRT := &f347RT{respond: func(n int, _ *http.Request) (*http.Response, error) {
		if n == 0 {
			return f347Resp(429, `{}`)
		}
		return f347Resp(200, f347Account)
	}}
	live := f347Client(liveRT, clock, f347Opts{live: true, budget: f347Budget(20 * time.Second)})
	if _, err := live.GetAccount(context.Background()); err != nil {
		t.Fatalf("live GetAccount: %v", err)
	}
	got := liveRT.seen()
	if len(got) != 2 || got[0].host != f347LiveHost {
		t.Fatalf("live attempts = %+v, want exactly 2 on %s", got, f347LiveHost)
	}
	if !got[0].at.Equal(f347Start) {
		t.Fatalf("the live request waited %v for the paper host's reset", got[0].at.Sub(f347Start))
	}
}

// @AC-18: trading logs a throttled window.
func TestGetPositions_ThrottleIsLogged_F347_AC18(t *testing.T) {
	warns := f347RecordWarns(t)
	clock := &f347Clock{now: f347Start}
	rt := &f347RT{respond: func(n int, _ *http.Request) (*http.Response, error) {
		if n == 0 {
			return f347Resp(429, `{}`, f347ResetOnly(f347Start.Add(2*time.Second))...)
		}
		return f347Resp(200, `[]`)
	}}
	c := f347Client(rt, clock, f347Opts{budget: f347Budget(20 * time.Second)})
	if _, err := c.GetPositions(context.Background()); err != nil {
		t.Fatalf("GetPositions: %v", err)
	}
	logged := warns()
	if len(logged) != 1 || logged[0]["host"] != f347PaperHost || logged[0]["wait_ms"] != "2000" {
		t.Fatalf("WARN logs = %v, want exactly one naming host %s and wait_ms 2000", logged, f347PaperHost)
	}
}

// @AC-20 (guard): credentials are tracked independently on the same host. The keying itself is pinned in pace_test.go.
func TestGetAccount_CredentialsTrackedSeparately_F347_AC20(t *testing.T) {
	clock := &f347Clock{now: f347Start}
	rtA := &f347RT{respond: func(int, *http.Request) (*http.Response, error) {
		return f347Resp(200, f347Account, f347RateHeaders(200, 0, f347Start.Add(5*time.Second))...)
	}}
	a := f347Client(rtA, clock, f347Opts{key: "KEY-A", budget: f347Budget(20 * time.Second)})
	if _, err := a.GetAccount(context.Background()); err != nil {
		t.Fatalf("client A priming request: %v", err)
	}
	rtB := &f347RT{respond: func(int, *http.Request) (*http.Response, error) { return f347Resp(200, f347Account) }}
	b := f347Client(rtB, clock, f347Opts{key: "KEY-B", budget: f347Budget(20 * time.Second)})
	if _, err := b.GetAccount(context.Background()); err != nil {
		t.Fatalf("client B GetAccount: %v", err)
	}
	if sleeps := clock.recorded(); len(sleeps) != 0 {
		t.Fatalf("client B waited %v for client A's reset", sleeps)
	}
	if got := rtB.seen(); len(got) != 1 || got[0].host != f347PaperHost {
		t.Fatalf("client B attempts = %+v, want one on %s", got, f347PaperHost)
	}
}

// @AC-23: a read that cannot outwait a hold is refused without a request.
func TestGetPositions_HoldThatCannotFitIsRefused_F347_AC23(t *testing.T) {
	rt := &f347RT{respond: func(n int, _ *http.Request) (*http.Response, error) {
		if n == 0 {
			return f347Resp(200, f347Account, f347RateHeaders(200, 0, time.Now().Add(10*time.Second))...)
		}
		return f347Resp(200, `[]`)
	}}
	c := f347Client(rt, nil, f347Opts{timeout: 5000 * time.Millisecond, budget: f347Budget(20 * time.Second)})
	if _, err := c.GetAccount(context.Background()); err != nil {
		t.Fatalf("priming request: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	began := time.Now()
	_, err := c.GetPositions(ctx)
	if took := time.Since(began); took > 100*time.Millisecond {
		t.Fatalf("refused after %v, want within 100 ms", took)
	}
	f347WantRateLimited(t, err, f347PaperHost)
	if n := len(rt.seen()); n != 1 {
		t.Fatalf("attempts = %d, want no positions request sent", n)
	}
}

// @AC-27 (client side): an attempt that times out inside a retry is a timeout, never ErrRateLimited.
func TestSubmitOrder_TimeoutInsideRetryStaysATimeout_F347_AC27(t *testing.T) {
	rt := &f347RT{respond: func(n int, req *http.Request) (*http.Response, error) {
		if n == 0 {
			return f347Resp(429, `{}`)
		}
		select {
		case <-req.Context().Done():
			return nil, req.Context().Err()
		case <-time.After(3 * time.Second):
			return f347Resp(200, `{"id":"late"}`)
		}
	}}
	c := f347Client(rt, nil, f347Opts{timeout: 1000 * time.Millisecond, budget: f347Budget(28 * time.Second)})
	_, err := c.SubmitOrder(context.Background(), f347Market("c-27"))
	if n := len(rt.seen()); n != 2 {
		t.Fatalf("attempts = %d, want 2", n)
	}
	var netErr net.Error
	if !errors.Is(err, context.DeadlineExceeded) && (!errors.As(err, &netErr) || !netErr.Timeout()) {
		t.Fatalf("error = %v, want a timeout", err)
	}
	if errors.Is(err, broker.ErrRateLimited) {
		t.Fatalf("a timed-out attempt was reported as rate limited: %v", err)
	}
}

// A call bounded by one timeout (the pollers) sends its zero-wait attempt and never waits or retries.
func TestGetOrder_OneTimeoutDeadlineSendsExactlyOnce_F347(t *testing.T) {
	clock := &f347Clock{now: f347Start}
	rt := &f347RT{respond: func(int, *http.Request) (*http.Response, error) {
		return f347Resp(429, `{}`, f347ResetOnly(f347Start.Add(10*time.Second))...)
	}}
	c := f347Client(rt, clock, f347Opts{timeout: 5 * time.Second, budget: f347Budget(20 * time.Second)})
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, err := c.GetOrder(ctx, "b-1")
	f347WantRateLimited(t, err, f347PaperHost)
	if n := len(rt.seen()); n != 1 {
		t.Fatalf("attempts = %d, want exactly 1", n)
	}
	if sleeps := clock.recorded(); len(sleeps) != 0 {
		t.Fatalf("a one-timeout call slept: %v", sleeps)
	}
}

// FR-5: with no rate-limit headers nothing is paced, and a bare 429 still retries on backoff.
func TestDoPaced_DegradesWithoutHeaders_F347(t *testing.T) {
	clock := &f347Clock{now: f347Start}
	rt := &f347RT{respond: func(n int, _ *http.Request) (*http.Response, error) {
		if n == 3 {
			return f347Resp(429, `{}`)
		}
		return f347Resp(200, f347Account)
	}}
	c := f347Client(rt, clock, f347Opts{budget: f347Budget(20 * time.Second)})
	for i := 0; i < 3; i++ {
		if _, err := c.GetAccount(context.Background()); err != nil {
			t.Fatalf("request %d: %v", i+1, err)
		}
	}
	if sleeps := clock.recorded(); len(sleeps) != 0 {
		t.Fatalf("a header-less response caused a wait: %v", sleeps)
	}
	if _, err := c.GetAccount(context.Background()); err != nil {
		t.Fatalf("request after a bare 429: %v", err)
	}
	if sleeps := clock.recorded(); len(sleeps) != 1 || sleeps[0] != time.Second {
		t.Fatalf("waits = %v, want one 1 s backoff", sleeps)
	}
}

// A mutation is detached from caller cancellation; a read cancelled during a wait is a rate-limit refusal.
func TestDoPaced_CallerCancelDuringAWait_F347(t *testing.T) {
	script := func(n int, _ *http.Request) (*http.Response, error) {
		if n == 0 {
			return f347Resp(429, `{}`)
		}
		return f347Resp(200, `{"id":"b-9","status":"new"}`)
	}
	ctx, cancel := context.WithCancel(context.Background())
	clock := &f347Clock{now: f347Start, onSleep: cancel}
	rt := &f347RT{respond: script}
	c := f347Client(rt, clock, f347Opts{budget: f347Budget(20 * time.Second)})
	order, err := c.SubmitOrder(ctx, f347Market("c-9"))
	if err != nil || order.BrokerOrderID != "b-9" {
		t.Fatalf("mutation: order = %+v, err = %v; want the retry sent and b-9 returned", order, err)
	}
	if n := len(rt.seen()); n != 2 {
		t.Fatalf("mutation attempts = %d, want 2", n)
	}

	ctx, cancel = context.WithCancel(context.Background())
	clock = &f347Clock{now: f347Start, onSleep: cancel}
	rt = &f347RT{respond: script}
	c = f347Client(rt, clock, f347Opts{budget: f347Budget(20 * time.Second)})
	_, err = c.GetAccount(ctx)
	f347WantRateLimited(t, err, f347PaperHost)
	if n := len(rt.seen()); n != 1 {
		t.Fatalf("read attempts = %d, want no retry after the caller cancelled", n)
	}
}

// TRADING-3: a 401 on a retry is still a credential rejection.
func TestValidateCredentials_401OnRetryIsInvalidCredentials_F347(t *testing.T) {
	clock := &f347Clock{now: f347Start}
	rt := &f347RT{respond: func(n int, _ *http.Request) (*http.Response, error) {
		if n == 0 {
			return f347Resp(429, `{}`)
		}
		return f347Resp(401, `{}`)
	}}
	c := f347Client(rt, clock, f347Opts{budget: f347Budget(20 * time.Second)})
	err := c.ValidateCredentials(context.Background())
	if !errors.Is(err, broker.ErrInvalidCredentials) || errors.Is(err, broker.ErrRateLimited) {
		t.Fatalf("error = %v, want ErrInvalidCredentials only", err)
	}
}
