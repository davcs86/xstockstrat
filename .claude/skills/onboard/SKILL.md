---
name: onboard
description: Interactive new-dev setup — prereqs, env file, proto gen, bootstrap, health checks.
argument-hint: (no arguments)
allowed-tools: Read Bash(ls *) Bash(find *) Bash(cat *) Bash(docker *) Bash(openssl *) Bash(./scripts/check-prereqs.sh) Bash(./scripts/localenv-setup.sh) Bash(./scripts/bootstrap.sh) Bash(docker compose *)
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

The script exits 0 if all required tools are present (version mismatches are warnings, not errors) and exits 1 if any hard requirement is missing.

**Hard requirements** (script exits 1 if absent): `docker` with daemon running. Git is always present if the user cloned the repo.

**Soft requirements** (version mismatch = warning, not failure): `go`, `python3`, `node`, `pnpm`. These are only needed for running services directly on the host, not for Docker-first development.

`buf`, `migrate`, and `psql` are **not** checked — they run inside Docker containers and are never required on the host.

**If the script exits 1:** the most likely cause is Docker not running. Tell the user to start Docker Desktop (or `sudo systemctl start docker` on Linux) and re-run `/onboard`. Do NOT proceed to Phase 2.

**If the script exits 0 with warnings:** inform the user that version mismatches only matter if they plan to run services directly on the host. For Docker-based development, they can safely continue.

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
   - `DATABASE_URL` — leave the default for local dev; `bootstrap.sh` exports it automatically
5. Ask the user to confirm when `.env` is filled before continuing.

**If present:** Report "`.env` exists — skipping." Do not read or display its contents.

---

## Phase 3: Proto Stubs Check

Check whether stubs exist:

```bash
ls "$REPO_ROOT/packages/proto/gen/" 2>/dev/null | head -3
```

**If directory is missing or empty:**

1. Explain: "Proto stubs not found. Running `localenv-setup.sh` to generate them inside a Docker container. This takes a few minutes on first run."
2. Ask user confirmation before proceeding (this runs Docker build).
3. On confirmation, run:
   ```bash
   cd "$REPO_ROOT" && ./scripts/localenv-setup.sh
   ```
4. Report success or surface the error output clearly.

**If stubs already exist:** Report "Proto stubs found in `packages/proto/gen/` — skipping."

---

## Phase 4: Bootstrap

Summarise what `bootstrap.sh` will do:
- Re-run `check-prereqs.sh` as a final gate
- Check for proto stubs; run `localenv-setup.sh` automatically if they are absent
- Install pnpm dependencies for 7 Node/Next.js services
- Install Python deps for 3 Python services

**Note:** TimescaleDB and DB migrations are **not** handled by `bootstrap.sh`. They run automatically in Phase 5 when `docker compose up -d` starts: TimescaleDB starts first, the `db-migrator` one-shot container applies all pending migrations, then all 13 services start.

Ask the user to confirm before running (this installs packages).

On confirmation:

```bash
cd "$REPO_ROOT" && ./scripts/bootstrap.sh
```

If bootstrap exits non-zero, display the last 20 lines of output and suggest:
- Missing tool → install it, re-run `/onboard`
- Proto gen failure → ensure Docker is running, then re-run `./scripts/localenv-setup.sh`

---

## Phase 5: Services Up + Health Checks

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

## Phase 6: Next Steps Routing

All services are running. Ask the user what they want to do next (present numbered options):

1. **Start a new feature** → run `/sdd-story <slug>` (explain: Phase 1 of the SDD loop — generates a product spec)
2. **Fix a reported bug** → run `/sdd-triage <issue-number>` (classifies severity and routes to the correct fix track)
3. **Explore the codebase** → read `CLAUDE.md` for the full architecture reference, then `docs/roadmap/implementation-roadmap.md` to understand what was built and what's pending
4. **Change a config value** → read `docs/runbooks/config-rollout.md` for the safe rollout procedure

Print the exact command or file path for the chosen option. If the user says "all done" or similar, confirm that their environment is set up and wish them well.
