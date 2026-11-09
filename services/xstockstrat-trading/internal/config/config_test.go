package config

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	configv1 "github.com/xstockstrat/contracts/gen/go/config/v1"
	"github.com/xstockstrat/trading/internal/testdata"
)

// strVal / fltVal build a full-dotted-keyed ConfigValue the way the config server streams it.
func strVal(s string) *configv1.ConfigValue {
	return &configv1.ConfigValue{Value: &configv1.ConfigValue_StringVal{StringVal: s}}
}
func fltVal(f float64) *configv1.ConfigValue {
	return &configv1.ConfigValue{Value: &configv1.ConfigValue_FloatVal{FloatVal: f}}
}

func intVal(i int64) *configv1.ConfigValue {
	return &configv1.ConfigValue{Value: &configv1.ConfigValue_IntVal{IntVal: i}}
}

const (
	brokerTimeoutKey = "broker.timeout_ms"
	brokerTimeoutFQN = "trading.broker.timeout_ms" // display text in the WARN (C-05)
)

// fakeClock drives the watcher core's backoff, liveness and coverage timers. Sleep advances time
// and returns at once; once parkAt (if set) is reached it parks forever.
type fakeClock struct {
	mu     sync.Mutex
	now    time.Time
	timers []*fakeTimer
	sleeps []time.Duration
	parkAt time.Duration
	parked chan struct{}
}

type fakeTimer struct {
	clk *fakeClock
	at  time.Time
	ch  chan time.Time
}

var fakeEpoch = time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

func newFakeClock() *fakeClock { return &fakeClock{now: fakeEpoch, parked: make(chan struct{})} }

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *fakeClock) NewTimer(d time.Duration) Timer {
	c.mu.Lock()
	defer c.mu.Unlock()
	t := &fakeTimer{clk: c, at: c.now.Add(d), ch: make(chan time.Time, 1)}
	c.timers = append(c.timers, t)
	return t
}

func (t *fakeTimer) C() <-chan time.Time { return t.ch }

func (t *fakeTimer) Stop() bool {
	t.clk.mu.Lock()
	defer t.clk.mu.Unlock()
	for i, x := range t.clk.timers {
		if x == t {
			t.clk.timers = append(t.clk.timers[:i], t.clk.timers[i+1:]...)
			return true
		}
	}
	return false
}

func (c *fakeClock) Sleep(d time.Duration) {
	c.mu.Lock()
	c.sleeps = append(c.sleeps, d)
	c.mu.Unlock()
	c.Advance(d)
	if c.parkAt > 0 && c.Now().Sub(fakeEpoch) >= c.parkAt {
		close(c.parked)
		select {}
	}
}

func (c *fakeClock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(d)
	var keep []*fakeTimer
	for _, t := range c.timers {
		if t.at.After(c.now) {
			keep = append(keep, t)
			continue
		}
		t.ch <- c.now
	}
	c.timers = keep
}

// waitTimer blocks until a pending timer is due exactly d from now.
func (c *fakeClock) waitTimer(t *testing.T, d time.Duration) {
	t.Helper()
	eventually(t, fmt.Sprintf("a pending %v timer", d), func() bool {
		c.mu.Lock()
		defer c.mu.Unlock()
		for _, x := range c.timers {
			if x.at.Sub(c.now) == d {
				return true
			}
		}
		return false
	})
}

func eventually(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(2 * time.Millisecond)
	}
}

// stallClient serves scripts[ns][n] on the n-th WatchConfig for ns, then blocks Recv until the
// stream ctx is cancelled (a silently stalled stream); with eof set, each stream ends instead.
type stallClient struct {
	configv1.ConfigServiceClient
	clk     *fakeClock
	scripts map[string][][]*configv1.ConfigSnapshot
	gates   map[string]chan struct{} // "<ns>#<n>": the n-th open blocks until it is closed
	eof     bool

	mu    sync.Mutex
	calls []stallCall
}

type stallCall struct {
	ns  string
	ctx context.Context
	at  time.Time
}

func (f *stallClient) WatchConfig(ctx context.Context, in *configv1.WatchConfigRequest, _ ...grpc.CallOption) (grpc.ServerStreamingClient[configv1.ConfigSnapshot], error) {
	f.mu.Lock()
	n := 0
	for _, c := range f.calls {
		if c.ns == in.Namespace {
			n++
		}
	}
	f.calls = append(f.calls, stallCall{ns: in.Namespace, ctx: ctx, at: f.clk.Now()})
	gate := f.gates[fmt.Sprintf("%s#%d", in.Namespace, n)]
	var script []*configv1.ConfigSnapshot
	if n < len(f.scripts[in.Namespace]) {
		script = f.scripts[in.Namespace][n]
	}
	f.mu.Unlock()
	if gate != nil {
		<-gate
	}
	return &stallStream{ctx: ctx, snaps: script, eof: f.eof}, nil
}

func (f *stallClient) callsFor(ns string) []stallCall {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []stallCall
	for _, c := range f.calls {
		if c.ns == ns {
			out = append(out, c)
		}
	}
	return out
}

type stallStream struct {
	grpc.ClientStream
	ctx   context.Context
	snaps []*configv1.ConfigSnapshot
	i     int
	eof   bool
}

func (s *stallStream) Recv() (*configv1.ConfigSnapshot, error) {
	if s.i < len(s.snaps) {
		s.i++
		return s.snaps[s.i-1], nil
	}
	if s.eof {
		return nil, io.EOF
	}
	<-s.ctx.Done()
	return nil, s.ctx.Err()
}

func snapshot(ns string, values map[string]*configv1.ConfigValue) *configv1.ConfigSnapshot {
	return &configv1.ConfigSnapshot{Namespace: ns, UpdateType: configv1.ConfigUpdateType_CONFIG_UPDATE_TYPE_SNAPSHOT, Values: values}
}

// logCapture records every slog record the watcher core emits through WithLogger.
type logCapture struct {
	mu   sync.Mutex
	recs []capturedLog
}

type capturedLog struct {
	level slog.Level
	msg   string
	attrs map[string]string
}

type captureHandler struct {
	c     *logCapture
	attrs []slog.Attr
}

func (h *captureHandler) Enabled(context.Context, slog.Level) bool { return true }

func (h *captureHandler) WithAttrs(as []slog.Attr) slog.Handler {
	return &captureHandler{c: h.c, attrs: append(append([]slog.Attr{}, h.attrs...), as...)}
}

func (h *captureHandler) WithGroup(string) slog.Handler { return h }

func (h *captureHandler) Handle(_ context.Context, r slog.Record) error {
	rec := capturedLog{level: r.Level, msg: r.Message, attrs: map[string]string{}}
	for _, a := range h.attrs {
		rec.attrs[a.Key] = a.Value.String()
	}
	r.Attrs(func(a slog.Attr) bool {
		rec.attrs[a.Key] = a.Value.String()
		return true
	})
	h.c.mu.Lock()
	h.c.recs = append(h.c.recs, rec)
	h.c.mu.Unlock()
	return nil
}

func (c *logCapture) logger() *slog.Logger { return slog.New(&captureHandler{c: c}) }

// count returns the records at level with message msg whose attrs include every pair in want.
func (c *logCapture) count(level slog.Level, msg string, want map[string]string) int {
	c.mu.Lock()
	defer c.mu.Unlock()
	n := 0
outer:
	for _, r := range c.recs {
		if r.level != level || r.msg != msg {
			continue
		}
		for k, v := range want {
			if r.attrs[k] != v {
				continue outer
			}
		}
		n++
	}
	return n
}

// warnsNaming counts all WARN records, and those whose message or an attr value contains fqn.
func (c *logCapture) warnsNaming(fqn string) (naming, total int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, r := range c.recs {
		if r.level != slog.LevelWarn {
			continue
		}
		total++
		hit := strings.Contains(r.msg, fqn)
		for _, v := range r.attrs {
			hit = hit || strings.Contains(v, fqn)
		}
		if hit {
			naming++
		}
	}
	return naming, total
}

// startWatcher builds a watcher on the fake client and clock through the core's options (no dial).
func startWatcher(f *stallClient, logs *logCapture, namespaces ...string) *Watcher {
	if f.clk == nil {
		f.clk = newFakeClock()
	}
	if logs == nil {
		logs = &logCapture{}
	}
	return newWatcher(f, commonv1.Environment_ENVIRONMENT_STAGING, namespaces, WithClock(f.clk), WithLogger(logs.logger()))
}

func waitReady(t *testing.T, w *Watcher) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := w.WaitForSnapshot(ctx); err != nil {
		t.Fatalf("WaitForSnapshot: %v", err)
	}
}

// ── Read-path: getters resolve the full-dotted (server-shaped) keys ─────────────────────
// AC-2: currentTradingState reads platform.trading_state; AC-3: a trading.risk.* value is applied.
func TestWatcher_GetString_ResolvesFullDottedPlatformTradingState(t *testing.T) {
	w := MustSnapshotWatcher("platform", map[string]*configv1.ConfigValue{"trading_state": strVal("REDUCE_ONLY")})
	if got := w.GetString("trading_state", "HALTED"); got != "REDUCE_ONLY" {
		t.Errorf("GetString(trading_state) = %q, want REDUCE_ONLY (AC-2); default HALTED means the key missed", got)
	}
}

func TestWatcher_GetFloat_ResolvesFullDottedTradingRiskKey(t *testing.T) {
	w := MustSnapshotWatcher("trading", map[string]*configv1.ConfigValue{"risk.max_position_pct": fltVal(0.02)})
	if got := w.GetFloat("risk.max_position_pct", 0.05); got != 0.02 {
		t.Errorf("GetFloat(risk.max_position_pct) = %v, want 0.02 (AC-3); default 0.05 means the key missed", got)
	}
}

// ── Delivery: both subscribed namespaces reach the getters ───────────────────────────────
func TestWatcher_MultiNamespaceDelivery(t *testing.T) {
	f := &stallClient{scripts: map[string][][]*configv1.ConfigSnapshot{
		"platform": {{snapshot("platform", map[string]*configv1.ConfigValue{"trading_state": strVal("ACTIVE")})}},
		"trading":  {{snapshot("trading", map[string]*configv1.ConfigValue{"risk.sizing_enabled": {Value: &configv1.ConfigValue_BoolVal{BoolVal: true}}})}},
	}}
	w := startWatcher(f, nil, "trading", "platform")
	waitReady(t, w)
	if got := w.GetString("trading_state", "HALTED"); got != "ACTIVE" {
		t.Errorf("after both streams, platform.trading_state = %q, want ACTIVE (platform namespace not delivered)", got)
	}
	if !w.GetBool("risk.sizing_enabled", false) {
		t.Error("after both streams, trading.risk.sizing_enabled did not resolve")
	}
}

// ── Per-namespace maps: a platform SNAPSHOT never deletes trading keys ───────────────────
func TestWatcher_PlatformSnapshotDoesNotDeleteTradingKeys(t *testing.T) {
	f := &stallClient{scripts: map[string][][]*configv1.ConfigSnapshot{
		"platform": {{snapshot("platform", map[string]*configv1.ConfigValue{"trading_state": strVal("ACTIVE")})}},
		"trading":  {{snapshot("trading", map[string]*configv1.ConfigValue{brokerTimeoutKey: intVal(7000)})}},
	}}
	w := startWatcher(f, nil, "trading", "platform")
	waitReady(t, w)
	w.ApplyUpdate("platform", snapshot("platform", map[string]*configv1.ConfigValue{"trading_state": strVal("REDUCE_ONLY")}))
	if got := w.GetInt(brokerTimeoutKey, 5000); got != 7000 {
		t.Errorf("%s = %d after a platform SNAPSHOT, want 7000 — the platform stream replaced the trading map", brokerTimeoutKey, got)
	}
	if got := w.GetString("trading_state", "HALTED"); got != "REDUCE_ONLY" {
		t.Errorf("platform.trading_state = %q, want REDUCE_ONLY (platform SNAPSHOT not applied)", got)
	}
}

// ── Per-namespace readiness latch: WaitForSnapshot blocks until ALL namespaces deliver ──────────
func TestWatcher_WaitForSnapshot_RequiresAllNamespaces(t *testing.T) {
	gate := make(chan struct{})
	f := &stallClient{
		scripts: map[string][][]*configv1.ConfigSnapshot{
			"platform": {{snapshot("platform", map[string]*configv1.ConfigValue{"trading_state": strVal("ACTIVE")})}},
			"trading":  {{snapshot("trading", map[string]*configv1.ConfigValue{"risk.max_position_pct": fltVal(0.02)})}},
		},
		gates: map[string]chan struct{}{"trading#0": gate},
	}
	w := startWatcher(f, nil, "trading", "platform")
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	if err := w.WaitForSnapshot(ctx); err == nil {
		t.Fatal("WaitForSnapshot returned after only the platform namespace delivered — a single latch would serve a partial (HALTED-default) view as if live")
	}
	close(gate)
	waitReady(t, w)
}

// ── AC-10 (trading): a silently stalled stream is abandoned at the 30 s liveness deadline ────────
func TestWatcher_AC10_StalledStreamRedialsAfterLivenessDeadline(t *testing.T) {
	gate := make(chan struct{})
	f := &stallClient{
		scripts: map[string][][]*configv1.ConfigSnapshot{"trading": {
			{snapshot("trading", map[string]*configv1.ConfigValue{brokerTimeoutKey: intVal(7000)})},
			{snapshot("trading", map[string]*configv1.ConfigValue{brokerTimeoutKey: intVal(9000)})},
		}},
		gates: map[string]chan struct{}{"trading#1": gate},
	}
	w := startWatcher(f, nil, "trading")
	waitReady(t, w)
	f.clk.waitTimer(t, 30*time.Second)

	f.clk.Advance(29 * time.Second)
	time.Sleep(50 * time.Millisecond)
	first := f.callsFor("trading")[0]
	if first.ctx.Err() != nil || len(f.callsFor("trading")) != 1 {
		t.Fatal("the stream was abandoned before the 30 s liveness deadline")
	}

	f.clk.Advance(time.Second)
	eventually(t, "the stalled stream's ctx to be cancelled", func() bool { return first.ctx.Err() != nil })
	eventually(t, "a redial", func() bool { return len(f.callsFor("trading")) == 2 })
	if got := w.GetInt(brokerTimeoutKey, 5000); got != 7000 {
		t.Errorf("while redialling %s = %d, want the last snapshot's 7000", brokerTimeoutKey, got)
	}
	close(gate)
	eventually(t, "the post-redial value 9000", func() bool { return w.GetInt(brokerTimeoutKey, 5000) == 9000 })
}

// ── AC-11: snapshot-then-EOF never resets the backoff, so ≤5 opens in 10 s ───────────────────────
func TestWatcher_AC11_CleanEOFBacksOffWithoutReset(t *testing.T) {
	clk := newFakeClock()
	clk.parkAt = 10 * time.Second
	snap := []*configv1.ConfigSnapshot{snapshot("trading", map[string]*configv1.ConfigValue{brokerTimeoutKey: intVal(7000)})}
	f := &stallClient{clk: clk, eof: true, scripts: map[string][][]*configv1.ConfigSnapshot{"trading": {snap, snap, snap, snap, snap, snap, snap, snap}}}
	startWatcher(f, nil, "trading")
	select {
	case <-clk.parked:
	case <-time.After(5 * time.Second):
		t.Fatal("the watcher never slept past 10 s of fake time — the backoff is not on the injected clock")
	}
	if opens := len(f.callsFor("trading")); opens > 5 || opens < 2 {
		t.Errorf("%d stream opens in 10 s of fake time, want 2..5", opens)
	}
	clk.mu.Lock()
	sleeps := append([]time.Duration{}, clk.sleeps...)
	clk.mu.Unlock()
	for i, d := range sleeps {
		if d <= 0 {
			t.Errorf("delay %d = %v after a clean EOF, want > 0", i, d)
		}
		if i > 0 && d < sleeps[i-1] {
			t.Errorf("delays %v decrease at %d — the backoff reset on a stream healthy < 15 s", sleeps, i)
		}
	}
}

// ── AC-12 (trading): the uniform getter rule (FR-11) ──────────────────────────────────────────────
func TestWatcher_AC12_UniformGetterRule(t *testing.T) {
	readInt := func(w *Watcher) float64 { return float64(w.GetInt(brokerTimeoutKey, 5000)) }
	cases := []struct {
		name   string
		stored *configv1.ConfigValue
		read   func(w *Watcher) float64
		want   float64
		warn   bool
	}{
		{"int 7000 via float", intVal(7000), func(w *Watcher) float64 { return w.GetFloat(brokerTimeoutKey, 5000) }, 7000, false},
		{"float 7000.5 via int", fltVal(7000.5), readInt, 5000, true},
		{"string 7000 via int", strVal("7000"), readInt, 5000, true},
		{"absent via int", nil, readInt, 5000, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			values := map[string]*configv1.ConfigValue{"risk.max_position_pct": fltVal(0.02)}
			if tc.stored != nil {
				values[brokerTimeoutKey] = tc.stored
			}
			logs := &logCapture{}
			w := startWatcher(&stallClient{scripts: map[string][][]*configv1.ConfigSnapshot{"trading": {{snapshot("trading", values)}}}}, logs, "trading")
			waitReady(t, w)
			if got := tc.read(w); got != tc.want {
				t.Errorf("result = %v, want %v", got, tc.want)
			}
			naming, total := logs.warnsNaming(brokerTimeoutFQN)
			if tc.warn && naming == 0 {
				t.Errorf("no WARN naming %q was logged", brokerTimeoutFQN)
			}
			if !tc.warn && total != 0 {
				t.Errorf("%d WARN(s) logged, want none (int→float widens losslessly)", total)
			}
		})
	}
}

// ── FR-6 read-key evidence: read_key once per key; read_coverage + re-emit at the 6 h tick ────────
func TestWatcher_ReadKeyEvidenceAndCoverageTick(t *testing.T) {
	logs := &logCapture{}
	f := &stallClient{scripts: map[string][][]*configv1.ConfigSnapshot{"trading": {{snapshot("trading", map[string]*configv1.ConfigValue{brokerTimeoutKey: intVal(7000)})}}}}
	w := startWatcher(f, logs, "trading")
	waitReady(t, w)
	readKey := map[string]string{"ns": "trading", "key": brokerTimeoutKey}
	coverage := map[string]string{"ns": "trading"}
	eventually(t, "the first-snapshot read_coverage line", func() bool {
		return logs.count(slog.LevelInfo, "config.read_coverage", coverage) == 1
	})

	w.GetInt(brokerTimeoutKey, 5000)
	w.GetInt(brokerTimeoutKey, 5000)
	if n := logs.count(slog.LevelInfo, "config.read_key", readKey); n != 1 {
		t.Fatalf("%d config.read_key lines after two reads of one key, want 1", n)
	}

	f.clk.waitTimer(t, 6*time.Hour)
	f.clk.Advance(6 * time.Hour)
	eventually(t, "one read_coverage line and a read_key re-emit at the tick", func() bool {
		return logs.count(slog.LevelInfo, "config.read_coverage", coverage) == 2 &&
			logs.count(slog.LevelInfo, "config.read_key", readKey) == 2
	})
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

	_, err := w.SetConfig(context.Background(), testdata.ReconciliationPollerCallerID, &configv1.SetConfigRequest{
		Namespace: "platform", Key: "trading_state",
	})
	if err != nil {
		t.Fatalf("SetConfig failed: %v", err)
	}
	if capturedCallerID != testdata.ReconciliationPollerCallerID {
		t.Errorf("x-internal-caller = %q, want %q", capturedCallerID, testdata.ReconciliationPollerCallerID)
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

	_, err := w.SetConfig(context.Background(), testdata.ReconciliationPollerCallerID, &configv1.SetConfigRequest{})
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

// @AC-17 (feature 304): the trading snapshot double rejects a namespace-prefixed key in either
// namespace (a stale "platform.trading_state" fixture would otherwise read the HALTED default).
func TestMustSnapshotWatcher_RejectsNamespacePrefixedKey_AC17(t *testing.T) {
	for _, tc := range []struct{ ns, bad string }{
		{"trading", "trading.any.key"},
		{"trading", "platform.any.key"},
		{"platform", "platform.any.key"},
	} {
		t.Run(tc.ns+"/"+tc.bad, func(t *testing.T) {
			func() {
				defer func() {
					msg, _ := recover().(string)
					if !strings.Contains(msg, tc.bad) || !strings.Contains(msg, `"any.key"`) {
						t.Errorf("panic %q must name the prefixed and relative key", msg)
					}
				}()
				MustSnapshotWatcher(tc.ns, map[string]*configv1.ConfigValue{tc.bad: intVal(7)})
			}()
			w := MustSnapshotWatcher(tc.ns, map[string]*configv1.ConfigValue{"any.key": intVal(7)})
			if got := w.GetInt("any.key", 0); got != 7 {
				t.Errorf("GetInt(any.key) = %d, want 7", got)
			}
		})
	}
}
