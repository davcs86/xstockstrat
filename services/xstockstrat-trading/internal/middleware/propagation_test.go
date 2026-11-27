package middleware

import (
	"context"
	"testing"

	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
)

type fakeServerStream struct {
	grpc.ServerStream
	ctx context.Context
}

func (f *fakeServerStream) Context() context.Context { return f.ctx }

func incomingCtx() context.Context {
	return metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"x-user-id", "user-a",
		"x-access-scope", "3",
		"x-trace-id", "trace-1",
	))
}

func assertPropagation(t *testing.T, got PropagationData) {
	t.Helper()
	want := PropagationData{UserID: "user-a", AccessScope: "3", TraceID: "trace-1"}
	if got != want {
		t.Fatalf("PropagationData = %+v, want %+v", got, want)
	}
}

func TestStreamServerInterceptor_PopulatesPropagationData(t *testing.T) {
	called := false
	handler := func(_ interface{}, ss grpc.ServerStream) error {
		called = true
		assertPropagation(t, FromContext(ss.Context()))
		return nil
	}
	if err := StreamServerInterceptor(nil, &fakeServerStream{ctx: incomingCtx()}, &grpc.StreamServerInfo{}, handler); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !called {
		t.Fatal("handler was not called")
	}
}

func TestStreamServerInterceptor_NoMetadataYieldsEmptyIdentity(t *testing.T) {
	called := false
	handler := func(_ interface{}, ss grpc.ServerStream) error {
		called = true
		if got := FromContext(ss.Context()); got != (PropagationData{}) {
			t.Fatalf("PropagationData = %+v, want zero value", got)
		}
		return nil
	}
	if err := StreamServerInterceptor(nil, &fakeServerStream{ctx: context.Background()}, &grpc.StreamServerInfo{}, handler); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !called {
		t.Fatal("handler was not called")
	}
}

func TestUnaryServerInterceptor_PopulatesPropagationData(t *testing.T) {
	called := false
	handler := func(ctx context.Context, _ interface{}) (interface{}, error) {
		called = true
		assertPropagation(t, FromContext(ctx))
		return nil, nil
	}
	if _, err := UnaryServerInterceptor(incomingCtx(), nil, &grpc.UnaryServerInfo{}, handler); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !called {
		t.Fatal("handler was not called")
	}
}
