package config

import (
	"testing"
)

func TestLoadFromEnv_Defaults(t *testing.T) {
	cfg := LoadFromEnv()

	if cfg.GRPCPort != "50052" {
		t.Errorf("GRPCPort default: got %q, want %q", cfg.GRPCPort, "50052")
	}
	if cfg.HTTPPort != "8052" {
		t.Errorf("HTTPPort default: got %q, want %q", cfg.HTTPPort, "8052")
	}
	if cfg.ConfigEndpoint != "xstockstrat-config:50060" {
		t.Errorf("ConfigEndpoint default: got %q", cfg.ConfigEndpoint)
	}
	if cfg.LedgerEndpoint != "xstockstrat-ledger:50057" {
		t.Errorf("LedgerEndpoint default: got %q", cfg.LedgerEndpoint)
	}
	if cfg.MarketDataEndpoint != "xstockstrat-marketdata:50053" {
		t.Errorf("MarketDataEndpoint default: got %q", cfg.MarketDataEndpoint)
	}
	if cfg.AppEnv != "dev" {
		t.Errorf("AppEnv default: got %q, want dev", cfg.AppEnv)
	}
	if cfg.TradingMode != "paper" {
		t.Errorf("TradingMode default: got %q, want paper", cfg.TradingMode)
	}
}

func TestLoadFromEnv_Overrides(t *testing.T) {
	t.Setenv("GRPC_PORT", "50099")
	t.Setenv("HTTP_PORT", "8099")
	t.Setenv("APP_ENV", "production")
	t.Setenv("TRADING_MODE", "live")
	t.Setenv("MARKETDATA_ENDPOINT", "custom-marketdata:50053")

	cfg := LoadFromEnv()

	if cfg.GRPCPort != "50099" {
		t.Errorf("GRPCPort override: got %q", cfg.GRPCPort)
	}
	if cfg.HTTPPort != "8099" {
		t.Errorf("HTTPPort override: got %q", cfg.HTTPPort)
	}
	if cfg.AppEnv != "production" {
		t.Errorf("AppEnv override: got %q", cfg.AppEnv)
	}
	if cfg.TradingMode != "live" {
		t.Errorf("TradingMode override: got %q", cfg.TradingMode)
	}
	if cfg.MarketDataEndpoint != "custom-marketdata:50053" {
		t.Errorf("MarketDataEndpoint override: got %q", cfg.MarketDataEndpoint)
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
		{"false", true, false},
		{"0", true, false},
		{"", true, true},
		{"", false, false},
		{"invalid", true, true}, // invalid value returns fallback
	}

	for _, tt := range tests {
		t.Setenv("TEST_BOOL_PF", tt.envVal)
		got := getEnvBool("TEST_BOOL_PF", tt.fallback)
		if got != tt.want {
			t.Errorf("getEnvBool(%q, %v) = %v, want %v", tt.envVal, tt.fallback, got, tt.want)
		}
	}
}
