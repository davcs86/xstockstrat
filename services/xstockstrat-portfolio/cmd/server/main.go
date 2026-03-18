package main

import (
	"context"
	"encoding/json"
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

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	portfoliov1 "github.com/xstockstrat/contracts/gen/go/portfolio/v1"
	portfoliov1connect "github.com/xstockstrat/contracts/gen/go/portfolio/v1/portfoliov1connect"
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
	portfoliov1.RegisterPortfolioServiceServer(grpcServer, hdl.GRPCHandler())
	reflection.Register(grpcServer)

	// Connect-RPC HTTP server (port 8052) — supports HTTP/1.1 + HTTP/2 via h2c
	connectPath, connectHdl := portfoliov1connect.NewPortfolioServiceHandler(
		hdl,
		connect.WithInterceptors(),
	)
	mux := http.NewServeMux()
	mux.Handle(connectPath, connectHdl)
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) })
	mux.HandleFunc("/webhooks/n8n/portfolio-report", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var body struct {
			UserID string `json:"user_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid json", http.StatusBadRequest)
			return
		}
		if body.UserID == "" {
			http.Error(w, "user_id required", http.StatusBadRequest)
			return
		}
		portfolio, err := svc.GetPortfolio(r.Context(), &portfoliov1.GetPortfolioRequest{
			UserId:      body.UserID,
			TradingMode: commonv1.TradingMode_TRADING_MODE_PAPER,
		})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"user_id":        portfolio.UserId,
			"equity":         portfolio.Equity,
			"positions":      len(portfolio.Positions),
			"day_pnl":        portfolio.DayPnl,
		})
	})
	httpServer := &http.Server{
		Addr:    fmt.Sprintf(":%s", cfg.HTTPPort),
		Handler: h2c.NewHandler(mux, &http2.Server{}),
	}

	slog.Info("portfolio service starting", "grpc_port", cfg.GRPCPort, "http_port", cfg.HTTPPort)

	go func() {
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("http server error", "error", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-quit
		slog.Info("shutting down portfolio service")
		grpcServer.GracefulStop()
		httpServer.Shutdown(ctx)
		cancel()
	}()

	if err := grpcServer.Serve(lis); err != nil {
		slog.Error("server error", "error", err)
		os.Exit(1)
	}
}
