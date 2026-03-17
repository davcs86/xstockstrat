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

	"connectrpc.com/connect"
	"golang.org/x/net/http2"
	"golang.org/x/net/http2/h2c"
	"google.golang.org/grpc"
	"google.golang.org/grpc/reflection"

	marketdatav1 "github.com/xstockstrat/contracts/gen/go/marketdata/v1"
	marketdatav1connect "github.com/xstockstrat/contracts/gen/go/marketdata/v1/marketdatav1connect"
	"github.com/xstockstrat/marketdata/internal/alpaca"
	"github.com/xstockstrat/marketdata/internal/config"
	"github.com/xstockstrat/marketdata/internal/handler"
	"github.com/xstockstrat/marketdata/internal/repository"
	"github.com/xstockstrat/marketdata/internal/service"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	cfg := config.LoadFromEnv()

	// WatchConfig subscription — required before accepting traffic
	cfgWatcher, err := config.NewWatcher(cfg.ConfigEndpoint, "marketdata")
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

	// Alpaca client — this service is the sole Alpaca integration point
	alpacaClient := alpaca.NewClient(alpaca.ClientConfig{
		APIKey:    cfg.AlpacaAPIKey,
		APISecret: cfg.AlpacaAPISecret,
		BaseURL:   cfg.AlpacaBaseURL,
		DataURL:   cfg.AlpacaDataURL,
		Paper:     cfg.AlpacaPaper,
	})

	// TimescaleDB repository
	repo, err := repository.NewMarketDataRepo(cfg.DBConnStr)
	if err != nil {
		slog.Error("db connection failed", "error", err)
		os.Exit(1)
	}

	svc := service.NewMarketDataService(alpacaClient, repo, cfgWatcher)
	hdl := handler.NewMarketDataHandler(svc)

	lis, err := net.Listen("tcp", fmt.Sprintf(":%s", cfg.GRPCPort))
	if err != nil {
		slog.Error("listen failed", "error", err)
		os.Exit(1)
	}

	grpcServer := grpc.NewServer()
	marketdatav1.RegisterMarketDataServiceServer(grpcServer, hdl)
	reflection.Register(grpcServer)

	// Connect-RPC HTTP server (port 8053) — supports HTTP/1.1 + HTTP/2 via h2c
	connectPath, connectHdl := marketdatav1connect.NewMarketDataServiceHandler(
		hdl,
		connect.WithInterceptors(),
	)
	mux := http.NewServeMux()
	mux.Handle(connectPath, connectHdl)
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) })
	httpServer := &http.Server{
		Addr:    fmt.Sprintf(":%s", cfg.HTTPPort),
		Handler: h2c.NewHandler(mux, &http2.Server{}),
	}

	slog.Info("marketdata service starting", "grpc_port", cfg.GRPCPort, "http_port", cfg.HTTPPort)

	go func() {
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("http server error", "error", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-quit
		slog.Info("shutting down marketdata service")
		grpcServer.GracefulStop()
		httpServer.Shutdown(ctx)
		cancel()
	}()

	if err := grpcServer.Serve(lis); err != nil {
		slog.Error("server error", "error", err)
		os.Exit(1)
	}
}
