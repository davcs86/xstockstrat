package middleware

import (
	"context"
	"strconv"

	"google.golang.org/grpc/codes"
	grpcstatus "google.golang.org/grpc/status"
)

// AdminScope is the platform-wide admin bitmask (0x04), matching the Python
// _ADMIN constant in xstockstrat-agent/app/scopes.py and the Node ADMIN_SCOPE
// in xstockstrat-config/src/grpc/authz.ts.
const AdminScope = 0x04

// RequireAdminScope extracts the caller's access-scope from context and returns
// a PermissionDenied error when the admin bit is not set. Non-numeric or empty
// scope strings default to 0 (denied).
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
