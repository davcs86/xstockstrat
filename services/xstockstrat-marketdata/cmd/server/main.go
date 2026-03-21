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
	"time"

	"connectrpc.com/connect"
	"go.opentelemetry.io/contrib/instrumentation/google.golang.org/grpc/otelgrpc"
	"golang.org/x/net/http2"
	"golang.org/x/net/http2/h2c"
	"google.golang.org/grpc"
	"google.golang.org/grpc/keepalive"
	"google.golang.org/grpc/reflection"
	"google.golang.org/protobuf/types/known/timestamppb"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	marketdatav1 "github.com/xstockstrat/contracts/gen/go/marketdata/v1"
	marketdatav1connect "github.com/xstockstrat/contracts/gen/go/marketdata/v1/marketdatav1connect"
	"github.com/xstockstrat/marketdata/internal/alpaca"
	"github.com/xstockstrat/marketdata/internal/config"
	"github.com/xstockstrat/marketdata/internal/handler"
	"github.com/xstockstrat/marketdata/internal/repository"
	"github.com/xstockstrat/marketdata/internal/service"
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
		Paper:     cfg.AlpacaPaper,
	})

	// TimescaleDB repository
	repo, err := repository.NewMarketDataRepo(cfg.DBConnStr)
	if err != nil {
		slog.Error("db connection failed", "error", err)
		os.Exit(1)
	}

	svc, err := service.NewMarketDataService(alpacaClient, repo, cfgWatcher, cfg.LedgerEndpoint, cfg.NotifyEndpoint)
	if err != nil {
		slog.Error("service init failed", "error", err)
		os.Exit(1)
	}
	hdl := handler.NewMarketDataHandler(svc)

	lis, err := net.Listen("tcp", fmt.Sprintf(":%s", cfg.GRPCPort))
	if err != nil {
		slog.Error("listen failed", "error", err)
		os.Exit(1)
	}

	grpcServer := grpc.NewServer(
		grpc.StatsHandler(otelgrpc.NewServerHandler()),
		grpc.KeepaliveParams(keepalive.ServerParameters{
			MaxConnectionIdle: 60 * time.Second,
			Time:              30 * time.Second,
			Timeout:           10 * time.Second,
		}),
	)
	marketdatav1.RegisterMarketDataServiceServer(grpcServer, hdl.GRPCHandler())
	reflection.Register(grpcServer)

	// Connect-RPC HTTP server (port 8053) — supports HTTP/1.1 + HTTP/2 via h2c
	connectPath, connectHdl := marketdatav1connect.NewMarketDataServiceHandler(
		hdl,
		connect.WithInterceptors(),
	)
	mux := http.NewServeMux()
	mux.Handle(connectPath, connectHdl)
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) })
	mux.HandleFunc("/webhooks/n8n/backfill", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var body struct {
			Symbols   []string `json:"symbols"`
			Timeframe string   `json:"timeframe"`
			Start     string   `json:"start"`
			End       string   `json:"end"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid json", http.StatusBadRequest)
			return
		}
		req := &marketdatav1.BackfillBarsRequest{
			Symbols:   body.Symbols,
			Timeframe: body.Timeframe,
		}
		if body.Start != "" {
			if t, err := time.Parse(time.RFC3339, body.Start); err == nil {
				req.Range = &commonv1.TimeRange{Start: timestamppb.New(t)}
			}
		}
		if body.End != "" {
			if t, err := time.Parse(time.RFC3339, body.End); err == nil {
				if req.Range == nil {
					req.Range = &commonv1.TimeRange{}
				}
				req.Range.End = timestamppb.New(t)
			}
		}
		go func() {
			resp, err := svc.BackfillBars(context.Background(), req)
			if err != nil {
				slog.Error("n8n backfill failed", "error", err)
				return
			}
			slog.Info("n8n backfill complete", "bars_written", resp.BarsWritten)
		}()
		w.WriteHeader(http.StatusAccepted)
		json.NewEncoder(w).Encode(map[string]string{"status": "backfill_started"})
	})
	mux.HandleFunc("/webhooks/n8n/subscribe", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var body struct {
			Symbols   []string `json:"symbols"`
			Timeframe string   `json:"timeframe"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid json", http.StatusBadRequest)
			return
		}
		if len(body.Symbols) == 0 {
			http.Error(w, "symbols required", http.StatusBadRequest)
			return
		}
		go svc.StartBarStream(ctx, body.Symbols, body.Timeframe)
		go svc.StartQuoteStream(ctx, body.Symbols)
		w.WriteHeader(http.StatusAccepted)
		json.NewEncoder(w).Encode(map[string]string{"status": "subscribed"})
	})
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
