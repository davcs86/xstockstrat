package service

import (
	"context"

	"google.golang.org/grpc/metadata"
)

// HeaderInternalCaller is the metadata key an internal service asserts to reach a
// privileged, non-human RPC. Mirrors config's HEADER_INTERNAL_CALLER (feature 102/147).
const HeaderInternalCaller = "x-internal-caller"

// internalCallerGrant is a least-privilege {callerID, rpc} grant (mirrors config's
// authz.ts allow-list shape — scoped per caller AND per RPC, not bare callerID).
type internalCallerGrant struct{ callerID, rpc string }

// internalCallerAllowlist enumerates the internal callers authorized for specific
// portfolio RPCs. Feature 154: the fundamentals-signal producer may enumerate the
// cross-user watchlist union. A future gated RPC needs its own explicit grant.
var internalCallerAllowlist = []internalCallerGrant{
	{callerID: "analysis-fundsignal", rpc: "ListAllWatchlistSymbols"},
}

// hasInternalCallerAuthority is xstockstrat-portfolio's FIRST authz gate. It reads the
// x-internal-caller assertion from INCOMING gRPC metadata — never the Connect adapter's
// fabricated request header (empty via NewRequest at the grpc-adapter layer, design R2). It
// deliberately ignores the admin x-access-scope bit: the admin bit authorizes a human's own
// scope + globals, never another user's per-user rows (PR #994), so it must not open a
// cross-user read.
//
// Fails closed: absent metadata, absent/empty header, or no value matching an allow-listed
// {callerID, rpc} grant all return false.
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
