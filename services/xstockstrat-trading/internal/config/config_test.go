package config

import (
	"context"
	"errors"
	"io"
	"testing"

	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	configv1 "github.com/xstockstrat/contracts/gen/go/config/v1"
)

// strVal / fltVal build a full-dotted-keyed ConfigValue the way the config server streams it.
func strVal(s string) *configv1.ConfigValue {
	return &configv1.ConfigValue{Value: &configv1.ConfigValue_StringVal{StringVal: s}}
}
func fltVal(f float64) *configv1.ConfigValue {
	return &configv1.ConfigValue{Value: &configv1.ConfigValue_FloatVal{FloatVal: f}}
}

// scriptedStream returns a queued list of snapshots, then io.EOF (so stream() returns). It embeds a
// nil grpc.ClientStream to satisfy the interface method set — stream() only ever calls Recv().
type scriptedStream struct {
	grpc.ClientStream
	snaps []*configv1.ConfigSnapshot
	i     int
}

func (s *scriptedStream) Recv() (*configv1.ConfigSnapshot, error) {
	if s.i >= len(s.snaps) {
		return nil, io.EOF
	}
	snap := s.snaps[s.i]
	s.i++
	return snap, nil
}

// streamingFake serves a per-namespace scripted WatchConfig stream (the delivery path the bug hid in;
// the base fake's WatchConfig panics). SetConfig/GetSecret ride through the embedded base.
type streamingFake struct {
	fakeConfigServiceClient
	streams map[string][]*configv1.ConfigSnapshot
}

func (f *streamingFake) WatchConfig(ctx context.Context, in *configv1.WatchConfigRequest, opts ...grpc.CallOption) (grpc.ServerStreamingClient[configv1.ConfigSnapshot], error) {
	return &scriptedStream{snaps: f.streams[in.Namespace]}, nil
}

func snapshot(ns string, values map[string]*configv1.ConfigValue) *configv1.ConfigSnapshot {
	return &configv1.ConfigSnapshot{Namespace: ns, UpdateType: configv1.ConfigUpdateType_CONFIG_UPDATE_TYPE_SNAPSHOT, Values: values}
}
func reload(ns string, values map[string]*configv1.ConfigValue) *configv1.ConfigSnapshot {
	return &configv1.ConfigSnapshot{Namespace: ns, UpdateType: configv1.ConfigUpdateType_CONFIG_UPDATE_TYPE_RELOAD, Values: values}
}

// newTestWatcher builds a Watcher wired to a streaming fake, subscribed to the given namespaces.
func newTestWatcher(streams map[string][]*configv1.ConfigSnapshot, namespaces ...string) *Watcher {
	pending := make(map[string]struct{}, len(namespaces))
	for _, ns := range namespaces {
		pending[ns] = struct{}{}
	}
	return &Watcher{
		namespaces: namespaces,
		client:     &streamingFake{streams: streams},
		snapshot:   make(map[string]*configv1.ConfigValue),
		pending:    pending,
		ready:      make(chan struct{}),
	}
}

// ── Read-path: getters resolve the full-dotted (server-shaped) keys ─────────────────────
// AC-2: currentTradingState reads platform.trading_state; AC-3: a trading.risk.* value is applied.
// Fixtures use the FULL-DOTTED key form the server streams post-029 — a bare-key override would mask
// exactly this class of bug (ledger fails.md:2005-2016).
func TestWatcher_GetString_ResolvesFullDottedPlatformTradingState(t *testing.T) {
	w := &Watcher{snapshot: map[string]*configv1.ConfigValue{"platform.trading_state": strVal("REDUCE_ONLY")}}
	if got := w.GetString("platform.trading_state", "HALTED"); got != "REDUCE_ONLY" {
		t.Errorf("GetString(platform.trading_state) = %q, want REDUCE_ONLY (AC-2); default HALTED means the key missed", got)
	}
}

func TestWatcher_GetFloat_ResolvesFullDottedTradingRiskKey(t *testing.T) {
	w := &Watcher{snapshot: map[string]*configv1.ConfigValue{"trading.risk.max_position_pct": fltVal(0.02)}}
	if got := w.GetFloat("trading.risk.max_position_pct", 0.05); got != 0.02 {
		t.Errorf("GetFloat(trading.risk.max_position_pct) = %v, want 0.02 (AC-3); default 0.05 means the key missed", got)
	}
}

// ── Delivery: both subscribed namespaces reach one snapshot ──────────────────────────────
func TestWatcher_MultiNamespaceDelivery(t *testing.T) {
	w := newTestWatcher(map[string][]*configv1.ConfigSnapshot{
		"platform": {snapshot("platform", map[string]*configv1.ConfigValue{"platform.trading_state": strVal("ACTIVE")})},
		"trading":  {snapshot("trading", map[string]*configv1.ConfigValue{"trading.risk.sizing_enabled": {Value: &configv1.ConfigValue_BoolVal{BoolVal: true}}})},
	}, "trading", "platform")
	_ = w.stream("platform")
	_ = w.stream("trading")
	if got := w.GetString("platform.trading_state", "HALTED"); got != "ACTIVE" {
		t.Errorf("after both streams, platform.trading_state = %q, want ACTIVE (platform namespace not delivered)", got)
	}
	if !w.GetBool("trading.risk.sizing_enabled", false) {
		t.Error("after both streams, trading.risk.sizing_enabled did not resolve")
	}
}

// ── Scoped-replace: a trading RELOAD must NOT wipe the platform.* keys (transient false HALTED) ──
func TestWatcher_ScopedReplace_TradingReloadDoesNotWipePlatform(t *testing.T) {
	w := newTestWatcher(map[string][]*configv1.ConfigSnapshot{
		"platform": {snapshot("platform", map[string]*configv1.ConfigValue{"platform.trading_state": strVal("ACTIVE")})},
		// A later trading RELOAD (fired on any trading.* SetConfig) carries only trading.* keys.
		"trading": {reload("trading", map[string]*configv1.ConfigValue{"trading.risk.max_position_pct": fltVal(0.02)})},
	}, "trading", "platform")
	_ = w.stream("platform")
	_ = w.stream("trading")
	if got := w.GetString("platform.trading_state", "HALTED"); got != "ACTIVE" {
		t.Errorf("platform.trading_state = %q after a trading RELOAD, want ACTIVE — the trading stream wiped platform.* (wholesale replace, not namespace-scoped)", got)
	}
}

// ── Per-namespace readiness latch: WaitForSnapshot blocks until ALL namespaces deliver ──────────
func TestWatcher_WaitForSnapshot_RequiresAllNamespaces(t *testing.T) {
	w := newTestWatcher(map[string][]*configv1.ConfigSnapshot{
		"platform": {snapshot("platform", map[string]*configv1.ConfigValue{"platform.trading_state": strVal("ACTIVE")})},
		"trading":  {snapshot("trading", map[string]*configv1.ConfigValue{"trading.risk.max_position_pct": fltVal(0.02)})},
	}, "trading", "platform")

	_ = w.stream("platform") // only one of two namespaces delivered
	select {
	case <-w.ready:
		t.Fatal("ready closed after only the platform namespace delivered — a single latch would serve a partial (HALTED-default) view as if live")
	default:
	}

	_ = w.stream("trading") // now both delivered
	select {
	case <-w.ready:
	default:
		t.Fatal("ready not closed after all subscribed namespaces delivered")
	}
}

func TestLoadFromEnv_Defaults(t *testing.T) {
	cfg := LoadFromEnv()

	if cfg.GRPCPort != "50051" {
		t.Errorf("GRPCPort default: got %q, want %q", cfg.GRPCPort, "50051")
	}
	if cfg.ConfigEndpoint != "xstockstrat-config:50060" {
		t.Errorf("ConfigEndpoint default: got %q", cfg.ConfigEndpoint)
	}
	if cfg.LedgerEndpoint != "xstockstrat-ledger:50057" {
		t.Errorf("LedgerEndpoint default: got %q", cfg.LedgerEndpoint)
	}
	if cfg.TradingMode != "paper" {
		t.Errorf("TradingMode default: got %q, want paper", cfg.TradingMode)
	}
	if cfg.ApplicationEnv != "development" {
		t.Errorf("ApplicationEnv default: got %q, want development", cfg.ApplicationEnv)
	}
}

func TestLoadFromEnv_Overrides(t *testing.T) {
	t.Setenv("GRPC_PORT", "50099")
	t.Setenv("TRADING_MODE", "live")
	t.Setenv("APPLICATION_ENV", "production")

	cfg := LoadFromEnv()

	if cfg.GRPCPort != "50099" {
		t.Errorf("GRPCPort override: got %q, want %q", cfg.GRPCPort, "50099")
	}
	if cfg.TradingMode != "live" {
		t.Errorf("TradingMode override: got %q", cfg.TradingMode)
	}
	if cfg.ApplicationEnv != "production" {
		t.Errorf("ApplicationEnv override: got %q", cfg.ApplicationEnv)
	}
}

// fakeConfigServiceClient implements configv1.ConfigServiceClient narrowly — only
// SetConfig is exercised by Watcher.SetConfig's tests below; every other method panics if
// called (feature 102 — mirrors 030's fakeBroker narrow-interface-fake technique).
type fakeConfigServiceClient struct {
	setConfigFn func(ctx context.Context, in *configv1.SetConfigRequest, opts ...grpc.CallOption) (*configv1.SetConfigResponse, error)
}

func (f *fakeConfigServiceClient) WatchConfig(ctx context.Context, in *configv1.WatchConfigRequest, opts ...grpc.CallOption) (grpc.ServerStreamingClient[configv1.ConfigSnapshot], error) {
	panic("fakeConfigServiceClient.WatchConfig not implemented")
}

func (f *fakeConfigServiceClient) GetConfig(ctx context.Context, in *configv1.GetConfigRequest, opts ...grpc.CallOption) (*configv1.ConfigSnapshot, error) {
	panic("fakeConfigServiceClient.GetConfig not implemented")
}

func (f *fakeConfigServiceClient) SetConfig(ctx context.Context, in *configv1.SetConfigRequest, opts ...grpc.CallOption) (*configv1.SetConfigResponse, error) {
	return f.setConfigFn(ctx, in, opts...)
}

func (f *fakeConfigServiceClient) ListKeys(ctx context.Context, in *configv1.ListKeysRequest, opts ...grpc.CallOption) (*configv1.ListKeysResponse, error) {
	panic("fakeConfigServiceClient.ListKeys not implemented")
}

func (f *fakeConfigServiceClient) GetSecret(ctx context.Context, in *configv1.GetSecretRequest, opts ...grpc.CallOption) (*configv1.GetSecretResponse, error) {
	return &configv1.GetSecretResponse{}, nil
}

var _ configv1.ConfigServiceClient = (*fakeConfigServiceClient)(nil)

func TestWatcher_SetConfig_AttachesMetadata(t *testing.T) {
	var capturedCallerID, capturedTraceID string
	var traceIDPresent bool
	fake := &fakeConfigServiceClient{
		setConfigFn: func(ctx context.Context, in *configv1.SetConfigRequest, opts ...grpc.CallOption) (*configv1.SetConfigResponse, error) {
			md, ok := metadata.FromOutgoingContext(ctx)
			if !ok {
				t.Fatal("expected outgoing metadata on the context")
			}
			if vals := md.Get("x-internal-caller"); len(vals) > 0 {
				capturedCallerID = vals[0]
			}
			if vals := md.Get("x-trace-id"); len(vals) > 0 {
				capturedTraceID = vals[0]
				traceIDPresent = true
			}
			return &configv1.SetConfigResponse{}, nil
		},
	}
	w := &Watcher{client: fake}

	_, err := w.SetConfig(context.Background(), "trading-reconciliation-poller", &configv1.SetConfigRequest{
		Namespace: "platform", Key: "trading_state",
	})
	if err != nil {
		t.Fatalf("SetConfig failed: %v", err)
	}
	if capturedCallerID != "trading-reconciliation-poller" {
		t.Errorf("x-internal-caller = %q, want %q", capturedCallerID, "trading-reconciliation-poller")
	}
	if !traceIDPresent || capturedTraceID == "" {
		t.Error("expected a non-empty x-trace-id on the outgoing context")
	}
}

func TestWatcher_SetConfig_ReturnsUnderlyingError(t *testing.T) {
	wantErr := errors.New("boom")
	fake := &fakeConfigServiceClient{
		setConfigFn: func(ctx context.Context, in *configv1.SetConfigRequest, opts ...grpc.CallOption) (*configv1.SetConfigResponse, error) {
			return nil, wantErr
		},
	}
	w := &Watcher{client: fake}

	_, err := w.SetConfig(context.Background(), "trading-reconciliation-poller", &configv1.SetConfigRequest{})
	if !errors.Is(err, wantErr) {
		t.Errorf("SetConfig error = %v, want %v (unwrapped passthrough)", err, wantErr)
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
