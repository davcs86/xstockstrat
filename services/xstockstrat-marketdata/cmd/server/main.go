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
	cfgWatcher, err := config.NewWatcher(cfg.ConfigEndpoint, "marketdata")
	if err != nil {
		slog.Error("config watcher failed", "error", err)
		os.Exit(1)
	}
	if err := cfgWatcher.WaitForSnapshot(ctx); err != nil {
		slog.Error("config snapshot timeout", "error", err)
		os.Exit(1)
	}

	// Alpaca client — this service is the sole Alpaca integration point
	alpacaClient := alpaca.NewClient(alpaca.ClientConfig{
		APIKey:    cfg.AlpacaAPIKey,
		APISecret: cfg.AlpacaAPISecret,
		BaseURL:   cfg.AlpacaBaseURL,
		DataURL:   cfg.AlpacaDataURL,
		// Data feed (iex/sip/otc). Default "iex" so the free/basic paper data
		// plan works; deployments on a paid SIP plan can override.
		Feed: cfgWatcher.GetString("marketdata.alpaca.feed", "iex"),
		// Corporate-action adjustment for historical bars (default "all") so
		// splits/dividends do not distort backtest OHLCV.
		Adjustment: cfgWatcher.GetString("marketdata.alpaca.adjustment", "all"),
		// Bars-per-request limit (clamped to the Alpaca spec max of 10000) and
		// outbound REST rate limit.
		BatchSize:    int(cfgWatcher.GetInt("marketdata.backfill.batch_size", 1000)),
		RateLimitRPS: int(cfgWatcher.GetInt("marketdata.backfill.rate_limit_rps", 200)),
		// Streaming WebSocket reconnect tuning.
		ReconnectDelayMs: int(cfgWatcher.GetInt("marketdata.stream.reconnect_delay_ms", 2000)),
		MaxReconnects:    int(cfgWatcher.GetInt("marketdata.stream.max_reconnects", 10)),
		Paper:            cfg.TradingMode == "paper",
	})

	// Fail loud if the Alpaca credentials are missing or still set to the DO app-spec
	// placeholders (e.g. "YOUR_DEV_ALPACA_API_KEY"). A placeholder makes every Alpaca
	// call get rejected at the edge with an opaque 401, whose only later symptom is a
	// warm-poller fetch warning. The service still starts — cached reads and non-Alpaca
	// RPCs keep working — but the operator gets an unambiguous startup signal.
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

	svc, err := service.NewMarketDataService(reg, repo, cfgWatcher, cfg.LedgerEndpoint, cfg.NotifyEndpoint)
	if err != nil {
		slog.Error("service init failed", "error", err)
		os.Exit(1)
	}
	hdl := handler.NewMarketDataHandler(svc)

	// Keep latest quotes for queried symbols warm in the DB so per-position P&L
	// reads hit the cache instead of a live Alpaca call on every request.
	go svc.StartWarmQuotePoller(ctx)

	// Always-on bar ingestion: continuously upsert recent bars for queried symbols so
	// the feed runs without a client holding a StreamBars RPC open.
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

// looksLikePlaceholderCred reports whether an Alpaca credential is empty or one of the
// placeholder values shipped in the DO app specs (e.g. "YOUR_DEV_ALPACA_API_KEY"). It is
// intentionally conservative — only blank values and the obvious "YOUR_…"/"…PLACEHOLDER…"
// forms — so a real key is never misflagged.
func looksLikePlaceholderCred(v string) bool {
	v = strings.TrimSpace(v)
	if v == "" {
		return true
	}
	upper := strings.ToUpper(v)
	return strings.HasPrefix(upper, "YOUR_") || strings.Contains(upper, "PLACEHOLDER")
}
