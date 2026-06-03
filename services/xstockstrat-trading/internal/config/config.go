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

	configv1 "github.com/xstockstrat/contracts/gen/go/config/v1"
)

// Config holds all runtime config for the trading service.
type Config struct {
	GRPCPort                    string
	ConfigEndpoint              string
	LedgerEndpoint              string
	PortfolioEndpoint           string
	IndicatorsEndpoint          string
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

func getEnvBool(key string, fallback bool) bool {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	return v == "true" || v == "1" || v == "yes"
}

// Watcher subscribes to xstockstrat-config WatchConfig stream.
type Watcher struct {
	namespace string
	client    configv1.ConfigServiceClient

	mu       sync.RWMutex
	snapshot map[string]*configv1.ConfigValue
	ready    chan struct{}
	once     sync.Once
}

func NewWatcher(endpoint, namespace string) (*Watcher, error) {
	conn, err := grpc.NewClient(endpoint, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("dial config service: %w", err)
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
	req := &configv1.WatchConfigRequest{
		Namespace: w.namespace,
		ClientId:  fmt.Sprintf("go-trading-%d", os.Getpid()),
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
