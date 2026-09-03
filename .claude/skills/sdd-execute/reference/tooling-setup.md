# sdd-execute — TOOLING SETUP (mandatory, once per session)

Load and run this **once per session**, after the STEP SELECTOR resolves the step set and before
BRANCH SYNC / Phase 1 of the first step. Its job: make the toolchain the selected steps need present
**up front**, so a missing/broken tool becomes a blocker you raise *before* execution — not a failure
discovered mid-step that stops the run or (worse) causes a step or its verification to be silently
skipped. That silent skip is a **P-03** violation; this phase is how you prevent it.

**Install only what the selected steps need — nothing speculative** (behavior #2 / DRY). A UI-only
step does not pull the Go toolchain; a docs step installs nothing. Do **not** "install everything just
in case," and do **not** run `scripts/bootstrap.sh` wholesale — it starts TimescaleDB and runs
migrations, which the offline-migration rule (SKILL.md Phase 3 / HARD CONSTRAINTS) forbids in the
execute loop. Pull only the pieces below.

## 1. Collect the step set

- Single-step selector (`next` / a number): the target step **plus its paired `test` step** (whose
  `**Verification**` may need the same or extra tools).
- `all` / `sequential`: every `pending` step in scope for this session/feature.

## 2. Derive the required tools

Scan each step's `**Service**`, category, and `**Verification**` command against this map. Pin every
version to root `CLAUDE.md` § Language Versions & Tooling — never a floating latest for a pinned tool.

| Step signal | Tools needed | Get it via (only if missing) |
|---|---|---|
| Go `service`/`test` (`xstockstrat-{trading,portfolio,marketdata}`) | Go 1.25, `golangci-lint` v2.5.0 | Go toolchain usually present; `go install github.com/golangci/golangci-lint/cmd/golangci-lint@v2.5.0`; run Go commands with `GOWORK=off` |
| Python `service`/`test` (`xstockstrat-{indicators,ingest,analysis}`) | Python 3.12, `uv`, `ruff`, pytest | `uv sync --extra dev` in the service dir (installs deps incl. ruff/pytest); `uv` itself via `pip install uv` if absent |
| Node/Next `service`/`test` (`xstockstrat-{ledger,identity,notify,config,ui}`) | Node 22, `pnpm` 9.15.0 | `corepack enable && corepack prepare pnpm@9.15.0 --activate` (or `npm install -g pnpm@9.15.0`), then `pnpm install --frozen-lockfile` |
| `xstockstrat-ui` e2e (`test` step using Playwright) | Full suite: the cached `Dockerfile.e2e` image. Single spec: pre-provisioned Chromium (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`) | **Full-suite / CI-parity run → prefer Docker:** `./scripts/run-e2e.sh` builds the image once (cached) and runs Playwright inside it — no host `pnpm install`. **Single-spec iteration stays host-native** (`pnpm --filter xstockstrat-ui exec playwright test <spec>`) — browsers are pre-provisioned, so **never run `playwright install`** (env note). |
| `proto` / `proto-gen` step | `buf` + Go/TS/Python codegen plugins, pinned to the CI `proto-freshness` job | **Prefer Docker — installs nothing on the host.** `./scripts/localenv-setup.sh` builds the version-pinned `Dockerfile.codegen` image **once** (cached for the rest of the session) and runs `buf-gen.sh` inside it. Start the daemon first if needed (`dockerd &` as root; up in ~1s); the script auto-trusts the agent-proxy CA (`/root/.ccr/ca-bundle.crt`, threaded into the build as a BuildKit secret), so the container path works in agent sessions. **Host-native fallback** — only when the Docker daemon is genuinely unavailable / egress fully blocked: provision per `docs/runbooks/codegen-toolchain-host-setup.md`, then `./scripts/buf-gen.sh`. |
| `migration` step | **none** | Verified offline (up/down parity + `NNN`). **Do not install or start a database.** |
| `config` / `docs` step | none (unless its `**Verification**` names a specific tool) | — |

If a step's `**Verification**` names a tool not covered above, add it to the set — read the command,
don't guess.

## 3. Probe, then install only the gaps

For each required tool: probe presence and version (`<tool> --version` / `which <tool>`). Install
**only** the missing or wrong-version pieces, pinned. For services, the dependency install
(`uv sync` / `pnpm install` / `go mod download`) is part of setup — a mid-step `ModuleNotFound` /
missing-package failure is exactly what this phase prevents.

## 4. Announce + record

Print a compact summary and append a one-line note to `context.md`:
```
Tooling setup (steps <list>): go1.25 ✓ · golangci-lint ⬇ v2.5.0 · uv ✓ · ruff ✓ (uv) · pnpm ✓ 9.15.0 · buf ✗ (blocked → host fallback)
```
Legend: `✓` present · `⬇` installed now · `✗` unavailable (with the decided fallback/blocker).

## 5. Blocker on failure — never start executing with a known-missing tool

If a required tool is missing and cannot be installed (egress blocked, version conflict, etc.), do
**not** proceed into the steps. Decide it here, up front:

- **proto codegen** → default to the **Docker** codegen image: start the daemon if needed
  (`dockerd &` as root) and run `./scripts/localenv-setup.sh`, which builds the version-pinned
  `Dockerfile.codegen` image once (cached for the session) and generates the stubs inside it — no
  host toolchain install. It auto-trusts the agent-proxy CA (`/root/.ccr/ca-bundle.crt`) via a
  BuildKit secret, so the container build no longer fails on TLS. **Host-native fallback** — only
  when the Docker daemon is genuinely unavailable (egress fully blocked): provision the toolchain per
  `docs/runbooks/codegen-toolchain-host-setup.md` (pinned to CI `proto-freshness` versions), then
  `./scripts/buf-gen.sh`. Only if **both** paths are impossible → blocker.
- **Playwright dev-server / browser issue** → first try the **Docker e2e runner**
  (`./scripts/run-e2e.sh`), which runs its own dev-server and Chromium inside the container and so
  sidesteps a flaky host harness. Only if Docker is also unavailable, adopt the documented
  **`tsc --noEmit` + `pnpm run lint`** e2e fallback now (the same fallback the verification step would
  otherwise reach for), and note it — so the `test` step doesn't discover it mid-run.
- **Anything else required but unavailable** → stop with:
  `Tooling blocker: <tool> is required by Step(s) <N> but is unavailable. Options: <install path / documented fallback / skip-and-block those steps>.`
  In **sequential mode** present this via `AskUserQuestion` (a §5.7 blocker), never decide unilaterally.

A fallback that diverges from the step's specced tool is a `## Deviation Log` entry
(`**Disposition**: CI-equivalent fallback`) — same rule as the sequential-mode verification fallbacks.
