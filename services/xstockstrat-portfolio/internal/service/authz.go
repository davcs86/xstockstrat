package service

import (
	"context"

	"google.golang.org/grpc/metadata"
)

// HeaderInternalCaller is the metadata key an internal service asserts to reach a privileged,
// non-human RPC. Mirrors config's HEADER_INTERNAL_CALLER.
const HeaderInternalCaller = "x-internal-caller"

// internalCallerGrant is a least-privilege {callerID, rpc} grant — scoped per caller AND per RPC,
// not bare callerID.
type internalCallerGrant struct{ callerID, rpc string }

// internalCallerAllowlist enumerates the internal callers authorized for specific portfolio RPCs.
// A future gated RPC needs its own explicit grant.
var internalCallerAllowlist = []internalCallerGrant{
	{callerID: "analysis-fundsignal", rpc: "ListAllWatchlistSymbols"},
}

// hasInternalCallerAuthority is portfolio's FIRST authz gate: it matches x-internal-caller from
// INCOMING metadata against the allow-list, ignores the admin x-access-scope bit, and fails closed.
func hasInternalCallerAuthority(ctx context.Context, rpc string) bool {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return false
	}
	for _, caller := range md.Get(HeaderInternalCaller) {
		for _, g := range internalCallerAllowlist {
			if g.callerID == caller && g.rpc == rpc {
				return true
			}
		}
	}
	return false
}
