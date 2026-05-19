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

// UnaryServerInterceptor extracts x-user-id, x-access-scope, x-trace-id from incoming
// metadata and stores them in context for use by client interceptors downstream.
func UnaryServerInterceptor(ctx context.Context, req interface{}, _ *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (interface{}, error) {
	md, _ := metadata.FromIncomingContext(ctx)
	ctx = context.WithValue(ctx, propKey{}, PropagationData{
		UserID:      first(md.Get("x-user-id")),
		AccessScope: first(md.Get("x-access-scope")),
		TraceID:     first(md.Get("x-trace-id")),
	})
	return handler(ctx, req)
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
