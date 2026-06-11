package broker_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/xstockstrat/trading/internal/broker"
)

func TestSubmitOrder_IBKRResolvesConid(t *testing.T) {
	const wantConid = int64(265598)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/iserver/secdef/search":
			if r.URL.Query().Get("symbol") != "AAPL" || r.URL.Query().Get("types") != "STK" {
				http.Error(w, "bad params", http.StatusBadRequest)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode([]map[string]interface{}{
				{"conid": wantConid, "description": "AAPL"},
			})
		case "/iserver/account/U1234567/orders":
			var payload map[string]interface{}
			_ = json.NewDecoder(r.Body).Decode(&payload)
			orders, _ := payload["orders"].([]interface{})
			if len(orders) == 0 {
				http.Error(w, "no orders", http.StatusBadRequest)
				return
			}
			ord := orders[0].(map[string]interface{})
			got := int64(ord["conid"].(float64))
			if got != wantConid {
				http.Error(w, fmt.Sprintf("wrong conid: %d", got), http.StatusBadRequest)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode([]map[string]interface{}{
				{"order_id": "ibkr-ord-99", "order_status": "PreSubmitted"},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	c := broker.NewIBKRClient(broker.IBKRConfig{
		BaseURL:       srv.URL,
		IBKRAccountID: "U1234567",
	})

	o, err := c.SubmitOrder(context.Background(), broker.OrderRequest{
		Symbol:      "AAPL",
		Side:        "buy",
		OrderType:   "market",
		Qty:         10,
		TimeInForce: "day",
	})
	if err != nil {
		t.Fatalf("SubmitOrder failed: %v", err)
	}
	if o.BrokerOrderID != "ibkr-ord-99" {
		t.Errorf("expected order id ibkr-ord-99, got %s", o.BrokerOrderID)
	}
}

func TestSubmitOrder_IBKRConidNotFound(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/iserver/secdef/search" {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode([]map[string]interface{}{})
		} else {
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	c := broker.NewIBKRClient(broker.IBKRConfig{BaseURL: srv.URL})
	_, err := c.SubmitOrder(context.Background(), broker.OrderRequest{Symbol: "UNKNOWN"})
	if err == nil {
		t.Fatal("expected error for unknown symbol, got nil")
	}
}

func TestGetOrder_IBKRAvgPrice(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/iserver/account/orders" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"orders": []map[string]interface{}{
				{"orderId": "ibkr-ord-1", "status": "Filled", "avgPrice": 82.25},
			},
		})
	}))
	defer srv.Close()

	c := broker.NewIBKRClient(broker.IBKRConfig{
		BaseURL: srv.URL,
	})

	o, err := c.GetOrder(context.Background(), "ibkr-ord-1")
	if err != nil {
		t.Fatalf("GetOrder failed: %v", err)
	}
	if o.FilledAvgPrice != 82.25 {
		t.Errorf("expected FilledAvgPrice 82.25, got %f", o.FilledAvgPrice)
	}
	if o.Status != "Filled" {
		t.Errorf("expected status Filled, got %s", o.Status)
	}
}

func TestReplaceOrder_IBKR(t *testing.T) {
	var gotMethod, gotPath, gotAuth string
	var gotBody map[string]interface{}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/iserver/account/U1234567/order/ibkr-ord-99" {
			gotMethod = r.Method
			gotPath = r.URL.Path
			gotAuth = r.Header.Get("Authorization")
			_ = json.NewDecoder(r.Body).Decode(&gotBody)
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode([]map[string]interface{}{
				{"order_id": "ibkr-ord-99", "order_status": "Submitted"},
			})
			return
		}
		http.NotFound(w, r)
	}))
	defer srv.Close()

	c := broker.NewIBKRClient(broker.IBKRConfig{
		BaseURL:       srv.URL,
		IBKRAccountID: "U1234567",
	})

	o, err := c.ReplaceOrder(context.Background(), "ibkr-ord-99", broker.OrderRequest{
		Qty:        7,
		LimitPrice: 250,
	})
	if err != nil {
		t.Fatalf("ReplaceOrder failed: %v", err)
	}
	if gotMethod != http.MethodPost {
		t.Errorf("expected POST (IBKR modify), got %s", gotMethod)
	}
	if gotPath != "/iserver/account/U1234567/order/ibkr-ord-99" {
		t.Errorf("expected modify path /iserver/account/U1234567/order/ibkr-ord-99, got %s", gotPath)
	}
	if gotAuth == "" {
		t.Error("expected a signed Authorization header on the IBKR modify request")
	}
	if got := gotBody["quantity"]; got != float64(7) {
		t.Errorf("expected quantity 7, got %v", got)
	}
	if got := gotBody["price"]; got != float64(250) {
		t.Errorf("expected price 250, got %v", got)
	}
	if _, ok := gotBody["auxPrice"]; ok {
		t.Error("auxPrice should be omitted when stop price is zero")
	}
	if o.BrokerOrderID != "ibkr-ord-99" {
		t.Errorf("expected order id ibkr-ord-99, got %s", o.BrokerOrderID)
	}
	if o.Status != "Submitted" {
		t.Errorf("expected status Submitted, got %s", o.Status)
	}
}
