package broker

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

// IBKRConfig holds IBKR Web API credentials and routing config.
type IBKRConfig struct {
	BaseURL           string // default: https://api.ibkr.com/v1/api
	ConsumerKey       string
	AccessToken       string
	AccessTokenSecret string
	IBKRAccountID     string // e.g. "U1234567"
	IsPaper           bool
}

// IBKRClient submits and manages orders via IBKR Web API (OAuth 1.0a HMAC-SHA256).
type IBKRClient struct {
	baseURL           string
	consumerKey       string
	accessToken       string
	accessTokenSecret string
	ibkrAccountID     string
	isPaper           bool
	httpClient        *http.Client
}

func NewIBKRClient(cfg IBKRConfig) *IBKRClient {
	base := cfg.BaseURL
	if base == "" {
		base = "https://api.ibkr.com/v1/api"
	}
	base = strings.TrimRight(base, "/")
	return &IBKRClient{
		baseURL:           base,
		consumerKey:       cfg.ConsumerKey,
		accessToken:       cfg.AccessToken,
		accessTokenSecret: cfg.AccessTokenSecret,
		ibkrAccountID:     cfg.IBKRAccountID,
		isPaper:           cfg.IsPaper,
		httpClient:        &http.Client{Timeout: 10 * time.Second},
	}
}

// IsPaper reports whether this client is configured for paper trading.
func (c *IBKRClient) IsPaper() bool {
	return c.isPaper
}

// orderTypeToIBKR maps normalized order types to IBKR order type codes.
func orderTypeToIBKR(t string) string {
	switch strings.ToLower(t) {
	case "limit":
		return "LMT"
	case "stop":
		return "STP"
	case "stop_limit":
		return "STP LMT"
	case "trailing_stop":
		return "TRAIL"
	default:
		return "MKT"
	}
}

// SubmitOrder places an order via POST /v1/api/iserver/account/{accountID}/orders.
func (c *IBKRClient) SubmitOrder(ctx context.Context, req OrderRequest) (*BrokerOrder, error) {
	body := map[string]interface{}{
		"conid":     0, // conid must be resolved by caller; placeholder for now
		"orderType": orderTypeToIBKR(req.OrderType),
		"side":      strings.ToUpper(req.Side),
		"quantity":  req.Qty,
		"tif":       strings.ToUpper(req.TimeInForce),
		"ticker":    req.Symbol,
	}
	if req.LimitPrice != 0 {
		body["price"] = req.LimitPrice
	}
	if req.StopPrice != 0 {
		body["auxPrice"] = req.StopPrice
	}

	payload, err := json.Marshal(map[string]interface{}{"orders": []interface{}{body}})
	if err != nil {
		return nil, fmt.Errorf("ibkr SubmitOrder: marshal: %w", err)
	}

	endpoint := fmt.Sprintf("%s/iserver/account/%s/orders", c.baseURL, c.ibkrAccountID)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return nil, fmt.Errorf("ibkr SubmitOrder: build request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", c.signRequest(http.MethodPost, endpoint))

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("ibkr SubmitOrder: http: %w", err)
	}
	defer resp.Body.Close() //nolint:errcheck

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return nil, fmt.Errorf("ibkr SubmitOrder: status %d: %s", resp.StatusCode, respBody)
	}

	// IBKR returns an array of order replies.
	var replies []struct {
		OrderID     string `json:"order_id"`
		OrderStatus string `json:"order_status"`
	}
	if err := json.Unmarshal(respBody, &replies); err != nil || len(replies) == 0 {
		return nil, fmt.Errorf("ibkr SubmitOrder: parse response: %w", err)
	}
	return &BrokerOrder{BrokerOrderID: replies[0].OrderID, Status: replies[0].OrderStatus}, nil
}

// CancelOrder cancels an order via DELETE /v1/api/iserver/account/{accountID}/order/{orderId}.
func (c *IBKRClient) CancelOrder(ctx context.Context, brokerOrderID string) error {
	endpoint := fmt.Sprintf("%s/iserver/account/%s/order/%s", c.baseURL, c.ibkrAccountID, brokerOrderID)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodDelete, endpoint, nil)
	if err != nil {
		return fmt.Errorf("ibkr CancelOrder: build request: %w", err)
	}
	httpReq.Header.Set("Authorization", c.signRequest(http.MethodDelete, endpoint))

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return fmt.Errorf("ibkr CancelOrder: http: %w", err)
	}
	defer resp.Body.Close() //nolint:errcheck

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("ibkr CancelOrder: status %d: %s", resp.StatusCode, body)
	}
	return nil
}

// GetOrder fetches an order's current state via GET /v1/api/iserver/account/orders?orderId={id}.
func (c *IBKRClient) GetOrder(ctx context.Context, brokerOrderID string) (*BrokerOrder, error) {
	endpoint := fmt.Sprintf("%s/iserver/account/orders", c.baseURL)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("ibkr GetOrder: build request: %w", err)
	}
	q := httpReq.URL.Query()
	q.Set("orderId", brokerOrderID)
	httpReq.URL.RawQuery = q.Encode()
	httpReq.Header.Set("Authorization", c.signRequest(http.MethodGet, endpoint))

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("ibkr GetOrder: http: %w", err)
	}
	defer resp.Body.Close() //nolint:errcheck

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("ibkr GetOrder: status %d: %s", resp.StatusCode, respBody)
	}

	var result struct {
		Orders []struct {
			OrderID string `json:"orderId"`
			Status  string `json:"status"`
		} `json:"orders"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil || len(result.Orders) == 0 {
		return nil, fmt.Errorf("ibkr GetOrder: parse response: %w", err)
	}
	o := result.Orders[0]
	return &BrokerOrder{BrokerOrderID: o.OrderID, Status: o.Status}, nil
}

// GetPositions fetches all open positions via GET /v1/api/portfolio/{accountID}/positions/0.
func (c *IBKRClient) GetPositions(ctx context.Context) ([]BrokerPosition, error) {
	endpoint := fmt.Sprintf("%s/portfolio/%s/positions/0", c.baseURL, c.ibkrAccountID)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("ibkr GetPositions: build request: %w", err)
	}
	httpReq.Header.Set("Authorization", c.signRequest(http.MethodGet, endpoint))

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("ibkr GetPositions: http: %w", err)
	}
	defer resp.Body.Close() //nolint:errcheck

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("ibkr GetPositions: status %d: %s", resp.StatusCode, respBody)
	}

	var raw []struct {
		Ticker   string  `json:"ticker"`
		Position float64 `json:"position"`
		AvgCost  float64 `json:"avgCost"`
	}
	if err := json.Unmarshal(respBody, &raw); err != nil {
		return nil, fmt.Errorf("ibkr GetPositions: parse response: %w", err)
	}

	positions := make([]BrokerPosition, 0, len(raw))
	for _, r := range raw {
		positions = append(positions, BrokerPosition{
			Symbol:   r.Ticker,
			Quantity: r.Position,
			AvgCost:  r.AvgCost,
		})
	}
	return positions, nil
}

// signRequest generates an OAuth 1.0a Authorization header using HMAC-SHA256.
func (c *IBKRClient) signRequest(method, rawURL string) string {
	nonce := make([]byte, 16)
	rand.Read(nonce) //nolint:errcheck
	nonceStr := base64.StdEncoding.EncodeToString(nonce)
	timestamp := strconv.FormatInt(time.Now().Unix(), 10)

	oauthParams := map[string]string{
		"oauth_consumer_key":     c.consumerKey,
		"oauth_nonce":            nonceStr,
		"oauth_signature_method": "HMAC-SHA256",
		"oauth_timestamp":        timestamp,
		"oauth_token":            c.accessToken,
		"oauth_version":          "1.0",
	}

	// Build sorted parameter string for the signature base.
	keys := make([]string, 0, len(oauthParams))
	for k := range oauthParams {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		parts = append(parts, url.QueryEscape(k)+"="+url.QueryEscape(oauthParams[k]))
	}
	paramString := strings.Join(parts, "&")

	// Signature base string: METHOD&encoded_url&encoded_params
	baseString := strings.ToUpper(method) + "&" +
		url.QueryEscape(rawURL) + "&" +
		url.QueryEscape(paramString)

	// Signing key: consumer_secret&token_secret (consumer secret is empty for IBKR OAuth 1.0a)
	signingKey := "&" + url.QueryEscape(c.accessTokenSecret)

	mac := hmac.New(sha256.New, []byte(signingKey))
	mac.Write([]byte(baseString)) //nolint:errcheck
	sig := base64.StdEncoding.EncodeToString(mac.Sum(nil))

	oauthParams["oauth_signature"] = sig

	// Build Authorization header value.
	headerParts := make([]string, 0, len(oauthParams))
	for k, v := range oauthParams {
		headerParts = append(headerParts, url.QueryEscape(k)+`="`+url.QueryEscape(v)+`"`)
	}
	return "OAuth " + strings.Join(headerParts, ", ")
}

var _ Broker = (*IBKRClient)(nil)
