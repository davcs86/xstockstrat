package config

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"strings"

	"google.golang.org/grpc"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	configv1 "github.com/xstockstrat/contracts/gen/go/config/v1"
	"github.com/xstockstrat/portfolio/internal/mtls"
)

// Config holds all environment-sourced configuration for xstockstrat-portfolio.
type Config struct {
	GRPCPort           string
	ConfigEndpoint     string
	LedgerEndpoint     string
	MarketDataEndpoint string
	NotifyEndpoint     string
	DBConnStr          string
	ApplicationEnv     string
	TradingMode        string
}

// LoadFromEnv reads configuration from environment variables with sane defaults.
func LoadFromEnv() *Config {
	return &Config{
		GRPCPort:           getEnv("GRPC_PORT", "50052"),
		ConfigEndpoint:     getEnv("CONFIG_ENDPOINT", "xstockstrat-config:50060"),
		LedgerEndpoint:     getEnv("LEDGER_ENDPOINT", "xstockstrat-ledger:50057"),
		MarketDataEndpoint: getEnv("MARKETDATA_ENDPOINT", "xstockstrat-marketdata:50053"),
		NotifyEndpoint:     getEnv("NOTIFY_ENDPOINT", "xstockstrat-notify:50059"),
		DBConnStr:          getEnv("DATABASE_URL", ""),
		ApplicationEnv:     getEnv("APPLICATION_ENV", "development"),
		TradingMode:        getEnv("TRADING_MODE", "paper"),
	}
}

// Watcher subscribes to xstockstrat-config via WatchConfig (watchcore.go) and serves the latest
// values; it reconnects on stream error, missed liveness or a clean EOF.
type Watcher struct {
	watchCore
	namespace   string
	client      configv1.ConfigServiceClient
	environment commonv1.Environment
	tradingMode commonv1.TradingMode
}

// NewWatcher dials the config service and starts the background watch loop. applicationEnv/
// tradingMode scope every WatchConfig request to this deployment's rows, not the dev/all default.
func NewWatcher(endpoint, namespace, applicationEnv, tradingMode string) (*Watcher, error) {
	creds, err := mtls.ClientConfig("xstockstrat-config")
	if err != nil {
		return nil, fmt.Errorf("mtls config: %w", err)
	}
	conn, err := grpc.NewClient(endpoint, grpc.WithTransportCredentials(creds), watchKeepalive)
	if err != nil {
		return nil, fmt.Errorf("dial config service %s: %w", endpoint, err)
	}
	w := newWatcher(configv1.NewConfigServiceClient(conn), namespace, resolveEnvironment(applicationEnv))
	w.tradingMode = resolveTradingMode(tradingMode)
	return w, nil
}

// newWatcher starts the watch loop on an already-built client (no dial).
func newWatcher(client configv1.ConfigServiceClient, namespace string, env commonv1.Environment, opts ...Option) *Watcher {
	w := &Watcher{namespace: namespace, client: client, environment: env}
	w.start([]string{namespace}, func(ctx context.Context, ns string) (grpc.ServerStreamingClient[configv1.ConfigSnapshot], error) {
		return client.WatchConfig(ctx, &configv1.WatchConfigRequest{
			Namespace:   ns,
			ClientId:    fmt.Sprintf("go-portfolio-%d", os.Getpid()),
			Environment: env,
			// trading_mode is ignored by the config server (paper/live derives from environment);
			// user_id left empty — this service subscribes at global scope.
		})
	}, opts...)
	return w
}

// resolveEnvironment maps ApplicationEnv to the proto Environment enum; non-"production" → staging.
func resolveEnvironment(applicationEnv string) commonv1.Environment {
	if applicationEnv == "production" {
		return commonv1.Environment_ENVIRONMENT_PRODUCTION
	}
	return commonv1.Environment_ENVIRONMENT_STAGING
}

// resolveTradingMode maps TradingMode to the proto TradingMode enum; non-"live" → paper.
func resolveTradingMode(tradingMode string) commonv1.TradingMode {
	if tradingMode == "live" {
		return commonv1.TradingMode_TRADING_MODE_LIVE
	}
	return commonv1.TradingMode_TRADING_MODE_PAPER
}

// MustSnapshotWatcher serves a fixed, already-delivered snapshot with no network I/O, for tests in
// other packages. A key spelled with its own "<ns>." panics: a stale fixture would match the default.
func MustSnapshotWatcher(ns string, values map[string]*configv1.ConfigValue) *Watcher {
	for k := range values {
		if strings.HasPrefix(k, ns+".") {
			panic(fmt.Sprintf("portfolio: config snapshot key %q must be the relative %q", k, strings.TrimPrefix(k, ns+".")))
		}
	}
	w := &Watcher{namespace: ns}
	w.ApplyUpdate(ns, &configv1.ConfigSnapshot{Namespace: ns, UpdateType: configv1.ConfigUpdateType_CONFIG_UPDATE_TYPE_SNAPSHOT, Values: values})
	return w
}

// FactorMapKey holds a JSON object mapping symbol → factor for the Exposure screen's grouping.
// Default "{}"; unmapped symbols group as "Unclassified".
const FactorMapKey = "exposure.factor_map"

// FactorMap returns the parsed portfolio.exposure.factor_map (symbol → factor), or an empty
// map when the key is unset or its JSON is unparseable (never nil).
func (w *Watcher) FactorMap() map[string]string {
	raw := w.GetString(FactorMapKey, "{}")
	m := map[string]string{}
	if err := json.Unmarshal([]byte(raw), &m); err != nil {
		slog.Warn("portfolio.exposure.factor_map is not valid JSON; using empty map", "error", err)
		return map[string]string{}
	}
	return m
}

func getEnv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
