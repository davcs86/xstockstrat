package main

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"os"
	"os/signal"
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
		Feed:  cfgWatcher.GetString("marketdata.alpaca.feed", "iex"),
		Paper: cfg.TradingMode == "paper",
	})

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
