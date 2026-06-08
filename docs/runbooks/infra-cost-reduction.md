# Infrastructure Cost Reduction Strategy

> Status: strategy / proposal. Numbers are **list-price estimates** from the
> App Platform pricing page; verify against the actual DigitalOcean billing
> invoice before acting (apps created after 7 May 2024 may be billed on the
> newer plan schedule rather than the legacy `basic-*` / `professional-*`
> slug list prices). The **relative** savings below hold regardless of the
> exact per-slug rate.

## Current state (verified against live deployments, 2026-06)

Two always-on environments, each running all 12 components, plus one shared
managed Postgres cluster.

| Component group | Prod (`live`) slug | $/mo | Staging (`paper`) slug | $/mo |
|---|---|---|---|---|
| 11 app/backend services | `professional-xs` (1 vCPU / 1 GB) | 11 × 12 = 132 | `basic-xs` (1 vCPU / 1 GB) | 11 × 10 = 110 |
| `xstockstrat-config` | `professional-s` (1 vCPU / 2 GB) | 25 | `basic-s` (1 vCPU / 2 GB) | 20 |
| `db-migrator` (PRE_DEPLOY job) | `basic-xs` | ~0 (per-second) | `basic-xs` | ~0 |
| **Compute subtotal** | | **157** | | **130** |

Shared DB: single-node `db-s-1vcpu-1gb`, 10 GiB, hosts both
`xstockstrat-production` and `xstockstrat-staging` databases ≈ **$15/mo**.

**Total ≈ $302/mo (~$3,624/yr).** The cost driver is **24 always-on
instances** (12 per environment). The database is already at the floor and
correctly shared — leave it alone.

## Key observations

1. **`professional-xs` buys nothing over `basic-xs` here.** Both are
   *1 shared vCPU / 1 GB*; the App Platform 60-second idle timeout applies to
   both tiers equally (only `*-s` and above raise it — that's why `config`
   needs `*-s`). The only delta is access to professional-tier features
   (horizontal autoscaling, >3 instances, zero-downtime niceties) that this
   1-instance-per-service topology doesn't use. Prod pays a ~$2/instance
   premium for unused capability.
2. **Backend services are over-provisioned on RAM.** Go services
   (`trading`, `portfolio`, `marketdata`) idle in the tens of MB; the Node
   services (`ledger`, `identity`, `notify`) sit comfortably under 512 MB.
   Only the Python services (`indicators`, `ingest`, `analysis`, `agent`),
   the Next.js `ui`, and `config` (streaming headroom) genuinely want 1–2 GB.
   Validate against DO Insights memory graphs before shrinking.
3. **Staging is ~43% of spend for a paper/dev environment** that is up 24/7
   but only exercised during development and CI.
4. **App Platform does not scale services to zero.** The only way to stop
   paying for an idle environment is to destroy and recreate it (the spec is
   already declarative in `.do/app.dev.yaml`, so recreation is one CI step).

## Recommended tiers

Pick a tier by risk appetite. Each builds on the previous.

### Tier 1 — Right-size (no architecture change, low risk) → ~$230/mo, save ~$72/mo (~24%) — **APPLIED**

- **Prod:** moved entirely to the Basic tier — `professional-xs` → `basic-xs`
  for all 11 services, `professional-s` → `basic-s` for `config`. Functionally
  identical here (`professional-xs` is the same shared 1 vCPU/1 GB as
  `basic-xs`; `basic-s` raises the idle timeout the same way `professional-s`
  does — staging already proves this). Prod compute $157 → **$130**.
- **Staging:** dropped the 3 Go + 3 Node (`ledger`/`identity`/`notify`)
  services to `basic-xxs` (512 MB, $5). Python/`ui` stay on `basic-xs`;
  `config` stays on `basic-s`. Staging compute $130 → **$100**.
- Validation: watch DO Insights for OOM/restart after each change; roll back
  the individual service's slug if it trips. `config` is the one to watch —
  if `WatchConfig` subscribers drop, it needs to stay on a `*-s` size.

### Tier 2 — Scheduled production teardown (pre-maturity) → ~$160–190/mo, save ~$110–140/mo (~35–45%)

Because production is not yet truly live (`until project maturity`), it does
not need to run 24/7. Add a scheduled GitHub Actions job that **destroys** the
production app outside the active window and **recreates** it from
`.do/app.yaml` on a schedule or on manual `workflow_dispatch`.

- The shared Postgres cluster stays up, so **no data is lost** across teardown
  — only the stateless service instances stop billing.
- Running prod ~40–50 h/week instead of 168 cuts its compute ~70% (→ ~$40/mo).
- **Trade-offs:** (1) the platform is fully offline while torn down — only do
  this while there is no real live-trading obligation; (2) recreating the app
  may assign a **new `*.ondigitalocean.app` URL** unless a custom domain is
  attached, so pin a domain before relying on a stable address; (3) cold-start
  is a full deploy (~minutes) on bring-up; (4) `DO_PROD_APP_ID` changes on
  recreate — the teardown workflow must recapture it.
- Revert path: when the project matures, disable the schedule and leave prod
  permanently up.

### Tier 3 — Service consolidation (major refactor, highest leverage) → ~$120–150/mo, save ~50–60%

- The 12-service Spine topology means a minimum-billable instance *per
  service per environment*. Grouping deployables by runtime — e.g. one Go
  binary hosting `trading`+`portfolio`+`marketdata`, one Python app hosting
  `indicators`+`ingest`+`analysis`, etc. — collapses ~12 instances/env to
  ~5 without losing logical service boundaries (they remain separate gRPC
  servers inside one process/image, or separate processes in one container).
- Biggest structural saving, but it touches the platform's core architecture
  and proto wiring. Treat as a roadmap feature (SDD), not a config tweak.

## What NOT to change

- **Don't split the database.** One shared single-node cluster for both envs
  is already the cheapest viable managed-PG setup. Splitting prod/staging into
  separate clusters would *add* ~$15/mo for no benefit.
- **Don't drop `config` below `*-s`.** The `WatchConfig` streaming RPC needs
  the raised idle timeout; `*-xs` will sever long-lived subscriber streams.
- **Don't shrink Python/Next.js services to 512 MB** without metrics — they
  will OOM under load.

## Execution order

1. ✅ Tier 1 prod right-size (`professional-*` → Basic tier) — `.do/app.yaml`.
2. ✅ Tier 1 staging right-size (Go/Node → `basic-xxs`) — `.do/app.dev.yaml`.
3. Tier 2 scheduled production teardown — new scheduled workflow, active until
   project maturity (in progress).
4. (Roadmap) Tier 3 consolidation — SDD feature.
