package config

// Byte-identical in xstockstrat-{trading,portfolio,marketdata}/internal/config; edit all three
// together (scripts/check-watcher-copies.sh fails CI on drift).

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"sort"
	"strings"
	"sync"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/keepalive"

	configv1 "github.com/xstockstrat/contracts/gen/go/config/v1"
)

// Fixed invariant (F-07): config cannot configure its own channel, so this is not a config key.
// Matches the servers' keepalive enforcement (30 s / 10 s, pings allowed without a stream).
var watchKeepalive = grpc.WithKeepaliveParams(keepalive.ClientParameters{
	Time:                30 * time.Second,
	Timeout:             10 * time.Second,
	PermitWithoutStream: true,
})

const (
	// Fixed invariant (F-07): a stream silent this long is cancelled and redialled; the config
	// server's periodic re-send keeps a healthy stream under it.
	livenessDeadline = 30 * time.Second
	// Fixed invariant (F-07): first reconnect backoff base; doubles per failure up to backoffMax.
	backoffInitial = 1 * time.Second
	// Fixed invariant (F-07): reconnect backoff ceiling.
	backoffMax = 30 * time.Second
	// Fixed invariant (F-07): the backoff resets only after a stream delivered for at least half
	// the liveness deadline, so a snapshot-then-EOF server never resets it (AC-11).
	backoffResetAfter = livenessDeadline / 2
	// Fixed invariant (F-07): READ_COVERAGE_INTERVAL_S=21600 — the FR-6 coverage tick that also
	// re-emits config.read_key for every key read so far.
	readCoverageInterval = 21600 * time.Second
	// Fixed invariant (F-07): at most one FR-11 WARN per FQN and reason in this window.
	warnInterval = 5 * time.Minute
	// Fixed invariant (F-07): WaitForSnapshot gives up after this long (config startup readiness).
	snapshotWaitTimeout = 90 * time.Second
)

// Clock is the time source of the watcher core; tests inject a fake through WithClock.
type Clock interface {
	Now() time.Time
	Sleep(d time.Duration)
	NewTimer(d time.Duration) Timer
}

// Timer is the subset of *time.Timer the core uses.
type Timer interface {
	C() <-chan time.Time
	Stop() bool
}

type realClock struct{}

func (realClock) Now() time.Time                 { return time.Now() }
func (realClock) Sleep(d time.Duration)          { time.Sleep(d) }
func (realClock) NewTimer(d time.Duration) Timer { return realTimer{time.NewTimer(d)} }

type realTimer struct{ t *time.Timer }

func (r realTimer) C() <-chan time.Time { return r.t.C }
func (r realTimer) Stop() bool          { return r.t.Stop() }

// Option configures the watcher core.
type Option func(*watchCore)

// WithClock replaces the real clock.
func WithClock(c Clock) Option { return func(w *watchCore) { w.clk = c } }

// WithLogger routes every core log line through l instead of slog.Default().
func WithLogger(l *slog.Logger) Option { return func(w *watchCore) { w.log = l } }

type openStream func(ctx context.Context, ns string) (grpc.ServerStreamingClient[configv1.ConfigSnapshot], error)

// watchCore holds one value map per namespace. Its zero value serves code defaults and never
// becomes ready, which callers' tests rely on.
type watchCore struct {
	mu         sync.RWMutex
	namespaces []string
	maps       map[string]map[string]*configv1.ConfigValue
	pending    map[string]struct{}
	covered    map[string]bool
	ready      chan struct{}
	readyOnce  sync.Once
	hooks      []func(ns, version string)
	clk        Clock
	log        *slog.Logger
	open       openStream

	evMu     sync.Mutex
	readKeys map[string]map[string]struct{}
	warnedAt map[string]time.Time
}

func (c *watchCore) clock() Clock {
	if c.clk == nil {
		return realClock{}
	}
	return c.clk
}

func (c *watchCore) logger() *slog.Logger {
	if c.log == nil {
		return slog.Default()
	}
	return c.log
}

// start subscribes to namespaces through open and starts one watch loop per namespace.
func (c *watchCore) start(namespaces []string, open openStream, opts ...Option) {
	for _, o := range opts {
		o(c)
	}
	c.mu.Lock()
	c.namespaces = append([]string(nil), namespaces...)
	c.pending = make(map[string]struct{}, len(namespaces))
	for _, ns := range namespaces {
		c.pending[ns] = struct{}{}
	}
	if c.ready == nil {
		c.ready = make(chan struct{})
	}
	c.open = open
	c.mu.Unlock()
	for _, ns := range namespaces {
		go c.watchLoop(ns)
	}
	go c.coverageLoop()
}

// OnChange registers fn, called after every applied update with its namespace and version.
func (c *watchCore) OnChange(fn func(ns, version string)) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.hooks = append(c.hooks, fn)
}

// ApplyUpdate applies one received message for ns, exactly as the stream loop does.
func (c *watchCore) ApplyUpdate(ns string, upd *configv1.ConfigSnapshot) {
	c.mu.Lock()
	if c.maps == nil {
		c.maps = make(map[string]map[string]*configv1.ConfigValue)
	}
	if c.covered == nil {
		c.covered = make(map[string]bool)
	}
	if c.ready == nil {
		c.ready = make(chan struct{})
	}
	known := false
	for _, n := range c.namespaces {
		known = known || n == ns
	}
	if !known {
		c.namespaces = append(c.namespaces, ns)
	}
	m := c.maps[ns]
	if m == nil || upd.GetUpdateType() == configv1.ConfigUpdateType_CONFIG_UPDATE_TYPE_SNAPSHOT ||
		upd.GetUpdateType() == configv1.ConfigUpdateType_CONFIG_UPDATE_TYPE_RELOAD {
		m = make(map[string]*configv1.ConfigValue, len(upd.GetValues()))
	}
	for k, v := range upd.GetValues() {
		m[k] = v
	}
	c.maps[ns] = m
	delete(c.pending, ns)
	first := !c.covered[ns]
	c.covered[ns] = true
	allReady := len(c.pending) == 0
	ready := c.ready
	hooks := append([]func(ns, version string){}, c.hooks...)
	c.mu.Unlock()

	if first {
		c.logCoverage(ns, false)
	}
	if allReady {
		c.readyOnce.Do(func() { close(ready) })
	}
	c.logger().Debug("config snapshot received", "namespace", ns, "update_type", upd.GetUpdateType())
	for _, h := range hooks {
		h(ns, upd.GetVersion())
	}
}

// WaitForSnapshot blocks until every subscribed namespace has delivered its first snapshot.
func (c *watchCore) WaitForSnapshot(ctx context.Context) error {
	c.mu.RLock()
	ready := c.ready
	c.mu.RUnlock()
	select {
	case <-ready:
		return nil
	case <-ctx.Done():
		return fmt.Errorf("config snapshot timeout: %w", ctx.Err())
	case <-time.After(snapshotWaitTimeout):
		return fmt.Errorf("config snapshot timeout: %v elapsed", snapshotWaitTimeout)
	}
}

func (c *watchCore) watchLoop(ns string) {
	base := backoffInitial
	for {
		healthy, err := c.streamOnce(ns)
		if healthy >= backoffResetAfter {
			base = backoffInitial
		}
		// Equal jitter: a delay in [base/2, base].
		delay := base/2 + rand.N(base/2+1)
		c.logger().Warn("config watcher stream ended, reconnecting", "namespace", ns, "error", err, "backoff", delay)
		c.clock().Sleep(delay)
		if base *= 2; base > backoffMax {
			base = backoffMax
		}
	}
}

type recvResult struct {
	snap *configv1.ConfigSnapshot
	err  error
}

// streamOnce runs one stream until it fails, ends or misses the liveness deadline, and returns
// how long it delivered (open to last message).
func (c *watchCore) streamOnce(ns string) (time.Duration, error) {
	clk := c.clock()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	opened := clk.Now()
	st, err := c.open(ctx, ns)
	if err != nil {
		return 0, fmt.Errorf("WatchConfig: %w", err)
	}
	msgs := make(chan recvResult)
	go func() {
		for {
			snap, err := st.Recv()
			select {
			case msgs <- recvResult{snap, err}:
			case <-ctx.Done():
				return
			}
			if err != nil {
				return
			}
		}
	}()
	var healthy time.Duration
	timer := clk.NewTimer(livenessDeadline)
	defer func() { timer.Stop() }()
	for {
		select {
		case r := <-msgs:
			if r.err != nil {
				return healthy, fmt.Errorf("stream.Recv: %w", r.err)
			}
			timer.Stop()
			timer = clk.NewTimer(livenessDeadline)
			healthy = clk.Now().Sub(opened)
			c.ApplyUpdate(ns, r.snap)
		case <-timer.C():
			cancel()
			return healthy, errors.New("no message within the liveness deadline")
		}
	}
}

func (c *watchCore) coverageLoop() {
	for {
		t := c.clock().NewTimer(readCoverageInterval)
		<-t.C()
		c.mu.RLock()
		namespaces := append([]string(nil), c.namespaces...)
		c.mu.RUnlock()
		for _, ns := range namespaces {
			c.logCoverage(ns, true)
		}
	}
}

// logCoverage emits config.read_coverage for ns and, at a tick, re-emits its read keys (FR-6).
func (c *watchCore) logCoverage(ns string, reemit bool) {
	c.evMu.Lock()
	keys := make([]string, 0, len(c.readKeys[ns]))
	for k := range c.readKeys[ns] {
		keys = append(keys, k)
	}
	c.evMu.Unlock()
	sort.Strings(keys)
	c.logger().Info("config.read_coverage", "ns", ns, "keys", len(keys))
	if reemit {
		for _, k := range keys {
			c.logger().Info("config.read_key", "ns", ns, "key", k)
		}
	}
}

func (c *watchCore) recordRead(ns, key string) {
	c.evMu.Lock()
	if c.readKeys == nil {
		c.readKeys = make(map[string]map[string]struct{})
	}
	set := c.readKeys[ns]
	if set == nil {
		set = make(map[string]struct{})
		c.readKeys[ns] = set
	}
	_, seen := set[key]
	set[key] = struct{}{}
	c.evMu.Unlock()
	if !seen {
		c.logger().Info("config.read_key", "ns", ns, "key", key)
	}
}

func fqn(ns, key string) string {
	if ns == "" || strings.HasPrefix(key, ns+".") {
		return key
	}
	return ns + "." + key
}

func (c *watchCore) warn(ns, key, reason string, attrs ...any) {
	name := fqn(ns, key)
	now := c.clock().Now()
	c.evMu.Lock()
	if c.warnedAt == nil {
		c.warnedAt = make(map[string]time.Time)
	}
	last, ok := c.warnedAt[name+"|"+reason]
	if ok && now.Sub(last) < warnInterval {
		c.evMu.Unlock()
		return
	}
	c.warnedAt[name+"|"+reason] = now
	c.evMu.Unlock()
	c.logger().Warn("config value "+reason+"; using the code default", append([]any{"fqn", name}, attrs...)...)
}

// lookup finds key in the namespace maps in subscription order and records the read.
func (c *watchCore) lookup(key string) (string, *configv1.ConfigValue, bool) {
	c.mu.RLock()
	ns := ""
	if len(c.namespaces) > 0 {
		ns = c.namespaces[0]
	}
	var v *configv1.ConfigValue
	found := false
	for _, n := range c.namespaces {
		if x, ok := c.maps[n][key]; ok {
			ns, v, found = n, x, true
			break
		}
	}
	received := len(c.maps) > 0
	c.mu.RUnlock()
	c.recordRead(ns, key)
	if !found && received {
		c.warn(ns, key, "absent from the received snapshot")
	}
	return ns, v, found
}

func (c *watchCore) mismatch(ns, key, want string, v *configv1.ConfigValue) {
	c.warn(ns, key, "type mismatch", "want", want, "stored", fmt.Sprintf("%T", v.GetValue()))
}

// GetString returns key's string value, or def (FR-11).
func (c *watchCore) GetString(key, def string) string {
	ns, v, ok := c.lookup(key)
	if !ok {
		return def
	}
	if s, ok := v.GetValue().(*configv1.ConfigValue_StringVal); ok {
		return s.StringVal
	}
	c.mismatch(ns, key, "string", v)
	return def
}

// GetInt returns key's int value, or def (FR-11).
func (c *watchCore) GetInt(key string, def int64) int64 {
	ns, v, ok := c.lookup(key)
	if !ok {
		return def
	}
	if i, ok := v.GetValue().(*configv1.ConfigValue_IntVal); ok {
		return i.IntVal
	}
	c.mismatch(ns, key, "int", v)
	return def
}

// GetFloat returns key's float value, widening an int losslessly, or def (FR-11).
func (c *watchCore) GetFloat(key string, def float64) float64 {
	ns, v, ok := c.lookup(key)
	if !ok {
		return def
	}
	switch x := v.GetValue().(type) {
	case *configv1.ConfigValue_FloatVal:
		return x.FloatVal
	case *configv1.ConfigValue_IntVal:
		return float64(x.IntVal)
	}
	c.mismatch(ns, key, "float", v)
	return def
}

// GetBool returns key's bool value, or def (FR-11).
func (c *watchCore) GetBool(key string, def bool) bool {
	ns, v, ok := c.lookup(key)
	if !ok {
		return def
	}
	if b, ok := v.GetValue().(*configv1.ConfigValue_BoolVal); ok {
		return b.BoolVal
	}
	c.mismatch(ns, key, "bool", v)
	return def
}
