package middleware_test

import (
	"context"
	"testing"

	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"

	"github.com/xstockstrat/marketdata/internal/middleware"
)

func TestFromContext_Empty(t *testing.T) {
	data := middleware.FromContext(context.Background())
	if data.UserID != "" || data.AccessScope != "" || data.TraceID != "" {
		t.Errorf("expected empty PropagationData, got %+v", data)
	}
}

func TestUnaryServerInterceptor_WithMetadata(t *testing.T) {
	md := metadata.Pairs(
		"x-user-id", "user-42",
		"x-access-scope", "read:all",
		"x-trace-id", "trace-abc",
	)
	ctx := metadata.NewIncomingContext(context.Background(), md)

	var captured middleware.PropagationData
	_, err := middleware.UnaryServerInterceptor(ctx, nil, nil,
		func(ctx context.Context, req interface{}) (interface{}, error) {
			captured = middleware.FromContext(ctx)
			return nil, nil
		},
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if captured.UserID != "user-42" {
		t.Errorf("UserID: got %q, want %q", captured.UserID, "user-42")
	}
	if captured.AccessScope != "read:all" {
		t.Errorf("AccessScope: got %q, want %q", captured.AccessScope, "read:all")
	}
	if captured.TraceID != "trace-abc" {
		t.Errorf("TraceID: got %q, want %q", captured.TraceID, "trace-abc")
	}
}

func TestUnaryServerInterceptor_NoMetadata(t *testing.T) {
	var captured middleware.PropagationData
	_, err := middleware.UnaryServerInterceptor(context.Background(), nil, nil,
		func(ctx context.Context, req interface{}) (interface{}, error) {
			captured = middleware.FromContext(ctx)
			return nil, nil
		},
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if captured.UserID != "" || captured.AccessScope != "" || captured.TraceID != "" {
		t.Errorf("expected empty data with no metadata, got %+v", captured)
	}
}

func TestUnaryClientInterceptor_WithData(t *testing.T) {
	ctx := context.WithValue(context.Background(), struct{ middleware.PropagationData }{},
		middleware.PropagationData{UserID: "u1", AccessScope: "rw", TraceID: "t1"},
	)
	// Inject propagation data via the server interceptor so it's stored under the right key.
	md := metadata.Pairs(
		"x-user-id", "u1",
		"x-access-scope", "rw",
		"x-trace-id", "t1",
	)
	incomingCtx := metadata.NewIncomingContext(context.Background(), md)
	var serverCtx context.Context
	_, _ = middleware.UnaryServerInterceptor(incomingCtx, nil, nil,
		func(c context.Context, _ interface{}) (interface{}, error) {
			serverCtx = c
			return nil, nil
		},
	)
	_ = ctx

	var outgoingMD metadata.MD
	invoker := func(ctx context.Context, _ string, _, _ interface{}, _ *grpc.ClientConn, _ ...grpc.CallOption) error {
		outgoingMD, _ = metadata.FromOutgoingContext(ctx)
		return nil
	}
	if err := middleware.UnaryClientInterceptor(serverCtx, "/svc/Method", nil, nil, nil, invoker); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(outgoingMD.Get("x-user-id")) == 0 || outgoingMD.Get("x-user-id")[0] != "u1" {
		t.Errorf("x-user-id not propagated: %v", outgoingMD)
	}
	if len(outgoingMD.Get("x-trace-id")) == 0 || outgoingMD.Get("x-trace-id")[0] != "t1" {
		t.Errorf("x-trace-id not propagated: %v", outgoingMD)
	}
}

func TestUnaryClientInterceptor_NoData(t *testing.T) {
	var invokerCalled bool
	var outgoingMD metadata.MD
	invoker := func(ctx context.Context, _ string, _, _ interface{}, _ *grpc.ClientConn, _ ...grpc.CallOption) error {
		invokerCalled = true
		outgoingMD, _ = metadata.FromOutgoingContext(ctx)
		return nil
	}
	if err := middleware.UnaryClientInterceptor(context.Background(), "/svc/Method", nil, nil, nil, invoker); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !invokerCalled {
		t.Fatal("invoker was not called")
	}
	// No propagation headers should be injected when data is empty.
	if len(outgoingMD.Get("x-user-id")) != 0 {
		t.Errorf("expected no x-user-id header, got %v", outgoingMD)
	}
}
