# Design: inter-service-mtls

**Created**: 2026-10-01
**Rounds**: 4 (full; termination: approved — open-risks accepted)
**Approved by**: user @ 2026-10-01 (design gate, after R4)
**Grounded in**: recon.md

---

## Chosen Approach

**Model B — flag-day per-service mutual TLS, no permissive mode, static per-service leaf certs from one
self-signed platform CA, delivered as boot-time env PEM strings.** Internal/platform transport change
only (C-14 None — UI and agent are touched purely as gRPC clients; no new user-visible surface).

**Mechanism.** One self-signed platform CA issues **one leaf per service** (all 10 backends + the two
pure clients `xstockstrat-ui`, `xstockstrat-agent`), each leaf carrying **both `serverAuth` +
`clientAuth` EKUs** (single leaf used in both directions) and a single DNS **SAN = registry service
name** (`xstockstrat-<svc>`). Material is delivered as three boot-time env PEM strings —
`MTLS_CERT`, `MTLS_KEY`, `MTLS_CA_CERT` — reusing the `DATABASE_CA_CERT` string-env precedent
(`.do/app.dev.yaml:327-329`, `recon.md:55`), **never over WatchConfig** (config serves WatchConfig and
cannot secure its own inbound channel with material delivered over it; `recon.md:93`). Absent material
⇒ the process fails to start (fail-closed; `recon.md:16`). **No new dependency** — grpcio ≥1.80, Go
`crypto/tls`, `@grpc/grpc-js@^1.14.4` `createSsl` all ship TLS (`recon.md:60`).

**Per-language wiring** at the recon-enumerated server-bind and dial sites; interceptors and header
propagation are untouched (C-03 / FR-5):
- **Go** (trading/portfolio/marketdata): server `grpc.Creds(credentials.NewTLS(&tls.Config{ClientAuth:
  RequireAndVerifyClientCert, ClientCAs: caPool, Certificates: [leaf]}))` at `cmd/server/main.go`
  (`recon.md:30-34`); clients `credentials.NewTLS(&tls.Config{RootCAs: caPool, Certificates: [leaf],
  ServerName: "xstockstrat-<target>"})` at both dial families (config-watcher + service dials,
  `recon.md:31-33`). **No `InsecureSkipVerify`** — native chain + SAN verification via `ServerName`.
- **Python** (indicators server-only; ingest 3 dials; analysis 7 dials; all 3 config-watchers):
  `grpc.ssl_server_credentials([(KEY,CERT)], root_certificates=CA, require_client_auth=True)` replacing
  `add_insecure_port` (`recon.md:35-37`); clients `grpc.secure_channel(target,
  grpc.ssl_channel_credentials(root_certificates=CA, private_key=KEY, certificate_chain=CERT),
  options=[('grpc.ssl_target_name_override','xstockstrat-<target>')])`.
- **Node** (config/ledger/identity/notify): `ServerCredentials.createSsl(CA, [{private_key,cert_chain}],
  true)` at the `index.ts` binds (`recon.md:42-46`); clients `credentials.createSsl(CA, KEY, CERT)` +
  `grpc.ssl_target_name_override` / `checkServerIdentity` to the target service name on the
  config-watchers and identity→ledger audit client.
- **UI BFF**: swap the single `makeTransport` choke point (`connectClients.ts:26-28`, `recon.md:47`) to
  `baseUrl: https://…` + `nodeOptions {ca, cert, key, servername|checkServerIdentity → target name}`.
- **Agent**: introduce ONE shared secure-channel factory, deduping `client.py:170` + `auth.py:35,67`
  (`recon.md:48`), pinning the authority to the target service name.

**Uniform authority pinning (the load-bearing correction).** Verification identity is pinned to the
**service name** on every client in every language — NOT left to the dialed host. The DO deploy specs
dial `${xstockstrat-<svc>.PRIVATE_DOMAIN}:<port>` (`.do/app.yaml:56-67`, `.do/app.dev.yaml:56-67`),
whose FQDN ≠ the leaf SAN; relying on dial-host==SAN (an earlier R4 proposal) would fail native SAN
matching and take down every non-Go dial in DO on cutover. Pinning the expected name to
`xstockstrat-<svc>` makes verification **env-independent** (works identically in compose, where the
dial host IS the bare name, and in DO, where it is the PRIVATE_DOMAIN FQDN) and avoids baking the
env-specific, DO-generated FQDN into a self-signed SAN.

**Rollout — flag-day, no toggle (fail-closed always).** Every server binds TLS-only and requires +
verifies the client cert; every client dials TLS presenting its leaf and verifying the server
(chain + pinned SAN). There is **no plaintext listener and no `MTLS_REQUIRE_CLIENT_CERT`-style
permissive mode** in any environment — dev runs identical full mutual mTLS with certs from a new
`scripts/gen-dev-certs.sh` (self-signed dev CA; reuses the `openssl` already in
`scripts/setup-env.sh:113-114`, `recon.md:58`). The only dev↔prod difference is *which* CA/certs load,
never *whether* verification runs. Cutover is a dependency-ordered rolling deploy (leaf→root), with the
**trading↔ledger wave deployed adjacently** and gated on the quiesce precondition below.

**Cutover safety for the fire-and-forget ledger-emit edge.** `emitLedgerEvent` (`trading.go:3482`) is
single-attempt, warn-on-error, no retry; a mid-cutover handshake mismatch drops order-lifecycle
transition events **permanently** (the DB upsert at `trading.go:1634` precedes the `go emit` at
`:1642`, and the next `pollFills` tick short-circuits at `trading.go:1620` on unchanged status).
`platform.trading_state=HALTED` blocks `PlaceOrder`/`ReplaceOrder` but does **not** stop `pollFills`
emitting on existing open-order fills — so the mitigation is a **mandatory flat-book precondition**
(verify zero open/working orders) for the trading↔ledger wave, under HALTED, set over WatchConfig
before cutover. Snapshot events (`account.positions.synced`/`account.balance.synced`,
`trading.go:2247/2263`) re-emit every sync cycle and self-heal; transition events do not — a dropped
`order.filled` leaves a gap in the feature-042 `pnl_pattern_consumer` samples that snapshots do not
backfill. This residual is **same-class-as-restart** (any trading/ledger restart drops it the same way
today, and 042 already tolerates restart gaps) and is **accepted by explicit operator sign-off**
(context.md, 2026-10-01).

**Rotation (FR-3/FR-6) — restart-only.** No language hot-reloads a live listener's credentials, so
leaf rotation is redeploy-driven; all leaves chain the same CA so a rotated peer stays trusted (no
lockstep). CA rotation ships a two-cert bundle (old+new) in `MTLS_CA_CERT` for one window, then drops
the old. Long-lived streams survive by the existing client reconnect/replay: WatchConfig (re-subscribe
→ full snapshot), ledger `StreamEvents` (`onReconnect`→replay; analysis durable DB cursor
`pnl_pattern_consumer.py`, portfolio `resume_from_sequence`), marketdata live streams self-heal.
`@AC-6`'s "no service downtime" is satisfied by reconnect-without-data-loss, not by zero restart
(explicitly recorded as an accepted interpretation).

**Rollback — flag-day with a transient refuse-window, NOT atomic.** Because there is no accept-both
server mode, a reverted-plaintext client hitting a not-yet-reverted mTLS server is refused the same
fail-closed, bounded way as the cutover window. The code+env asymmetry keeps revert safe: pre-mTLS
images ignore `MTLS_*` env (plaintext regardless), and mTLS images with absent material fail-closed —
so **reverting the image alone returns a service to plaintext; cert env is left in place**. A single
bad component is auto-contained by DO health-gated promotion (the crash-looping new version is not
promoted; last-healthy keeps serving); a systemic abort rolls the whole release back to the previous
deployment, root→leaf. **Footgun: never strip `MTLS_*` env while mTLS code is still deployed** (that
is a fail-closed crash-loop) — env removal is a separate cleanup after all code is reverted.

**Verification (no CI mesh — in-process/structural, per fails.md:369).** Per-language in-process
handshake tests build real creds from `gen-dev-certs.sh` PEMs and assert: @AC-1 (plaintext/no-TLS
client refused at the TLS layer, trio not honored); @AC-2 (mutual handshake accepted, trio honored on
the channel); **a negative-test matrix — BOTH a non-platform-CA cert AND a valid-platform-CA cert with
the wrong SAN are rejected** (the wrong-SAN case is what proves the SAN is actually checked and would
have caught the PRIVATE_DOMAIN mismatch); @AC-6 (a long-lived stream survives a rotated-leaf second
connection off the same CA — reconnect+replay, no data loss). @AC-4 (below) asserts fail-closed boot +
no verification-disabling flag. Step 6 also asserts the ledger-emit edge fails soft (`ledgerEmitTimeout`
`trading.go:3478`, no crash, no wedged goroutine), is one-shot (not re-emitted next tick), that HALTED
refuses `PlaceOrder` under mTLS, and that a snapshot event self-heals next cycle. The UI e2e
`mock-backend.ts` (3× `http2.createServer`) moves to TLS. No Python `uv.lock` change expected (grpcio
already TLS-capable; confirm per service at execute if any `pyproject.toml` is touched — fails.md:389).

## Rejected Alternatives

- **SPIFFE/SPIRE or cloud-managed CA** — rejected: DO App Platform has no file-mount/daemonset/socket
  for node attestation (`recon.md:94`); env-PEM from a self-signed platform CA is the only
  DO-compatible mechanism, and adds zero dependencies (C-18/YAGNI).
- **Per-RPC peer-SAN authorization binding (the C-16 CHANGE option)** — rejected by operator decision:
  it would make config `GetSecret` / portfolio internal-caller gates reject a valid header with a
  wrong/absent cert, a behavior change to features 147/154. Operator chose header-only gates + narrowed
  FR-2 + dropped @AC-3 instead (sign-off, context.md). A compromised service holding any platform cert
  can still forge `x-internal-caller` — documented deferred follow-up.
- **Model A — two-release `MTLS_REQUIRE_CLIENT_CERT` permissive cutover window** — rejected: a
  client-cert-optional server posture is a permissive mode in the prod spec, colliding with FR-4/@AC-4
  and unguardable by CI until the second release; its only advantage (zero failed calls on the 24/7
  ledger-emit edge) is matched operationally by the mandatory flat-book precondition.
- **Go `InsecureSkipVerify:true` + manual chain verify** — rejected: a documented fail-open footgun
  (skips ALL validation; manual re-verify is load-bearing and easy to get wrong on a security feature).
  `tls.Config.ServerName` pinning runs native chain+SAN verification and makes the helper trivially thin.
- **Dropping the client authority override (dial-host==SAN)** — rejected: DO dials PRIVATE_DOMAIN ≠ SAN
  (`.do/app*.yaml:56-67`), so native host matching fails fail-closed across DO. Uniform service-name
  authority pinning is env-independent.
- **Multi-SAN leaves including the DO PRIVATE_DOMAIN FQDN** — rejected: the FQDN is DO-generated,
  env-specific (dev≠prod), and unstable at self-signed cert-gen time; authority pinning is simpler.
- **Shared cross-service mTLS library** — rejected: the platform has zero shared cross-service libs
  today and tolerates config-watcher duplication; a per-service helper per language honors the
  self-contained-service convention (jscpd hard-block is `xstockstrat-ui`-only, `.husky/pre-commit`, so
  12 copies don't fail the gate).

## Open Risks

- [ ] **Bounded ledger-emit transition-event loss during the trading↔ledger cutover wave** (operator
  signed-off, context.md 2026-10-01) — mitigated by the mandatory flat-book + HALTED precondition; if a
  flat book is infeasible, the residual is same-class-as-restart. Blast radius: feature-042
  `pnl_pattern` samples. To be enforced in the Step-7 deploy runbook + asserted (fail-soft/one-shot) in
  Step 6.
- [ ] **connect-node `createGrpcTransport` client-cert pass-through** empirically unconfirmed — spike in
  **Step 1**; known-good fallback = native `@grpc/grpc-js` stub behind the single `makeTransport` choke
  point (`connectClients.ts:26-28`).
- [ ] **DO App Platform health-gated-promotion + rollback-to-previous-deployment semantics** are
  inferred, not verified — confirm against DO docs/console at execute; worst case is a manual prior-image
  redeploy, which the rollback story already tolerates (fails.md:364/369).
- [ ] **Feature 084 deploy-file rebase** on `docker-compose.yml` / `.do/app*.yaml` — execute-time
  coordination; re-verify 084's dev orchestration (droplet+Caddy, the *external* edge) before cutover
  (fails.md:364).
- [ ] **@AC-6 "no service downtime" is satisfied as reconnect-without-data-loss**, not zero restart —
  recorded accepted interpretation; Step 6 rotation test asserts reconnect+replay, not zero-downtime.

## Constitution Rules Touched

- `C-03` — honored: header propagation (`x-user-id`/`x-access-scope`/`x-trace-id`) and all interceptors
  are untouched; mTLS is the transport layer beneath them (FR-5).
- `C-05` / `F-07` — honored: cert material + enforce posture are external config delivered as boot-time
  env (not hardcoded in source), and are kept OFF WatchConfig by the config-bootstrap circularity, per
  the `DATABASE_CA_CERT` precedent — no hardcode, no config-stream dependency.
- `C-08` / `P-06` — honored: each code-bearing step pairs a red-before-green test meeting the service
  coverage threshold; the handshake/negative/rotation tests are the acceptance coverage.
- `C-14` — honored: internal/platform transport change; UI/agent touched only as gRPC clients, no new
  consumer surface (product-spec §Consumer Surfaces, None).
- `C-15` — honored: FR→@AC coverage after reconciliation — FR-1→@AC-1/@AC-2, FR-2(narrowed)→@AC-2 +
  the wrong-SAN negative test, FR-3→@AC-6, FR-4→@AC-4(rewritten), FR-5→@AC-5, FR-6→@AC-6; @AC-3 is
  `@descoped` (append-only, no renumber, no covering test, sign-off recorded).
- `C-16` — see below (no CHANGE to any *other* feature's durable rule; the only narrowing is to THIS
  feature's own @AC-3/FR-2, operator-signed-off).
- `C-18` — honored: least mechanism (no toggle, no shared lib, no dead SAN-authz helper); trade-offs
  (single leaf both directions, per-service helpers, bounded-loss residual) recorded here.
- `F-02`/`F-03` — honored: feature branch `feature/inter-service-mtls` from main-dev; PRs target main-dev.
- `F-04` — honored: every path/symbol cited from recon digests; unknowns (DO rollback primitive,
  connect-node pass-through) are Open Risks, not guesses.
- `F-11` — no Floor breach flagged in any of the 4 rounds.

## Business Rules Touched (C-16)

No existing *other-feature* durable rule is changed (features 147/154 internal-caller gates stay
byte-identical — EXTEND-not-CHANGE). The only narrowing is to this feature's own acceptance scope,
operator-signed-off.

- PRESERVE `@AC-4/@AC-5 @feature-147` (config `GetSecret` allow-list + fail-closed) — not regressed:
  gates stay header-only; mTLS only wraps the transport.
- PRESERVE `@AC-2 @feature-154` (portfolio internal-caller gate) — not regressed: gate unchanged.
- PRESERVE `@AC-2/@AC-13 @feature-147` (WatchConfig stream delivery), `@AC-1/@AC-7/@AC-11 @feature-021`
  (ledger ExportEvents/StreamEvents streaming + auth scoping), `@AC-5/@AC-6 @feature-165` (notify
  StreamAlerts delivery), `@AC-2 @feature-042` (analysis pnl consumer on StreamEvents),
  `@AC-6 @feature-147` (marketdata startup GetSecret) — streams reconnect/replay across mTLS;
  startup GetSecret rides mTLS (cert-present precondition enforced by deploy ordering).
- PRESERVE `@AC-3 @FR-1 @feature-179`, `@AC-8 @feature-156`, agent propagation suites — the forwarded
  trio is unchanged.
- PRESERVE `@AC-2/@AC-1 @regression @feature-174` (WatchConfig `client_id` prefixes) — the transport
  cert identity is a separate mechanism and does not replace the app-layer `client_id`.
- CHANGE (THIS feature's own scope only) `@AC-3 @feature-210` + FR-2 — descoped/narrowed from per-RPC
  identity-scoped authorization to native chain+SAN mutual-handshake verification; signed off by user
  @ 2026-10-01 (context.md). No durable cross-feature rule is altered.
