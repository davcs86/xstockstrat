---
name: onboard
description: Interactive new-dev setup — prereqs, env file, proto gen, bootstrap, health checks.
argument-hint: (no arguments)
allowed-tools: Read Bash(ls *) Bash(find *) Bash(cat *) Bash(docker *) Bash(openssl *) Bash(command -v *) Bash(./scripts/check-prereqs.sh) Bash(./scripts/localenv-setup.sh) Bash(./scripts/bootstrap.sh) Bash(docker compose *)
effort: medium
---

# /onboard — New Developer Environment Setup

Walk the developer through every setup step, detecting what's already done to avoid repeating work. Never skip a phase — always report status even when a phase is already complete.

## Boot Sequence

Resolve repo root:

```bash
git rev-parse --show-toplevel
```

Store as `REPO_ROOT`. All file checks and script invocations use this absolute path.

---

## Phase 1: Prerequisite Check

Run the prereq check script and show its output verbatim:

```bash
cd "$REPO_ROOT" && ./scripts/check-prereqs.sh
```

The script checks two tiers:

**Hard (exits 1 if missing):** `docker` with daemon running. All services, proto codegen, and migrations run in containers.

**Soft (warns, never blocks):** `go`, `golangci-lint`, `python3`, `node`, `pnpm`. These are only needed for local test and lint runs; their absence does not affect the running stack.

**If the script exits 1:** Docker is missing or not running. Tell the user to install Docker / start Docker Desktop (Linux: `sudo systemctl start docker`) and re-run `/onboard`. Do NOT proceed to Phase 2.

**If the script exits 0 with soft warnings:** note which language toolchains are missing and that local tests/linters for those languages won't work. Proceed to Phase 2.

---

## Phase 2: Environment File Check

Check whether `.env` exists:

```bash
ls "$REPO_ROOT/.env" 2>/dev/null
```

**If missing:**

1. Show: "`.env` not found. Copying from `.env.example`..."
2. Read `$REPO_ROOT/.env.example` to show the user which vars they must fill in.
3. Tell the user to run: `cp .env.example .env` then edit `.env`.
4. Required vars to fill in:
   - `ALPACA_API_KEY` — paper trading key from alpaca.markets (see `docs/setup/alpaca.md`)
   - `ALPACA_API_SECRET` — matching secret
   - `JWT_SECRET` — generate with: `openssl rand -hex 32`
   - `DATABASE_URL` — leave the default for local dev (docker-compose sets this for all containers)
5. Ask the user to confirm when `.env` is filled before continuing.

**If present:** Report "`.env` exists — skipping." Do not read or display its contents.

---

## Phase 3: Bootstrap

Summarise what `bootstrap.sh` will do:
- Re-run `check-prereqs.sh` (confirms Docker is running)
- If proto stubs are absent in `packages/proto/gen/`, run `localenv-setup.sh` automatically to generate them inside a Docker container (takes a few minutes on first run)
- If `pnpm` is installed: install Node.js deps for all 7 Node/Next.js services (enables local test/lint)
- If `python3` is installed: install Python deps for all 3 Python services (enables local test/lint)

Language dep installs are conditional — bootstrap succeeds without them. TimescaleDB and DB migrations run automatically in Phase 4 via `docker compose`.

Ask the user to confirm before running (proto gen triggers a Docker build if stubs are absent).

On confirmation:

```bash
cd "$REPO_ROOT" && ./scripts/bootstrap.sh
```

If bootstrap exits non-zero, display the last 20 lines of output and suggest:
- Docker not running → start Docker Desktop, re-run `/onboard`
- Proto gen failure → re-run `./scripts/localenv-setup.sh` manually to see full error output

---

## Phase 4: Services Up + Health Checks

Tell the user you'll now start all 13 services with Docker Compose.

Ask confirmation (this builds Docker images on first run — can take several minutes).

On confirmation:

```bash
cd "$REPO_ROOT" && docker compose up -d
```

After the command returns, check service health:

```bash
docker compose ps
```

Look for services showing `Exit` or `unhealthy` state. If any are unhealthy:
- Show: `docker compose logs <service-name> --tail=30`
- Point to the Troubleshooting section in `docs/setup/getting-started.md`

Spot-check the three most critical services with curl:

```bash
curl -s --max-time 5 http://localhost:8060/health   # config
curl -s --max-time 5 http://localhost:8058/health   # identity
curl -s --max-time 5 http://localhost:8057/health   # ledger
```

Report each as ✓ (200 response) or ✗ (error/timeout). If config is ✗, highlight that all other services depend on it and check its logs first.

---

## Phase 5: Local Tests & Linters

Check which language toolchains are available:

```bash
command -v go && command -v golangci-lint && command -v python3 && command -v node && command -v pnpm
```

For each toolchain that is **present**, show the user the exact commands to run for that language group. Do not execute them (tests can be slow); just display and explain.

**Go** (if `go` and `golangci-lint` are present):
```bash
# Run from each service directory. GOWORK=off is required — matches CI.
cd services/xstockstrat-trading    && GOWORK=off go test -race ./...
cd services/xstockstrat-portfolio  && GOWORK=off go test -race ./...
cd services/xstockstrat-marketdata && GOWORK=off go test -race ./...

cd services/xstockstrat-trading    && golangci-lint run
cd services/xstockstrat-portfolio  && golangci-lint run
cd services/xstockstrat-marketdata && golangci-lint run
```

**Python** (if `python3` is present):
```bash
cd services/xstockstrat-indicators && pytest --cov && ruff check . && ruff format --check .
cd services/xstockstrat-ingest     && pytest --cov && ruff check . && ruff format --check .
cd services/xstockstrat-analysis   && pytest --cov && ruff check . && ruff format --check .
```

**Node.js** (if `pnpm` is present):
```bash
cd services/xstockstrat-ledger   && pnpm run lint && pnpm run test:coverage
cd services/xstockstrat-identity && pnpm run lint && pnpm run test:coverage
cd services/xstockstrat-notify   && pnpm run lint && pnpm run test:coverage
cd services/xstockstrat-config   && pnpm run lint && pnpm run test:coverage
```

**Next.js E2E** (if `pnpm` is present; requires services running first):
```bash
cd services/xstockstrat-trader     && pnpm run lint && pnpm exec playwright test
cd services/xstockstrat-insights   && pnpm run lint && pnpm exec playwright test
cd services/xstockstrat-config-ui  && pnpm run lint && pnpm exec playwright test
```

For any toolchain that is **absent**, note which services' tests/linters cannot run locally and remind the user to install that toolchain and re-run `./scripts/bootstrap.sh` to get the deps installed.

---

## Phase 6: Next Steps Routing

All services are running. Ask the user what they want to do next (present numbered options):

1. **Start a new feature** → run `/sdd-story <slug>` (explain: Phase 1 of the SDD loop — generates a product spec)
2. **Fix a reported bug** → run `/sdd-triage <issue-number>` (classifies severity and routes to the correct fix track)
3. **Explore the codebase** → read `CLAUDE.md` for the full architecture reference, then `docs/roadmap/implementation-roadmap.md` to understand what was built and what's pending
4. **Change a config value** → read `docs/runbooks/config-rollout.md` for the safe rollout procedure

Print the exact command or file path for the chosen option. If the user says "all done" or similar, confirm that their environment is set up and wish them well.
