package main

import "testing"

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
