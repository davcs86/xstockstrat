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
