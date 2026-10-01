# Implementation Spec: inter-service-mtls

**Status**: `code-completed`
**Created**: 2026-10-01
**Feature**: `docs/roadmap/features/210-inter-service-mtls/feature.md`
**Total Steps**: 14
**Feature Branch**: `feature/inter-service-mtls`

---

## Execution Summary

This implements **Model B** from `design.md`: flag-day per-service mutual TLS, no permissive/toggle
mode, static per-service leaf certs from one self-signed platform CA, delivered as boot-time env PEM
strings (`MTLS_CERT` / `MTLS_KEY` / `MTLS_CA_CERT`). Order is **foundation → per-language wiring →
client wiring → deployment → runbook**: Step 1 builds the cert material + dev-cert generator and
resolves the connect-node client-cert spike (Open Risk); Steps 3–8 swap every backend server bind and
client dial from `insecure` to mutual TLS, per language (Go, Python, Node), each with a paired
in-process handshake test (no CI mesh exists — `fails.md:369` — so verification is in-process/structural
with real certs from the dev generator); Steps 9–12 convert the two pure gRPC clients (UI BFF, agent);
Step 13 wires the cert env into all deployment files; Step 14 writes the leaf→root rolling-cutover deploy
runbook (with the mandatory flat-book + HALTED precondition for the trading↔ledger wave) and reconciles
the touched context docs (Teardown).

**Consumer surface (C-14):** product-spec marks this **None — internal/platform transport-security
change**. UI and agent are touched only as gRPC *clients* (client-cert presentation), not as new
user-visible surfaces — so there is no `/trader` / `/insights` / `/config-ui` page step and no new
agent MCP tool step. This was a recorded decision, not an omission.

### Scenario Coverage (C-15)

| Scenario | Covered by step(s) |
|---|---|
| `@AC-1` (plaintext caller refused, trio not honored) | 4 (Go), 6 (Python), 8 (Node) |
| `@AC-2` (mutual-auth peer accepted, trio honored) | 4, 6, 8 |
| `@AC-3` (per-RPC identity ACL) | **@descoped** — no covering step (operator sign-off, `context.md` 2026-10-01; exempt from C-15 coverage per the `@descoped` note in `acceptance.feature`) |
| `@AC-4` (enforced identically every env; verification cannot be disabled; fail-closed boot; prod loads prod CA) | 4, 6, 8 (fail-closed boot + no-skip-verify per language), 10 (UI), 13 (deployment structural "no plaintext path anywhere" grep) |
| `@AC-5` (header propagation unchanged beneath mTLS) | 4, 6, 8 (trio-still-flows regression assert) |
| `@AC-6` (long-lived stream survives cert rotation) | 8 (Node rotation test — WatchConfig / StreamEvents second connection off a rotated leaf, same CA) |

## Step Dependencies

- **Step 2 [test] covers Step 1 [service]** (cert-gen chain validity).
- **Steps 3–12 all require Step 1**: every handshake test and every TLS helper loads PEM material
  produced by `scripts/gen-dev-certs.sh`.
- **Step 4 [test] covers Step 3; Step 6 covers Step 5; Step 8 covers Step 7; Step 10 covers Step 9;
  Step 12 covers Step 11** (red-before-green pairs, P-06 / C-08).
- **Step 13 (deployment env) requires Steps 3–11**: the env names it wires must match the names the
  code reads; it is the integration point, so it lands after the code that consumes the env.
- **Step 14 (deploy runbook + Teardown) is last**: the leaf→root cutover ordering and the trading↔ledger
  flat-book precondition describe deploying the artifacts produced by all prior steps.
- **connect-node spike (Open Risk, `design.md` §Open Risks) is resolved inside Step 1** before the UI
  step (9) commits to `createGrpcTransport` nodeOptions vs. the `@grpc/grpc-js` stub fallback.
- **Feature 084 coordination** (`fails.md:364`): Steps 13–14 edit `docker-compose.yml` / `.do/app*.yaml`;
  re-verify 084's dev orchestration at execute time and rebase the deploy wiring if 084 landed first.
  Caddy (084's *external* edge) is orthogonal to this *inter-service* transport change.

---

### Step 1 — service: Platform CA + dev-cert generator + connect-node client-cert spike

**Status**: `done`
**Service**: `scripts/` (platform infra) + `docs/`
**Files**:
- `scripts/gen-dev-certs.sh` — create
- `scripts/localenv-setup.sh` — modify (invoke the generator so local certs exist before `up`)
- `docs/patterns/inter-service-mtls.md` — create (the mTLS env convention + cert-material contract)

**Reviewers**: Platform lead — cert issuance/rotation mechanism and deployment topology; Security — CA/key material handling and rotation are sound, mutual auth is enforced (native chain+SAN)

**Codebase Evidence**:
- Confirmed via `ls scripts/gen-dev-certs.sh` → **No such file** — must be created from scratch.
- `openssl` already invoked in `scripts/setup-env.sh:113-114` (`openssl rand -hex 16`) — the host toolchain has it; reuse for the self-signed CA + per-service leaf `openssl req`/`x509` steps.
- Env-string cert precedent: `DATABASE_CA_CERT` at `.do/app.dev.yaml:327-329` (`value: ${xstockstrat.CA_CERT}`), parsed as a PEM *string* in code — `MTLS_*` follows the same string-env delivery (DO App Platform has no file-mount; `recon.md:55`).
- `MTLS_CERT` / `MTLS_KEY` / `MTLS_CA_CERT` confirmed **absent** from `docker-compose.yml` / `.do/app.yaml` / `.do/app.dev.yaml` (grep returned no hits).

**TDD**: `red-green required`

**Covers**: `—`

**Instructions**:
1. Write `scripts/gen-dev-certs.sh` (`#!/usr/bin/env bash`, bash 3.2-compatible, macOS/BSD `openssl` compatible per root CLAUDE.md): generate one self-signed **dev platform CA** (`openssl req -x509 -newkey ...`), then one **leaf per service** for all 12 identities — the 10 backends (`xstockstrat-trading`, `-portfolio`, `-marketdata`, `-indicators`, `-ingest`, `-analysis`, `-ledger`, `-identity`, `-notify`, `-config`) plus the two pure clients (`xstockstrat-ui`, `xstockstrat-agent`). Each leaf MUST carry **`extendedKeyUsage = serverAuth, clientAuth`** (single leaf used in both directions) and a single DNS **SAN = the registry service name** (`xstockstrat-<svc>`) — never the DO `PRIVATE_DOMAIN` FQDN (self-signed, env-specific, unstable; `design.md` Rejected Alternatives). Emit, per service, three files under a git-ignored `./certs/<svc>/` dir: `cert.pem`, `key.pem`, `ca.pem`.
2. Write a tiny PEM-as-string loader convention into `docs/patterns/inter-service-mtls.md`: the three env vars (`MTLS_CERT`, `MTLS_KEY`, `MTLS_CA_CERT`) are **boot-time env PEM strings, never over WatchConfig** (config serves WatchConfig and cannot secure its own inbound channel with material delivered over it — `recon.md:93`, F-07 honored because the values are external config, just not via the config stream). Document: absent material ⇒ the process fails to start (fail-closed); verification identity is **pinned to the target service name** uniformly on every client (env-independent — DO dials `PRIVATE_DOMAIN` ≠ SAN; `.do/app.yaml:56-67`); these three vars are distinct from the `<SERVICE>_ENDPOINT` connection vars (no new endpoint suffix).
3. Add the generator invocation to `scripts/localenv-setup.sh` so a fresh checkout has local certs before `docker compose up`. Add `certs/` to `.gitignore` (dev material is never committed).
4. **Resolve the connect-node Open Risk (`design.md` §Open Risks):** spike whether `@connectrpc/connect-node` `createGrpcTransport` passes a client cert + CA through `nodeOptions` (TLS `SecureContext`). Record the result in `docs/patterns/inter-service-mtls.md`. If pass-through is unconfirmed, document the known-good fallback = a native `@grpc/grpc-js` stub behind the single `makeTransport` choke point (`connectClients.ts:26-28`) — this is the decision Step 9 consumes.

**Verification**:
```
bash scripts/gen-dev-certs.sh && \
openssl verify -CAfile certs/xstockstrat-trading/ca.pem certs/xstockstrat-trading/cert.pem && \
openssl x509 -in certs/xstockstrat-trading/cert.pem -noout -ext subjectAltName,extendedKeyUsage | \
  grep -E "DNS:xstockstrat-trading" && \
openssl x509 -in certs/xstockstrat-trading/cert.pem -noout -ext extendedKeyUsage | grep -E "TLS Web Server Authentication" && \
openssl x509 -in certs/xstockstrat-trading/cert.pem -noout -ext extendedKeyUsage | grep -E "TLS Web Client Authentication"
```
Confirm all 12 service dirs are produced and each leaf verifies against the CA, carries SAN = its service name, and has both EKUs.

---

### Step 2 — test: Cert-gen chain + SAN + EKU structural assertions

**Status**: `done`
**Service**: `scripts/`
**Files**:
- `scripts/gen-dev-certs.test.sh` — create (or a `bats`/plain-bash assertion harness), OR fold into Step 1's verification if no test runner for shell exists in-repo

**Reviewers**: Platform lead — cert issuance mechanism; Security — CA/key material soundness

**Codebase Evidence**:
- No shell test harness exists in `scripts/` (confirmed via `ls scripts/` — only `*.sh` operational scripts). Per `spec-template.md` migration-style offline guidance, this is a **structural** check, not a DB/mesh bring-up.

**TDD**: `red-green required` — before Step 1 the generator does not exist (RED: `openssl verify` on a missing file fails); after, the chain verifies (GREEN).

**Covers**: `—`

**Instructions**:
Assert, for a representative subset (one backend, one client identity): (a) the leaf chains to the CA; (b) SAN equals the service name exactly (not a FQDN); (c) both `serverAuth` and `clientAuth` EKUs are present; (d) a leaf from a *different* CA does NOT verify against `ca.pem` (proves the CA pin is load-bearing — the wrong-CA half of the negative matrix). This is the foundation for the per-language negative tests in Steps 4/6/8.

**Verification**:
```
bash scripts/gen-dev-certs.test.sh   # exits non-zero on any failed assertion
```

---

### Step 3 — service: Go backends — mutual TLS on server binds + all client dials

**Status**: `done`
**Service**: `xstockstrat-trading`, `xstockstrat-portfolio`, `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-trading/cmd/server/main.go` — modify (add `grpc.Creds` to `grpc.NewServer`)
- `services/xstockstrat-trading/internal/config/config.go` — modify (config-watcher dial)
- `services/xstockstrat-trading/internal/service/trading.go` — modify (4 service dials)
- `services/xstockstrat-portfolio/cmd/server/main.go` — modify
- `services/xstockstrat-portfolio/internal/config/config.go` — modify
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify (3 dials)
- `services/xstockstrat-marketdata/cmd/server/main.go` — modify
- `services/xstockstrat-marketdata/internal/config/config.go` — modify
- `services/xstockstrat-marketdata/internal/service/marketdata_service.go` — modify (2 dials)
- `services/xstockstrat-<trading|portfolio|marketdata>/internal/mtls/mtls.go` — create (per-service helper: load PEM env → `*tls.Config`)

**Reviewers**: `xstockstrat-trading` / `xstockstrat-portfolio` / `xstockstrat-marketdata` — Go gRPC server+client credential swap from `insecure` to mTLS; interceptor/header-propagation semantics unchanged beneath the new transport

**Codebase Evidence**:
- Server binds (no `grpc.Creds` today): `services/xstockstrat-trading/cmd/server/main.go:127` (`grpc.NewServer(`), listener `main.go:121` (`net.Listen("tcp", ...)`); `xstockstrat-portfolio/cmd/server/main.go:78`; `xstockstrat-marketdata/cmd/server/main.go:155`.
- Client dials (all `grpc.WithTransportCredentials(insecure.NewCredentials())`):
  - trading config-watcher `internal/config/config.go:81`; service dials `internal/service/trading.go:180,184,188,192` (ledger / notify / portfolio / marketdata).
  - portfolio config-watcher `internal/config/config.go:63`; service dials `internal/service/portfolio_service.go:109,113,117` (ledger / marketdata / notify).
  - marketdata config-watcher `internal/config/config.go:70`; service dials `internal/service/marketdata_service.go:142,146` (ledger / notify).
- Propagation interceptors to leave untouched (C-03 / FR-5): `services/xstockstrat-trading/internal/middleware/propagation.go:33` (`UnaryServerInterceptor`), `:45` (`UnaryClientInterceptor`, injects `x-user-id`/`x-access-scope`/`x-trace-id`). The existing dials already chain `grpc.WithChainUnaryInterceptor(middleware.UnaryClientInterceptor)` — keep it; only the credential option changes.
- No `crypto/tls`/`credentials.NewTLS` usage anywhere in the repo today (`recon.md:20`) — greenfield; Go stdlib ships TLS, **no new dependency**.

**TDD**: `red-green required`

**Covers**: `—` (paired test is Step 4)

**Instructions**:
1. Add `internal/mtls/mtls.go` to each Go service: `ServerConfig()` → `credentials.NewTLS(&tls.Config{ClientAuth: tls.RequireAndVerifyClientCert, ClientCAs: caPool, Certificates: []tls.Certificate{leaf}})`, and `ClientConfig(targetService string)` → `credentials.NewTLS(&tls.Config{RootCAs: caPool, Certificates: []tls.Certificate{leaf}, ServerName: targetService})`. Load `MTLS_CERT`/`MTLS_KEY`/`MTLS_CA_CERT` from env as PEM strings (reuse the existing `getEnv`/`LoadFromEnv` boot-time read — `trading/internal/config/config.go:37-52`); on absent/invalid material, return an error that aborts startup (**fail-closed**, @AC-4). **No `InsecureSkipVerify`** — `ServerName` pinning runs native chain+SAN verification (`design.md` Rejected Alternatives: InsecureSkipVerify is a fail-open footgun).
2. Server: add `grpc.Creds(mtls.ServerConfig())` to each `grpc.NewServer(...)` option list at the three server sites. Leave `ChainUnaryInterceptor`/`StatsHandler`/`KeepaliveParams` as-is.
3. Each client dial: replace `grpc.WithTransportCredentials(insecure.NewCredentials())` with `grpc.WithTransportCredentials(mtls.ClientConfig("xstockstrat-<target>"))`, where `<target>` is the **destination service name** (e.g. the trading→ledger dial pins `"xstockstrat-ledger"`), NOT the dialed host. This is the load-bearing authority pin (`design.md`; DO dials `${xstockstrat-ledger.PRIVATE_DOMAIN}` ≠ SAN). Keep the `clientKeepAlive` and `WithChainUnaryInterceptor` options.
4. Remove the now-unused `credentials/insecure` imports.

**Verification**:
```
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod
cd services/xstockstrat-portfolio && GOWORK=off golangci-lint run --modules-download-mode=mod
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod
grep -rn "insecure.NewCredentials\|InsecureSkipVerify" services/xstockstrat-{trading,portfolio,marketdata}/   # expect ZERO hits
```

---

### Step 4 — test: Go in-process mutual-TLS handshake + negative matrix + propagation + ledger-emit fail-soft

**Status**: `done`
**Service**: `xstockstrat-trading`, `xstockstrat-portfolio`, `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-trading/internal/mtls/mtls_test.go` — create
- `services/xstockstrat-portfolio/internal/mtls/mtls_test.go` — create
- `services/xstockstrat-marketdata/internal/mtls/mtls_test.go` — create
- `services/xstockstrat-trading/internal/service/ledger_emit_mtls_test.go` — create (fail-soft/one-shot assertions)

**Reviewers**: `xstockstrat-trading` / `xstockstrat-portfolio` / `xstockstrat-marketdata` — Go handshake + propagation-unchanged correctness

**Codebase Evidence**:
- Go test home per C-13 is `internal/testdata/` — none exists today; these tests build creds from the Step-1 dev PEMs in-process (single process, no mesh — `fails.md:369`). Fixture PEMs have a single consumer (these tests) → inline is C-13-compliant.
- Emit edge to assert fail-soft: `go s.emitLedgerEvent(...)` call sites in `services/xstockstrat-trading/internal/service/trading.go` (e.g. `:618,634,720`; snapshot emits `account.positions.synced` at `:998`). `design.md` cites `emitLedgerEvent` as fire-and-forget/no-retry with a `ledgerEmitTimeout` — confirm the symbol + timeout at execute and assert: a handshake mismatch on the emit dial does **not** crash or wedge a goroutine, is one-shot (not re-emitted next `pollFills` tick), and a snapshot event self-heals next cycle.

**TDD**: `red-green required` — against the pre-Step-3 tree these tests cannot build the mTLS creds path (RED); after Step 3 they pass (GREEN).

**Covers**: `AC-1, AC-2, AC-4, AC-5`

**Instructions**:
1. **@AC-2**: stand up an in-process gRPC server with `mtls.ServerConfig()` and a client with `mtls.ClientConfig("xstockstrat-<server-name>")`; assert the handshake succeeds and a unary RPC proceeds.
2. **@AC-1**: a plaintext (`insecure`) client — and a client presenting no cert — is **refused at the TLS layer** before any RPC dispatch; assert the error is a transport/handshake failure, and that no header trio is observed server-side from that caller.
3. **Negative matrix** (the R4 bug-class guard, `context.md` 2026-10-01): assert BOTH (a) a client cert from a **different (non-platform) CA** is rejected, AND (b) a **valid-platform-CA cert with the WRONG SAN** is rejected when the server/client pins the expected service name — this is what proves SAN matching actually runs and would have caught the `PRIVATE_DOMAIN` ≠ SAN mismatch.
4. **@AC-5**: over the authenticated channel, drive a call through `middleware.UnaryClientInterceptor` → `UnaryServerInterceptor` and assert `x-user-id`/`x-access-scope`/`x-trace-id` arrive unchanged (propagation semantics identical beneath mTLS).
5. **@AC-4 (fail-closed boot)**: assert `mtls.ServerConfig()`/`ClientConfig()` return an error (abort) when `MTLS_CERT`/`MTLS_KEY`/`MTLS_CA_CERT` are absent; assert no code path constructs an `insecure` or `InsecureSkipVerify` credential.
6. Ledger-emit fail-soft/one-shot assertions per the evidence above.

**Verification**:
```
cd services/xstockstrat-trading && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"
# repeat for portfolio, marketdata — confirm ≥ 40%
```
New `internal/mtls/` logic is in a measured package (not in the `cmd/`/`service/`/`handler/` exclusion list), so it counts toward the 40% threshold; the `ledger_emit_mtls_test.go` logic lives in the excluded `service/` package — note "integration-style assertion, no coverage threshold applies to that file; a `test` step is still present."

---

### Step 5 — service: Python backends — mutual TLS on server + all channel dials + config-watchers

**Status**: `done`
**Service**: `xstockstrat-indicators`, `xstockstrat-ingest`, `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-indicators/app/main.py` — modify (server creds; indicators is server-only)
- `services/xstockstrat-indicators/app/config/watcher.py` — modify (config-watcher dial)
- `services/xstockstrat-ingest/app/main.py` — modify (server + 3 dials)
- `services/xstockstrat-ingest/app/config/watcher.py` — modify
- `services/xstockstrat-analysis/app/main.py` — modify (server + 7 dials)
- `services/xstockstrat-analysis/app/config/watcher.py` — modify
- `services/xstockstrat-<indicators|ingest|analysis>/app/mtls.py` — create (per-service helper: PEM env → server/channel creds)

**Reviewers**: `xstockstrat-indicators` / `xstockstrat-ingest` / `xstockstrat-analysis` — Python gRPC (aio) server+channel credential swap; per-request propagation unchanged

**Codebase Evidence**:
- Server binds (`add_insecure_port`): `services/xstockstrat-indicators/app/main.py:74` (server `grpc.aio.server()` at `:65`); `xstockstrat-ingest/app/main.py:100` (server `:91`); `xstockstrat-analysis/app/main.py:88` (server `:79`).
- Client dials (`grpc.aio.insecure_channel(...)`): ingest `app/main.py:79,80,81` (marketdata/ledger/notify); analysis `app/main.py:65,69,70,71,73,74,75` (marketdata/indicators/ingest/ledger/notify/portfolio/trading).
- Config-watcher dials: `ingest/app/config/watcher.py:63`, `analysis/app/config/watcher.py:50`, `indicators/app/config/watcher.py:50` (all `grpc.aio.insecure_channel(endpoint)`).
- **Do NOT touch** the asyncpg DB-TLS `_ssl_ctx` block at `ingest/app/main.py:49-58` (`CERT_NONE`) — that is Postgres transport, unrelated to inter-service gRPC.
- `grpcio>=1.80.0` is already pinned (TLS-capable) — **no new dep** (`recon.md:60`). Per `fails.md:389`, do NOT change `pyproject.toml`; if any service's `pyproject.toml` is incidentally touched, run `uv lock` and commit `uv.lock` in the same step (CI `python-lint` runs `uv lock --check`).

**TDD**: `red-green required`

**Covers**: `—` (paired test is Step 6)

**Instructions**:
1. Add `app/mtls.py` per service: `server_credentials()` → `grpc.ssl_server_credentials([(KEY, CERT)], root_certificates=CA, require_client_auth=True)`; `channel_credentials()` → `grpc.ssl_channel_credentials(root_certificates=CA, private_key=KEY, certificate_chain=CERT)`. Read `MTLS_CERT`/`MTLS_KEY`/`MTLS_CA_CERT` via `os.environ` at module import (boot-time, not WatchConfig); raise on absent material (**fail-closed**, @AC-4).
2. Server: replace `grpc_server.add_insecure_port(f"[::]:{GRPC_PORT}")` with `grpc_server.add_secure_port(f"[::]:{GRPC_PORT}", server_credentials())` at the three server sites.
3. Each dial: replace `grpc.aio.insecure_channel(ENDPOINT)` with `grpc.aio.secure_channel(ENDPOINT, channel_credentials(), options=[('grpc.ssl_target_name_override', 'xstockstrat-<target>')])`. The `ssl_target_name_override` pins verification to the **target service name** (env-independent authority pin), applied at every ingest (3), analysis (7), and config-watcher (3) dial.
4. Leave the per-method propagation metadata untouched (FR-5): ingest `_propagation_meta` (`app/handlers/servicer.py:221-226`), analysis's inline propagation filter, indicators read-only propagation (`app/handlers/servicer.py:77`).

**Verification**:
```
cd services/xstockstrat-indicators && ruff check . && ruff format --check .
cd services/xstockstrat-ingest && ruff check . && ruff format --check .
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
grep -rn "insecure_channel\|add_insecure_port" services/xstockstrat-{indicators,ingest,analysis}/app/   # expect ZERO hits
```

---

### Step 6 — test: Python in-process handshake + negative matrix + propagation

**Status**: `done`
**Service**: `xstockstrat-indicators`, `xstockstrat-ingest`, `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-indicators/tests/test_mtls.py` — create
- `services/xstockstrat-ingest/tests/test_mtls.py` — create
- `services/xstockstrat-analysis/tests/test_mtls.py` — create

**Reviewers**: `xstockstrat-indicators` / `xstockstrat-ingest` / `xstockstrat-analysis` — Python handshake + propagation correctness

**Codebase Evidence**:
- Python fixture home per C-13 is `tests/conftest.py` — exists in these services; the dev PEMs have a single consumer (these tests) → inline/conftest fixture is compliant. `pytest-asyncio` is available (analysis/ingest async channels).

**TDD**: `red-green required` — RED pre-Step-5 (no secure path), GREEN after.

**Covers**: `AC-1, AC-2, AC-4, AC-5`

**Instructions**:
Mirror Step 4 in Python with `grpc.aio` in-process: (1) **@AC-2** mutual handshake over `add_secure_port` + `secure_channel` with `ssl_target_name_override` succeeds and a unary RPC proceeds; (2) **@AC-1** an `insecure_channel` client is refused at the TLS layer, trio not observed; (3) **negative matrix** — wrong-CA cert rejected AND valid-CA/wrong-SAN rejected; (4) **@AC-5** per-method propagation metadata (`_propagation_meta` for ingest) delivers the trio unchanged over the authenticated channel; (5) **@AC-4** module import raises when `MTLS_*` env is absent (fail-closed), and no `insecure_channel`/`CERT_NONE` path exists for inter-service gRPC.

**Verification**:
```
cd services/xstockstrat-indicators && pytest --cov=app --cov-fail-under=50
cd services/xstockstrat-ingest && pytest --cov=app --cov-fail-under=40
cd services/xstockstrat-analysis && pytest --cov=app --cov-fail-under=40
```

---

### Step 7 — service: Node backends — mutual TLS on server binds + config-watcher + identity→ledger audit client

**Status**: `done`
**Service**: `xstockstrat-config`, `xstockstrat-ledger`, `xstockstrat-identity`, `xstockstrat-notify`
**Files**:
- `services/xstockstrat-config/src/index.ts` — modify (server bind)
- `services/xstockstrat-ledger/src/index.ts` — modify
- `services/xstockstrat-identity/src/index.ts` — modify
- `services/xstockstrat-notify/src/index.ts` — modify
- `services/xstockstrat-ledger/src/services/configWatcher.ts` — modify (client dial)
- `services/xstockstrat-identity/src/services/configWatcher.ts` — modify
- `services/xstockstrat-notify/src/services/configWatcher.ts` — modify
- `services/xstockstrat-identity/src/grpc/ledgerAudit.ts` — modify (identity→ledger client)
- `services/xstockstrat-<config|ledger|identity|notify>/src/mtls.ts` — create (per-service helper: PEM env → server/client creds)

**Reviewers**: `xstockstrat-ledger` / `xstockstrat-identity` / `xstockstrat-notify` / `xstockstrat-config` — Node gRPC server+client credential swap; streaming RPCs (WatchConfig, StreamEvents, StreamAlerts) continue under mTLS

**Codebase Evidence**:
- Server binds (`grpc.ServerCredentials.createInsecure()` in `bindAsync`): `config/src/index.ts:52-54`; `ledger/src/index.ts:59-61`; `identity/src/index.ts:54-56`; `notify/src/index.ts:52-54`.
- Client dials (`grpc.credentials.createInsecure()`): config-watchers `ledger/src/services/configWatcher.ts:27` (and the identity/notify copies at the same `:27`); identity→ledger audit `identity/src/grpc/ledgerAudit.ts:34` (`new LedgerServiceClient(endpoint, grpc.credentials.createInsecure())`, forwards the trio via its own `PROPAGATED_HEADERS`).
- `xstockstrat-config` is **server-only** for inbound and self-dials nothing — it reads only `GRPC_PORT`/`DATABASE_URL`/`CONFIG_SECRETS_ENCRYPTION_KEY` at boot and never self-subscribes (`recon.md:41`); add `MTLS_*` to its boot env read. Its dead `configWatcher.ts:27` copy is not wired — do not revive it.
- Streaming to preserve: config `WatchConfig` subscriber map (`configServiceImpl.ts`, subscribers Map `:138`); ledger `StreamEvents` (`ledgerServiceImpl.ts:179`, `onReconnect` `:212` → client replays); notify `StreamAlerts`.
- `@grpc/grpc-js@^1.14.4` `createSsl` is built-in — **no new dep** (`recon.md:60`).

**TDD**: `red-green required`

**Covers**: `—` (paired test is Step 8)

**Instructions**:
1. Add `src/mtls.ts` per service: `serverCredentials()` → `ServerCredentials.createSsl(CA, [{ private_key: KEY, cert_chain: CERT }], true)` (the trailing `true` = `checkClientCertificate`, i.e. require+verify client cert); `clientCredentials(targetService)` → `credentials.createSsl(CA, KEY, CERT)` combined with a channel option pinning authority to the target name (`grpc.ssl_target_name_override` / `checkServerIdentity` → `xstockstrat-<target>`). Read `MTLS_CERT`/`MTLS_KEY`/`MTLS_CA_CERT` from `process.env` in `index.ts` before `bindAsync` (boot-time); throw on absent material (**fail-closed**, @AC-4).
2. Server: replace `grpc.ServerCredentials.createInsecure()` with `serverCredentials()` in each `bindAsync(...)` call at the four server sites.
3. Clients: the three wired config-watchers (`ledger`/`identity`/`notify` `configWatcher.ts:27`) and the identity→ledger audit client (`ledgerAudit.ts:34`) swap `grpc.credentials.createInsecure()` for `clientCredentials("xstockstrat-config")` / `clientCredentials("xstockstrat-ledger")` respectively, with the target-name authority pin. Leave `ledgerAudit.ts`'s `PROPAGATED_HEADERS` trio forwarding untouched (FR-5).

**Verification**:
```
cd services/xstockstrat-config && pnpm run lint
cd services/xstockstrat-ledger && pnpm run lint
cd services/xstockstrat-identity && pnpm run lint
cd services/xstockstrat-notify && pnpm run lint
grep -rn "createInsecure" services/xstockstrat-{config,ledger,identity,notify}/src/   # expect ZERO hits in runtime (non-test) code
```

---

### Step 8 — test: Node in-process handshake + negative matrix + propagation + streaming-across-rotation (@AC-6)

**Status**: `done`
**Service**: `xstockstrat-config`, `xstockstrat-ledger`, `xstockstrat-identity`, `xstockstrat-notify`
**Files**:
- `services/xstockstrat-config/src/__tests__/mtls.test.ts` — create
- `services/xstockstrat-ledger/src/__tests__/mtls.test.ts` — create (includes the rotation test)
- `services/xstockstrat-identity/src/__tests__/mtls.test.ts` — create
- `services/xstockstrat-notify/src/__tests__/mtls.test.ts` — create

**Reviewers**: `xstockstrat-config` / `xstockstrat-ledger` / `xstockstrat-identity` / `xstockstrat-notify` — Node handshake, streaming-under-mTLS, rotation correctness

**Codebase Evidence**:
- Node test home per C-13 is `src/__tests__/fixtures/`; existing suites live in `src/__tests__/` (e.g. `config/src/__tests__/configServiceImpl.test.ts`, `ledger/src/__tests__/ledgerServiceImpl.test.ts`, `eventNotifier.test.ts`) — these in-process tests build real creds from Step-1 PEMs; single consumer → inline compliant.
- Rotation target: ledger `StreamEvents` (`ledgerServiceImpl.ts:179`, `onReconnect:212`) or config `WatchConfig` (`configServiceImpl.ts` subscriber map `:138`) — both reconnect/replay (`recon.md:43,41`).

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-4, AC-5, AC-6`

**Instructions**:
1. Per service: **@AC-2** mutual handshake over `createSsl` server + client succeeds; **@AC-1** a `createInsecure` client is refused, trio not honored; **negative matrix** — wrong-CA rejected AND valid-CA/wrong-SAN rejected; **@AC-5** the trio still propagates (ledger audit / config-watcher path) over the authenticated channel; **@AC-4** `index.ts` throws on absent `MTLS_*` env (fail-closed), no `createInsecure` runtime path.
2. **@AC-6 (ledger `StreamEvents` or config `WatchConfig`)**: open a long-lived stream over mTLS; generate a **rotated leaf off the same CA** (second cert from `gen-dev-certs.sh`); open a new connection presenting the rotated leaf and assert it is accepted (same CA chains) and the stream **reconnects/replays without data loss** — the design's accepted interpretation of @AC-6 "no service downtime" = reconnect-without-data-loss, not zero restart.

**Verification**:
```
cd services/xstockstrat-config && pnpm run test:coverage
cd services/xstockstrat-ledger && pnpm run test:coverage
cd services/xstockstrat-identity && pnpm run test:coverage
cd services/xstockstrat-notify && pnpm run test:coverage
# confirm each service's ≥40% threshold passes
```

---

### Step 9 — service: UI BFF — client certs through the single makeTransport choke point + e2e mock to TLS

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/connectClients.ts` — modify (the single `makeTransport` factory)
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify (plaintext http2 → TLS)

**Reviewers**: `xstockstrat-ui` — Connect-RPC call safety; client-cert presentation; no behavior change for the browser

**Codebase Evidence**:
- Single choke point: `services/xstockstrat-ui/src/lib/connectClients.ts:26-28` — `function makeTransport(endpoint) { return createGrpcTransport({ baseUrl: \`http://${endpoint}\` }); }` builds all 10 backend transports (endpoints `connectClients.ts:15-24`). Changing this one function covers every backend client.
- e2e mock: `services/xstockstrat-ui/e2e/mock-backend.ts` — `http2.createServer(...)` at `:668`, `:1263`, `:1384` (plaintext h2c); move to `http2.createSecureServer` with dev certs.
- The Step-1 spike decides the mechanism: `createGrpcTransport` `baseUrl: https://…` + `nodeOptions {ca, cert, key, checkServerIdentity → target name}`, or the `@grpc/grpc-js` stub fallback behind the same `makeTransport` boundary.

**TDD**: `red-green required`

**Covers**: `—` (paired test is Step 10)

**Instructions**:
1. Change `makeTransport(endpoint, targetService)` to present the `xstockstrat-ui` client leaf + CA and pin the server authority to the target service name, using the mechanism confirmed in Step 1. `baseUrl` becomes `https://${endpoint}`. Each `createClient(... makeTransport(ENDPOINT, 'xstockstrat-<target>'))` passes its destination service name (authority pin).
2. Load `MTLS_CERT`/`MTLS_KEY`/`MTLS_CA_CERT` from `process.env` (Node runtime, BFF server side); fail-closed if absent.
3. Convert `e2e/mock-backend.ts`'s three `http2.createServer` to `http2.createSecureServer` loading dev leaves, so e2e exercises the TLS path.

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint
grep -n "createSecureServer" services/xstockstrat-ui/e2e/mock-backend.ts   # 3 hits (was http2.createServer)
grep -n "http://" services/xstockstrat-ui/src/lib/connectClients.ts        # expect ZERO plaintext baseUrl
```

---

### Step 10 — test: UI BFF presents a client cert; mock-backend TLS handshake (e2e/structural)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/mtls-transport.spec.ts` — create (or extend an existing e2e spec)

**Reviewers**: `xstockstrat-ui` — client-cert correctness; no browser-visible behavior change

**Codebase Evidence**:
- `xstockstrat-ui` has **no coverage threshold** (`spec-template.md` coverage table: n/a for the UI) — verification is Playwright e2e.
- Frontend test-data (C-12): reuse `e2e/fixtures/` + auth helpers `e2e/helpers/auth.ts` (`addAuthCookie`/`addAdminCookie`); the mTLS cert material is infra, not a domain fixture — no `INVENTORY.md` row needed (scenario-infra exempt).

**TDD**: `red-green required` — RED before Step 9 (mock serves plaintext; a TLS client fails to connect / a plaintext client still works), GREEN after (TLS handshake succeeds end to end, plaintext mock rejected).

**Covers**: `AC-4`

**Instructions**:
Assert the BFF→mock path completes over TLS with the UI client cert presented, and that a plaintext transport against the now-TLS mock is refused (contributes the UI slice of @AC-4 "verification cannot be disabled"). Reuse the canonical auth helpers; do not re-implement JWT signing.

**Verification**:
```
cd services/xstockstrat-ui && pnpm test:e2e   # or the scoped spec; confirm the TLS path passes and plaintext is refused
```

---

### Step 11 — service: Agent — single shared secure-channel factory across all dial sites

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/client.py` — modify (67 inline `insecure_channel` sites → factory)
- `services/xstockstrat-agent/app/auth.py` — modify (2 inline sites → factory)
- `services/xstockstrat-agent/app/mtls.py` — create (the shared secure-channel factory)

**Reviewers**: `xstockstrat-agent` — MCP tool contract unaffected (transport-only); OAuth edge unchanged; client-cert presentation

**Codebase Evidence**:
- **Discovery beyond recon**: recon.md:50 summarized the agent as "2 channel sites"; the actual count is **67 inline `grpc.aio.insecure_channel(...)` sites in `app/client.py`** (lines 170, 236, 276, 290, 308, …, 2355 — confirmed via `grep -c`) **plus 2 in `app/auth.py:35,67`** = **69 total**. There is **no shared channel helper today** (`grep` for a channel factory returned none). Every tool method opens its own ephemeral per-call channel to one of `INGEST/NOTIFY/PORTFOLIO/ANALYSIS/INDICATORS/IDENTITY/CONFIG/TRADING/MARKETDATA_ENDPOINT` (endpoint consts `client.py:24` etc.).
- `grpcio>=1.80.0` already TLS-capable; no dep change (`fails.md:389` — only run `uv lock` if `pyproject.toml` is touched).

**TDD**: `red-green required`

**Covers**: `—` (paired test is Step 12)

**Instructions**:
1. Add `app/mtls.py`: `secure_channel(endpoint, target_service)` → `grpc.aio.secure_channel(endpoint, grpc.ssl_channel_credentials(root_certificates=CA, private_key=KEY, certificate_chain=CERT), options=[('grpc.ssl_target_name_override', target_service)])`, loading `MTLS_CERT`/`MTLS_KEY`/`MTLS_CA_CERT` from env at import (fail-closed if absent). The factory maps each `<X>_ENDPOINT` to its target service name for the authority pin (e.g. `INGEST_ENDPOINT` → `"xstockstrat-ingest"`). This is the DRY unit (`recon.md:59`; design: one shared factory, not 69 inline copies).
2. Replace all 69 `grpc.aio.insecure_channel(ENDPOINT)` call sites (`client.py` ×67 + `auth.py` ×2) with `mtls.secure_channel(ENDPOINT, "xstockstrat-<target>")`, preserving the `async with ... as channel:` structure and the per-call propagation metadata (FR-5 — the agent forwards derived access-scope, `recon.md:68`).

**Verification**:
```
cd services/xstockstrat-agent && ruff check . && ruff format --check .
grep -c "insecure_channel" services/xstockstrat-agent/app/client.py services/xstockstrat-agent/app/auth.py   # expect 0 and 0
```

---

### Step 12 — test: Agent secure-channel factory pins authority; no insecure path remains

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_mtls.py` — create

**Reviewers**: `xstockstrat-agent` — factory correctness; MCP contract unaffected

**Codebase Evidence**:
- `services/xstockstrat-agent/tests/` exists with `conftest.py` + `pytest-cov`/`pytest-asyncio` (`pyproject.toml:21,30`). `xstockstrat-agent` is **not** in `spec-template.md`'s coverage-threshold table — note "no listed coverage threshold for the agent; structural + unit assertion sufficient, `test` step still required (C-08)."

**TDD**: `red-green required` — RED before Step 11 (no factory), GREEN after.

**Instructions**:
Assert the factory builds a secure channel whose target-name authority equals the service name passed (not the dialed host), builds real creds from the Step-1 dev PEMs, and raises when `MTLS_*` env is absent. Add a structural assertion that **no `insecure_channel` remains** in `app/client.py` / `app/auth.py` (regression guard for the 69-site sweep).

**Verification**:
```
cd services/xstockstrat-agent && pytest tests/test_mtls.py
grep -rn "insecure_channel" services/xstockstrat-agent/app/   # expect ZERO hits
```

---

### Step 13 — service: Wire cert env into all deployment files + repo-wide no-plaintext structural assert

**Status**: `done`
**Service**: deployment (`docker-compose.yml`, `.do/app.dev.yaml`, `.do/app.yaml`)
**Files**:
- `docker-compose.yml` — modify (add `MTLS_*` to the per-service env; a dev-cert bind-mount or env injection)
- `.do/app.dev.yaml` — modify (add `MTLS_CERT`/`MTLS_KEY`/`MTLS_CA_CERT` per component; `type: SECRET` for key)
- `.do/app.yaml` — modify (same, production CA/certs; `type: SECRET` for key)

**Reviewers**: Platform lead — deployment topology, DO App Platform + compose parity, no-downtime path; Security — prod loads prod-CA material, key is `type: SECRET`, no plaintext/skip-verify reachable in prod

**Codebase Evidence**:
- `MTLS_CERT`/`MTLS_KEY`/`MTLS_CA_CERT` confirmed **absent** from all three files (grep: no hits) → must add to every application component's env block.
- Compose anchor to reuse for shared env: `docker-compose.yml:15` `x-common-env: &common-env` (merged via `<<: *common-env`); the otel read-only bind-mount `docker-compose.yml:61` (`...:ro`) is the local cert-file mount model for dev. Per-service cert differs (each needs its OWN leaf), so the leaf/key are per-service env/mount while the CA can ride `&common-env`.
- DO string-env + secret precedent: `DATABASE_CA_CERT` at `.do/app.dev.yaml:327-329` (`value: ${xstockstrat.CA_CERT}`); `type: SECRET` already used in `.do/app.yaml:38,82,295,…` — follow it for `MTLS_KEY`.
- DO dials `${xstockstrat-<svc>.PRIVATE_DOMAIN}:<port>` (`.do/app.yaml:56-67`) — unchanged; this step adds cert env only, not endpoint changes (no `_ENDPOINT` suffix churn).

**TDD**: `red-green required` (structural — deployment parity + no-plaintext repo sweep)

**Covers**: `AC-4`

**Instructions**:
1. Add `MTLS_CA_CERT` to `x-common-env` (shared CA) and add each service's own `MTLS_CERT`/`MTLS_KEY` to that service's block in `docker-compose.yml`, sourced from the `gen-dev-certs.sh` output (env PEM string or `:ro` bind-mount parsed to string — keep prod parity by having code accept PEM-as-string).
2. Add the three vars to every application component in `.do/app.dev.yaml` (dev CA) and `.do/app.yaml` (prod CA), with `MTLS_KEY` as `type: SECRET`. Dev and prod differ ONLY in which CA/certs load — there is no toggle, no plaintext port, no verification-disabling flag in any file (@AC-4).
3. The repo-wide structural assertion (below) is the cross-cutting @AC-4 "no plaintext path anywhere" proof.

**Verification**:
```
for f in docker-compose.yml .do/app.dev.yaml .do/app.yaml; do grep -c "MTLS_CERT\|MTLS_KEY\|MTLS_CA_CERT" "$f"; done   # all three non-zero, present for every component
grep -n "type: SECRET" .do/app.yaml | head                      # MTLS_KEY entries carry it
# Repo-wide: no remaining plaintext/verification-disabling inter-service path in runtime code
grep -rn "insecure.NewCredentials\|InsecureSkipVerify" services/xstockstrat-{trading,portfolio,marketdata}/ ; \
grep -rn "insecure_channel\|add_insecure_port" services/xstockstrat-{indicators,ingest,analysis,agent}/app/ ; \
grep -rn "createInsecure" services/xstockstrat-{config,ledger,identity,notify}/src/ --include=*.ts | grep -v __tests__   # all expect ZERO
```

---

### Step 14 — docs: Rolling-cutover deploy runbook, rotation/rollback, env convention + Teardown reconciliation

**Status**: `done`
**Service**: `docs/`
**Files**:
- `docs/runbooks/inter-service-mtls-rollout.md` — create (leaf→root cutover, flat-book precondition, rotation, rollback)
- `docs/patterns/inter-service-mtls.md` — modify (finalize the env convention from Step 1)
- `CLAUDE.md` (root) — modify (Environment Variable Naming: note `MTLS_CERT`/`MTLS_KEY`/`MTLS_CA_CERT` are boot-time cert-material env, distinct from `<SERVICE>_ENDPOINT`)
- each affected service's `CLAUDE.md` — modify (record the `MTLS_*` boot env + fail-closed default)

**Reviewers**: None (docs)

**Codebase Evidence**:
- Root CLAUDE.md § Environment Variable Naming Convention governs inter-service **connection** vars (`<SERVICE>_ENDPOINT`); the cert-material vars are a separate, boot-time class and must be documented as NOT taking an endpoint suffix.
- `design.md` §Rollout / §Rotation / §Rollback: leaf→root dependency-ordered rolling deploy; **trading↔ledger wave deployed adjacently under a mandatory flat-book (zero open/working orders) + `platform.trading_state=HALTED` precondition** (the fire-and-forget `emitLedgerEvent` edge drops transition events permanently on a mid-cutover mismatch — operator-signed-off bounded loss, blast radius feature-042); restart-only rotation with a two-cert CA bundle (old+new) overlap window; rollback = revert the image (pre-mTLS images ignore `MTLS_*`), **never strip `MTLS_*` env while mTLS code is deployed** (fail-closed crash-loop footgun).
- DO health-gated-promotion / rollback-to-previous-deployment semantics are **inferred** (`design.md` Open Risk) — the runbook states the assumption and the manual prior-image-redeploy fallback.

**TDD**: `N/A (docs — no code behavior)`

**Covers**: `—`

**Instructions**:
1. Write the rollout runbook: the leaf→root deploy order, the trading↔ledger flat-book+HALTED precondition and how to verify a flat book, the restart-only rotation procedure (CA-bundle overlap: ship old+new in `MTLS_CA_CERT` for one window, then drop old), and the rollback procedure (image-revert, cert-env-left-in-place, never-strip-env footgun). Note the feature-084 deploy-file coordination and the DO rollback-semantics assumption + manual fallback.
2. Update the root CLAUDE.md env convention and each affected service CLAUDE.md with the `MTLS_*` boot-env defaults (fail-closed).
3. **Teardown (root CLAUDE.md § Teardown):** this step changes context files (CLAUDE.md ×many, new pattern/runbook docs) and the behavior they describe. Run `/context-forge:context-constitution refresh` scoped to the touched files and fix grounded drift; if the plugin is unavailable, do the manual equivalent and record BOTH the unavailability AND the manual reconciliation in the PR body (`fails.md:670`).

**Verification**:
```
ls docs/runbooks/inter-service-mtls-rollout.md docs/patterns/inter-service-mtls.md
grep -n "MTLS_CERT\|MTLS_KEY\|MTLS_CA_CERT" CLAUDE.md   # env convention note present
# Teardown: context-constitution refresh reports no grounded drift on the touched files (or manual reconciliation recorded in PR body)
```

---

## Deviation Log

- **Step 13 — added `scripts/mtls-dev-env.sh` (not in the step Files list).** Instruction 1 requires the compose cert material be "sourced from the gen-dev-certs.sh output (env PEM string …)". Docker Compose cannot interpolate a multiline PEM from its `.env` file, so the robust, prod-parity mechanism (code reads MTLS_* as PEM strings in both dev and prod) is shell-env interpolation fed by a sourced exporter. The helper reads `./certs/` and exports the per-service `<SVC>_MTLS_CERT`/`<SVC>_MTLS_KEY` plus the shared `MTLS_CA_CERT`. **Disposition**: in-scope per Instruction 1's "sourced from" requirement; surfaced here rather than silently expanding the stage-set (F-08).

- **Step 11 — factory loads MTLS_* at CALL, not at import.** The spec text said "load … at import"; app/mtls.py loads inside `_load()` at each factory call, byte-for-byte mirroring the three backend `app/mtls.py` modules. Same fail-closed guarantee (the first `secure_channel`/`channel_credentials` raises when env is absent) and the module stays importable under pytest without a global MTLS_* env, which Step 12's absent-env test requires. **Disposition**: intentional consistency choice; fail-closed semantics preserved.
- **Step 12 — full `pytest --cov=app --cov-fail-under=40` deferred to CI (CI-equivalent fallback).** Ran `pytest tests/test_mtls.py` directly (4 passed) rather than the whole agent suite + coverage gate. CI (Node/Python matrix) runs the full `python-test` job. **Disposition**: CI-equivalent fallback.

- **Step 10 — full `pnpm test:e2e` harness run deferred to CI (CI-equivalent fallback).** The full Playwright harness builds Next (240s) + launches Chromium via `webServer`+`globalSetup`. The new `e2e/mtls-transport.spec.ts` asserts the transport-layer mTLS contract, which needs neither a browser nor a Next build, so it was run standalone via a webServer-less temp config: RED against a plaintext mock (mTLS-handshake + plaintext-refused assertions fail), GREEN against the real secure mock (4/4 pass, 8.2s). CI (Node 24) runs the full `pnpm test:e2e`. **Disposition**: CI-equivalent fallback.

- **Step 8 — Node full `pnpm run test:coverage` suite deferred to CI (CI-equivalent fallback).** The services full suites need a live TimescaleDB (never start a DB — HARD CONSTRAINT; fails.md:369). Ran the new `src/__tests__/mtls.test.ts` per service via its own runner (config/notify compiled `node --test dist`; ledger/identity `node --experimental-strip-types --test src`): config 5, notify 5, ledger 6, identity 5 — all green. CI (Node 24) runs the full coverage suite. **Disposition**: CI-equivalent fallback. Note: the strip-types runners require explicit `.ts` relative-import extensions (fails.md:2224 is about vacuous-green, not applicable here since config/notify compile first and the strip-types imports resolve correctly).

- **Step 6 — Python full `pytest --cov` suite deferred to CI (CI-equivalent fallback).** The services pytest suites need a live TimescaleDB (never start a DB — HARD CONSTRAINT; fails.md:369). Ran the new `tests/test_mtls.py` in each service venv (`.venv/bin/python -m pytest`, per the venv-interpreter trap in fails.md): 5/5 green x3 (indicators/ingest/analysis). No `pyproject.toml` was touched, so no `uv lock` is needed. CI runs `pytest --cov=app --cov-fail-under` against the managed DB. **Disposition**: CI-equivalent fallback.

- **Step 3/4 — golangci-lint deferred to CI (CI-equivalent fallback).** Local golangci-lint v2.5.0 is built with go1.25 and refuses a go1.27-targeted module ("Go language version used to build golangci-lint is lower than the targeted Go version"). Verified instead with `go build` + `gofmt -l` + `go vet` (all clean). CI runs golangci-lint v2.13.1 (go1.27-compatible). **Disposition**: CI-equivalent fallback.
- **Step 4 — full `go test ./...` coverage mesh deferred to CI (CI-equivalent fallback).** The services' repository/integration tests require a live TimescaleDB, which the execute sandbox has none of (never start a DB — HARD CONSTRAINT; fails.md:369). Verified the Step's new logic in-process: the `internal/mtls` package tests pass with ServerConfig/ClientConfig at 100%% coverage, plus the ledger-emit fail-soft test. CI runs the full suite against the managed DB. **Disposition**: CI-equivalent fallback (structural/in-process per fails.md:369).

- **Step 1 — Files-list omission (F-08 transparency).** Step 1 Instruction #3 mandates adding `certs/`
  to `.gitignore`, but `.gitignore` was not in the step's `**Files**` list. Staged it with Step 1 as
  instruction-mandated (not opportunistic cleanup). **Disposition**: in-scope per the step's own
  Instructions; surfaced here rather than silently bending F-08's stage-set.
- **Step 1 — connect-node spike resolved (Open Risk closed).** `@connectrpc/connect-node@^2.1.0`
  `createGrpcTransport` accepts `nodeOptions?: http2.SecureClientSessionOptions` (carries
  `ca`/`cert`/`key`/`checkServerIdentity`) — confirmed at
  `node_modules/@connectrpc/connect-node/dist/cjs/node-transport-options.d.ts:30`. Client-cert
  pass-through works natively; the `@grpc/grpc-js` stub fallback is NOT needed. Step 9 consumes this.
