# xstockstrat-orchestration — Root CLAUDE.md

## Project Overview

**xstockstrat-orchestration** is the spine repository for the xstockstrat platform — a hybrid multi-repo stock strategy system built on the **Spine pattern**. This repo owns:
- `packages/proto/` — single source of truth for all gRPC/Protobuf contracts
- `docs/` — runbooks, setup guides, and implementation roadmap
- `scripts/` — codegen, bootstrap, and CI helpers
- Root-level config governance documentation (this file)

All service repos are siblings under `services/`. They consume generated code from `packages/proto/` and coordinate via Connect-RPC (HTTP/1.1 + HTTP/2 with protobuf). Internal service-to-service calls use gRPC ports; browser/external clients use HTTP Connect-RPC ports.

---

## Service Registry

| Service | Language | Role | gRPC Port | HTTP (Connect-RPC) Port |
|---|---|---|---|---|
| xstockstrat-trading | Go | Order execution, trade lifecycle | 50051 | 8051 |
| xstockstrat-portfolio | Go | Position tracking, P&L | 50052 | 8052 |
| xstockstrat-marketdata | Go | Alpaca feed ingestion, OHLCV storage | 50053 | 8053 |
| xstockstrat-indicators | Python | Formula engine, sandboxed execution | 50054 | 8054 |
| xstockstrat-ingest | Python | Raw data normalization, event publishing | 50055 | 8055 |
| xstockstrat-analysis | Python | Strategy scoring, backtesting | 50056 | 8056 |
| xstockstrat-ledger | Node.js | Append-only event store | 50057 | 8057 |
| xstockstrat-identity | Node.js | Auth, API keys, JWT | 50058 | 8058 |
| xstockstrat-notify | Node.js | Connect-RPC streaming alert delivery | 50059 | 8059 |
| xstockstrat-config | Node.js | Live config WatchConfig stream | 50060 | 8060 |
| xstockstrat-trader | Next.js | Trading UI frontend | — | 3000 |
| xstockstrat-insights | Next.js | Analytics/insights dashboard | — | 3001 |
| xstockstrat-config-ui | Next.js | Config management UI | — | 3002 |

---

## Language Map

```
Go        → xstockstrat-trading, xstockstrat-portfolio, xstockstrat-marketdata
Python    → xstockstrat-indicators, xstockstrat-ingest, xstockstrat-analysis
Node.js   → xstockstrat-ledger, xstockstrat-identity, xstockstrat-notify, xstockstrat-config
Next.js   → xstockstrat-trader, xstockstrat-insights, xstockstrat-config-ui
```

---

## Spine Pattern

The **Spine** is this orchestration repo. It does not contain runtime service code. It owns:
1. **Proto contracts** (`packages/proto/`) — all `.proto` files; all generated stubs live here after `buf generate`
2. **Docs** (`docs/`) — runbooks, setup guides, and implementation roadmap (`docs/runbooks/`, `docs/setup/`, `docs/roadmap/`)
3. **Scripts** (`scripts/`) — `buf-gen.sh`, `bootstrap.sh`, `db-migrate.sh`
4. **Config schema** — canonical list of config keys consumed by each service

Services reference this repo as a git submodule or via the generated package registry (npm, PyPI, Go module proxy) depending on language.

---

## Proto Contract Governance

- All `.proto` changes require a PR to **this repo** first.
- Breaking changes (field removal, type change, service rename) require:
  1. Deprecation comment in `.proto` for one release cycle
  2. Migration note in `docs/runbooks/config-rollout.md`
  3. Approval from 2 service owners (see Approval Flow below)
- `buf lint` and `buf breaking` run on every PR via CI.
- Generated stubs are committed to `packages/proto/gen/` and versioned.
- For v1/v2 breaking-change workflow, see `docs/runbooks/proto-versioning.md`.

---

## Approval Flow

See `docs/runbooks/approval-flow.md` for full detail. Summary:

| Change Type | Required Approvers |
|---|---|
| New proto field (non-breaking) | 1 service owner |
| Breaking proto change | 2 service owners + platform lead |
| New config key | Service owner + config team |
| Config key removal | Config team + all consuming services |
| New service addition | Platform lead |
| Database schema migration | DBA review + service owner |

---

## Config Governance Rules

All runtime configuration is served by **xstockstrat-config** via `WatchConfig` streaming RPC (gRPC on port 50060 / Connect-RPC on port 8060). Rules:

1. **No hardcoded config values** in service source code. All env-specific values must be registered in the config service.
2. **Config key naming convention**: `<service-short-name>.<category>.<key>` — e.g., `indicators.sandbox.timeout_ms`
3. **All services subscribe to xstockstrat-config at startup** before accepting traffic. They must pass `environment` and `trading_mode` in the WatchConfig request.
4. **Config values are scoped** by `environment` (`dev`/`production`) and `trading_mode` (`paper`/`live`/`all`). Rows with `trading_mode='all'` apply to all modes.
5. **Config changes flow via n8n** → config webhook handler → config service → WatchConfig stream → all subscribers.
6. **Sensitive keys** (API keys, secrets) use the `secret.*` prefix and are resolved from the secret store at runtime; they are never stored in config service state.
7. **Default values** must be declared in each service's `CLAUDE.md` under "Config Keys".
8. **Config UI** available at `http://localhost:3002` — manage config values by environment and trading mode.

### Global Config Keys

| Key | Type | Default | Description |
|---|---|---|---|
| `platform.maintenance_mode` | bool | false | Halts all trading operations |
| `platform.log_level` | string | info | Global log level override |
| `platform.ledger_endpoint` | string | — | xstockstrat-ledger gRPC address |
| `platform.config_endpoint` | string | — | xstockstrat-config gRPC address |

---

## Database

**Primary DB**: TimescaleDB (PostgreSQL extension)

| Service | Schema | Hypertable | Partition By |
|---|---|---|---|
| xstockstrat-marketdata | marketdata | ohlcv | time (1 day chunks) |
| xstockstrat-marketdata | marketdata | quotes | time (1 hour chunks) |
| xstockstrat-ledger | ledger | events | time (1 day chunks) |
| xstockstrat-trading | trading | orders | time (1 day chunks) |
| xstockstrat-portfolio | portfolio | snapshots | time (1 day chunks) |

All services run migrations against their own schema, orchestrated centrally by `scripts/db-migrate.sh` using **golang-migrate**. State is tracked in a `schema_migrations` table inside each service's schema so re-runs only apply new files.

**Migration file convention**: `NNN_description.up.sql` + `NNN_description.down.sql` in `services/<service>/migrations/`. NNN is a zero-padded sequence number continuing from the last file in that service's directory.

**To add a new migration:**
1. Create `services/<service>/migrations/NNN_description.up.sql` with the schema change
2. Create a matching `NNN_description.down.sql` (rollback SQL, or a stub comment if rollback is not supported)
3. Test locally: `./scripts/db-migrate.sh`
4. On DigitalOcean, the `db-migrator` PRE_DEPLOY job runs automatically on every deploy — no manual step needed

---

## n8n Cloud Integration

Each service exposes HTTP webhook handlers (under `/webhooks/n8n/`) on the HTTP port (80XX) alongside the Connect-RPC routes. n8n workflows trigger on external events (alerts, schedule, external APIs) and call these handlers.

Pattern:
```
n8n Cloud → POST /webhooks/n8n/<action> → service webhook handler → internal gRPC client → target service
```

Connect-RPC is also directly callable from n8n via HTTP POST to the service's Connect-RPC endpoint (port 80XX), using JSON or protobuf encoding.

---

## Generating Proto Stubs

```bash
cd packages/proto
buf generate          # generates TypeScript, Python, Go stubs
buf lint              # lint all protos
buf breaking --against '.git#branch=main'  # check for breaking changes
```

Generated output:
- `packages/proto/gen/go/` — Go stubs (consumed by Go services as local module)
- `packages/proto/gen/python/` — Python stubs (installed via pip -e)
- `packages/proto/gen/ts/` — TypeScript stubs (consumed by Node.js + Next.js)

---

## Repository Bootstrap

```bash
./scripts/bootstrap.sh   # installs buf, sets up local db, seeds config
./scripts/buf-gen.sh     # runs buf generate
./scripts/db-migrate.sh  # runs all service migrations in dependency order
```

---

## CI/CD Overview

- **buf lint + breaking check** on every proto PR
- **Per-service CI** runs in each service repo on push
- **Integration tests** defined in `docs/runbooks/` and run via scripts

---

## Inter-Service Dependencies

```
xstockstrat-trader (UI)
  └── xstockstrat-trading (gRPC)
        ├── xstockstrat-marketdata (gRPC)
        ├── xstockstrat-portfolio (gRPC)
        ├── xstockstrat-indicators (gRPC)
        └── xstockstrat-ledger (gRPC write)

xstockstrat-insights (UI)
  └── xstockstrat-analysis (gRPC)
        ├── xstockstrat-marketdata (gRPC)
        ├── xstockstrat-indicators (gRPC)
        └── xstockstrat-ledger (gRPC read)

All services → xstockstrat-config (WatchConfig stream at startup)
All services → xstockstrat-ledger (event writes)
All services → xstockstrat-notify (alert emissions)
xstockstrat-ingest → xstockstrat-marketdata (raw data push)
```

---

## Git Subtree Workflow

Each `services/<name>/` directory is linked to its own remote GitHub repo via `git subtree`. The monorepo remains the canonical source; service repos are mirrors for independent CI and direct service work.

### Initial Setup (run once)

Requires `gh` CLI installed and authenticated (`gh auth login`):

```bash
./scripts/subtree-setup.sh
```

This creates each service's GitHub repo, splits the `services/<name>/` history, and pushes to `main` on each remote.

### Push changes (monorepo → service repo)

```bash
./scripts/subtree-sync.sh push xstockstrat-config   # single service
./scripts/subtree-sync.sh push all                  # all services
```

### Pull changes (service repo → monorepo)

```bash
./scripts/subtree-sync.sh pull xstockstrat-config   # single service
./scripts/subtree-sync.sh pull all                  # all services
```

### Rules

- **Never edit `services/<name>/` in both the monorepo and the service repo between syncs** without pulling first — this will cause merge conflicts.
- Always run `subtree-sync.sh pull <service>` before starting work if someone else may have pushed directly to a service repo.
- `git subtree pull` uses `--squash` to keep monorepo history clean.
- Service remotes are named after the service (e.g., `xstockstrat-config`). View all with `git remote -v`.

---

## Feature Roadmap

Active and completed feature implementations are tracked under `docs/roadmap/features/`. Each feature directory contains:
- `feature.md` — lifecycle status (`idea`/`draft`/`spec-ready`/`implementation-ready`/`in-progress`/`code-completed`/`launched`/`rolled-back`/`demoted/canceled`), links to all artifacts
- `product-spec.md` — requirements, affected services, governance gates
- `implementation-spec.md` — numbered steps with concrete code references and statuses
- `context.md` — append-only session log of decisions, deviations, files modified

**When starting any session involving an in-progress feature:**
1. Run `/sdd-status` to see all features and their lifecycle status.
2. Read `docs/roadmap/features/<slug>/context.md` before touching any related files — it contains critical decisions from prior sessions.
3. Do NOT rely on conversation context from a previous session. Always re-read context.md.

SDD skills: `/sdd-story` → `/sdd-spec` → `/sdd-execute` (loop) | `/sdd-status` (anytime)
