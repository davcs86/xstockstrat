package service

import (
	"context"

	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/peer"
)

// HeaderInternalCaller is the metadata key an internal service asserts to reach a privileged,
// non-human RPC. Mirrors config's HEADER_INTERNAL_CALLER.
const HeaderInternalCaller = "x-internal-caller"

const (
	rpcSyncWatchlistDelistings = "SyncWatchlistDelistings"
	rpcAckDelistingAlerts      = "AckDelistingAlerts"
)

// internalCallerGrant is a least-privilege {callerID, rpc, peerSAN} grant: the header alone is
// forgeable, so the verified mTLS peer must carry peerSAN as well.
type internalCallerGrant struct{ callerID, rpc, peerSAN string }

// internalCallerAllowlist enumerates the internal callers authorized for specific marketdata RPCs.
// A future gated RPC needs its own explicit grant; every other marketdata RPC is ungated.
var internalCallerAllowlist = []internalCallerGrant{
	{callerID: "portfolio", rpc: rpcSyncWatchlistDelistings, peerSAN: "xstockstrat-portfolio"},
	{callerID: "portfolio", rpc: rpcAckDelistingAlerts, peerSAN: "xstockstrat-portfolio"},
}

// verifiedPeerDNSNames returns the DNS SANs of the verified mTLS peer leaf, nil when any link is missing.
func verifiedPeerDNSNames(ctx context.Context) []string {
	p, ok := peer.FromContext(ctx)
	if !ok {
		return nil
	}
	info, ok := p.AuthInfo.(credentials.TLSInfo)
	if !ok || len(info.State.VerifiedChains) == 0 || len(info.State.VerifiedChains[0]) == 0 {
		return nil
	}
	return info.State.VerifiedChains[0][0].DNSNames
}

// hasInternalCallerAuthority requires both an x-internal-caller value and an exactly equal peer
// DNS SAN matching one grant for rpc; it fails closed.
func hasInternalCallerAuthority(ctx context.Context, rpc string) bool {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return false
	}
	sans := verifiedPeerDNSNames(ctx)
	for _, caller := range md.Get(HeaderInternalCaller) {
		for _, g := range internalCallerAllowlist {
			if g.callerID != caller || g.rpc != rpc {
				continue
			}
			for _, san := range sans {
				if san == g.peerSAN {
					return true
				}
			}
		}
	}
	return false
}
