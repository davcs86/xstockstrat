package config

import (
	"context"
	"fmt"
	"os"

	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	configv1 "github.com/xstockstrat/contracts/gen/go/config/v1"
	"github.com/xstockstrat/marketdata/internal/mtls"
)

// Config holds all environment-sourced configuration for xstockstrat-marketdata.
type Config struct {
	GRPCPort        string
	ConfigEndpoint  string
	LedgerEndpoint  string
	NotifyEndpoint  string
	DBConnStr       string
	AlpacaAPIKey    string
	AlpacaAPISecret string
	AlpacaBaseURL   string
	AlpacaDataURL   string
	FMPAPIKey       string
	FinnhubAPIKey   string
	ApplicationEnv  string
	TradingMode     string
}

// LoadFromEnv reads configuration from environment variables with sane defaults.
func LoadFromEnv() *Config {
	return &Config{
		GRPCPort:       getEnv("GRPC_PORT", "50053"),
		ConfigEndpoint: getEnv("CONFIG_ENDPOINT", "xstockstrat-config:50060"),
		LedgerEndpoint: getEnv("LEDGER_ENDPOINT", "xstockstrat-ledger:50057"),
		NotifyEndpoint: getEnv("NOTIFY_ENDPOINT", "xstockstrat-notify:50059"),
		DBConnStr:      getEnv("DATABASE_URL", ""),
		AlpacaBaseURL:  getEnv("ALPACA_BASE_URL", "https://paper-api.alpaca.markets"),
		AlpacaDataURL:  getEnv("ALPACA_DATA_URL", "https://data.alpaca.markets"),
		// Vendor credentials (Alpaca/FMP/Finnhub) are not env vars: they start empty here and are
		// populated in cmd/server/main.go via Watcher.ResolveSecret before the vendor clients build.
		ApplicationEnv: getEnv("APPLICATION_ENV", "development"),
		TradingMode:    getEnv("TRADING_MODE", "paper"),
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
			ClientId:    fmt.Sprintf("go-marketdata-%d", os.Getpid()),
			Environment: env,
			// trading_mode is ignored by the config server (paper/live derives from environment);
			// user_id left empty — this service subscribes at global scope.
		})
	}, opts...)
	return w
}

// resolveEnvironment maps ApplicationEnv to the proto Environment enum; anything but
// "production" → STAGING.
func resolveEnvironment(applicationEnv string) commonv1.Environment {
	if applicationEnv == "production" {
		return commonv1.Environment_ENVIRONMENT_PRODUCTION
	}
	return commonv1.Environment_ENVIRONMENT_STAGING
}

// resolveTradingMode maps TradingMode to the proto enum; anything but "live" → paper.
func resolveTradingMode(tradingMode string) commonv1.TradingMode {
	if tradingMode == "live" {
		return commonv1.TradingMode_TRADING_MODE_LIVE
	}
	return commonv1.TradingMode_TRADING_MODE_PAPER
}

// InternalCallerID is the x-internal-caller identity this service presents to the config
// service's GetSecret allow-list for its marketdata.* vendor-credential keys.
const InternalCallerID = "marketdata"

// ResolveSecret fetches a decrypted secret via GetSecret (plaintext never on the WatchConfig
// stream). found=false means unset — the caller treats it like an empty env var (warn-and-start).
func (w *Watcher) ResolveSecret(ctx context.Context, key string) (string, bool, error) {
	octx := metadata.NewOutgoingContext(ctx, metadata.New(map[string]string{
		"x-internal-caller": InternalCallerID,
	}))
	resp, err := w.client.GetSecret(octx, &configv1.GetSecretRequest{
		Namespace:   w.namespace,
		Key:         key,
		Environment: w.environment,
	})
	if err != nil {
		return "", false, fmt.Errorf("GetSecret %s: %w", key, err)
	}
	return resp.GetValue(), resp.GetFound(), nil
}

// NewSnapshotWatcher builds a Watcher around a fixed, already-delivered marketdata snapshot and
// performs no network I/O, so tests in other packages can inject config state.
func NewSnapshotWatcher(snapshot map[string]*configv1.ConfigValue) *Watcher {
	w := &Watcher{namespace: "marketdata"}
	w.ApplyUpdate("marketdata", &configv1.ConfigSnapshot{
		Namespace:  "marketdata",
		UpdateType: configv1.ConfigUpdateType_CONFIG_UPDATE_TYPE_SNAPSHOT,
		Values:     snapshot,
	})
	return w
}

func getEnv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
