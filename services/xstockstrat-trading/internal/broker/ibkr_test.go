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

func TestSubmitOrder_IBKR_ClientOrderIDForwarded(t *testing.T) {
	const wantConid = int64(265598)
	var gotCOID string

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/iserver/secdef/search":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode([]map[string]interface{}{
				{"conid": wantConid, "description": "AAPL"},
			})
		case "/iserver/account/U1234567/orders":
			var payload map[string]interface{}
			_ = json.NewDecoder(r.Body).Decode(&payload)
			orders, _ := payload["orders"].([]interface{})
			ord := orders[0].(map[string]interface{})
			if v, ok := ord["cOID"].(string); ok {
				gotCOID = v
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

	_, err := c.SubmitOrder(context.Background(), broker.OrderRequest{
		Symbol:        "AAPL",
		Side:          "buy",
		OrderType:     "market",
		Qty:           10,
		TimeInForce:   "day",
		ClientOrderID: "xss-test-intent",
	})
	if err != nil {
		t.Fatalf("SubmitOrder failed: %v", err)
	}
	if gotCOID != "xss-test-intent" {
		t.Errorf("expected cOID %q forwarded to IBKR, got %q", "xss-test-intent", gotCOID)
	}
}

// TestSubmitBracketLegs_SubmitsSingleGroupArray (feature 030): the stop-loss + take-profit
// legs must be submitted together as a JSON array, each carrying isSingleGroup: true and
// parentId equal to the parent order's cOID — IBKR has no client-settable OCA group field.
func TestSubmitBracketLegs_SubmitsSingleGroupArray(t *testing.T) {
	const wantConid = int64(265598)
	var gotOrders []interface{}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/iserver/secdef/search":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode([]map[string]interface{}{
				{"conid": wantConid, "description": "AAPL"},
			})
		case "/iserver/account/U1234567/orders":
			var payload map[string]interface{}
			_ = json.NewDecoder(r.Body).Decode(&payload)
			gotOrders, _ = payload["orders"].([]interface{})
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode([]map[string]interface{}{
				{"order_id": "ibkr-stop-1"},
				{"order_id": "ibkr-tp-1"},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	c := broker.NewIBKRClient(broker.IBKRConfig{BaseURL: srv.URL, IBKRAccountID: "U1234567"})

	resp, err := c.SubmitBracketLegs(context.Background(), "brk-1", "parent-coid-1", broker.BracketLegsRequest{
		Symbol: "AAPL", Side: "sell", Qty: 10, StopPrice: 178.0, TakeProfitPrice: 210.0, TimeInForce: "day",
	})
	if err != nil {
		t.Fatalf("SubmitBracketLegs failed: %v", err)
	}
	if len(gotOrders) != 2 {
		t.Fatalf("expected 2 orders in the array, got %d", len(gotOrders))
	}
	stopLeg := gotOrders[0].(map[string]interface{})
	if stopLeg["isSingleGroup"] != true {
		t.Errorf("expected isSingleGroup=true on the stop leg, got %v", stopLeg["isSingleGroup"])
	}
	if stopLeg["parentId"] != "parent-coid-1" {
		t.Errorf("expected parentId=parent-coid-1 on the stop leg, got %v", stopLeg["parentId"])
	}
	if stopLeg["orderType"] != "STP" {
		t.Errorf("expected orderType=STP on the stop leg, got %v", stopLeg["orderType"])
	}
	if stopLeg["auxPrice"] != float64(178.0) {
		t.Errorf("expected auxPrice=178 on the stop leg, got %v", stopLeg["auxPrice"])
	}
	tpLeg := gotOrders[1].(map[string]interface{})
	if tpLeg["orderType"] != "LMT" {
		t.Errorf("expected orderType=LMT on the take-profit leg, got %v", tpLeg["orderType"])
	}
	if tpLeg["price"] != float64(210.0) {
		t.Errorf("expected price=210 on the take-profit leg, got %v", tpLeg["price"])
	}
	if tpLeg["isSingleGroup"] != true {
		t.Errorf("expected isSingleGroup=true on the take-profit leg, got %v", tpLeg["isSingleGroup"])
	}
	if resp.StopLegOrderID != "ibkr-stop-1" {
		t.Errorf("expected StopLegOrderID=ibkr-stop-1, got %s", resp.StopLegOrderID)
	}
	if resp.TakeProfitLegOrderID != "ibkr-tp-1" {
		t.Errorf("expected TakeProfitLegOrderID=ibkr-tp-1, got %s", resp.TakeProfitLegOrderID)
	}
}

// TestSubmitBracketLegs_NoTakeProfitSendsOneOrder confirms only the stop leg is sent
// when TakeProfitPrice is 0.
func TestSubmitBracketLegs_NoTakeProfitSendsOneOrder(t *testing.T) {
	const wantConid = int64(265598)
	var gotOrders []interface{}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/iserver/secdef/search":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode([]map[string]interface{}{
				{"conid": wantConid, "description": "AAPL"},
			})
		case "/iserver/account/U1234567/orders":
			var payload map[string]interface{}
			_ = json.NewDecoder(r.Body).Decode(&payload)
			gotOrders, _ = payload["orders"].([]interface{})
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode([]map[string]interface{}{
				{"order_id": "ibkr-stop-2"},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	c := broker.NewIBKRClient(broker.IBKRConfig{BaseURL: srv.URL, IBKRAccountID: "U1234567"})

	resp, err := c.SubmitBracketLegs(context.Background(), "brk-2", "parent-coid-2", broker.BracketLegsRequest{
		Symbol: "AAPL", Side: "sell", Qty: 10, StopPrice: 178.0, TimeInForce: "day",
	})
	if err != nil {
		t.Fatalf("SubmitBracketLegs failed: %v", err)
	}
	if len(gotOrders) != 1 {
		t.Fatalf("expected 1 order in the array, got %d", len(gotOrders))
	}
	if resp.TakeProfitLegOrderID != "" {
		t.Errorf("expected no TakeProfitLegOrderID, got %s", resp.TakeProfitLegOrderID)
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

func TestIBKRListOrders_AccountScoping(t *testing.T) {
	var gotAccountID string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAccountID = r.URL.Query().Get("accountId")
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"orders": []map[string]interface{}{}})
	}))
	defer srv.Close()

	c := broker.NewIBKRClient(broker.IBKRConfig{BaseURL: srv.URL, IBKRAccountID: "U1234567"})
	if _, err := c.ListOrders(context.Background()); err != nil {
		t.Fatalf("ListOrders failed: %v", err)
	}
	if gotAccountID != "U1234567" {
		t.Errorf("expected accountId=U1234567 on the request, got %q", gotAccountID)
	}
}

func TestIBKRListOrders_ParsesMultipleOrders(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"orders": []map[string]interface{}{
				{"orderId": "ibkr-ord-1", "status": "Filled", "avgPrice": 82.25, "filledQuantity": 10.0},
				{"orderId": "ibkr-ord-2", "status": "Submitted", "avgPrice": 0.0, "filledQuantity": 0.0},
			},
		})
	}))
	defer srv.Close()

	c := broker.NewIBKRClient(broker.IBKRConfig{BaseURL: srv.URL, IBKRAccountID: "U1234567"})
	orders, err := c.ListOrders(context.Background())
	if err != nil {
		t.Fatalf("ListOrders failed: %v", err)
	}
	if len(orders) != 2 {
		t.Fatalf("expected 2 orders (proves the single-match orderId filter was dropped), got %d", len(orders))
	}
	if orders[0].BrokerOrderID != "ibkr-ord-1" || orders[1].BrokerOrderID != "ibkr-ord-2" {
		t.Errorf("unexpected order IDs: %+v", orders)
	}
}

func TestIBKRListOrders_ClientOrderIDAlwaysEmpty(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"orders": []map[string]interface{}{
				{"orderId": "ibkr-ord-1", "status": "Filled", "avgPrice": 82.25, "filledQuantity": 10.0},
			},
		})
	}))
	defer srv.Close()

	c := broker.NewIBKRClient(broker.IBKRConfig{BaseURL: srv.URL, IBKRAccountID: "U1234567"})
	orders, err := c.ListOrders(context.Background())
	if err != nil {
		t.Fatalf("ListOrders failed: %v", err)
	}
	for _, o := range orders {
		if o.ClientOrderID != "" {
			t.Errorf("expected ClientOrderID to always be empty for IBKR (never sent on submit), got %q", o.ClientOrderID)
		}
	}
}
