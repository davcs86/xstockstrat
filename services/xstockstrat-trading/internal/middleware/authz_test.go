package middleware

import (
	"context"
	"testing"

	"google.golang.org/grpc/codes"
	grpcstatus "google.golang.org/grpc/status"
)

func ctxWithScope(scope string) context.Context {
	return context.WithValue(context.Background(), propKey{}, PropagationData{AccessScope: scope})
}

func TestRequireAdminScope_AdminAllowed(t *testing.T) {
	// Scope "4" == 0x04 — exactly the admin bit.
	if err := RequireAdminScope(ctxWithScope("4")); err != nil {
		t.Fatalf("expected nil, got %v", err)
	}
}

func TestRequireAdminScope_AdminWithOtherBits(t *testing.T) {
	// Scope "7" == 0x07 — admin (0x04) + trader (0x02) + viewer (0x01).
	if err := RequireAdminScope(ctxWithScope("7")); err != nil {
		t.Fatalf("expected nil, got %v", err)
	}
}

func TestRequireAdminScope_TraderDenied(t *testing.T) {
	// Scope "2" == 0x02 — trader only, no admin bit.
	err := RequireAdminScope(ctxWithScope("2"))
	if err == nil {
		t.Fatal("expected PermissionDenied, got nil")
	}
	if s, ok := grpcstatus.FromError(err); !ok || s.Code() != codes.PermissionDenied {
		t.Fatalf("expected PermissionDenied, got %v", err)
	}
}

func TestRequireAdminScope_EmptyDenied(t *testing.T) {
	err := RequireAdminScope(ctxWithScope(""))
	if err == nil {
		t.Fatal("expected PermissionDenied, got nil")
	}
	if s, ok := grpcstatus.FromError(err); !ok || s.Code() != codes.PermissionDenied {
		t.Fatalf("expected PermissionDenied, got %v", err)
	}
}

func TestRequireAdminScope_NonNumericDenied(t *testing.T) {
	err := RequireAdminScope(ctxWithScope("abc"))
	if err == nil {
		t.Fatal("expected PermissionDenied, got nil")
	}
	if s, ok := grpcstatus.FromError(err); !ok || s.Code() != codes.PermissionDenied {
		t.Fatalf("expected PermissionDenied, got %v", err)
	}
}
