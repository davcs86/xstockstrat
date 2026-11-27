package middleware

import (
	"context"

	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
)

type propKey struct{}

// PropagationData holds the three upstream-propagation headers.
type PropagationData struct {
	UserID      string
	AccessScope string
	TraceID     string
}

// FromContext retrieves PropagationData stored by UnaryServerInterceptor.
func FromContext(ctx context.Context) PropagationData {
	v, _ := ctx.Value(propKey{}).(PropagationData)
	return v
}

// WithPropagationData injects PropagationData into ctx (test seam for setting
// x-user-id / x-access-scope without the gRPC interceptor chain).
func WithPropagationData(ctx context.Context, data PropagationData) context.Context {
	return context.WithValue(ctx, propKey{}, data)
}

// UnaryServerInterceptor extracts x-user-id, x-access-scope, x-trace-id from incoming
// metadata and stores them in context for use by client interceptors downstream.
func UnaryServerInterceptor(ctx context.Context, req interface{}, _ *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (interface{}, error) {
	return handler(withIncomingPropagation(ctx), req)
}

// StreamServerInterceptor gives stream handlers the same PropagationData as
// UnaryServerInterceptor, via the wrapped stream's Context().
func StreamServerInterceptor(srv interface{}, ss grpc.ServerStream, _ *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
	return handler(srv, &propagatedStream{ServerStream: ss})
}

type propagatedStream struct {
	grpc.ServerStream
}

func (s *propagatedStream) Context() context.Context {
	return withIncomingPropagation(s.ServerStream.Context())
}

func withIncomingPropagation(ctx context.Context) context.Context {
	md, _ := metadata.FromIncomingContext(ctx)
	return context.WithValue(ctx, propKey{}, PropagationData{
		UserID:      first(md.Get("x-user-id")),
		AccessScope: first(md.Get("x-access-scope")),
		TraceID:     first(md.Get("x-trace-id")),
	})
}

// UnaryClientInterceptor reads PropagationData from context and injects the three headers
// into outgoing upstream gRPC metadata (request direction only — never set on responses).
func UnaryClientInterceptor(ctx context.Context, method string, req, reply interface{}, cc *grpc.ClientConn, invoker grpc.UnaryInvoker, opts ...grpc.CallOption) error {
	data := FromContext(ctx)
	if data.UserID != "" || data.AccessScope != "" || data.TraceID != "" {
		ctx = metadata.AppendToOutgoingContext(ctx,
			"x-user-id", data.UserID,
			"x-access-scope", data.AccessScope,
			"x-trace-id", data.TraceID,
		)
	}
	return invoker(ctx, method, req, reply, cc, opts...)
}

func first(vals []string) string {
	if len(vals) == 0 {
		return ""
	}
	return vals[0]
}
