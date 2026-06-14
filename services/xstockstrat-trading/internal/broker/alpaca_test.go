package broker_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

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
			"unrealized_plpc": "-0.396"
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
