package main

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"google.golang.org/grpc"
	"google.golang.org/grpc/reflection"

	tradingv1 "github.com/xstockstrat/contracts/gen/go/trading/v1"
	"github.com/xstockstrat/trading/internal/config"
	"github.com/xstockstrat/trading/internal/handler"
	"github.com/xstockstrat/trading/internal/service"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	cfg := config.LoadFromEnv()

	// Block until config snapshot received — required before accepting traffic
	slog.Info("connecting to config service", "endpoint", cfg.ConfigEndpoint)
	cfgWatcher, err := config.NewWatcher(cfg.ConfigEndpoint, "trading")
	if err != nil {
		slog.Error("config watcher init failed", "error", err)
		os.Exit(1)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	if err := cfgWatcher.WaitForSnapshot(ctx); err != nil {
		slog.Error("config snapshot timeout", "error", err)
		os.Exit(1)
	}
	slog.Info("config snapshot received, starting trading service")

	// Wire service layer
	svc, err := service.NewTradingService(cfg, cfgWatcher)
	if err != nil {
		slog.Error("service init failed", "error", err)
		os.Exit(1)
	}

	// gRPC server
	grpcHdl := handler.NewTradingHandler(svc)
	lis, err := net.Listen("tcp", fmt.Sprintf(":%s", cfg.GRPCPort))
	if err != nil {
		slog.Error("listen failed", "error", err)
		os.Exit(1)
	}

	grpcServer := grpc.NewServer()
	tradingv1.RegisterTradingServiceServer(grpcServer, grpcHdl)
	reflection.Register(grpcServer)

	// HTTP server for n8n webhooks
	n8nHdl := handler.NewN8nHandler(svc)
	mux := http.NewServeMux()
	mux.HandleFunc("/webhooks/n8n/place-order",  n8nHdl.PlaceOrderWebhook)
	mux.HandleFunc("/webhooks/n8n/cancel-order", n8nHdl.CancelOrderWebhook)
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) })
	httpServer := &http.Server{Addr: fmt.Sprintf(":%s", cfg.HTTPPort), Handler: mux}

	slog.Info("trading service starting", "grpc_port", cfg.GRPCPort, "http_port", cfg.HTTPPort)

	go func() {
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("http server error", "error", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-quit
		slog.Info("shutting down trading service")
		grpcServer.GracefulStop()
		httpServer.Shutdown(ctx)
		cancel()
	}()

	if err := grpcServer.Serve(lis); err != nil {
		slog.Error("grpc server error", "error", err)
		os.Exit(1)
	}
}
