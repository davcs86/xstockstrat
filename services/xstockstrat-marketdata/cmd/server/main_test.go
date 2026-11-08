package main

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	configv1 "github.com/xstockstrat/contracts/gen/go/config/v1"
	"github.com/xstockstrat/marketdata/internal/config"
	"github.com/xstockstrat/marketdata/internal/fmp"
	"github.com/xstockstrat/marketdata/internal/testdata"
)

func TestLooksLikePlaceholderCred(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want bool
	}{
		{"empty", "", true},
		{"whitespace only", "   ", true},
		{"dev placeholder", "YOUR_DEV_ALPACA_API_KEY", true},
		{"prod placeholder", "YOUR_PROD_ALPACA_API_SECRET", true},
		{"lowercase placeholder prefix", "your_alpaca_key", true},
		{"explicit placeholder word", "changeme-PLACEHOLDER", true},
		{"ordinary key value", "alpaca-key-real-value", false},
		{"ordinary secret value", "alpaca-secret-real-value", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := looksLikePlaceholderCred(tc.in); got != tc.want {
				t.Errorf("looksLikePlaceholderCred(%q) = %v, want %v", tc.in, got, tc.want)
			}
		})
	}
}

// TestNewFundamentalsSource_AlwaysNonNil is a regression canary (feature 082, extended
// by feature 129 to cross both providers): the constructor must return non-nil
// regardless of provider/apiKey/config state — there is no "enabled" axis left to vary
// at this call site. A zero-value *config.Watcher is safe here: GetString touches only
// w.mu (usable zero-value sync.RWMutex) and w.snapshot (nil-map read returns ok=false)
// — see internal/config/config.go:100-153.
func TestNewFundamentalsSource_AlwaysNonNil(t *testing.T) {
	cfgWatcher := &config.Watcher{}
	for _, provider := range []string{"fmp", "finnhub", "unrecognized-falls-back-to-fmp"} {
		for _, apiKey := range []string{"", "real-key"} {
			key := func() string { return apiKey }
			src := newFundamentalsSource(cfgWatcher, staticString(provider), newFMPClient(cfgWatcher, key), key)
			if src == nil {
				t.Fatalf("newFundamentalsSource(%q, %q) returned nil; must always be non-nil", provider, apiKey)
			}
		}
	}
}

type fakeSeedCounter struct {
	bySource map[string]int
	err      error
	srcs     []string
}

func (c *fakeSeedCounter) CountFundamentalsFetchedToday(_ context.Context, src string) (int, error) {
	c.srcs = append(c.srcs, src)
	if c.err != nil {
		return 0, c.err
	}
	return c.bySource[src], nil
}

type seedQuoteRT struct{ calls int }

func (rt *seedQuoteRT) RoundTrip(req *http.Request) (*http.Response, error) {
	rt.calls++
	return &http.Response{
		StatusCode: http.StatusOK,
		Header:     http.Header{"Content-Type": []string{"application/json"}},
		Body:       io.NopCloser(strings.NewReader(`[{"symbol":"` + testdata.Msft + `","price":400}]`)),
		Request:    req,
	}, nil
}

func newSeedFMPClient(rt http.RoundTripper) *fmp.Client {
	return fmp.NewClient(fmp.ClientConfig{
		BaseURL:    "https://fmp.test",
		APIKey:     "k",
		HTTPClient: &http.Client{Transport: rt},
		Limits:     func() (float64, int) { return 0, 7 },
	})
}

// AC-3 (feature 255): the FMP boot seed counts only fmp rows, so edgar rows written today never spend the budget.
func TestSeedFMPBudget_CountsOnlyFMPRows_AC3(t *testing.T) {
	ctx := context.Background()
	counter := &fakeSeedCounter{bySource: map[string]int{"edgar": 30, fmp.SourceName: 5}}
	rt := &seedQuoteRT{}
	client := newSeedFMPClient(rt)

	seedFMPBudget(ctx, counter, client)

	if used, _ := client.BudgetSnapshot(); used != 5 {
		t.Fatalf("seeded used = %d, want 5 (fmp rows only)", used)
	}
	if _, err := client.GetFundamentals(ctx, testdata.Msft); err != nil {
		t.Fatalf("GetFundamentals after seed: %v (budget must not be exhausted)", err)
	}
	if rt.calls != 1 {
		t.Fatalf("HTTP calls = %d, want 1", rt.calls)
	}
	if len(counter.srcs) != 1 || counter.srcs[0] != fmp.SourceName {
		t.Fatalf("counted sources = %v, want [%q]", counter.srcs, fmp.SourceName)
	}
}

func TestSeedFMPBudget_CountErrorStartsFromZero(t *testing.T) {
	counter := &fakeSeedCounter{err: errors.New("db down")}
	client := newSeedFMPClient(&seedQuoteRT{})

	seedFMPBudget(context.Background(), counter, client)

	if used, _ := client.BudgetSnapshot(); used != 0 {
		t.Fatalf("seeded used = %d, want 0 after a count error", used)
	}
}

func staticString(s string) func() string { return func() string { return s } }

func strVal(s string) *configv1.ConfigValue {
	return &configv1.ConfigValue{Value: &configv1.ConfigValue_StringVal{StringVal: s}}
}

// applyDelta pushes a DELTA through the watcher exactly as the stream loop does, firing OnChange.
func applyDelta(w *config.Watcher, version string, values map[string]*configv1.ConfigValue) {
	keys := make([]string, 0, len(values))
	for k := range values {
		keys = append(keys, k)
	}
	w.ApplyUpdate("marketdata", &configv1.ConfigSnapshot{
		Namespace:   "marketdata",
		Version:     version,
		UpdateType:  configv1.ConfigUpdateType_CONFIG_UPDATE_TYPE_DELTA,
		Values:      values,
		ChangedKeys: keys,
	})
}

// vendorFake is an httptest vendor endpoint that records hits and the key query param it saw.
type vendorFake struct {
	srv  *httptest.Server
	mu   sync.Mutex
	hits int
	keys []string
}

func newVendorFake(t *testing.T, keyParam, body string) *vendorFake {
	t.Helper()
	f := &vendorFake{}
	f.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		f.hits++
		f.keys = append(f.keys, r.URL.Query().Get(keyParam))
		f.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, body)
	}))
	t.Cleanup(f.srv.Close)
	return f
}

func (f *vendorFake) snapshot() (int, string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.keys) == 0 {
		return f.hits, ""
	}
	return f.hits, f.keys[len(f.keys)-1]
}

const fmpQuoteBody = `[{"symbol":"` + testdata.Msft + `","price":400}]`

// @AC-7: provider finnhub → fmp without a restart. The next GetFundamentals goes through the one
// shared *fmp.Client, whose day budget carries on from its boot seed instead of resetting.
func TestFundamentalsSource_ProviderSwitchIsLive_AC7(t *testing.T) {
	ctx := context.Background()
	fmpFake := newVendorFake(t, "apikey", fmpQuoteBody)
	finnhubFake := newVendorFake(t, "token", `{}`)
	w := config.NewSnapshotWatcher(map[string]*configv1.ConfigValue{
		"marketdata.fundamentals.provider": strVal("finnhub"),
		"marketdata.fmp.base_url":          strVal(fmpFake.srv.URL),
		"marketdata.fmp.metrics":           strVal("core"),
		"marketdata.finnhub.base_url":      strVal(finnhubFake.srv.URL),
	})
	fmpClient := newFMPClient(w, staticString("fmp-key"))
	fmpClient.SeedBudget(5)
	src := newFundamentalsSource(w, fundamentalsProvider(w), fmpClient, staticString("fh-key"))

	_, _ = src.GetFundamentals(ctx, testdata.Msft)
	if hits, _ := finnhubFake.snapshot(); hits == 0 {
		t.Fatal("under finnhub: the Finnhub fake saw no request")
	}
	if hits, _ := fmpFake.snapshot(); hits != 0 {
		t.Fatalf("under finnhub: the FMP fake saw %d requests, want 0", hits)
	}
	finnhubBefore, _ := finnhubFake.snapshot()

	applyDelta(w, "v2", map[string]*configv1.ConfigValue{"marketdata.fundamentals.provider": strVal("fmp")})

	if _, err := src.GetFundamentals(ctx, testdata.Msft); err != nil {
		t.Fatalf("under fmp: GetFundamentals: %v", err)
	}
	if hits, key := fmpFake.snapshot(); hits != 1 || key != "fmp-key" {
		t.Fatalf("under fmp: FMP fake hits=%d key=%q, want 1 request carrying fmp-key", hits, key)
	}
	if hits, _ := finnhubFake.snapshot(); hits != finnhubBefore {
		t.Fatalf("under fmp: Finnhub fake hits %d → %d, want no new request", finnhubBefore, hits)
	}
	if used, _ := fmpClient.BudgetSnapshot(); used != 6 {
		t.Fatalf("shared FMP budget used = %d, want 6 (seed 5 + 1): the boot client must serve the switch", used)
	}
}

// fakeResolver stands in for (*config.Watcher).ResolveSecret; keys listed in fail return an error.
type fakeResolver struct {
	mu     sync.Mutex
	values map[string]string
	fail   map[string]bool
	calls  map[string]int
}

func (r *fakeResolver) resolve(_ context.Context, key string) (string, bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.calls[key]++
	if r.fail[key] {
		return "", false, errors.New("config unavailable")
	}
	v, ok := r.values[key]
	return v, ok, nil
}

func (r *fakeResolver) set(fn func(r *fakeResolver)) {
	r.mu.Lock()
	defer r.mu.Unlock()
	fn(r)
}

// syncBuffer is a goroutine-safe log sink: the re-resolve runs off the watcher's hook.
type syncBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *syncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *syncBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

// @AC-16: a rotated fmp.api_key is used by the next FMP request without a restart. When the
// re-resolve fails on every retry (1/2/4 s), the previous key stays live and a WARN is logged
// that never carries a key value.
func TestLiveSecrets_RotationReachesNextFMPRequest_AC16(t *testing.T) {
	logs := &syncBuffer{}
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(logs, nil)))
	t.Cleanup(func() { slog.SetDefault(prev) })

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	fmpFake := newVendorFake(t, "apikey", fmpQuoteBody)
	w := config.NewSnapshotWatcher(map[string]*configv1.ConfigValue{
		"marketdata.fmp.base_url": strVal(fmpFake.srv.URL),
		"marketdata.fmp.metrics":  strVal("core"),
	})
	res := &fakeResolver{values: map[string]string{"fmp.api_key": "rot-k1-secret"}, fail: map[string]bool{}, calls: map[string]int{}}
	var sleepMu sync.Mutex
	var sleeps []time.Duration
	secrets := newLiveSecrets(res.resolve, func(d time.Duration) {
		sleepMu.Lock()
		defer sleepMu.Unlock()
		sleeps = append(sleeps, d)
	})
	secrets.load(ctx)
	secrets.bindRefresh(ctx, w)
	fmpKey := secrets.accessor("fmp.api_key")
	client := newFMPClient(w, fmpKey)

	if _, err := client.GetFundamentals(ctx, testdata.Msft); err != nil {
		t.Fatalf("GetFundamentals with k1: %v", err)
	}
	if _, key := fmpFake.snapshot(); key != "rot-k1-secret" {
		t.Fatalf("first FMP request carried %q, want k1", key)
	}

	res.set(func(r *fakeResolver) { r.values["fmp.api_key"] = "rot-k2-secret" })
	applyDelta(w, "v2", map[string]*configv1.ConfigValue{"marketdata.fmp.metrics": strVal("core")})
	waitFor(t, "fmp.api_key to re-resolve to k2", func() bool { return fmpKey() == "rot-k2-secret" })
	if _, err := client.GetFundamentals(ctx, testdata.Msft); err != nil {
		t.Fatalf("GetFundamentals after rotation: %v", err)
	}
	if _, key := fmpFake.snapshot(); key != "rot-k2-secret" {
		t.Fatalf("FMP request after rotation carried %q, want k2", key)
	}

	res.set(func(r *fakeResolver) {
		r.values["fmp.api_key"] = "rot-k3-secret"
		r.fail["fmp.api_key"] = true
		r.calls["fmp.api_key"] = 0
	})
	sleepMu.Lock()
	sleeps = nil
	sleepMu.Unlock()
	applyDelta(w, "v3", map[string]*configv1.ConfigValue{"marketdata.fmp.metrics": strVal("core")})
	waitFor(t, "a WARN for the failed fmp.api_key re-resolve", func() bool {
		s := logs.String()
		return strings.Contains(s, "level=WARN") && strings.Contains(s, "fmp.api_key")
	})

	sleepMu.Lock()
	gotSleeps := append([]time.Duration(nil), sleeps...)
	sleepMu.Unlock()
	if want := []time.Duration{time.Second, 2 * time.Second, 4 * time.Second}; !slices.Equal(gotSleeps, want) {
		t.Fatalf("retry delays = %v, want %v", gotSleeps, want)
	}
	res.set(func(r *fakeResolver) {
		if r.calls["fmp.api_key"] != 4 {
			t.Errorf("resolve attempts for fmp.api_key = %d, want 4 (1 + 3 retries)", r.calls["fmp.api_key"])
		}
	})
	if got := fmpKey(); got != "rot-k2-secret" {
		t.Fatalf("after a failed re-resolve the key is %q, want the previous k2 kept", got)
	}
	if _, err := client.GetFundamentals(ctx, testdata.Msft); err != nil {
		t.Fatalf("GetFundamentals after failed re-resolve: %v", err)
	}
	if _, key := fmpFake.snapshot(); key != "rot-k2-secret" {
		t.Fatalf("FMP request after failed re-resolve carried %q, want k2", key)
	}
	if s := logs.String(); strings.Contains(s, "rot-k1-secret") || strings.Contains(s, "rot-k2-secret") || strings.Contains(s, "rot-k3-secret") {
		t.Fatalf("a secret value reached the log:\n%s", s)
	}
}

// secHostRedirect sends www.sec.gov (the fixed ticker→CIK map host) to the test server.
type secHostRedirect struct {
	target *url.URL
	next   http.RoundTripper
}

func (rt secHostRedirect) RoundTrip(req *http.Request) (*http.Response, error) {
	if req.URL.Host == "www.sec.gov" {
		req = req.Clone(req.Context())
		req.URL.Scheme, req.URL.Host = rt.target.Scheme, rt.target.Host
	}
	return rt.next.RoundTrip(req)
}

// @AC-32 row 2: marketdata.edgar.user_agent "a/1" → "b/2" reaches the next EDGAR request.
func TestEDGARClient_UserAgentIsLive_AC32(t *testing.T) {
	var mu sync.Mutex
	var agents []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		agents = append(agents, r.Header.Get("User-Agent"))
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		if strings.HasSuffix(r.URL.Path, "company_tickers.json") {
			_, _ = io.WriteString(w, `{"0":{"cik_str":789019,"ticker":"`+testdata.Msft+`","title":"Microsoft"}}`)
			return
		}
		_, _ = io.WriteString(w, `{"facts":{}}`)
	}))
	t.Cleanup(srv.Close)
	target, err := url.Parse(srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	prevRT := http.DefaultTransport
	http.DefaultTransport = secHostRedirect{target: target, next: prevRT}
	t.Cleanup(func() { http.DefaultTransport = prevRT })

	w := config.NewSnapshotWatcher(map[string]*configv1.ConfigValue{
		"marketdata.edgar.base_url":   strVal(srv.URL),
		"marketdata.edgar.user_agent": strVal("a/1"),
	})
	c := newEDGARClient(w)
	fetch := func() []string {
		t.Helper()
		mu.Lock()
		agents = nil
		mu.Unlock()
		if _, err := c.FetchHistorical(context.Background(), testdata.Msft, time.Time{}, time.Now(), nil); err != nil {
			t.Fatalf("FetchHistorical: %v", err)
		}
		mu.Lock()
		defer mu.Unlock()
		return append([]string(nil), agents...)
	}

	if got := fetch(); len(got) == 0 || !allEqual(got, "a/1") {
		t.Fatalf("User-Agent before the change = %v, want every request a/1", got)
	}
	applyDelta(w, "v2", map[string]*configv1.ConfigValue{"marketdata.edgar.user_agent": strVal("b/2")})
	if got := fetch(); len(got) == 0 || !allEqual(got, "b/2") {
		t.Fatalf("User-Agent after the change = %v, want every request b/2", got)
	}
}

func allEqual(xs []string, want string) bool {
	for _, x := range xs {
		if x != want {
			return false
		}
	}
	return true
}
