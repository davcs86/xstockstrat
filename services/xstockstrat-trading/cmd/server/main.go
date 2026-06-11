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

	"encoding/hex"

	"go.opentelemetry.io/contrib/instrumentation/google.golang.org/grpc/otelgrpc"
	"google.golang.org/grpc"
	"google.golang.org/grpc/keepalive"
	"google.golang.org/grpc/reflection"

	tradingv1 "github.com/xstockstrat/contracts/gen/go/trading/v1"
	"github.com/xstockstrat/trading/internal/config"
	"github.com/xstockstrat/trading/internal/handler"
	"github.com/xstockstrat/trading/internal/middleware"
	"github.com/xstockstrat/trading/internal/repository"
	"github.com/xstockstrat/trading/internal/service"
	"github.com/xstockstrat/trading/internal/telemetry"
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

	if cfg.BrokerAccountsEncryptionKey == "" {
		slog.Error("BROKER_ACCOUNTS_ENCRYPTION_KEY is required")
		os.Exit(1)
	}
	keyBytes, err := hex.DecodeString(cfg.BrokerAccountsEncryptionKey)
	if err != nil || len(keyBytes) != 32 {
		slog.Error("BROKER_ACCOUNTS_ENCRYPTION_KEY must be a 64-char hex string (32 bytes)")
		os.Exit(1)
	}

	// Block until config snapshot received — required before accepting traffic.
	slog.Info("connecting to config service", "endpoint", cfg.ConfigEndpoint)
	cfgWatcher, err := config.NewWatcher(cfg.ConfigEndpoint, "trading")
	if err != nil {
		slog.Error("config watcher init failed", "error", err)
		os.Exit(1)
	}

	if err := cfgWatcher.WaitForSnapshot(ctx); err != nil {
		slog.Error("config snapshot timeout", "error", err)
		os.Exit(1)
	}
	slog.Info("config snapshot received, starting trading service")

	// Open DB connection for order persistence.
	repo, err := repository.NewTradingRepo(cfg.DBConnStr)
	if err != nil {
		slog.Error("db repo init failed", "error", err)
		os.Exit(1)
	}
	slog.Info("db repository initialized")

	// Account repository — shares the TradingRepo pool to avoid a second
	// connection pool (keeps the service within the shared DB connection budget).
	accountRepo := repository.NewAccountRepo(repo.Pool())
	slog.Info("account repository initialized")

	// Wire service layer.
	svc, err := service.NewTradingService(cfg, cfgWatcher, accountRepo, repo, cfg.BrokerAccountsEncryptionKey)
	if err != nil {
		slog.Error("service init failed", "error", err)
		os.Exit(1)
	}

	// Load registered broker accounts from DB into the in-memory pool.
	if err := svc.LoadBrokerPool(ctx); err != nil {
		slog.Error("broker pool load failed", "error", err)
		os.Exit(1)
	}

	// Start fill poller — detects broker fills and emits order.filled events.
	go svc.StartFillPoller(ctx)
	// Start position sync poller — reconciles broker positions every N ms.
	go svc.StartPositionSyncPoller(ctx)
	// Start credential health poller — flags accounts whose API secrets stopped working.
	go svc.StartCredentialHealthPoller(ctx)

	// gRPC server.
	grpcHdl := handler.NewTradingHandler(svc)
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
	tradingv1.RegisterTradingServiceServer(grpcServer, grpcHdl.GRPCHandler())
	reflection.Register(grpcServer)

	slog.Info("trading service starting", "grpc_port", cfg.GRPCPort)

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-quit
		slog.Info("shutting down trading service")
		grpcServer.GracefulStop()
		cancel()
	}()

	if err := grpcServer.Serve(lis); err != nil {
		slog.Error("grpc server error", "error", err)
		os.Exit(1)
	}
}
