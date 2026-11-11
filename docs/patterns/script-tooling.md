# Script Tooling — Language Choice, Tests, and the Bash → Python Port

Read this before adding, porting, or testing anything under `scripts/`.

## Rules

1. **New tooling is Python**, stdlib-only, one standalone file per tool, runnable as `python3 scripts/<name>.py`
   on a stock GitHub runner and on macOS. A third-party dependency needs a PEP 723 header and `uv run`
   (`manage-users.py` is the precedent) — avoid it for anything CI or a deploy calls.
2. **Every Python script has a pytest module** in `scripts/tests/test_<name>.py`. Import the script with
   `conftest.load_script("<file>.py")`; keep work in functions and `main()` behind `if __name__ == "__main__"`.
3. **Stay in shell** when the script runs inside an image with no Python interpreter (see Tier R0), or when it
   is a thin wrapper around one command. A shell script that carries logic needs a `<name>.test.sh` wired
   into the `shell-lint` job.
4. **A port is a hard cutover**: delete the `.sh`, add the `.py`, and update every caller in the same PR —
   workflows, Dockerfiles, compose, `.husky/`, other scripts, docs, skills and `CLAUDE.md` files. No shim.
5. **A port must be behaviour-identical** at its boundary: same arguments, exit codes, stdout/stderr contract
   and environment variables. Port the existing `.test.sh` assertions into pytest first and see them fail
   before the port exists, then pass against it.

## Harness

| Piece | Where |
|---|---|
| Dev dependencies (pytest, ruff) + lock | `scripts/pyproject.toml`, `scripts/uv.lock` |
| Tests | `scripts/tests/` |
| Local run | `cd scripts && uv run --extra dev pytest && uv run --extra dev ruff check . && uv run --extra dev ruff format --check .` |
| CI | `scripts-python` job (on the `scripts` filter and `ci`), required by `ci-gate` |

`scripts/config-wiring-fixtures/` is excluded from ruff: `config-wiring.test.mjs` asserts line numbers in it.

## Tiers — what may be ported

The tier is the script's blast radius, and decides whether a port is allowed.

| Tier | Meaning | Port? |
|---|---|---|
| **R0** | Copied into a runtime image that has no Python (Node leaf images, the `postgres:16-alpine` migrator) | **No** — a port means adding an interpreter to the boot or migration path |
| **R1** | Called by a deploy or bring-up workflow, or by compose | Yes, one script per PR, verified by a staging bring-up |
| **R2** | CI gate only | Yes |
| **R3** | Developer-local | Yes |

## Disposition (audit of 2026-11-11)

| Script | Tier | Tests today | Disposition |
|---|---|---|---|
| `docker-entrypoint.sh`, `wait-for-deps.sh` | R0 | none | Keep in `sh` (7 service images) |
| `db-migrate.sh`, `render-migrations.sh`, `migration-dirty-guard.sh`, `migration-ahead-check.sh` | R0 | `.test.sh` ×3 | Keep in bash (migrator image) |
| `migration-rerun.sh`, `config-heal-dryrun.sh`, `config-wiring-stored.sh` | R2, but executed **inside** the migrator image | none | Blocked on a decision: keep in bash, or run from the runner against a Postgres service container |
| `do-db-cluster.sh` | R1 | via `sops-secrets.test.sh` (stub `doctl`) | Port |
| `homelab-release-env.sh`, `homelab-render-check.sh` | R1 | `homelab-render.test.sh` | Port |
| `ui-theme-label.sh` | R1 (`deploy.yml`, `staging-up.yml`) | `ui-theme-label.test.sh` | Port |
| `mtls-provision.sh`, `gen-dev-certs.sh`, `mtls-dev-env.sh` | R1 | `gen-dev-certs.test.sh`, `sops-secrets.test.sh` | Port (`openssl` stays a subprocess) |
| `check-context-map.sh`, `check-watcher-copies.sh`, `check-migration-contract.sh`, `check-otel-produced-signals.sh`, `sdd-allocate-feature-number.sh` | R2 | `.test.sh` for three; none for `check-context-map`, `check-watcher-copies` | Port |
| `buf-gen.sh` | R2 + `Dockerfile.codegen` | none | Keep: a linear wrapper around `buf`, run in the codegen image |
| `check-duplication.sh` | R3 (husky) | none | Port |
| `setup-env.sh`, `integration-test.sh`, `bootstrap.sh`, `check-prereqs.sh`, `localenv-setup.sh`, `run-e2e.sh`, `db-connect.sh`, `do-setup-check.sh`, `security-audit.sh`, `setup-branch-protection.sh` | R3 | none | Port, largest first by logic density; `bootstrap.sh`/`localenv-setup.sh` stay thin if what remains is a command list |
| `sops-secrets.test.sh`, `homelab-render.test.sh` and the other `*.test.sh` | — | — | Move to pytest together with the script they test; delete when empty |
| `ledger-guard.py`, `homelab-mtls-env.py`, `config-wiring-py-reads.py`, `do-render-app-spec.py`, `sops_secrets.py`, `manage-users.py` | — | pytest | Done |
| `build-launch-pdfs.py`, `measure-insertbars-cost.py` | R3 | none | Lint only: one needs WeasyPrint, the other a live `pg_stat_statements` |
| `check-config-wiring.mjs`, `merge-train-resolve.mjs` | R2 | `node --test` | Keep in Node (already tested) |

## Port order

1. Harness (this document, `scripts-python`, tests for the existing Python scripts) — no behaviour change.
2. R2 gates without a test today (`check-context-map`, `check-watcher-copies`), then the tested R2 gates.
3. R3, starting with `setup-env.sh` and `integration-test.sh`.
4. R1, one script per PR, each followed by a staging bring-up before the next.
