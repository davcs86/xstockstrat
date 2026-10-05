package broker_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/xstockstrat/trading/internal/broker"
)

// Regression suite for docs/reports/2026-10-03-ibkr-confirmation-prompt-unplaced-order-defect.md.

func ibkrOrdersServer(t *testing.T, ordersReply interface{}, capture *map[string]interface{}) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/iserver/secdef/search":
			_ = json.NewEncoder(w).Encode([]map[string]interface{}{{"conid": 265598}})
		case "/iserver/account/U1/orders", "/iserver/account/U1/order/ord-1":
			var payload map[string]interface{}
			_ = json.NewDecoder(r.Body).Decode(&payload)
			if capture != nil {
				*capture = payload
			}
			_ = json.NewEncoder(w).Encode(ordersReply)
		default:
			http.NotFound(w, r)
		}
	}))
}

var promptReply = []map[string]interface{}{{
	"id": "07a13a5a-4a48-44a5-bb25-5ab37b79186c", "message": []string{"Order size exceeds the precautionary limit"},
}}

func TestIBKRSubmitOrder_ConfirmationPrompt_FailsLoudly(t *testing.T) {
	srv := ibkrOrdersServer(t, promptReply, nil)
	defer srv.Close()
	c := broker.NewIBKRClient(broker.IBKRConfig{BaseURL: srv.URL, IBKRAccountID: "U1"})

	o, err := c.SubmitOrder(context.Background(), broker.OrderRequest{Symbol: "AAPL", Side: "buy", OrderType: "market", Qty: 10, TimeInForce: "day"})
	if !errors.Is(err, broker.ErrIBKRConfirmationRequired) {
		t.Fatalf("err = %v (order %+v), want ErrIBKRConfirmationRequired — pre-fix returned success with an empty broker id", err, o)
	}
}

func TestIBKRSubmitOrder_EmptyOrderID_IsError(t *testing.T) {
	srv := ibkrOrdersServer(t, []map[string]interface{}{{"order_status": "PreSubmitted"}}, nil)
	defer srv.Close()
	c := broker.NewIBKRClient(broker.IBKRConfig{BaseURL: srv.URL, IBKRAccountID: "U1"})

	if o, err := c.SubmitOrder(context.Background(), broker.OrderRequest{Symbol: "AAPL", Side: "buy", OrderType: "market", Qty: 10, TimeInForce: "day"}); err == nil {
		t.Fatalf("got success with order %+v, want an error for an empty order_id", o)
	}
}

func TestIBKRReplaceOrder_ConfirmationPrompt_FailsLoudly(t *testing.T) {
	srv := ibkrOrdersServer(t, promptReply, nil)
	defer srv.Close()
	c := broker.NewIBKRClient(broker.IBKRConfig{BaseURL: srv.URL, IBKRAccountID: "U1"})

	if _, err := c.ReplaceOrder(context.Background(), "ord-1", broker.OrderRequest{Qty: 5}); !errors.Is(err, broker.ErrIBKRConfirmationRequired) {
		t.Fatalf("err = %v, want ErrIBKRConfirmationRequired", err)
	}
}

func TestIBKRSubmitBracketLegs_ConfirmationPrompt_FailsLoudly(t *testing.T) {
	srv := ibkrOrdersServer(t, promptReply, nil)
	defer srv.Close()
	c := broker.NewIBKRClient(broker.IBKRConfig{BaseURL: srv.URL, IBKRAccountID: "U1"})

	_, err := c.SubmitBracketLegs(context.Background(), "parent-bo", "parent-coid", broker.BracketLegsRequest{
		Symbol: "AAPL", Side: "sell", Qty: 10, TimeInForce: "gtc", StopPrice: 95,
	})
	if !errors.Is(err, broker.ErrIBKRConfirmationRequired) {
		t.Fatalf("err = %v, want ErrIBKRConfirmationRequired", err)
	}
}

func TestIBKRSubmitOrder_TrailingStop_SendsTrailingFields(t *testing.T) {
	for _, tc := range []struct {
		name     string
		req      broker.OrderRequest
		wantAmt  float64
		wantType string
	}{
		{"amount", broker.OrderRequest{TrailPrice: 1.5}, 1.5, "amt"},
		{"percent", broker.OrderRequest{TrailPercent: 2}, 2, "%"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var got map[string]interface{}
			srv := ibkrOrdersServer(t, []map[string]interface{}{{"order_id": "o-1", "order_status": "PreSubmitted"}}, &got)
			defer srv.Close()
			c := broker.NewIBKRClient(broker.IBKRConfig{BaseURL: srv.URL, IBKRAccountID: "U1"})

			req := tc.req
			req.Symbol, req.Side, req.OrderType, req.Qty, req.TimeInForce = "AAPL", "sell", "trailing_stop", 10, "gtc"
			if _, err := c.SubmitOrder(context.Background(), req); err != nil {
				t.Fatalf("SubmitOrder: %v", err)
			}
			ord := got["orders"].([]interface{})[0].(map[string]interface{})
			if ord["orderType"] != "TRAIL" || ord["trailingAmt"] != tc.wantAmt || ord["trailingType"] != tc.wantType {
				t.Fatalf("order = %v, want TRAIL trailingAmt=%v trailingType=%q", ord, tc.wantAmt, tc.wantType)
			}
		})
	}
}
