# Reviewer Registry

Maps services and roles to review focus criteria. Consumed by `/sdd-review` to determine
which criteria apply during product-spec and impl-spec review. Not a GitHub PR assignment
list — this drives AI review focus, not notifications.

---

## Service Owners

| Service | Review Focus |
|---|---|
| `xstockstrat-trading` | Order execution correctness, broker API safety, fill detection, paper-only dev invariant, position limit enforcement |
| `xstockstrat-portfolio` | P&L calculation accuracy, position snapshot consistency, concurrent write safety |
| `xstockstrat-marketdata` | OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency |
| `xstockstrat-indicators` | Formula sandboxing, numeric precision, timeout enforcement (`indicators.sandbox.timeout_ms`), no side-effects from formula execution |
| `xstockstrat-ingest` | Signal normalization correctness, idempotent ingestion, newsletter source schema stability |
| `xstockstrat-analysis` | Backtest reproducibility, strategy scoring determinism, no look-ahead bias |
| `xstockstrat-ledger` | Append-only invariant (no deletes or updates), event ordering, hypertable partition safety |
| `xstockstrat-identity` | JWT expiry and rotation, API key scoping, secret store integration (never plaintext secrets in config) |
| `xstockstrat-notify` | Stream delivery guarantees, backpressure handling, alert deduplication |
| `xstockstrat-config` | Config key naming (`<service>.<category>.<key>`), environment/trading_mode scoping, WatchConfig stream stability |
| `xstockstrat-trader` | Trading UI correctness, Connect-RPC call safety, no direct DB access from frontend |
| `xstockstrat-insights` | Analytics display accuracy, SSE polling resilience, read-only access pattern |
| `xstockstrat-config-ui` | Config mutation safety, environment scope correctness, no secret values rendered in UI |
| `packages/proto` | Field number uniqueness, backward compatibility (no field removal or type change without deprecation), naming conventions |

---

## Role Reviewers

| Role | Scope | Review Criteria |
|---|---|---|
| Platform Lead | Cross-service architecture, new service additions, port assignments | Port uniqueness, service registry consistency, inter-service dependency graph correctness |
| DBA | All database schema changes | Migration NNN numbering (no gaps, no conflicts), up+down pair present, hypertable partitioning strategy, index correctness, run-order compliance with `scripts/db-migrate.sh` |
| Proto Reviewer | All `.proto` file changes | Field number uniqueness per message, no breaking changes without deprecation comment, `buf lint` passes, `buf breaking` passes against dev trunk, BSR publication readiness |
| Security | Identity, API keys, secrets, auth scope | No secrets in config service state, secret keys use `secret.*` prefix, JWT claims minimal, API key scoping correct |

---

## Step Category → Reviewer Roles

Machine-readable governance matrix used by `/sdd-review` to assign reviewers per step.

| Step Category | Reviewer Roles |
|---|---|
| `proto` | Proto Reviewer + service owner(s) of all affected services |
| `proto-gen` | Inherited from the immediately preceding `proto` step (same reviewers) |
| `migration` | DBA + service owner of the service owning the migration |
| `service` | Service owner of the service being modified |
| `config` | Service owner of the service adding/changing the config key |
| `test` | Service owner of the service being tested |
| `docs` | None |

---

## Notes

- This file is a **snapshot source** for `/sdd-spec`. When `/sdd-spec` runs, it reads this
  file and writes a stable `## Reviewers` table into `feature.md`. That snapshot is what
  governs the feature's review criteria, even if this registry later changes.
- To pick up registry changes for an in-flight feature, re-run `/sdd-spec <slug>`, which
  overwrites the snapshot.
- GitHub handles are intentionally omitted. This registry drives AI review criteria, not
  PR assignments. Team handles belong in an external roster tool.
