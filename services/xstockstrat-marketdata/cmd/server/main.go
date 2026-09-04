package main

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"go.opentelemetry.io/contrib/instrumentation/google.golang.org/grpc/otelgrpc"
	"google.golang.org/grpc"
	"google.golang.org/grpc/keepalive"
	"google.golang.org/grpc/reflection"

	marketdatav1 "github.com/xstockstrat/contracts/gen/go/marketdata/v1"
	"github.com/xstockstrat/marketdata/internal/alpaca"
	"github.com/xstockstrat/marketdata/internal/config"
	"github.com/xstockstrat/marketdata/internal/finnhub"
	"github.com/xstockstrat/marketdata/internal/fmp"
	"github.com/xstockstrat/marketdata/internal/handler"
	"github.com/xstockstrat/marketdata/internal/middleware"
	"github.com/xstockstrat/marketdata/internal/repository"
	"github.com/xstockstrat/marketdata/internal/service"
	"github.com/xstockstrat/marketdata/internal/source"
	"github.com/xstockstrat/marketdata/internal/telemetry"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	shutdownOtel, err := telemetry.Init(ctx)
	if err != nil {
		slog.Warn("otel init failed — continuing without tracing", "error", err)
	} else {
		defer func() {
			ctx2, c := context.WithTimeout(context.Background(), 5*time.Second)
			defer c()
			_ = shutdownOtel(ctx2)
		}()
	}

	cfg := config.LoadFromEnv()

	// WatchConfig subscription — required before accepting traffic
	cfgWatcher, err := config.NewWatcher(cfg.ConfigEndpoint, "marketdata", cfg.ApplicationEnv, cfg.TradingMode)
	if err != nil {
		slog.Error("config watcher failed", "error", err)
		os.Exit(1)
	}
	if err := cfgWatcher.WaitForSnapshot(ctx); err != nil {
		slog.Error("config snapshot timeout", "error", err)
		os.Exit(1)
	}

	// A resolve failure or unset secret must leave the credential empty (warn-and-start), never
	// fail startup — the Alpaca placeholder guard below is the only hard check.
	resolveSecret := func(key string) string {
		v, found, err := cfgWatcher.ResolveSecret(ctx, key)
		if err != nil {
			slog.Warn("resolving vendor credential from config failed — treating as unset",
				"key", key, "error", err)
			return ""
		}
		if !found {
			return ""
		}
		return v
	}
	cfg.AlpacaAPIKey = resolveSecret("alpaca.api_key")
	cfg.AlpacaAPISecret = resolveSecret("alpaca.api_secret")
	cfg.FMPAPIKey = resolveSecret("fmp.api_key")
	cfg.FinnhubAPIKey = resolveSecret("finnhub.api_key")

	// Alpaca client — this service is the sole Alpaca integration point
	alpacaClient := alpaca.NewClient(alpaca.ClientConfig{
		APIKey:    cfg.AlpacaAPIKey,
		APISecret: cfg.AlpacaAPISecret,
		BaseURL:   cfg.AlpacaBaseURL,
		DataURL:   cfg.AlpacaDataURL,
		// Default "iex": the free/basic paper data plan rejects Alpaca's SIP default with 403.
		Feed: cfgWatcher.GetString("marketdata.alpaca.feed", "iex"),
		// Default "all" so splits/dividends do not distort backtest OHLCV.
		Adjustment: cfgWatcher.GetString("marketdata.alpaca.adjustment", "all"),
		// Per-request bar limit (clamped to the spec max 10000) and outbound REST rate limit.
		BatchSize:    int(cfgWatcher.GetInt("marketdata.backfill.batch_size", 1000)),
		RateLimitRPS: int(cfgWatcher.GetInt("marketdata.backfill.rate_limit_rps", 200)),
		// Streaming WebSocket reconnect tuning.
		ReconnectDelayMs: int(cfgWatcher.GetInt("marketdata.stream.reconnect_delay_ms", 2000)),
		MaxReconnects:    int(cfgWatcher.GetInt("marketdata.stream.max_reconnects", 10)),
		Paper:            cfg.TradingMode == "paper",
	})

	// Fail loud on empty/placeholder Alpaca creds: they 401 every call with only an opaque
	// warm-poller warning otherwise. Non-fatal — cached reads and non-Alpaca RPCs still work.
	if looksLikePlaceholderCred(cfg.AlpacaAPIKey) || looksLikePlaceholderCred(cfg.AlpacaAPISecret) {
		slog.Warn("ALPACA credentials look empty or are still set to a placeholder — "+
			"every Alpaca market-data call will fail with a 401; set the real "+
			"ALPACA_API_KEY/ALPACA_API_SECRET secrets",
			"api_key_placeholder", looksLikePlaceholderCred(cfg.AlpacaAPIKey),
			"api_secret_placeholder", looksLikePlaceholderCred(cfg.AlpacaAPISecret))
	}

	// TimescaleDB repository
	repo, err := repository.NewMarketDataRepo(cfg.DBConnStr)
	if err != nil {
		slog.Error("db connection failed", "error", err)
		os.Exit(1)
	}

	reg := source.NewRegistry()
	reg.Register("alpaca", alpacaClient)

	// fundProvider is read once at boot and passed to BOTH the client constructor and the
	// service — they must stay coupled. Per-RPC enablement is live (fundamentalsEnabled), not here.
	fundProvider := cfgWatcher.GetString("marketdata.fundamentals.provider", "finnhub")
	fundamentalsSrc := newFundamentalsSource(cfgWatcher, fundProvider, cfg.FMPAPIKey, cfg.FinnhubAPIKey)

	svc, err := service.NewMarketDataService(reg, repo, cfgWatcher, cfg.LedgerEndpoint, cfg.NotifyEndpoint, fundamentalsSrc, fundProvider)
	if err != nil {
		slog.Error("service init failed", "error", err)
		os.Exit(1)
	}
	hdl := handler.NewMarketDataHandler(svc)

	go svc.StartWarmQuotePoller(ctx)

	go svc.StartBarIngestPoller(ctx)

	lis, err := net.Listen("tcp", fmt.Sprintf(":%s", cfg.GRPCPort))
	if err != nil {
		slog.Error("listen failed", "error", err)
		os.Exit(1)
	}

	grpcServer := grpc.NewServer(
		grpc.ChainUnaryInterceptor(middleware.UnaryServerInterceptor),
		grpc.StatsHandler(otelgrpc.NewServerHandler()),
		grpc.KeepaliveParams(keepalive.ServerParameters{
			MaxConnectionIdle: 60 * time.Second,
			Time:              30 * time.Second,
			Timeout:           10 * time.Second,
		}),
	)
	marketdatav1.RegisterMarketDataServiceServer(grpcServer, hdl.GRPCHandler())
	reflection.Register(grpcServer)

	slog.Info("marketdata service starting", "grpc_port", cfg.GRPCPort)

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-quit
		slog.Info("shutting down marketdata service")
		grpcServer.GracefulStop()
		cancel()
	}()

	if err := grpcServer.Serve(lis); err != nil {
		slog.Error("server error", "error", err)
		os.Exit(1)
	}
}

// looksLikePlaceholderCred reports whether an Alpaca credential is empty or a DO app-spec
// placeholder ("YOUR_…"/"…PLACEHOLDER…"). Conservative by design so a real key is never flagged.
func looksLikePlaceholderCred(v string) bool {
	v = strings.TrimSpace(v)
	if v == "" {
		return true
	}
	upper := strings.ToUpper(v)
	return strings.HasPrefix(upper, "YOUR_") || strings.Contains(upper, "PLACEHOLDER")
}

// newFundamentalsSource builds the active fundamentals client selected by
// marketdata.fundamentals.provider (boot-only). Always constructed; .enabled gates use, not this.
func newFundamentalsSource(cfgWatcher *config.Watcher, provider, fmpAPIKey, finnhubAPIKey string) source.FundamentalsSource {
	switch provider {
	case "finnhub":
		baseURL := cfgWatcher.GetString("marketdata.finnhub.base_url", "https://api.finnhub.io/api/v1")
		slog.Info("Finnhub fundamentals client constructed", "base_url", baseURL)
		return finnhub.NewClient(finnhub.ClientConfig{BaseURL: baseURL, APIKey: finnhubAPIKey})
	default: // "fmp" and any unrecognized value fall back to the pre-existing FMP client
		baseURL := cfgWatcher.GetString("marketdata.fmp.base_url", "https://financialmodelingprep.com")
		metrics := strings.Split(cfgWatcher.GetString("marketdata.fmp.metrics", "core,extended"), ",")
		slog.Info("FMP fundamentals client constructed", "base_url", baseURL, "metrics", metrics)
		return fmp.NewClient(fmp.ClientConfig{BaseURL: baseURL, APIKey: fmpAPIKey, Metrics: metrics})
	}
}
