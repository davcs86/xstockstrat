package config

import (
	"testing"

	configv1 "github.com/xstockstrat/contracts/gen/go/config/v1"
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
	t.Setenv("MARKETDATA_ENDPOINT", "custom-marketdata:50053")

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
	if cfg.MarketDataEndpoint != "custom-marketdata:50053" {
		t.Errorf("MarketDataEndpoint override: got %q", cfg.MarketDataEndpoint)
	}
}

// newTestWatcher builds a Watcher with a pre-populated snapshot for unit tests.
// It does not start the watchLoop (no gRPC connection required).
func newTestWatcher(snap map[string]*configv1.ConfigValue) *Watcher {
	return &Watcher{
		snapshot: snap,
		ready:    make(chan struct{}),
	}
}

func TestWatcherGetString(t *testing.T) {
	w := newTestWatcher(map[string]*configv1.ConfigValue{
		"s": {Value: &configv1.ConfigValue_StringVal{StringVal: "hello"}},
		"i": {Value: &configv1.ConfigValue_IntVal{IntVal: 7}},
	})

	if got := w.GetString("s", "def"); got != "hello" {
		t.Errorf("GetString hit: got %q, want %q", got, "hello")
	}
	if got := w.GetString("missing", "def"); got != "def" {
		t.Errorf("GetString miss: got %q, want %q", got, "def")
	}
	// key exists but wrong type — should return default
	if got := w.GetString("i", "def"); got != "def" {
		t.Errorf("GetString type-mismatch: got %q, want %q", got, "def")
	}
}

func TestWatcherGetInt(t *testing.T) {
	w := newTestWatcher(map[string]*configv1.ConfigValue{
		"i": {Value: &configv1.ConfigValue_IntVal{IntVal: 42}},
		"s": {Value: &configv1.ConfigValue_StringVal{StringVal: "x"}},
	})

	if got := w.GetInt("i", 0); got != 42 {
		t.Errorf("GetInt hit: got %d, want 42", got)
	}
	if got := w.GetInt("missing", 99); got != 99 {
		t.Errorf("GetInt miss: got %d, want 99", got)
	}
	if got := w.GetInt("s", 99); got != 99 {
		t.Errorf("GetInt type-mismatch: got %d, want 99", got)
	}
}

func TestWatcherGetFloat(t *testing.T) {
	w := newTestWatcher(map[string]*configv1.ConfigValue{
		"f": {Value: &configv1.ConfigValue_FloatVal{FloatVal: 3.14}},
		"s": {Value: &configv1.ConfigValue_StringVal{StringVal: "x"}},
	})

	if got := w.GetFloat("f", 0); got != 3.14 {
		t.Errorf("GetFloat hit: got %f, want 3.14", got)
	}
	if got := w.GetFloat("missing", 1.1); got != 1.1 {
		t.Errorf("GetFloat miss: got %f, want 1.1", got)
	}
	if got := w.GetFloat("s", 1.1); got != 1.1 {
		t.Errorf("GetFloat type-mismatch: got %f, want 1.1", got)
	}
}

func TestWatcherGetBool(t *testing.T) {
	w := newTestWatcher(map[string]*configv1.ConfigValue{
		"b": {Value: &configv1.ConfigValue_BoolVal{BoolVal: true}},
		"s": {Value: &configv1.ConfigValue_StringVal{StringVal: "x"}},
	})

	if got := w.GetBool("b", false); !got {
		t.Errorf("GetBool hit: got false, want true")
	}
	if got := w.GetBool("missing", true); !got {
		t.Errorf("GetBool miss: got false, want true")
	}
	if got := w.GetBool("s", true); !got {
		t.Errorf("GetBool type-mismatch: got false, want true")
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
