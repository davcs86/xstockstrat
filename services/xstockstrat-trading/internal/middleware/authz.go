package middleware

import (
	"context"
	"strconv"

	"google.golang.org/grpc/codes"
	grpcstatus "google.golang.org/grpc/status"
)

// AdminScope is the platform-wide admin bitmask (0x04) — must match the Python _ADMIN
// (xstockstrat-agent/app/scopes.py) and the Node ADMIN_SCOPE (xstockstrat-config authz.ts).
const AdminScope = 0x04

// RequireAdminScope returns PermissionDenied when the caller's access-scope lacks the admin
// bit. A non-numeric or empty scope string defaults to 0 (denied).
func RequireAdminScope(ctx context.Context) error {
	data := FromContext(ctx)
	scope, err := strconv.Atoi(data.AccessScope)
	if err != nil {
		scope = 0
	}
	if scope&AdminScope == 0 {
		return grpcstatus.Errorf(codes.PermissionDenied, "admin scope required")
	}
	return nil
}
