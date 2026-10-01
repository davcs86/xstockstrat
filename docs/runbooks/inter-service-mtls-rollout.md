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
interpolates.

### 0.1 Deploy-secret provisioning (CI/CD) — one CA per environment, leaves minted in-workflow

`.do/app.dev.yaml` / `.do/app.yaml` carry **placeholders** (`YOUR_{DEV,PROD}_MTLS_CA_CERT`,
`…_MTLS_CERT_<SVC>`, `…_MTLS_KEY_<SVC>`) for all 12 components. The deploy stores **only the CA**
(cert + key) as **one GitHub secret per environment** — a `base64(JSON {ca_cert, ca_key})` — and
`.github/workflows/deploy.yml` mints the 12 per-service leaves off it **on every deploy**:

| Secret | Used by | Produced by |
|---|---|---|
| `DEV_MTLS_CA` | `deploy-dev.yml` → `.do/app.dev.yaml` | `scripts/mtls-provision.sh ca dev` |
| `PROD_MTLS_CA` | `deploy-prod.yml` → `.do/app.yaml` | `scripts/mtls-provision.sh ca prod` |

```bash
scripts/mtls-provision.sh set-secret dev    # mints ./certs (dev CA) + sets DEV_MTLS_CA via gh
scripts/mtls-provision.sh set-secret prod   # mints ./certs-prod (prod CA) + sets PROD_MTLS_CA
# …or emit to stdout and paste into GitHub → Settings → Secrets:
scripts/mtls-provision.sh ca dev
```

**Deploy flow** (`deploy.yml`): a *Mint mTLS leaves* step writes the CA from the secret to a temp dir
and runs `scripts/gen-dev-certs.sh` against it (its `ensure_ca` reuses an existing CA, so the CA is
**byte-stable across deploys** — no rolling-deploy handshake mismatch); the substitution step then
fills the CA + every per-service `MTLS_*` placeholder from the freshly-minted leaves.

- **Leaves auto-rotate every deploy** off the stable CA — the per-service §2.1 leaf rotation is now
  automatic; you only act for CA rotation (§2.2).
- **Fail-closed**: if a spec has `MTLS_*` placeholders but no CA secret, the deploy **aborts before
  `doctl apps update`** rather than pushing a placeholder (invalid PEM → every service crash-loops →
  DO auto-rollback). This was the original feature-210 rollout gap: service code + spec placeholders
  shipped, but no secret or substitution existed, so the first `main-dev` deploy pushed placeholders
  and auto-rolled-back.
- `MTLS_KEY` stays `type: SECRET` in the specs, so DO encrypts each key at rest after substitution.
- **Trade-off (accepted):** the **CA signing key lives in CI** (the secret + the runner's temp dir
  during the mint step). This is the operator's chosen convenience/security balance — same secret
  class as `JWT_SECRET` / DB creds already in CI — in exchange for zero per-deploy manual steps and
  automatic leaf rotation. The alternative (store the 12 leaves, keep the CA key off CI) is a larger,
  per-rotation manual secret; keep that in mind if the threat model tightens.
- Dev and prod use **separate CAs** (`./certs` vs `./certs-prod`, both git-ignored). The dev CA also
  backs local docker-compose (via `mtls-dev-env.sh`), so local and the dev deploy share one trust root.

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

**On DO this is automatic.** `deploy.yml` mints fresh leaves off the CA secret on **every** deploy
(§0.1), so any redeploy already rotates the leaves — there is no per-leaf secret to update. The manual
steps below apply only to the **local compose** path (where leaves live in `./certs/`):

1. Mint a new leaf for the service off the current CA (`scripts/gen-dev-certs.sh --rotate <svc>`).
2. Re-`source scripts/mtls-dev-env.sh` and restart that service.
3. Its long-lived inbound streams survive via the existing client reconnect/replay (see §2.3).

### 2.2 CA rotation (two-cert bundle overlap)

On DO this is driven entirely through the env's `*_MTLS_CA` secret (its `ca_cert` is both the trust
bundle `MTLS_CA_CERT` **and** the issuer `gen-dev-certs.sh` signs leaves with via `ca_key`). Because
every leaf is re-minted on each deploy (§0.1), rotation is **three secret updates + redeploys** — no
service-by-service leaf roll:

1. **Trust both, still sign old** — set `ca_cert` = `old-cert ++ new-cert` (old **first**, so it stays
   the issuer for `ca_key` = **old** key). Redeploy: every peer now trusts both CAs; leaves still old.
2. **Sign new, still trust both** — set `ca_cert` = `new-cert ++ old-cert` (new **first**), `ca_key` =
   **new** key. Redeploy: leaves re-minted off the new CA; both still trusted, so no mismatch.
3. **Drop old trust** — set `ca_cert` = `new-cert` only, `ca_key` = new key. Redeploy. Never reach
   step 3 before step 2 is healthy everywhere.

(The first cert in `ca_cert` must be the one `ca_key` matches — openssl issues from it. For local
compose, the legacy per-leaf flow in §2.1 still applies.)

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
