package config

import (
	"context"
	"fmt"
	"os"
	"strings"

	"github.com/google/uuid"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	configv1 "github.com/xstockstrat/contracts/gen/go/config/v1"
	"github.com/xstockstrat/trading/internal/mtls"
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

// Watcher subscribes to one WatchConfig stream per namespace and keeps a value map per namespace
// (watchcore.go). Trading builds one single-namespace Watcher for `trading` and another for `platform`.
type Watcher struct {
	watchCore
	client      configv1.ConfigServiceClient
	environment commonv1.Environment
	tradingMode commonv1.TradingMode
}

// NewWatcher dials the config service and starts one background watch loop per namespace.
// applicationEnv/tradingMode scope every WatchConfig request to this deployment's own config rows.
func NewWatcher(endpoint, applicationEnv, tradingMode string, namespaces ...string) (*Watcher, error) {
	creds, err := mtls.ClientConfig("xstockstrat-config")
	if err != nil {
		return nil, fmt.Errorf("mtls config: %w", err)
	}
	conn, err := grpc.NewClient(endpoint, grpc.WithTransportCredentials(creds), watchKeepalive)
	if err != nil {
		return nil, fmt.Errorf("dial config service: %w", err)
	}
	w := newWatcher(configv1.NewConfigServiceClient(conn), resolveEnvironment(applicationEnv), namespaces)
	w.tradingMode = resolveTradingMode(tradingMode)
	return w, nil
}

// newWatcher starts the watch loops on an already-built client (no dial).
func newWatcher(client configv1.ConfigServiceClient, env commonv1.Environment, namespaces []string, opts ...Option) *Watcher {
	w := &Watcher{client: client, environment: env}
	w.start(namespaces, func(ctx context.Context, ns string) (grpc.ServerStreamingClient[configv1.ConfigSnapshot], error) {
		return client.WatchConfig(ctx, &configv1.WatchConfigRequest{
			Namespace:   ns,
			ClientId:    fmt.Sprintf("go-trading-%s-%d", ns, os.Getpid()),
			Environment: env,
			// trading_mode is deprecated and ignored by the config server; paper/live derives from
			// environment. user_id is left empty — services subscribe at global scope.
		})
	}, opts...)
	return w
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

// MustSnapshotWatcher builds a Watcher around a fixed, already-delivered snapshot of namespace ns with
// no network I/O. It panics on a "trading." or "platform." prefixed key in either namespace: stored keys
// are namespace-relative, and a stale prefixed fixture would silently read the code default.
func MustSnapshotWatcher(ns string, values map[string]*configv1.ConfigValue) *Watcher {
	for k := range values {
		for _, p := range []string{"trading.", "platform."} {
			if strings.HasPrefix(k, p) {
				panic(fmt.Sprintf("trading: snapshot key %q is namespace-prefixed; use the relative key %q", k, strings.TrimPrefix(k, p)))
			}
		}
	}
	w := &Watcher{}
	w.ApplyUpdate(ns, &configv1.ConfigSnapshot{
		Namespace:  ns,
		UpdateType: configv1.ConfigUpdateType_CONFIG_UPDATE_TYPE_SNAPSHOT,
		Values:     values,
	})
	return w
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
