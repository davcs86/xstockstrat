package config

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	configv1 "github.com/xstockstrat/contracts/gen/go/config/v1"
)

// Config holds all runtime config for the trading service.
type Config struct {
	GRPCPort                    string
	ConfigEndpoint              string
	LedgerEndpoint              string
	PortfolioEndpoint           string
	IndicatorsEndpoint          string
	MarketDataEndpoint          string
	NotifyEndpoint              string
	DBConnStr                   string
	RequireApprovalAbove        float64 // order qty threshold requiring manual approval
	BrokerAccountsEncryptionKey string  // hex-encoded 32-byte key; required when broker_accounts table is in use
	TradingMode                 string  // "paper" | "live"
	ApplicationEnv              string  // "development" | "production"
}

func LoadFromEnv() *Config {
	return &Config{
		GRPCPort:                    getEnv("GRPC_PORT", "50051"),
		ConfigEndpoint:              getEnv("CONFIG_ENDPOINT", "xstockstrat-config:50060"),
		LedgerEndpoint:              getEnv("LEDGER_ENDPOINT", "xstockstrat-ledger:50057"),
		PortfolioEndpoint:           getEnv("PORTFOLIO_ENDPOINT", "xstockstrat-portfolio:50052"),
		IndicatorsEndpoint:          getEnv("INDICATORS_ENDPOINT", "xstockstrat-indicators:50054"),
		MarketDataEndpoint:          getEnv("MARKETDATA_ENDPOINT", "xstockstrat-marketdata:50053"),
		NotifyEndpoint:              getEnv("NOTIFY_ENDPOINT", "xstockstrat-notify:50059"),
		DBConnStr:                   getEnv("DATABASE_URL", ""),
		RequireApprovalAbove:        0, // loaded from config service at runtime
		BrokerAccountsEncryptionKey: os.Getenv("BROKER_ACCOUNTS_ENCRYPTION_KEY"),
		TradingMode:                 getEnv("TRADING_MODE", "paper"),
		ApplicationEnv:              getEnv("APPLICATION_ENV", "development"),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// Watcher subscribes to one or more xstockstrat-config WatchConfig streams (one per namespace).
// The snapshot is keyed by the full-dotted `<namespace>.<key>` that the config server streams
// (CONFIG-9); getters look it up verbatim. Trading subscribes to both `trading` (its own keys) and
// `platform` (the kill-switch / maintenance keys), because config serves one namespace per stream.
type Watcher struct {
	namespaces  []string
	client      configv1.ConfigServiceClient
	environment commonv1.Environment
	tradingMode commonv1.TradingMode

	mu        sync.RWMutex
	snapshot  map[string]*configv1.ConfigValue
	pending   map[string]struct{} // subscribed namespaces that have not yet delivered a first snapshot
	ready     chan struct{}
	closeOnce sync.Once
}

// NewWatcher dials the config service and starts one background watch loop per namespace.
// applicationEnv/tradingMode scope every WatchConfig request to this deployment's own config rows.
func NewWatcher(endpoint, applicationEnv, tradingMode string, namespaces ...string) (*Watcher, error) {
	conn, err := grpc.NewClient(endpoint, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("dial config service: %w", err)
	}
	pending := make(map[string]struct{}, len(namespaces))
	for _, ns := range namespaces {
		pending[ns] = struct{}{}
	}
	w := &Watcher{
		namespaces:  namespaces,
		client:      configv1.NewConfigServiceClient(conn),
		ready:       make(chan struct{}),
		snapshot:    make(map[string]*configv1.ConfigValue),
		pending:     pending,
		environment: resolveEnvironment(applicationEnv),
		tradingMode: resolveTradingMode(tradingMode),
	}
	for _, ns := range namespaces {
		go w.watchLoop(ns)
	}
	return w, nil
}

// resolveEnvironment maps Config.ApplicationEnv to the proto Environment enum;
// anything other than "production" resolves to staging.
func resolveEnvironment(applicationEnv string) commonv1.Environment {
	if applicationEnv == "production" {
		return commonv1.Environment_ENVIRONMENT_PRODUCTION
	}
	return commonv1.Environment_ENVIRONMENT_STAGING // non-production => staging
}

// resolveTradingMode maps Config.TradingMode to the proto TradingMode enum;
// anything other than "live" resolves to paper.
func resolveTradingMode(tradingMode string) commonv1.TradingMode {
	if tradingMode == "live" {
		return commonv1.TradingMode_TRADING_MODE_LIVE
	}
	return commonv1.TradingMode_TRADING_MODE_PAPER
}

func (w *Watcher) watchLoop(ns string) {
	backoff := 2 * time.Second
	for {
		// stream() only ever returns on error, so a reconnect+backoff always applies —
		// there is no nil-error branch to guard (SA4023).
		err := w.stream(ns)
		slog.Warn("config watcher stream error, reconnecting", "namespace", ns, "error", err, "backoff", backoff)
		time.Sleep(backoff)
		if backoff < 30*time.Second {
			backoff *= 2
		}
	}
}

func (w *Watcher) stream(ns string) error {
	req := &configv1.WatchConfigRequest{
		Namespace:   ns,
		ClientId:    fmt.Sprintf("go-trading-%s-%d", ns, os.Getpid()),
		Environment: w.environment,
		// trading_mode is deprecated and ignored by the config server; paper/live derives from
		// environment. user_id is left empty — services subscribe at global scope.
	}
	stream, err := w.client.WatchConfig(context.Background(), req)
	if err != nil {
		return fmt.Errorf("WatchConfig: %w", err)
	}
	for {
		snap, err := stream.Recv()
		if err != nil {
			return fmt.Errorf("stream.Recv: %w", err)
		}
		w.mu.Lock()
		if snap.UpdateType == configv1.ConfigUpdateType_CONFIG_UPDATE_TYPE_SNAPSHOT ||
			snap.UpdateType == configv1.ConfigUpdateType_CONFIG_UPDATE_TYPE_RELOAD {
			// Namespace-scoped replace (NOT a wholesale `w.snapshot = snap.Values`): drop only this
			// namespace's own keys, then insert its values. With multiple streams into one map, a
			// wholesale replace would let the `trading` stream's RELOAD (fired on any trading.* set)
			// wipe the `platform.*` keys the other stream owns — a transient false HALTED. Deleting by
			// the `ns+"."` prefix keeps each stream confined to its own keys.
			prefix := ns + "."
			for k := range w.snapshot {
				if strings.HasPrefix(k, prefix) {
					delete(w.snapshot, k)
				}
			}
			for k, v := range snap.Values {
				w.snapshot[k] = v
			}
		} else {
			for k, v := range snap.Values {
				w.snapshot[k] = v
			}
		}
		// Per-namespace readiness: mark this namespace delivered and close `ready` only once every
		// subscribed namespace has delivered its first snapshot, so WaitForSnapshot never unblocks
		// on a partial view (which would let the platform.trading_state getter serve its fail-closed
		// HALTED default as if it were live). closeOnce makes a later SNAPSHOT on a reconnected stream
		// a safe no-op (no double-close panic).
		delete(w.pending, ns)
		allReady := len(w.pending) == 0
		w.mu.Unlock()
		if allReady {
			w.closeOnce.Do(func() { close(w.ready) })
		}
		slog.Debug("config snapshot received", "namespace", ns, "update_type", snap.UpdateType)
	}
}

func (w *Watcher) WaitForSnapshot(ctx context.Context) error {
	select {
	case <-w.ready:
		return nil
	case <-ctx.Done():
		return fmt.Errorf("config snapshot timeout: %w", ctx.Err())
	case <-time.After(90 * time.Second):
		return fmt.Errorf("config snapshot timeout: 90s elapsed")
	}
}

func (w *Watcher) GetString(key, def string) string {
	w.mu.RLock()
	defer w.mu.RUnlock()
	v, ok := w.snapshot[key]
	if !ok {
		return def
	}
	return v.GetStringVal()
}

func (w *Watcher) GetInt(key string, def int64) int64 {
	w.mu.RLock()
	defer w.mu.RUnlock()
	v, ok := w.snapshot[key]
	if !ok {
		return def
	}
	return v.GetIntVal()
}

func (w *Watcher) GetBool(key string, def bool) bool {
	w.mu.RLock()
	defer w.mu.RUnlock()
	v, ok := w.snapshot[key]
	if !ok {
		return def
	}
	return v.GetBoolVal()
}

func (w *Watcher) GetFloat(key string, def float64) float64 {
	w.mu.RLock()
	defer w.mu.RUnlock()
	v, ok := w.snapshot[key]
	if !ok {
		return def
	}
	return v.GetFloatVal()
}

// NewSnapshotWatcher builds a Watcher around a fixed, already-delivered snapshot and performs no
// network I/O. It exists so tests in other packages (e.g. internal/service's kill-switch gate) can
// inject a config state — the snapshot field is unexported, so an external test cannot populate a
// Watcher any other way. The keys must be the full-dotted form the config server streams (CONFIG-9).
func NewSnapshotWatcher(snapshot map[string]*configv1.ConfigValue) *Watcher {
	ready := make(chan struct{})
	close(ready)
	return &Watcher{snapshot: snapshot, ready: ready}
}

// SetConfig forwards to xstockstrat-config's SetConfig RPC, attaching the x-internal-caller authz
// header (callerID) and a fresh per-call x-trace-id for audit correlation.
func (w *Watcher) SetConfig(ctx context.Context, callerID string, req *configv1.SetConfigRequest) (*configv1.SetConfigResponse, error) {
	md := metadata.Pairs(
		"x-internal-caller", callerID,
		"x-trace-id", uuid.NewString(),
	)
	outCtx := metadata.NewOutgoingContext(ctx, md)
	return w.client.SetConfig(outCtx, req)
}
