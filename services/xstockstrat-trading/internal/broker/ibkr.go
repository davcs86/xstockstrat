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

// resolveConid looks up the IBKR contract ID for a stock symbol via
// GET /iserver/secdef/search?symbol=<sym>&types=STK. IBKR requires a conid
// on every order submission — it cannot be inferred from the ticker alone.
func (c *IBKRClient) resolveConid(ctx context.Context, symbol string) (int64, error) {
	endpoint := fmt.Sprintf("%s/iserver/secdef/search", c.baseURL)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return 0, fmt.Errorf("ibkr resolveConid: build request: %w", err)
	}
	q := httpReq.URL.Query()
	q.Set("symbol", symbol)
	q.Set("types", "STK")
	httpReq.URL.RawQuery = q.Encode()
	httpReq.Header.Set("Authorization", c.signRequest(http.MethodGet, endpoint))

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return 0, fmt.Errorf("ibkr resolveConid: http: %w", err)
	}
	defer resp.Body.Close() //nolint:errcheck

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("ibkr resolveConid: status %d: %s", resp.StatusCode, respBody)
	}

	var results []struct {
		Conid int64 `json:"conid"`
	}
	if err := json.Unmarshal(respBody, &results); err != nil || len(results) == 0 {
		return 0, fmt.Errorf("ibkr resolveConid: no contract found for symbol %q", symbol)
	}
	return results[0].Conid, nil
}

// SubmitOrder places an order via POST /v1/api/iserver/account/{accountID}/orders.
func (c *IBKRClient) SubmitOrder(ctx context.Context, req OrderRequest) (*BrokerOrder, error) {
	conid, err := c.resolveConid(ctx, req.Symbol)
	if err != nil {
		return nil, fmt.Errorf("ibkr SubmitOrder: %w", err)
	}

	body := map[string]interface{}{
		"conid":     conid,
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

// ReplaceOrder modifies a working order via POST /iserver/account/{accountID}/order/{orderId}.
// Only the changed fields are included in the modify body; a zero Qty/LimitPrice/StopPrice
// or empty TimeInForce is omitted so IBKR leaves that field unchanged.
//
// Netting-mode assumption: like the rest of this adapter, replace assumes the account
// runs in netting mode (see "IBKR: Hedged Mode not supported" in the service CLAUDE.md);
// a replaced quantity is interpreted as the new total order quantity.
func (c *IBKRClient) ReplaceOrder(ctx context.Context, brokerOrderID string, req OrderRequest) (*BrokerOrder, error) {
	body := map[string]interface{}{}
	if req.OrderType != "" {
		body["orderType"] = orderTypeToIBKR(req.OrderType)
	}
	if req.Qty != 0 {
		body["quantity"] = req.Qty
	}
	if req.LimitPrice != 0 {
		body["price"] = req.LimitPrice
	}
	if req.StopPrice != 0 {
		body["auxPrice"] = req.StopPrice
	}
	if req.TimeInForce != "" {
		body["tif"] = strings.ToUpper(req.TimeInForce)
	}

	payload, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("ibkr ReplaceOrder: marshal: %w", err)
	}

	endpoint := fmt.Sprintf("%s/iserver/account/%s/order/%s", c.baseURL, c.ibkrAccountID, brokerOrderID)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return nil, fmt.Errorf("ibkr ReplaceOrder: build request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", c.signRequest(http.MethodPost, endpoint))

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("ibkr ReplaceOrder: http: %w", err)
	}
	defer resp.Body.Close() //nolint:errcheck

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return nil, fmt.Errorf("ibkr ReplaceOrder: status %d: %s", resp.StatusCode, respBody)
	}

	// IBKR returns an array of order replies (same shape as SubmitOrder).
	var replies []struct {
		OrderID     string `json:"order_id"`
		OrderStatus string `json:"order_status"`
	}
	if err := json.Unmarshal(respBody, &replies); err != nil || len(replies) == 0 {
		return nil, fmt.Errorf("ibkr ReplaceOrder: parse response: %w", err)
	}
	return &BrokerOrder{BrokerOrderID: replies[0].OrderID, Status: replies[0].OrderStatus}, nil
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
			OrderID   string  `json:"orderId"`
			Status    string  `json:"status"`
			AvgPrice  float64 `json:"avgPrice"`
			FilledQty float64 `json:"filledQuantity"`
		} `json:"orders"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil || len(result.Orders) == 0 {
		return nil, fmt.Errorf("ibkr GetOrder: parse response: %w", err)
	}
	o := result.Orders[0]
	return &BrokerOrder{BrokerOrderID: o.OrderID, Status: o.Status, FilledQty: o.FilledQty, FilledAvgPrice: o.AvgPrice}, nil
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

	// IBKR returns mark-to-market valuation as numeric JSON. unrealized P&L percentage is
	// not provided, so derive it from unrealizedPnl over cost basis (qty * avgCost) when the
	// cost basis is non-zero — matching how the broker-authoritative fields are consumed.
	var raw []struct {
		Ticker        string  `json:"ticker"`
		Position      float64 `json:"position"`
		AvgCost       float64 `json:"avgCost"`
		MktPrice      float64 `json:"mktPrice"`
		MktValue      float64 `json:"mktValue"`
		UnrealizedPnl float64 `json:"unrealizedPnl"`
	}
	if err := json.Unmarshal(respBody, &raw); err != nil {
		return nil, fmt.Errorf("ibkr GetPositions: parse response: %w", err)
	}

	positions := make([]BrokerPosition, 0, len(raw))
	for _, r := range raw {
		var pnlPct float64
		if costBasis := r.Position * r.AvgCost; costBasis != 0 {
			pnlPct = r.UnrealizedPnl / costBasis
		}
		positions = append(positions, BrokerPosition{
			Symbol:           r.Ticker,
			Quantity:         r.Position,
			AvgCost:          r.AvgCost,
			CurrentPrice:     r.MktPrice,
			MarketValue:      r.MktValue,
			UnrealizedPnl:    r.UnrealizedPnl,
			UnrealizedPnlPct: pnlPct,
		})
	}
	return positions, nil
}

// GetAccount fetches the account balance snapshot via
// GET /v1/api/portfolio/{accountID}/summary. IBKR returns a map of named
// figures, each an object with an `amount` field. Best-effort: figures absent
// from the response are left zero (and LastEquity falls back to Equity so day
// P&L is reported as zero rather than a spurious value).
func (c *IBKRClient) GetAccount(ctx context.Context) (*BrokerBalance, error) {
	endpoint := fmt.Sprintf("%s/portfolio/%s/summary", c.baseURL, c.ibkrAccountID)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("ibkr GetAccount: build request: %w", err)
	}
	httpReq.Header.Set("Authorization", c.signRequest(http.MethodGet, endpoint))

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("ibkr GetAccount: http: %w", err)
	}
	defer resp.Body.Close() //nolint:errcheck

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("ibkr GetAccount: status %d: %s", resp.StatusCode, respBody)
	}

	var raw map[string]struct {
		Amount float64 `json:"amount"`
	}
	if err := json.Unmarshal(respBody, &raw); err != nil {
		return nil, fmt.Errorf("ibkr GetAccount: parse response: %w", err)
	}
	bal := &BrokerBalance{
		Cash:        raw["totalcashvalue"].Amount,
		BuyingPower: raw["buyingpower"].Amount,
		Equity:      raw["netliquidation"].Amount,
		LastEquity:  raw["previousdayequitywithloanvalue"].Amount,
	}
	if bal.LastEquity == 0 {
		bal.LastEquity = bal.Equity
	}
	return bal, nil
}

// ValidateCredentials confirms the OAuth credentials still authenticate by
// calling GET /portfolio/accounts. A 401/403 maps to ErrInvalidCredentials;
// other non-200 responses and transport errors are returned as transient errors.
func (c *IBKRClient) ValidateCredentials(ctx context.Context) error {
	endpoint := fmt.Sprintf("%s/portfolio/accounts", c.baseURL)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return fmt.Errorf("ibkr ValidateCredentials: build request: %w", err)
	}
	httpReq.Header.Set("Authorization", c.signRequest(http.MethodGet, endpoint))

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return fmt.Errorf("ibkr ValidateCredentials: http: %w", err)
	}
	defer resp.Body.Close() //nolint:errcheck
	switch resp.StatusCode {
	case http.StatusOK:
		return nil
	case http.StatusUnauthorized, http.StatusForbidden:
		return ErrInvalidCredentials
	default:
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("ibkr ValidateCredentials: status %d: %s", resp.StatusCode, body)
	}
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
