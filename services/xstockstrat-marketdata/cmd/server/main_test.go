package main

import (
	"testing"

	"github.com/xstockstrat/marketdata/internal/config"
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

// TestNewFundamentalsSource_AlwaysNonNil is a regression canary (feature 082): the
// extracted constructor must return non-nil regardless of apiKey/config state — there
// is no "enabled" axis left to vary at this call site. A zero-value *config.Watcher is
// safe here: GetString touches only w.mu (usable zero-value sync.RWMutex) and
// w.snapshot (nil-map read returns ok=false) — see internal/config/config.go:100-153.
func TestNewFundamentalsSource_AlwaysNonNil(t *testing.T) {
	cfgWatcher := &config.Watcher{}
	for _, apiKey := range []string{"", "real-fmp-key"} {
		src := newFundamentalsSource(cfgWatcher, apiKey)
		if src == nil {
			t.Fatalf("newFundamentalsSource(%q) returned nil; must always be non-nil", apiKey)
		}
	}
}
