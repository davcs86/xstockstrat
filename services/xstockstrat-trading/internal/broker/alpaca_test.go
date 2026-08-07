package broker_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
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
	// A configured timeout is applied; zero falls back to the documented default.
	c := broker.NewClient(broker.ClientConfig{APIKey: "k", APISecret: "s", TimeoutMs: 1234})
	if got := c.HTTPTimeout(); got != 1234*time.Millisecond {
		t.Errorf("expected timeout 1234ms, got %v", got)
	}
	d := broker.NewClient(broker.ClientConfig{APIKey: "k", APISecret: "s"})
	if got := d.HTTPTimeout(); got != 5000*time.Millisecond {
		t.Errorf("expected default timeout 5000ms, got %v", got)
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
