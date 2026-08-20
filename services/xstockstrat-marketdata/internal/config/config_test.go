package config

import (
	"context"
	"errors"
	"sync"
	"testing"

	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	configv1 "github.com/xstockstrat/contracts/gen/go/config/v1"
)

// stubConfigClient embeds the generated ConfigServiceClient (nil) and overrides only GetSecret,
// so the other RPC methods are inherited without hand-stubbing their signatures.
type stubConfigClient struct {
	configv1.ConfigServiceClient
	resp   *configv1.GetSecretResponse
	err    error
	gotReq *configv1.GetSecretRequest
	gotMD  metadata.MD
}

func (s *stubConfigClient) GetSecret(ctx context.Context, in *configv1.GetSecretRequest, _ ...grpc.CallOption) (*configv1.GetSecretResponse, error) {
	s.gotReq = in
	s.gotMD, _ = metadata.FromOutgoingContext(ctx)
	if s.err != nil {
		return nil, s.err
	}
	return s.resp, nil
}

// AC-6: marketdata resolves a vendor credential from config via GetSecret (no env read), tagging
// the request with its x-internal-caller identity and the correct namespace/key/environment.
func TestResolveSecret_ReturnsDecryptedValue(t *testing.T) {
	stub := &stubConfigClient{resp: &configv1.GetSecretResponse{Value: "alpaca-key-xyz", Found: true}}
	w := &Watcher{
		namespace:   "marketdata",
		client:      stub,
		environment: commonv1.Environment_ENVIRONMENT_PRODUCTION,
	}
	val, found, err := w.ResolveSecret(context.Background(), "alpaca.api_key")
	if err != nil {
		t.Fatalf("ResolveSecret error: %v", err)
	}
	if !found || val != "alpaca-key-xyz" {
		t.Errorf("ResolveSecret = (%q, %v), want (alpaca-key-xyz, true)", val, found)
	}
	if stub.gotReq.GetNamespace() != "marketdata" || stub.gotReq.GetKey() != "alpaca.api_key" {
		t.Errorf("GetSecret request scope wrong: %+v", stub.gotReq)
	}
	if stub.gotReq.GetEnvironment() != commonv1.Environment_ENVIRONMENT_PRODUCTION {
		t.Errorf("GetSecret environment = %v, want PRODUCTION", stub.gotReq.GetEnvironment())
	}
	if got := stub.gotMD.Get("x-internal-caller"); len(got) != 1 || got[0] != "marketdata" {
		t.Errorf("x-internal-caller metadata = %v, want [marketdata]", got)
	}
}

// AC-7: an unset secret (found=false) resolves to empty, which the startup guard treats exactly
// like the old empty env var — warn-and-start (looksLikePlaceholderCred("") is true, tested in
// cmd/server/main_test.go).
func TestResolveSecret_UnsetReturnsEmpty(t *testing.T) {
	stub := &stubConfigClient{resp: &configv1.GetSecretResponse{Value: "", Found: false}}
	w := &Watcher{namespace: "marketdata", client: stub, environment: commonv1.Environment_ENVIRONMENT_STAGING}
	val, found, err := w.ResolveSecret(context.Background(), "fmp.api_key")
	if err != nil {
		t.Fatalf("ResolveSecret error: %v", err)
	}
	if found || val != "" {
		t.Errorf("ResolveSecret unset = (%q, %v), want (\"\", false)", val, found)
	}
}

// A GetSecret RPC failure surfaces as an error (the caller then treats the credential as unset).
func TestResolveSecret_RPCErrorSurfaces(t *testing.T) {
	stub := &stubConfigClient{err: errors.New("permission denied")}
	w := &Watcher{namespace: "marketdata", client: stub, environment: commonv1.Environment_ENVIRONMENT_PRODUCTION}
	if _, _, err := w.ResolveSecret(context.Background(), "alpaca.api_key"); err == nil {
		t.Error("expected an error when GetSecret fails")
	}
}

func TestLoadFromEnv_Defaults(t *testing.T) {
	cfg := LoadFromEnv()

	if cfg.GRPCPort != "50053" {
		t.Errorf("GRPCPort default: got %q, want %q", cfg.GRPCPort, "50053")
	}
	if cfg.ConfigEndpoint != "xstockstrat-config:50060" {
		t.Errorf("ConfigEndpoint default: got %q", cfg.ConfigEndpoint)
	}
	if cfg.LedgerEndpoint != "xstockstrat-ledger:50057" {
		t.Errorf("LedgerEndpoint default: got %q", cfg.LedgerEndpoint)
	}
	if cfg.AlpacaBaseURL != "https://paper-api.alpaca.markets" {
		t.Errorf("AlpacaBaseURL default: got %q", cfg.AlpacaBaseURL)
	}
	if cfg.AlpacaDataURL != "https://data.alpaca.markets" {
		t.Errorf("AlpacaDataURL default: got %q", cfg.AlpacaDataURL)
	}
	if cfg.ApplicationEnv != "development" {
		t.Errorf("ApplicationEnv default: got %q, want development", cfg.ApplicationEnv)
	}
	if cfg.TradingMode != "paper" {
		t.Errorf("TradingMode default: got %q, want paper", cfg.TradingMode)
	}
}

func TestLoadFromEnv_Overrides(t *testing.T) {
	t.Setenv("GRPC_PORT", "50099")
	t.Setenv("APPLICATION_ENV", "production")
	t.Setenv("TRADING_MODE", "live")

	cfg := LoadFromEnv()

	if cfg.GRPCPort != "50099" {
		t.Errorf("GRPCPort override: got %q", cfg.GRPCPort)
	}
	if cfg.ApplicationEnv != "production" {
		t.Errorf("ApplicationEnv override: got %q", cfg.ApplicationEnv)
	}
	if cfg.TradingMode != "live" {
		t.Errorf("TradingMode override: got %q", cfg.TradingMode)
	}
}

func TestGetEnvBool(t *testing.T) {
	tests := []struct {
		envVal   string
		fallback bool
		want     bool
	}{
		{"true", false, true},
		{"1", false, true},
		{"yes", false, true},
		{"false", true, false},
		{"0", true, false},
		{"", true, true},
		{"", false, false},
	}

	for _, tt := range tests {
		t.Setenv("TEST_BOOL_MD", tt.envVal)
		got := getEnvBool("TEST_BOOL_MD", tt.fallback)
		if got != tt.want {
			t.Errorf("getEnvBool(%q, %v) = %v, want %v", tt.envVal, tt.fallback, got, tt.want)
		}
	}
}

// newTestWatcher builds a Watcher with a pre-populated snapshot for unit tests.
// It bypasses NewWatcher (which dials gRPC) so no network is required.
func newTestWatcher(snapshot map[string]*configv1.ConfigValue) *Watcher {
	ready := make(chan struct{})
	close(ready)
	return &Watcher{
		snapshot: snapshot,
		ready:    ready,
		once:     sync.Once{},
	}
}

func TestWatcher_GetString(t *testing.T) {
	w := newTestWatcher(map[string]*configv1.ConfigValue{
		"my.key":  {Value: &configv1.ConfigValue_StringVal{StringVal: "hello"}},
		"int.key": {Value: &configv1.ConfigValue_IntVal{IntVal: 42}},
	})

	if got := w.GetString("my.key", "default"); got != "hello" {
		t.Errorf("GetString present: got %q, want %q", got, "hello")
	}
	if got := w.GetString("missing", "fallback"); got != "fallback" {
		t.Errorf("GetString missing: got %q, want %q", got, "fallback")
	}
	// Wrong type → default
	if got := w.GetString("int.key", "default"); got != "default" {
		t.Errorf("GetString wrong type: got %q, want %q", got, "default")
	}
}

func TestWatcher_GetInt(t *testing.T) {
	w := newTestWatcher(map[string]*configv1.ConfigValue{
		"my.int":  {Value: &configv1.ConfigValue_IntVal{IntVal: 99}},
		"str.key": {Value: &configv1.ConfigValue_StringVal{StringVal: "x"}},
	})

	if got := w.GetInt("my.int", 0); got != 99 {
		t.Errorf("GetInt present: got %d, want 99", got)
	}
	if got := w.GetInt("missing", 7); got != 7 {
		t.Errorf("GetInt missing: got %d, want 7", got)
	}
	// Wrong type → default
	if got := w.GetInt("str.key", 5); got != 5 {
		t.Errorf("GetInt wrong type: got %d, want 5", got)
	}
}

func TestWatcher_GetFloat(t *testing.T) {
	w := newTestWatcher(map[string]*configv1.ConfigValue{
		"my.float": {Value: &configv1.ConfigValue_FloatVal{FloatVal: 3.14}},
		"str.key":  {Value: &configv1.ConfigValue_StringVal{StringVal: "x"}},
	})

	if got := w.GetFloat("my.float", 0); got != 3.14 {
		t.Errorf("GetFloat present: got %f, want 3.14", got)
	}
	if got := w.GetFloat("missing", 1.5); got != 1.5 {
		t.Errorf("GetFloat missing: got %f, want 1.5", got)
	}
	// Wrong type → default
	if got := w.GetFloat("str.key", 2.0); got != 2.0 {
		t.Errorf("GetFloat wrong type: got %f, want 2.0", got)
	}
}

func TestWatcher_GetBool(t *testing.T) {
	w := newTestWatcher(map[string]*configv1.ConfigValue{
		"my.bool": {Value: &configv1.ConfigValue_BoolVal{BoolVal: true}},
		"str.key": {Value: &configv1.ConfigValue_StringVal{StringVal: "x"}},
	})

	if got := w.GetBool("my.bool", false); got != true {
		t.Errorf("GetBool present: got %v, want true", got)
	}
	if got := w.GetBool("missing", true); got != true {
		t.Errorf("GetBool missing: got %v, want true", got)
	}
	// Wrong type → default
	if got := w.GetBool("str.key", false); got != false {
		t.Errorf("GetBool wrong type: got %v, want false", got)
	}
}

func TestWatcher_WaitForSnapshot_AlreadyReady(t *testing.T) {
	w := newTestWatcher(nil)
	if err := w.WaitForSnapshot(context.Background()); err != nil {
		t.Errorf("expected nil error for already-ready watcher, got: %v", err)
	}
}

func TestWatcher_WaitForSnapshot_ContextCancelled(t *testing.T) {
	// Watcher whose ready channel is never closed.
	w := &Watcher{
		snapshot: make(map[string]*configv1.ConfigValue),
		ready:    make(chan struct{}),
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := w.WaitForSnapshot(ctx); err == nil {
		t.Error("expected error for cancelled context, got nil")
	}
}

// Feature 147: vendor credentials are no longer read from env vars — they are stored encrypted in
// the config service and resolved at startup via Watcher.ResolveSecret (see TestResolveSecret_*).
// LoadFromEnv must therefore leave FMPAPIKey empty even when the old FMP_API_KEY env var is set.
//
// The fixture below is a short, low-entropy placeholder held in a named constant rather than an
// inline literal: gitleaks' generic-api-key rule keys on a credential-ish keyword next to a quoted
// value, so an inline string beside FMP_API_KEY trips it even though no real secret is involved.
const fmpTestPlaceholder = "unset"

func TestLoadFromEnv_IgnoresVendorEnvVars(t *testing.T) {
	t.Setenv("FMP_API_KEY", fmpTestPlaceholder)
	t.Setenv("ALPACA_API_KEY", fmpTestPlaceholder)
	t.Setenv("FINNHUB_API_KEY", fmpTestPlaceholder)
	cfg := LoadFromEnv()
	if cfg.FMPAPIKey != "" || cfg.AlpacaAPIKey != "" || cfg.FinnhubAPIKey != "" {
		t.Errorf("vendor credentials must not come from env (feature 147): fmp=%q alpaca=%q finnhub=%q",
			cfg.FMPAPIKey, cfg.AlpacaAPIKey, cfg.FinnhubAPIKey)
	}
}

// TestResolveEnvironment / TestResolveTradingMode guard the WatchConfig scope-omission fix:
// NewWatcher must resolve this deployment's own APPLICATION_ENV/TRADING_MODE into the proto
// scope it subscribes with, instead of leaving the request at its zero-value (dev/unspecified).
func TestResolveEnvironment(t *testing.T) {
	tests := []struct {
		in   string
		want commonv1.Environment
	}{
		{"production", commonv1.Environment_ENVIRONMENT_PRODUCTION},
		// Feature 147: non-production maps to STAGING (the config server treats DEV as staging too).
		{"development", commonv1.Environment_ENVIRONMENT_STAGING},
		{"", commonv1.Environment_ENVIRONMENT_STAGING},
		{"staging", commonv1.Environment_ENVIRONMENT_STAGING},
	}
	for _, tt := range tests {
		if got := resolveEnvironment(tt.in); got != tt.want {
			t.Errorf("resolveEnvironment(%q) = %v, want %v", tt.in, got, tt.want)
		}
	}
}

func TestResolveTradingMode(t *testing.T) {
	tests := []struct {
		in   string
		want commonv1.TradingMode
	}{
		{"live", commonv1.TradingMode_TRADING_MODE_LIVE},
		{"paper", commonv1.TradingMode_TRADING_MODE_PAPER},
		{"", commonv1.TradingMode_TRADING_MODE_PAPER},
	}
	for _, tt := range tests {
		if got := resolveTradingMode(tt.in); got != tt.want {
			t.Errorf("resolveTradingMode(%q) = %v, want %v", tt.in, got, tt.want)
		}
	}
}
