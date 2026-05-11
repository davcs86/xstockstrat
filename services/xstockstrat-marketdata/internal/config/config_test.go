package config

import (
	"testing"
)

func TestLoadFromEnv_Defaults(t *testing.T) {
	cfg := LoadFromEnv()

	if cfg.GRPCPort != "50053" {
		t.Errorf("GRPCPort default: got %q, want %q", cfg.GRPCPort, "50053")
	}
	if cfg.HTTPPort != "8053" {
		t.Errorf("HTTPPort default: got %q, want %q", cfg.HTTPPort, "8053")
	}
	if cfg.ConfigEndpoint != "xstockstrat-config:50060" {
		t.Errorf("ConfigEndpoint default: got %q", cfg.ConfigEndpoint)
	}
	if cfg.LedgerEndpoint != "xstockstrat-ledger:50057" {
		t.Errorf("LedgerEndpoint default: got %q", cfg.LedgerEndpoint)
	}
	if cfg.AlpacaBaseURL != "https://paper-api.alpaca.markets" {
		t.Errorf("AlpacaBaseURL default: got %q", cfg.AlpacaBaseURL)
	}
	if cfg.AlpacaDataURL != "https://data.alpaca.markets" {
		t.Errorf("AlpacaDataURL default: got %q", cfg.AlpacaDataURL)
	}
	if cfg.ApplicationEnv != "development" {
		t.Errorf("ApplicationEnv default: got %q, want development", cfg.ApplicationEnv)
	}
	if cfg.TradingMode != "paper" {
		t.Errorf("TradingMode default: got %q, want paper", cfg.TradingMode)
	}
}

func TestLoadFromEnv_Overrides(t *testing.T) {
	t.Setenv("GRPC_PORT", "50099")
	t.Setenv("HTTP_PORT", "8099")
	t.Setenv("APPLICATION_ENV", "production")
	t.Setenv("TRADING_MODE", "live")

	cfg := LoadFromEnv()

	if cfg.GRPCPort != "50099" {
		t.Errorf("GRPCPort override: got %q", cfg.GRPCPort)
	}
	if cfg.HTTPPort != "8099" {
		t.Errorf("HTTPPort override: got %q", cfg.HTTPPort)
	}
	if cfg.ApplicationEnv != "production" {
		t.Errorf("ApplicationEnv override: got %q", cfg.ApplicationEnv)
	}
	if cfg.TradingMode != "live" {
		t.Errorf("TradingMode override: got %q", cfg.TradingMode)
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
		t.Setenv("TEST_BOOL_MD", tt.envVal)
		got := getEnvBool("TEST_BOOL_MD", tt.fallback)
		if got != tt.want {
			t.Errorf("getEnvBool(%q, %v) = %v, want %v", tt.envVal, tt.fallback, got, tt.want)
		}
	}
}
