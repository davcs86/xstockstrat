package broker

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"
)

// ClientConfig holds Alpaca broker API credentials and routing config.
// xstockstrat-trading is the ONLY service that imports or uses this package.
type ClientConfig struct {
	APIKey    string
	APISecret string
	PaperURL  string // e.g. https://paper-api.alpaca.markets
	LiveURL   string // e.g. https://api.alpaca.markets
	Paper     bool   // when true, routes to PaperURL; when false, routes to LiveURL
}

// Client submits and manages orders via Alpaca's broker REST API.
// Paper and live modes share the same API surface; only the base URL differs.
type Client struct {
	cfg        ClientConfig
	httpClient *http.Client
}

func NewClient(cfg ClientConfig) *Client {
	if cfg.PaperURL == "" {
		cfg.PaperURL = "https://paper-api.alpaca.markets"
	}
	if cfg.LiveURL == "" {
		cfg.LiveURL = "https://api.alpaca.markets"
	}
	return &Client{
		cfg: cfg,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// baseURL returns the correct base URL based on the Paper flag.
func (c *Client) baseURL() string {
	if c.cfg.Paper {
		return c.cfg.PaperURL
	}
	return c.cfg.LiveURL
}

// IsPaper reports whether this client is configured for paper trading.
func (c *Client) IsPaper() bool {
	return c.cfg.Paper
}

// SubmitOrderRequest is the input to SubmitOrder.
type SubmitOrderRequest struct {
	Symbol        string `json:"symbol"`
	Qty           string `json:"qty"`           // Alpaca expects string
	Side          string `json:"side"`          // "buy" or "sell"
	Type          string `json:"type"`          // "market", "limit", "stop", "stop_limit", "trailing_stop"
	TimeInForce   string `json:"time_in_force"` // "day", "gtc", "ioc", "fok"
	LimitPrice    string `json:"limit_price,omitempty"`
	StopPrice     string `json:"stop_price,omitempty"`
	ClientOrderID string `json:"client_order_id,omitempty"`
}

// AlpacaOrder mirrors the Alpaca v2 order response object.
type AlpacaOrder struct {
	ID             string `json:"id"`
	ClientOrderID  string `json:"client_order_id"`
	Status         string `json:"status"`
	Symbol         string `json:"symbol"`
	Qty            string `json:"qty"`
	FilledQty      string `json:"filled_qty"`
	FilledAvgPrice string `json:"filled_avg_price"`
	Side           string `json:"side"`
	Type           string `json:"type"`
	TimeInForce    string `json:"time_in_force"`
	LimitPrice     string `json:"limit_price"`
	StopPrice      string `json:"stop_price"`
	CreatedAt      string `json:"created_at"`
	UpdatedAt      string `json:"updated_at"`
}

// SubmitOrder places an order via POST /v2/orders.
// Returns the normalized broker order including the broker-assigned order ID.
func (c *Client) SubmitOrder(ctx context.Context, req OrderRequest) (*BrokerOrder, error) {
	alpacaReq := struct {
		Symbol      string `json:"symbol"`
		Qty         string `json:"qty"`
		Side        string `json:"side"`
		Type        string `json:"type"`
		TimeInForce string `json:"time_in_force"`
		LimitPrice  string `json:"limit_price,omitempty"`
		StopPrice   string `json:"stop_price,omitempty"`
	}{
		Symbol:      req.Symbol,
		Qty:         strconv.FormatFloat(req.Qty, 'f', -1, 64),
		Side:        req.Side,
		Type:        req.OrderType,
		TimeInForce: req.TimeInForce,
	}
	if req.LimitPrice != 0 {
		alpacaReq.LimitPrice = strconv.FormatFloat(req.LimitPrice, 'f', -1, 64)
	}
	if req.StopPrice != 0 {
		alpacaReq.StopPrice = strconv.FormatFloat(req.StopPrice, 'f', -1, 64)
	}

	body, err := json.Marshal(alpacaReq)
	if err != nil {
		return nil, fmt.Errorf("marshal order request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost,
		fmt.Sprintf("%s/v2/orders", c.baseURL()),
		bytes.NewReader(body),
	)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	c.setAuthHeaders(httpReq)
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("submit order: %w", err)
	}
	defer resp.Body.Close() //nolint:errcheck

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("alpaca broker error (status %d): %s", resp.StatusCode, string(respBody))
	}

	var alpacaResp AlpacaOrder
	if err := json.Unmarshal(respBody, &alpacaResp); err != nil {
		return nil, fmt.Errorf("decode order response: %w", err)
	}
	return &BrokerOrder{BrokerOrderID: alpacaResp.ID, Status: alpacaResp.Status}, nil
}

// CancelOrder cancels a broker order via DELETE /v2/orders/{order_id}.
func (c *Client) CancelOrder(ctx context.Context, brokerOrderID string) error {
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodDelete,
		fmt.Sprintf("%s/v2/orders/%s", c.baseURL(), brokerOrderID),
		nil,
	)
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	c.setAuthHeaders(httpReq)

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return fmt.Errorf("cancel order: %w", err)
	}
	defer resp.Body.Close() //nolint:errcheck

	// 204 No Content is success; 422 means already filled/canceled
	if resp.StatusCode != http.StatusNoContent && resp.StatusCode != http.StatusUnprocessableEntity {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("alpaca cancel error (status %d): %s", resp.StatusCode, string(body))
	}
	return nil
}

// GetOrder fetches a broker order's current state via GET /v2/orders/{order_id}.
func (c *Client) GetOrder(ctx context.Context, brokerOrderID string) (*BrokerOrder, error) {
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet,
		fmt.Sprintf("%s/v2/orders/%s", c.baseURL(), brokerOrderID),
		nil,
	)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	c.setAuthHeaders(httpReq)

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("get order: %w", err)
	}
	defer resp.Body.Close() //nolint:errcheck

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("alpaca get order error (status %d): %s", resp.StatusCode, string(respBody))
	}

	var alpacaResp AlpacaOrder
	if err := json.Unmarshal(respBody, &alpacaResp); err != nil {
		return nil, fmt.Errorf("decode order response: %w", err)
	}
	var filledAvgPrice float64
	if alpacaResp.FilledAvgPrice != "" {
		filledAvgPrice, _ = strconv.ParseFloat(alpacaResp.FilledAvgPrice, 64)
	}
	return &BrokerOrder{BrokerOrderID: alpacaResp.ID, Status: alpacaResp.Status, FilledAvgPrice: filledAvgPrice}, nil
}

// GetPositions fetches all open positions via GET /v2/positions.
func (c *Client) GetPositions(ctx context.Context) ([]BrokerPosition, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL()+"/v2/positions", nil)
	if err != nil {
		return nil, fmt.Errorf("alpaca GetPositions: build request: %w", err)
	}
	c.setAuthHeaders(req)
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("alpaca GetPositions: http: %w", err)
	}
	defer resp.Body.Close() //nolint:errcheck
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("alpaca GetPositions: status %d: %s", resp.StatusCode, body)
	}
	var raw []struct {
		Symbol  string `json:"symbol"`
		Qty     string `json:"qty"`
		AvgCost string `json:"avg_entry_price"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, fmt.Errorf("alpaca GetPositions: unmarshal: %w", err)
	}
	positions := make([]BrokerPosition, 0, len(raw))
	for _, r := range raw {
		qty, _ := strconv.ParseFloat(r.Qty, 64)
		avg, _ := strconv.ParseFloat(r.AvgCost, 64)
		positions = append(positions, BrokerPosition{Symbol: r.Symbol, Quantity: qty, AvgCost: avg})
	}
	return positions, nil
}

// ValidateCredentials confirms the API key/secret still authenticate by calling
// GET /v2/account. A 401/403 maps to ErrInvalidCredentials; other non-200
// responses and transport errors are returned as transient (wrapped) errors.
func (c *Client) ValidateCredentials(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL()+"/v2/account", nil)
	if err != nil {
		return fmt.Errorf("alpaca ValidateCredentials: build request: %w", err)
	}
	c.setAuthHeaders(req)
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("alpaca ValidateCredentials: http: %w", err)
	}
	defer resp.Body.Close() //nolint:errcheck
	switch {
	case resp.StatusCode == http.StatusOK:
		return nil
	case resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden:
		return ErrInvalidCredentials
	default:
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("alpaca ValidateCredentials: status %d: %s", resp.StatusCode, body)
	}
}

func (c *Client) setAuthHeaders(req *http.Request) {
	req.Header.Set("APCA-API-KEY-ID", c.cfg.APIKey)
	req.Header.Set("APCA-API-SECRET-KEY", c.cfg.APISecret)
}

var _ Broker = (*Client)(nil)
