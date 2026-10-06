package broker_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
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

func promptReply(id string) []map[string]interface{} {
	return []map[string]interface{}{{"id": id, "message": []string{"Order size exceeds the precautionary limit"}}}
}

// promptServer answers the order POST with a prompt and each /iserver/reply/{id} with the next
// scripted reply; it records every confirmation body it received.
type promptServer struct {
	*httptest.Server
	replies     []interface{}
	confirmed   []map[string]interface{}
	confirmPath []string
}

func newPromptServer(t *testing.T, replies ...interface{}) *promptServer {
	t.Helper()
	ps := &promptServer{replies: replies}
	ps.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.URL.Path == "/iserver/secdef/search":
			_ = json.NewEncoder(w).Encode([]map[string]interface{}{{"conid": 265598}})
		case r.URL.Path == "/iserver/account/U1/orders" || r.URL.Path == "/iserver/account/U1/order/ord-1":
			_ = json.NewEncoder(w).Encode(promptReply("p-0"))
		case strings.HasPrefix(r.URL.Path, "/iserver/reply/"):
			var body map[string]interface{}
			_ = json.NewDecoder(r.Body).Decode(&body)
			ps.confirmed = append(ps.confirmed, body)
			ps.confirmPath = append(ps.confirmPath, r.URL.Path)
			next := ps.replies[0]
			if len(ps.replies) > 1 {
				ps.replies = ps.replies[1:]
			}
			_ = json.NewEncoder(w).Encode(next)
		default:
			http.NotFound(w, r)
		}
	}))
	return ps
}

func TestIBKRSubmitOrder_ConfirmationPrompt_AutoConfirmedAndPlaced(t *testing.T) {
	srv := newPromptServer(t, promptReply("p-1"), []map[string]interface{}{{"order_id": "ibkr-77", "order_status": "PreSubmitted"}})
	defer srv.Close()
	c := broker.NewIBKRClient(broker.IBKRConfig{BaseURL: srv.URL, IBKRAccountID: "U1"})

	o, err := c.SubmitOrder(context.Background(), broker.OrderRequest{Symbol: "AAPL", Side: "buy", OrderType: "market", Qty: 10, TimeInForce: "day"})
	if err != nil {
		t.Fatalf("SubmitOrder: %v", err)
	}
	if o.BrokerOrderID != "ibkr-77" {
		t.Fatalf("broker order id = %q, want ibkr-77 (pre-fix: empty id reported as success)", o.BrokerOrderID)
	}
	if got := strings.Join(srv.confirmPath, ","); got != "/iserver/reply/p-0,/iserver/reply/p-1" {
		t.Fatalf("confirmed prompts = %s, want both chained prompts answered in order", got)
	}
	for _, b := range srv.confirmed {
		if b["confirmed"] != true {
			t.Fatalf("confirmation body = %v, want confirmed:true", b)
		}
	}
}

func TestIBKRSubmitOrder_EndlessPrompts_FailClosed(t *testing.T) {
	srv := newPromptServer(t, promptReply("p-n"))
	defer srv.Close()
	c := broker.NewIBKRClient(broker.IBKRConfig{BaseURL: srv.URL, IBKRAccountID: "U1"})

	_, err := c.SubmitOrder(context.Background(), broker.OrderRequest{Symbol: "AAPL", Side: "buy", OrderType: "market", Qty: 10, TimeInForce: "day"})
	if !errors.Is(err, broker.ErrIBKRConfirmationRequired) {
		t.Fatalf("err = %v, want ErrIBKRConfirmationRequired once the confirm budget is spent", err)
	}
	if len(srv.confirmed) != 5 {
		t.Fatalf("confirmations sent = %d, want the bounded 5", len(srv.confirmed))
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

func TestIBKRReplaceOrder_ConfirmationPrompt_AutoConfirmed(t *testing.T) {
	srv := newPromptServer(t, []map[string]interface{}{{"order_id": "ord-1", "order_status": "Submitted"}})
	defer srv.Close()
	c := broker.NewIBKRClient(broker.IBKRConfig{BaseURL: srv.URL, IBKRAccountID: "U1"})

	if _, err := c.ReplaceOrder(context.Background(), "ord-1", broker.OrderRequest{Qty: 5}); err != nil {
		t.Fatalf("ReplaceOrder: %v", err)
	}
	if len(srv.confirmed) != 1 {
		t.Fatalf("confirmations = %d, want 1", len(srv.confirmed))
	}
}

func TestIBKRSubmitBracketLegs_ConfirmationPrompt_AutoConfirmed(t *testing.T) {
	srv := newPromptServer(t, []map[string]interface{}{{"order_id": "leg-stop"}, {"order_id": "leg-tp"}})
	defer srv.Close()
	c := broker.NewIBKRClient(broker.IBKRConfig{BaseURL: srv.URL, IBKRAccountID: "U1"})

	resp, err := c.SubmitBracketLegs(context.Background(), "parent-bo", "parent-coid", broker.BracketLegsRequest{
		Symbol: "AAPL", Side: "sell", Qty: 10, TimeInForce: "gtc", StopPrice: 95, TakeProfitPrice: 120,
	})
	if err != nil || resp.StopLegOrderID != "leg-stop" || resp.TakeProfitLegOrderID != "leg-tp" {
		t.Fatalf("resp=%+v err=%v, want both legs placed after confirmation", resp, err)
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
