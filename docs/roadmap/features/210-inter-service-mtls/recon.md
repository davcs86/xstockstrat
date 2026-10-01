# Recon: inter-service-mtls

**Created**: 2026-09-30
**From**: product-spec.md
**Affected services**: xstockstrat-{trading,portfolio,marketdata} (Go), xstockstrat-{indicators,ingest,analysis} (Python), xstockstrat-{ledger,identity,notify,config} (Node), xstockstrat-ui (BFF gRPC client), xstockstrat-agent (gRPC client); deployment (docker-compose.yml, .do/app.yaml, .do/app.dev.yaml, scripts/)

---

## Objective

Replace plaintext h2c inter-service gRPC (every server binds insecure; every client dials
`insecure`) with **mutual TLS + verified per-service identity**, so the platform's trust in the
propagated `x-user-id` / `x-access-scope` / `x-trace-id` header trio is anchored in a cryptographic
peer identity rather than raw network reachability, and inter-service traffic is encrypted. Enforced
in the DO deployment (fail-closed), with a documented relaxed dev mode that is never selectable in
production. Closes audit ticket **DT-3**. No proto/DB changes; header-propagation semantics unchanged.

## Codebase Map

**Zero existing gRPC TLS anywhere in the repo** (repo-wide grep for `secure_channel` /
`ServerCredentials.createSsl` / `credentials.NewTLS` / `ssl_channel_credentials` = 0 first-party
hits). This is a greenfield transport-credentials addition. Every service runs as **root** (no `USER`
directive in any Dockerfile) — cert material can be delivered without a user-remap.

- **`xstockstrat-trading`** (Go)
  - Server (no `grpc.Creds`): `cmd/server/main.go:127`; plaintext listener `main.go:121`
  - Client dials (insecure): config-watcher `internal/config/config.go:81`; service dials `internal/service/trading.go:180,184,188,192` (→ ledger/notify/portfolio/marketdata)
  - Propagation interceptor: `internal/middleware/propagation.go:33` (server), `:45` (client); registered via `grpc.ChainUnaryInterceptor` in main.go:127. Extra `internal/middleware/authz.go`.
  - Config read: `internal/config/config.go:37-52` (`getEnv`/`LoadFromEnv`). Streaming served: `StreamOrderUpdates` (`internal/handler/trading.go:204`).
- **`xstockstrat-portfolio`** (Go)
  - Server `cmd/server/main.go:78`; dials `internal/service/portfolio_service.go:109,113,117` + config-watcher `internal/config/config.go:63`; consumes ledger streams (`cmd/server/main.go:63-67`, 3 permanent subs). Streaming served: `StreamPortfolioUpdates`.
- **`xstockstrat-marketdata`** (Go)
  - Server `cmd/server/main.go:155`; dials `internal/service/marketdata_service.go:142,146` (no keepalive opt) + config-watcher `internal/config/config.go:70`. Resolves vendor secrets via `Watcher.ResolveSecret`→`GetSecret` at startup (`config.go:109`). Streaming served: `StreamBars`, `StreamQuotes`.
- **`xstockstrat-indicators`** (Python)
  - Server `app/main.py:65` + `add_insecure_port` `:74`; **no outbound backend channels** (config-watcher only, `app/config/watcher.py:50`). Propagation read-only (`app/handlers/servicer.py:77`). Dockerfile: feature-209 libseccomp+root variant.
- **`xstockstrat-ingest`** (Python)
  - Server `app/main.py:91,100`; 3 dials `app/main.py:79-81` (marketdata/ledger/notify) + config-watcher `app/config/watcher.py:63`. Named propagation helper `_propagation_meta` `app/handlers/servicer.py:221-226`.
- **`xstockstrat-analysis`** (Python)
  - Server `app/main.py:79,88`; **7 dials** `app/main.py:65-75` (marketdata/indicators/ingest/ledger/notify/portfolio/trading). Inline propagation filter (~8 sites). Consumes ledger `StreamEvents` (`app/engine/pnl_pattern_consumer.py`).
- **`xstockstrat-config`** (Node)
  - Server `src/index.ts:49` + `createInsecure` bind `:52-54`. **Serves `WatchConfig`** (`src/grpc/configServiceImpl.ts:262`, long-lived subscriber map). Reads only `GRPC_PORT`/`DATABASE_URL`/`CONFIG_SECRETS_ENCRYPTION_KEY` at boot; **never self-subscribes** (`index.ts:22`). Its `configWatcher.ts:27` copy is dead.
- **`xstockstrat-ledger`** (Node)
  - Server `src/index.ts:56,59-61`; config-watcher client `src/services/configWatcher.ts:27`. Serves `StreamEvents` (`src/grpc/ledgerServiceImpl.ts:182`, `EventNotifier` tail; `onReconnect` ends call → client replays).
- **`xstockstrat-identity`** (Node)
  - Server `src/index.ts:48,54-56`; config-watcher `src/services/configWatcher.ts:27` + **only non-config outbound**: `src/grpc/ledgerAudit.ts:34` (→ ledger, forwards trio via own `PROPAGATED_HEADERS`).
- **`xstockstrat-notify`** (Node)
  - Server `src/index.ts:49,52-54`; config-watcher `src/services/configWatcher.ts:27`. Serves `StreamAlerts` (`src/grpc/notifyServiceImpl.ts:120`, per-subscriber call map).
- **`xstockstrat-ui`** (Next.js BFF client)
  - **Single choke point**: `src/lib/connectClients.ts:26-28` `makeTransport()` builds all 10 backend transports via `createGrpcTransport({ baseUrl: http://... })` (plaintext h2c). Endpoints `connectClients.ts:15-24`. e2e mock: `e2e/mock-backend.ts` 3× `http2.createServer` (plaintext, `:668/1263/1384`). Runner root.
- **`xstockstrat-agent`** (Python client)
  - 2 channel sites, ephemeral per-call `insecure_channel`: `app/client.py:170` (9 backends) + `app/auth.py:35,67` (identity `ValidateToken`, own `IDENTITY_ENDPOINT` copy). No shared factory. Consumes **no** streaming RPC. Root Dockerfile; supervisord sole `app-main` (post-214).

## Patterns to REUSE

- **Env-string cert delivery (the only DO-compatible mechanism)** → reuse the `DATABASE_CA_CERT` string-env precedent: `.do/app.dev.yaml:327-329` (`value: ${xstockstrat.CA_CERT}`), parsed in code into a trust store. **DO App Platform has NO file-mount — env vars only.** Compose *can* bind-mount, but the code path must accept PEM-as-string so prod parity holds.
- **Compose injection points** → reuse YAML anchors `x-common-env: &common-env` (`docker-compose.yml:11-40`) for shared cert/CA/enforce env; the otel read-only bind-mount `docker-compose.yml:60-61` as the local cert-file mount model.
- **Boot-time env read (NOT WatchConfig) for cert material + enforce flag** → reuse each service's existing pre-server env read (Go `getEnv`/`LoadFromEnv`; Python `os.environ.get` at module top; Node `process.env` in `index.ts` before bind). **Mandatory for config** (see Risks: bootstrap).
- **Local cert generation** → reuse `openssl` already invoked in `scripts/setup-env.sh:113-114` (`openssl rand`); a self-signed CA + per-service leaf `openssl req` step slots here / a new `scripts/gen-dev-certs.sh`.
- **Single-factory client creds** → UI already has one (`makeTransport`); introduce a shared channel-factory helper in the agent (currently inlined at 2 sites, `client.py`/`auth.py`) — DRY (C-18).
- **grpcio TLS built-in** → no new dep: all 3 Python services + agent pin `grpcio>=1.80.0` (TLS-capable). Go `crypto/tls`+`credentials` stdlib; Node `@grpc/grpc-js@^1.14.4` `createSsl` built-in. No dependency additions required in any language.
- **Peer-identity verification** → Go `credentials.VerifyPeerCertificate` / `TLSInfo` from `peer.FromContext`; Python `context.auth_context()`; Node `call.getPeer()` + `checkServerIdentity`. All native to the existing TLS stacks.

## Existing Business Rules (preserve / extend)

The transport change must not regress any of these (all defaulted PRESERVE):

- **PRESERVE** `@AC-3 @FR-1 @feature-179` outbound gRPC carries the `x-user-id`/`x-access-scope`/`x-trace-id` trio (`services/xstockstrat-ui/acceptance/ui-resume-halted-account.feature`) — mTLS re-anchors trust but must not change what is forwarded.
- **PRESERVE** `@AC-8 @feature-156` agent forwards derived access-scope on outbound RPC (`services/xstockstrat-agent/acceptance/fix-fundamentals-signal-producer.feature`).
- **PRESERVE** `@AC-2 @FR-2 @feature-154` enumeration RPC rejects caller lacking admin scope OR allow-listed internal-caller identity (`services/xstockstrat-portfolio/acceptance/fundsignal-watchlist-universe.feature`) — see CHANGE ambiguity below.
- **PRESERVE** `@AC-10 @FR-10 @feature-183` admin RPC gates on receiver-side `x-access-scope` 0x04 (`services/xstockstrat-identity/acceptance/mcp-user-profile-roles.feature`).
- **PRESERVE** `@AC-4 @FR-5 @feature-169` ResumeAccount PERMISSION_DENIED for non-operator (`services/xstockstrat-trading/acceptance/resume-halted-account.feature`).
- **PRESERVE** `@AC-4 @FR-3 @feature-167` non-owner cannot rebind another user's watchlist (`services/xstockstrat-portfolio/acceptance/watchlist-single-strategy-update.feature`).
- **PRESERVE** `@AC-4/@AC-5 @FR-3 @feature-147` GetSecret resolves for allow-listed `x-internal-caller` / fails closed otherwise (`services/xstockstrat-config/acceptance/config-secrets-and-scoping.feature`) — see CHANGE ambiguity below.
- **PRESERVE** `@AC-2/@AC-13 @feature-147` WatchConfig stream keeps delivering (redacted) snapshots + per-user overlay (`config-secrets-and-scoping.feature`) — long-lived stream survives mTLS.
- **PRESERVE** `@AC-6 @FR-5 @feature-147` marketdata resolves vendor credential via GetSecret at startup (`services/xstockstrat-marketdata/acceptance/config-secrets-and-scoping.feature`) — startup GetSecret rides mTLS.
- **PRESERVE** `@AC-3 @FR-2/3 @feature-166` ingest resolves bearer via GetSecret with `x-internal-caller` (`services/xstockstrat-ingest/acceptance/mcp-client-signal-source.feature`).
- **PRESERVE** `@AC-2/@AC-1 @regression @feature-174` WatchConfig `client_id` prefix `ingest-`/`analysis-` (`services/xstockstrat-{ingest,analysis}/acceptance/fix-config-watcher-client-id.feature`) — app-layer client_id must NOT be conflated with/replaced by transport cert identity.
- **PRESERVE** `@AC-1/@AC-7 @feature-021` ledger ExportEvents NDJSON stream in sequence order, 1M rows without buffering (`docs/sdd/business-rules/platform.feature`); `@AC-11 @feature-021` export returns only the authed user's events (`services/xstockstrat-ledger/acceptance/ledger-event-export.feature`) — streaming + backpressure survive mTLS.
- **PRESERVE** `@AC-5/@AC-6 @feature-165` emitted alert delivered to StreamAlerts subscribers (`services/xstockstrat-notify/acceptance/pwa-notifications.feature`) — the StreamAlerts in-process delivery guarantee (NOT `@AC-4`, which is Web Push to stored endpoints; corrected at design R4).
- **PRESERVE** `@AC-2 @FR-3 @feature-042` analysis pnl_pattern_consumer rides ledger StreamEvents (`services/xstockstrat-analysis/acceptance/order-snapshots-pnl-patterns.feature`).
- **PRESERVE (cross-cutting)** `@AC-8 @feature-147` MCP_AGENT_SECRET absent from codebase/deploy (`platform.feature`) — the mTLS design must NOT reintroduce a shared inter-service secret, including as a relaxed-dev fallback.

## Dependencies

- **Proto/RPC**: none (transport-credentials layer, not the contract). No field changes.
- **Migration**: none (no schema changes).
- **Config keys**: **none over WatchConfig** for cert material / enforce flag (bootstrap constraint — see Risks). New **env vars** only (boot-time), form TBD in design; must stay distinct from the `<SERVICE>_ENDPOINT` connection vars (root CLAUDE.md env convention).
- **Inter-service edges** to secure (server + client both ends): all 10 backends serve; clients = every backend that dials (Go 3, Python ingest/analysis, Node identity→ledger, all config-watchers) + UI BFF (10 targets) + agent (9 targets). config is server-only for inbound; it self-dials nothing.
- **New env vars / ports**: e.g. per-service cert PEM + key PEM + CA bundle + enforce flag — **absent from docker-compose.yml / .do/app.dev.yaml / .do/app.yaml today**; only `DATABASE_CA_CERT` (DB TLS, unrelated) exists.

## Risks / Not-found

- **config bootstrap (F-07 tension, RESOLVED-DIRECTION):** config serves WatchConfig, so an mTLS enforce-flag/cert delivered over WatchConfig cannot secure config's own inbound channel. Cert material + enforce flag MUST be boot-time env/mounted for **every** service (precedent: `DATABASE_CA_CERT` env). This is why the config-key form is rejected for these values — not a hardcode (F-07 honored: values are external, just not via the config stream).
- **DO App Platform = env-var-only injection (no file-mount).** Mechanism must deliver PEM as env strings for prod; rules out any socket/daemonset-based mechanism (SPIRE agent, node attestation) on DO prod. Compose can bind-mount but code must accept PEM-string for parity.
- **Feature 084 coordination (fails.md:364 transport-assumption trap):** 084 (`spec-ready`) moves dev/staging to a droplet + Caddy (external-edge TLS termination for `/agent`,`/`) and tightens compose port bindings; prod stays on App Platform. Caddy is the *external* edge — orthogonal to *inter-service* mTLS — but 210 & 084 both edit `docker-compose.yml`/`.do/app*.yaml`; whichever lands second rebases, and 210's dev cert wiring must target 084's dev orchestration if 084 lands first. Re-verify at execute time.
- **No CI mesh (fails.md:369 infra-Docker trap):** no CI job brings the backend mesh up over the network; e2e mocks backends. mTLS handshake verification must use an **in-process / structural** path (build real creds, assert handshake + peer-identity in unit/integration tests within a single process or with a spawned peer), not a compose mesh. The execute sandbox has openssl + language toolchains (209 proved root+tooling) → real cert-handshake tests are runnable locally.
- **EXTEND-vs-CHANGE fork (C-16 — NEEDS USER SIGN-OFF if CHANGE):** whether the existing internal-caller gates (config GetSecret `x-internal-caller` allow-list `@AC-4/5 feature-147`; portfolio internal-caller gate `@AC-2 feature-154`) gain a verified cert check *alongside* the header (EXTEND, reject behavior unchanged) or become *contingent on* the peer cert (CHANGE — valid-header-but-wrong/absent-cert now rejects where it passed). A CHANGE requires explicit sign-off recorded in context.md.
- **client_id vs cert identity conflation** (feature-174): transport per-service cert identity is a separate mechanism from the app-layer WatchConfig `client_id` — must not replace/rename/break it.
- **StreamOrderUpdates has no C-16 guard** (trading) — must not break, but no promoted rule leans on it; call out in design/tests.
- **Not found:** any first-party `*.pem`/`*.crt`/`*.key`, `certs/`, `pki/`, cert-gen script, or file-mount field in DO specs; any existing `*_TLS_*`/`*_CERT_PATH`/mTLS-enforce env or config key.

## Recommended Scope

Advisory (input to grilling + /sdd-spec), pending the mechanism decision:

1. **Cert material + CA + convention** — self-signed platform CA + per-service leaf (CN/SAN = service name); env-string delivery form + a `scripts/gen-dev-certs.sh` for local; document the enforce/relaxed toggle env (fail-closed default). Reconcile with 084 direction.
2. **Go backends** — thread creds into `grpc.NewServer` (server) + both dial families (config-watcher + service dials) across trading/portfolio/marketdata; peer-identity verify; keep interceptors unchanged.
3. **Python backends** — server creds + `secure_channel` at all dial sites (ingest 3, analysis 7, config-watcher all 3) + peer verify; `uv lock` per service if any dep touched (grpcio already TLS-capable).
4. **Node backends** — `ServerCredentials.createSsl` + client `createSsl`/CA across config/ledger/identity/notify (config = boot-env only); update in-process test fixtures using `createInsecure`.
5. **UI BFF + agent clients** — `makeTransport()` `nodeOptions` (UI) + a shared secure-channel factory (agent, dedup client.py/auth.py); update UI e2e mock-backend to TLS.
6. **Deployment + verification** — compose anchors + `.do/app*.yaml` env (`type: SECRET` for keys), enforce=on in prod / relaxed in dev (unreachable in prod spec), in-process handshake + peer-identity + streaming-across-rotation tests.
