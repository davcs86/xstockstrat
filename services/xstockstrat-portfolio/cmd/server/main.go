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
	"google.golang.org/grpc/health"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/keepalive"
	"google.golang.org/grpc/reflection"

	portfoliov1 "github.com/xstockstrat/contracts/gen/go/portfolio/v1"
	"github.com/xstockstrat/portfolio/internal/config"
	"github.com/xstockstrat/portfolio/internal/handler"
	"github.com/xstockstrat/portfolio/internal/middleware"
	"github.com/xstockstrat/portfolio/internal/mtls"
	"github.com/xstockstrat/portfolio/internal/service"
	"github.com/xstockstrat/portfolio/internal/telemetry"
)

func main() {
	// Container healthcheck (distroless has no shell): `service healthcheck` probes this process over mTLS.
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		os.Exit(healthcheck())
	}

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

	cfgWatcher, err := config.NewWatcher(cfg.ConfigEndpoint, "portfolio", cfg.ApplicationEnv, cfg.TradingMode)
	if err != nil {
		slog.Error("config watcher failed", "error", err)
		os.Exit(1)
	}

	if err := cfgWatcher.WaitForSnapshot(ctx); err != nil {
		slog.Error("config snapshot timeout", "error", err)
		os.Exit(1)
	}

	svc, err := service.NewPortfolioService(cfg, cfgWatcher)
	if err != nil {
		slog.Error("service init failed", "error", err)
		os.Exit(1)
	}

	go svc.ConsumeOrderFills(ctx)
	go svc.ConsumePositionSyncs(ctx)
	go svc.ConsumeBalanceSyncs(ctx)
	go svc.ConsumeBracketUpdates(ctx)
	go svc.ConsumeAccountDeregistrations(ctx)
	go svc.HydrateStops(ctx)

	hdl := handler.NewPortfolioHandler(svc)

	lis, err := net.Listen("tcp", fmt.Sprintf(":%s", cfg.GRPCPort))
	if err != nil {
		slog.Error("listen failed", "error", err)
		os.Exit(1)
	}

	serverCreds, err := mtls.ServerConfig()
	if err != nil {
		slog.Error("mtls server credentials", "error", err)
		os.Exit(1)
	}
	grpcServer := grpc.NewServer(
		grpc.Creds(serverCreds),
		grpc.ChainUnaryInterceptor(middleware.UnaryServerInterceptor),
		grpc.StatsHandler(otelgrpc.NewServerHandler()),
		grpc.KeepaliveParams(keepalive.ServerParameters{
			MaxConnectionIdle: 60 * time.Second,
			Time:              30 * time.Second,
			Timeout:           10 * time.Second,
		}),
	)
	portfoliov1.RegisterPortfolioServiceServer(grpcServer, hdl.GRPCHandler())
	hs := health.NewServer()
	healthpb.RegisterHealthServer(grpcServer, hs)
	reflection.Register(grpcServer)

	slog.Info("portfolio service starting", "grpc_port", cfg.GRPCPort)

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-quit
		slog.Info("shutting down portfolio service")
		hs.Shutdown()
		grpcServer.GracefulStop()
		cancel()
	}()

	if err := grpcServer.Serve(lis); err != nil {
		slog.Error("server error", "error", err)
		os.Exit(1)
	}
}

func healthcheck() int {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := mtls.Probe(ctx, "127.0.0.1:"+config.LoadFromEnv().GRPCPort, "xstockstrat-portfolio"); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	return 0
}
