# xstockstrat-orchestration

Spine repository for the xstockstrat platform — a hybrid multi-repo stock strategy system. This repo owns all gRPC/Protobuf contracts (`packages/proto/`), documentation (`docs/`), and bootstrap scripts (`scripts/`). Thirteen microservices in Go, Python, Node.js, and Next.js live in `services/` as git subtrees, each mirrored to its own GitHub repo.

## Quick Links

| Topic | Resource |
|---|---|
| **Getting Started** | [`docs/setup/getting-started.md`](docs/setup/getting-started.md) |
| Architecture Reference | [`CLAUDE.md`](CLAUDE.md) |
| Runbooks | [`docs/runbooks/CLAUDE.md`](docs/runbooks/CLAUDE.md) |
| External Service Setup | [`docs/setup/`](docs/setup/) |
| Implementation Roadmap | [`docs/roadmap/implementation-roadmap.md`](docs/roadmap/implementation-roadmap.md) |
| Feature Workflow (SDD) | [`docs/runbooks/feature-workflow.md`](docs/runbooks/feature-workflow.md) |
| Bug Triage | [`docs/runbooks/bug-triage.md`](docs/runbooks/bug-triage.md) |
| CI Workflow | [`.github/workflows/ci.yml`](.github/workflows/ci.yml) |

## Service Registry

| Service | Language | gRPC | HTTP |
|---|---|---|---|
| xstockstrat-trading | Go | 50051 | 8051 |
| xstockstrat-portfolio | Go | 50052 | 8052 |
| xstockstrat-marketdata | Go | 50053 | 8053 |
| xstockstrat-indicators | Python | 50054 | 8054 |
| xstockstrat-ingest | Python | 50055 | 8055 |
| xstockstrat-analysis | Python | 50056 | 8056 |
| xstockstrat-ledger | Node.js | 50057 | 8057 |
| xstockstrat-identity | Node.js | 50058 | 8058 |
| xstockstrat-notify | Node.js | 50059 | 8059 |
| xstockstrat-config | Node.js | 50060 | 8060 |
| xstockstrat-trader | Next.js | — | 3000 |
| xstockstrat-insights | Next.js | — | 3001 |
| xstockstrat-config-ui | Next.js | — | 3002 |

Full details (roles, dependencies, config keys) → [`CLAUDE.md`](CLAUDE.md).

## Bootstrap

```bash
./scripts/localenv-setup.sh   # build proto-gen container + generate stubs (run once after clone)
./scripts/bootstrap.sh        # install deps, start TimescaleDB, run migrations
docker compose up -d          # start all 13 services
```

See [`docs/setup/getting-started.md`](docs/setup/getting-started.md) for prerequisites, environment file setup, and verification steps.
