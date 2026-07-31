# Design: droplet-compose-deploy

**Created**: 2026-07-31
**Rounds**: 5 (full; termination: approved at hard cap)
**Approved by**: user @ 2026-07-31
**Grounded in**: recon.md

---

## Chosen Approach

### 1. Core deployment mechanism — single-stack rolling restart, not blue/green

The droplet runs **one** Compose project of the existing `docker-compose.yml` (no dual stacks). A
deploy script SSHes in, `docker compose pull`s changed services, then restarts each with plain
`docker compose up -d <service>` (stop-then-start recreate, **zero old/new container overlap**) in
dependency order (`config → ledger → identity/notify → marketdata → indicators/ingest/analysis/
portfolio/trading → ui/agent`), the order `depends_on` already encodes (`docker-compose.yml`, per
recon.md). Blue/green (two full Compose projects swapped via Caddy's admin API) was proposed in
round 1 and **rejected**: it would transiently hold ~40 DB connections against the repo's hard
20-connection budget (root `CLAUDE.md` § Connection Pool Budget) — a Floor breach (**F-06**), since
both stacks' pools would be open simultaneously during every swap. No-overlap recreate satisfies
F-06 by construction. The user explicitly accepted the tradeoff (a brief per-service restart gap
instead of atomic zero-downtime) after being shown the DB-pool math.

**Caddy** joins the compose network as a 13th service, doing TLS termination + two static
`reverse_proxy` routes only (`/agent` → `xstockstrat-agent:9000`, `/` → `xstockstrat-ui:3000`) — no
admin API, no dynamic upstream swapping, since there's only ever one upstream per path. To close the
gap round 3's adversary found (restart ordering alone doesn't mitigate the connection-refused window
during `ui`/`agent`'s own restart, since Caddy fronts nothing else), the Caddyfile adds
`lb_try_duration 10s` on both routes so Caddy retries a connection-refused request against the same
upstream instead of failing immediately.

### 2. Database — DO Managed Postgres unchanged, `DATABASE_URL` parameterized

FR-4 (DB stays on the existing DO Managed Postgres cluster, no self-hosted TimescaleDB on the
droplet) is honored by parameterizing `x-db-url`'s previously-hardcoded anchor
(`docker-compose.yml:22-23`) via four new env vars: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_SSLMODE`
(droplet's `.env` sets `sslmode=require` per `docs/setup/digitalocean.md:173`; local dev's defaults
are unchanged). `timescaledb` gets `profiles: ["local-db"]` so it never starts on the droplet. All 7
`depends_on: timescaledb` sites are resolved: `db-migrator`'s is replaced by wrapping
`scripts/Dockerfile.migrate`'s entrypoint with `scripts/wait-for-deps.sh` (`WAIT_FOR:
"${DB_HOST:-timescaledb}:${DB_PORT:-5432}"` — host-agnostic, reused unmodified); the other 6 sites
(`config`, `ledger`, `identity`, `notify`, `indicators`, `ui`) simply drop the direct dependency,
since each already gates on `db-migrator: {condition: service_completed_successfully}`, which now
implies DB reachability transitively. `COMPOSE_PROFILES=local-db` is added as a literal line inside
`scripts/setup-env.sh`'s Database-section heredoc (`:259-266`, not merely to `.env.example`, which
`setup-env.sh` never reads) so new local `.env` files activate it correctly; `scripts/bootstrap.sh`'s
existing-`.env` branch (`:23-26`) auto-appends `COMPOSE_PROFILES=local-db` with a printed notice if
missing, rather than a warn-only path most existing developers would never see.

### 3. `db-migrator` — switches from bind-mount build to GHCR image pull

`db-migrator` was the one artifact still using `build: {context: ., dockerfile:
scripts/Dockerfile.migrate}` + a full-repo bind-mount (`docker-compose.yml:96-97`), in tension with
FR-1's "no new build mechanism" framing for a droplet with no git checkout. It gets a 13th entry in
`.github/workflows/docker-build.yml`'s matrix (alongside the existing 12 services), `docker-
compose.yml`'s `db-migrator` block switches to `image: ghcr.io/.../db-migrator:${IMAGE_TAG}`, and
the bind-mount is removed. Since that removal exposes a latent gap (`scripts/Dockerfile.migrate`
never `COPY`s `wait-for-deps.sh`, unlike every other service's Dockerfile — it only worked locally
by accident, via the now-removed bind-mount), the Dockerfile gets `COPY scripts/wait-for-deps.sh` +
`RUN chmod +x`, matching `services/xstockstrat-ledger/Dockerfile:33-35`'s pattern.

### 4. Readiness — real checks instead of TCP-dial-only for the 4 healthcheck-less services

`xstockstrat-marketdata`/`-portfolio`/`-trading` (distroless, no shell) get a small new
statically-linked Go TCP-dial binary baked into each Dockerfile's final stage, invoked via exec-form
`HEALTHCHECK` — infra-only (Dockerfile edits, no `main.go`/gRPC contract change), staying inside
product-spec's original "no business-logic changes" boundary for *this specific* readiness gate
(the separate gRPC-retry work in §6 below is the piece that does cross that boundary, and is named
as its own scope amendment). `xstockstrat-ui` gets `healthcheck: test: ["CMD","nc","-z",
"localhost","3000"]`, reusing the existing `x-hc-defaults`/`nc -z` pattern already used by
`-config`/`-ledger`/`-identity`/`-notify`.

### 5. Port exposure — bind to loopback, don't omit

All 12 app services' host `ports:` move from the short `"HOST:CONTAINER"` form (publishes to
`0.0.0.0`) to `"127.0.0.1:PORT:PORT"` — preserving FR-3's stated "any operator SSH tooling" access
(`ssh -L` still has a loopback listener to forward to) while removing public reachability. Only
Caddy publishes `80:80`/`443:443` to `0.0.0.0`. A DO Cloud Firewall restricts inbound traffic to
80/443 + SSH as the outer layer.

### 6. Secrets — restricted `.env` file, extending the existing CI-substitution shape

No secrets-manager tooling exists anywhere in this repo (recon confirmed). FR-5's mechanism: a
restricted-permission (`chmod 600`, deploy-user-owned) `.env` file on the droplet, populated by CI
over SSH, extending `deploy.yml:52-88`'s existing sed/python3-heredoc substitution pattern (CI-owned,
never dashboard-entered) to also cover `MCP_AGENT_SECRET` and `OTEL_EXPORTER_OTLP_HEADERS` — the two
secrets that today rely on manual `doctl apps update --set-env` with no CI placeholder path
(`docs/setup/digitalocean.md:339-348`). A concrete Security review gate is named (mapped to
`docs/runbooks/reviewer-registry.md`'s Security role, since the `secret.*` config-key mechanism
doesn't apply here — confirmed via feature 076's removal of `secret://` for exactly this reason),
run once before the first droplet `.env` population, checking: `.env` permissions/ownership, never
committed, no secret value in any `docker image history`, no secret echoed into GH Actions logs, and
an explicit provisioning step for the two previously-uncovered secrets. The deploy user's
`authorized_keys` gets a forced-command restriction (`command="/opt/deploy/droplet-deploy.sh",
no-port-forwarding,no-X11-forwarding,no-agent-forwarding`) so a leaked CI SSH key can't get an
interactive shell.

### 7. Rollback and concurrency

`image:` tags move to `${IMAGE_TAG:-latest-dev}`; the deploy script writes the short-SHA before each
rolling deploy and updates a `LAST_KNOWN_GOOD_SHA` marker only after a successful, health-verified
run. Rollback re-runs the same procedure pinned to that marker; one automatic retry is attempted, and
if that also fails the script exits non-zero (failing the GH Actions run — the alert channel) and
leaves the failed container in place rather than tearing anything further down. Recovery from a
doubly-failed rollback is a named manual step in a new `docs/runbooks/droplet-deploy.md`. Two
concurrency guards: a `concurrency: {group: deploy-dev, cancel-in-progress: false}` block on
`deploy-dev.yml` (queues rather than races CI-triggered deploys) and an on-droplet `flock` in the
deploy entrypoint (guards non-CI-triggered deploys). `droplet-deploy.md` states explicitly: never run
`docker compose` commands directly on the droplet — always via the deploy script — since `flock`
only protects the script's own critical section, not a human bypassing it.

### 8. gRPC client retry-on-`UNAVAILABLE` — named scope amendment, structural safety exclusion

**This is an explicit scope amendment to product-spec.md**, recorded here per Constitution **C-11**:
dropping blue/green means the 10 internal (non-Caddy-fronted) services get zero downtime mitigation
during their own restarts, with no existing gRPC retry logic anywhere in this codebase (confirmed by
grep). The user explicitly approved this expansion after being shown the tradeoff (including
evaluating and rejecting Consul Connect as disproportionate — see Rejected Alternatives).

- **Go** (trading, portfolio, marketdata): a new `clientRetryPolicy` (`grpc.WithDefaultServiceConfig`
  JSON: `UNAVAILABLE` retryable, 4 max attempts, 0.1s–2s exponential backoff) added alongside each
  service's existing `clientKeepAlive` at every dial site — a per-service duplicated constant,
  matching the existing duplication convention (no shared Go client package exists). Portfolio's
  hand-rolled 4-attempt `emitEvent` retry loop (`portfolio_service.go:660-680`) is collapsed to a
  single `AppendEvent` call (the channel-level policy now retries transparently; layering both would
  nest to 16 real attempts) — the final `slog.Warn` on exhaustion is kept so the observability signal
  isn't silently lost. marketdata's pre-existing missing `clientKeepAlive` (an inconsistency versus
  portfolio/trading) is fixed in the same edit.
- **Python** (indicators, ingest, analysis, agent): `options=[("grpc.service_config",
  json.dumps(RETRY_POLICY))]` (same JSON shape) added at each channel-*creation* site, not each
  RPC-call site — 7 edits in analysis, 4 in ingest, 1 in indicators, 25 in agent (agent's
  `manage_formula` reuses one channel across 3 stub calls, so channel-level edits are fewer than the
  27 actual call sites).
- **Node** (`xstockstrat-ui`): `connectClients.ts` gets **two** transport factories —
  `makeTransport()` (unchanged, no retry) used only for `tradingClient`, and a new
  `makeRetryTransport()` (with a retry interceptor) used for the other 9 backend clients. This makes
  the `PlaceOrder`/`ReplaceOrder`/`CancelOrder` exclusion **structural** — `tradingClient` never
  touches retry code — rather than depending on unverified interceptor method-name filtering (round
  4's adversary flagged the single-shared-interceptor design as the one place where an untested
  external-API assumption sat directly behind the platform's most safety-critical guard).
- **Exclusion rationale**: `trading.go:337-341` confirms `ClientOrderID` is minted **fresh
  server-side** on every `PlaceOrder` call, not derived from a caller-supplied idempotency key — a
  retry after the original request actually executed server-side (a real race: the container accepts
  the RPC, runs the handler, dies before the response frame is written) would mint a **new** order
  ID, so Alpaca's own dedup wouldn't catch the duplicate. In Go and Python, this exclusion is
  **vacuous but stated explicitly** — neither language ever dials `PlaceOrder` (confirmed: no Go
  service outside trading itself calls it; agent has no `TRADING_ENDPOINT`) — so the real guard lives
  entirely in Node, which is why its structural (not filter-dependent) implementation matters. `ledger
  .AppendEvent` retries are safe via its existing `idempotency_key` dedup. `notify.EmitAlert` and
  agent's admin writes (`ManageStrategy`, `TriggerBackfill`, etc.) are accepted low-severity residual
  risk (no dedup exists, but no money/orders involved).
- **AC-2 stays public-path-only** (Caddy's `lb_try_duration`); internal retry is a separate,
  qualitative acceptance criterion (a targeted test: restart one internal dependency mid-load,
  confirm dependent calls succeed via retry), not folded into AC-2's measured downtime number —
  conflating a wait-until-healthy guarantee (Caddy) with a bounded-retry mitigation (gRPC) would
  overstate what's actually measured.
- **Governance**: this touches 8 of 12 services (trading, portfolio, marketdata, indicators, ingest,
  analysis, agent, ui) — each requires its owner's review per `docs/runbooks/reviewer-registry.md`
  before `/sdd-spec` treats it as in-scope; not "infra-only."

### 9. Migration/coexistence phase — DO App Platform stays live until the droplet is proven

**Second named scope amendment**, added at the user's explicit request in round 5. A boot-time
`VALIDATION_MODE` env flag (boolean, default false) is consumed by the services confirmed to have
always-on background write loops with no cross-instance dedup:

- **trading**: the three background-loop launches in `cmd/server/main.go:105-110`
  (`StartFillPoller`, `StartPositionSyncPoller`, `StartCredentialHealthPoller`) are wrapped in
  `if !cfg.ValidationMode`. Gated at the **launch site**, not via existing config knobs — verified
  that `trading.fill_poller.interval_ms`/`position_sync.interval_ms` don't actually pause execution
  (only re-tune the next tick's cadence: `trading.go:629-650,766-800`); only `credential_health
  .interval_ms` genuinely gates (`if intervalMs > 0`, `:1113-1128`). A config-only mitigation would
  have silently failed to stop the two pollers that actually emit the confirmed-duplicate
  `order.filled`/`account.positions.synced` events (`emitLedgerEvent` never sets an
  `IdempotencyKey` — `trading.go:1426-1439`).
- **analysis**: the two `create_task` calls in `app/main.py:116,133` (`live_loop.run_forever()`,
  `fundsignal_loop.run_forever()`) are wrapped in `if not VALIDATION_MODE`. `live_loop`'s throttle/
  dedup state is in-process only (`live_loop.py:56-57`), so two live instances would each
  independently fire the same alert/ledger event on a strategy transition.
- **marketdata**: **round 5's adversary caught that the initial design under-gated this service** —
  `StartWarmQuotePoller` and `StartBarIngestPoller` (`marketdata_service.go:391,472`) are
  already-documented always-on write loops (`services/xstockstrat-marketdata/CLAUDE.md:108,115`),
  distinct from the lazy, client-triggered WS `StreamBars`/`StreamQuotes` path. Unlike trading's
  broken config knobs, these two *do* have a real per-tick gate already (`if ms <= 0 { continue }` —
  `:405,486`). Fix, applied here rather than deferred: set
  `marketdata.stream.bar_ingest_interval_ms=0` and `marketdata.stream.warm_interval_ms=0` on the
  droplet's config namespace for the coexistence window — no code change, reuses the existing
  mechanism. This also avoids doubling outbound Alpaca REST call volume against the shared paper
  account during coexistence, a risk the initial "idempotent upserts are safe" framing missed. WS
  streaming stays policy-only: don't point live-streaming UI sessions (`/trader` dashboards) at the
  droplet during coexistence; REST-only smoke tests are safe.
- **ingest**: **round 5's adversary also caught that "manual pre-boot check" was operationally
  impossible** given `deploy-droplet` running automatically on every `main-dev` push (per §10
  below) — there's no human in the loop to run a manual check before an automated restart. Fix,
  applied here: `reconcile_interrupted`'s call (`app/main.py:63-76`, blanket `UPDATE
  ingest.backfill_jobs SET status=FAILED WHERE status IN (RUNNING,QUEUED)` with no instance filter —
  `backfill_jobs.py:129-136`) is itself skipped when `VALIDATION_MODE=true`, deferring
  reconciliation to a human-run runbook step only when the droplet is *not* in validation mode
  (i.e., post-cutover, when it's the sole authoritative instance and reconciliation is safe again).
- **`xstockstrat-config`**: no change needed — `WatchConfig` already tolerates multiple subscribers
  per service identity (confirmed safe for dual-instance coexistence).

**Cutover criteria**: all 12 containers healthy continuously for a 5-business-day soak with
`VALIDATION_MODE=true`; a read-only smoke-test script passes against Caddy's two public paths
covering ≥1 RPC per service; AC-1/3/4/5/6 demonstrated on the droplet; AC-2's downtime threshold
measured; **AC-9** (new): log/process inspection confirms zero fill-poller/position-sync/live-loop/
marketdata-poller cycles ran on the droplet during the soak, verified **only** within the ordered,
isolated cutover window described next (not as a standalone "scratch restart at any time," which
round 5's adversary correctly flagged could itself trigger the exact incident this whole design
exists to prevent, if run while both environments hold live shared-DB access).

**Cutover mechanism, explicit ordering** (round 5's adversary found "immediately adjacent" too
vague — a real race exists between flag-flip and App-Platform-pause): **pause DO App Platform
first** (console suspend / `doctl apps update` scaling to zero), accepting a brief, bounded blackout
(target: under 5 minutes) rather than risk *any* window where both environments' pollers are live
simultaneously — consistent with this design's own priority throughout: a recoverable gap beats
unrecoverable duplicate financial-adjacent data. Only then flip `VALIDATION_MODE=false` in the
droplet's env template **at cutover time itself** (round 5's adversary caught that "2 weeks later"
risked the flag silently reverting to `true` on any intervening routine `deploy-droplet` run that
re-renders the env from a stale template) and redeploy trading + analysis via the existing rolling
restart — this is the moment the pollers/loops start for real. No DNS/domain step is needed: recon
confirmed `.do/app.dev.yaml` has no `domains:` block and nothing in this repo hardcodes the dev
App Platform URL — "cutover" is just telling whoever tests against "the dev environment" to point at
the droplet's address instead.

**Rollback pre-cutover** is genuinely trivial and simpler than §7's post-cutover mechanism: while
`VALIDATION_MODE=true`, the droplet never wrote a ledger event or fired an alert — App Platform
stayed the sole system of record throughout. "Rollback" is just: don't flip the flag, keep using App
Platform. §7's image-SHA rollback mechanism is reserved for **post-cutover** use only.

**CI/CD during coexistence**: both targets deploy from the same `deploy-dev.yml` run on every
`main-dev` push — the existing App Platform `deploy` job unchanged, plus a new sibling
`deploy-droplet` job (same `short_sha`, same build artifacts) with `VALIDATION_MODE=true` baked into
the droplet's env template for the entire window. The manual cutover flip is a separate,
deliberate action (`workflow_dispatch` or manual SSH) outside the routine push-triggered path, so no
accidental `main-dev` push can toggle it.

**Decommissioning** (named final step of this feature, not the initial stand-up PR): after an
additional 2-week post-cutover soak (a first-principles operational number, not evidence-derived —
named as an open risk below), delete the DO App Platform dev app, archive `.do/app.dev.yaml` and
update root `CLAUDE.md`'s Key File Paths table accordingly, remove the App Platform `deploy` job
from `deploy-dev.yml`, and drop `VALIDATION_MODE` from the env template entirely (its absence should
read as "off").

### 10. Documentation scope (FR-8)

Beyond FR-8's original 3 files (`docs/setup/digitalocean.md`, `docs/patterns/ci-overview.md`, root
`CLAUDE.md`), fold in the 6 additional surfaces recon found with dev-App-Platform-specific content
that would otherwise go stale: `docs/patterns/observability.md`, `docs/setup/alpaca.md`,
`docs/patterns/frontend-auth.md`, `docs/runbooks/mcp-tools.md`, the `docs/CLAUDE.md`/`docs/setup/
CLAUDE.md` index one-liners, and the PLAT-N3 GOAWAY-tuning check in `docs/context-constitution.md`
(verify whether Caddy/droplet networking reproduces the idle-connection behavior that tuning was
calibrated against). **Highest priority**: `docs/patterns/config-startup.md:9,44`'s claim "DO App
Platform... has no depends_on" and `docs/patterns/docker-build.md`'s parallel "DO App Platform has
no depends_on" rationale both become **literally false** for the dev environment once it runs on a
droplet with real Compose `depends_on` — this is the concrete instance of the C-10 "shared surface"
risk this feature's own product-spec flagged in the abstract. `docs/launch-pdfs/*.md` and historical
`docs/roadmap/features/<NNN>/` records are explicitly excluded (marketing decks and append-only
history, not living docs this feature is expected to retroactively rewrite).

---

## Rejected Alternatives

- **Full blue/green (dual Compose stacks + Caddy admin-API swap)** — rejected in round 1: transiently
  doubles DB connections against a zero-headroom 20-connection budget (**F-06** breach). Would have
  given atomic zero-downtime deploys, but at a cost this repo's connection budget cannot absorb.
- **Docker Swarm** (instead of Caddy blue/green, considered pre-story) — rejected: compose-syntax
  quirks (`depends_on: condition:`, `deploy:` fields behave differently under `docker stack deploy`)
  made it a worse fit than plain Compose + Caddy for this repo's existing file.
- **Halved per-color `DB_POOL_MAX` during blue/green swap** (round 1 alternative) — rejected in favor
  of dropping blue/green entirely: adds an operational knob and reduces DB headroom exactly when load
  is highest, versus eliminating the doubling by construction via single-stack rolling restart.
- **Raising the DO Managed Postgres connection ceiling** (round 1 alternative) — rejected: a
  recurring cost and plan dependency outside this feature's original scope, when a no-overlap
  architecture solves the same problem for free.
- **`docker-compose.droplet.yml` override file** (instead of editing the base file) — rejected:
  reintroduces the "two divergent spec formats to sync by hand" problem this feature exists to
  eliminate, even though it would have made removing `depends_on: timescaledb` entries cleaner.
- **Consul Connect (service mesh) for gRPC retry** — evaluated in round 5 at the user's request,
  rejected: would require a sidecar per service (~12 more containers) on a droplet sized for 13, a
  new mTLS certificate/rotation story on top of the FR-5 secrets design already being built from
  scratch, and doesn't actually simplify the `PlaceOrder` exclusion (still needs per-method routing
  config, an equally "untested until proven" claim just moved from TypeScript into YAML). Solves a
  multi-node service-discovery problem this single-droplet, single-bridge-network topology doesn't
  have.
- **Full gRPC health-service redesign for the 3 distroless Go services** (round 3 alternative) —
  rejected in favor of a shallow TCP-dial binary: registering `grpc.health.v1.Health` with
  app-code-gated `SERVING` status requires real `main.go` dial/retry logic, crossing further into
  business-logic territory than a platform/infra feature's stated scope; deferred as a named
  follow-up feature.
- **Per-RPC-call-site Python retry decorator** (round 4 alternative) — rejected in favor of
  channel-creation-site options: `xstockstrat-agent/app/client.py` alone has 27 RPC-call sites vs. 25
  channel-creation sites (channel reuse in `manage_formula`), so channel-level edits are strictly
  fewer and land at the few places that actually construct the transport.
- **Layering the new gRPC service-config retry on top of portfolio's hand-rolled `emitEvent` retry
  loop** — rejected: both would retry the identical `AppendEvent` request with the same idempotency
  key, nesting to up to 16 real attempts for zero behavioral benefit; the hand-rolled loop is
  collapsed into a single call instead.
- **Manual pre-boot check as ingest's coexistence-window mitigation** (round 5 initial proposal) —
  rejected after the adversary showed it's unenforceable given `deploy-droplet`'s automated cadence;
  replaced with a `VALIDATION_MODE`-gated skip of `reconcile_interrupted` itself.
- **"Policy-only, no gate" for marketdata's background pollers** (round 5 initial proposal) —
  rejected after the adversary found this was an unverified absence claim (the same "narrowing
  sentence not grep-verified" trap this repo's ledger has caught twice before) — both pollers already
  have a working `interval_ms<=0` pause gate that the design failed to use.
- **Cloned/separate database for droplet validation during coexistence** — rejected: FR-4 fixes the
  DO Managed Postgres cluster as unchanged with a hard connection-budget table; a clone needs its own
  migration run, its own secrets, and a pool-budget line the root `CLAUDE.md` table has no room for,
  while defeating the actual goal of validating against real shared dev state.

---

## Open Risks

- [ ] **Pre-implementation audit of the other 7 services' boot sequences** — round 5's discovery
      pass confirmed always-on write loops in trading/analysis/marketdata and confirmed their
      absence in `xstockstrat-config`, but did **not** exhaustively check `portfolio`, `indicators`,
      `ledger`, `identity`, `notify`, `ui`, `agent` for an undiscovered always-on write path against
      the shared DB. **Required before `/sdd-execute` implements the migration-phase steps**: grep
      every service's boot sequence (`main.go`/`main.py`/entry point) for unconditional background
      task/goroutine/`create_task` creation, confirming no additional coexistence-window exposure
      exists beyond the four now identified and gated.
- [ ] Droplet CPU sizing is unbudgeted (only RAM was estimated, `~5.3-5.8Gi` steady-state on
      `s-4vcpu-8gb`) — name as a load-testing item for `/sdd-spec`, don't invent a number.
- [ ] Caddy's `lb_try_duration` behavior against a single, unpooled upstream during a brief container
      restart is documented Caddy behavior but untested in this repo (no existing Caddy config
      anywhere to verify against) — validate empirically once the Caddyfile is written, before AC-2
      is signed off.
- [ ] golang-migrate's Postgres-driver advisory-lock behavior during concurrent `Lock()`/`Unlock()`
      is the general library understanding, not verified against this repo's pinned version — the
      design deliberately does **not** rely on it for correctness (the GH Actions `concurrency:`
      group + droplet `flock` are the actual safety net), but should be confirmed at `/sdd-spec`.
- [ ] AC-2's downtime threshold (`lb_try_duration 10s`) and the 5-business-day/2-week soak durations
      are design-time estimates, not measured or evidence-derived — tune after the first real deploy
      and post-cutover period.
- [ ] DO Managed Postgres requiring `sslmode=require` is a plausible DO default, not confirmed
      against the actual cluster settings — verify at `/sdd-spec`.
- [ ] `reviewer-registry.md`'s Step Category table has no category matching "infra secrets
      provisioning" (FR-5) — flag as a gap for `/sdd-spec` to resolve (assign under the closest
      existing category, or request a registry addition).
- [ ] `scripts/setup-env.sh`'s heredoc can be extended with the `COMPOSE_PROFILES=local-db` line as
      described — not verified byte-for-byte in this design session, confirm at `/sdd-spec`.
- [ ] The gRPC-retry work (§8) and the migration-phase work (§9) are both scope amendments beyond
      product-spec.md's original "infra-only, no business-logic changes" framing. **Required**:
      `product-spec.md` gets explicit new FRs (e.g. FR-9: gRPC retry, FR-10: migration/coexistence
      phase) before `/sdd-spec` runs, so the implementation spec is planned against an accurate,
      current product spec rather than this design document alone carrying the scope record.
- [ ] Log a `docs/roadmap/ledger/fails.md` **scope-creep** entry for this feature: three incremental
      rounds (blue/green→rolling-restart, gRPC retry, migration-phase env flags) each individually
      justified but cumulatively drifting a product-spec explicitly scoped "infra-only, no
      gRPC/business-logic changes" into touching core service startup code across 8 of 12 services —
      the `fails.md` schema already defines a `scope-creep` category that has never been populated;
      this is a strong first instance.

---

## Constitution Rules Touched

- **`F-06`** (never exceed the 20-connection DB pool budget) — honored by: rejecting blue/green in
  favor of no-overlap single-stack rolling restart, which never holds more than one instance's DB
  pool per service at any time; verified clean by round 3's adversary against the actual per-service
  pool-max values summing to exactly 20.
- **`F-04`/`P-03`** (never invent a path/symbol; no silent deviation) — honored throughout: every
  design claim across all 5 rounds cites real `path:line` evidence verified by `codebase-discovery`
  or the adversary's own file reads; unresolved unknowns (Node interceptor API shape prior to the
  split-factory fix, golang-migrate lock semantics, CPU sizing) are named as Open Risks, never
  asserted as fact.
- **`C-01`** (zero-assumption, evidence-cited claims) — honored by: round 3/4/5's adversary passes
  specifically re-verifying every prior round's factual claims against the real files (e.g. the
  timescaledb `depends_on` site count, the fill-poller/position-sync-poller config-gate claims,
  marketdata's already-documented pollers) before any claim was trusted forward.
- **`C-10`** (integration completeness across shared/duplicated surfaces) — honored by: the expanded
  FR-8 documentation-surface list (§10) explicitly enumerating surfaces beyond the original 3-file
  scope, and by extending the trading/analysis coexistence-safety gating to marketdata once the
  adversary showed the same always-on-write-loop pattern existed there too, rather than leaving it
  under a narrower "policy-only" framing.
- **`C-11`** (no scope expansion without recorded sign-off) — honored by: both the gRPC-retry work
  (§8) and the migration-phase work (§9) being explicitly named as scope amendments in this document
  and in `context.md`, with the user's sign-off recorded at each `AskUserQuestion` gate throughout
  rounds 4-5, rather than silently absorbed into an "infra-only" framing.
- **`P-01`/`P-02`** (single-orchestrator authority; no lateral subagent coordination) — honored
  throughout: the orchestrator (this skill) was the sole writer across all 5 rounds; the
  design-proposer and design-adversary never saw each other's raw output, only the orchestrator's
  synthesized state passed between rounds.
- **`P-04`** (phase-gate approval, recorded) — honored by: an explicit `AskUserQuestion` gate at the
  end of every round (1 through 5), each recorded as a Status History/context.md entry.
- **`F-11`** (Floor rejection halts the phase) — honored by: round 1's F-06 breach halting approval
  and forcing a re-design (not a "proceed anyway"); no Floor breach survived past round 3.
