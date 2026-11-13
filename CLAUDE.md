<!-- context-forge:behavioral-contract:start -->
## How to Act

Read this first — it governs *how* you work here; everything below is the *what* you work with.
These five behaviors are the operating defaults; the rest of this file (and the constitution) is
context you load per task.

1. **Don't assume — ask, and surface tradeoffs.** On ambiguity, a missing detail, or a design fork,
   stop and raise it; never paper over it with a silent guess. *(Enforced by the SDD design gate
   **C-11** and the platform cross-module contracts **PLAT-4/PLAT-5/PLAT-13**, where a silent guess breaks the seams.)*
2. **Write the minimum that solves the stated problem.** Nothing speculative — no abstraction,
   option, or "while I'm here" scaffolding the task didn't ask for. Would a senior engineer call it
   overbuilt for what was requested? Then simplify. *(Enforced by the DRY guard rail and the CF-N4 litmus.)*
3. **Touch only what the task requires.** Keep diffs surgical and auditable; clean up orphans *you*
   introduced, but don't reformat or "improve" code nobody asked you to touch.
4. **Define success up front, then loop until verified.** State the pass condition before you start,
   then run to it — write the check, run it, fix, re-run — and don't declare victory mid-loop.
   *(Enforced by the best-effort/verify norms **PLAT-N1** and the migration/proto CI gates.)*
5. **Comments state constraints, not mechanism or history — cap 2 lines.** A comment earns its place
   only if deleting it would silently break something (a caller's unstated assumption, a non-obvious
   invariant, a load-bearing directive). How the system *works*, and why it got that way, goes in the
   commit/PR description or the context files (`PLAT-*` constitution, findings, ledger, per-feature
   `context.md`) — where it is read on purpose — never as inline narration. Apply the Litmus test
   below to every comment you write or keep. *(Enforced in review; the durable homes are §Context Guide.)*

> Litmus test for any future line in this file: *does it shape how the agent thinks (a behavior), or
> restate a fact the agent can read from the code?* If it's a fact already in the repo, leave it out.
<!-- context-forge:behavioral-contract:end -->

# xstockstrat — Root CLAUDE.md

## Project Overview

**xstockstrat** (Cross Stock Strategies) is a monorepo stock strategy platform built on the **Spine pattern**. The root owns:

- `packages/proto/` — single source of truth for all gRPC/Protobuf contracts
- `docs/` — runbooks, setup guides, and implementation roadmap
- `scripts/` — codegen, bootstrap, and CI helpers
- Root-level config governance documentation (this file)

All services live as siblings under `services/`. They consume generated code from `packages/proto/` and coordinate via gRPC (HTTP/2 with protobuf). Backend services expose **gRPC only**; the Next.js frontends and the MCP agent reach them over gRPC (via `@connectrpc/connect-node` gRPC transport / native gRPC stubs) and re-expose HTTP to browsers/external clients themselves.

---

## Context Guide

This file covers always-needed platform conventions. For larger reference sections, read only what is relevant to your current task — don't load the rest.

| Task | Read |
|---|---|
| Building or modifying a Next.js frontend | `docs/patterns/frontend-auth.md` |
| Other Next.js patterns (basePath, BFF connect-web call chain + handler-map basePath gotcha, browser typed-client data shape, BFF route verification, Suspense fallbacks, Radix hydration, middleware matcher, app icons) | `docs/patterns/nextjs-frontends.md` |
| UI/UX consistency (design tokens + no-hardcoded-color rule, shadcn component/variant governance, shared shell/nav contract, loading/empty/error state primitives, accessibility baseline, durable-acceptance coverage audit + deviation backlog) | `docs/patterns/ui-ux-governance.md` |
| Adding a new backend service (any language) | `docs/patterns/header-propagation.md` |
| Docker build patterns (Node.js, Next.js, Python, Go), service healthchecks, `WAIT_FOR` entrypoint, `depends_on` conditions | `docs/patterns/docker-build.md` |
| Config key naming, scoping, startup wiring | `docs/patterns/config-governance.md` |
| Config service startup readiness (90s timeout, healthcheck, per-language) | `docs/patterns/config-startup.md` |
| DB schema map, migration tooling, run order | `docs/patterns/database.md` |
| OTel setup, env vars, per-language modules | `docs/patterns/observability.md` |
| CI job matrix, coverage thresholds, deploys | `docs/patterns/ci-overview.md` |
| DRY guard rail (no repeated constants/literals/types/helpers) — pre-commit hook, jscpd tool, `dry-reviewer` subagent | `docs/patterns/dry-guard-rail.md` |
| Adding, porting (bash → Python) or testing anything under `scripts/` — language rule, pytest harness, blast-radius tiers that decide what may be ported | `docs/patterns/script-tooling.md` |
| Test mocks / dummy data — canonical fixture homes, `INVENTORY.md` catalog, `/sdd-qa` skill, Constitution C-12 (frontend) and C-13 (all languages) | `docs/patterns/test-data-inventory.md` |
| Proto / buf changes | `docs/runbooks/proto-versioning.md` |
| Provisioning the codegen toolchain on a host (Docker unavailable / GitHub-releases egress blocked) | `docs/runbooks/codegen-toolchain-host-setup.md` |
| Adding a data source (Polygon, Tiingo, etc.) | `docs/runbooks/add-data-source.md` |
| Building a custom indicator formula | `docs/runbooks/indicator-builder.md` |
| Bug triage / hotfix | `docs/runbooks/bug-triage.md` |
| Config rollout | `docs/runbooks/config-rollout.md` |
| Backfilling historical data | `docs/runbooks/historical-backfill.md` |
| First-time DigitalOcean setup | `docs/setup/digitalocean.md` |
| OTel / Grafana Cloud wiring | `docs/setup/grafana-cloud.md` |
| Feature workflow (branch, PR, promote) | `docs/runbooks/feature-workflow.md` |
| Using or troubleshooting the agent MCP tools | `docs/runbooks/mcp-tools.md` |
| Adding/refactoring a skill, subagent, saved workflow (`.claude/workflows/`), or `CLAUDE.md`; how the AI tooling curates context (subagent delegation, progressive disclosure, structured `context.md` memory, multi-feature workflows) | `docs/patterns/context-engineering.md` |
| SDD binding rules — Constitution constraint IDs (`C-*`/`P-*`/`F-*`) cited by review/design/execute | `docs/sdd/constitution.md` |
| Acceptance scenarios & business rules (Gherkin `@AC-*`) — per-feature `acceptance.feature`, durable per-service suites read by recon/design, C-15/C-16 | `docs/sdd/business-rules/CLAUDE.md`, `docs/sdd/constitution.md` |
| Codebase/runtime invariants (`PLAT-*`/`<MODULE>-*`) — non-obvious patterns, cross-module contracts, and scars an agent would otherwise miss; plus the defects/doc-drift log | `docs/context-constitution.md`, `docs/context-constitution-findings.md` (per-module: `services/*/docs/`, `packages/*/docs/`) |
| Cross-feature SDD memory — insights (patterns that worked) and fails (mistakes that recurred) | `docs/roadmap/ledger/insights.md`, `docs/roadmap/ledger/fails.md` |
| Changing `run_backtest`, `manage_strategy`, `trigger_backfill`/`get_backfill_status` or `set_strategy_live` — this repo ships the `strat-lab` plugin (`plugins/strat-lab/`) whose `backtest` skill encodes these APIs' current quirks, and a change to them must update the skill in the **same** PR | `docs/patterns/strat-lab-plugin.md` |

---

## Service Registry

Backend services are **gRPC-only** (the HTTP/Connect-RPC ports were removed once all
callers — frontends and the MCP agent — moved to gRPC). The HTTP Port column applies only
to the frontends and the agent.

| Service | Language | Role | gRPC Port | HTTP Port |
|---|---|---|---|---|
| xstockstrat-trading | Go | Order execution, trade lifecycle | 50051 | — |
| xstockstrat-portfolio | Go | Position tracking, P&L | 50052 | — |
| xstockstrat-marketdata | Go | Alpaca feed ingestion, OHLCV storage | 50053 | — |
| xstockstrat-indicators | Python | Formula engine, sandboxed execution | 50054 | — |
| xstockstrat-ingest | Python | Raw data normalization, event publishing | 50055 | — |
| xstockstrat-analysis | Python | Strategy scoring, backtesting | 50056 | — |
| xstockstrat-ledger | Node.js | Append-only event store | 50057 | — |
| xstockstrat-identity | Node.js | Auth, API keys, JWT | 50058 | — |
| xstockstrat-notify | Node.js | gRPC streaming alert delivery | 50059 | — |
| xstockstrat-config | Node.js | Live config WatchConfig stream | 50060 | — |
| xstockstrat-ui | Next.js | Consolidated UI: trader dashboard, insights analytics, config management | — | 3000 |
| xstockstrat-agent | Python | MCP server — AI agent tools for signal ingestion, alerting, backtesting | — | 9000 (Streamable HTTP) |

---

## Language Versions & Tooling

| Language / Tool | Version | Notes |
|---|---|---|
| Go | 1.27 | `go.work` workspace file at repo root |
| Python | 3.13 | Dependencies managed by `uv`; `uv sync --extra dev` to install |
| Node.js | 24 | All Node/Next services |
| pnpm | 9.15.9 | Workspace manager (`pnpm-workspace.yaml`); `npm install -g pnpm@9.15.9` |
| buf | 1.72.0 | Proto toolchain; installed by `scripts/bootstrap.py` |
| golang-migrate | latest | DB migrations; installed by `scripts/bootstrap.py` |
| golangci-lint | v2.14.0 | Go lint; run via `golangci-lint-action@v9` |
| ruff | latest | Python lint + format |
| Playwright | — | E2E tests for the consolidated `xstockstrat-ui` (all three segments) |
| Vitest | ^3 | Unit (logic) tests for `xstockstrat-ui` — node-environment `src/**/*.test.ts`, coverage scoped to `src/lib/**` (feature 065); complements Playwright e2e |
| Tailwind | 4 | `xstockstrat-ui` only — see `services/xstockstrat-ui/CLAUDE.md` § Styling |

**Python uv lock rule**: After any change to a Python service's `pyproject.toml` (adding, removing, or updating a dependency), run `uv lock` inside that service directory and commit the updated `uv.lock` in the same PR. Never leave `uv.lock` out of sync with `pyproject.toml` — the `python-lint` job runs `uv lock --check` per service.

**Important Go build note**: CI runs all Go jobs with `GOWORK=off`. When running Go commands locally for a single service (e.g., `go test`, `go mod download`), set `GOWORK=off` or `cd services/<service>` and rely on the local `go.mod`.

**macOS is the primary developer platform; Linux is optional.** All bash commands in `.md` files (docs, runbooks, setup guides) must be macOS/Homebrew-compatible:

- Use `brew install <tool>` as the primary install instruction; add Linux alternatives in an "Other" column or parenthetical — not the other way around
- Avoid GNU-only flags; prefer options that work on both BSD (macOS) and GNU tools (e.g. `grep -oE` works on both; `grep -P` does not)
- Never use bare `pip` — use `python3 -m pip` (bare `pip` resolves to pip2 on stock macOS)
- **Never add a new `.sh` file** — new tooling is a tested Python script; shell is allowed only for a script copied into a runtime image (CI job `shell-freeze`, `docs/patterns/script-tooling.md`). Existing `.sh` files follow the same macOS rule; use `#!/usr/bin/env bash` and bash 3.2-compatible syntax (macOS ships bash 3.2 by default)

### Version Bump Workflow

Update this table first (the soft source of truth) and `Dockerfile.codegen`, then propagate to every other pinned copy — `.github/workflows/ci.yml`, the affected service Dockerfiles, `package.json`/lockfiles, `go.work` (a devDependency-only tool like Tailwind has no Dockerfile pin). Open a PR; CI catches most misses.

**The one drift CI will NOT catch — proto-plugin pins** (`protoc-gen-go`, `protoc-gen-go-grpc`, `protoc-gen-connect-go`) live in `Dockerfile.codegen` and the `proto-freshness` job's install step; bump both in the same PR (verify: empty `git diff packages/proto/gen/` after `./scripts/buf-gen.sh`).

---

## Proto Contract Governance

All `.proto` changes require a PR to this repo first. `buf lint` + `buf breaking` run on every CI PR. Run `./scripts/buf-gen.sh` before committing (CI `proto-freshness` job enforces this).

**Prefer enums over strings** for any field whose value set is closed and deployment-time-defined (e.g. status codes, operation verbs, fixed categories). Use `string` only when values are open/runtime-extensible (registered by operators at runtime) or when old clients silently dropping unknown enum values would be lossy. Every enum must have a zero-value `<NAME>_UNSPECIFIED = 0` sentinel.

For breaking-change workflow, BSR publishing, and approval requirements → `docs/runbooks/proto-versioning.md`.

---

## Approval Flow

See `docs/runbooks/approval-flow.md`. Breaking proto: 2 owners + platform lead. New config key: owner + config team. New service: platform lead. DB migration: DBA + service owner.

---

## Config Governance Rules

Config served by `xstockstrat-config` via `WatchConfig` RPC (gRPC 50060). Key rules: no hardcoded values in source; the stored key is namespace-relative; the FQN is display-only; every read key is seeded by a config migration (feature 296; a key is `<category>.<key>` under namespace `<service>`, `SetConfig`/`create_key`/`GetSecret` reject a prefixed key); all services subscribe at startup; defaults declared in each service's `CLAUDE.md`. Config is scoped by **environment** (`production`/`staging`) × **global/per-user** (`user_id`, NULL = global); a per-user value overrides the global one. Paper/live is **derived** from environment (production = live, staging = paper). **Secrets are encrypted `is_secret` config rows** (global or per-user), redacted at every read/broadcast edge and decrypted only by `GetSecret` for allow-listed internal callers — never env vars. Mechanism → `docs/patterns/config-governance.md`; vendor-credential wiring → `docs/runbooks/add-data-source.md` § "Wiring a New Vendor Credential Through Deploy".

**Full rules, global key table, and the per-feature registered-keys log** → `docs/patterns/config-governance.md`.

---

## Environment Variable Naming Convention

All inter-service connection env vars follow these patterns. **Never invent new suffixes** — use only the forms below.

| Pattern | Format | Used for | Example |
|---|---|---|---|
| `<SERVICE>_ENDPOINT` | `host:port` (no protocol) | gRPC connections | `IDENTITY_ENDPOINT=xstockstrat-identity:50058` |

> **Removed (historical):** `XSTOCKSTRAT_<SERVICE>_PRIVATE_URL` was the nginx-container-only `envsubst` upstream var. Nginx was removed by feature 045 (`ui-consolidation-nextjs`); these vars no longer exist and must not be reintroduced. See `docs/patterns/nginx-routing.md` (deprecated).

**Rules:**

- All backend services are gRPC-only, so all inter-service connection vars use the `_ENDPOINT` (gRPC `host:port`) form. The legacy `<SERVICE>_HTTP_ENDPOINT` form was removed when the backend HTTP/Connect-RPC (80xx) servers were deleted — do not reintroduce it (test-only Playwright mocks may still set it, but no runtime code reads it).
- No `XSTOCKSTRAT_` prefix on inter-service connection vars (the only historical exception, the nginx `PRIVATE_URL` vars, was removed with nginx — see above).
- No `_URL` suffix on inter-service connection vars — always `_ENDPOINT`.
- When a new service introduces connection env vars, check `docker-compose.yml` first — the var may already exist in another service's block and only needs to be added to the new service's block with the same value.
- Removed — do not reintroduce: `N8N_WEBHOOK_SECRET`, `MCP_AGENT_SECRET` (the agent signs its OAuth `txn` blob with `JWT_SECRET`), and the vendor keys `ALPACA_API_KEY`/`ALPACA_API_SECRET`/`FMP_API_KEY`/`FINNHUB_API_KEY` (now encrypted `marketdata.*` config rows resolved via `GetSecret`).
- **`MTLS_CERT` / `MTLS_KEY` / `MTLS_CA_CERT` are boot-time PEM env vars, NOT connection vars** (no `_ENDPOINT`/`_URL` suffix; never a `WatchConfig` key); every service fails closed without them (feature 210). Contract → `docs/patterns/inter-service-mtls.md`; rollout → `docs/runbooks/inter-service-mtls-rollout.md`.

---

## Database

TimescaleDB (PostgreSQL). Each service owns its schema; migrations run via `scripts/db-migrate.sh` (golang-migrate). Convention: `NNN_description.up.sql` + `.down.sql` in `services/<service>/migrations/`. Never edit an applied migration — add a new numbered one instead. A migration stays inside its own schema; the single recorded exception is analysis `029` reading `identity.users` (`docs/patterns/database.md`).

**Schema map, migration run order, and step-by-step guide** → `docs/patterns/database.md`.

### Connection Pool Budget

The managed DigitalOcean PostgreSQL plan allows **~22 connections shared across all services**. Each
**direct** service caps its pool small so the sum of direct pool maxes stays well under that. Pool size
is set per service in code and overridable with the **`DB_POOL_MAX`** env var (Go `pgxpool.MaxConns`,
Python `asyncpg.create_pool(max_size=…)`, Node `pg.Pool({ max })`). **When adding a new DB-backed
service or raising any *direct* service's pool, re-check this table so the direct total stays safe.**

The six stateless-query Go/Python services route through a per-database PgBouncer transaction pool
(`:25061`) with `DB_POOL_MAX` left unset; config, ledger, the other Node leaves, and the
`db-migrator` job stay direct (`:25060`) because they need `LISTEN`/`NOTIFY` or migration advisory
locks — theirs is the real backend-slot budget. Full rationale, the direct-vs-pooled split, and the
`DB_PGBOUNCER` driver requirements → `docs/patterns/database.md` § Connection pooling (PgBouncer).

| Service | Lang | Route | Pool max | Notes |
|---|---|---|---|---|
| xstockstrat-trading | Go | pool `:25061` | default 2 | `DB_POOL_MAX` unset (client→PgBouncer, not a backend slot). Single shared `pgxpool` — `AccountRepo` reuses `TradingRepo.Pool()` (no second pool) |
| xstockstrat-portfolio | Go | pool `:25061` | default 2 | `DB_POOL_MAX` unset |
| xstockstrat-marketdata | Go | pool `:25061` | default 2 | `DB_POOL_MAX` unset |
| xstockstrat-indicators | Python | pool `:25061` | default 2 | `DB_POOL_MAX` unset |
| xstockstrat-ingest | Python | pool `:25061` | default 2 | `DB_POOL_MAX` unset |
| xstockstrat-analysis | Python | pool `:25061` | default 2 | `DB_POOL_MAX` unset |
| xstockstrat-ledger | Node | direct `:25060` | 2 | 1 query-pool conn (`DB_POOL_MAX=1`) + 1 dedicated LISTEN/NOTIFY conn (`EventNotifier`). Live `StreamEvents` subscribers share the single listener and never borrow from the query pool, so concurrent streams can't starve `AppendEvent`. |
| xstockstrat-identity | Node | direct `:25060` | 2 | |
| xstockstrat-config | Node | direct `:25060` | 2 | |
| xstockstrat-notify | Node | direct `:25060` | 1 | Light DB use (alert history and the webhook delivery queue) |
| xstockstrat-ui | Next.js | direct `:25060` | 1 | config-ui audit route only |
| **Direct backend total** | | | **8** | Real cluster connections held by the direct services (per environment) |
| **Pooled (PgBouncer)** | | | **pool `size` (5)** | The six services above multiplex onto ≤ the pool size, regardless of their client-pool maxes |

Effective backend usage per environment ≈ **8 direct + ≤5 pool = ~13**, leaving headroom under the
~22-slot cluster even with both environments live. The six pooled rows no longer count 1:1 against the
budget — that was the point of the PgBouncer split.

---

## Observability

OTel SDK → OTLP → Grafana Cloud. Toggle: `OTEL_ENABLED=true`. OTel init errors must never prevent startup. Each service has `internal/telemetry/` (Go), `app/telemetry.py` (Python), or `src/telemetry.ts` (Node.js).

**Env var table, local vs. prod endpoints, and per-language patterns** → `docs/patterns/observability.md`.

---

## Frontend Ingress

`xstockstrat-ui` (port 3000) serves all three frontend segments under their respective path prefixes (`/trader`, `/insights`, `/config-ui`). In the DO App Platform, path-based route rules direct `/agent` to `xstockstrat-agent` and `/` (catch-all) to `xstockstrat-ui`. In local docker-compose, `xstockstrat-ui` is exposed directly on port 3000. The nginx reverse proxy was removed by feature 045 (`ui-consolidation-nextjs`).

---

## Frontend Authentication Pattern

The `xstockstrat-ui` service implements JWT auth via `src/lib/auth.ts` (Edge Runtime, `jose`), `src/middleware.ts` (route protection + trace ID injection), per-segment `/api/auth/{login,refresh,logout}` routes, and forwards `x-user-id` / `x-access-scope` / `x-trace-id` on all outbound calls. Required env vars: `JWT_SECRET`, `IDENTITY_ENDPOINT` (gRPC `host:port`).

**Full pattern, required files, and code snippets** → read `docs/patterns/frontend-auth.md`. Reference implementation: `services/xstockstrat-ui/src/`.

---

## Generating Proto Stubs

Run `./scripts/buf-gen.sh` — generates TypeScript, Python, and Go stubs and compiles the TS package. For manual `buf` commands and BSR publishing → `docs/runbooks/proto-versioning.md`.

---

## Repository Bootstrap

First-time setup (`scripts/localenv-setup.py`, then `scripts/bootstrap.py`) → `docs/setup/getting-started.md`.

---

## Dockerfile Update Workflow

When you change a service `Dockerfile`, update its chain in one PR — the service `CLAUDE.md` "Docker Build Pattern" section, and `docs/patterns/docker-build.md` if the *pattern* (not just this service) changed — then `docker compose build --no-cache <service>` and `up -d` to verify it starts and passes health checks. `.do/app*.yaml` reference Dockerfiles by path, not content, so they need no change. Follow the language template and see the full rationale in `docs/patterns/docker-build.md`.

---

## CI/CD Overview

CI runs on every PR to `main-dev` or `main`. Deploys: `main-dev` push → DO dev app; `main` push → DO prod app.

**Full job matrix, coverage notes, and deployment pipeline** → `docs/patterns/ci-overview.md`.

---

## Inter-Service Dependencies

```text
xstockstrat-ui (UI — trader/insights/config-ui segments)
  ├── xstockstrat-trading (gRPC)
  │     ├── xstockstrat-marketdata (gRPC)
  │     ├── xstockstrat-portfolio (gRPC)
  │     ├── xstockstrat-indicators (gRPC)
  │     └── xstockstrat-ledger (gRPC write)
  └── xstockstrat-analysis (gRPC)
        ├── xstockstrat-marketdata (gRPC)
        ├── xstockstrat-indicators (gRPC)
        └── xstockstrat-ledger (gRPC read)

All services → xstockstrat-config (WatchConfig stream at startup)
All services → xstockstrat-ledger (event writes)
All services → xstockstrat-notify (alert emissions)
xstockstrat-notify → xstockstrat-identity (ListAdminUserIds, untargeted push audience)
xstockstrat-notify → external HTTPS (allowlisted webhook origins)
xstockstrat-ingest → xstockstrat-marketdata (raw data push)
xstockstrat-indicators → xstockstrat-ledger (audit.admin_read)
xstockstrat-analysis → xstockstrat-ingest (QuerySignals for signal-weighted backtests)
```

---

## Header Propagation Convention

Every backend service **that makes outbound per-request gRPC calls** must propagate `x-user-id`, `x-access-scope`, and `x-trace-id` from the inbound request to those calls. The `xstockstrat-ui` middleware injects/strips them at the edge after auth, so platform-internal values are trusted. Node-leaf outbound sites and the recorded feature-224 `system` exception → `docs/context-constitution.md` **PLAT-4**.

**Language-specific patterns (Go interceptor, Python per-method, Node.js AsyncLocalStorage), code snippets, and reference implementations** → read `docs/patterns/header-propagation.md`.

---

## Branch Strategy

| Branch | Purpose |
|---|---|
| `main` | Production — triggers prod deploy on push |
| `main-dev` | Development trunk — triggers dev deploy on push; all feature branches merge here |
| `feature/<slug>` | Feature implementation branches (SDD workflow); also used for SDD-path bug fixes (Track C) |
| `feature-steps/<slug>-step-<N>` | Per-step branches for SDD execute loop; each step gets a PR into `feature/<slug>` |
| `hotfix/<slug>` | Urgent production bug fixes — branches from `main`, PR targets `main`; back-merged into `main-dev` after merge |
| `claude/*`, `ccr-*` | Harness-assigned branches (e.g., `claude/add-claude-documentation-9Whsq`, `ccr-88d8f6f9-t0yqae`) — always branched from and PR'd into `main-dev`; never use as base for features |

### Merge Strategy

| PR direction | Required merge type | Reason |
|---|---|---|
| `feature/*`, `claude/*` or `ccr-*` → `main-dev` | Squash and merge | Keeps `main-dev` history clean |
| `hotfix/*` → `main` | **Create a merge commit** — never squash | Preserves ancestry; back-merge into `main-dev` required immediately after |
| `main-dev` → `main` (promotion) | **Create a merge commit** — never squash | Squash breaks git ancestry: the promoted `main-dev` commits never become ancestors of `main`, so the next promotion's diff re-shows changes that are already promoted |

To enforce this, disable squash and rebase merging on the `main` branch:
**Settings → Branches → Edit `main` branch protection → Allow merge types → uncheck Squash and Rebase**.

---

## Implementation Roadmap Status

Phases 0–7 are all **DONE** — see `docs/roadmap/implementation-roadmap.md` for full specs and verification checkpoints. This is a coarse phase map only; per-feature lifecycle status is authoritative in the feature directories (§ Feature Roadmap), not here. Deviation notes exist only for phases 3–7 (`docs/roadmap/phase[3-7]-deviations.md`); phases 0–2 predate that convention and have none.

---

## Feature Roadmap

Active and completed feature implementations are tracked under `docs/roadmap/features/`. Feature directories are named `NNN-<slug>` (e.g. `001-add-ikbr-account-support`) where `NNN` is a zero-padded sequence number. **Numbering rule:** numbers are reserved only by `scripts/sdd-allocate-feature-number.py` (see `docs/runbooks/feature-workflow.md` § Feature Numbering). Git branches use only the slug: `feature/<slug>`. Per-directory files → `docs/roadmap/features/CLAUDE.md`.

### Mandatory Entry Point — No Feature Work Without SDD Grounding

**IMPORTANT — this overrides task framing.** Before writing any code for a new capability (a new
UI page/route, endpoint, service behavior, tool, or config surface), run the SDD pipeline at
minimum: `/sdd-story <slug>` → `/sdd-design <slug> quick` → the design-phase ledger touch
(Constitution **C-11**, `docs/sdd/constitution.md`). This applies **regardless of how the request
arrives** — a GitHub issue, a chat message, or a session/task instruction that says, in plain
language, to "implement X, commit, and push." That framing is a request for the *capability*, not
permission to skip the pipeline — run `/sdd-story` and `/sdd-design quick` yourself first, *then*
implement.

`quick` mode is the fast-track for small changes, not an exemption: Phase 0 Recon always runs in
full and a single mandated adversarial round still happens (see `.claude/skills/sdd-design/SKILL.md`).
It shortens the debate; it never skips Phase 0/Phase 1 or the Constitution.

**Exempt:** confirmed bug fixes, which route through `docs/runbooks/bug-triage.md` (Track A/B/C) —
that runbook's own `skip` design-depth recommendation applies to bugs, not new capability. Docs-only
or process-only edits (no service/UI behavior change) are also outside this rule's scope.

This rule is a Constitution **Commandment** — overridable only with the user's **explicit**
sign-off, recorded in the feature's `context.md`.

### Feature Status — Single Source of Truth

**Do not maintain a feature-status table here.** Status lives only in `docs/roadmap/features/<NNN-slug>/status.md`
(bulk reads → `docs/roadmap/features/CLAUDE.md` § Bulk Status Reads).
Run `/sdd-status` for a live, computed view across all features, or `/sdd-status <slug>` for one.

**When starting any session involving an in-progress feature:**

1. Run `/sdd-status` to see all features and their lifecycle status.
2. Read `docs/roadmap/features/<NNN-slug>/context.md` before touching any related files — it contains critical decisions from prior sessions.
3. Do NOT rely on conversation context from a previous session. Always re-read context.md.

SDD skills: `/sdd-story` → `/sdd-review product-spec` → `/sdd-design` (recon + design debate) → `/sdd-spec` → `/sdd-review impl-spec` → `/sdd-execute` (loop) | `/sdd-status` (anytime) | `/sdd-sync` (sync spec files from feature branches to main-dev) | `/sdd-distill` (compact a long-running feature's context.md mid-lifecycle) | `/sdd-archiver` (distil + prune completed features and resolved defect reports into durable memory) | **many features at once:** saved workflows `/sdd-batch` (review → design → spec → impl-review in parallel) and `/sdd-batch-execute` (sequential execute in parallel worktrees), plus `/merge-train` (progressive PR merges) — gates halt by default; contract in `docs/patterns/context-engineering.md` §4

---

## Key File Paths Reference

| Area | Path |
|---|---|
| Proto contracts | `packages/proto/<service>/v1/<service>.proto` |
| Generated Go stubs (never Read/Grep — checked-in codegen output; read the `.proto` source instead) | `packages/proto/gen/go/` |
| Generated Python stubs (never Read/Grep — checked-in codegen output; read the `.proto` source instead) | `packages/proto/gen/python/` |
| Generated TS stubs (never Read/Grep — checked-in codegen output; read the `.proto` source instead) | `packages/proto/gen/ts/` (compiled JS in `gen/ts/dist/`) |
| Feature-number allocator (reserves `NNN` via the `sdd/feature-cursor` ref) | `scripts/sdd-allocate-feature-number.py`, `scripts/tests/test_sdd_allocate_feature_number.py` |
| User management script | `scripts/manage-users.py` — Typer CLI; run via `uv run scripts/manage-users.py` |
| Frontend test-data inventory (fixtures + catalog) | `services/xstockstrat-ui/e2e/fixtures/`, `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` |
| Approval flow | `docs/runbooks/approval-flow.md` |
| Reviewer registry | `docs/runbooks/reviewer-registry.md` |
| Feature merge order | `docs/roadmap/features/merge-order.md` |

---

## Harness Default Branch

**The harness must always check out `main-dev` at session start.** Never begin work on a harness-assigned branch (e.g. `claude/*`). SDD skills read authoritative artifacts from `origin/feature/<slug>` or `origin/main-dev` via `git show` — the working-tree checkout must be `main-dev` so that any fallback reads and branch operations start from the correct base.

**All `claude/*` and `ccr-*` branches must be based on `main-dev`, not `main`.** When the harness creates or checks out one of these branches, it must branch from `main-dev` and open PRs targeting `main-dev`. Branching from `main` will pollute the PR with unrelated production commits.
