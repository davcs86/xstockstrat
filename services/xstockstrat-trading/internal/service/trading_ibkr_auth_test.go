package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"google.golang.org/grpc/codes"
	grpcstatus "google.golang.org/grpc/status"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	configv1 "github.com/xstockstrat/contracts/gen/go/config/v1"
	tradingv1 "github.com/xstockstrat/contracts/gen/go/trading/v1"
	"github.com/xstockstrat/trading/internal/broker"
	"github.com/xstockstrat/trading/internal/config"
	"github.com/xstockstrat/trading/internal/repository"
	"github.com/xstockstrat/trading/internal/testdata"
)

// testEncKeyHex is the gitleaks-allowlisted AES-256 test key (.gitleaks.toml).
const testEncKeyHex = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"

var (
	credOK      = int32(tradingv1.CredentialStatus_CREDENTIAL_STATUS_OK)
	credInvalid = int32(tradingv1.CredentialStatus_CREDENTIAL_STATUS_INVALID)
	credUnknown = int32(tradingv1.CredentialStatus_CREDENTIAL_STATUS_UNKNOWN)
)

type ibkrTestClock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *ibkrTestClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *ibkrTestClock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.t = c.t.Add(d)
}

// swapDefaultTransport points http.DefaultTransport (the IBKR client's transport) at rt for the test.
// No internal/service test runs in parallel.
func swapDefaultTransport(t *testing.T, rt http.RoundTripper) {
	t.Helper()
	orig := http.DefaultTransport
	http.DefaultTransport = rt
	t.Cleanup(func() { http.DefaultTransport = orig })
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

// ibkrAuthService builds a TradingService over cfgW and a real IBKR client that signs over the vector
// base URL with the vector nonce; every request is routed to h.
func ibkrAuthService(t *testing.T, h *testdata.IBKRAuthHandler, cfgW *config.Watcher, mod func(*broker.IBKRConfig)) (*TradingService, *fakeAccountRepo, *broker.IBKRClient, *ibkrTestClock) {
	t.Helper()
	v := testdata.MustIBKRVectors()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	u, _ := url.Parse(srv.URL)
	next := http.DefaultTransport
	swapDefaultTransport(t, roundTripFunc(func(r *http.Request) (*http.Response, error) {
		out := r.Clone(r.Context())
		out.URL.Scheme, out.URL.Host = "http", u.Host
		return next.RoundTrip(out)
	}))

	repo := &fakeAccountRepo{}
	svc := &TradingService{cfg: &config.Config{}, cfgW: cfgW, accountRepo: repo, credStatus: map[string]int32{}}
	ts, _ := strconv.ParseInt(v.Inputs.Timestamp, 10, 64)
	clock := &ibkrTestClock{t: time.Unix(ts, 0)}
	cfg := broker.IBKRConfig{
		BaseURL:           v.Inputs.BaseURL,
		IBKRAccountID:     "U123",
		ConsumerKey:       v.Inputs.ConsumerKey,
		AccessToken:       v.Inputs.AccessToken,
		AccessTokenSecret: v.Inputs.AccessTokenSecret,
		SignatureKey:      testdata.IBKRSignatureKeyPEM,
		EncryptionKey:     testdata.IBKREncryptionKeyPEM,
		DHPrime:           testdata.IBKRDHParamPEM,
		Timing:            svc.ibkrTiming,
		Now:               clock.Now,
		Nonce:             func() string { return v.LSTRequest.Nonce },
		DHRandom: func() *big.Int {
			a, _ := new(big.Int).SetString(v.Inputs.DHRandomHex, 16)
			return a
		},
	}
	if mod != nil {
		mod(&cfg)
	}
	return svc, repo, broker.NewIBKRClient(cfg), clock
}

func portfolioAccountsOK() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/portfolio/accounts") {
			_, _ = w.Write([]byte(`[{"accountId":"U123"}]`))
			return
		}
		http.NotFound(w, r)
	})
}

func snapshotInts(kv map[string]int64) *config.Watcher {
	snap := make(map[string]*configv1.ConfigValue, len(kv))
	for k, n := range kv {
		snap[k] = &configv1.ConfigValue{Value: &configv1.ConfigValue_IntVal{IntVal: n}}
	}
	return config.NewSnapshotWatcher(snap)
}

func assertStatusWrites(t *testing.T, repo *fakeAccountRepo, want ...int32) {
	t.Helper()
	if fmt.Sprint(repo.statusWrites) != fmt.Sprint(want) {
		t.Fatalf("credential status writes = %v, want %v", repo.statusWrites, want)
	}
}

// @AC-3
func TestValidateAndRecordCredential_IBKRHandshakeOK(t *testing.T) {
	h := &testdata.IBKRAuthHandler{Strict: true, Next: portfolioAccountsOK()}
	svc, repo, c, _ := ibkrAuthService(t, h, &config.Watcher{}, nil)

	status, _ := svc.validateAndRecordCredential(context.Background(), "ibkr-1", c)
	if status != credOK {
		t.Fatalf("status = %d, want OK (requests: %+v)", status, h.Requests())
	}
	reqs := h.Requests()
	wantOrder := []string{testdata.IBKRLSTPath, testdata.IBKRInitPath, "/portfolio/accounts"}
	if len(reqs) != len(wantOrder) {
		t.Fatalf("requests = %+v, want LST, init, GET /portfolio/accounts", reqs)
	}
	for i, suffix := range wantOrder {
		if !strings.HasSuffix(reqs[i].PathQuery, suffix) {
			t.Fatalf("request %d = %s, want suffix %s", i, reqs[i].PathQuery, suffix)
		}
	}
	assertStatusWrites(t, repo, credOK)
}

// @AC-4
func TestValidateAndRecordCredential_IBKRHandshakeFailures(t *testing.T) {
	v := testdata.MustIBKRVectors()
	lst, initPath := testdata.IBKRLSTPath, testdata.IBKRInitPath
	cases := []struct {
		name   string
		path   string
		o      func(t *testing.T) testdata.IBKRAuthOverride
		cfgW   *config.Watcher
		secret string
		want   int32
	}{
		{name: "lst_401", path: lst, want: credInvalid, o: overrideStatus(http.StatusUnauthorized)},
		{name: "lst_403", path: lst, want: credInvalid, o: overrideStatus(http.StatusForbidden)},
		{name: "lst_503", path: lst, want: credUnknown, o: overrideStatus(http.StatusServiceUnavailable)},
		{name: "lst_timeout", path: lst, want: credUnknown,
			cfgW: snapshotInts(map[string]int64{"trading.ibkr.handshake_timeout_ms": 50}),
			o: func(t *testing.T) testdata.IBKRAuthOverride {
				block := make(chan struct{})
				t.Cleanup(func() { close(block) })
				return testdata.IBKRAuthOverride{Block: block}
			}},
		{name: "undecryptable_secret", want: credInvalid, secret: v.Decrypt.WrongKeyCiphertextB64},
		{name: "lst_signature_mismatch", path: lst, want: credInvalid, o: overrideBody(testdata.IBKRLSTReplyJSON(v.LSTReply.BadLiveSessionTokenSignature))},
		{name: "init_not_authenticated", path: initPath, want: credInvalid, o: overrideBody(testdata.IBKRInitReplyJSON(false, false))},
		{name: "init_competing", path: initPath, want: credInvalid, o: overrideBody(testdata.IBKRInitReplyJSON(false, true))},
		{name: "init_503", path: initPath, want: credUnknown, o: overrideStatus(http.StatusServiceUnavailable)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := &testdata.IBKRAuthHandler{Next: portfolioAccountsOK()}
			cfgW := tc.cfgW
			if cfgW == nil {
				cfgW = &config.Watcher{}
			}
			svc, repo, c, _ := ibkrAuthService(t, h, cfgW, func(cfg *broker.IBKRConfig) {
				if tc.secret != "" {
					cfg.AccessTokenSecret = tc.secret
				}
			})
			if tc.o != nil {
				h.SetOverride(tc.path, tc.o(t))
			}
			status, _ := svc.validateAndRecordCredential(context.Background(), "ibkr-1", c)
			if status != tc.want {
				t.Fatalf("status = %d, want %d", status, tc.want)
			}
			assertStatusWrites(t, repo, tc.want)
			if n := h.Count(http.MethodGet, "/portfolio/accounts"); n != 0 {
				t.Fatalf("GET /portfolio/accounts sent %d times after a failed handshake", n)
			}
		})
	}
}

func overrideStatus(code int) func(*testing.T) testdata.IBKRAuthOverride {
	return func(*testing.T) testdata.IBKRAuthOverride { return testdata.IBKRAuthOverride{Status: code} }
}

func overrideBody(b string) func(*testing.T) testdata.IBKRAuthOverride {
	return func(*testing.T) testdata.IBKRAuthOverride { return testdata.IBKRAuthOverride{Body: b} }
}

// @AC-5
func TestLoadBrokerPool_LegacyIBKRBlobKeepsEntryReadsInvalid(t *testing.T) {
	legacy := `{"consumer_key":"ck","access_token":"at","access_token_secret":"ats","ibkr_account_id":"U123"}`
	enc, err := repository.EncryptCredentials(testEncKeyHex, []byte(legacy))
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	swapDefaultTransport(t, roundTripFunc(func(r *http.Request) (*http.Response, error) {
		t.Errorf("legacy blob made an HTTP request: %s %s", r.Method, r.URL)
		return nil, errors.New("no HTTP allowed")
	}))
	repo := &fakeAccountRepo{listActiveFn: func(context.Context) ([]*repository.BrokerAccountRecord, error) {
		return []*repository.BrokerAccountRecord{{
			ID: "ibkr-legacy", UserID: "user-1", BrokerType: int32(commonv1.BrokerType_BROKER_TYPE_IBKR), IsPaper: true, CredentialsEnc: enc,
		}}, nil
	}}
	svc := &TradingService{
		cfg: &config.Config{}, cfgW: &config.Watcher{}, encKey: testEncKeyHex, accountRepo: repo,
		brokers: map[string]brokerPoolEntry{}, credStatus: map[string]int32{},
		halted: map[string]bool{}, haltReasons: map[string]string{},
	}
	if err := svc.LoadBrokerPool(context.Background()); err != nil {
		t.Fatalf("LoadBrokerPool: %v", err)
	}
	entry, ok := svc.brokers["ibkr-legacy"]
	if !ok || entry.client == nil {
		t.Fatal("legacy IBKR account lost its broker pool entry")
	}
	if status, _ := svc.validateAndRecordCredential(context.Background(), "ibkr-legacy", entry.client); status != credInvalid {
		t.Fatalf("status = %d, want INVALID", status)
	}
	assertStatusWrites(t, repo, credInvalid)
}

// @AC-7 — the OFFLINE row is TestRegisterBrokerAccount_Offline (trading_offline_test.go), unchanged.
func TestRegisterAndUpdate_IBKRIncompleteBlob_InvalidArgument(t *testing.T) {
	full := map[string]string{
		"consumer_key": "val-ck", "access_token": "val-at", "access_token_secret": "val-ats", "ibkr_account_id": "val-U1",
		"signature_key": "val-sig-pem", "encryption_key": "val-enc-pem", "dh_prime": "val-dh-pem",
	}
	for _, omit := range []string{"signature_key", "encryption_key", "dh_prime"} {
		blob := map[string]string{}
		for k, val := range full {
			if k != omit {
				blob[k] = val
			}
		}
		raw, _ := json.Marshal(blob)
		check := func(t *testing.T, err error) {
			t.Helper()
			if grpcstatus.Code(err) != codes.InvalidArgument {
				t.Fatalf("code = %v, want InvalidArgument (err: %v)", grpcstatus.Code(err), err)
			}
			msg := err.Error()
			if !strings.Contains(msg, omit) {
				t.Fatalf("error %q does not name the missing field %s", msg, omit)
			}
			for _, val := range full {
				if strings.Contains(msg, val) {
					t.Fatalf("error %q echoes a submitted value", msg)
				}
			}
		}
		t.Run("register_omits_"+omit, func(t *testing.T) {
			repo := &offlineAccountRepo{}
			svc := &TradingService{
				cfg: &config.Config{TradingMode: "paper"}, cfgW: &config.Watcher{}, encKey: testEncKeyHex,
				accountRepo: repo, brokers: map[string]brokerPoolEntry{}, credStatus: map[string]int32{},
			}
			_, err := svc.RegisterBrokerAccount(context.Background(), &tradingv1.RegisterBrokerAccountRequest{
				DisplayName: "ibkr", BrokerType: commonv1.BrokerType_BROKER_TYPE_IBKR, CredentialsJson: string(raw),
			}, "user-1")
			check(t, err)
			if len(repo.created) != 0 {
				t.Fatal("an incomplete IBKR blob was persisted")
			}
		})
		t.Run("update_omits_"+omit, func(t *testing.T) {
			repo := &offlineAccountRepo{getRec: &repository.BrokerAccountRecord{
				ID: "ibkr-1", UserID: "user-1", BrokerType: int32(commonv1.BrokerType_BROKER_TYPE_IBKR),
			}}
			svc := &TradingService{cfgW: &config.Watcher{}, encKey: testEncKeyHex, accountRepo: repo}
			_, err := svc.UpdateBrokerAccountCredentials(context.Background(), "ibkr-1", "user-1", string(raw))
			check(t, err)
		})
	}
}

// @AC-8, @AC-6 row 5
func TestIsUncertainBrokerOutcome(t *testing.T) {
	h := &testdata.IBKRAuthHandler{}
	_, _, c, _ := ibkrAuthService(t, h, &config.Watcher{}, nil)
	h.SetOverride(testdata.IBKRLSTPath, testdata.IBKRAuthOverride{Status: http.StatusServiceUnavailable})
	_, sessionErr := c.SubmitOrder(context.Background(), broker.OrderRequest{Symbol: "AAPL", Side: "buy", OrderType: "market", Qty: 1, TimeInForce: "day"})
	if sessionErr == nil {
		t.Fatal("SubmitOrder succeeded with a failing LST handshake")
	}
	cases := []struct {
		name string
		err  error
		want bool
	}{
		{"session_failure_is_definite", sessionErr, false},
		{"outcome_uncertain", fmt.Errorf("ibkr SubmitOrder: http: %w", broker.ErrOutcomeUncertain), true},
		{"deadline_exceeded", fmt.Errorf("x: %w", context.DeadlineExceeded), true},
	}
	for _, tc := range cases {
		if got := isUncertainBrokerOutcome(tc.err); got != tc.want {
			t.Errorf("%s: isUncertainBrokerOutcome(%v) = %v, want %v", tc.name, tc.err, got, tc.want)
		}
	}
}

// @AC-9
func TestReconcileTick_InvalidCredentialsNotSystemic(t *testing.T) {
	rejected := fmt.Errorf("ibkr ListOrders: http: %w", broker.ErrInvalidCredentials)
	rows := map[string]*fakeReconciliationBroker{
		"ListOrders": {listOrdersFn: func(context.Context) ([]broker.BrokerOrder, error) { return nil, rejected }},
		"GetPositions": {getPositionsFn: func(context.Context) ([]broker.BrokerPosition, error) {
			return nil, rejected
		}},
	}
	for call, ibkr := range rows {
		t.Run(call, func(t *testing.T) {
			logs := captureLogs(t)
			svc := newTestReconciliationService(
				map[string]brokerPoolEntry{
					"ibkr-1": {client: ibkr, brokerType: int32(commonv1.BrokerType_BROKER_TYPE_IBKR), userID: "u-1"},
					"alp-1":  {client: &fakeReconciliationBroker{}, brokerType: int32(commonv1.BrokerType_BROKER_TYPE_ALPACA), userID: "u-2"},
				},
				&fakeReconciliationPortfolioClient{}, &recordingLedgerClient{}, &fakeNotifyClient{}, noopAccountRepo{},
			)
			setter := &fakeConfigSetter{}
			svc.configSetter = setter

			systemic, total := svc.reconcileTick(context.Background(), 0, 0.5)
			if systemic != 0 || total != 2 {
				t.Fatalf("reconcileTick = (systemic %d, total %d), want (0, 2)", systemic, total)
			}
			if len(setter.calls) != 0 {
				t.Fatalf("escalated to REDUCE_ONLY: %d SetConfig calls", len(setter.calls))
			}
			warned := false
			for _, rec := range logs() {
				if rec["level"] == "WARN" && rec["account_id"] == "ibkr-1" && rec["call"] == call {
					warned = true
				}
			}
			if !warned {
				t.Fatalf("no WARN skip log for ibkr-1 on %s", call)
			}
		})
	}
}

// @AC-10
func TestValidateAndRecordCredential_NegativeCacheThenHeal(t *testing.T) {
	const reauth = 120 * time.Second // above the 30s default, so the second call proves the key is applied
	h := &testdata.IBKRAuthHandler{Next: portfolioAccountsOK()}
	svc, repo, c, clock := ibkrAuthService(t, h, snapshotInts(map[string]int64{"trading.ibkr.reauth_min_interval_ms": reauth.Milliseconds()}), nil)
	h.SetOverride(testdata.IBKRLSTPath, testdata.IBKRAuthOverride{Status: http.StatusUnauthorized})

	if status, _ := svc.validateAndRecordCredential(context.Background(), "ibkr-1", c); status != credInvalid {
		t.Fatalf("first status = %d, want INVALID", status)
	}
	clock.Advance(reauth / 2)
	if status, _ := svc.validateAndRecordCredential(context.Background(), "ibkr-1", c); status != credInvalid {
		t.Fatalf("second status = %d, want INVALID", status)
	}
	if n := h.Count(http.MethodPost, testdata.IBKRLSTPath); n != 1 {
		t.Fatalf("LST requests inside reauth_min_interval = %d, want 1", n)
	}

	h.SetOverride(testdata.IBKRLSTPath, testdata.IBKRAuthOverride{})
	clock.Advance(reauth)
	if status, _ := svc.validateAndRecordCredential(context.Background(), "ibkr-1", c); status != credOK {
		t.Fatalf("healed status = %d, want OK", status)
	}
	assertStatusWrites(t, repo, credInvalid, credOK)
}
