package config

import (
	"context"
	"log/slog"
	"sync"
	"testing"

	"google.golang.org/grpc"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	configv1 "github.com/xstockstrat/contracts/gen/go/config/v1"
)

func TestLoadFromEnv_Defaults(t *testing.T) {
	cfg := LoadFromEnv()

	if cfg.GRPCPort != "50052" {
		t.Errorf("GRPCPort default: got %q, want %q", cfg.GRPCPort, "50052")
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
	t.Setenv("APPLICATION_ENV", "production")
	t.Setenv("TRADING_MODE", "live")
	t.Setenv("MARKETDATA_ENDPOINT", "custom-marketdata:50053")

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
	if cfg.MarketDataEndpoint != "custom-marketdata:50053" {
		t.Errorf("MarketDataEndpoint override: got %q", cfg.MarketDataEndpoint)
	}
}

// idleClient opens WatchConfig streams that never deliver; tests feed values through ApplyUpdate.
type idleClient struct{ configv1.ConfigServiceClient }

type idleStream struct {
	grpc.ClientStream
	ctx context.Context
}

func (idleClient) WatchConfig(ctx context.Context, _ *configv1.WatchConfigRequest, _ ...grpc.CallOption) (grpc.ServerStreamingClient[configv1.ConfigSnapshot], error) {
	return &idleStream{ctx: ctx}, nil
}

func (s *idleStream) Recv() (*configv1.ConfigSnapshot, error) {
	<-s.ctx.Done()
	return nil, s.ctx.Err()
}

// newTestWatcher builds a Watcher through the core (no dial) and applies snap as its SNAPSHOT.
func newTestWatcher(snap map[string]*configv1.ConfigValue, opts ...Option) *Watcher {
	w := newWatcher(idleClient{}, "portfolio", commonv1.Environment_ENVIRONMENT_STAGING, opts...)
	w.ApplyUpdate("portfolio", &configv1.ConfigSnapshot{
		Namespace:  "portfolio",
		UpdateType: configv1.ConfigUpdateType_CONFIG_UPDATE_TYPE_SNAPSHOT,
		Values:     snap,
	})
	return w
}

// warnCounter counts the WARN records the watcher core emits through WithLogger.
type warnCounter struct {
	mu sync.Mutex
	n  int
}

func (c *warnCounter) Enabled(context.Context, slog.Level) bool { return true }
func (c *warnCounter) WithAttrs([]slog.Attr) slog.Handler       { return c }
func (c *warnCounter) WithGroup(string) slog.Handler            { return c }
func (c *warnCounter) Handle(_ context.Context, r slog.Record) error {
	if r.Level == slog.LevelWarn {
		c.mu.Lock()
		c.n++
		c.mu.Unlock()
	}
	return nil
}

// AC-27 (portfolio): an int-stored float key widens losslessly, with no WARN.
func TestWatcher_AC27_IntWidensToFloatWithoutWarn(t *testing.T) {
	warns := &warnCounter{}
	w := newTestWatcher(map[string]*configv1.ConfigValue{
		"portfolio.risk.max_drawdown_pct": {Value: &configv1.ConfigValue_IntVal{IntVal: 7}},
	}, WithLogger(slog.New(warns)))

	if got := w.GetFloat("portfolio.risk.max_drawdown_pct", 1.5); got != 7.0 {
		t.Errorf("GetFloat(portfolio.risk.max_drawdown_pct) = %v, want 7.0 (int 7 widened)", got)
	}
	warns.mu.Lock()
	defer warns.mu.Unlock()
	if warns.n != 0 {
		t.Errorf("%d WARN(s) logged, want none", warns.n)
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

// TestResolveEnvironment / TestResolveTradingMode guard the WatchConfig scope-omission fix:
// NewWatcher must resolve this deployment's own APPLICATION_ENV/TRADING_MODE into the proto
// scope it subscribes with, instead of leaving the request at its zero-value (dev/unspecified).
func TestResolveEnvironment(t *testing.T) {
	tests := []struct {
		in   string
		want commonv1.Environment
	}{
		{"production", commonv1.Environment_ENVIRONMENT_PRODUCTION},
		{"development", commonv1.Environment_ENVIRONMENT_STAGING},
		{"", commonv1.Environment_ENVIRONMENT_STAGING},
		{"staging", commonv1.Environment_ENVIRONMENT_STAGING},
	}
	for _, tt := range tests {
		if got := resolveEnvironment(tt.in); got != tt.want {
			t.Errorf("resolveEnvironment(%q) = %v, want %v", tt.in, got, tt.want)
		}
	}
}

func TestResolveTradingMode(t *testing.T) {
	tests := []struct {
		in   string
		want commonv1.TradingMode
	}{
		{"live", commonv1.TradingMode_TRADING_MODE_LIVE},
		{"paper", commonv1.TradingMode_TRADING_MODE_PAPER},
		{"", commonv1.TradingMode_TRADING_MODE_PAPER},
	}
	for _, tt := range tests {
		if got := resolveTradingMode(tt.in); got != tt.want {
			t.Errorf("resolveTradingMode(%q) = %v, want %v", tt.in, got, tt.want)
		}
	}
}
