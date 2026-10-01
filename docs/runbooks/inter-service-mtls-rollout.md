# Inter-Service mTLS — Rollout, Rotation & Rollback Runbook

Feature 210 (`inter-service-mtls`) puts **flag-day, fail-closed mutual TLS** on every inter-service
gRPC hop. There is **no permissive mode, no plaintext listener, and no verification-disabling flag**
in any environment — dev and prod run identical full mutual mTLS; the only difference is *which* CA
and leaves load. This runbook covers the one-time cutover, leaf rotation, CA rotation, and rollback.

Pattern + env contract → `docs/patterns/inter-service-mtls.md`. Cert minting → `scripts/gen-dev-certs.sh`.

---

## 0. Cert material contract (recap)

Each process receives three boot-time env vars holding **PEM strings** (not file paths):

| Var | Contents | Secret? |
|---|---|---|
| `MTLS_CERT` | this service's own leaf certificate (SAN = its registry service name, both `serverAuth`+`clientAuth` EKUs) | no (public) |
| `MTLS_KEY` | this service's leaf private key | **yes** — `type: SECRET` in DO |
| `MTLS_CA_CERT` | the platform CA bundle (one cert normally; two during a CA-rotation window) | no (public) |

**Fail-closed**: if any of the three is empty/absent, the process refuses to start (servers do not
bind, clients raise on first dial). This is the entire enforcement — there is nothing to "turn on".

Local dev: `scripts/gen-dev-certs.sh` mints a dev CA + one leaf per service under git-ignored
`./certs/`; `source scripts/mtls-dev-env.sh` exports them as the env vars `docker-compose.yml`
interpolates. Prod/staging: the three vars are set per component in `.do/app.yaml` / `.do/app.dev.yaml`
from the production platform CA (`MTLS_KEY` as a DO `SECRET`).

---

## 1. Cutover — flag-day, dependency-ordered rolling deploy (leaf→root)

Because enforcement is flag-day, during the deploy a **not-yet-cutover plaintext peer and an
already-cutover mТLS peer cannot talk** — the mismatch is refused the same fail-closed way a bad cert
is. The window is bounded and auto-contained by DO health-gated promotion (a crash-looping new
version is not promoted; the last-healthy version keeps serving). Minimize the window by deploying in
**dependency order (leaf→root)**: the most-depended-upon servers first, the edges last. Derive the
exact order from the dependency graph in the root `CLAUDE.md` § Inter-Service Dependencies:

1. **`xstockstrat-config`** first — every service subscribes to its `WatchConfig` at startup.
2. **Other leaf servers** — `xstockstrat-ledger`, `xstockstrat-identity`, `xstockstrat-notify`.
3. **Mid-tier** — `xstockstrat-marketdata`, `xstockstrat-portfolio`, `xstockstrat-indicators`,
   `xstockstrat-ingest`, `xstockstrat-analysis`.
4. **The `trading`↔`ledger` wave** — deploy **adjacently**, under the precondition in §1.1 below.
5. **Edges last** — `xstockstrat-ui` (BFF) and `xstockstrat-agent` (MCP), the two pure clients.

### 1.1 Mandatory precondition for the trading↔ledger wave — flat book under HALTED

`xstockstrat-trading`'s `emitLedgerEvent` is a **fire-and-forget, single-attempt, warn-on-error**
write (no retry). A mid-cutover handshake mismatch drops order-lifecycle **transition** events
(`order.filled`, …) **permanently** — the DB upsert precedes the async emit, and the next `pollFills`
tick short-circuits on unchanged status, so nothing re-emits. Snapshot events
(`account.positions.synced` / `account.balance.synced`) re-emit every sync cycle and self-heal;
transition events do **not**, and a dropped `order.filled` leaves a gap in the feature-042
`pnl_pattern_consumer` samples that snapshots never backfill.

`platform.trading_state=HALTED` blocks `PlaceOrder`/`ReplaceOrder` but does **not** stop `pollFills`
emitting on existing open-order fills. Therefore, before cutting over the trading↔ledger wave:

1. Set `platform.trading_state=HALTED` via config (`SetConfig`, propagates over `WatchConfig`).
2. **Verify a flat book** — zero open/working orders across all accounts (so `pollFills` has nothing
   to emit during the wave). Confirm via the trader surface or `ListOrders` filtered to
   open/working states; wait for or cancel any working order.
3. Deploy `trading` and `ledger` adjacently.
4. Lift `HALTED` only after both are healthy on the new mTLS version.

This residual (if a flat book is infeasible) is **same-class-as-restart** — any trading/ledger
restart drops in-flight transition events the same way today, and feature-042 already tolerates
restart gaps. The bounded loss is **accepted by explicit operator sign-off** (feature 210
`context.md`, 2026-10-01). Do not skip the flat-book check to save time.

### 1.2 DO App Platform promotion semantics (assumption + fallback)

The cutover relies on DO **health-gated promotion**: a component whose new (mTLS) version fails its
health check is not promoted, and the last-healthy version keeps serving. This is an **inferred**
DO behavior (feature 210 design Open Risk). If your DO plan does **not** health-gate promotion,
treat the deploy as an all-at-once flag-day and schedule a maintenance window. The manual fallback
for a stuck component is the prior-image redeploy in §3.

---

## 2. Rotation — restart-only

No language hot-reloads a live listener's TLS credentials, so **rotation is redeploy-driven**.

### 2.1 Leaf rotation (one service's cert/key)

All leaves chain the **same CA**, so a rotated leaf stays trusted by every peer with no lockstep.

1. Mint a new leaf for the service off the current CA (dev: `scripts/gen-dev-certs.sh --rotate <svc>`;
   prod: issue from the production CA).
2. Update that service's `MTLS_CERT`/`MTLS_KEY` (DO component env / compose shell env) and redeploy
   **only that service**.
3. Its long-lived inbound streams survive via the existing client reconnect/replay (see §2.3).

### 2.2 CA rotation (two-cert bundle overlap)

1. Ship a **two-cert `MTLS_CA_CERT` bundle** (old CA + new CA concatenated) to **every** component and
   redeploy. Now every peer trusts leaves from either CA.
2. Re-issue every leaf off the **new** CA and roll them out (per §2.1), service by service.
3. Once all leaves are on the new CA, drop the **old** cert from `MTLS_CA_CERT` (single new cert) and
   redeploy. Never drop the old CA before every leaf has moved.

### 2.3 Why streams survive a restart (@AC-6)

`@AC-6`'s "no service downtime" means **reconnect-without-data-loss**, not zero restart (recorded as
an accepted interpretation). Long-lived streams self-heal on the peer restart: `WatchConfig`
re-subscribes → full snapshot; ledger `StreamEvents` replays from its cursor (analysis durable DB
cursor `pnl_pattern_consumer`, portfolio `resume_from_sequence`); marketdata live streams reconnect.

---

## 3. Rollback — flag-day with a transient refuse window (NOT atomic)

Rollback has the same bounded fail-closed refuse window as cutover (there is no accept-both server
mode). The **code+env asymmetry** is what keeps revert safe:

- **pre-mTLS images ignore `MTLS_*` env entirely** → reverting the image returns a service to
  plaintext, *even with the cert env still set*.
- **mTLS images with absent material fail closed** → stripping env under mTLS code is a crash-loop.

Therefore:

1. **Revert the image** (to the last pre-mTLS tag). **Leave `MTLS_*` env in place.**
   - A single bad component is auto-contained by DO health-gated promotion (last-healthy keeps
     serving). For a stuck component with no health-gating, manually redeploy its prior image.
   - A systemic abort rolls the whole release back to the previous deployment, in **root→leaf** order
     (the reverse of cutover — edges first).
2. **Only after all mTLS code is reverted**, if desired, remove the `MTLS_*` env as a separate
   cleanup step.

> **Footgun — never strip `MTLS_*` env while mTLS code is still deployed.** That is an immediate
> fail-closed crash-loop. Env removal is always a *separate* step *after* the code revert.

---

## 4. Coordination with other deploy tooling

The three deploy files (`docker-compose.yml`, `.do/app.dev.yaml`, `.do/app.yaml`) carry the cert env
for every component. If feature-084's dev orchestration (droplet + Caddy — the *external* edge) is in
play, re-verify it before cutover: this feature changes only the *internal* inter-service hops, not
the external ingress, but both touch the same deploy specs.
