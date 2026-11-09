package broker

import (
	"context"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/xstockstrat/trading/internal/testdata"
)

type testClock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *testClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *testClock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.t = c.t.Add(d)
}

// rewriteTransport sends every request to the test server, so the client signs the vector URLs unchanged.
type rewriteTransport struct{ host string }

func (rt rewriteTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	out := req.Clone(req.Context())
	out.URL.Scheme = "http"
	out.URL.Host = rt.host
	return http.DefaultTransport.RoundTrip(out)
}

var testTiming = IBKRTiming{LSTRefreshMargin: time.Minute, HandshakeTimeout: 2 * time.Second, ReauthMinInterval: 30 * time.Second}

// sessionClient builds a vector-configured client whose HTTP traffic reaches h; mod may adjust the config.
func sessionClient(t *testing.T, h *testdata.IBKRAuthHandler, mod func(*IBKRConfig)) (*IBKRClient, *testClock) {
	t.Helper()
	v := testdata.MustIBKRVectors()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	ts, err := strconv.ParseInt(v.Inputs.Timestamp, 10, 64)
	if err != nil {
		t.Fatalf("parse vector timestamp: %v", err)
	}
	clock := &testClock{t: time.Unix(ts, 0)}
	cfg := IBKRConfig{
		BaseURL:           v.Inputs.BaseURL,
		ConsumerKey:       v.Inputs.ConsumerKey,
		AccessToken:       v.Inputs.AccessToken,
		AccessTokenSecret: v.Inputs.AccessTokenSecret,
		SignatureKey:      testdata.IBKRSignatureKeyPEM,
		EncryptionKey:     testdata.IBKREncryptionKeyPEM,
		DHPrime:           testdata.IBKRDHParamPEM,
		Now:               clock.Now,
		Nonce:             func() string { return v.LSTRequest.Nonce },
		DHRandom: func() *big.Int {
			a, _ := new(big.Int).SetString(v.Inputs.DHRandomHex, 16)
			return a
		},
		Timing: func() IBKRTiming { return testTiming },
	}
	if mod != nil {
		mod(&cfg)
	}
	c := NewIBKRClient(cfg)
	u, _ := url.Parse(srv.URL)
	c.httpClient = &http.Client{Transport: rewriteTransport{host: u.Host}}
	return c, clock
}

// @AC-3
func TestEnsureSession_HandshakeOrderAndLST(t *testing.T) {
	v := testdata.MustIBKRVectors()
	h := &testdata.IBKRAuthHandler{Strict: true}
	c, _ := sessionClient(t, h, nil)

	sess, minted, err := c.ensureSession(context.Background())
	if err != nil {
		t.Fatalf("ensureSession: %v", err)
	}
	if !minted {
		t.Fatal("first handshake must report mintedByMe")
	}
	reqs := h.Requests()
	if len(reqs) != 2 || !strings.HasSuffix(reqs[0].PathQuery, testdata.IBKRLSTPath) || !strings.HasSuffix(reqs[1].PathQuery, testdata.IBKRInitPath) {
		t.Fatalf("handshake order = %+v, want LST POST then ssodh/init", reqs)
	}
	if reqs[0].Authorization != v.LSTRequest.Authorization {
		t.Fatalf("LST header\n got: %s\nwant: %s", reqs[0].Authorization, v.LSTRequest.Authorization)
	}
	if got := base64.StdEncoding.EncodeToString(sess.lst); got != v.LSTReply.LiveSessionToken {
		t.Fatalf("LST = %s, want %s", got, v.LSTReply.LiveSessionToken)
	}
	if !sess.exp.Equal(time.UnixMilli(v.LSTReply.LiveSessionTokenExpiration)) {
		t.Fatalf("exp = %v", sess.exp)
	}

	again, minted, err := c.ensureSession(context.Background())
	if err != nil || minted || again.gen != sess.gen {
		t.Fatalf("cached call: gen %d minted %v err %v", again.gen, minted, err)
	}
	if n := len(h.Requests()); n != 2 {
		t.Fatalf("cached call made HTTP requests: %d total", n)
	}
}

// @AC-4
func TestEnsureSession_FailureClassification(t *testing.T) {
	v := testdata.MustIBKRVectors()
	cases := []struct {
		name        string
		setup       func(t *testing.T, h *testdata.IBKRAuthHandler)
		mod         func(*IBKRConfig)
		wantInvalid bool
	}{
		{name: "lst_401", wantInvalid: true, setup: func(_ *testing.T, h *testdata.IBKRAuthHandler) {
			h.SetOverride(testdata.IBKRLSTPath, testdata.IBKRAuthOverride{Status: http.StatusUnauthorized})
		}},
		{name: "lst_403", wantInvalid: true, setup: func(_ *testing.T, h *testdata.IBKRAuthHandler) {
			h.SetOverride(testdata.IBKRLSTPath, testdata.IBKRAuthOverride{Status: http.StatusForbidden})
		}},
		{name: "lst_503", setup: func(_ *testing.T, h *testdata.IBKRAuthHandler) {
			h.SetOverride(testdata.IBKRLSTPath, testdata.IBKRAuthOverride{Status: http.StatusServiceUnavailable})
		}},
		{name: "lst_timeout", setup: func(t *testing.T, h *testdata.IBKRAuthHandler) {
			block := make(chan struct{})
			t.Cleanup(func() { close(block) })
			h.SetOverride(testdata.IBKRLSTPath, testdata.IBKRAuthOverride{Block: block})
		}, mod: func(cfg *IBKRConfig) {
			cfg.Timing = func() IBKRTiming {
				tm := testTiming
				tm.HandshakeTimeout = 50 * time.Millisecond
				return tm
			}
		}},
		{name: "undecryptable_secret", wantInvalid: true, mod: func(cfg *IBKRConfig) {
			cfg.AccessTokenSecret = v.Decrypt.WrongKeyCiphertextB64
		}},
		{name: "lst_signature_mismatch", wantInvalid: true, setup: func(_ *testing.T, h *testdata.IBKRAuthHandler) {
			h.SetOverride(testdata.IBKRLSTPath, testdata.IBKRAuthOverride{Body: testdata.IBKRLSTReplyJSON(v.LSTReply.BadLiveSessionTokenSignature)})
		}},
		{name: "init_not_authenticated", wantInvalid: true, setup: func(_ *testing.T, h *testdata.IBKRAuthHandler) {
			h.SetOverride(testdata.IBKRInitPath, testdata.IBKRAuthOverride{Body: testdata.IBKRInitReplyJSON(false, false)})
		}},
		{name: "init_competing", wantInvalid: true, setup: func(_ *testing.T, h *testdata.IBKRAuthHandler) {
			h.SetOverride(testdata.IBKRInitPath, testdata.IBKRAuthOverride{Body: testdata.IBKRInitReplyJSON(false, true)})
		}},
		{name: "init_503", setup: func(_ *testing.T, h *testdata.IBKRAuthHandler) {
			h.SetOverride(testdata.IBKRInitPath, testdata.IBKRAuthOverride{Status: http.StatusServiceUnavailable})
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := &testdata.IBKRAuthHandler{}
			c, _ := sessionClient(t, h, tc.mod)
			if tc.setup != nil {
				tc.setup(t, h)
			}
			_, _, err := c.ensureSession(context.Background())
			if err == nil {
				t.Fatal("ensureSession succeeded, want an error")
			}
			if got := errors.Is(err, ErrInvalidCredentials); got != tc.wantInvalid {
				t.Fatalf("errors.Is(err, ErrInvalidCredentials) = %v, want %v (err: %v)", got, tc.wantInvalid, err)
			}
			if n := h.Count(http.MethodGet, "/portfolio/accounts"); n != 0 {
				t.Fatalf("GET /portfolio/accounts sent %d times after a failed handshake", n)
			}
		})
	}
}

// @AC-5
func TestEnsureSession_LegacyBlobNoHTTP(t *testing.T) {
	cases := map[string]func(*IBKRConfig){
		"legacy_4_field": func(cfg *IBKRConfig) { cfg.SignatureKey, cfg.EncryptionKey, cfg.DHPrime = "", "", "" },
		"dh_prime_wrong_pem": func(cfg *IBKRConfig) {
			cfg.DHPrime = testdata.IBKRSignatureKeyPEM
		},
	}
	for name, mod := range cases {
		t.Run(name, func(t *testing.T) {
			h := &testdata.IBKRAuthHandler{}
			c, _ := sessionClient(t, h, mod)
			_, _, err := c.ensureSession(context.Background())
			if !errors.Is(err, ErrInvalidCredentials) {
				t.Fatalf("err = %v, want ErrInvalidCredentials", err)
			}
			if n := len(h.Requests()); n != 0 {
				t.Fatalf("legacy blob made %d HTTP requests, want 0", n)
			}
			body := strings.Split(testdata.IBKRSignatureKeyPEM, "\n")[1]
			if strings.Contains(err.Error(), "BEGIN") || strings.Contains(err.Error(), body) {
				t.Fatalf("error text echoes key material: %v", err)
			}
		})
	}
}

// @AC-10
func TestEnsureSession_NegativeCacheAndHeal(t *testing.T) {
	h := &testdata.IBKRAuthHandler{}
	c, clock := sessionClient(t, h, nil)
	h.SetOverride(testdata.IBKRLSTPath, testdata.IBKRAuthOverride{Status: http.StatusUnauthorized})

	if _, _, err := c.ensureSession(context.Background()); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("first call err = %v, want ErrInvalidCredentials", err)
	}
	clock.Advance(testTiming.ReauthMinInterval / 3)
	if _, _, err := c.ensureSession(context.Background()); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("negatively cached call err = %v, want ErrInvalidCredentials", err)
	}
	if n := h.Count(http.MethodPost, testdata.IBKRLSTPath); n != 1 {
		t.Fatalf("LST requests inside reauth_min_interval = %d, want 1", n)
	}

	h.SetOverride(testdata.IBKRLSTPath, testdata.IBKRAuthOverride{})
	clock.Advance(testTiming.ReauthMinInterval)
	if _, _, err := c.ensureSession(context.Background()); err != nil {
		t.Fatalf("healed call err = %v", err)
	}
	if n := h.Count(http.MethodPost, testdata.IBKRLSTPath); n != 2 {
		t.Fatalf("LST requests after heal = %d, want 2", n)
	}
}

func TestEnsureSession_CoalescesConcurrentCallers(t *testing.T) {
	h := &testdata.IBKRAuthHandler{}
	c, _ := sessionClient(t, h, nil)
	h.SetOverride(testdata.IBKRLSTPath, testdata.IBKRAuthOverride{Delay: 100 * time.Millisecond})

	var wg sync.WaitGroup
	errs := make(chan error, 16)
	for range 16 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _, err := c.ensureSession(context.Background())
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("concurrent ensureSession: %v", err)
		}
	}
	if n := h.Count(http.MethodPost, testdata.IBKRLSTPath); n != 1 {
		t.Fatalf("LST requests = %d, want exactly 1", n)
	}
}

func TestEnsureSession_DetachedFromCallerCtx(t *testing.T) {
	h := &testdata.IBKRAuthHandler{}
	c, _ := sessionClient(t, h, nil)
	h.SetOverride(testdata.IBKRLSTPath, testdata.IBKRAuthOverride{Delay: 50 * time.Millisecond})

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()
	_, _, err := c.ensureSession(ctx)
	if err == nil || errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("short caller ctx err = %v, want a transient error", err)
	}

	waitFor(t, func() bool {
		c.sessMu.Lock()
		defer c.sessMu.Unlock()
		return c.sess.lst != nil
	})
	if _, minted, err := c.ensureSession(context.Background()); err != nil || minted {
		t.Fatalf("second call minted %v err %v, want the cached session", minted, err)
	}
	if n := h.Count(http.MethodPost, testdata.IBKRLSTPath); n != 1 {
		t.Fatalf("LST requests = %d, want 1", n)
	}
}

func TestEnsureSession_JoinerRecall(t *testing.T) {
	h := &testdata.IBKRAuthHandler{}
	c, _ := sessionClient(t, h, nil)
	block := make(chan struct{})
	h.SetOverride(testdata.IBKRLSTPath, testdata.IBKRAuthOverride{Status: http.StatusServiceUnavailable, Block: block})

	type result struct {
		minted bool
		err    error
	}
	leader, joiner := make(chan result, 1), make(chan result, 1)
	go func() {
		_, m, err := c.ensureSession(context.Background())
		leader <- result{m, err}
	}()
	waitFor(t, func() bool { return h.Count(http.MethodPost, testdata.IBKRLSTPath) == 1 })
	go func() {
		_, m, err := c.ensureSession(context.Background())
		joiner <- result{m, err}
	}()
	time.Sleep(50 * time.Millisecond)
	h.SetOverride(testdata.IBKRLSTPath, testdata.IBKRAuthOverride{})
	close(block)

	l, j := <-leader, <-joiner
	if l.err == nil || errors.Is(l.err, ErrInvalidCredentials) {
		t.Fatalf("leader err = %v, want the transient 503 with no re-call", l.err)
	}
	if j.err != nil || !j.minted {
		t.Fatalf("joiner minted %v err %v, want one re-call that mints", j.minted, j.err)
	}
	if n := h.Count(http.MethodPost, testdata.IBKRLSTPath); n != 2 {
		t.Fatalf("LST requests = %d, want 2", n)
	}
}

func TestDHKeyBytes_HighBitVectors(t *testing.T) {
	v := testdata.MustIBKRVectors()
	p, _ := new(big.Int).SetString(v.Inputs.DHPrimeHex, 16)
	a, _ := new(big.Int).SetString(v.Inputs.DHRandomHex, 16)
	prepend, err := hex.DecodeString(v.LSTRequest.Prepend)
	if err != nil {
		t.Fatalf("decode prepend: %v", err)
	}
	if len(v.DHCases) != 2 {
		t.Fatalf("want 2 DH cases, got %d", len(v.DHCases))
	}
	for _, dc := range v.DHCases {
		t.Run(dc.Name, func(t *testing.T) {
			b, ok := new(big.Int).SetString(dc.DiffieHellmanResponse, 16)
			if !ok {
				t.Fatal("parse diffie_hellman_response")
			}
			k := new(big.Int).Exp(b, a, p)
			if k.BitLen() != dc.KBitlen {
				t.Fatalf("bitlen(K) = %d, want %d", k.BitLen(), dc.KBitlen)
			}
			if got := base64.StdEncoding.EncodeToString(computeLST(k, prepend)); got != dc.LiveSessionToken {
				t.Fatalf("LST = %s, want %s", got, dc.LiveSessionToken)
			}
		})
	}
}

func TestInvalidate_GenerationGuardAndThrottle(t *testing.T) {
	h := &testdata.IBKRAuthHandler{}
	c, clock := sessionClient(t, h, nil)
	first, _, err := c.ensureSession(context.Background())
	if err != nil {
		t.Fatalf("ensureSession: %v", err)
	}
	if c.invalidate(first.gen + 1) {
		t.Fatal("invalidate honoured a generation that is not current")
	}
	if !c.invalidate(first.gen) {
		t.Fatal("invalidate refused the current generation")
	}
	second, minted, err := c.ensureSession(context.Background())
	if err != nil || !minted || second.gen != first.gen+1 {
		t.Fatalf("re-mint: gen %d minted %v err %v", second.gen, minted, err)
	}
	if c.invalidate(second.gen) {
		t.Fatal("invalidate honoured inside reauth_min_interval")
	}
	clock.Advance(testTiming.ReauthMinInterval)
	if !c.invalidate(second.gen) {
		t.Fatal("invalidate refused after reauth_min_interval")
	}
}

func TestReinit_RerunsInitOnly(t *testing.T) {
	h := &testdata.IBKRAuthHandler{}
	c, _ := sessionClient(t, h, nil)
	sess, _, err := c.ensureSession(context.Background())
	if err != nil {
		t.Fatalf("ensureSession: %v", err)
	}
	if err := c.reinit(context.Background(), sess.gen); err != nil {
		t.Fatalf("reinit: %v", err)
	}
	if lst, init := h.Count(http.MethodPost, testdata.IBKRLSTPath), h.Count(http.MethodPost, testdata.IBKRInitPath); lst != 1 || init != 2 {
		t.Fatalf("LST %d init %d, want 1 and 2", lst, init)
	}
	if err := c.reinit(context.Background(), sess.gen+1); err != nil {
		t.Fatalf("stale-generation reinit: %v", err)
	}
	if n := h.Count(http.MethodPost, testdata.IBKRInitPath); n != 2 {
		t.Fatalf("stale-generation reinit sent init: %d", n)
	}
	h.SetOverride(testdata.IBKRInitPath, testdata.IBKRAuthOverride{Body: testdata.IBKRInitReplyJSON(false, false)})
	if err := c.reinit(context.Background(), sess.gen); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("unauthenticated reinit err = %v, want ErrInvalidCredentials", err)
	}
}

func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatal("condition not met within 2s")
		}
		time.Sleep(5 * time.Millisecond)
	}
}
