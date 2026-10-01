package mtls

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/health"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/test/bufconn"
)

// --- in-process cert minting (no dependency on scripts/gen-dev-certs.sh) ---

type ca struct {
	cert *x509.Certificate
	key  *ecdsa.PrivateKey
	pem  []byte
}

func newCA(t *testing.T) ca {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("ca key: %v", err)
	}
	tmpl := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "test-platform-ca"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(time.Hour),
		IsCA:                  true,
		KeyUsage:              x509.KeyUsageCertSign,
		BasicConstraintsValid: true,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatalf("ca cert: %v", err)
	}
	c, _ := x509.ParseCertificate(der)
	return ca{cert: c, key: key, pem: pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})}
}

// leaf mints a leaf signed by signer with SAN=dnsName and both server+client EKUs.
func (c ca) leaf(t *testing.T, dnsName string) (certPEM, keyPEM []byte) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("leaf key: %v", err)
	}
	tmpl := &x509.Certificate{
		SerialNumber: big.NewInt(time.Now().UnixNano()),
		Subject:      pkix.Name{CommonName: dnsName},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth, x509.ExtKeyUsageClientAuth},
		DNSNames:     []string{dnsName},
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, c.cert, &key.PublicKey, c.key)
	if err != nil {
		t.Fatalf("leaf cert: %v", err)
	}
	keyDER, _ := x509.MarshalECPrivateKey(key)
	return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}),
		pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER})
}

// setEnv points MTLS_* at the given material for the duration of the test.
func setEnv(t *testing.T, certPEM, keyPEM, caPEM []byte) {
	t.Helper()
	t.Setenv("MTLS_CERT", string(certPEM))
	t.Setenv("MTLS_KEY", string(keyPEM))
	t.Setenv("MTLS_CA_CERT", string(caPEM))
}

const svcName = "xstockstrat-test"

// mtlsServer stands up an in-process gRPC server (bufconn) with ServerConfig() credentials and a
// metadata-capturing interceptor, and returns a dialer. The server requires+verifies the client cert.
func mtlsServer(t *testing.T, gotMD chan<- metadata.MD) *bufconn.Listener {
	t.Helper()
	creds, err := ServerConfig()
	if err != nil {
		t.Fatalf("ServerConfig: %v", err)
	}
	lis := bufconn.Listen(1024 * 1024)
	s := grpc.NewServer(grpc.Creds(creds), grpc.UnaryInterceptor(
		func(ctx context.Context, req any, _ *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
			if gotMD != nil {
				md, _ := metadata.FromIncomingContext(ctx)
				select {
				case gotMD <- md:
				default:
				}
			}
			return handler(ctx, req)
		}))
	healthpb.RegisterHealthServer(s, health.NewServer())
	go func() { _ = s.Serve(lis) }()
	t.Cleanup(s.Stop)
	return lis
}

func dialAndCheck(t *testing.T, lis *bufconn.Listener, opt grpc.DialOption, ctx context.Context) error {
	t.Helper()
	conn, err := grpc.NewClient("passthrough:///bufnet",
		grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) { return lis.DialContext(ctx) }),
		opt)
	if err != nil {
		return err
	}
	defer conn.Close()
	_, err = healthpb.NewHealthClient(conn).Check(ctx, &healthpb.HealthCheckRequest{})
	return err
}

// --- @AC-4: fail-closed boot ---

func TestFailClosedWhenEnvAbsent(t *testing.T) {
	t.Setenv("MTLS_CERT", "")
	t.Setenv("MTLS_KEY", "")
	t.Setenv("MTLS_CA_CERT", "")
	if _, err := ServerConfig(); err == nil {
		t.Error("@AC-4: ServerConfig must fail closed when MTLS_* env is absent")
	}
	if _, err := ClientConfig(svcName); err == nil {
		t.Error("@AC-4: ClientConfig must fail closed when MTLS_* env is absent")
	}
}

// --- @AC-2: mutual handshake accepted, trio honored (@AC-5) ---

func TestMutualHandshakeAndPropagation(t *testing.T) {
	root := newCA(t)
	serverCert, serverKey := root.leaf(t, svcName)
	clientCert, clientKey := root.leaf(t, "xstockstrat-client")

	setEnv(t, serverCert, serverKey, root.pem)
	gotMD := make(chan metadata.MD, 1)
	lis := mtlsServer(t, gotMD)

	// Client presents its own leaf (same CA) and pins the server authority to svcName.
	setEnv(t, clientCert, clientKey, root.pem)
	clientCreds, err := ClientConfig(svcName)
	if err != nil {
		t.Fatalf("ClientConfig: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	ctx = metadata.AppendToOutgoingContext(ctx,
		"x-user-id", "u-1", "x-access-scope", "7", "x-trace-id", "t-1")
	if err := dialAndCheck(t, lis, grpc.WithTransportCredentials(clientCreds), ctx); err != nil {
		t.Fatalf("@AC-2: mutual handshake/RPC failed: %v", err)
	}
	// @AC-5: the trio arrived unchanged over the authenticated channel.
	select {
	case md := <-gotMD:
		for k, want := range map[string]string{"x-user-id": "u-1", "x-access-scope": "7", "x-trace-id": "t-1"} {
			if got := md.Get(k); len(got) != 1 || got[0] != want {
				t.Errorf("@AC-5: header %s = %v, want %s", k, got, want)
			}
		}
	case <-time.After(time.Second):
		t.Error("@AC-5: server never observed request metadata")
	}
}

// --- @AC-1: plaintext / no-cert client refused ---

func TestPlaintextClientRefused(t *testing.T) {
	root := newCA(t)
	serverCert, serverKey := root.leaf(t, svcName)
	setEnv(t, serverCert, serverKey, root.pem)
	lis := mtlsServer(t, nil)

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := dialAndCheck(t, lis, grpc.WithTransportCredentials(insecure.NewCredentials()), ctx); err == nil {
		t.Error("@AC-1: a plaintext/insecure client must be refused at the TLS layer")
	}
}

// --- negative matrix (a): a cert from a DIFFERENT CA is rejected ---

func TestWrongCARejected(t *testing.T) {
	root := newCA(t)
	serverCert, serverKey := root.leaf(t, svcName)
	setEnv(t, serverCert, serverKey, root.pem)
	lis := mtlsServer(t, nil)

	foreign := newCA(t)
	foreignCert, foreignKey := foreign.leaf(t, "xstockstrat-client")
	// Client presents a foreign-CA leaf but still trusts the real CA for the server — its OWN cert
	// will not verify against the server's ClientCAs.
	setEnv(t, foreignCert, foreignKey, root.pem)
	creds, err := ClientConfig(svcName)
	if err != nil {
		t.Fatalf("ClientConfig: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := dialAndCheck(t, lis, grpc.WithTransportCredentials(creds), ctx); err == nil {
		t.Error("negative matrix (wrong-CA): a client cert from a non-platform CA must be rejected")
	}
}

// --- negative matrix (b): a valid-CA cert but WRONG pinned SAN is rejected ---

func TestWrongSANRejected(t *testing.T) {
	root := newCA(t)
	serverCert, serverKey := root.leaf(t, svcName) // server SAN = svcName
	setEnv(t, serverCert, serverKey, root.pem)
	lis := mtlsServer(t, nil)

	clientCert, clientKey := root.leaf(t, "xstockstrat-client")
	setEnv(t, clientCert, clientKey, root.pem)
	// Pin the client's expected server authority to the WRONG name — server cert SAN won't match.
	creds, err := ClientConfig("xstockstrat-wrong")
	if err != nil {
		t.Fatalf("ClientConfig: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := dialAndCheck(t, lis, grpc.WithTransportCredentials(creds), ctx); err == nil {
		t.Error("negative matrix (wrong-SAN): a valid-CA cert with the wrong pinned SAN must be rejected")
	}
}
