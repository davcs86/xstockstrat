package config

import (
	"context"
	"sync"
	"testing"

	configv1 "github.com/xstockstrat/contracts/gen/go/config/v1"
)

func TestLoadFromEnv_Defaults(t *testing.T) {
	cfg := LoadFromEnv()

	if cfg.GRPCPort != "50053" {
		t.Errorf("GRPCPort default: got %q, want %q", cfg.GRPCPort, "50053")
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
	t.Setenv("APPLICATION_ENV", "production")
	t.Setenv("TRADING_MODE", "live")

	cfg := LoadFromEnv()

	if cfg.GRPCPort != "50099" {
		t.Errorf("GRPCPort override: got %q", cfg.GRPCPort)
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

// newTestWatcher builds a Watcher with a pre-populated snapshot for unit tests.
// It bypasses NewWatcher (which dials gRPC) so no network is required.
func newTestWatcher(snapshot map[string]*configv1.ConfigValue) *Watcher {
	ready := make(chan struct{})
	close(ready)
	return &Watcher{
		snapshot: snapshot,
		ready:    ready,
		once:     sync.Once{},
	}
}

func TestWatcher_GetString(t *testing.T) {
	w := newTestWatcher(map[string]*configv1.ConfigValue{
		"my.key":  {Value: &configv1.ConfigValue_StringVal{StringVal: "hello"}},
		"int.key": {Value: &configv1.ConfigValue_IntVal{IntVal: 42}},
	})

	if got := w.GetString("my.key", "default"); got != "hello" {
		t.Errorf("GetString present: got %q, want %q", got, "hello")
	}
	if got := w.GetString("missing", "fallback"); got != "fallback" {
		t.Errorf("GetString missing: got %q, want %q", got, "fallback")
	}
	// Wrong type → default
	if got := w.GetString("int.key", "default"); got != "default" {
		t.Errorf("GetString wrong type: got %q, want %q", got, "default")
	}
}

func TestWatcher_GetInt(t *testing.T) {
	w := newTestWatcher(map[string]*configv1.ConfigValue{
		"my.int":  {Value: &configv1.ConfigValue_IntVal{IntVal: 99}},
		"str.key": {Value: &configv1.ConfigValue_StringVal{StringVal: "x"}},
	})

	if got := w.GetInt("my.int", 0); got != 99 {
		t.Errorf("GetInt present: got %d, want 99", got)
	}
	if got := w.GetInt("missing", 7); got != 7 {
		t.Errorf("GetInt missing: got %d, want 7", got)
	}
	// Wrong type → default
	if got := w.GetInt("str.key", 5); got != 5 {
		t.Errorf("GetInt wrong type: got %d, want 5", got)
	}
}

func TestWatcher_GetFloat(t *testing.T) {
	w := newTestWatcher(map[string]*configv1.ConfigValue{
		"my.float": {Value: &configv1.ConfigValue_FloatVal{FloatVal: 3.14}},
		"str.key":  {Value: &configv1.ConfigValue_StringVal{StringVal: "x"}},
	})

	if got := w.GetFloat("my.float", 0); got != 3.14 {
		t.Errorf("GetFloat present: got %f, want 3.14", got)
	}
	if got := w.GetFloat("missing", 1.5); got != 1.5 {
		t.Errorf("GetFloat missing: got %f, want 1.5", got)
	}
	// Wrong type → default
	if got := w.GetFloat("str.key", 2.0); got != 2.0 {
		t.Errorf("GetFloat wrong type: got %f, want 2.0", got)
	}
}

func TestWatcher_GetBool(t *testing.T) {
	w := newTestWatcher(map[string]*configv1.ConfigValue{
		"my.bool": {Value: &configv1.ConfigValue_BoolVal{BoolVal: true}},
		"str.key": {Value: &configv1.ConfigValue_StringVal{StringVal: "x"}},
	})

	if got := w.GetBool("my.bool", false); got != true {
		t.Errorf("GetBool present: got %v, want true", got)
	}
	if got := w.GetBool("missing", true); got != true {
		t.Errorf("GetBool missing: got %v, want true", got)
	}
	// Wrong type → default
	if got := w.GetBool("str.key", false); got != false {
		t.Errorf("GetBool wrong type: got %v, want false", got)
	}
}

func TestWatcher_WaitForSnapshot_AlreadyReady(t *testing.T) {
	w := newTestWatcher(nil)
	if err := w.WaitForSnapshot(context.Background()); err != nil {
		t.Errorf("expected nil error for already-ready watcher, got: %v", err)
	}
}

func TestWatcher_WaitForSnapshot_ContextCancelled(t *testing.T) {
	// Watcher whose ready channel is never closed.
	w := &Watcher{
		snapshot: make(map[string]*configv1.ConfigValue),
		ready:    make(chan struct{}),
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := w.WaitForSnapshot(ctx); err == nil {
		t.Error("expected error for cancelled context, got nil")
	}
}
