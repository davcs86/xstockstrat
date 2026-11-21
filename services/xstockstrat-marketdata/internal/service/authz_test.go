package service

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"testing"

	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/peer"
)

// callerCtx builds an inbound context; an empty caller sends no header, a nil sans sends no peer,
// and unverified leaves the certificate out of VerifiedChains.
func callerCtx(caller string, sans []string, unverified bool) context.Context {
	ctx := context.Background()
	if caller != "" {
		ctx = metadata.NewIncomingContext(ctx, metadata.Pairs(HeaderInternalCaller, caller))
	}
	if sans == nil {
		return ctx
	}
	state := tls.ConnectionState{}
	if !unverified {
		state.VerifiedChains = [][]*x509.Certificate{{{DNSNames: sans}}}
	}
	return peer.NewContext(ctx, &peer.Peer{AuthInfo: credentials.TLSInfo{State: state}})
}

func portfolioCtx() context.Context {
	return callerCtx("portfolio", []string{"xstockstrat-portfolio"}, false)
}

func TestInternalCaller_RequiresHeaderAndVerifiedPeerSAN(t *testing.T) {
	portfolioSAN := []string{"xstockstrat-portfolio"}
	cases := []struct {
		name string
		ctx  context.Context
		rpc  string
		want bool
	}{
		{"no metadata, no peer", context.Background(), rpcSyncWatchlistDelistings, false},
		{"header without a peer", callerCtx("portfolio", nil, false), rpcSyncWatchlistDelistings, false},
		{"peer without the header", callerCtx("", portfolioSAN, false), rpcSyncWatchlistDelistings, false},
		{"wrong caller id", callerCtx("analysis", portfolioSAN, false), rpcSyncWatchlistDelistings, false},
		{"SAN with a suffix", callerCtx("portfolio", []string{"xstockstrat-portfolio-evil"}, false), rpcSyncWatchlistDelistings, false},
		{"SAN that is a prefix", callerCtx("portfolio", []string{"xstockstrat-portfoli"}, false), rpcSyncWatchlistDelistings, false},
		{"unverified chain", callerCtx("portfolio", portfolioSAN, true), rpcSyncWatchlistDelistings, false},
		{"sync allowed", portfolioCtx(), "SyncWatchlistDelistings", true},
		{"ack allowed", portfolioCtx(), "AckDelistingAlerts", true},
		{"SAN among several", callerCtx("portfolio", []string{"localhost", "xstockstrat-portfolio"}, false), rpcAckDelistingAlerts, true},
		{"other rpc", portfolioCtx(), "GetSymbolServability", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := hasInternalCallerAuthority(tc.ctx, tc.rpc); got != tc.want {
				t.Errorf("hasInternalCallerAuthority = %v, want %v", got, tc.want)
			}
		})
	}
}
