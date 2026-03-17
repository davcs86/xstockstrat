package main

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"os"
	"os/signal"
	"syscall"

	"google.golang.org/grpc"
	"google.golang.org/grpc/reflection"

	portfoliov1 "github.com/xstockstrat/contracts/gen/go/portfolio/v1"
	"github.com/xstockstrat/portfolio/internal/config"
	"github.com/xstockstrat/portfolio/internal/handler"
	"github.com/xstockstrat/portfolio/internal/service"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	cfg := config.LoadFromEnv()

	cfgWatcher, err := config.NewWatcher(cfg.ConfigEndpoint, "portfolio")
	if err != nil {
		slog.Error("config watcher failed", "error", err)
		os.Exit(1)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	if err := cfgWatcher.WaitForSnapshot(ctx); err != nil {
		slog.Error("config snapshot timeout", "error", err)
		os.Exit(1)
	}

	svc, err := service.NewPortfolioService(cfg, cfgWatcher)
	if err != nil {
		slog.Error("service init failed", "error", err)
		os.Exit(1)
	}

	// Start consuming ledger events for order fills
	go svc.ConsumeOrderFills(ctx)

	hdl := handler.NewPortfolioHandler(svc)

	lis, err := net.Listen("tcp", fmt.Sprintf(":%s", cfg.GRPCPort))
	if err != nil {
		slog.Error("listen failed", "error", err)
		os.Exit(1)
	}

	grpcServer := grpc.NewServer()
	portfoliov1.RegisterPortfolioServiceServer(grpcServer, hdl)
	reflection.Register(grpcServer)

	slog.Info("portfolio service starting", "port", cfg.GRPCPort)

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-quit
		slog.Info("shutting down portfolio service")
		grpcServer.GracefulStop()
		cancel()
	}()

	if err := grpcServer.Serve(lis); err != nil {
		slog.Error("server error", "error", err)
		os.Exit(1)
	}
}
