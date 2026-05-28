# xstockstrat

**Cross Stock Strategies** — an end-to-end stock strategy platform: real-time market data ingestion, indicator computation, backtesting, paper/live order execution, and three Next.js operator UIs, wired together by 10 gRPC microservices and a config service that streams live configuration to everything else.

> **Built with AI agents, end to end.** Every feature in this repo — from the proto contracts to the Next.js dashboards to the CI/CD pipelines — was specified, implemented, reviewed, and shipped through an agentic Spec-Driven Development (SDD) loop running on [Claude Code](https://claude.com/claude-code). See [§ Agentic Development](#agentic-development) below for what that actually means in practice.

---

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

---

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
| xstockstrat-nginx | Nginx | — | 80 |
| xstockstrat-agent | Python (MCP) | — | 9000 |

Full details (roles, dependencies, config keys) → [`CLAUDE.md`](CLAUDE.md).

---

## Bootstrap

```bash
cp .env.example .env          # fill in ALPACA_API_KEY, ALPACA_API_SECRET, JWT_SECRET
./scripts/bootstrap.sh        # verify Docker, generate proto stubs
docker compose up -d          # start TimescaleDB, run migrations, start all services
```

See [`docs/setup/getting-started.md`](docs/setup/getting-started.md) for prerequisites, environment file setup, and verification steps.

---

## Agentic Development

This repository was built almost entirely through **agent-assisted Spec-Driven Development**. The pattern is generalizable to any sufficiently complex multi-service codebase; this repo is the worked example.

### How it works

1. **A human writes a one-line user story.** Something like *"add IBKR account support"* or *"remove the n8n webhook layer"*.
2. **The agent expands the story into a product spec** (`/sdd-story`) — affected services, governance gates, reviewers, acceptance criteria. A second agent reviews it (`/sdd-review product-spec`) before it can advance.
3. **The agent searches the codebase for evidence** (`/sdd-spec`) and writes a numbered implementation spec where every step cites real file paths and symbol names found via grep. No invented references.
4. **The agent executes one step at a time** (`/sdd-execute`), opening a per-step PR into the feature branch. Each step requires explicit human confirmation before any write.
5. **Status updates are mechanical, not discretionary** — CI flips a feature from `code-completed` to `launched` automatically when its commit lands on `main`.

The artifacts of this loop are checked in: every active and shipped feature has a `feature.md` (lifecycle status), `product-spec.md` (requirements), `implementation-spec.md` (evidence-cited steps), and `context.md` (append-only session log). Browse [`docs/roadmap/features/`](docs/roadmap/features/) for examples — feature `001-add-ikbr-account-support` and `004-make-repo-public-secure` are both fully launched and show the full lifecycle from story through promotion to production.

### Why it matters

- **The spec is the contract.** When an agent picks up a feature in a fresh session days later, it re-reads `context.md` and continues exactly where the previous session stopped. No conversation memory required.
- **Drift is detectable.** `buf breaking` blocks contract regressions; the CI `proto-freshness` job blocks stub drift; status updates happen in CI rather than by hand. Humans review intent; the harness enforces invariants.
- **The codebase is the evidence.** Every step in every implementation spec is anchored to a file path or symbol the agent actually grep'd. When you read the spec, you can verify the claim.

### What's checked in

- **SDD skills** — `.claude/skills/sdd-story`, `sdd-spec`, `sdd-execute`, `sdd-review`, `sdd-status`, `sdd-sync`, `sdd-triage`, `promote`. These are reusable across any spine-pattern repo.
- **Setup skills** — `.claude/skills/digitalocean-setup`, `onboard`, `proofread-claude-md`. First-time configuration and ongoing hygiene.
- **Runbooks** — [`docs/runbooks/feature-workflow.md`](docs/runbooks/feature-workflow.md), [`docs/runbooks/bug-triage.md`](docs/runbooks/bug-triage.md), [`docs/runbooks/approval-flow.md`](docs/runbooks/approval-flow.md). These describe the manual paths for anything the agent can't or shouldn't do alone.
- **CLAUDE.md files at every level** — [root](CLAUDE.md), [`docs/`](docs/CLAUDE.md), [`docs/patterns/`](docs/patterns/CLAUDE.md), and per-service. These are agent-readable context that scales with the repo.

If you want to use a similar workflow on your own codebase, start by reading the root `CLAUDE.md` to see what an LLM-readable project description looks like, then look at any feature directory under `docs/roadmap/features/` to see the artifacts the SDD loop produces.
