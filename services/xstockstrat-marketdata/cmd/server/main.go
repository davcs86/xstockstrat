package main

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	"go.opentelemetry.io/contrib/instrumentation/google.golang.org/grpc/otelgrpc"
	"google.golang.org/grpc"
	"google.golang.org/grpc/health"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/keepalive"
	"google.golang.org/grpc/reflection"

	marketdatav1 "github.com/xstockstrat/contracts/gen/go/marketdata/v1"
	"github.com/xstockstrat/marketdata/internal/alpaca"
	"github.com/xstockstrat/marketdata/internal/config"
	"github.com/xstockstrat/marketdata/internal/edgar"
	"github.com/xstockstrat/marketdata/internal/finnhub"
	"github.com/xstockstrat/marketdata/internal/fmp"
	"github.com/xstockstrat/marketdata/internal/handler"
	"github.com/xstockstrat/marketdata/internal/middleware"
	"github.com/xstockstrat/marketdata/internal/mtls"
	"github.com/xstockstrat/marketdata/internal/repository"
	"github.com/xstockstrat/marketdata/internal/service"
	"github.com/xstockstrat/marketdata/internal/source"
	"github.com/xstockstrat/marketdata/internal/telemetry"
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

	shutdownOtel, forceFlushOtel, err := telemetry.Init(ctx)
	if err != nil {
		slog.Warn("otel init failed — continuing without telemetry export", "error", err)
	} else {
		slog.SetDefault(slog.New(telemetry.WrapLogHandler(logger.Handler())))
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

	// A resolve failure or unset secret leaves the credential empty (warn-and-start), never fails
	// startup — the Alpaca placeholder guard below is the only hard check.
	secrets := newLiveSecrets(cfgWatcher.ResolveSecret, time.Sleep)
	secrets.load(ctx)
	secrets.bindRefresh(ctx, cfgWatcher)
	alpacaKey, alpacaSecret := secrets.accessor("alpaca.api_key"), secrets.accessor("alpaca.api_secret")

	// Alpaca client — this service is the sole Alpaca integration point
	alpacaClient := alpaca.NewLiveClient(func() alpaca.Settings {
		return alpaca.Settings{
			APIKey:    alpacaKey(),
			APISecret: alpacaSecret(),
			BaseURL:   cfg.AlpacaBaseURL,
			DataURL:   cfg.AlpacaDataURL,
			// Default "iex": the free/basic paper data plan rejects Alpaca's SIP default with 403.
			Feed: cfgWatcher.GetString("alpaca.feed", "iex"),
			// Default "all" so splits/dividends do not distort backtest OHLCV.
			Adjustment: cfgWatcher.GetString("alpaca.adjustment", "all"),
			// Per-request bar limit (clamped to the spec max 10000) and outbound REST rate limit.
			BatchSize:    int(cfgWatcher.GetInt("backfill.batch_size", 1000)),
			RateLimitRPS: int(cfgWatcher.GetInt("backfill.rate_limit_rps", 200)),
			// Streaming WebSocket reconnect tuning.
			ReconnectDelayMs: int(cfgWatcher.GetInt("stream.reconnect_delay_ms", 2000)),
			MaxReconnects:    int(cfgWatcher.GetInt("stream.max_reconnects", 10)),
		}
	}, cfg.TradingMode == "paper")
	telemetry.RegisterStreamLastMessageAge(alpacaClient.StreamLastFrame, time.Now)

	// Fail loud on empty/placeholder Alpaca creds: they 401 every call with only an opaque
	// warm-poller warning otherwise. Non-fatal — cached reads and non-Alpaca RPCs still work.
	if looksLikePlaceholderCred(alpacaKey()) || looksLikePlaceholderCred(alpacaSecret()) {
		slog.Warn("ALPACA credentials look empty or are still set to a placeholder — "+
			"every Alpaca market-data call will fail with a 401; set the real "+
			"ALPACA_API_KEY/ALPACA_API_SECRET secrets",
			"api_key_placeholder", looksLikePlaceholderCred(alpacaKey()),
			"api_secret_placeholder", looksLikePlaceholderCred(alpacaSecret()))
	}

	// TimescaleDB repository
	repo, err := repository.NewMarketDataRepo(cfg.DBConnStr)
	if err != nil {
		slog.Error("db connection failed", "error", err)
		os.Exit(1)
	}
	telemetry.RegisterDBPoolStats(repo.PoolStats)

	reg := source.NewRegistry()
	reg.Register("alpaca", alpacaClient)

	// fundProvider is passed to BOTH the source selector and the service so they read the same live key.
	fundProvider := fundamentalsProvider(cfgWatcher)
	fmpClient := newFMPClient(cfgWatcher, secrets.accessor("fmp.api_key"))
	// Boot-seed the shared budget so a mid-day restart cannot re-grant a fresh full cap (today's
	// source='fmp' row count is a conservative floor of today's FMP calls), whatever fundProvider is.
	seedFMPBudget(ctx, repo, fmpClient)
	fundamentalsSrc := newFundamentalsSource(cfgWatcher, fundProvider, fmpClient, secrets.accessor("finnhub.api_key"))

	// Historical point-in-time fundamentals source (feature 198): SEC EDGAR, keyless (non-secret
	// User-Agent), held as its own service field and NEVER routed through newFundamentalsSource /
	// the marketdata.fundamentals.provider selector (FR-2 / T-3; preserves the feature-154 FMP cap).
	edgarClient := newEDGARClient(cfgWatcher)

	// The Alpaca client also serves cash-dividend corporate actions (feature 211, FR-4) — reuses
	// the resolved Alpaca creds; no new env var/secret. Nil-safe in the service if the feed errors.
	svc, err := service.NewMarketDataService(reg, repo, cfgWatcher, cfg.LedgerEndpoint, cfg.NotifyEndpoint, fundamentalsSrc, fundProvider, edgarClient, alpacaClient)
	if err != nil {
		slog.Error("service init failed", "error", err)
		os.Exit(1)
	}
	svc.SetClassification(repository.NewClassificationRepo(repo), fmpClient, fmpClient)
	svc.SetEtfFlagSource(fmpClient)
	hdl := handler.NewMarketDataHandler(svc)

	go svc.StartWarmQuotePoller(ctx)

	go svc.StartBarIngestPoller(ctx)

	go svc.StartClassificationRefreshPoller(ctx)

	go svc.StartEtfFlagFiller(ctx)

	go svc.StartAssetSetRefresher(ctx)

	go svc.StartQuoteRetention(ctx)

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
	marketdatav1.RegisterMarketDataServiceServer(grpcServer, hdl.GRPCHandler())
	hs := health.NewServer()
	healthpb.RegisterHealthServer(grpcServer, hs)
	reflection.Register(grpcServer)

	slog.Info("marketdata service starting", "grpc_port", cfg.GRPCPort)

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-quit
		slog.Info("shutting down marketdata service")
		hs.Shutdown()
		telemetry.StopServer(forceFlushOtel, grpcServer.GracefulStop, grpcServer.Stop, 2*time.Second, 3*time.Second)
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

// fundamentalsProvider reads marketdata.fundamentals.provider live; callers read it once per request.
func fundamentalsProvider(cfgWatcher *config.Watcher) func() string {
	return func() string { return cfgWatcher.GetString("fundamentals.provider", "finnhub") }
}

// newFundamentalsSource builds both concrete clients once and selects one per call from provider,
// so a provider switch needs no restart and the one *fmp.Client keeps owning the shared budget.
// Always non-nil; .enabled gates use, not this.
func newFundamentalsSource(cfgWatcher *config.Watcher, provider func() string, fmpClient *fmp.Client, finnhubAPIKey func() string) source.FundamentalsSource {
	finnhubClient := finnhub.NewClient(finnhub.ClientConfig{
		BaseURLFunc: func() string {
			return cfgWatcher.GetString("finnhub.base_url", "https://api.finnhub.io/api/v1")
		},
		APIKeyFunc: finnhubAPIKey,
	})
	return providerSource{provider: provider, fmp: fmpClient, finnhub: finnhubClient}
}

// providerSource routes each call to the client named by the live provider value.
type providerSource struct {
	provider func() string
	fmp      source.FundamentalsSource
	finnhub  source.FundamentalsSource
}

func (p providerSource) active() source.FundamentalsSource {
	switch provider := p.provider(); provider {
	case "finnhub":
		return p.finnhub
	default: // "fmp" and any unrecognized value fall back to the pre-existing FMP client
		// Feature 211 (F-07): an unrecognized provider is a config error, so log it LOUD — but still
		// fall back to FMP; a safe default beats failing the request on a config typo.
		if provider != "fmp" {
			slog.Warn("unrecognized marketdata.fundamentals.provider — falling back to fmp", "provider", provider)
		}
		return p.fmp
	}
}

func (p providerSource) GetFundamentals(ctx context.Context, symbol string) (*source.Fundamentals, error) {
	return p.active().GetFundamentals(ctx, symbol)
}

func (p providerSource) GetFundamentalsMulti(ctx context.Context, symbols []string) ([]*source.Fundamentals, error) {
	return p.active().GetFundamentalsMulti(ctx, symbols)
}

// newFMPClient builds the ONE *fmp.Client every FMP path shares (fundamentals, enrichment,
// classification) — a second instance would split the shared day budget into N×cap.
func newFMPClient(cfgWatcher *config.Watcher, apiKey func() string) *fmp.Client {
	return fmp.NewClient(fmp.ClientConfig{
		BaseURLFunc: func() string {
			return cfgWatcher.GetString("fmp.base_url", "https://financialmodelingprep.com")
		},
		APIKeyFunc: apiKey,
		MetricsFunc: func() []string {
			return strings.Split(cfgWatcher.GetString("fmp.metrics", "core,extended"), ",")
		},
		Limits: func() (float64, int) {
			return float64(cfgWatcher.GetInt("fmp.rate_limit_rps", 5)),
				int(cfgWatcher.GetInt("fmp.daily_request_cap", 250))
		},
	})
}

// newEDGARClient builds the keyless SEC EDGAR client; base URL, User-Agent and rps are read per request.
func newEDGARClient(cfgWatcher *config.Watcher) *edgar.Client {
	return edgar.NewLiveClient(func() edgar.Settings {
		return edgar.Settings{
			BaseURL:      cfgWatcher.GetString("edgar.base_url", "https://data.sec.gov"),
			UserAgent:    cfgWatcher.GetString("edgar.user_agent", "xstockstrat/1.0 (ops@xstockstrat.local)"),
			RateLimitRPS: int(cfgWatcher.GetInt("edgar.rate_limit_rps", 10)),
		}
	})
}

// secretResolver is the (*config.Watcher).ResolveSecret shape.
type secretResolver func(ctx context.Context, key string) (string, bool, error)

// vendorSecretKeys are the marketdata vendor credentials resolved via GetSecret.
var vendorSecretKeys = []string{"alpaca.api_key", "alpaca.api_secret", "fmp.api_key", "finnhub.api_key"}

// secretRetryDelays are the waits before each re-resolve retry (1 attempt + 3 retries).
var secretRetryDelays = []time.Duration{time.Second, 2 * time.Second, 4 * time.Second}

// liveSecrets holds the vendor credentials and re-resolves them after every config change.
// Secret values are never logged.
type liveSecrets struct {
	resolve secretResolver
	sleep   func(time.Duration)

	mu     sync.RWMutex
	values map[string]string
}

func newLiveSecrets(resolve secretResolver, sleep func(time.Duration)) *liveSecrets {
	return &liveSecrets{resolve: resolve, sleep: sleep, values: make(map[string]string)}
}

// load resolves every key once at boot; a failure or unset key leaves it empty (warn-and-start).
func (s *liveSecrets) load(ctx context.Context) {
	for _, key := range vendorSecretKeys {
		v, found, err := s.resolve(ctx, key)
		if err != nil {
			slog.WarnContext(ctx, "resolving vendor credential from config failed — treating as unset",
				"key", key, "error", err)
			continue
		}
		s.set(key, v, found)
	}
}

// bindRefresh re-resolves every key after each applied config update, off the watcher's hook;
// a burst of updates coalesces into one pending cycle.
func (s *liveSecrets) bindRefresh(ctx context.Context, w *config.Watcher) {
	pending := make(chan struct{}, 1)
	w.OnChange(func(string, string) {
		select {
		case pending <- struct{}{}:
		default:
		}
	})
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case <-pending:
				s.refresh(ctx)
			}
		}
	}()
}

// refresh re-resolves each key with retries; on final failure the previous value stays live.
func (s *liveSecrets) refresh(ctx context.Context) {
	for _, key := range vendorSecretKeys {
		v, found, err := s.resolve(ctx, key)
		for _, d := range secretRetryDelays {
			if err == nil {
				break
			}
			s.sleep(d)
			v, found, err = s.resolve(ctx, key)
		}
		if err != nil {
			slog.WarnContext(ctx, "re-resolving vendor credential failed after retries — keeping the previous value",
				"key", key, "error", err)
			continue
		}
		s.set(key, v, found)
	}
}

func (s *liveSecrets) set(key, v string, found bool) {
	if !found {
		v = ""
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.values[key] = v
}

// accessor returns a reader for key's current value.
func (s *liveSecrets) accessor(key string) func() string {
	return func() string {
		s.mu.RLock()
		defer s.mu.RUnlock()
		return s.values[key]
	}
}

// seedFMPBudget seeds the shared FMP budget from today's fmp-source row count; on error it starts from 0.
func seedFMPBudget(ctx context.Context, counter interface {
	CountFundamentalsFetchedToday(context.Context, string) (int, error)
}, b interface{ SeedBudget(int) }) {
	if n, err := counter.CountFundamentalsFetchedToday(ctx, fmp.SourceName); err == nil {
		b.SeedBudget(n)
	} else {
		slog.WarnContext(ctx, "FMP budget boot-seed failed; starting from 0", "error", err)
	}
}

func healthcheck() int {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := mtls.Probe(ctx, "127.0.0.1:"+config.LoadFromEnv().GRPCPort, "xstockstrat-marketdata"); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	return 0
}
