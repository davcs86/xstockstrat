package config

import (
	"context"
	"errors"
	"testing"

	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"

	configv1 "github.com/xstockstrat/contracts/gen/go/config/v1"
)

func TestLoadFromEnv_Defaults(t *testing.T) {
	cfg := LoadFromEnv()

	if cfg.GRPCPort != "50051" {
		t.Errorf("GRPCPort default: got %q, want %q", cfg.GRPCPort, "50051")
	}
	if cfg.ConfigEndpoint != "xstockstrat-config:50060" {
		t.Errorf("ConfigEndpoint default: got %q", cfg.ConfigEndpoint)
	}
	if cfg.LedgerEndpoint != "xstockstrat-ledger:50057" {
		t.Errorf("LedgerEndpoint default: got %q", cfg.LedgerEndpoint)
	}
	if cfg.TradingMode != "paper" {
		t.Errorf("TradingMode default: got %q, want paper", cfg.TradingMode)
	}
	if cfg.ApplicationEnv != "development" {
		t.Errorf("ApplicationEnv default: got %q, want development", cfg.ApplicationEnv)
	}
}

func TestLoadFromEnv_Overrides(t *testing.T) {
	t.Setenv("GRPC_PORT", "50099")
	t.Setenv("TRADING_MODE", "live")
	t.Setenv("APPLICATION_ENV", "production")

	cfg := LoadFromEnv()

	if cfg.GRPCPort != "50099" {
		t.Errorf("GRPCPort override: got %q, want %q", cfg.GRPCPort, "50099")
	}
	if cfg.TradingMode != "live" {
		t.Errorf("TradingMode override: got %q", cfg.TradingMode)
	}
	if cfg.ApplicationEnv != "production" {
		t.Errorf("ApplicationEnv override: got %q", cfg.ApplicationEnv)
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
		t.Setenv("TEST_BOOL_KEY", tt.envVal)
		if tt.envVal == "" {
			// clear the env to test the fallback path
			t.Setenv("TEST_BOOL_KEY", "")
		}
		got := getEnvBool("TEST_BOOL_KEY", tt.fallback)
		if got != tt.want {
			t.Errorf("getEnvBool(%q, %v) = %v, want %v", tt.envVal, tt.fallback, got, tt.want)
		}
	}
}

// fakeConfigServiceClient implements configv1.ConfigServiceClient narrowly — only
// SetConfig is exercised by Watcher.SetConfig's tests below; every other method panics if
// called (feature 102 — mirrors 030's fakeBroker narrow-interface-fake technique).
type fakeConfigServiceClient struct {
	setConfigFn func(ctx context.Context, in *configv1.SetConfigRequest, opts ...grpc.CallOption) (*configv1.SetConfigResponse, error)
}

func (f *fakeConfigServiceClient) WatchConfig(ctx context.Context, in *configv1.WatchConfigRequest, opts ...grpc.CallOption) (grpc.ServerStreamingClient[configv1.ConfigSnapshot], error) {
	panic("fakeConfigServiceClient.WatchConfig not implemented")
}

func (f *fakeConfigServiceClient) GetConfig(ctx context.Context, in *configv1.GetConfigRequest, opts ...grpc.CallOption) (*configv1.ConfigSnapshot, error) {
	panic("fakeConfigServiceClient.GetConfig not implemented")
}

func (f *fakeConfigServiceClient) SetConfig(ctx context.Context, in *configv1.SetConfigRequest, opts ...grpc.CallOption) (*configv1.SetConfigResponse, error) {
	return f.setConfigFn(ctx, in, opts...)
}

func (f *fakeConfigServiceClient) ListKeys(ctx context.Context, in *configv1.ListKeysRequest, opts ...grpc.CallOption) (*configv1.ListKeysResponse, error) {
	panic("fakeConfigServiceClient.ListKeys not implemented")
}

var _ configv1.ConfigServiceClient = (*fakeConfigServiceClient)(nil)

func TestWatcher_SetConfig_AttachesMetadata(t *testing.T) {
	var capturedCallerID, capturedTraceID string
	var traceIDPresent bool
	fake := &fakeConfigServiceClient{
		setConfigFn: func(ctx context.Context, in *configv1.SetConfigRequest, opts ...grpc.CallOption) (*configv1.SetConfigResponse, error) {
			md, ok := metadata.FromOutgoingContext(ctx)
			if !ok {
				t.Fatal("expected outgoing metadata on the context")
			}
			if vals := md.Get("x-internal-caller"); len(vals) > 0 {
				capturedCallerID = vals[0]
			}
			if vals := md.Get("x-trace-id"); len(vals) > 0 {
				capturedTraceID = vals[0]
				traceIDPresent = true
			}
			return &configv1.SetConfigResponse{}, nil
		},
	}
	w := &Watcher{client: fake}

	_, err := w.SetConfig(context.Background(), "trading-reconciliation-poller", &configv1.SetConfigRequest{
		Namespace: "platform", Key: "trading_state",
	})
	if err != nil {
		t.Fatalf("SetConfig failed: %v", err)
	}
	if capturedCallerID != "trading-reconciliation-poller" {
		t.Errorf("x-internal-caller = %q, want %q", capturedCallerID, "trading-reconciliation-poller")
	}
	if !traceIDPresent || capturedTraceID == "" {
		t.Error("expected a non-empty x-trace-id on the outgoing context")
	}
}

func TestWatcher_SetConfig_ReturnsUnderlyingError(t *testing.T) {
	wantErr := errors.New("boom")
	fake := &fakeConfigServiceClient{
		setConfigFn: func(ctx context.Context, in *configv1.SetConfigRequest, opts ...grpc.CallOption) (*configv1.SetConfigResponse, error) {
			return nil, wantErr
		},
	}
	w := &Watcher{client: fake}

	_, err := w.SetConfig(context.Background(), "trading-reconciliation-poller", &configv1.SetConfigRequest{})
	if !errors.Is(err, wantErr) {
		t.Errorf("SetConfig error = %v, want %v (unwrapped passthrough)", err, wantErr)
	}
}
