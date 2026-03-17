# xstockstrat-orchestration — Root CLAUDE.md

## Project Overview

**xstockstrat-orchestration** is the spine repository for the xstockstrat platform — a hybrid multi-repo stock strategy system built on the **Spine pattern**. This repo owns:
- `packages/proto/` — single source of truth for all gRPC/Protobuf contracts
- `_tasks/` — cross-service workflow runbooks
- `scripts/` — codegen, bootstrap, and CI helpers
- Root-level config governance documentation (this file)

All service repos are siblings under `services/`. They consume generated code from `packages/proto/` and coordinate via gRPC.

---

## Service Registry

| Service | Language | Role | Port |
|---|---|---|---|
| xstockstrat-trading | Go | Order execution, trade lifecycle | 50051 |
| xstockstrat-portfolio | Go | Position tracking, P&L | 50052 |
| xstockstrat-marketdata | Go | Alpaca feed ingestion, OHLCV storage | 50053 |
| xstockstrat-indicators | Python | Formula engine, sandboxed execution | 50054 |
| xstockstrat-ingest | Python | Raw data normalization, event publishing | 50055 |
| xstockstrat-analysis | Python | Strategy scoring, backtesting | 50056 |
| xstockstrat-ledger | Node.js | Append-only event store | 50057 |
| xstockstrat-identity | Node.js | Auth, API keys, JWT | 50058 |
| xstockstrat-notify | Node.js | gRPC streaming alert delivery | 50059 |
| xstockstrat-config | Node.js | Live config WatchConfig gRPC stream | 50060 |
| xstockstrat-trader | Next.js | Trading UI frontend | 3000 |
| xstockstrat-insights | Next.js | Analytics/insights dashboard | 3001 |

---

## Language Map

```
Go        → xstockstrat-trading, xstockstrat-portfolio, xstockstrat-marketdata
Python    → xstockstrat-indicators, xstockstrat-ingest, xstockstrat-analysis
Node.js   → xstockstrat-ledger, xstockstrat-identity, xstockstrat-notify, xstockstrat-config
Next.js   → xstockstrat-trader, xstockstrat-insights
```

---

## Spine Pattern

The **Spine** is this orchestration repo. It does not contain runtime service code. It owns:
1. **Proto contracts** (`packages/proto/`) — all `.proto` files; all generated stubs live here after `buf generate`
2. **Task runbooks** (`_tasks/`) — step-by-step operational workflows
3. **Scripts** (`scripts/`) — `buf-gen.sh`, `bootstrap.sh`, `db-migrate.sh`
4. **Config schema** — canonical list of config keys consumed by each service

Services reference this repo as a git submodule or via the generated package registry (npm, PyPI, Go module proxy) depending on language.

---

## Proto Contract Governance

- All `.proto` changes require a PR to **this repo** first.
- Breaking changes (field removal, type change, service rename) require:
  1. Deprecation comment in `.proto` for one release cycle
  2. Migration note in `_tasks/x-config-rollout.md`
  3. Approval from 2 service owners (see Approval Flow below)
- `buf lint` and `buf breaking` run on every PR via CI.
- Generated stubs are committed to `packages/proto/gen/` and versioned.

---

## Approval Flow

See `_tasks/x-approval-flow.md` for full detail. Summary:

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

All runtime configuration is served by **xstockstrat-config** via gRPC `WatchConfig` streaming RPC. Rules:

1. **No hardcoded config values** in service source code. All env-specific values must be registered in the config service.
2. **Config key naming convention**: `<service-short-name>.<category>.<key>` — e.g., `indicators.sandbox.timeout_ms`
3. **All services subscribe to xstockstrat-config at startup** before accepting traffic.
4. **Config changes flow via n8n** → config webhook handler → config service gRPC → WatchConfig stream → all subscribers.
5. **Sensitive keys** (API keys, secrets) use the `secret.*` prefix and are resolved from the secret store at runtime; they are never stored in config service state.
6. **Default values** must be declared in each service's `CLAUDE.md` under "Config Keys".

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

All services run their own migrations against their own schema. Migration tool: **golang-migrate** (Go), **Alembic** (Python), **db-migrate** (Node).

---

## n8n Cloud Integration

Each service exposes HTTP webhook handlers (under `/webhooks/n8n/`) that translate incoming n8n payloads to internal gRPC calls. n8n workflows trigger on external events (alerts, schedule, external APIs) and call these handlers.

Pattern:
```
n8n Cloud → POST /webhooks/n8n/<action> → service webhook handler → internal gRPC client → target service
```

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
- **Integration tests** defined in `_tasks/` runbooks and run via scripts

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
