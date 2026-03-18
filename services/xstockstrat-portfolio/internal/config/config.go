package config

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"sync"
	"time"

	configv1 "github.com/xstockstrat/contracts/gen/go/config/v1"
	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

// Config holds all environment-sourced configuration for xstockstrat-portfolio.
type Config struct {
	GRPCPort           string
	HTTPPort           string
	ConfigEndpoint     string
	LedgerEndpoint     string
	MarketDataEndpoint string
	NotifyEndpoint     string
	DBConnStr          string
	AppEnv             string
	TradingMode        string
}

// LoadFromEnv reads configuration from environment variables with sane defaults.
func LoadFromEnv() *Config {
	return &Config{
		GRPCPort:           getEnv("GRPC_PORT", "50052"),
		HTTPPort:           getEnv("HTTP_PORT", "8052"),
		ConfigEndpoint:     getEnv("CONFIG_ENDPOINT", "xstockstrat-config:50060"),
		LedgerEndpoint:     getEnv("LEDGER_ENDPOINT", "xstockstrat-ledger:50057"),
		MarketDataEndpoint: getEnv("MARKETDATA_ENDPOINT", "xstockstrat-marketdata:50053"),
		NotifyEndpoint:     getEnv("NOTIFY_ENDPOINT", "xstockstrat-notify:50059"),
		DBConnStr:          getEnv("DATABASE_URL", ""),
		AppEnv:             getEnv("APP_ENV", "dev"),
		TradingMode:        getEnv("TRADING_MODE", "paper"),
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

// NewWatcher dials the config service and starts the background watch loop.
func NewWatcher(endpoint, namespace string) (*Watcher, error) {
	conn, err := grpc.NewClient(endpoint, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("dial config service %s: %w", endpoint, err)
	}
	w := &Watcher{
		namespace: namespace,
		client:    configv1.NewConfigServiceClient(conn),
		ready:     make(chan struct{}),
		snapshot:  make(map[string]*configv1.ConfigValue),
	}
	go w.watchLoop()
	return w, nil
}

// WaitForSnapshot blocks until the initial config snapshot has been received.
func (w *Watcher) WaitForSnapshot(ctx context.Context) error {
	select {
	case <-w.ready:
		return nil
	case <-ctx.Done():
		return fmt.Errorf("config snapshot timeout: %w", ctx.Err())
	case <-time.After(30 * time.Second):
		return fmt.Errorf("config snapshot timeout: 30s elapsed")
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
		if err := w.stream(); err != nil {
			slog.Warn("config watcher stream error, reconnecting", "error", err, "backoff", backoff)
			time.Sleep(backoff)
			if backoff < 30*time.Second {
				backoff *= 2
			}
		}
	}
}

func (w *Watcher) stream() error {
	ctx := context.Background()
	req := &configv1.WatchConfigRequest{
		Namespace:   w.namespace,
		ClientId:    fmt.Sprintf("go-portfolio-%d", os.Getpid()),
		Environment: w.environment,
		TradingMode: w.tradingMode,
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

func getEnvBool(key string, def bool) bool {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return def
	}
	return b
}

// ensure getEnvBool is used (suppress unused warning)
var _ = getEnvBool
