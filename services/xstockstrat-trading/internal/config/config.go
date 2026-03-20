package config

import (
	"context"
	"fmt"
	"os"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	configv1 "github.com/xstockstrat/contracts/gen/go/config/v1"
)

// Config holds all runtime config for the trading service.
type Config struct {
	GRPCPort             string
	HTTPPort             string
	ConfigEndpoint       string
	LedgerEndpoint       string
	PortfolioEndpoint    string
	IndicatorsEndpoint   string
	NotifyEndpoint       string
	DBConnStr            string
	RequireApprovalAbove float64 // order qty threshold requiring manual approval
	// Alpaca broker credentials — used only by xstockstrat-trading for order submission.
	// Secrets: sourced from env vars, never from the config service.
	AlpacaAPIKey    string
	AlpacaAPISecret string
	AlpacaPaperURL  string // default: https://paper-api.alpaca.markets
	AlpacaLiveURL   string // default: https://api.alpaca.markets
	AlpacaPaper     bool   // default: true; set false for live trading
}

func LoadFromEnv() *Config {
	return &Config{
		GRPCPort:             getEnv("GRPC_PORT", "50051"),
		HTTPPort:             getEnv("HTTP_PORT", "8051"),
		ConfigEndpoint:       getEnv("CONFIG_ENDPOINT", "xstockstrat-config:50060"),
		LedgerEndpoint:       getEnv("LEDGER_ENDPOINT", "xstockstrat-ledger:50057"),
		PortfolioEndpoint:    getEnv("PORTFOLIO_ENDPOINT", "xstockstrat-portfolio:50052"),
		IndicatorsEndpoint:   getEnv("INDICATORS_ENDPOINT", "xstockstrat-indicators:50054"),
		NotifyEndpoint:       getEnv("NOTIFY_ENDPOINT", "xstockstrat-notify:50059"),
		DBConnStr:            getEnv("DATABASE_URL", ""),
		RequireApprovalAbove: 0, // loaded from config service at runtime
		AlpacaAPIKey:         getEnv("ALPACA_API_KEY", ""),
		AlpacaAPISecret:      getEnv("ALPACA_API_SECRET", ""),
		AlpacaPaperURL:       getEnv("ALPACA_PAPER_URL", "https://paper-api.alpaca.markets"),
		AlpacaLiveURL:        getEnv("ALPACA_LIVE_URL", "https://api.alpaca.markets"),
		AlpacaPaper:          getEnvBool("ALPACA_PAPER", true),
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
	namespace  string
	conn       *grpc.ClientConn
	client     configv1.ConfigServiceClient
	snapshot   *configv1.ConfigSnapshot
	snapshotCh chan struct{}
}

func NewWatcher(endpoint, namespace string) (*Watcher, error) {
	conn, err := grpc.Dial(endpoint, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("dial config service: %w", err)
	}
	w := &Watcher{
		namespace:  namespace,
		conn:       conn,
		client:     configv1.NewConfigServiceClient(conn),
		snapshotCh: make(chan struct{}),
	}
	go w.watch()
	return w, nil
}

func (w *Watcher) watch() {
	for {
		stream, err := w.client.WatchConfig(context.Background(), &configv1.WatchConfigRequest{
			Namespace: w.namespace,
		})
		if err != nil {
			time.Sleep(2 * time.Second)
			continue
		}
		for {
			snap, err := stream.Recv()
			if err != nil {
				break
			}
			w.snapshot = snap
			select {
			case w.snapshotCh <- struct{}{}:
			default:
			}
		}
		time.Sleep(2 * time.Second)
	}
}

func (w *Watcher) WaitForSnapshot(ctx context.Context) error {
	select {
	case <-w.snapshotCh:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(10 * time.Second):
		return fmt.Errorf("config snapshot timeout")
	}
}

func (w *Watcher) GetString(key, def string) string {
	if w.snapshot == nil {
		return def
	}
	v, ok := w.snapshot.Values[key]
	if !ok {
		return def
	}
	return v.GetStringVal()
}

func (w *Watcher) GetInt(key string, def int64) int64 {
	if w.snapshot == nil {
		return def
	}
	v, ok := w.snapshot.Values[key]
	if !ok {
		return def
	}
	return v.GetIntVal()
}

func (w *Watcher) GetBool(key string, def bool) bool {
	if w.snapshot == nil {
		return def
	}
	v, ok := w.snapshot.Values[key]
	if !ok {
		return def
	}
	return v.GetBoolVal()
}

func (w *Watcher) GetFloat(key string, def float64) float64 {
	if w.snapshot == nil {
		return def
	}
	v, ok := w.snapshot.Values[key]
	if !ok {
		return def
	}
	return v.GetFloatVal()
}
