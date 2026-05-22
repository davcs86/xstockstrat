package broker_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/xstockstrat/trading/internal/broker"
)

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
