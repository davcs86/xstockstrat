package broker_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/xstockstrat/trading/internal/broker"
	"github.com/xstockstrat/trading/internal/testdata"
)

// ibkrTestConfig is a vector-keyed client config whose fixed clock keeps the vector LST unexpired.
func ibkrTestConfig(baseURL, accountID string) broker.IBKRConfig {
	v := testdata.MustIBKRVectors()
	ts, _ := strconv.ParseInt(v.Inputs.Timestamp, 10, 64)
	return broker.IBKRConfig{
		BaseURL:           baseURL,
		IBKRAccountID:     accountID,
		ConsumerKey:       v.Inputs.ConsumerKey,
		AccessToken:       v.Inputs.AccessToken,
		AccessTokenSecret: v.Inputs.AccessTokenSecret,
		SignatureKey:      testdata.IBKRSignatureKeyPEM,
		EncryptionKey:     testdata.IBKREncryptionKeyPEM,
		DHPrime:           testdata.IBKRDHParamPEM,
		Now:               func() time.Time { return time.Unix(ts, 0) },
		DHRandom: func() *big.Int {
			a, _ := new(big.Int).SetString(v.Inputs.DHRandomHex, 16)
			return a
		},
	}
}

// hostRewrite sends every request to the test server, so a client keeps signing the vector URLs.
type hostRewrite struct {
	host string
	next http.RoundTripper
}

func (rt hostRewrite) RoundTrip(req *http.Request) (*http.Response, error) {
	out := req.Clone(req.Context())
	out.URL.Scheme = "http"
	out.URL.Host = rt.host
	return rt.next.RoundTrip(out)
}

// strictIBKRClient signs over the vector base URL with the vector nonce; the client's default transport
// is pointed at a strict handler for the test's duration (no broker test runs in parallel).
func strictIBKRClient(t *testing.T, next http.Handler, accountID string) (*broker.IBKRClient, *testdata.IBKRAuthHandler) {
	t.Helper()
	v := testdata.MustIBKRVectors()
	h := &testdata.IBKRAuthHandler{Strict: true, Next: next}
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	u, _ := url.Parse(srv.URL)
	orig := http.DefaultTransport
	http.DefaultTransport = hostRewrite{host: u.Host, next: orig}
	t.Cleanup(func() { http.DefaultTransport = orig })
	cfg := ibkrTestConfig(v.Inputs.BaseURL, accountID)
	cfg.Nonce = func() string { return v.LSTRequest.Nonce }
	return broker.NewIBKRClient(cfg), h
}

// lenientIBKRClient serves the handshake from the vectors and every other path from next.
func lenientIBKRClient(t *testing.T, next http.Handler, mod func(*broker.IBKRConfig)) (*broker.IBKRClient, *testdata.IBKRAuthHandler) {
	t.Helper()
	h := &testdata.IBKRAuthHandler{Next: next}
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	cfg := ibkrTestConfig(srv.URL, "U123")
	var n int64
	cfg.Nonce = func() string { return fmt.Sprintf("nonce%011d", atomic.AddInt64(&n, 1)) }
	if mod != nil {
		mod(&cfg)
	}
	return broker.NewIBKRClient(cfg), h
}

func requestVector(t *testing.T, name string) testdata.IBKRRequestVector {
	t.Helper()
	v := testdata.MustIBKRVectors()
	for _, rv := range v.Requests {
		if rv.Name == name && rv.Nonce == v.LSTRequest.Nonce {
			return rv
		}
	}
	t.Fatalf("no vector %q", name)
	return testdata.IBKRRequestVector{}
}

func recordedAuth(t *testing.T, h *testdata.IBKRAuthHandler, method, pathQuery string) string {
	t.Helper()
	for _, r := range h.Requests() {
		if r.Method == method && r.PathQuery == pathQuery {
			return r.Authorization
		}
	}
	t.Fatalf("no %s %s recorded in %+v", method, pathQuery, h.Requests())
	return ""
}

func writeJSON(w http.ResponseWriter, status int, body string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = io.WriteString(w, body)
}

const (
	ibkrConidReply = `[{"conid":265598}]`
	ibkrOrderReply = `[{"order_id":"o-1","order_status":"PreSubmitted"}]`
	ibkrOrdersJSON = `{"orders":[{"orderId":"42","status":"Submitted"}]}`
)

// @AC-1
func TestIBKRGetOrder_SignsQueryOnTheWire(t *testing.T) {
	c, h := strictIBKRClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, ibkrOrdersJSON)
	}), "U123")

	if _, err := c.GetOrder(context.Background(), "42"); err != nil {
		t.Fatalf("GetOrder: %v", err)
	}
	rv := requestVector(t, "get_order")
	if got := recordedAuth(t, h, http.MethodGet, "/v1/api/iserver/account/orders?orderId=42"); got != rv.Authorization {
		t.Fatalf("GetOrder header\n got: %s\nwant: %s", got, rv.Authorization)
	}
}

// @AC-2
func TestIBKR_EveryMethodLSTSignedWithRealm(t *testing.T) {
	c, h := strictIBKRClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/api/iserver/secdef/search":
			writeJSON(w, http.StatusOK, ibkrConidReply)
		case "/v1/api/iserver/account/U123/orders":
			writeJSON(w, http.StatusOK, ibkrOrderReply)
		default:
			writeJSON(w, http.StatusOK, `{}`)
		}
	}), "U123")
	ctx := context.Background()
	if _, err := c.SubmitOrder(ctx, broker.OrderRequest{Symbol: "AAPL", Side: "buy", OrderType: "market", Qty: 1, TimeInForce: "day"}); err != nil {
		t.Fatalf("SubmitOrder: %v", err)
	}
	if err := c.CancelOrder(ctx, "42"); err != nil {
		t.Fatalf("CancelOrder: %v", err)
	}
	for _, row := range []struct{ vector, method, pathQuery string }{
		{"secdef_search_aapl", http.MethodGet, "/v1/api/iserver/secdef/search?symbol=AAPL&types=STK"},
		{"place_order", http.MethodPost, "/v1/api/iserver/account/U123/orders"},
		{"cancel_order", http.MethodDelete, "/v1/api/iserver/account/U123/order/42"},
	} {
		t.Run(row.vector, func(t *testing.T) {
			rv := requestVector(t, row.vector)
			got := recordedAuth(t, h, row.method, row.pathQuery)
			if !strings.HasPrefix(got, `OAuth realm="limited_poa", `) {
				t.Fatalf("header lacks realm: %s", got)
			}
			if got != rv.Authorization {
				t.Fatalf("header\n got: %s\nwant: %s", got, rv.Authorization)
			}
			sig, _ := url.QueryUnescape(testdata.IBKRHeaderParam(got, "oauth_signature"))
			if sig == rv.LegacySignatureB64 {
				t.Fatal(`signature equals the legacy "&"+secret vector`)
			}
		})
	}
}

// counter tallies requests per key under a lock (handlers run on server goroutines).
type counter struct {
	mu sync.Mutex
	n  map[string]int
}

func (c *counter) inc(key string) int {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.n == nil {
		c.n = map[string]int{}
	}
	c.n[key]++
	return c.n[key]
}

func (c *counter) get(key string) int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.n[key]
}

// @AC-6
func TestIBKRDo_401RetryMatrix(t *testing.T) {
	ctx := context.Background()
	order := broker.OrderRequest{Symbol: "AAPL", Side: "buy", OrderType: "market", Qty: 1, TimeInForce: "day", ClientOrderID: "xss-coid-1"}

	t.Run("get_401_rehandshake_resend_new_nonce", func(t *testing.T) {
		var cnt counter
		var mu sync.Mutex
		var nonces []string
		c, h := lenientIBKRClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			mu.Lock()
			nonces = append(nonces, testdata.IBKRHeaderParam(r.Header.Get("Authorization"), "oauth_nonce"))
			mu.Unlock()
			if cnt.inc("get") == 2 {
				writeJSON(w, http.StatusUnauthorized, `{}`)
				return
			}
			writeJSON(w, http.StatusOK, ibkrOrdersJSON)
		}), nil)
		if _, err := c.GetOrder(ctx, "42"); err != nil {
			t.Fatalf("warm GetOrder: %v", err)
		}
		if _, err := c.GetOrder(ctx, "42"); err != nil {
			t.Fatalf("GetOrder after 401: %v", err)
		}
		if n := h.Count(http.MethodPost, testdata.IBKRLSTPath); n != 2 {
			t.Fatalf("LST requests = %d, want 2 (one re-handshake)", n)
		}
		if len(nonces) != 3 || nonces[1] == nonces[2] {
			t.Fatalf("nonces = %v, want 3 sends with the resend under a new nonce", nonces)
		}
	})

	t.Run("post_401_resend_same_body", func(t *testing.T) {
		var cnt counter
		var mu sync.Mutex
		var bodies []string
		c, _ := lenientIBKRClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch r.URL.Path {
			case "/portfolio/accounts":
				writeJSON(w, http.StatusOK, `[]`)
			case "/iserver/secdef/search":
				writeJSON(w, http.StatusOK, ibkrConidReply)
			case "/iserver/account/U123/orders":
				b, _ := io.ReadAll(r.Body)
				mu.Lock()
				bodies = append(bodies, string(b))
				mu.Unlock()
				if cnt.inc("post") == 1 {
					writeJSON(w, http.StatusUnauthorized, `{}`)
					return
				}
				writeJSON(w, http.StatusOK, ibkrOrderReply)
			}
		}), nil)
		if err := c.ValidateCredentials(ctx); err != nil {
			t.Fatalf("warm: %v", err)
		}
		if _, err := c.SubmitOrder(ctx, order); err != nil {
			t.Fatalf("SubmitOrder: %v", err)
		}
		if len(bodies) != 2 || bodies[0] != bodies[1] {
			t.Fatalf("bodies = %q, want the resend byte-equal to the first send", bodies)
		}
		var payload struct {
			Orders []map[string]any `json:"orders"`
		}
		_ = json.Unmarshal([]byte(bodies[1]), &payload)
		if len(payload.Orders) != 1 || payload.Orders[0]["cOID"] != "xss-coid-1" {
			t.Fatalf("resent payload = %s, want cOID unchanged", bodies[1])
		}
	})

	t.Run("delete_401_resend", func(t *testing.T) {
		var cnt counter
		c, _ := lenientIBKRClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/portfolio/accounts" {
				writeJSON(w, http.StatusOK, `[]`)
				return
			}
			if cnt.inc("delete") == 1 {
				writeJSON(w, http.StatusUnauthorized, `{}`)
				return
			}
			writeJSON(w, http.StatusOK, `{}`)
		}), nil)
		if err := c.ValidateCredentials(ctx); err != nil {
			t.Fatalf("warm: %v", err)
		}
		if err := c.CancelOrder(ctx, "42"); err != nil {
			t.Fatalf("CancelOrder: %v", err)
		}
		if n := cnt.get("delete"); n != 2 {
			t.Fatalf("DELETE sends = %d, want 2", n)
		}
	})

	t.Run("validate_401_on_minted_session_final", func(t *testing.T) {
		var cnt counter
		c, h := lenientIBKRClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			cnt.inc(r.URL.Path)
			writeJSON(w, http.StatusUnauthorized, `{}`)
		}), nil)
		err := c.ValidateCredentials(ctx)
		if !errors.Is(err, broker.ErrInvalidCredentials) {
			t.Fatalf("err = %v, want ErrInvalidCredentials", err)
		}
		if n := cnt.get("/portfolio/accounts"); n != 1 {
			t.Fatalf("requests = %d, want exactly one", n)
		}
		if n := h.Count(http.MethodPost, testdata.IBKRLSTPath); n != 1 {
			t.Fatalf("LST requests = %d, want 1", n)
		}
	})

	t.Run("post_401_then_duplicate_coid_uncertain", func(t *testing.T) {
		var cnt counter
		c, _ := lenientIBKRClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch r.URL.Path {
			case "/portfolio/accounts":
				writeJSON(w, http.StatusOK, `[]`)
			case "/iserver/secdef/search":
				writeJSON(w, http.StatusOK, ibkrConidReply)
			default:
				if cnt.inc("post") == 1 {
					writeJSON(w, http.StatusUnauthorized, `{}`)
					return
				}
				writeJSON(w, http.StatusBadRequest, `{"error":"Local order ID=xss-coid-1 is already registered."}`)
			}
		}), nil)
		if err := c.ValidateCredentials(ctx); err != nil {
			t.Fatalf("warm: %v", err)
		}
		_, err := c.SubmitOrder(ctx, order)
		if !errors.Is(err, broker.ErrOutcomeUncertain) {
			t.Fatalf("err = %v, want ErrOutcomeUncertain", err)
		}
	})

	t.Run("bracket_legs_401_no_resend", func(t *testing.T) {
		var cnt counter
		c, _ := lenientIBKRClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch r.URL.Path {
			case "/portfolio/accounts":
				writeJSON(w, http.StatusOK, `[]`)
			case "/iserver/secdef/search":
				writeJSON(w, http.StatusOK, ibkrConidReply)
			default:
				cnt.inc("post")
				writeJSON(w, http.StatusUnauthorized, `{}`)
			}
		}), nil)
		if err := c.ValidateCredentials(ctx); err != nil {
			t.Fatalf("warm: %v", err)
		}
		_, err := c.SubmitBracketLegs(ctx, "p-1", "p-coid", broker.BracketLegsRequest{Symbol: "AAPL", Side: "sell", Qty: 1, StopPrice: 90, TimeInForce: "gtc"})
		if !errors.Is(err, broker.ErrInvalidCredentials) {
			t.Fatalf("err = %v, want ErrInvalidCredentials", err)
		}
		if n := cnt.get("post"); n != 1 {
			t.Fatalf("bracket POSTs = %d, want 1 (no resend)", n)
		}
	})

	t.Run("get_400_no_bridge_reinit_resend", func(t *testing.T) {
		var cnt counter
		c, h := lenientIBKRClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if cnt.inc("get") == 1 {
				writeJSON(w, http.StatusBadRequest, `{"error":"Bad Request: no bridge"}`)
				return
			}
			writeJSON(w, http.StatusOK, ibkrOrdersJSON)
		}), nil)
		if _, err := c.GetOrder(ctx, "42"); err != nil {
			t.Fatalf("GetOrder: %v", err)
		}
		if n := h.Count(http.MethodPost, testdata.IBKRInitPath); n != 2 {
			t.Fatalf("ssodh/init requests = %d, want 2 (one re-init)", n)
		}
		if n := h.Count(http.MethodPost, testdata.IBKRLSTPath); n != 1 {
			t.Fatalf("LST requests = %d, want 1 (no re-handshake)", n)
		}
		if n := cnt.get("get"); n != 2 {
			t.Fatalf("GET sends = %d, want 2", n)
		}
	})

	t.Run("generation_guard_resends_without_handshake", func(t *testing.T) {
		var cnt counter
		var c *broker.IBKRClient
		c, h := lenientIBKRClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Query().Get("accountId") != "" {
				// A concurrent caller's 401 rotates the session to a new generation.
				if cnt.inc("list") == 1 {
					writeJSON(w, http.StatusUnauthorized, `{}`)
					return
				}
				writeJSON(w, http.StatusOK, ibkrOrdersJSON)
				return
			}
			switch cnt.inc("get") {
			case 2:
				if _, err := c.ListOrders(r.Context()); err != nil {
					t.Errorf("nested ListOrders: %v", err)
				}
				writeJSON(w, http.StatusUnauthorized, `{}`)
			default:
				writeJSON(w, http.StatusOK, ibkrOrdersJSON)
			}
		}), nil)
		if _, err := c.GetOrder(ctx, "42"); err != nil {
			t.Fatalf("warm GetOrder: %v", err)
		}
		if _, err := c.GetOrder(ctx, "42"); err != nil {
			t.Fatalf("GetOrder on a stale generation: %v", err)
		}
		if n := h.Count(http.MethodPost, testdata.IBKRLSTPath); n != 2 {
			t.Fatalf("LST requests = %d, want 2 (only the concurrent caller re-handshook)", n)
		}
		if n := cnt.get("get"); n != 3 {
			t.Fatalf("GET sends = %d, want 3", n)
		}
	})

	t.Run("reauth_min_interval_throttles_invalidation", func(t *testing.T) {
		var cnt counter
		c, h := lenientIBKRClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch cnt.inc("get") {
			case 2, 4:
				writeJSON(w, http.StatusUnauthorized, `{}`)
			default:
				writeJSON(w, http.StatusOK, ibkrOrdersJSON)
			}
		}), nil)
		if _, err := c.GetOrder(ctx, "42"); err != nil {
			t.Fatalf("warm GetOrder: %v", err)
		}
		if _, err := c.GetOrder(ctx, "42"); err != nil {
			t.Fatalf("first 401: %v", err)
		}
		if _, err := c.GetOrder(ctx, "42"); !errors.Is(err, broker.ErrInvalidCredentials) {
			t.Fatalf("second 401 within reauth_min_interval: err = %v, want ErrInvalidCredentials", err)
		}
		if n := h.Count(http.MethodPost, testdata.IBKRLSTPath); n != 2 {
			t.Fatalf("LST requests = %d, want 2 (second invalidation throttled)", n)
		}
	})
}

// @AC-8
func TestIBKRSubmitOrder_SessionFailureNoPOST(t *testing.T) {
	for _, tc := range []struct {
		name  string
		setup func(t *testing.T, h *testdata.IBKRAuthHandler)
	}{
		{"lst_503", func(_ *testing.T, h *testdata.IBKRAuthHandler) {
			h.SetOverride(testdata.IBKRLSTPath, testdata.IBKRAuthOverride{Status: http.StatusServiceUnavailable})
		}},
		{"lst_blocked_past_handshake_timeout", func(t *testing.T, h *testdata.IBKRAuthHandler) {
			block := make(chan struct{})
			t.Cleanup(func() { close(block) })
			h.SetOverride(testdata.IBKRLSTPath, testdata.IBKRAuthOverride{Block: block})
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c, h := lenientIBKRClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				writeJSON(w, http.StatusOK, ibkrConidReply)
			}), func(cfg *broker.IBKRConfig) {
				cfg.Timing = func() broker.IBKRTiming {
					return broker.IBKRTiming{LSTRefreshMargin: time.Minute, HandshakeTimeout: 50 * time.Millisecond, ReauthMinInterval: 30 * time.Second}
				}
			})
			tc.setup(t, h)
			_, err := c.SubmitOrder(context.Background(), broker.OrderRequest{Symbol: "AAPL", Side: "buy", OrderType: "market", Qty: 1, TimeInForce: "day", ClientOrderID: "xss-coid-2"})
			if err == nil {
				t.Fatal("SubmitOrder succeeded without a session")
			}
			if n := h.Count(http.MethodPost, "/iserver/account/U123/orders"); n != 0 {
				t.Fatalf("order POSTs = %d, want none", n)
			}
			var netErr net.Error
			if errors.Is(err, context.DeadlineExceeded) || (errors.As(err, &netErr) && netErr.Timeout()) {
				t.Fatalf("err = %v reads as a timeout; a pre-send session failure is a definite outcome", err)
			}
			if errors.Is(err, broker.ErrOutcomeUncertain) {
				t.Fatalf("err = %v, want a definite (not uncertain) outcome", err)
			}
		})
	}
}
