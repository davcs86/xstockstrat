package handler

import (
	"encoding/json"
	"log/slog"
	"net/http"

	tradingv1 "github.com/xstockstrat/contracts/gen/go/trading/v1"
	"github.com/xstockstrat/trading/internal/service"
)

// N8nHandler translates incoming n8n webhook payloads to internal gRPC calls.
// Mount at: POST /webhooks/n8n/:action
type N8nHandler struct {
	svc *service.TradingService
}

func NewN8nHandler(svc *service.TradingService) *N8nHandler {
	return &N8nHandler{svc: svc}
}

// PlaceOrderWebhook handles n8n → place order
// POST /webhooks/n8n/place-order
func (h *N8nHandler) PlaceOrderWebhook(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		Symbol     string  `json:"symbol"`
		Side       string  `json:"side"`
		Qty        float64 `json:"qty"`
		OrderType  string  `json:"order_type"`
		LimitPrice float64 `json:"limit_price"`
		StrategyID string  `json:"strategy_id"`
		UserID     string  `json:"user_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "invalid payload", http.StatusBadRequest)
		return
	}

	sideMap := map[string]tradingv1.OrderSide{
		"buy":  tradingv1.OrderSide_ORDER_SIDE_BUY,
		"sell": tradingv1.OrderSide_ORDER_SIDE_SELL,
	}
	typeMap := map[string]tradingv1.OrderType{
		"market":     tradingv1.OrderType_ORDER_TYPE_MARKET,
		"limit":      tradingv1.OrderType_ORDER_TYPE_LIMIT,
		"stop":       tradingv1.OrderType_ORDER_TYPE_STOP,
		"stop_limit": tradingv1.OrderType_ORDER_TYPE_STOP_LIMIT,
	}

	req := &tradingv1.PlaceOrderRequest{
		Symbol:     payload.Symbol,
		Side:       sideMap[payload.Side],
		OrderType:  typeMap[payload.OrderType],
		Qty:        payload.Qty,
		LimitPrice: payload.LimitPrice,
		StrategyId: payload.StrategyID,
		UserId:     payload.UserID,
	}

	order, err := h.svc.PlaceOrder(r.Context(), req)
	if err != nil {
		slog.Error("n8n place-order failed", "error", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"order_id": order.OrderId,
		"status":   order.Status.String(),
	})
}

// CancelOrderWebhook handles n8n → cancel order
// POST /webhooks/n8n/cancel-order
func (h *N8nHandler) CancelOrderWebhook(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		OrderID string `json:"order_id"`
		UserID  string `json:"user_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "invalid payload", http.StatusBadRequest)
		return
	}
	resp, err := h.svc.CancelOrder(r.Context(), &tradingv1.CancelOrderRequest{
		OrderId: payload.OrderID,
		UserId:  payload.UserID,
	})
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}
