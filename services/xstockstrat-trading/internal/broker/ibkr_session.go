package broker

import (
	"context"
	"crypto/hmac"
	"crypto/rsa"
	"crypto/sha1"
	"crypto/x509"
	"encoding/asn1"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"

	"golang.org/x/sync/singleflight"
)

// IBKRTiming bounds the LST session lifecycle; production reads it from WatchConfig on every use.
type IBKRTiming struct {
	LSTRefreshMargin  time.Duration
	HandshakeTimeout  time.Duration
	ReauthMinInterval time.Duration
}

// defaultIBKRTiming applies only when IBKRConfig.Timing is nil (tests); production always passes Timing.
var defaultIBKRTiming = IBKRTiming{
	LSTRefreshMargin:  60 * time.Second,
	HandshakeTimeout:  10 * time.Second,
	ReauthMinInterval: 30 * time.Second,
}

const (
	ibkrLSTPath  = "/oauth/live_session_token"
	ibkrInitPath = "/iserver/auth/ssodh/init"
	ibkrInitBody = `{"publish":true,"compete":false}`
)

type session struct {
	gen uint64
	lst []byte
	exp time.Time
}

type flightResult struct {
	sess session
	fid  uint64
}

// ibkrSessionState is guarded by sessMu, which is never held across I/O.
type ibkrSessionState struct {
	sessMu         sync.Mutex
	sess           session
	negUntil       time.Time
	negErr         error
	lastInvalidate time.Time
	flightSeq      uint64
	flight         singleflight.Group
}

func (c *IBKRClient) timing() IBKRTiming {
	if c.timingFn == nil {
		return defaultIBKRTiming
	}
	return c.timingFn()
}

// loadKeyMaterial parses the PEM fields once; the retained error names the field and never its bytes.
func (c *IBKRClient) loadKeyMaterial(cfg IBKRConfig) error {
	fieldErr := func(field string) error {
		return fmt.Errorf("ibkr credentials: %s missing or unparseable: %w", field, ErrInvalidCredentials)
	}
	var err error
	if c.signatureKey, err = parseIBKRRSAKey(cfg.SignatureKey); err != nil {
		return fieldErr("signature_key")
	}
	if c.encryptionKey, err = parseIBKRRSAKey(cfg.EncryptionKey); err != nil {
		return fieldErr("encryption_key")
	}
	if c.dhP, c.dhG, err = parseIBKRDHParams(cfg.DHPrime); err != nil {
		return fieldErr("dh_prime")
	}
	return nil
}

func parseIBKRRSAKey(s string) (*rsa.PrivateKey, error) {
	block, _ := pem.Decode([]byte(s))
	if block == nil {
		return nil, errors.New("no PEM block")
	}
	if k, err := x509.ParsePKCS1PrivateKey(block.Bytes); err == nil {
		return k, nil
	}
	k, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, errors.New("not a private key")
	}
	rk, ok := k.(*rsa.PrivateKey)
	if !ok {
		return nil, errors.New("not an RSA key")
	}
	return rk, nil
}

func parseIBKRDHParams(s string) (p, g *big.Int, err error) {
	block, _ := pem.Decode([]byte(s))
	if block == nil || block.Type != "DH PARAMETERS" {
		return nil, nil, errors.New("no DH PARAMETERS block")
	}
	var params struct{ P, G *big.Int }
	rest, err := asn1.Unmarshal(block.Bytes, &params)
	if err != nil || len(rest) != 0 || params.P == nil || params.G == nil || params.P.Sign() <= 0 || params.G.Sign() <= 0 {
		return nil, nil, errors.New("malformed DH parameters")
	}
	return params.P, params.G, nil
}

// ibkrAuthStatusErr is the TRADING-3 classification: 401/403 is a credential rejection, any other
// non-2xx is transient.
func ibkrAuthStatusErr(op string, code int) error {
	switch {
	case code >= 200 && code < 300:
		return nil
	case code == http.StatusUnauthorized || code == http.StatusForbidden:
		return fmt.Errorf("ibkr %s: status %d: %w", op, code, ErrInvalidCredentials)
	default:
		return fmt.Errorf("ibkr %s: status %d", op, code)
	}
}

// ensureSession returns a valid LST session, running at most one coalesced handshake. mintedByMe is true
// when this call's result came from a handshake rather than the cache.
func (c *IBKRClient) ensureSession(ctx context.Context) (snapshot session, mintedByMe bool, err error) {
	if c.credErr != nil {
		return session{}, false, c.credErr
	}
	recalled := false
	for {
		c.sessMu.Lock()
		now := c.now()
		if c.sess.lst != nil && now.Before(c.sess.exp.Add(-c.timing().LSTRefreshMargin)) {
			s := c.sess
			c.sessMu.Unlock()
			return s, false, nil
		}
		if now.Before(c.negUntil) {
			nerr := c.negErr
			c.sessMu.Unlock()
			return session{}, false, nerr
		}
		entrySeq := c.flightSeq
		c.sessMu.Unlock()

		led := false
		ch := c.flight.DoChan("lst", func() (any, error) {
			led = true
			c.sessMu.Lock()
			c.flightSeq++
			fid := c.flightSeq
			c.sessMu.Unlock()
			// Detached so a short caller deadline cannot abort the handshake its waiters share.
			lctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), c.timing().HandshakeTimeout)
			defer cancel()
			s, herr := c.handshake(lctx)
			return flightResult{sess: s, fid: fid}, herr
		})
		select {
		case <-ctx.Done():
			return session{}, false, ctx.Err()
		case r := <-ch:
			fr, _ := r.Val.(flightResult)
			if r.Err == nil {
				return fr.sess, true, nil
			}
			// A joiner of a flight that predates this call re-calls once on a transient failure.
			if !led && !recalled && fr.fid <= entrySeq && !errors.Is(r.Err, ErrInvalidCredentials) {
				recalled = true
				continue
			}
			return session{}, false, r.Err
		}
	}
}

// handshake mints an LST, opens the brokerage session and stores the result under a new generation; an
// ErrInvalidCredentials outcome is negatively cached for ReauthMinInterval.
func (c *IBKRClient) handshake(ctx context.Context) (session, error) {
	s, err := c.mintLST(ctx)
	if err == nil {
		err = c.initBrokerage(ctx, s.lst)
	}
	now := c.now()
	c.sessMu.Lock()
	defer c.sessMu.Unlock()
	if err != nil {
		if errors.Is(err, ErrInvalidCredentials) {
			c.negUntil, c.negErr = now.Add(c.timing().ReauthMinInterval), err
		}
		return session{}, err
	}
	c.sess = session{gen: c.sess.gen + 1, lst: s.lst, exp: s.exp}
	c.negUntil, c.negErr = time.Time{}, nil
	return c.sess, nil
}

func (c *IBKRClient) mintLST(ctx context.Context) (session, error) {
	ct, err := base64.StdEncoding.DecodeString(c.accessTokenSecret)
	if err != nil {
		return session{}, fmt.Errorf("ibkr handshake: access_token_secret is not base64: %w", ErrInvalidCredentials)
	}
	//nolint:staticcheck // IBKR's LST protocol mandates PKCS#1 v1.5 (ibind oauth1a.py:375)
	secret, err := rsa.DecryptPKCS1v15(nil, c.encryptionKey, ct)
	if err != nil || len(secret) == 0 {
		return session{}, fmt.Errorf("ibkr handshake: access_token_secret undecryptable: %w", ErrInvalidCredentials)
	}
	prepend := hex.EncodeToString(secret)

	a := c.dhRandom()
	challenge := new(big.Int).Exp(c.dhG, a, c.dhP)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+ibkrLSTPath, nil)
	if err != nil {
		return session{}, fmt.Errorf("ibkr handshake: build request: %w", err)
	}
	auth, err := c.authorizeLST(req, prepend, challenge.Text(16), c.signatureKey)
	if err != nil {
		return session{}, err
	}
	req.Header.Set("Authorization", auth)
	body, code, err := c.send(req)
	if err != nil {
		return session{}, fmt.Errorf("ibkr handshake: live_session_token: %w", err)
	}
	if serr := ibkrAuthStatusErr("live_session_token", code); serr != nil {
		return session{}, serr
	}
	var reply struct {
		DHResponse string `json:"diffie_hellman_response"`
		Expiration int64  `json:"live_session_token_expiration"`
		Signature  string `json:"live_session_token_signature"`
	}
	if err := json.Unmarshal(body, &reply); err != nil {
		return session{}, fmt.Errorf("ibkr handshake: decode live_session_token reply: %w", err)
	}
	b, ok := new(big.Int).SetString(reply.DHResponse, 16)
	if !ok {
		return session{}, errors.New("ibkr handshake: malformed diffie_hellman_response")
	}
	lst := computeLST(new(big.Int).Exp(b, a, c.dhP), secret)
	mac := hmac.New(sha1.New, lst)
	mac.Write([]byte(c.consumerKey)) //nolint:errcheck
	if !hmac.Equal([]byte(hex.EncodeToString(mac.Sum(nil))), []byte(reply.Signature)) {
		return session{}, fmt.Errorf("ibkr handshake: live_session_token_signature mismatch: %w", ErrInvalidCredentials)
	}
	return session{lst: lst, exp: time.UnixMilli(reply.Expiration)}, nil
}

// computeLST serializes K as Java BigInteger.toByteArray (a leading 0x00 when the top bit is set), then
// returns HMAC-SHA1(K, prepend).
func computeLST(k *big.Int, prepend []byte) []byte {
	kb := k.Bytes()
	if k.BitLen()%8 == 0 {
		kb = append([]byte{0}, kb...)
	}
	mac := hmac.New(sha1.New, kb)
	mac.Write(prepend) //nolint:errcheck
	return mac.Sum(nil)
}

func (c *IBKRClient) initBrokerage(ctx context.Context, lst []byte) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+ibkrInitPath, strings.NewReader(ibkrInitBody))
	if err != nil {
		return fmt.Errorf("ibkr ssodh/init: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", c.authorize(req, lst))
	body, code, err := c.send(req)
	if err != nil {
		return fmt.Errorf("ibkr ssodh/init: %w", err)
	}
	if serr := ibkrAuthStatusErr("ssodh/init", code); serr != nil {
		return serr
	}
	var reply struct {
		Authenticated bool `json:"authenticated"`
		Competing     bool `json:"competing"`
	}
	_ = json.Unmarshal(body, &reply)
	if !reply.Authenticated {
		slog.Warn("ibkr brokerage session not established", "competing", reply.Competing)
		return fmt.Errorf("ibkr ssodh/init: brokerage session not authenticated: %w", ErrInvalidCredentials)
	}
	return nil
}

func (c *IBKRClient) send(req *http.Request) ([]byte, int, error) {
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close() //nolint:errcheck
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, 0, err
	}
	return body, resp.StatusCode, nil
}

// invalidate clears session gen only if it is still current and the last 401-triggered invalidation was
// at least ReauthMinInterval ago.
func (c *IBKRClient) invalidate(gen uint64) bool {
	c.sessMu.Lock()
	defer c.sessMu.Unlock()
	now := c.now()
	if c.sess.lst == nil || c.sess.gen != gen {
		return false
	}
	if !c.lastInvalidate.IsZero() && now.Sub(c.lastInvalidate) < c.timing().ReauthMinInterval {
		return false
	}
	c.sess.lst, c.sess.exp = nil, time.Time{}
	c.lastInvalidate = now
	return true
}

// reinit re-opens the brokerage session for generation gen with its existing LST; a stale gen is a no-op.
func (c *IBKRClient) reinit(ctx context.Context, gen uint64) error {
	c.sessMu.Lock()
	s := c.sess
	c.sessMu.Unlock()
	if s.lst == nil || s.gen != gen {
		return nil
	}
	ch := c.flight.DoChan("init", func() (any, error) {
		lctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), c.timing().HandshakeTimeout)
		defer cancel()
		return nil, c.initBrokerage(lctx, s.lst)
	})
	select {
	case <-ctx.Done():
		return ctx.Err()
	case r := <-ch:
		return r.Err
	}
}
