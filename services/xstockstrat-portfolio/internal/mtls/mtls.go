// Package mtls builds the mutual-TLS transport credentials for inter-service gRPC (feature 210).
//
// Cert material is read from boot-time env PEM strings (MTLS_CERT / MTLS_KEY / MTLS_CA_CERT), never
// over WatchConfig. Absent or invalid material is a hard error (fail-closed — the server/client must
// not start without it). The client pins the server's verified identity to the TARGET SERVICE NAME
// (never the dialed host), so verification is env-independent across docker-compose (bare service
// name) and DO App Platform (PRIVATE_DOMAIN FQDN). See docs/patterns/inter-service-mtls.md.
package mtls

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"os"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
)

// load reads MTLS_CERT/MTLS_KEY/MTLS_CA_CERT from env and returns the leaf key pair + CA pool.
// Returns an error (fail-closed) if any var is unset or the material does not parse.
func load() (tls.Certificate, *x509.CertPool, error) {
	certPEM := os.Getenv("MTLS_CERT")
	keyPEM := os.Getenv("MTLS_KEY")
	caPEM := os.Getenv("MTLS_CA_CERT")
	if certPEM == "" || keyPEM == "" || caPEM == "" {
		return tls.Certificate{}, nil, fmt.Errorf("mtls: MTLS_CERT, MTLS_KEY and MTLS_CA_CERT must all be set (fail-closed)")
	}
	leaf, err := tls.X509KeyPair([]byte(certPEM), []byte(keyPEM))
	if err != nil {
		return tls.Certificate{}, nil, fmt.Errorf("mtls: load leaf key pair: %w", err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM([]byte(caPEM)) {
		return tls.Certificate{}, nil, fmt.Errorf("mtls: MTLS_CA_CERT contains no valid certificate")
	}
	return leaf, pool, nil
}

// ServerConfig returns transport credentials that present this service's leaf and REQUIRE+VERIFY the
// client's certificate chains to the platform CA (mutual TLS).
func ServerConfig() (credentials.TransportCredentials, error) {
	leaf, pool, err := load()
	if err != nil {
		return nil, err
	}
	return credentials.NewTLS(&tls.Config{
		Certificates: []tls.Certificate{leaf},
		ClientAuth:   tls.RequireAndVerifyClientCert,
		ClientCAs:    pool,
		MinVersion:   tls.VersionTLS12,
	}), nil
}

// ClientConfig returns transport credentials that present this service's leaf and verify the server's
// certificate chains to the platform CA with SAN == targetService. targetService is the destination
// registry service name (e.g. "xstockstrat-ledger"), NOT the dialed host — this is the load-bearing,
// env-independent authority pin. Native chain+SAN verification; never a skip-verify shortcut (a fail-open footgun).
func ClientConfig(targetService string) (credentials.TransportCredentials, error) {
	leaf, pool, err := load()
	if err != nil {
		return nil, err
	}
	return credentials.NewTLS(&tls.Config{
		Certificates: []tls.Certificate{leaf},
		RootCAs:      pool,
		ServerName:   targetService,
		MinVersion:   tls.VersionTLS12,
	}), nil
}

// Probe is the container healthcheck: serverName must be this service's own SAN, since it presents its own leaf.
func Probe(ctx context.Context, addr, serverName string) error {
	creds, err := ClientConfig(serverName)
	if err != nil {
		return err
	}
	conn, err := grpc.NewClient(addr, grpc.WithTransportCredentials(creds))
	if err != nil {
		return err
	}
	defer func() { _ = conn.Close() }()
	resp, err := healthpb.NewHealthClient(conn).Check(ctx, &healthpb.HealthCheckRequest{})
	if err != nil {
		return err
	}
	if resp.GetStatus() != healthpb.HealthCheckResponse_SERVING {
		return fmt.Errorf("mtls: health status %s", resp.GetStatus())
	}
	return nil
}
