# Implementation Spec: fix-ibkr-request-signing

**Status**: `pending`
**Created**: 2026-10-21
**Feature**: `docs/roadmap/features/249-fix-ibkr-request-signing/feature.md`
**Total Steps**: 17
**Feature Branch**: `feature/fix-ibkr-request-signing`

---

## Execution Summary

The work follows the design.md build order. The independent reference fixtures come first (Step 1), so every
later red test asserts against ibind-computed vectors and never against our own signer. The broker package is
built bottom-up: the signer (Steps 2–3), the coalesced LST session (Steps 4–5), then the single `c.do` send seam.
`c.do` migrates all 11 call sites and deletes `signRequest` (Steps 6–7). Service plumbing follows: the credential
shape, the `Timing` getter, IBKR-only `InvalidArgument`, the uncertain-outcome predicate and the `reconcileTick`
skip (Steps 8–9). Config registration comes next (Step 10), then the comment-only proto edit and codegen
(Steps 11–12). The two consumer surfaces come after that, UI (Steps 13–14) and agent (Steps 15–16), and docs plus
teardown close the work (Step 17). Paths are relative to the repo root.

**Spec-time evidence (ibind @ `759ec3a127accfb03e76bcd54856d1421d986e6a`, master, 2026-10-06, read
2026-10-21).** These pins come from reading the reference client's source. They are not guesses, and they settle
design.md's delegated pins:
- **Encoding.** `generate_base_string` (`ibind/oauth/oauth1a.py:300-328`) joins the sorted `k=v` pairs **raw**,
  then applies `quote_plus` once to the whole string. It also applies `quote_plus` to the URL. The signature
  placed in the header is itself `quote_plus`-encoded (`:412`, `:429`). Python `quote_plus` keeps
  alnum plus `_.-~` and turns a space into `+`, which is the same set Go's `url.QueryEscape` uses. So the pinned
  rule is "`url.QueryEscape` applied once to the raw joined string". It is **not** the per-pair double encoding
  that `ibkr.go:604`/`:611` does today, and **not** RFC 5849 §3.6 `%20`. This corrects design.md §1's "RFC 5849
  §3.6 `oauthEncode`" and "`url.QueryEscape` is removed" wording. design.md §1 also says "the exact rule is pinned
  by ibind vectors", and that clause governs.
- **Param set.** The params are `oauth_consumer_key`, `oauth_nonce`, `oauth_signature_method`, `oauth_timestamp`
  and `oauth_token`, plus `diffie_hellman_challenge` on the LST request. There is **no `oauth_version`**
  (`oauth1a.py:207-216`). The nonce is 16 alnum chars (`:284-297`).
- **Header.** `OAuth realm="<realm>", ` followed by every pair sorted by key, values verbatim (`:497-508`).
  `realm` defaults to `limited_poa` (`ibind/var.py:178`).
- **LST.** The request is `POST <base>/oauth/live_session_token` (`var.py:148`) with no body, RSA-SHA256
  PKCS#1 v1.5 (`oauth1a.py:387-412`), signed over `prepend + baseString` (`:326-327`). `prepend` is the hex of the
  PKCS#1 **v1.5**-decrypted, base64-decoded `access_token_secret` (`:365-384`). The DH challenge is
  `hex(g^a mod p)` with no `0x`, from a 256-bit random `a`, with `g` defaulting to 2 (`:331-362`). Then
  `K = B^a mod p`. `to_byte_array(K)` gives the minimal big-endian bytes with a leading `0x00` added when
  `bitlen(K) % 8 == 0` (`:440-452`). `LST = base64(HMAC-SHA1(K, bytes.fromhex(prepend)))` (`:455-480`). The
  reply fields are `live_session_token_expiration` (ms), `diffie_hellman_response` and
  `live_session_token_signature` (`:165-167`). The signature is valid iff
  `hex(HMAC-SHA1(b64decode(LST), consumer_key)) == live_session_token_signature` (`:483-494`).
- **Regular request.** `base64(HMAC-SHA256(b64decode(LST), baseString))` (`:415-429`).
- **Brokerage session.** `POST iserver/auth/ssodh/init` with body `{"publish": true, "compete": <bool>}`
  (`ibind/client/ibkr_client_mixins/session_mixin.py:38-49`). ibind defaults to `compete=True`; this feature keeps
  `compete=false` (design.md § Rejected Alternatives). Auth-status fields are `authenticated`/`competing`/
  `connected` (`session_mixin.py:15-20`). ibind does not read the init reply, so reading `authenticated` from it
  stays an unverified guess (Open Risk).
- **Lapsed brokerage session.** IBKR answers HTTP **400** with a body containing `no bridge`
  (`ibind/client/ibkr_client.py:139-143`). This is the pinned non-401 "not authenticated" reply that `c.do` treats
  as a re-init trigger (design.md §4; AC-6 row 7).
- **CONFLICT, needs an operator ruling before the integration PR merges.** ibind's regular-request path signs
  **without query params**. `_get_headers(request_method, request_url)` passes no `request_params`
  (`ibkr_client.py:146-158`), and `request_url = base_url + endpoint` excludes the params that `requests` appends
  (`ibind/base/rest_client.py:226-231`, `:253`). FR-3 and the operator's binding scope ("sign query params in the
  base string") require including them, and this spec follows FR-3. If IBKR's server mirrors ibind, including
  them would 401 every GET that carries a query (`resolveConid`, `GetOrder`, `ListOrders`). The inclusion is one
  isolated call in `buildBaseString` (Step 2). Only a paper smoke can decide. Recorded in context.md Open
  Threads and the Open Risks below.
  - **The vectors do not settle it.** The AC-1 vectors (Step 1 (c)) call ibind's `generate_base_string` with
    `request_params`, which ibind's regular-request path never passes. They prove self-consistency with the
    RFC 5849 base-string rule, not IBKR acceptance. If IBKR mirrors ibind, every query-carrying GET 401s while all
    tests pass (`fails.md:481-484`).
  - **Gate timing.** `/sdd-execute` announces this conflict at the Step 2 checkpoint, and the operator rules there:
    include (FR-3) or exclude (ibind). The operator may instead explicitly defer the ruling to the integration-PR
    merge, and that deferral is recorded in context.md. With no live account (operator decision, 2026-10-20), the
    decisive smoke is a paper `GetOrder` (query) next to `ValidateCredentials` (no query). Both 200 → include. A
    query 401 while the no-query call is 200 → exclude, which flips the single `buildBaseString` inclusion and the
    AC-1 vector.

### Scenario Coverage (C-15)

| Scenario | Covered by |
|---|---|
| `@AC-1` GET with query params signed over them | Step 3 (signer vector), Step 7 (`GetOrder` on the wire) |
| `@AC-2` every request LST-signed, carries realm | Step 3 (signer), Step 7 (GET/POST/DELETE on the wire) |
| `@AC-3` LST obtained before the first regular request | Step 5 (broker), Step 9 (service: CredentialStatus OK) |
| `@AC-4` handshake failure classified per TRADING-3 (9 rows) | Step 5 (error class per row), Step 9 (CredentialStatus per row) |
| `@AC-5` legacy 4-field blob INVALID, no HTTP, keeps pool entry | Step 5 (no HTTP), Step 9 (LoadBrokerPool + status) |
| `@AC-6` 401 retry-once, generation-guarded (7 rows) | Step 7 (all rows), Step 9 (row 5: uncertain, not REJECTED) |
| `@AC-7` incomplete IBKR blob rejected at registration | Step 9 (backend), Step 14 (UI form), Step 16 (agent passthrough) |
| `@AC-8` session failure before order POST is REJECTED | Step 7 (no POST, error class), Step 9 (classifier → definite) |
| `@AC-9` credential-rejected call not systemic | Step 9 |
| `@AC-10` negative cache, later heals | Step 5 (broker), Step 9 (service) |

### Consumer surfaces (C-14)

- `/trader` Accounts IBKR register/edit form → Steps 13–14.
- `/trader` credential badge, order ticket and order views → no code change. They read the backend result (OK
  instead of INVALID).
- Agent `manage_account` register/update_credentials → Steps 15–16.
- Agent `list_accounts` → no contract change.
- Existing 4-field IBKR accounts → read INVALID until updated (Steps 4, 8; AC-5).

Nothing is deferred. Two out-of-scope follow-ups are named in Step Dependencies.

## Step Dependencies

- Step 1 precedes every test step: the vectors, test keys and DH params in Step 1 are the oracles of Steps 3, 5,
  7, 9.
- Steps 7 and 9 require Step 5: both consume `testdata.IBKRAuthHandler`, which Step 5 adds to
  `internal/testdata/ibkr.go`.
- Step 3 [test] covers Step 2 [service]; Step 5 [test] covers Step 4; Step 7 [test] covers Step 6; Step 9 [test]
  covers Step 8; Step 14 [test] covers Step 13; Step 16 [test] covers Step 15. `/sdd-execute` runs each test step's
  new assertions RED against the tree before its service step, then GREEN after (P-06).
- Step 4 requires Step 2: the handshake signs the LST request and `ssodh/init` with the Step-2 signer.
- Step 6 requires Step 4: `c.do` calls `ensureSession`/`invalidate`.
- Step 8 requires Steps 4 and 6: it passes the new `IBKRConfig` fields and branches on `broker.ErrOutcomeUncertain`
  (Step 6).
- Step 10 requires Step 8: it registers the keys Step 8 reads.
- Step 12 requires Step 11: proto-gen after the `.proto` edit. Feature 240 also touches `trading.proto`/`gen/`;
  whichever merges second re-runs `./scripts/buf-gen.sh` (context.md overlap note).
- Step 13 requires Step 8: the UI submits the 7-field shape that Step 8 validates.
- Step 15 requires Step 8: the docstring states the backend's new `InvalidArgument`.
- Step 17 runs last: the doc anchors cite the final line numbers.
- **Out-of-scope follow-ups (tracked, not deferred surfaces):**
  - `ibkr-session-keepalive` (`/tickle`, blocked by 249; NNN assigned at `/sdd-story`; 253 is taken).
  - `ibkr-fleet-invalid-alert` (one aggregate alert when every IBKR account reads INVALID in a tick; this spec
    chooses the follow-up over an in-scope alert, per C-18/YAGNI).
  Both are recorded in context.md Open Threads.
- **Operator gate at the Step 2 checkpoint** (or an explicitly recorded deferral to the integration-PR merge): the
  FR-3 vs ibind query-param conflict above.

---

### Step 1 — test: IBKR reference fixtures (ibind vectors, test keys, DH params, gitleaks scope)

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/testdata/ibkr/signature_key.pem` — create
- `services/xstockstrat-trading/internal/testdata/ibkr/encryption_key.pem` — create
- `services/xstockstrat-trading/internal/testdata/ibkr/dhparam.pem` — create
- `services/xstockstrat-trading/internal/testdata/ibkr/gen_vectors.py` — create
- `services/xstockstrat-trading/internal/testdata/ibkr/vectors.json` — create (generated)
- `services/xstockstrat-trading/internal/testdata/ibkr.go` — create
- `.gitleaks.toml` — modify

**Reviewers**: `xstockstrat-trading` owner — broker API safety; Security — committed test key material, gitleaks scope

**Codebase Evidence**:
- Go fixture home exists: `ls services/xstockstrat-trading/internal/testdata/` → `offline_history.go`,
  `order_rows.go`. Its package doc is `order_rows.go:1-3` ("shared test fixtures … Constitution C-13 — Go
  canonical fixture home").
- No in-repo vectors or RSA test keys exist (recon.md:252-256). `zz_sigrepro_test.go` was ephemeral.
- `.gitleaks.toml:33-40` is a single `[allowlist]` table, `regexTarget = "line"`, with four exact-literal
  `regexes`. Each one is documented by a comment block above it (`:6-32`).
- gitleaks runs in CI via `gitleaks/gitleaks-action@v3` (`.github/workflows/ci.yml:767`). trufflehog runs
  `--only-verified` (`ci.yml:750`, `extra_args` `:762`). gitleaks is installed on this host at
  `~/go/bin/gitleaks` (re-spec 2026-10-28), so both mandatory gitleaks commands below can run here.
- Reference: ibind @ `759ec3a1` (Execution Summary pins).

**TDD**: `N/A (fixture data only — consumed by the red assertions of Steps 3, 5, 7, 9)`

**Covers**: `—` (fixture-only; the `AC-1`/`AC-2`/`AC-3`/`AC-4` assertions that read it are in Steps 3, 5, 7, 9)

**Instructions**:
1. Generate two fixed 2048-bit RSA test keys once and commit them:
   `openssl genrsa -traditional -out signature_key.pem 2048`, and the same for `encryption_key.pem`.
   - These are runtime-generated-once, committed keys. The rejected alternative is runtime generation in the
     tests themselves, which cannot reproduce the PKCS#1 v1.5 vectors.
   - Prepend a first-line comment to neither file: PEM headers stay standard.
2. `dhparam.pem`: a `-----BEGIN DH PARAMETERS-----` PEM encoding ASN.1 `{P, G}` with the public RFC 3526 group 14
   prime and `G=2`. Build it with `openssl dhparam` from that published prime, or encode it in the generator.
   Public, so not a secret.
3. `gen_vectors.py`: a standalone script that imports **only ibind's functions** from `ibind.oauth.oauth1a`:
   `generate_base_string`, `generate_hmac_sha_256_signature`, `generate_rsa_sha_256_signature`,
   `calculate_live_session_token_prepend`, `generate_dh_challenge`, `calculate_live_session_token`,
   `validate_live_session_token`, `generate_authorization_header_string` and `read_private_key`. It must not
   reimplement them. Inputs are fixed:
   - consumer key `TESTCONS1`, access token, a base64 `access_token_secret` produced by
     PKCS#1 v1.5-encrypting a fixed 32-byte secret to `encryption_key.pem`'s public key;
   - nonces `nonceAAAAAAAAAAA` and `nonceBBBBBBBBBBB`, timestamp `1700000000`;
   - a fixed 256-bit DH random as hex, and a server-side fixed `b` so `B = g^b mod p`.

   It emits `vectors.json` with:
   - (a) the LST request: base string, RSA-SHA256 `oauth_signature`, full `Authorization` header, DH challenge;
   - (b) the LST reply (`diffie_hellman_response`, `live_session_token_expiration`,
     `live_session_token_signature`) and the derived LST;
   - (c) regular-request vectors (base string, signature, header) for the `ssodh/init` POST, `GET
     /portfolio/accounts`, `GET /iserver/account/orders` with `request_params={"orderId":"42"}` (AC-1),
     `GET /iserver/secdef/search` with `{"symbol":"AAPL","types":"STK"}` and with `{"symbol":"BRK B","types":"STK"}`,
     `POST /iserver/account/U123/orders` and `DELETE /iserver/account/U123/order/42` (AC-2), for both nonces;
   - (d) for each (c) row, the legacy-key signature: HMAC-SHA256 keyed by `"&" + access_token_secret` over the same
     base string (AC-2 negative);
   - (e) a known-answer decrypt vector (ciphertext → plaintext hex) and one wrong-key ciphertext;
   - (f) two DH cases where `bitlen(K) % 8 == 0` and `!= 0`, found by iterating `b` in the script.

   The script header records the ibind SHA, the date checked, and the exact run command:
   `uv run --with "ibind[oauth] @ git+https://github.com/Voyz/ibind@759ec3a127accfb03e76bcd54856d1421d986e6a" python internal/testdata/ibkr/gen_vectors.py > internal/testdata/ibkr/vectors.json`.
   Re-pin the SHA if master moved, and record the new one in the header and in the step's Deviation Log entry.
4. `internal/testdata/ibkr.go` (package `testdata`, no import of `internal/broker`, to avoid an import cycle with
   Step 3's in-package tests):
   - `//go:embed ibkr/*.pem ibkr/vectors.json`;
   - exported `IBKRSignatureKeyPEM`, `IBKREncryptionKeyPEM`, `IBKRDHParamPEM` strings and a typed `IBKRVectors`
     struct decoded once (`MustIBKRVectors()`).
   The replay handler is added in Step 5.
5. `.gitleaks.toml`: append a comment block in the existing style (`:6-32`), naming the two PEM sites and why they
   are fake. Then add a regex for a **unique 40+-char substring of each committed key body** (the first base64
   body line) to the existing `"line"` `regexes` (`:35-40`). Do not change `regexTarget`.
   - Fallback, only if a local scan still reports the PEMs: a separate `[[allowlists]]` block with
     `condition = "AND"`, `paths = ['''services/xstockstrat-trading/internal/testdata/ibkr/.*\.pem''']` and the
     same regexes. Use it only after confirming that the gitleaks bundled by `gitleaks-action@v3` supports it, and
     record the bundled version in the Deviation Log.
   - Unproven: whether a `regexTarget = "line"` regex suppresses a multi-line `private-key` finding
     (`.gitleaks.toml:34`). Both gitleaks commands below are **mandatory**: the "no leaks found" scan and the
     "new key still detected" probe. If gitleaks cannot be installed on the host, the step is not done.
   - The step touches 7 files, over the advisory 5-file limit. It is kept whole because the gitleaks scope
     exists only for these PEMs, and Security reviews them together.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go vet ./internal/testdata/ && \
  GOWORK=off go test ./internal/testdata/ -count=1   # package compiles; vectors.json decodes
python3 -c "import json;d=json.load(open('internal/testdata/ibkr/vectors.json'));print(sorted(d))"
cd ../.. && gitleaks dir services/xstockstrat-trading/internal/testdata/ibkr --config .gitleaks.toml  # ~/go/bin/gitleaks (brew install gitleaks) → "no leaks found"
openssl genrsa 2048 > /tmp/probe.pem && gitleaks dir /tmp/probe.pem --config .gitleaks.toml  # a NEW key is still detected (exit 1)
```

---

### Step 2 — service: signer — `authorize` replaces `signRequest`'s base-string/header logic

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/broker/ibkr.go` — modify

**Reviewers**: `xstockstrat-trading` owner — broker API safety

**Codebase Evidence**:
- `signRequest(method, rawURL string)` is at `ibkr.go:580-627`:
  - nonce `rand.Read` `:581-583`, timestamp `time.Now().Unix()` `:584`;
  - param map including `oauth_version` `:586-593`, per-pair `url.QueryEscape` `:604`;
  - base string `:609-611`, key `"&" + url.QueryEscape(c.accessTokenSecret)` `:614`;
  - map-ranged header `:622-626`.
- `IBKRConfig` `ibkr.go:24-31` and `IBKRClient` `:34-42` have no seams. All broker tests are `package broker_test`
  (`ibkr_test.go`, `ibkr_reply_test.go:1`). No `export_test.go` exists (recon.md:246-248).
- Imports already include `crypto/hmac`, `crypto/sha256`, `encoding/base64`, `net/url`, `sort` (`ibkr.go:3-21`).
- Encoding/param-set/header rule: Execution Summary pins (ibind `oauth1a.py:300-328`, `:207-216`, `:497-508`).

**TDD**: `red-green required`

**Covers**: `—`

**Instructions**:
1. Add exported optional seams to `IBKRConfig`, retained on `IBKRClient` with defaults in `NewIBKRClient`
   (`:48-63`):
   - `Now func() time.Time` (default `time.Now`);
   - `Nonce func() string` (default: 16 chars from `[A-Za-z0-9]` via `crypto/rand`);
   - `DHRandom func() *big.Int` (default: 256-bit `crypto/rand`; used in Step 4).
   - The realm is the unexported constant `ibkrRealm = "limited_poa"`, not an `IBKRConfig` field. It is a
     protocol constant, not config (design.md §7).
2. Add `buildBaseString(method string, u *url.URL, oauth map[string]string) string`:
   - merge `oauth` with every decoded `u.Query()` value (FR-3; the single isolated inclusion point, see the
     Execution Summary CONFLICT);
   - sort by key and join `k=v` raw with `&`;
   - return `METHOD & oauthEncode(baseURI) & oauthEncode(paramString)`, where `baseURI` is the lowercased
     `scheme://host` plus `u.Path` with no query (FR-3).
   - `oauthEncode` is one helper wrapping `url.QueryEscape`; vectors pin it (Step 3).
3. Add `authorizeHeader(oauth map[string]string, sig string) string`. It returns
   `OAuth realm="limited_poa", ` followed by every pair sorted by key, `oauth_signature` set to `oauthEncode(sig)`,
   other values verbatim. This replaces the map range at `:622-626`.
4. Add `(c *IBKRClient) authorize(req *http.Request, lst []byte) string`:
   - oauth params `oauth_consumer_key`, `oauth_nonce`, `oauth_signature_method=HMAC-SHA256`, `oauth_timestamp`,
     `oauth_token`, with no `oauth_version`;
   - signature `base64(HMAC-SHA256(lst, baseString))`, where `lst` is the base64-decoded LST (FR-2).
5. Add `(c *IBKRClient) authorizeLST(req *http.Request, prepend string, dhChallenge string, key *rsa.PrivateKey)
   (string, error)`:
   - params as above with `oauth_signature_method=RSA-SHA256` plus `diffie_hellman_challenge`;
   - `rsa.SignPKCS1v15(nil, key, crypto.SHA256, sha256(prepend+baseString))`, base64-encoded.
6. Keep `signRequest` and its 11 call sites unchanged in this step. Step 6 deletes them, so the tree compiles and
   ships nothing half-wired. Delete the `"&" + accessTokenSecret` key only in Step 6.
- Broker coverage: IBKR-only. `ALPACA`: unaffected (`alpaca.go` untouched).
- Order types, fill handling and the trading-mode gate are unaffected by this step.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go build ./... && GOWORK=off golangci-lint run --modules-download-mode=mod ./internal/broker/...
grep -n "oauth_version" internal/broker/ibkr.go   # only inside the not-yet-deleted signRequest
```

---

### Step 3 — test: signer known-answer vectors (AC-1, AC-2 signer half)

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/broker/ibkr_sign_internal_test.go` — create (package `broker`)

**Reviewers**: `xstockstrat-trading` owner — broker API safety

**Codebase Evidence**:
- External-package tests cannot reach unexported signers (recon.md:246-248). An in-package `_test.go` can.
  `internal/testdata` imports no `internal/broker` (Step 1), so there is no cycle.
- Vectors: `testdata.MustIBKRVectors()` (Step 1).

**TDD**: `red-green required` — RED: the file does not compile, or fails, against the pre-Step-2 tree (no
`authorize`). GREEN after Step 2.

**Covers**: `AC-1, AC-2`

**Instructions**:
1. `TestIBKRAuthorize_GETQueryParamsSigned` (`@AC-1`). Build `GET <base>/iserver/account/orders?orderId=42` with
   `Nonce`/`Now` seams fixed to the vector inputs.
   - Assert `buildBaseString` equals the vector base string byte for byte, and that its URI part has no `?`.
   - Assert the `oauth_signature` in `authorize(...)`'s header equals the vector.
2. `TestIBKRAuthorize_LSTKeyedAndRealm` (`@AC-2`), table over GET secdef `AAPL`, POST `/iserver/account/U123/orders`
   and DELETE `/iserver/account/U123/order/42`:
   - the header has prefix `OAuth realm="limited_poa"`;
   - the signature equals the LST-keyed vector and **differs** from the `"&"+secret` vector.
3. `TestIBKRAuthorize_EncodingPinned`: the `BRK B` vector (space), and the signature's `+`/`/`/`=` encoded in the
   header exactly as in the vector.
4. `TestIBKRAuthorizeLST_RSAVector`: `authorizeLST` with the Step-1 signature key, prepend and challenge equals
   vector (a). PKCS#1 v1.5 signing is deterministic.
- C-13: vectors and keys come from `internal/testdata` (two consumers after Step 5), never inline.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go test ./internal/broker/ -run 'TestIBKRAuthorize' -race -count=1 -v
GOWORK=off golangci-lint run --modules-download-mode=mod
GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # ≥ 40%
grep -rn "nonceAAAAAAAAAAA" --include="*_test.go" internal | wc -l   # literals come via testdata, not redeclared
```

---

### Step 4 — service: LST session — key material, coalesced handshake, `ssodh/init`, negative cache

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/broker/ibkr.go` — modify
- `services/xstockstrat-trading/internal/broker/ibkr_session.go` — create
- `services/xstockstrat-trading/go.mod` — modify
- `services/xstockstrat-trading/go.sum` — modify (only if `go mod tidy` changes it)

**Reviewers**: `xstockstrat-trading` owner — broker API safety; Security — RSA/DH key handling, error text never embeds key material

**Codebase Evidence**:
- `golang.org/x/sync v0.22.0 // indirect` is at `services/xstockstrat-trading/go.mod:34`. The `singleflight`
  precedent is `services/xstockstrat-marketdata/internal/service/marketdata_service.go:15,60` (recon.md:111-114).
- `IBKRConfig` (`ibkr.go:24-31`) holds no key material. Instantiate failures are logged with `err`
  (`trading.go:268`, `:2521`, `:2570`), so parse errors must not echo PEM bytes (recon.md:301-303).
- PEM parse precedent: `load()` at `internal/mtls/mtls.go:22-41` wraps errors without echoing material (weak
  precedent, recon.md:119-121).
- The TRADING-3 switch to reuse is `ibkr.go:568-576` (401/403 → `ErrInvalidCredentials`, `broker.go:10`).
- `validateAndRecordCredential`'s 5s `valCtx` is at `trading.go:2603`. The reconcile per-call bound is
  `brokerCallTimeout()` at `trading.go:2440-2446` (5000ms).
- Protocol pins: Execution Summary (ibind `oauth1a.py:127-193`, `:331-384`, `:440-494`; `session_mixin.py:38-49`).

**TDD**: `red-green required`

**Covers**: `—`

**Instructions**:
1. `IBKRConfig` gains:
   - `SignatureKey`, `EncryptionKey` (PEM RSA private keys) and `DHPrime` (PEM DH parameters);
   - `Timing func() IBKRTiming`, where `IBKRTiming{LSTRefreshMargin, HandshakeTimeout, ReauthMinInterval
     time.Duration}`. A nil `Timing` falls back to 60s/10s/30s for tests only; production always passes it
     (Step 8).
2. `NewIBKRClient` parses once:
   - each RSA key via `pem.Decode`, then `x509.ParsePKCS1PrivateKey`, falling back to `ParsePKCS8PrivateKey`
     (RSA only);
   - `DHPrime` via `pem.Decode` + `asn1.Unmarshal` into `struct{ P, G *big.Int }`, using the parsed `G`.
   - Retain any failure as `c.credErr = fmt.Errorf("ibkr credentials: %s missing or unparseable: %w", field,
     ErrInvalidCredentials)`. The field **name** only, never bytes. This covers the legacy 4-field blob
     (empty fields).
   - The constructor signature is unchanged: it never fails, so `instantiateBrokerLocked` stays tolerant
     (design.md §8).
3. `ibkr_session.go`:
   - `type session struct{ gen uint64; lst []byte; exp time.Time }`, guarded by `c.sessMu sync.Mutex`. The lock is
     never held across I/O (TRADING-5 discipline).
   - `c.flight singleflight.Group`.
   - `negUntil time.Time` and `negErr error` (the negative cache).
4. `(c *IBKRClient) ensureSession(ctx) (snapshot session, mintedByMe bool, err error)`:
   1. If `c.credErr != nil`, return it with no HTTP call (AC-5).
   2. If the cached session is valid (`now < exp − LSTRefreshMargin`), return it.
   3. If `now < negUntil`, return `negErr` with no HTTP call (AC-10).
   4. Otherwise `ch := c.flight.DoChan("lst", c.handshake)` with a leader ctx
      `context.WithTimeout(context.WithoutCancel(ctx), Timing().HandshakeTimeout)`. Select on `ch` and the
      caller's `ctx.Done()`. A waiter whose ctx expires returns a transient `ctx.Err()`; the leader keeps running
      and caches its result.
   5. **Joiner re-call rule** (design.md §2 `:59-61`; C-18 trade-off recorded at design.md:301-302): re-call
      `DoChan` once only if this caller joined a flight that
      started before its own call and that flight returned a transient error. Track this with a flight start
      timestamp compared to the call's entry time. A leader, or a waiter on the flight that produced generation G,
      reports `mintedByMe=true`.
      - Why it is not redundant with the negative cache or `ReauthMinInterval`: those two gate only
        `ErrInvalidCredentials` outcomes (step 5.7) and 401 invalidations (step 6). This rule gates only a
        **transient** result from a flight the caller did not start.
5. `(c *IBKRClient) handshake(ctx) (session, error)`:
   1. `prepend = hex(rsa.DecryptPKCS1v15(nil, encKey, b64decode(access_token_secret)))`. On failure return
      `%w ErrInvalidCredentials` without echoing input. If staticcheck SA1019 flags the call, add
      `//nolint:staticcheck // IBKR's LST protocol mandates PKCS#1 v1.5 (ibind oauth1a.py:375)`.
   2. `a = DHRandom()`, `A = G^a mod P`. `POST <base>/oauth/live_session_token`, no body, `Authorization` from
      Step 2's `authorizeLST`.
   3. Classify the response with the reused switch: 401/403 → `%w ErrInvalidCredentials`; other non-2xx, network
      or timeout → wrapped transient.
   4. Parse `diffie_hellman_response`, `live_session_token_expiration` (ms epoch) and
      `live_session_token_signature`. Compute `K = B^a mod P`, then `kb = K.Bytes()`, prepending `0x00` when
      `K.BitLen()%8 == 0`. `LST = HMAC-SHA1(kb, hexdecode(prepend))`.
   5. Verify `hex(HMAC-SHA1(LST, consumer_key)) == live_session_token_signature` with `hmac.Equal`. A mismatch is
      `%w ErrInvalidCredentials`.
   6. `POST <base>/iserver/auth/ssodh/init` with `{"publish":true,"compete":false}`, signed with `authorize(req,
      LST)`. A 2xx reply lacking `authenticated:true` logs
      `slog.Warn("ibkr brokerage session not established", "competing", <bool>)` and returns `%w
      ErrInvalidCredentials`. 401/403 → `ErrInvalidCredentials`. 5xx or network → transient.
   7. On success, store under `sessMu` with `gen++`. On an `ErrInvalidCredentials` result, set
      `negUntil = now + ReauthMinInterval`.
6. `(c *IBKRClient) invalidate(gen uint64) bool`: clears the session only if `gen` is still current **and** the
   last 401-triggered invalidation was at least `ReauthMinInterval` ago. Returns whether it invalidated.
   `reinit(ctx, gen)` re-runs only step 5.6 under the same flight key `"init"`. Both are consumed by Step 6.
7. Promote the dependency: `GOWORK=off go get golang.org/x/sync@v0.22.0 && GOWORK=off go mod tidy`. The
   `// indirect` marker is dropped (`go.mod:34`).
8. `realm`, `compete=false` and the endpoint paths are protocol constants (design.md §7), not config.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go build ./... && GOWORK=off golangci-lint run --modules-download-mode=mod
grep -n "golang.org/x/sync" go.mod   # no "// indirect"
grep -n "compete\|limited_poa" internal/broker/*.go   # compete:false only; realm constant only
grep -nE 'Errorf\(.*(PEM|pem)\b.*%s.*(Key|key)\)' internal/broker/ibkr*.go   # no key bytes interpolated (expect none)
```

---

### Step 5 — test: session handshake, classification, coalescing, negative cache (AC-3/4/5/10 broker half)

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/testdata/ibkr.go` — modify (add `IBKRAuthHandler`)
- `services/xstockstrat-trading/internal/broker/ibkr_session_internal_test.go` — create (package `broker`)

**Reviewers**: `xstockstrat-trading` owner — broker API safety

**Codebase Evidence**:
- Fakes to extend, not duplicate: `ibkrOrdersServer` (`internal/broker/ibkr_reply_test.go:17-35`) and
  `newPromptServer` (`:50-75`). Clients are built as `broker.NewIBKRClient(broker.IBKRConfig{BaseURL: srv.URL,
  ...})` (`ibkr_test.go:52`, `ibkr_reply_test.go:80`).
- A server-side DH/RSA oracle is rejected (design.md § Rejected Alternatives; `fails.md:481-484`). The handler
  replays vectors and checks signature strings by equality.

**TDD**: `red-green required` — RED before Step 4 (no `ensureSession`), GREEN after.

**Covers**: `AC-3, AC-4, AC-5, AC-10`

**Instructions**:
1. Add `testdata.IBKRAuthHandler` (net/http only) to `internal/testdata/ibkr.go`:
   - Routes:
     - `POST /oauth/live_session_token` answers vector (b) JSON;
     - `POST /iserver/auth/ssodh/init` answers `{"authenticated":true,"competing":false,"connected":true}` by
       default;
     - every other path goes to an optional `Next http.Handler`.
   - It records each request's method, path+query and `Authorization` in order.
   - `Strict bool`: when true, every `oauth_signature` must equal the vector for (method, path+query, nonce), and
     anything else is a 401.
   - Per-path override hooks (status code, body, block-until-`done`) script the AC-4 rows.
   - The second consumer is Step 7/9 tests (C-13).
2. Internal tests:
   - `TestEnsureSession_HandshakeOrderAndLST` (`@AC-3`): strict handler, fixed `Nonce`/`Now`/`DHRandom` seams.
     - The recorded order is LST POST, then `ssodh/init`, then nothing else.
     - The LST POST header equals vector (a), including `diffie_hellman_challenge`.
     - The stored LST equals vector (b).
   - `TestEnsureSession_FailureClassification` (`@AC-4`), table of the 9 rows. Assert
     `errors.Is(err, ErrInvalidCredentials)` for the INVALID rows: 401, 403, undecryptable secret (vector (e)
     wrong-key ciphertext), signature mismatch, init 2xx without `authenticated:true`, init `competing:true`.
     - Assert not-sentinel for 503, timeout and init 503.
     - Timeout row: `Timing` returns `HandshakeTimeout: 50ms`; the handler blocks on a channel closed in
       `t.Cleanup`.
     - Each INVALID row also asserts the handler saw no `GET /portfolio/accounts`.
   - `TestEnsureSession_LegacyBlobNoHTTP` (`@AC-5`): an empty `SignatureKey`/`EncryptionKey`/`DHPrime` returns
     `ErrInvalidCredentials`, the handler records **zero** requests, and the error text contains no PEM.
   - `TestEnsureSession_NegativeCacheAndHeal` (`@AC-10`):
     - a 401 handshake, then a second call before `ReauthMinInterval` (advance the `Now` seam by less than it):
       zero new LST requests;
     - flip the handler to accept and advance past the interval: success.
   - `TestEnsureSession_CoalescesConcurrentCallers`: 16 goroutines yield exactly one LST POST (`-race`).
   - `TestEnsureSession_DetachedFromCallerCtx` (boot budget, design.md Open Risk): a caller ctx of 10ms with the
     handler delaying 50ms returns a transient error. The handshake still completes, and a second call makes no
     new LST POST.
   - `TestEnsureSession_JoinerRecall`: a joiner of an older failed flight re-calls once; a leader does not.
   - `TestDHKeyBytes_HighBitVectors`: both vector (f) cases.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go test ./internal/broker/ ./internal/testdata/ -run 'TestEnsureSession|TestDHKeyBytes' -race -count=1 -v
GOWORK=off golangci-lint run --modules-download-mode=mod
GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # ≥ 40%
grep -rn "func ibkrAuthServer\|live_session_token" --include="*_test.go" internal | grep -v testdata   # no second fake declared inline
```

---

### Step 6 — service: `c.do` send seam — migrate 11 call sites, 401 retry, lapsed-session re-init, uncertain resend

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/broker/ibkr.go` — modify
- `services/xstockstrat-trading/internal/broker/ibkr_session.go` — modify
- `services/xstockstrat-trading/internal/broker/broker.go` — modify

**Reviewers**: `xstockstrat-trading` owner — order execution correctness, broker API safety

**Codebase Evidence**:
- 11 `Header.Set("Authorization", c.signRequest(...))` + `c.httpClient.Do` pairs, at `confirmReply` `ibkr.go:127-128`,
  `resolveConid` `:168-170`, `SubmitOrder` `:234-236`, `SubmitBracketLegs` `:285-286`, `CancelOrder` `:313-315`,
  `ReplaceOrder` `:359-361`, `GetOrder` `:389-391`, `ListOrders` `:428-430`, `GetPositions` `:468-470`,
  `GetAccount` `:522-524` and `ValidateCredentials` `:561-563`.
- Every POST body is a `bytes.Reader`/`strings.Reader` (`:122`, `:229`, `:280`, `:354`), so `http.NewRequest` sets
  `GetBody`.
- `SubmitOrder` sends `cOID` (`:218-221`). `SubmitBracketLegs` sends none (`:261-274`).
- `confirmReply` keeps `%w` on transport errors (`:118-119`, `:130`).
- The duplicate 401/403 branch is `:568-576`.
- `ErrInvalidCredentials` doc comment is at `broker.go:8-9`.
- Only two uncertain classifiers exist. `grep -rn "DeadlineExceeded\|Timeout()" internal/ cmd/` (non-test) →
  `trading.go:684`, `:1521`, `:1973`, `:2377`, `:2440`, plus `alpaca.go:67`. Only `:684` and `:1521` classify
  errors: `:1973`/`:2377`/`:2440` match `brokerCallTimeout()`, and `alpaca.go:67` is the `HTTPTimeout()` method.
- Lapsed-session reply pinned: HTTP 400 with body containing `no bridge` (ibind `ibkr_client.py:139-143`).

**TDD**: `red-green required`

**Covers**: `—`

**Instructions**:
1. `broker.go`:
   - Reword `:8-9` to "returned on a definitive broker auth rejection (HTTP 401/403) or deterministically unusable
     credentials; may come from any broker call, not only ValidateCredentials".
   - Add `var ErrOutcomeUncertain = errors.New("broker outcome uncertain: request may have been processed")`.
2. `(c *IBKRClient) do(req *http.Request, op string, noResend bool) (*http.Response, []byte, error)`:
   1. `snap, minted, err := c.ensureSession(req.Context())`. Session errors are classified **inside `do`**,
      because callers cannot tell a session error from the real request's transport error once both come back as
      one `error` (design.md §5):
      - `errors.Is(err, ErrInvalidCredentials)` → return it wrapped `%w`;
      - any other `ensureSession` error, including a waiter's own `ctx.Err()`, → return
        `fmt.Errorf("ibkr %s: session: %v", op, err)`. The `%v` is mandatory: nothing was sent, so the outcome is
        definite, and `%w` would let `trading.go:684`/`:1521` misread a `context.DeadlineExceeded` as uncertain
        (AC-8).
      - The same rule applies to the re-`ensureSession` after `invalidate` (step 3) and to a `reinit` failure on a
        400 no-bridge. In both cases the first send was answered (401 or 400), so it was not processed, and the
        resend was never made.
      - Safe for non-order callers: `credentialStatusFromError` (`trading.go:2951-2960`) checks only the sentinel,
        and the only `DeadlineExceeded`/`Timeout()` classifiers are `:684` and `:1521`.
   2. Set `Authorization = c.authorize(req, snap.lst)` and send. The body is read and closed inside `do`.
   3. On **401**, or **400 with body containing `no bridge`** on an `/iserver/` path:
      - a 400 no-bridge runs `c.reinit(ctx, snap.gen)`, then resends once;
      - for a 401: if `minted`, it is final;
      - else if the current gen ≠ `snap.gen`, re-sign with the current session and resend once (no handshake);
      - else if `c.invalidate(snap.gen)`, call `ensureSession`, re-sign with a fresh nonce, rebuild the body via
        `req.GetBody()` and resend once;
      - otherwise final.
      - `noResend` (used only by `SubmitBracketLegs`) makes any 401 final with no resend.
   4. A final 401/403 returns `fmt.Errorf("ibkr %s %s: status %d: %w", op, req.URL.Path, code,
      ErrInvalidCredentials)`.
   5. **Uncertain-resend rule.** If a resend after a 401 was attempted on a POST/DELETE and the resend fails for any
      reason other than a final 401, return `fmt.Errorf("ibkr %s: resend after 401: %v: %w", op, cause,
      ErrOutcomeUncertain)`. Causes include transport, non-2xx, and a `cOID` duplicate rejection in the reply.
      GET resend failures are returned as ordinary errors.
   6. 5xx, network and timeout errors are **never** resent.
3. Replace all 11 pairs with `c.do(...)`; each caller keeps its own status switch on the returned code and body.
   - `ValidateCredentials` (`:555-577`) becomes `c.do` + a 200 check. Its sentinel now comes from `do`/
     `ensureSession`.
   - Delete `signRequest` (`:579-627`) and the `"&"+accessTokenSecret` key.
4. Callers wrap every `do` error with `%w`, unchanged. The session flatten already happened inside `do`
   (instruction 2.1), so order paths (`SubmitOrder`, `ReplaceOrder`, `CancelOrder`, `SubmitBracketLegs`,
   `confirmReply`, and `resolveConid` as called from them) need no per-caller classification. A session failure
   before the POST is a definite REJECTED at `trading.go:684`/`:1521` (design.md §5).
   - `ErrInvalidCredentials`, the real request's transport error and the resend's error keep `%w` (`do` returns
     them unflattened).
   - `confirmReply` keeps `%w` on its transport error (`:118-119`).
5. Broker coverage: IBKR-only. `ALPACA` unaffected; it returns the sentinel only from `ValidateCredentials`
   (`alpaca.go:493-509`).
   - Order types: unaffected (`orderTypeToIBKR` `:141-154` untouched).
   - Fill handling (`GetOrder`/`ListOrders` parsing `:402-414`, `:441-458`): unaffected. PARTIALLY_FILLED and
     FILLED map exactly as before.
   - Trading-mode gate: unaffected. Paper and live both use `ibkr.go:51`, with no `TRADING_MODE` read added.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go build ./... && GOWORK=off golangci-lint run --modules-download-mode=mod
grep -n "signRequest\|accessTokenSecret)" internal/broker/ibkr.go   # expect no signRequest
grep -c "c.do(" internal/broker/ibkr.go   # 11
grep -n 'session: %v' internal/broker/ibkr*.go   # only inside do (one classification point)
grep -n "TRADING_MODE\|TradingMode" internal/broker/ibkr.go   # expect none (no gate change)
```

---

### Step 7 — test: wire-level signing, 401 retry matrix, order-path classification; migrate existing IBKR tests (AC-1/2/6/8)

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/broker/ibkr_do_test.go` — create (package `broker_test`)
- `services/xstockstrat-trading/internal/broker/ibkr_test.go` — modify
- `services/xstockstrat-trading/internal/broker/ibkr_reply_test.go` — modify

**Reviewers**: `xstockstrat-trading` owner — order execution correctness, fill detection

**Codebase Evidence**:
- Existing IBKR tests build clients with empty creds and no handshake (recon.md:297-300): `ibkr_test.go:52`, `:101`,
  `:151`, `:220`, `:247`, `:269`, `:305`, `:352`, `:373`, `:397` and `ibkr_reply_test.go:80`, `:102`, `:116`,
  `:126`, `:139`, `:163`. `TestReplaceOrder_IBKR` (declared `ibkr_test.go:285`) asserts only that the header is
  non-empty: `if gotAuth == ""` at `ibkr_test.go:323` (recon.md:300).
- Fill-state tests already exist: `TestGetOrder_IBKRAvgPrice` (`ibkr_test.go:254`) and
  `TestIBKRListOrders_ParsesMultipleOrders` (`:361`).

**TDD**: `red-green required` — RED before Step 6 (old header lacks realm; 401 is not retried), GREEN after.

**Covers**: `AC-1, AC-2, AC-6, AC-8`

**Instructions**:
1. Migrate every existing IBKR test to `testdata.IBKRAuthHandler{Next: <existing mux>}` (lenient) with Step-1 key
   material in `IBKRConfig`. Keep `ibkrOrdersServer`/`newPromptServer` as the `Next` handlers rather than a
   parallel harness. Existing assertions are unchanged. `TestReplaceOrder_IBKR` additionally asserts the realm
   prefix.
2. `TestIBKRGetOrder_SignsQueryOnTheWire` (`@AC-1`): strict handler; the `GET /iserver/account/orders?orderId=42`
   header equals the vector.
3. `TestIBKR_EveryMethodLSTSignedWithRealm` (`@AC-2`), strict, for the three Examples rows (`resolveConid` GET,
   `SubmitOrder` POST, `CancelOrder` DELETE): realm prefix, LST-keyed vector, not the `"&"+secret` vector.
4. `TestIBKRDo_401RetryMatrix` (`@AC-6`), the 7 Examples rows:
   - GET 401 → one re-handshake and one resend with a new nonce (the `Nonce` seam yields A then B) → 200;
   - POST `SubmitOrder` 401 → the resent body is byte-equal and `cOID` unchanged → 200;
   - DELETE 401 → resend → 200;
   - `ValidateCredentials` 401 on a just-minted session → one request only → `ErrInvalidCredentials`;
   - POST 401 then a duplicate-`cOID` rejection body → `errors.Is(err, broker.ErrOutcomeUncertain)`;
   - `SubmitBracketLegs` 401 → no resend → `ErrInvalidCredentials`;
   - GET answered 400 `{"error":"Bad Request: no bridge"}` → `ssodh/init` re-run once, resend once → 200.
   Add the generation guard (the current gen ≠ the snapshot gen resends without a handshake) and the
   `reauth_min_interval` invalidation throttle as two more subtests.
5. `TestIBKRSubmitOrder_SessionFailureNoPOST` (`@AC-8` broker half): LST 503, and LST blocked past
   `HandshakeTimeout`.
   - The handler saw **no** `POST /iserver/account/U123/orders`.
   - The returned error is neither `errors.Is(err, context.DeadlineExceeded)` nor a `net.Error` `Timeout()`, nor
     `ErrOutcomeUncertain`.
6. Keep partial-fill coverage: `TestGetOrder_IBKRAvgPrice` already has a full-fill case. Add one
   `filledQuantity < quantity` case through the migrated handler, so PARTIALLY_FILLED and FILLED both still parse
   (fill-state constraint).
- C-13: the handler and vectors come from `internal/testdata` only. Assert ≤1 declaration of each.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go test ./internal/broker/ -race -count=1 -v
GOWORK=off golangci-lint run --modules-download-mode=mod
GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # ≥ 40%
grep -rn "type IBKRAuthHandler\|func IBKRAuthHandler" --include="*.go" internal | wc -l   # 1
```

---

### Step 8 — service: trading plumbing — credential shape, Timing keys, IBKR-only validation, uncertain predicate, reconcile skip

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading.go` — modify

**Reviewers**: `xstockstrat-trading` owner — order execution correctness, broker API safety; Security — new credential fields stay in the encrypted blob

**Codebase Evidence**:
- `ibkrCreds` (`trading.go:86-92`) has 4 fields. The IBKR branch of `instantiateBrokerLocked` is at
  `:3086-3097` (no `BaseURL`, no key material). The Alpaca config read pattern is
  `TimeoutMs: int(s.cfgW.GetInt("trading.broker.timeout_ms", 5000))` (`:3109`).
- The `≤0 → default` clamp pattern is `brokerCallTimeout` (`:2440-2446`). `config.Watcher.GetInt(key, def)` is at
  `internal/config/config.go:215`.
- Register: `json.Valid` at `:2496`, then `EncryptCredentials` at `:2500`. The offline early return is at
  `:2475-2494`.
- Update: `json.Valid` at `:2537`, then `GetBrokerAccount`, the ownership check and the offline guard at `:2549`,
  then `EncryptCredentials` at `:2552`. The broker type is known only after the lookup.
- Uncertain classifiers: `isTimeout := errors.Is(err, context.DeadlineExceeded) || (errors.As(err, &netErr) &&
  netErr.Timeout())` at `:684` (SubmitOrder) and `:1521` (ReplaceOrder).
- `reconcileTick` (`:1954`): `ListOrders` error → `systemicCount++` at `:1991-1994`; `GetPositions` error →
  `systemicCount++` at `:2076-2079`. Escalation is at `:2153-2154`; the known-invalid skip is at `:1977`.
- `credentialStatusFromError` (`:2951-2960`) and `validateAndRecordCredential` (`:2602`) stay **unchanged**
  (TRADING-5).

**TDD**: `red-green required`

**Covers**: `—`

**Instructions**:
1. `ibkrCreds` gains `SignatureKey string \`json:"signature_key"\``, `EncryptionKey string
   \`json:"encryption_key"\`` and `DHPrime string \`json:"dh_prime"\``.
   - Pass them, plus `Timing: s.ibkrTiming`, into `broker.IBKRConfig` at `:3091-3097`. Instantiate stays tolerant.
2. Add `func (s *TradingService) ibkrTiming() broker.IBKRTiming` next to `brokerCallTimeout` (`:2440`). It reads
   live, with `≤0 → default`:
   - `trading.ibkr.lst_refresh_margin_ms` (60000);
   - `trading.ibkr.handshake_timeout_ms` (10000);
   - `trading.ibkr.reauth_min_interval_ms` (30000).
   Use the full-dotted `s.cfgW.GetInt` (EXTEND `@AC-3 @feature-192`). These are not tied to `IBKRRequestTimeout`.
3. Add `validateIBKRCreds(raw string) error`. It returns `grpcstatus.Errorf(codes.InvalidArgument, "IBKR
   credentials_json missing required field(s): %s", <field names>)` when any of the 7 JSON fields is empty. It
   never echoes values.
   - Call it in `RegisterBrokerAccount` only when `req.BrokerType == BROKER_TYPE_IBKR`, after `:2496` and before
     `:2500`.
   - Call it in `UpdateBrokerAccountCredentials` only when `rec.BrokerType == IBKR`, after the offline guard
     `:2549` and before `:2552`.
   - The offline and Alpaca paths are unchanged (PRESERVE `@AC-1/@AC-2 @feature-157`).
4. Extract the duplicated expression into `func isUncertainBrokerOutcome(err error) bool`. It is true for
   `context.DeadlineExceeded`, for `net.Error` `Timeout()`, **or** for `errors.Is(err,
   broker.ErrOutcomeUncertain)`. Use it at `:684` and `:1521`. Behavior is unchanged for existing errors.
5. `reconcileTick`: at `:1991` and at `:2076`, before `systemicCount++`, add
   `if errors.Is(err, broker.ErrInvalidCredentials) { slog.Warn("reconcileTick: broker rejected credentials;
   skipping account this tick", "account_id", accountID, "call", "ListOrders"|"GetPositions"); continue }`.
   - Feature-206 own-fill, foreign-halt and lookup-error branches are untouched (PRESERVE `@AC-1..3
     @feature-206`).
   - Re-grep at spec time: no durable suite asserts a credential-rejected call is systemic (`grep -n -i
     "systemic\|credential" services/xstockstrat-trading/acceptance/*.feature`; no feature-102 suite exists).
6. Broker coverage: `ALPACA` unaffected. Its only sentinel source is `ValidateCredentials`, which reconcile never
   calls. `OFFLINE`: nil client, skipped before any of this.
   - Trading-mode gate: `environmentIsPaper` (`:2596`) and `rec.IsPaper` are unchanged.
   - Order types and fill handling: unaffected.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go build ./... && GOWORK=off golangci-lint run --modules-download-mode=mod
grep -n "trading.ibkr\." internal/service/trading.go   # three GetInt reads, full-dotted
grep -n "isUncertainBrokerOutcome" internal/service/trading.go   # definition + 2 call sites
grep -n "TRADING_MODE\|environmentIsPaper" internal/service/trading.go | head   # gate untouched
```

---

### Step 9 — test: service-level credential status, validation, classification, reconcile skip (AC-3..AC-10 service half)

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading_ibkr_auth_test.go` — create
- `services/xstockstrat-trading/internal/service/trading_bracket_test.go` — modify (extend `fakeAccountRepo`)

**Reviewers**: `xstockstrat-trading` owner — broker API safety, position limit enforcement unaffected

**Codebase Evidence**:
- No test of `validateAndRecordCredential` exists, and no fake captures `UpdateCredentialStatus`
  (recon.md:249-251).
- `fakeAccountRepo` (`trading_bracket_test.go:471-490`) already overrides `ListActiveBrokerAccounts`
  (`listActiveFn`), which `LoadBrokerPool` (`trading.go:244-283`) uses. Extend this one fake (C-13, second
  consumer), not a new one.
- `offlineAccountRepo` (`trading_offline_test.go:32-55`) serves `GetBrokerAccount`/`CreateBrokerAccount` for the
  register/update tests. `TestRegisterBrokerAccount_Offline` is at `:298`; `TestUpdateBrokerAccountCredentials_
  RejectsOffline` at `:352`.
- Reconcile harness: `newTestReconciliationService` (`trading_reconciliation_test.go:167`), `fakeReconciliationBroker`
  (`:78`, `listOrdersFn`/`getPositionsFn`), and `fakeConfigSetter` + `svc.configSetter` to observe escalation
  (`:746-781`).
- Live config in tests: `config.NewSnapshotWatcher` (`internal/config/config.go:249`, used in
  `trading_state_gate_test.go`).
- The gitleaks-allowlisted 64-hex test key literal (`.gitleaks.toml:37`) is usable as `encKey` for
  `EncryptCredentials` (`account_repo.go:212`).

**TDD**: `red-green required` — RED before Step 8 (no IBKR validation, no skip, legacy reads UNKNOWN or makes
HTTP), GREEN after.

**Covers**: `AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10`

**Instructions**:
1. Extend `fakeAccountRepo` with `statusWrites []int32` captured in `UpdateCredentialStatus`.
2. `TestValidateAndRecordCredential_IBKRHandshakeOK` (`@AC-3`): a real `broker.NewIBKRClient` (Step-1 key
   material, `BaseURL: srv.URL`, strict `IBKRAuthHandler`), passed to `svc.validateAndRecordCredential`.
   - The handler order is LST, init, `GET /portfolio/accounts`.
   - The status written is `CREDENTIAL_STATUS_OK`.
3. `TestValidateAndRecordCredential_IBKRHandshakeFailures` (`@AC-4`): the 9 Examples rows, mapped to INVALID or
   UNKNOWN exactly as the feature file states, and no `GET /portfolio/accounts` on any row.
4. `TestLoadBrokerPool_LegacyIBKRBlobKeepsEntryReadsInvalid` (`@AC-5`):
   - `listActiveFn` returns an IBKR record whose `CredentialsEnc` is the encrypted 4-field blob;
   - after `LoadBrokerPool`, `svc.brokers[id]` exists;
   - `validateAndRecordCredential` on that client writes INVALID;
   - an `http.DefaultTransport` guard (a `RoundTripper` that fails the test) proves no HTTP request.
5. `TestRegisterAndUpdate_IBKRIncompleteBlob_InvalidArgument` (`@AC-7`): rows omit `signature_key`,
   `encryption_key` and `dh_prime` → `codes.InvalidArgument` on both RPCs.
   - The error text contains no submitted value.
   - The OFFLINE row reuses `TestRegisterBrokerAccount_Offline` (`trading_offline_test.go:298`) unchanged, cited
     as PRESERVE.
6. `TestIsUncertainBrokerOutcome` (`@AC-8`, `@AC-6` row 5):
   - a real IBKR session-failure error (from a handler answering LST 503) → `false` (definite REJECTED);
   - an `ErrOutcomeUncertain`-wrapped error → `true`;
   - `context.DeadlineExceeded` → `true` (existing behavior).
7. `TestReconcileTick_InvalidCredentialsNotSystemic` (`@AC-9`), rows `ListOrders`/`GetPositions`:
   - an IBKR fake returns `fmt.Errorf("x: %w", broker.ErrInvalidCredentials)` and an Alpaca fake returns OK;
   - `reconcileTick(ctx, 0, 0.5)` returns `systemicCount == 0`;
   - `fakeConfigSetter.calls` is empty (no REDUCE_ONLY).
8. `TestValidateAndRecordCredential_NegativeCacheThenHeal` (`@AC-10`): `cfgW = config.NewSnapshotWatcher` with
   `trading.ibkr.reauth_min_interval_ms` set, which also proves the key is applied (EXTEND `@AC-3 @feature-192`).
   - The first call reads INVALID. A second call inside the interval makes zero LST requests.
   - After advancing the `Now` seam and flipping the handler, the status reads OK.
- New logic is in `internal/service`, a package that `ci.yml:256` excludes from coverage measurement. The
  repo-wide ≥ 40% gate still applies to the service and is re-run below. It must stay green after this step's
  `internal/testdata` consumers are added.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go test ./internal/service/ -run 'IBKR|Uncertain|InvalidCredentialsNotSystemic|LegacyIBKR' -race -count=1 -v
GOWORK=off go test ./... -race -count=1   # whole service green, incl. feature-157/202/206 suites
GOWORK=off golangci-lint run --modules-download-mode=mod
GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # ≥ 40% (ci.yml:256-257)
grep -rn "statusWrites" --include="*_test.go" internal/service | grep "struct\|\[\]int32" | wc -l   # one declaration (fakeAccountRepo)
```

---

### Step 10 — config: register `trading.ibkr.*` keys

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/CLAUDE.md` — modify
- `docs/patterns/config-governance.md` — modify

**Reviewers**: `xstockstrat-trading` owner — config surface; approval: owner + config team (`docs/runbooks/approval-flow.md`)

**Codebase Evidence**:
- Config Keys table: `services/xstockstrat-trading/CLAUDE.md:82-120`. The neighbor row is
  `trading.broker.timeout_ms` (`:107`).
- The log is "Per-Feature Registered Keys" (`docs/patterns/config-governance.md:105`), newest first; the feature
  240 entry is at `:109`.
- Precedent for a trading "no seed migration, read live with Go default" entry: feature 102 (`:610-622`).

**TDD**: `N/A (docs/config registration — no code)`

**Covers**: `—`

**Instructions**:
1. Add three rows after `trading.broker.timeout_ms` (`CLAUDE.md:107`), each type `int`, read live per
   handshake, `≤ 0` → default:
   - `trading.ibkr.lst_refresh_margin_ms` (`60000`): refresh the cached LST this long before
     `live_session_token_expiration`;
   - `trading.ibkr.handshake_timeout_ms` (`10000`): detached bound on one LST + `ssodh/init` handshake;
   - `trading.ibkr.reauth_min_interval_ms` (`30000`): negative-cache and 401-invalidation throttle (one LST
     request per interval per bad account).
2. Prepend `### feature 249 — fix-ibkr-request-signing (\`xstockstrat-trading\`)` under
   `config-governance.md:107`, with the same three rows. State: unseeded (consumed-with-default, feature 102
   precedent); no `SCALAR_BOUNDS_REGISTRY` entry; not tied to `IBKRRequestTimeout`.
   - Overlap: feature 240 (`offline-account-full-pnl`) prepends at the same top slot. Feature 243
     (`fix-sandbox-seed-keys`) edits the Author-sentinel table just above it (`:93-103`). Re-read
     `config-governance.md:93-109` at execute time and place the 249 entry newest first after whichever peers have
     merged. This is a rebase only, with no key-name collision.

**Verification**:
```bash
grep -n "trading.ibkr\." services/xstockstrat-trading/CLAUDE.md docs/patterns/config-governance.md services/xstockstrat-trading/internal/service/trading.go
# each of the 3 keys appears in all three files with the same default
```

---

### Step 11 — proto: comment-only IBKR `credentials_json` shape

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/trading/v1/trading.proto` — modify

**Reviewers**: Proto Reviewer — no breaking change, `buf lint`/`buf breaking`; `packages/proto` owner — naming; `xstockstrat-trading` owner

**Codebase Evidence**:
- `trading.proto:267-269`:
  `// IBKR:   {"consumer_key":"...","access_token":"...","access_token_secret":"...","ibkr_account_id":"..."}` at
  `:269`, then `string credentials_json = 4;` at `:270`.
- `UpdateBrokerAccountCredentialsRequest` says "same shape" (`:279-281`).

**TDD**: `N/A (proto comment)`

**Covers**: `—`

**Instructions**: Replace line `:269` with a comment listing the 7 keys: `consumer_key`, `access_token`,
`access_token_secret`, `ibkr_account_id`, `signature_key` (PEM RSA private key), `encryption_key` (PEM RSA private
key) and `dh_prime` (PEM DH parameters). Wrap at the file's existing width. No field number, type or name changes
(C-09).

**Verification**:
```bash
cd packages/proto && buf lint && buf breaking --against '<repo-root>/.git#branch=feature/fix-ibkr-request-signing,subdir=packages/proto'
# PLAT-10: subdir= is mandatory; replace <repo-root> with the absolute repo path (git rev-parse --show-toplevel)
```

---

### Step 12 — proto-gen: regenerate stubs

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/go/trading/v1/trading.pb.go` — modify (generated; comment only)
- `packages/proto/gen/ts/trading/v1/trading_pb.ts` — modify (generated; comment only)
- `packages/proto/gen/ts/trading/v1/trading.ts` — modify (generated; comment only)
- `packages/proto/gen/ts/dist/trading/v1/trading_pb.d.ts` — modify (generated; comment only)
- `packages/proto/gen/ts/dist/trading/v1/trading.d.ts` — modify (generated; comment only)

**Reviewers**: Proto Reviewer; `packages/proto` owner; `xstockstrat-trading` owner (inherited from Step 11)

**Codebase Evidence**:
- Root `CLAUDE.md` § Generating Proto Stubs: `./scripts/buf-gen.sh`. CI `proto-freshness` enforces it.
- Host toolchain: `docs/runbooks/codegen-toolchain-host-setup.md`. `buf` is not installed on this host
  (`which buf` → none).
- The files that carry the `trading.proto:269` comment are found by `grep -rl access_token_secret packages/proto/gen/`.
  That grep returns exactly the 5 **Files** above. No Python stub carries proto comments: `gen/python/trading/v1/`
  holds only `trading_pb2.py`/`trading_pb2_grpc.py`, and neither matches.

**TDD**: `N/A (codegen)`

**Covers**: `—`

**Instructions**: Run `./scripts/buf-gen.sh`. Stage only the 5 listed paths (F-08). If any other `gen/` file
changes, stop. That is toolchain-version drift (`insights.md:2444` precedent): fix the toolchain pins rather than
committing the churn. If the generator writes the comment into a file not listed here, add the file to **Files** and
record it in the Deviation Log.

**Verification**:
```bash
./scripts/buf-gen.sh && git diff --name-only packages/proto/gen/   # exactly the 5 listed paths
git diff --stat packages/proto/gen/ && git diff packages/proto/gen/ | grep '^[-+]' | grep -v '^[-+][-+]' | grep -v -i 'ibkr\|credentials_json\|signature_key\|encryption_key\|dh_prime\|consumer_key' | head
# expect no non-comment changed lines
```

---

### Step 13 — service: `/trader` IBKR credential form — key-material inputs

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/trader/accountShared.tsx` — modify

**Reviewers**: `xstockstrat-ui` owner — no secret values rendered in UI, trading UI correctness; Security — private keys entered in the browser

**Codebase Evidence**:
- `CredentialState` is at `accountShared.tsx:27-34`, `EMPTY_CREDENTIALS` at `:36-43`, `buildCredentialsJson` at
  `:46-57` (IBKR 4-field object `:49-55`, offline `''` `:48`), and `credentialSchema` at `:61-91` (offline
  `:64-73`, IBKR `:74-82`).
- `CredentialFields` is at `:94-161`: offline → `null` `:105-107`; the IBKR `Input`s are at `:109-140`.
- The edit form is `useWatch` `:187-197`, `handleCredsChange` `:201-208`, copy `:228-229`, creds map `:231-241`.
  The add form is `useWatch` `:433-443`, `handleCredsChange` `:450-457`, creds map `:516-526`.
- `FieldError` is imported (`:18`) and wired only for `displayName` (recon.md:86). `Textarea` exists at
  `src/components/ui/textarea.tsx` (used at `src/components/insights/RuleEditor.tsx:241`, recon.md:132-133).

**TDD**: `red-green required` (paired e2e in Step 14)

**Covers**: `—`

**Instructions**:
1. Add `signatureKey`, `encryptionKey` and `dhPrime` to `CredentialState`/`EMPTY_CREDENTIALS`.
   - Introduce `const CREDENTIAL_KEYS = Object.keys(EMPTY_CREDENTIALS) as (keyof CredentialState)[]` and derive
     both `useWatch` name lists, both `handleCredsChange` bodies and both creds maps from it. This removes the
     9-way duplication the new fields would otherwise multiply (DRY guard rail; recon.md:307-309).
2. `buildCredentialsJson` IBKR branch: add `signature_key`, `encryption_key` and `dh_prime`. Offline and Alpaca
   branches are unchanged.
3. `credentialSchema` IBKR branch: the three new fields use `.min(1, requiredMsg)`. Offline and Alpaca branches
   leave them unconstrained `z.string()`.
4. `CredentialFields` IBKR branch: three `Textarea` inputs (multiline PEM; a `type="password"` `Input` would drop
   newlines), each with:
   - a placeholder of `Signature key (PEM)`, `Encryption key (PEM)` or `DH prime (PEM)`;
   - `autoComplete="off"`, `spellCheck={false}`, `required`, `rows={4}`.
   - Add an optional `errors?: Partial<Record<keyof CredentialState, { message?: string }>>` prop that renders
     `<FieldError errors={[errors?.<field>]} />` under each credential input. Both forms pass
     `formState.errors`.
   - Stored values are never rendered back: both forms already start from `EMPTY_CREDENTIALS` and reset on
     unmount (`:199`, `:445-448`).
5. Edit-form copy (`:228-229`): for IBKR, add one sentence saying rotating requires all seven values, including
   the three key files from IBKR's OAuth self-service portal.
6. Tokens only, no color literals; reuse `Textarea`/`FieldError` (C-17). The offline branches (`:48`, `:64-73`,
   `:105-107`) are untouched.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit && pnpm run lint:dup
grep -n "#[0-9a-fA-F]\{3,6\}\|oklch(\|hsl(" src/components/trader/accountShared.tsx   # expect none
```

---

### Step 14 — test: `/trader` IBKR register/edit e2e (AC-7 UI half)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/trader/account-selector.spec.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/accounts.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify

**Reviewers**: `xstockstrat-ui` owner — no secret values rendered in UI

**Codebase Evidence**:
- Template: `account-selector.spec.ts:66-99` (Add Account via `page.route` on
  `**/xstockstrat.trading.v1.TradingService/RegisterBrokerAccount`) and `:134-164` (Edit keys → Save keys).
- Fixtures are imported from `../fixtures` (`:3`). Auth comes from `addAuthCookie` (`../helpers/auth`, `:2`).
- `BROKER_ACCOUNT_IBKR` is at `e2e/fixtures/accounts.ts:24-31`. Its catalog row is `e2e/fixtures/INVENTORY.md:15`.
- The offline-branch guard already exists: `offline-accounts.spec.ts:102` ("offline account row has no 'Edit keys'
  action").

**TDD**: `red-green required` — RED before Step 13 (no PEM placeholders; the blob has 4 keys), GREEN after.

**Covers**: `AC-7`

**Instructions**:
1. In `e2e/fixtures/accounts.ts`, add `IBKR_TEST_CREDENTIALS_INPUT`: obviously fake form inputs, with PEM-shaped
   strings that are not real keys (e.g. `-----BEGIN TEST-----\nnot-a-key\n-----END TEST-----`), so no gitleaks
   rule fires. Add its row to the `INVENTORY.md:15` Broker accounts entry.
2. `@AC-7 IBKR register posts all seven credential fields`:
   - select IBKR, fill all fields, and capture the intercepted `RegisterBrokerAccount` request body;
   - `JSON.parse(credentialsJson)` has exactly the 7 keys, and the PEM newlines are preserved;
   - the modal closes.
3. `@AC-7 IBKR register blocks submit when a key field is empty`: leave `Encryption key (PEM)` empty and submit.
   The `FieldError` text "This field is required" is visible and no `RegisterBrokerAccount` request was sent.
4. `IBKR Edit keys never renders stored values`: open Edit keys on `BROKER_ACCOUNT_IBKR`; all 7 inputs are empty,
   then save, and the request carries 7 keys.
5. Offline guard: assert the Add form's Offline option renders no credential inputs, and keep
   `offline-accounts.spec.ts:102` (PRESERVE). Scenario one-offs (spreads of `BROKER_ACCOUNT_IBKR`) stay inline per
   C-12.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e e2e/trader/account-selector.spec.ts e2e/trader/offline-accounts.spec.ts && pnpm run lint
grep -n "from '../fixtures'\|helpers/auth" e2e/trader/account-selector.spec.ts
grep -n "IBKR_TEST_CREDENTIALS_INPUT" e2e/fixtures/INVENTORY.md
```

---

### Step 15 — service: agent `manage_account` IBKR shape + runbook parity

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify
- `docs/runbooks/mcp-tools.md` — modify

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability, `mcp-tools.md` parity, no secret values in tool output

**Codebase Evidence**:
- `async def manage_account` is at `tools.py:2153` (signature `:2153-2161`). The IBKR shape in its docstring is
  at `:2175-2177`, and the update_credentials error sentence is at `:2179-2181`. Checks are non-empty only
  (`:2191-2214`).
- Passthrough: `client.py` `register_broker_account` `:2393`, `update_broker_account_credentials` `:2421`,
  `deregister_broker_account` `:2444` (recon.md:73), unchanged. `_grpc_error_message` is at `tools.py:223`.
- Runbook row: `docs/runbooks/mcp-tools.md:1392`.
- The tool count is unchanged, so the `fails.md:2068-2085` inventory traps do not trigger (recon.md:319-321).

**TDD**: `red-green required` (paired Step 16)

**Covers**: `—`

**Instructions**:
1. Docstring `:2175-2177`: the IBKR shape lists the 7 keys (the 3 new ones are PEM strings).
2. `:2179-2181`: add "and an IBKR blob missing any required field (INVALID_ARGUMENT)".
3. `mcp-tools.md:1392`: the same 7-key IBKR shape. Edit only that row; do not touch the `@AC-32 @feature-224` /
   `@AC-5 @feature-149` sections (recon.md:201).
4. Tool name, parameters, validation and return shape are unchanged. Trading stays the only validator (C-10).

**Verification**:
```bash
cd services/xstockstrat-agent && ruff check . && ruff format --check .
grep -n "signature_key" app/tools.py ../../docs/runbooks/mcp-tools.md   # both present
```

---

### Step 16 — test: agent IBKR rotation no-echo + InvalidArgument surfacing (AC-7 agent half)

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_broker_account_client.py` — modify
- `services/xstockstrat-agent/tests/test_account_tools.py` — modify

**Reviewers**: `xstockstrat-agent` owner — no secret values in tool output

**Codebase Evidence**:
- `_assert_no_credentials` (`test_broker_account_client.py:36-40`) checks only Alpaca names and
  `credentials_json`.
- `test_update_broker_account_credentials_forwards_and_hides` (`:117-141`) is Alpaca-only.
  `test_register_broker_account_binds_ibkr` (`:78-98`) sends `{"consumer_key":"ck"}`.
- Error-surfacing template: `test_deregister_permission_denied_maps_to_runtimeerror`
  (`test_account_tools.py:142-154`, `grpc.aio.AioRpcError` → `RuntimeError`).

**TDD**: `red-green required` — RED: the docstring assertion fails before Step 15. The no-echo and error tests
characterize existing passthrough and must not pass vacuously; each asserts a value that only the 7-key blob
carries.

**Covers**: `AC-7`

**Instructions**:
1. Extend `_assert_no_credentials` with `consumer_key`, `access_token`, `signature_key`, `encryption_key`,
   `dh_prime` and `BEGIN`.
2. Add `test_update_broker_account_credentials_ibkr_seven_fields_forwarded_and_hidden` (EXTEND `@AC-4
   @feature-164`): the `UpdateBrokerAccountCredentials` request carries the 7-key blob verbatim, and the output
   passes `_assert_no_credentials`. The blob is a one-off inline literal (single consumer, C-13 compliant).
3. Add `test_update_credentials_ibkr_incomplete_maps_invalid_argument` (`@AC-7`): `AioRpcError(INVALID_ARGUMENT,
   details="IBKR credentials_json missing required field(s): dh_prime")` → `RuntimeError` matching `dh_prime`.
4. Add `test_manage_account_docstring_lists_ibkr_key_material`: the tool's description contains `signature_key`,
   `encryption_key` and `dh_prime`.

**Verification**:
```bash
cd services/xstockstrat-agent && uv run --no-sync pytest --cov=app --cov-fail-under=40 && ruff check . && ruff format --check .
grep -n "def .*fixture\|from .conftest\|conftest" tests/test_broker_account_client.py tests/test_account_tools.py
```

---

### Step 17 — docs: IBKR auth docs, TRADING-3 widening, findings closure, teardown

**Status**: `pending`
**Service**: `docs`
**Files**:
- `services/xstockstrat-trading/docs/ibkr.md` — modify
- `services/xstockstrat-trading/CLAUDE.md` — modify
- `services/xstockstrat-trading/docs/context-constitution.md` — modify
- `services/xstockstrat-trading/docs/context-constitution-findings.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `docs/ibkr.md` is 22 lines with two `###` sections: Hedged Mode (`:5-16`) and order-confirmation prompts
  (`:18-22`). No auth section exists.
- The credential-health paragraph is at `services/xstockstrat-trading/CLAUDE.md:23` ("IBKR `GET /portfolio/accounts`").
- TRADING-3 is at `context-constitution.md:21`. It says "only for HTTP 401/403" and has the stale anchor
  `credentialStatusFromError (~L2873)`; the actual line is `trading.go:2951`.
- Findings: the open question is at `context-constitution-findings.md:44`; the `~L3027` hint at `:28` should be
  `:3084` (recon.md:322-324).

**TDD**: `N/A (docs)`

**Covers**: `—`

**Instructions**:
1. `docs/ibkr.md`: append a new `### IBKR: OAuth 1.0a + Live Session Token` section after the
   order-confirmation section (after `:22`). Leave both existing sections unchanged. The new section covers:
   - the 7-field blob;
   - the handshake order (LST → `ssodh/init` with `compete=false`);
   - LST-keyed HMAC-SHA256 plus `realm`, and the ibind-pinned encoding;
   - the 401/no-bridge retry rule and bracket-leg no-resend;
   - the three `trading.ibkr.*` keys;
   - the unverified-contract caveat with the ibind SHA, and the FR-3 vs ibind query-param conflict and its
     resolution once the operator rules;
   - the follow-ups `ibkr-session-keepalive` and `ibkr-fleet-invalid-alert`.
2. `CLAUDE.md:23`: IBKR validation now runs the LST handshake + `ssodh/init` before `GET /portfolio/accounts`;
   a legacy 4-field account reads INVALID until updated.
3. TRADING-3 row: widen it to "HTTP 401/403, or deterministically unusable credentials (missing/unparseable key
   material, decrypt failure, LST-signature mismatch, init not authenticated); may come from any IBKR call".
   Re-stamp the anchors to the post-Step-8 lines.
4. Findings: resolve `:44` (resolved by feature 249, citing the Step 2/6 lines) and fix the `:28` hint.
5. Teardown (root `CLAUDE.md` § Teardown): run `/context-forge:context-constitution refresh`, scoped to the files
   touched by Steps 10, 15 and 17. If the plugin is unavailable, re-read each touched context file against the
   code by hand and record both facts in the PR body.

**Verification**:
```bash
grep -n "limited_poa\|live_session_token\|ssodh" services/xstockstrat-trading/docs/ibkr.md
grep -n "TRADING-3" services/xstockstrat-trading/docs/context-constitution.md | grep -c "2951\|deterministic"
grep -n "feature 249" services/xstockstrat-trading/docs/context-constitution-findings.md
```

---

## Open Risks (carried from design.md, updated at spec time)

- [ ] **FR-3 vs ibind (new, spec-time).** ibind signs regular requests without query params
  (`ibkr_client.py:146-158`, `rest_client.py:226-231`). FR-3 includes them. The AC-1 vectors prove only RFC-style
  self-consistency, not IBKR acceptance. The operator rules at the Step 2 checkpoint, or explicitly defers the
  ruling to the integration-PR merge. The paper smoke decides it as described in the Execution Summary.
- [ ] **Unverified external contract.** The `ssodh/init` reply fields (ibind never reads them) and whether IBKR
  validates the base string exactly as ibind builds it. All tests can pass while every real account reads INVALID
  (`fails.md:481-484`). Mitigations: ibind-pinned vectors (Step 1), and a paper smoke if an account appears.
- [ ] **PKCS#1 v1.5 deprecation in Go's `crypto/rsa`.** Possible SA1019 from staticcheck. Handled by a scoped
  `//nolint` that states the protocol constraint (Step 4).
- [ ] **`compete=false` self-competition** during a deploy overlap or LST refresh. May read INVALID for up to one
  health interval; heals (Step 5 `competing:true` row, AC-10).
- [ ] **Lapsed session answered by something other than 401 or 400 no-bridge.** That call still counts as
  systemic (the documented exception, design.md §4).
- [ ] **A 403 on an `/iserver` order call also skips the systemic count for that tick.** Accepted.
- [ ] **Private keys in UI textareas.** Security review (Step 13).

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

### Step 1 — 2026-10-29 (sdd-execute sequential)

- **`.gitleaks.toml` path allowlist for `vectors.json` (scope expansion, operator Option A).** The spec scoped
  the gitleaks change to two line regexes for the PEM bodies. The generated `vectors.json` also trips the default
  rules (fake OAuth tokens, signatures, the encrypted test secret), so the existing `[allowlist]` gains exactly
  `paths = ['''services/xstockstrat-trading/internal/testdata/ibkr/vectors\.json''']` (OR with the regexes;
  `regexTarget` unchanged), and the feature-249 comment block names `vectors.json` as generated test data with no
  real secrets. Operator decision 2026-10-29 (session question tool: "Yes, run both"), confirming the earlier
  Option A. The `[[allowlists]]` AND fallback was not needed: the line regexes suppress the multi-line
  `private-key` finding (local `gitleaks dir` → "no leaks found").
- **Generator: wrong-key decrypt guard for pycryptodome 4.2.0.** `PKCS1_v1_5.decrypt(ct, None)` in pycryptodome
  4.2.0 returns empty bytes (not the `None` sentinel) for a wrong-key ciphertext, so ibind's
  `calculate_live_session_token_prepend` returns `""` instead of raising. `gen_vectors.py` accepts either `""` or
  the older `AttributeError` and fails on anything else. **Carried requirement for Step 4:** the Go decrypt must
  fail closed on an empty plaintext (an empty prepend is a credential error, never a valid secret).
- **`ibkr.go` uses one `//go:embed` per variable** instead of the single `//go:embed ibkr/*.pem ibkr/vectors.json`
  line: each PEM binds to its own exported string, which needs a per-file directive. Same embedded file set.
- **PEMs force-added past the root `.gitignore` `*.pem` rule** (`.gitignore:55`, "never commit private keys").
  The three fixture PEMs are tracked with `git add -f`, so the rule stays in force for every other path and
  `.gitignore` is not edited. The committed keys are the operator-approved test keys (2026-10-29).
- ibind SHA unchanged (`759ec3a1`). Regenerated locally with pycryptodome 4.2.0 from the pinned ibind source:
  output byte-identical to the committed `vectors.json`.

### Steps 2 + 3 — 2026-10-29 (sdd-execute sequential)

- **Steps 2 and 3 land in one commit (breaks one-commit-per-step, operator decision).** Operator, session question
  tool, 2026-10-29: "A: Steps 2+3 together (Recommended)". The signer (`ibkr.go`) and its known-answer test
  (`ibkr_sign_internal_test.go`) are committed together and both steps are marked done. The test file was not on
  disk at execution time, so it was authored in this session from the Step 3 instructions. RED was a compile failure
  against the pre-Step-2 tree (no `Now`/`Nonce` seams, `buildBaseString`, `authorize`, `authorizeLST`). GREEN: all
  four `TestIBKRAuthorize*` tests pass against the ibind vectors.
- **FR-3 ruling: query params stay in the signature base string.** Operator, 2026-10-29: "Include params (FR-3)".
  This is the final ruling and does not hold the merge. It deviates from ibind, which excludes them. The inclusion
  stays isolated in `buildBaseString`.
- **Shared `oauthParams(signatureMethod)` helper (not named in the spec).** `authorize` and `authorizeLST` both build
  the five oauth params through one unexported method, and the Step 3 test reuses it. This avoids restating the
  param set three times (DRY guard rail).
- **`buildBaseString` keeps every value of a repeated query key** as its own `k=v` pair, sorted by key and then by
  value. The spec says "every decoded `u.Query()` value" and does not pin an order for repeated keys. No current
  call site repeats a key.
- **Verification fallback: golangci-lint rebuilt.** The provisioned `~/go/bin/golangci-lint` v2.14.0 was built with
  go1.26 and refuses to load a `go 1.27.0` module. The same pinned v2.14.0 was rebuilt with go1.27.0 into a scratch
  `GOBIN`, then run: 0 issues. The pinned version is unchanged.

### Steps 4 + 5 — 2026-10-29 (sdd-execute sequential)

- **Steps 4 and 5 land in one commit (standing operator rule).** Operator decision for the Step 4 blocker, in their
  own words (session question tool, 2026-10-29): "Merge pairs + standing rule". The rule reads: "if this step's
  Verification fails ONLY because the consumers or tests of its new code live in the immediately following step
  … Execute this step and the next one together as ONE commit with one red→green cycle on the next step's tests,
  mark BOTH steps done". Step 4's new unexported symbols have no consumer before Step 5's in-package tests, so
  `unused` would fail Step 4's lint alone. Step 5's tests and `testdata.IBKRAuthHandler` were written first. RED
  was a compile failure (`IBKRTiming`, `SignatureKey`/`EncryptionKey`/`DHPrime`/`Timing`, `ensureSession`
  undefined). GREEN: all ten session tests pass, `-race`, stable over `-count=20`.
- **`invalidate`/`reinit` get their own tests in Step 5's file.** Their only production consumer is Step 6's
  `c.do`, so `TestInvalidate_GenerationGuardAndThrottle` and `TestReinit_RerunsInitOnly` were added to
  `ibkr_session_internal_test.go`. They keep `unused` green and cover Step 4 instruction 6. They test only Step 4
  behavior and add no new surface.
- **`testdata` gains small helpers next to `IBKRAuthHandler`:** `IBKRLSTPath`/`IBKRInitPath`,
  `IBKRLSTReplyJSON(sig)`, `IBKRInitReplyJSON(auth, competing)` and `IBKRHeaderParam`. The AC-4 rows script
  replies through them, so no test redeclares the reply shape (C-13). Overrides are set through `SetOverride`, and
  `Requests`/`Count` read the log under the handler's lock (race-safe for the coalescing test).
- **Strict replay uses the vector base URL.** The strict handler compares signatures computed over
  `https://api.ibkr.com/v1/api/...`, so the in-package tests keep `BaseURL` at the vector value and swap
  `c.httpClient` for a transport that rewrites only scheme+host to the `httptest` server. The handler matches the
  auth routes by path suffix, so the `/v1/api` prefix is tolerated. Step 7 (`package broker_test`) cannot replace
  `httpClient` and will need its own way to reach a strict handler; carried as an open item.
- **`competing:true` row uses `{"authenticated":false,"competing":true}`.** Instruction 5.6 classifies only
  "2xx lacking `authenticated:true`" as INVALID (with `competing` logged), and the AC-4 row is realized by that
  reply. An `authenticated:true, competing:true` reply is still treated as established; not changed here.
- **Empty decrypt plaintext fails closed** (carried from Step 1): `mintLST` returns `ErrInvalidCredentials` for a
  decrypt error or an empty plaintext.
- **`ibkrSessionState` is embedded in `IBKRClient`.** The session fields (`sessMu`, `sess`, `negUntil`/`negErr`,
  the invalidation timestamp, the flight sequence and `flight`) live in `ibkr_session.go`. The joiner re-call rule
  compares a per-flight sequence number with the one observed at call entry instead of a wall-clock timestamp, so
  it is independent of the `Now` seam.
- **DH params must be a `DH PARAMETERS` PEM block** with no trailing ASN.1 bytes; any other block is a `dh_prime`
  credential error (covered by the `dh_prime_wrong_pem` case).
- `go mod tidy` also touched the root `go.work.sum`. That change was reverted as out of scope; `go.sum` was
  unchanged.
- Verification fallback (as in Steps 2+3): golangci-lint v2.14.0 rebuilt with go1.27; 0 issues.

### Steps 6 + 7 — 2026-10-29 (sdd-execute sequential)

- **Steps 6 and 7 land in one commit (standing operator rule).** Operator, session question tool, 2026-10-29, in
  their own words: "Merge pairs + standing rule". The rule reads: "if this step's Verification fails ONLY because
  the consumers or tests of its new code live in the immediately following step … Execute this step and the next one
  together as ONE commit with one red→green cycle on the next step's tests, mark BOTH steps done". Step 6's paired RED
  test is Step 7's (Step Dependencies: "Step 7 [test] covers Step 6"). Step 6 also breaks every existing IBKR test,
  because their fakes serve no LST handshake, and Step 7 is the step that migrates them. Step 7's tests were written
  first. RED came in two parts. First, a compile failure (`broker.ErrOutcomeUncertain` undefined). Second, with a
  temporary, uncommitted shim declaring only that sentinel, a behavioral failure: AC-1 `GetOrder: status 401` from the
  strict handler, an AC-8 `order POSTs = 1, want none`, the retry-matrix rows, and `TestReplaceOrder_IBKR` "expected
  the realm-prefixed LST header". GREEN: the whole broker package passes with `-race` and is stable over `-count=10`.
- **Strict wire tests reach the handler by swapping `http.DefaultTransport` in `package broker_test`.** This closes
  the open item from Steps 4+5. `IBKRClient.httpClient` has a nil `Transport`, so it uses `http.DefaultTransport`. The
  `strictIBKRClient` helper (`ibkr_do_test.go`) points that at a host-rewriting transport for the test's duration and
  restores it in `t.Cleanup`. The client keeps signing over the vector base URL. No production seam was added, and no
  broker test runs in parallel.
- **Helpers not named in the spec.** `do` lives in `ibkr_session.go` alongside `currentSession` (reads the session
  under `sessMu`), `sendSigned` (signs, sends, reads and closes the body; the body read stays unbounded as before) and
  `ibkrFinalAuthErr` (the instruction 2.4 error). The single `session: %v` flatten point is a closure inside `do`.
  `ibkr_do_test.go` adds `ibkrTestConfig`, a vector-keyed config with a fixed clock that keeps the vector LST
  unexpired. All migrated tests build their clients through it.
- **Literal readings (no spec text changed):**
  - The uncertain-resend rule (instruction 2.5) applies only to a resend after a **401**. A resend after a 400
    no-bridge re-init that fails returns an ordinary error, because the 400 already proved the first send was not
    processed.
  - `noResend` blocks only the 401 resend (instruction 2.3). A bracket-leg POST answered 400 no-bridge is still
    re-inited and resent once.
  - A "`cOID` duplicate rejection" is detected as a non-2xx resend reply. A 2xx reply that carries a duplicate error
    is not detected, because its format is not pinned (the AC-6 row uses a 400 body). Carried as an open item.
  - Every final 401/403 now surfaces from `do` as the wrapped sentinel, so the callers' status switches no longer see
    401/403. Callers keep their `…: http: %w` wrap unchanged (instruction 4), so a session failure reads
    `ibkr X: http: ibkr X: session: …`. This is cosmetic only.
- **Partial-fill coverage is a new test**, `TestGetOrder_IBKRPartialFill` (`filledQuantity` 4 of 10, status
  `Submitted`). It sits next to `TestGetOrder_IBKRAvgPrice` instead of being a case inside it, so the existing test
  stays unchanged.
- Verification fallback (as in Steps 2+3 and 4+5): golangci-lint v2.14.0 was rebuilt with go1.27 and ran with
  `GOWORK=off`. It reports 0 issues.

### Steps 8 + 9 — 2026-10-29 (sdd-execute sequential)

- **Steps 8 and 9 land in one commit (standing operator rule).** Operator, session question tool, 2026-10-29, in
  their own words: "Merge pairs + standing rule". The rule reads: "if this step's Verification fails ONLY because
  the consumers or tests of its new code live in the immediately following step … Execute this step and the next one
  together as ONE commit with one red→green cycle on the next step's tests, mark BOTH steps done". Step 8's RED test
  is Step 9's (Step Dependencies: "Step 9 [test] covers Step 8"). Step 9's tests were written first. RED came in two
  parts. First, a compile failure (`svc.ibkrTiming` and `isUncertainBrokerOutcome` undefined). Second, a behavioral
  failure under a temporary, uncommitted shim that declared only those two symbols with pre-Step-8 behavior (a fixed
  default `IBKRTiming` and the old timeout-only predicate):
  - AC-7: `code = OK, want InvalidArgument`, and the update row panics on the unfaked `UpdateCredentials`.
  - AC-8 / AC-6 row 5: an `ErrOutcomeUncertain`-wrapped error reads `false`.
  - AC-9: `reconcileTick = (systemic 1, total 2), want (0, 2)` on both rows.
  - AC-10: `LST requests inside reauth_min_interval = 2, want 1`, because the 120s key was not applied.
  - The AC-4 `lst_timeout` row took 5s, the hardcoded validate deadline, not the configured 50ms.
  GREEN: all Step 9 tests pass with `-race`; the AC-10 test is stable over `-count=5`.
- **The AC-3 strict test signs over the vector base URL, not `BaseURL: srv.URL`.** Step 9 instruction 2 names both a
  strict `IBKRAuthHandler` and `BaseURL: srv.URL`, but the strict handler only accepts signatures computed over the
  vector URL. The service test uses the same approach as Step 7 (Steps 6 + 7 log entry): the client keeps the vector
  base URL and nonce, and `http.DefaultTransport` is swapped for a host-rewriting transport for the test's duration.
  No `internal/service` test runs in parallel. The same swap serves as the AC-5 no-HTTP guard.
- **AC-5 is green before Step 8.** Step 4 already fails a legacy 4-field blob locally, with no HTTP call. So the
  Step 9 AC-5 test is a characterization at the service level, and its RED was the compile failure only.
- **The AC-4 `lst_timeout` and AC-10 rows read `trading.ibkr.*` through `config.NewSnapshotWatcher`.**
  `handshake_timeout_ms=50` bounds the timeout row, and `reauth_min_interval_ms=120000` (above the 30s default)
  proves the reauth key is applied. Both rows exercise `ibkrTiming`, which is passed as `IBKRConfig.Timing`.
- **`validateIBKRCreds` on a JSON value that is not an object** (for example `[]`) returns `InvalidArgument` with
  "IBKR credentials_json must be a JSON object of string fields". The spec pins only the missing-field message.
  Missing fields are listed in the `ibkrCreds` declaration order.
- **Verification notes.**
  - Step 9's `-run 'IBKR|Uncertain|InvalidCredentialsNotSystemic|LegacyIBKR'` regex does not match
    `TestValidateAndRecordCredential_NegativeCacheThenHeal`, so that test was also run by name. It passed.
  - golangci-lint v2.14.0 was rebuilt with go1.27, as in the earlier steps, and ran with `GOWORK=off`. It reports
    0 issues.
- **The husky pre-commit hook did not run.** `core.hooksPath` is `.husky/_`, which does not exist, and the main
  worktree has no `node_modules` to symlink. The hook's lint-staged glob covers only `services/xstockstrat-ui`, and
  its duplication scan outside the UI is report-only, so neither check gates this Go-only change.

### Step 11 — 2026-10-29 (sdd-execute sequential)

- **The `buf breaking` baseline is a `git archive` tarball, not `<repo-root>/.git#branch=…`.** This session runs in
  an isolated git worktree whose sandbox refuses a `.git` input outside the worktree, and the worktree has no local
  `feature/fix-ibkr-request-signing` branch. The baseline was
  `git archive -o <scratch>/base.tar origin/feature/fix-ibkr-request-signing packages/proto`, then
  `buf breaking --against '<scratch>/base.tar#subdir=packages/proto'`. This compares against the same tree, with the
  same PLAT-10 `subdir=`. Exit code 0; `buf lint` (1.72.0) is clean.
- The IBKR comment wraps over three `//` lines and keeps the existing alignment. The field number, type and name of
  `credentials_json = 4` are unchanged (C-09).

### Step 12 — 2026-10-29 (sdd-execute sequential)

- **The Go proto plugins were rebuilt with Go 1.27 on the host before regenerating.** **Disposition**: CI-equivalent
  fallback. The preinstalled `~/go/bin/protoc-gen-go` v1.36.11 was built with go1.24.7. Its `go/format` reflowed an
  indented doc comment in `gen/go/analysis/v1/analysis.pb.go`, which is unrelated churn. Following the step's
  "fix the toolchain, don't commit churn" instruction, `protoc-gen-go@v1.36.11`, `protoc-gen-go-grpc@v1.6.2` and
  `protoc-gen-connect-go@v1.19.2` were rebuilt with go1.27.0 into a scratch `GOBIN`, matching the CI
  `proto-freshness` job. `pnpm install --frozen-lockfile` supplied the lockfile-pinned `tsc`; the global one fails
  with TS5107. `grpcio-tools` is 1.80.0, as in CI. No repo pin changed.
- After regeneration `git diff --name-only packages/proto/gen/` lists exactly the 5 **Files**, and every changed line is
  the IBKR comment. The Python stubs and the serialized descriptors are unchanged.
- **Spec evidence corrections.** `buf` 1.72.0 *is* installed on this host (`~/go/bin/buf`), so the "`which buf` → none"
  note is stale. Both `gen/ts/dist/trading/v1/*.d.ts` files did carry the comment and were regenerated, as the
  **Files** list says.
