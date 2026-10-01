package service

// TestMain provisions valid mutual-TLS env for this package's tests (feature 210). NewTradingService
// builds its ledger/notify/portfolio/marketdata clients with mtls.ClientConfig at construction, which
// is fail-closed: absent MTLS_CERT/MTLS_KEY/MTLS_CA_CERT raises. Go's tls.X509KeyPair needs REAL PEM
// (unlike the Python/Node channel creds), so we mint a throwaway CA + leaf once and export it. No
// handshake happens here — grpc.NewClient is lazy — so these certs only need to parse.

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"os"
	"testing"
	"time"
)

func TestMain(m *testing.M) {
	caKey, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	caTmpl := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "xstockstrat-test-ca"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(24 * time.Hour),
		IsCA:                  true,
		BasicConstraintsValid: true,
		KeyUsage:              x509.KeyUsageCertSign,
	}
	caDER, _ := x509.CreateCertificate(rand.Reader, caTmpl, caTmpl, &caKey.PublicKey, caKey)
	caCert, _ := x509.ParseCertificate(caDER)
	caPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: caDER})

	leafKey, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	leafTmpl := &x509.Certificate{
		SerialNumber: big.NewInt(2),
		Subject:      pkix.Name{CommonName: "xstockstrat-trading"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(24 * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth, x509.ExtKeyUsageClientAuth},
		DNSNames:     []string{"xstockstrat-trading"},
	}
	leafDER, _ := x509.CreateCertificate(rand.Reader, leafTmpl, caCert, &leafKey.PublicKey, caKey)
	leafKeyDER, _ := x509.MarshalECPrivateKey(leafKey)
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: leafDER})
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: leafKeyDER})

	_ = os.Setenv("MTLS_CERT", string(certPEM))
	_ = os.Setenv("MTLS_KEY", string(keyPEM))
	_ = os.Setenv("MTLS_CA_CERT", string(caPEM))

	os.Exit(m.Run())
}
