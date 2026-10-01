# Context: inter-service-mtls

**Feature**: `docs/roadmap/features/210-inter-service-mtls/feature.md`
**Product Spec**: `docs/roadmap/features/210-inter-service-mtls/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/210-inter-service-mtls/implementation-spec.md`

---

## Session 2026-09-25 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- **Provenance**: audit design ticket **DT-3** (Medium) from the 2026-09-16 security audit
  (`docs/reports/2026-09-16-trading-system-security-audit.md`, §153): all inter-service gRPC is
  plaintext h2c with no mTLS (Go `insecure.NewCredentials`, Python/Node equivalents); the audit's
  recommendation is "mTLS (or a signed, short-lived service-identity token) between backends so the
  header-trust boundary is anchored in cryptographic service identity." Also referenced from the M-list
  "no mTLS/header-trust posture."
- **Why it matters**: the header-propagation convention (root CLAUDE.md) treats `x-user-id` /
  `x-access-scope` / `x-trace-id` as trusted platform-internal after the edge injects/strips them. That
  trust rests on network privacy alone — mTLS re-anchors it to authenticated service identity (FR-2/
  FR-5). This is the transport-auth layer beneath the existing propagation, not a replacement.
- **Largest-blast-radius of the Phase D set**: touches all 10 backend gRPC servers, both gRPC clients
  (UI BFF + agent), and the deployment topology (docker-compose + `.do/app*.yaml` + cert material).
  Expect a full (not `quick`) `/sdd-design` and a phased, no-flag-day rollout (see product-spec §
  Open Questions: permissive interim mode).
- **Standalone**: no dependency on features 207/208/209/214. The agent DB-tooling remediation (feature
  214 `remove-agent-postgres-mcp`, which superseded demoted feature 212 `sysadmin-db-write-role`,
  formerly 193) explicitly scoped "inter-service mTLS (DT-3)" out as a separate design ticket.
- Created for pickup by another session per operator direction (Phase D security backlog).

## Session 2026-09-30 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Verdict: PASS (0 warnings) on re-review. First pass PASSed 10/11 criteria + all trading-domain
  checks; sole blocker was criterion 9 (five unchecked `- [ ]` Open Questions).
- Fix applied pre-advance: reframed `## Open Questions` → `## Design-Phase Decisions (deferred to
  /sdd-design)` — all items `[x]` with resolution pointers. These are genuine architecture forks
  (FR-3 itself names its mechanism "a design decision"), surfaced not silently guessed (P-03).
  A sixth item folds in the feature-084 deployment-file coordination note.
- Code-checkable claims all verified: 12 service names vs Service Registry, `xstockstrat-trading:50051`,
  4 streaming RPCs (StreamOrderUpdates/StreamEvents/WatchConfig/StreamAlerts), audit report path,
  env-var `<SERVICE>_ENDPOINT` convention, no proto/DB changes.
- Overlap findings: no FAIL-level collision (no proto-field / migration-NNN / duplicate-config-key).
  Soft rebase-level same-file overlap with feature 084 (`droplet-compose-deploy`) on
  `docker-compose.yml` / `.do/app.yaml` / `.do/app.dev.yaml`, and with (already-merged) 214 on the
  agent block — disjoint regions, rebase-only. No blocking merge-order row required; recorded as a
  design-agenda coordination note.
- F-07 tension flagged for design: an mTLS enforce-toggle served over WatchConfig would read config
  over the very channel mTLS secures — design must source the enforce flag + cert material outside
  the config stream (env/mounted).
- Branch `feature/inter-service-mtls` created from `main-dev` for this and subsequent phases.

## Session 2026-10-01 — sdd-design (Phase 0 recon + Phase 1 debate, 4 rounds full)

- Phase 0 Recon: wrote recon.md from 7 discovery passes (Go/Python/Node backends, UI BFF, agent,
  deployment, scenario-recon C-16). Key reuse patterns: env-PEM string cert delivery (DATABASE_CA_CERT
  precedent), compose `x-common-env` anchor, boot-time env read (not WatchConfig), single UI
  `makeTransport` choke point, grpcio/grpc-js/Go-stdlib built-in TLS (no new dep).
- Phase 1 Grilling: 4 rounds (full). **Chosen: Model B** — flag-day per-service mutual TLS, no
  permissive/toggle mode; static per-service leaf from one self-signed platform CA; env-PEM boot-time
  (`MTLS_CERT`/`MTLS_KEY`/`MTLS_CA_CERT`); fail-closed; native chain+SAN verify with client authority
  **pinned to the service name uniformly** (env-independent); single leaf both-EKU; restart-only
  rotation (reconnect/replay); leaf→root cutover, trading↔ledger adjacent under a mandatory
  flat-book+HALTED precondition; rollback = flag-day-with-transient-window via code+env asymmetry
  (never strip cert env). Rejected: SPIRE/cloud-CA (DO no-mount), per-RPC SAN authz (C-16 CHANGE),
  Model A permissive window (FR-4/@AC-4 collision), Go InsecureSkipVerify (fail-open footgun),
  dial-host==SAN (DO PRIVATE_DOMAIN≠SAN), multi-SAN-of-FQDN, shared mTLS lib.
- Constitution rules touched: C-03/C-05/C-08/C-14/C-15/C-16/C-18, F-07 (honored — env not WatchConfig),
  F-02/F-03/F-04. **No Floor breach.**

### DECISIONS & OPERATOR SIGN-OFFS (this session, via AskUserQuestion)

1. **C-16 identity-gate fork → "Keep header-only, narrow scope"** (operator sign-off, 2026-10-01).
   Features 147/154 `x-internal-caller` gates stay byte-identical (no C-16 cross-feature CHANGE).
   THIS feature's `@AC-3` is **descoped** (per-RPC identity ACL not built) and **FR-2 narrowed** to
   native chain+SAN mutual-handshake verification. Accepted residual: a compromised service holding any
   platform leaf can still forge `x-internal-caller` (documented follow-up). Reconciled in
   product-spec.md (FR-2), acceptance.feature (`@AC-3 @descoped`, no covering test; `@AC-4` rewritten
   for Model B), feature.md Security reviewer row.
2. **Rollout → "No permissive; release-ordered" then → Model B flag-day, no toggle** (operator, across
   gates). No plaintext path in any environment; dev runs full mTLS with gen-dev-certs.
3. **DO re-origination → confirmed internal_ports = L4 raw TCP, no TLS termination** (WebSearch +
   DO docs). Mechanism works on App Platform prod; does NOT depend on feature 084's droplet.
4. **Bounded ledger-emit transition-event loss during cutover → operator sign-off** (2026-10-01).
   `emitLedgerEvent` (trading.go:3482) is fire-and-forget/no-retry; HALTED does not stop `pollFills`
   emitting on open-order fills → a **mandatory flat-book precondition** gates the trading↔ledger wave.
   Residual is same-class-as-restart (042 pnl consumer already tolerates restart gaps). Enforced in the
   Step-7 deploy runbook; asserted fail-soft/one-shot in Step 6.

### Round-by-round adversary catches (durable)

- R1: EXTEND fails this feature's own `@AC-3` — the `x-internal-caller` gates authorize on the forgeable
  header; handshake-only peer auth leaves the DT-3 impersonation hole open. → operator narrowed scope.
- R3: Go `InsecureSkipVerify:true` disables ALL validation (not just hostname) → silent fail-open on a
  security feature. → `tls.Config.ServerName` native chain+SAN verify instead.
- R4: **DO deploy specs dial `${xstockstrat-<svc>.PRIVATE_DOMAIN}:<port>` ≠ leaf SAN** (verified
  `.do/app.yaml:56-67`, `.do/app.dev.yaml:56-67`). Dropping the client authority override would fail
  native SAN matching across every non-Go dial in DO → platform-wide outage on cutover. → **uniform
  service-name authority pinning** in all languages (Go ServerName / Python+Node
  `ssl_target_name_override` / UI connect-node authority). Load-bearing correction.

### Open Risks carried to /sdd-spec + /sdd-execute (see design.md §Open Risks)

- Bounded ledger-emit loss (signed-off) — Step-7 flat-book gate + Step-6 fail-soft/one-shot assert.
- connect-node `createGrpcTransport` client-cert pass-through — spike in Step 1, grpc-js stub fallback.
- DO health-gated-promotion + rollback-to-previous-deployment semantics — verify at execute.
- Feature 084 deploy-file rebase — execute-time coordination (external-edge Caddy is orthogonal).
- `@AC-6` "no service downtime" satisfied as reconnect-without-data-loss, not zero restart.
- Negative-test matrix MUST include valid-CA/wrong-SAN rejection (the test that catches the R4 bug class).

- Status: spec-ready → design-approved.

## Session 2026-10-01 — sdd-spec

- Generated implementation-spec.md with **14 steps**. Status → implementation-ready.
- Structure (Model B): Step 1 cert foundation (`scripts/gen-dev-certs.sh` self-signed CA + 12 leaves,
  both EKUs, SAN=service name) + connect-node client-cert spike resolved here; Steps 3/5/7 per-language
  server-bind + client-dial swaps (Go / Python / Node), each with a paired in-process handshake test
  (4/6/8); Steps 9–12 UI BFF + agent clients; Step 13 deployment env wiring + repo-wide no-plaintext
  structural assert; Step 14 rolling-cutover runbook + Teardown.
- **Discovery beyond recon (the one real divergence):** recon.md:50 said the agent has "2 channel
  sites". Ground truth is **69 inline `grpc.aio.insecure_channel(...)` sites — 67 in `app/client.py`
  (170…2355) + 2 in `app/auth.py:35,67`** — every tool method opens its own per-call channel, no shared
  helper today. Step 11's factory refactor sweeps all 69. Recon's other path:line citations all verified
  accurate (Go trading/portfolio/marketdata, Python ingest/analysis/indicators, Node config/ledger/
  identity/notify, UI `makeTransport`, DO `PRIVATE_DOMAIN` dials, `DATABASE_CA_CERT` precedent).
- Key codebase findings (grep-confirmed):
  - Go server binds add `grpc.Creds` at `trading/cmd/server/main.go:127`, `portfolio:78`,
    `marketdata:155`; dials swap `insecure.NewCredentials()` at `trading/internal/service/trading.go:180,184,188,192`,
    `portfolio_service.go:109,113,117`, `marketdata_service.go:142,146` + the 3 config-watchers.
  - Python: `add_insecure_port` → `add_secure_port` at `indicators/app/main.py:74`, `ingest:100`,
    `analysis:88`; `insecure_channel` → `secure_channel(..., ssl_target_name_override)` at ingest 3 /
    analysis 7 dials + 3 config-watchers. **Do NOT touch** the asyncpg DB-TLS `_ssl_ctx` at
    `ingest/app/main.py:49-58` (Postgres, not gRPC).
  - Node: `ServerCredentials.createInsecure()` → `createSsl(...true)` at `config/src/index.ts:52-54`,
    `ledger:59-61`, `identity:54-56`, `notify:52-54`; clients at the 3 `configWatcher.ts:27` + identity
    `ledgerAudit.ts:34`. config is server-only (no self-dial).
  - UI single choke point `connectClients.ts:26-28` `makeTransport`; e2e mock `mock-backend.ts`
    `http2.createServer` ×3 (`:668/1263/1384`) → `createSecureServer`.
  - Deployment: `MTLS_*` absent from all 3 files; reuse compose `x-common-env:&common-env`
    (`docker-compose.yml:15`) for the shared CA; `DATABASE_CA_CERT` env-string precedent
    (`.do/app.dev.yaml:327-329`); `type: SECRET` precedent (`.do/app.yaml:38,82,…`) for `MTLS_KEY`.
  - No `scripts/gen-dev-certs.sh` exists; `openssl` already in `scripts/setup-env.sh:113-114`.
- AC coverage (C-15): @AC-1/2/4/5 across Go/Python/Node test steps (4/6/8), @AC-6 (rotation) in the Node
  ledger/config test (Step 8), @AC-4 UI slice in Step 10 + repo-wide structural in Step 13. @AC-3 is
  `@descoped` — no covering step, exempt per the sign-off note. All non-descoped scenarios covered.
- Ledger reuse applied: no-CI-mesh → in-process/structural handshake tests (fails.md:369); grpcio
  already TLS-capable, `uv lock` only if `pyproject.toml` touched (fails.md:389); feature-084 deploy-file
  rebase flagged in Steps 13–14 (fails.md:364); Teardown-not-discharged-by-a-note enforced in Step 14
  (fails.md:670).

## Session 2026-10-01 — sdd-review impl-spec (advisory)

- Result: 0 failures, ~3 advisory warnings (advisory — did not block). No Floor (F-*) risk; F-07, F-02, F-03 all cleared. Criteria PASS WITH WARNINGS; every spot-checked path:line citation resolves (incl. 69-site agent count 67+2, negative-test matrix with BOTH wrong-CA and valid-CA/wrong-SAN in Steps 4/6/8, @AC-3 @descoped).
- Unresolved ✗ / ⚠ carried into execution:
  - Steps 1/3/5/7/9/11: introduce/consume `MTLS_CERT`/`MTLS_KEY`/`MTLS_CA_CERT` while only Step 13 lists all three deploy files — [x] addressed-by-design (wire-once-at-Step-13, recorded in spec `## Step Dependencies`; raising per-step would be noise).
  - Steps 3/5/7/14: brace-shorthand helper paths (`<trading|portfolio|marketdata>` etc.) and "each affected service's CLAUDE.md" are enumerable, not literal single paths — [x] acknowledged (clear/enumerable; each brace = 3 concrete files resolved by per-step discovery).
  - Step 12 (agent factory test): no `**Covers**` field / no coverage threshold — [x] justified (agent absent from the coverage-threshold table; all @ACs covered by Steps 4/6/8/10/13; Step 12 is a supplementary sweep-guard).
- Overlap findings: zero FAIL-class (no proto-field / migration-NNN / config-key clash — 210 adds none). Rebase-class file overlaps only: 214 (code-completed, disjoint agent POSTGRES_MCP removal), 084 (spec-ready, wholesale deploy-file restructure — **re-verify at execute per spec Steps 13-14 / fails.md:364**; 084 furthest from landing so 210 likely lands first), 217 (implementation-ready, disjoint regions in marketdata main.go/service + agent client.py). No merge-order.md row required.

## Session 2026-10-01 — sdd-execute (sequential) — Steps 1-2

### Step 1 — service: Platform CA + dev-cert generator + connect-node spike [done]
- Created `scripts/gen-dev-certs.sh` (self-signed dev CA + 12 per-service leaves, SAN=service name, serverAuth+clientAuth EKUs, `--rotate <svc>` mode for @AC-6), `docs/patterns/inter-service-mtls.md` (env contract + authority-pinning convention + spike result), wired the generator into `scripts/localenv-setup.sh`, git-ignored `certs/`.
- **connect-node spike RESOLVED**: `createGrpcTransport` nodeOptions = `http2.SecureClientSessionOptions` → client cert passes through natively; grpc-js fallback not needed (Deviation Log).
- Files modified: `scripts/gen-dev-certs.sh`, `scripts/localenv-setup.sh`, `docs/patterns/inter-service-mtls.md`, `.gitignore`
- Deviations: `.gitignore` instruction-mandated but off the Files list (Deviation Log, F-08 transparency).
- TDD: AC-foundation red (`gen-dev-certs.sh missing`, exit 1) → green (Step 2 test passes; cert chains, SAN=name, both EKUs, 12 dirs).

### Step 2 — test: Cert-gen chain + SAN + EKU structural assertions [done]
- Created `scripts/gen-dev-certs.test.sh`: chain-to-CA, SAN=bare service name (not FQDN), both EKUs, and the wrong-CA negative half (foreign-CA leaf rejected) — the foundation for the Steps 4/6/8 negative matrices.
- Files modified: `scripts/gen-dev-certs.test.sh`
- Deviations: none.
- TDD: red (generator absent) → green (`all assertions passed`, exit 0).

### Step 3 — service: Go backends mutual TLS [done]
- Added `internal/mtls/mtls.go` to trading/portfolio/marketdata (`ServerConfig` = RequireAndVerifyClientCert+ClientCAs; `ClientConfig(target)` = RootCAs+leaf+ServerName pinned to the target service name; loads MTLS_CERT/KEY/CA_CERT from env, fail-closed; no InsecureSkipVerify). Swapped all server binds (`grpc.Creds`) + every client dial (config-watcher + service dials) from `insecure.NewCredentials()` to the mtls creds; removed the `credentials/insecure` imports.
- Files: trading/portfolio/marketdata ×{cmd/server/main.go, internal/config/config.go, internal/service/*.go, internal/mtls/mtls.go}.
- Verification: all 3 build clean (`go build ./...`), zero `insecure.NewCredentials`/`InsecureSkipVerify` in runtime code, gofmt+vet clean. golangci-lint deferred to CI (Deviation Log — local v2.5.0 is go1.25, repo targets go1.27).
- TDD: structural red (pre-Step-3 there is no `mtls` package and the servers used `insecure`, which accepts any/no client cert → the @AC-1/negative-matrix assertions fail-open and the tests don't compile) → green (Step 4).

### Step 4 — test: Go in-process handshake + negative matrix + propagation + ledger-emit fail-soft [done]
- `internal/mtls/mtls_test.go` (×3, in-process bufconn handshake, certs minted in-test): @AC-4 fail-closed boot, @AC-2 mutual handshake, @AC-5 trio propagation over the authenticated channel, @AC-1 plaintext refused, negative matrix (wrong-CA rejected + valid-CA/**wrong-SAN** rejected — the R4 bug-class guard). `internal/service/ledger_emit_mtls_test.go` (trading): emitLedgerEvent fail-soft (no crash/wedge on a failing ledger) + one-shot (exactly 1 AppendEvent, no retry).
- Files: trading/portfolio/marketdata ×internal/mtls/mtls_test.go; trading/internal/service/ledger_emit_mtls_test.go.
- Verification: 5/5 mtls tests green ×3 services + ledger-emit test green; mtls package coverage ServerConfig/ClientConfig 100%, load 83.3%. Full `go test ./...` coverage mesh needs a DB (repository tests) — CI-equivalent fallback (Deviation Log).
- Covers: @AC-1, @AC-2, @AC-4, @AC-5.

### Step 5 — service: Python backends mutual TLS [done]
- Added `app/mtls.py` to indicators/ingest/analysis (`server_credentials` = ssl_server_credentials require_client_auth=True; `channel_credentials` = ssl_channel_credentials; `target_override` = ssl_target_name_override pinned to the target service name). Swapped `add_insecure_port`→`add_secure_port` (3 servers), every `insecure_channel`→`secure_channel`+creds+override (ingest 3 dials, analysis 7 dials, all 3 config-watchers). Per-method propagation untouched (FR-5). Left the ingest asyncpg DB-TLS `_ssl_ctx` block alone (Postgres, not gRPC).
- Files: indicators/ingest/analysis ×{app/main.py, app/config/watcher.py, app/mtls.py}.
- Verification: ruff check+format clean ×3; zero insecure_channel/add_insecure_port in source. No pyproject change → no uv.lock change.
- TDD: structural red (no app.mtls + insecure transport pre-Step-5) → green (Step 6).

### Step 6 — test: Python in-process handshake + negative matrix + propagation [done]
- `tests/test_mtls.py` ×3 (openssl-minted CA+leaves in a fixture, in-process grpc.aio handshake over a generic echo method): @AC-4 fail-closed, @AC-2 mutual handshake, @AC-5 trio propagation, @AC-1 plaintext refused, negative matrix (wrong-CA + wrong-SAN rejected).
- Files: indicators/ingest/analysis ×tests/test_mtls.py.
- Verification: 5/5 green ×3 (via each service's `.venv/bin/python -m pytest`). Full `pytest --cov` suite deferred to CI (needs a DB — Deviation Log).
- Covers: @AC-1, @AC-2, @AC-4, @AC-5.

### Step 7 — service: Node backends mutual TLS [done]
- Added `src/mtls.ts` to config/ledger/identity/notify (`serverCredentials` = ServerCredentials.createSsl(ca,[{private_key,cert_chain}],true); `clientCredentials` = credentials.createSsl(ca,key,cert); `targetOverride` = {'grpc.ssl_target_name_override': target}). Swapped all 4 `bindAsync` server creds to mtls.serverCredentials(); swapped the 3 wired config-watchers + config's dead copy + identity→ledger ledgerAudit.ts client creds to mtls.clientCredentials()+targetOverride. Streaming handlers + ledgerAudit PROPAGATED_HEADERS untouched.
- Files: config/ledger/identity/notify ×{src/index.ts, src/mtls.ts}; ledger/identity/notify/config src/services/configWatcher.ts; identity src/grpc/ledgerAudit.ts.
- Verification: tsc --noEmit clean ×4; eslint pass ×4 (only pre-existing no-explicit-any warnings, not in mtls.ts); zero createInsecure in non-test runtime code.

### Step 8 — test: Node in-process handshake + negative matrix + propagation + rotation (@AC-6) [done]
- `src/__tests__/mtls.test.ts` ×4 (openssl-minted CA+leaves, in-process grpc-js handshake over a generic echo method): @AC-4 fail-closed, @AC-2 mutual handshake, @AC-5 trio propagation, @AC-1 plaintext refused, negative matrix (wrong-CA + wrong-SAN). ledger adds @AC-6: a rotated leaf off the same CA is accepted (reconnect-with-rotated-cert).
- **Per-service test-runner split (recorded):** config+notify run `tsc && node --test dist/*.js` (compiled → extensionless `../mtls` import); ledger+identity run `node --experimental-strip-types --test src/*.ts` (raw .ts → explicit `../mtls.ts` import, matching the existing `../telemetry.ts` convention). Using the wrong extension for a service's runner is ERR_MODULE_NOT_FOUND under strip-types.
- Files: config/ledger/identity/notify ×src/__tests__/mtls.test.ts.
- Verification: config 5/5, notify 5/5, ledger 6/6 (+rotation), identity 5/5 — all green (locally on Node 22; the compiled runners + explicit-.ts strip-types imports both work on Node 22). Full `pnpm run test:coverage` deferred to CI (needs DB — Deviation Log).
- Covers: @AC-1, @AC-2, @AC-4, @AC-5, @AC-6.

### Step 9 — service: UI BFF mutual TLS through makeTransport + e2e mock to TLS [done]
- `connectClients.ts`: `makeTransport(endpoint, targetService)` now builds `createGrpcTransport({ baseUrl: 'https://'+endpoint, nodeOptions: { ca, cert, key, checkServerIdentity → checkServerIdentity(targetService, peer) } })`. `loadMtls()` reads MTLS_CERT/KEY/CA_CERT env, fail-closed. All 10 `createClient` sites pass their destination service name (env-independent authority pin — DO PRIVATE_DOMAIN ≠ SAN). Dropped `httpVersion` (not a GrpcTransportOptions key; gRPC is inherently h2).
- `e2e/mock-backend.ts`: the 3 `http2.createServer` → `http2.createSecureServer(tlsOptions(), …)`; `tlsOptions()` (exported) = { ca, cert: mockCert, key: mockKey, requestCert: true, rejectUnauthorized: true } from `devCerts()`. Server-var union widened to `Http2Server | Http2SecureServer`.
- `e2e/helpers/devCerts.ts` (new): per-run openssl-minted CA + UI client leaf + a **multi-SAN mock server leaf** (SANs = all 10 backend service names). Memoized so playwright.config.ts (BFF client env) and the in-process mock share one CA. No committed private keys.
- `playwright.config.ts`: `webServer.env` gains MTLS_CERT/KEY/CA_CERT = UI leaf + CA from `devCerts()`.
- **Design fork resolved**: one mock port fronts ≤6 services, so a single-SAN leaf can't satisfy a per-service authority pin. The mock presents a superset-SAN leaf; the SAME production `checkServerIdentity(target)` pin passes in both prod (own single-SAN leaf) and e2e (superset) — the real verification path is exercised, not bypassed.
- Verification: `pnpm run lint` clean (only pre-existing react-hooks warnings, none in changed files); `grep createSecureServer` = 3; `grep http://` in connectClients = 0; `tsc --noEmit` clean on all changed files (3 pre-existing errors in untouched test files remain).

### Step 10 — test: UI BFF mTLS handshake contract + plaintext/no-cert/wrong-pin refused (@AC-4) [done]
- `e2e/mtls-transport.spec.ts` (new): stands up `http2.createSecureServer(tlsOptions())` (the real mock TLS config) and, with the same `devCerts()` material + the same nodeOptions shape makeTransport builds, asserts: mTLS client pinned to a served SAN handshakes (200); a plaintext client is refused; a client with no client cert is refused (mutual auth required); pinning to an unserved name is rejected (the pin is real).
- **TDD red-green captured**: reverting the mock to its pre-Step-9 plaintext `http2.createServer` → the mTLS-handshake and plaintext-refused assertions FAIL; secure → all 4 PASS (8.2s). Non-vacuous.
- Covers: @AC-4 (UI slice — verification cannot be disabled).
- Verification: ran via a webServer-less temp config `npx playwright test` → 4/4 green. The full `pnpm test:e2e` harness (Next build + Chromium) is CI-deferred (Deviation Log) — the transport contract needs no browser or Next build and was run standalone.

### Step 11 — service: Agent single shared secure-channel factory across all dial sites [done]
- `app/mtls.py` (new): `secure_channel(endpoint, target_service)` → `grpc.aio.secure_channel(endpoint, channel_credentials(), options=[('grpc.ssl_target_name_override', target_service)])`; `channel_credentials()` = `grpc.ssl_channel_credentials(root_certificates=ca, private_key=key, certificate_chain=cert)`; `_load()` reads MTLS_CERT/KEY/CA_CERT, raises RuntimeError if any absent.
- Mechanical sweep: all **69** `grpc.aio.insecure_channel(<X>_ENDPOINT)` → `mtls.secure_channel(<X>_ENDPOINT, "xstockstrat-<svc>")` (client.py ×67, auth.py ×2) via per-endpoint sed, 1:1 endpoint→service mapping. Added `from app import mtls` to both. `async with … as channel:` structure + per-call propagation metadata preserved (all sites were single-arg, no options to merge).
- **Minor deviation from spec wording**: the spec said "load MTLS_* at import"; the factory loads at *call* (`_load()` inside each factory), mirroring the 3 backend Python `app/mtls.py` exactly — same fail-closed guarantee (first channel creation raises), and it keeps the module importable under pytest without global MTLS_* env (Step 12 asserts the absent-env raise cleanly). Recorded in Deviation Log.
- Verification: `ruff check` + `ruff format --check` clean on mtls.py/client.py/auth.py; `grep -c insecure_channel` = 0 and 0; py_compile OK.

### Step 12 — test: Agent secure-channel factory pins authority; no insecure path remains [done]
- `tests/test_mtls.py` (new): spies `grpc.aio.secure_channel` to assert the factory pins `ssl_target_name_override` to the TARGET SERVICE NAME (dialed host `10.0.0.5:50051` ≠ service `xstockstrat-trading`); builds real `ChannelCredentials` from openssl-minted env PEMs; raises RuntimeError when MTLS_* absent; structural guard asserts no `insecure_channel` remains in client.py/auth.py.
- **TDD red-green captured**: with app/mtls.py hidden + the sweep reverted → ImportError, collection fails (RED); restored → 4/4 pass (GREEN).
- Verification: `uv run pytest tests/test_mtls.py` → 4 passed; ruff clean. Full `pytest --cov=app --cov-fail-under=40` deferred to CI (Deviation Log — the agent suite needs the full app import graph / fixtures; the new unit+structural tests were run directly).

### Step 13 — service: cert env wired into all deployment files + repo-wide no-plaintext assert [done]
- `docker-compose.yml`: `MTLS_CA_CERT: ${MTLS_CA_CERT:-}` added to the `x-common-env` anchor (shared public CA); each of the 12 app services gets `MTLS_CERT: ${<SVC>_MTLS_CERT:-}` + `MTLS_KEY: ${<SVC>_MTLS_KEY:-}` (per-service leaf). Soft `:-` defaults keep `docker compose config` parseable; fail-closed still holds (empty env → service crash-loops at boot). Validated: `docker compose config` parses, 37 MTLS refs resolved.
- `.do/app.dev.yaml` + `.do/app.yaml`: 3 MTLS env entries (`MTLS_CA_CERT`, `MTLS_CERT`, `MTLS_KEY` with `type: SECRET`) added to every one of the 12 application components, DEV/PROD placeholder values per the files' `YOUR_*` templating convention. No endpoint (`_ENDPOINT`) churn — DO still dials `${<svc>.PRIVATE_DOMAIN}:<port>`, authority pinned to the service name in code. Both specs parse (yaml.safe_load).
- `scripts/mtls-dev-env.sh` (new): sources the per-service PEMs from `./certs/` into the shell env vars compose interpolates (compose's .env parser can't carry multiline PEM; shell-env interpolation can). Verified end-to-end: gen-dev-certs → source → TRADING/AGENT/CA vars set.
- **Repo-wide @AC-4 no-plaintext sweep (GREEN)**: zero `insecure.NewCredentials`/`InsecureSkipVerify` in Go; zero `insecure_channel`/`add_insecure_port` in Python source (the one grep hit was stale git-ignored `__pycache__` bytecode + the mtls.py docstring, not a call); zero `createInsecure` in Node non-test `src/`.
- **TDD red-green (structural)**: before this step the three deploy files had zero MTLS_* (0/0/0); after, 26 / 72 / 72. No-plaintext sweep green.
- Covers: @AC-4 (cross-cutting — no plaintext/verification-disabling path anywhere).

### Step 14 — docs: rollout runbook + env convention + per-service CLAUDE.md + Teardown [done]
- `docs/runbooks/inter-service-mtls-rollout.md` (new): cert-material contract recap, leaf→root dependency-ordered flag-day cutover, the **trading↔ledger flat-book + HALTED precondition** (how to verify a flat book + why — the fire-and-forget emitLedgerEvent transition-event loss, operator sign-off), DO health-gated-promotion assumption + manual fallback, restart-only leaf rotation, two-cert CA-bundle overlap rotation, @AC-6 reconnect-not-zero-restart, and image-revert rollback with the never-strip-env footgun.
- `docs/patterns/inter-service-mtls.md`: finalized — dropped the non-existent `httpVersion` connect-node option (matches shipped Step 9 code), documented the `scripts/mtls-dev-env.sh` source-then-up dev flow.
- Root `CLAUDE.md`: added the Environment Variable Naming bullet — MTLS_CERT/KEY/CA_CERT are a boot-time cert-material class, NOT a `<SERVICE>_ENDPOINT` connection var (no suffix), fail-closed, MTLS_KEY is SECRET.
- 12 service `CLAUDE.md` (all backends + ui + agent): added a standard mTLS boot-env note (server-flavored for the 11 backends/ui, client-flavored for the agent).

### Teardown — context reconciliation (context-constitution refresh)
- The `/context-forge:context-constitution refresh` skill IS installed, but it is a multi-gate interactive skill (AskUserQuestion gates + repo-wide subagent scans) incompatible with this session's standing "no more checkpoints" unattended directive. Per the root CLAUDE.md Teardown rule, discharged the **equivalent real reconciliation by hand** (not a bare note):
  - Swept every context file (`docs/context-constitution*.md`, `services/*/docs/context-constitution*.md`, service `CLAUDE.md`, header-propagation/docker-build pattern docs) for claims feature 210 falsifies.
  - **Fixed 3 grounded-drift sites**: (1) root `docs/context-constitution.md` **PLAT-N3** "Internal gRPC is plaintext" → rewritten to "Internal gRPC is mutual TLS" (kept the still-true keepalive/GOAWAY/benign-reconnect norm, re-cited to the mtls modules); (2) `services/xstockstrat-agent/docs/context-constitution.md` **AGENT-1** `insecure_channel` → `mtls.secure_channel` (connect-per-call shape unchanged); (3) its pointer row likewise.
  - **Deliberately left unchanged**: `docs/reports/2026-09-16-trading-system-security-audit.md` — a DATED point-in-time report (the audit that motivated feature 210); dated reports are immutable historical snapshots, not drift.
  - No per-service backend constitution asserted plaintext transport (they document propagation/keepalive, not credentials), so no further edits. This reconciliation is recorded in the integration PR body per fails.md:670.

## Session 2026-10-01 (CI: feature status automation)

- Promotion PR #1205 merged to main
- Feature promoted and committed: 27f3f276b39fa79d07b4de6c023582f72539aac3
- Status updated: `code-completed` → `launched`
- Launched date: 2026-10-01
