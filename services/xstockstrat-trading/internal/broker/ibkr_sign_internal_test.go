package broker

import (
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/xstockstrat/trading/internal/testdata"
)

func vectorClient(t *testing.T, nonce string) *IBKRClient {
	t.Helper()
	v := testdata.MustIBKRVectors()
	ts, err := strconv.ParseInt(v.Inputs.Timestamp, 10, 64)
	if err != nil {
		t.Fatalf("parse vector timestamp: %v", err)
	}
	return NewIBKRClient(IBKRConfig{
		BaseURL:           v.Inputs.BaseURL,
		ConsumerKey:       v.Inputs.ConsumerKey,
		AccessToken:       v.Inputs.AccessToken,
		AccessTokenSecret: v.Inputs.AccessTokenSecret,
		Now:               func() time.Time { return time.Unix(ts, 0) },
		Nonce:             func() string { return nonce },
	})
}

func vectorRequest(t *testing.T, rv testdata.IBKRRequestVector) *http.Request {
	t.Helper()
	req, err := http.NewRequest(rv.Method, rv.URL, nil)
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	q := url.Values{}
	for k, val := range rv.Params {
		q.Set(k, val)
	}
	req.URL.RawQuery = q.Encode()
	return req
}

func findVector(t *testing.T, name, nonce string) testdata.IBKRRequestVector {
	t.Helper()
	for _, rv := range testdata.MustIBKRVectors().Requests {
		if rv.Name == name && rv.Nonce == nonce {
			return rv
		}
	}
	t.Fatalf("no vector %q for nonce %q", name, nonce)
	return testdata.IBKRRequestVector{}
}

func vectorLST(t *testing.T) []byte {
	t.Helper()
	lst, err := base64.StdEncoding.DecodeString(testdata.MustIBKRVectors().LSTReply.LiveSessionToken)
	if err != nil {
		t.Fatalf("decode vector LST: %v", err)
	}
	return lst
}

func headerParam(t *testing.T, header, key string) string {
	t.Helper()
	prefix := key + `="`
	for _, part := range strings.Split(strings.TrimPrefix(header, "OAuth "), ", ") {
		if strings.HasPrefix(part, prefix) {
			return strings.TrimSuffix(strings.TrimPrefix(part, prefix), `"`)
		}
	}
	t.Fatalf("header %q has no %s", header, key)
	return ""
}

// @AC-1
func TestIBKRAuthorize_GETQueryParamsSigned(t *testing.T) {
	for _, nonce := range testdata.MustIBKRVectors().Inputs.Nonces {
		rv := findVector(t, "get_order", nonce)
		c := vectorClient(t, nonce)
		req := vectorRequest(t, rv)

		base := buildBaseString(req.Method, req.URL, c.oauthParams("HMAC-SHA256"))
		if base != rv.BaseString {
			t.Fatalf("base string\n got: %s\nwant: %s", base, rv.BaseString)
		}
		uriPart := strings.SplitN(base, "&", 3)[1]
		if strings.Contains(uriPart, "%3F") || strings.Contains(uriPart, "?") {
			t.Fatalf("base-string URI carries the query: %s", uriPart)
		}
		header := c.authorize(req, vectorLST(t))
		if got := headerParam(t, header, "oauth_signature"); got != rv.OAuthSignature {
			t.Fatalf("oauth_signature got %s want %s", got, rv.OAuthSignature)
		}
	}
}

// @AC-2
func TestIBKRAuthorize_LSTKeyedAndRealm(t *testing.T) {
	for _, name := range []string{"secdef_search_aapl", "place_order", "cancel_order"} {
		t.Run(name, func(t *testing.T) {
			for _, nonce := range testdata.MustIBKRVectors().Inputs.Nonces {
				rv := findVector(t, name, nonce)
				c := vectorClient(t, nonce)
				header := c.authorize(vectorRequest(t, rv), vectorLST(t))

				if !strings.HasPrefix(header, `OAuth realm="limited_poa"`) {
					t.Fatalf("header lacks realm prefix: %s", header)
				}
				if header != rv.Authorization {
					t.Fatalf("header\n got: %s\nwant: %s", header, rv.Authorization)
				}
				sig := headerParam(t, header, "oauth_signature")
				if sig == url.QueryEscape(rv.LegacySignatureB64) {
					t.Fatalf("signature matches the legacy \"&\"+secret key")
				}
			}
		})
	}
}

func TestIBKRAuthorize_EncodingPinned(t *testing.T) {
	for _, nonce := range testdata.MustIBKRVectors().Inputs.Nonces {
		rv := findVector(t, "secdef_search_brk_b", nonce)
		c := vectorClient(t, nonce)
		req := vectorRequest(t, rv)

		if base := buildBaseString(req.Method, req.URL, c.oauthParams("HMAC-SHA256")); base != rv.BaseString {
			t.Fatalf("base string\n got: %s\nwant: %s", base, rv.BaseString)
		}
		header := c.authorize(req, vectorLST(t))
		if header != rv.Authorization {
			t.Fatalf("header\n got: %s\nwant: %s", header, rv.Authorization)
		}
		sig := headerParam(t, header, "oauth_signature")
		if strings.ContainsAny(sig, "+/=") {
			t.Fatalf("signature not percent-encoded in header: %s", sig)
		}
	}
}

func TestIBKRAuthorizeLST_RSAVector(t *testing.T) {
	v := testdata.MustIBKRVectors()
	block, _ := pem.Decode([]byte(testdata.IBKRSignatureKeyPEM))
	if block == nil {
		t.Fatal("decode signature key PEM")
	}
	key, err := x509.ParsePKCS1PrivateKey(block.Bytes)
	if err != nil {
		t.Fatalf("parse signature key: %v", err)
	}

	c := vectorClient(t, v.LSTRequest.Nonce)
	req, err := http.NewRequest(v.LSTRequest.Method, v.LSTRequest.URL, nil)
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	header, err := c.authorizeLST(req, v.LSTRequest.Prepend, v.LSTRequest.DiffieHellmanChallenge, key)
	if err != nil {
		t.Fatalf("authorizeLST: %v", err)
	}
	if header != v.LSTRequest.Authorization {
		t.Fatalf("LST header\n got: %s\nwant: %s", header, v.LSTRequest.Authorization)
	}
}
