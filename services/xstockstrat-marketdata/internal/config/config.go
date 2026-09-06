package config

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"sync"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	configv1 "github.com/xstockstrat/contracts/gen/go/config/v1"
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

// Watcher subscribes to xstockstrat-config via WatchConfig and caches the
// latest snapshot. It reconnects automatically on stream error.
type Watcher struct {
	namespace   string
	client      configv1.ConfigServiceClient
	environment commonv1.Environment
	tradingMode commonv1.TradingMode

	mu       sync.RWMutex
	snapshot map[string]*configv1.ConfigValue
	ready    chan struct{}
	once     sync.Once
}

// NewWatcher dials the config service and starts the background watch loop. applicationEnv/
// tradingMode scope every WatchConfig request to this deployment's rows, not the dev/all default.
func NewWatcher(endpoint, namespace, applicationEnv, tradingMode string) (*Watcher, error) {
	conn, err := grpc.NewClient(endpoint, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("dial config service %s: %w", endpoint, err)
	}
	w := &Watcher{
		namespace:   namespace,
		client:      configv1.NewConfigServiceClient(conn),
		ready:       make(chan struct{}),
		snapshot:    make(map[string]*configv1.ConfigValue),
		environment: resolveEnvironment(applicationEnv),
		tradingMode: resolveTradingMode(tradingMode),
	}
	go w.watchLoop()
	return w, nil
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

// WaitForSnapshot blocks until the initial config snapshot has been received
// or the context is cancelled.
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

// GetString returns the string value for key, or defaultVal if not set.
func (w *Watcher) GetString(key, defaultVal string) string {
	w.mu.RLock()
	defer w.mu.RUnlock()
	v, ok := w.snapshot[key]
	if !ok {
		return defaultVal
	}
	if sv, ok := v.Value.(*configv1.ConfigValue_StringVal); ok {
		return sv.StringVal
	}
	return defaultVal
}

// GetInt returns the int64 value for key, or defaultVal if not set.
func (w *Watcher) GetInt(key string, defaultVal int64) int64 {
	w.mu.RLock()
	defer w.mu.RUnlock()
	v, ok := w.snapshot[key]
	if !ok {
		return defaultVal
	}
	if iv, ok := v.Value.(*configv1.ConfigValue_IntVal); ok {
		return iv.IntVal
	}
	return defaultVal
}

// GetFloat returns the float64 value for key, or defaultVal if not set.
func (w *Watcher) GetFloat(key string, defaultVal float64) float64 {
	w.mu.RLock()
	defer w.mu.RUnlock()
	v, ok := w.snapshot[key]
	if !ok {
		return defaultVal
	}
	if fv, ok := v.Value.(*configv1.ConfigValue_FloatVal); ok {
		return fv.FloatVal
	}
	return defaultVal
}

// GetBool returns the bool value for key, or defaultVal if not set.
func (w *Watcher) GetBool(key string, defaultVal bool) bool {
	w.mu.RLock()
	defer w.mu.RUnlock()
	v, ok := w.snapshot[key]
	if !ok {
		return defaultVal
	}
	if bv, ok := v.Value.(*configv1.ConfigValue_BoolVal); ok {
		return bv.BoolVal
	}
	return defaultVal
}

func (w *Watcher) watchLoop() {
	backoff := 2 * time.Second
	for {
		// stream() only ever returns on error (it loops until the stream breaks), so a
		// reconnect+backoff always applies — there is no nil-error branch to guard (SA4023).
		err := w.stream()
		slog.Warn("config watcher stream error, reconnecting", "error", err, "backoff", backoff)
		time.Sleep(backoff)
		if backoff < 30*time.Second {
			backoff *= 2
		}
	}
}

func (w *Watcher) stream() error {
	ctx := context.Background()
	req := &configv1.WatchConfigRequest{
		Namespace:   w.namespace,
		ClientId:    fmt.Sprintf("go-marketdata-%d", os.Getpid()),
		Environment: w.environment,
		// trading_mode is ignored by the config server (paper/live derives from environment);
		// user_id left empty — this service subscribes at global scope.
	}
	stream, err := w.client.WatchConfig(ctx, req)
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
			w.snapshot = snap.Values
		} else {
			for k, v := range snap.Values {
				w.snapshot[k] = v
			}
		}
		w.mu.Unlock()
		w.once.Do(func() { close(w.ready) })
		slog.Debug("config snapshot received", "namespace", w.namespace, "update_type", snap.UpdateType)
	}
}

func getEnv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
