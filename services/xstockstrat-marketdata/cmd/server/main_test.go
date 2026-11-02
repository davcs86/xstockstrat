package main

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"

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
			src := newFundamentalsSource(cfgWatcher, provider, newFMPClient(cfgWatcher, apiKey), apiKey)
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
