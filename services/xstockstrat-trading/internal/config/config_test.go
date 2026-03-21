package config

import (
	"testing"
)

func TestLoadFromEnv_Defaults(t *testing.T) {
	cfg := LoadFromEnv()

	if cfg.GRPCPort != "50051" {
		t.Errorf("GRPCPort default: got %q, want %q", cfg.GRPCPort, "50051")
	}
	if cfg.HTTPPort != "8051" {
		t.Errorf("HTTPPort default: got %q, want %q", cfg.HTTPPort, "8051")
	}
	if cfg.ConfigEndpoint != "xstockstrat-config:50060" {
		t.Errorf("ConfigEndpoint default: got %q", cfg.ConfigEndpoint)
	}
	if cfg.LedgerEndpoint != "xstockstrat-ledger:50057" {
		t.Errorf("LedgerEndpoint default: got %q", cfg.LedgerEndpoint)
	}
	if cfg.AlpacaPaperURL != "https://paper-api.alpaca.markets" {
		t.Errorf("AlpacaPaperURL default: got %q", cfg.AlpacaPaperURL)
	}
	if cfg.AlpacaLiveURL != "https://api.alpaca.markets" {
		t.Errorf("AlpacaLiveURL default: got %q", cfg.AlpacaLiveURL)
	}
	if !cfg.AlpacaPaper {
		t.Error("AlpacaPaper default: want true")
	}
}

func TestLoadFromEnv_Overrides(t *testing.T) {
	t.Setenv("GRPC_PORT", "50099")
	t.Setenv("HTTP_PORT", "8099")
	t.Setenv("ALPACA_PAPER", "false")
	t.Setenv("ALPACA_API_KEY", "test-key")
	t.Setenv("ALPACA_API_SECRET", "test-secret")

	cfg := LoadFromEnv()

	if cfg.GRPCPort != "50099" {
		t.Errorf("GRPCPort override: got %q, want %q", cfg.GRPCPort, "50099")
	}
	if cfg.HTTPPort != "8099" {
		t.Errorf("HTTPPort override: got %q, want %q", cfg.HTTPPort, "8099")
	}
	if cfg.AlpacaPaper {
		t.Error("AlpacaPaper override: want false")
	}
	if cfg.AlpacaAPIKey != "test-key" {
		t.Errorf("AlpacaAPIKey override: got %q", cfg.AlpacaAPIKey)
	}
	if cfg.AlpacaAPISecret != "test-secret" {
		t.Errorf("AlpacaAPISecret override: got %q", cfg.AlpacaAPISecret)
	}
}

func TestGetEnvBool(t *testing.T) {
	tests := []struct {
		envVal   string
		fallback bool
		want     bool
	}{
		{"true", false, true},
		{"1", false, true},
		{"yes", false, true},
		{"false", true, false},
		{"0", true, false},
		{"", true, true},
		{"", false, false},
	}

	for _, tt := range tests {
		t.Setenv("TEST_BOOL_KEY", tt.envVal)
		if tt.envVal == "" {
			// clear the env to test the fallback path
			t.Setenv("TEST_BOOL_KEY", "")
		}
		got := getEnvBool("TEST_BOOL_KEY", tt.fallback)
		if got != tt.want {
			t.Errorf("getEnvBool(%q, %v) = %v, want %v", tt.envVal, tt.fallback, got, tt.want)
		}
	}
}
