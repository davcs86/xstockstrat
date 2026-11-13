# Script Tooling — Language Choice, Tests, and the Bash → Python Port

Read this before adding, porting, or testing anything under `scripts/`.

## Rules

0. **No new shell script, anywhere in the repo, unless it is copied into a runtime image (tier R0).**
   Enforced by `scripts/check-shell-freeze.py` (CI job `shell-freeze`, required by `ci-gate`) against
   `scripts/shell-allowlist.txt`: an unlisted `*.sh` fails; an `r0` entry must be named on a Dockerfile
   `COPY` line; the `legacy` set is frozen to the PR base, so lines are only ever deleted. Extending an
   existing `legacy` script with new behaviour is the same violation in spirit — port it first.
1. **New tooling is Python**, stdlib-only, one standalone file per tool, runnable as `python3 scripts/<name>.py`
   on a stock GitHub runner and on macOS. A third-party dependency needs a PEP 723 header and `uv run`
   (`manage-users.py` is the precedent) — avoid it for anything CI or a deploy calls.
2. **Every Python script has a pytest module** in `scripts/tests/test_<name>.py`. Import the script with
   `conftest.load_script("<file>.py")`; keep work in functions and `main()` behind `if __name__ == "__main__"`.
3. **Shell is allowed only in tier R0** — a script copied into a runtime image and run on its boot or
   deploy-time migration path. It needs
   a `<name>.test.sh` wired into the `shell-lint` job when it carries logic. A one-command wrapper is not an
   exception: put the command in the workflow step, the `package.json` script or the doc that needs it.
4. **A port is a hard cutover**: delete the `.sh`, add the `.py`, and update every caller in the same PR —
   workflows, Dockerfiles, compose, `.husky/`, `scripts/shell-allowlist.txt`, other scripts, docs, skills and `CLAUDE.md` files. No shim.
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
| **R0** | Copied into a runtime image and run on its boot or deploy-time migration path (the Node leaf images have no Python; the migrator ships `python3` for the CI gates, but its `db-migrate.sh` entrypoint chain stays shell) | **No** — a port changes how a service boots or how a deploy migrates. The only tier where a new shell script is allowed |
| **R1** | Called by a deploy or bring-up workflow, or by compose | Yes, one script per PR, verified by a staging bring-up |
| **R2** | CI gate only | Yes |
| **R3** | Developer-local | Yes |

## Disposition (audit of 2026-11-11)

| Script | Tier | Tests today | Disposition |
|---|---|---|---|
| `docker-entrypoint.sh`, `wait-for-deps.sh` | R0 | none | Keep in `sh` (7 service images) |
| `db-migrate.sh`, `render-migrations.sh`, `migration-dirty-guard.sh`, `migration-ahead-check.sh` | R0 | `.test.sh` ×3 | Keep in bash (migrator image) |
| `do-db-cluster.sh` | R1 | via `sops-secrets.test.sh` (stub `doctl`) | Port |
| `homelab-release-env.sh`, `homelab-render-check.sh` | R1 | `homelab-render.test.sh` | Port |
| `ui-theme-label.sh` | R1 (`deploy.yml`, `staging-up.yml`) | `ui-theme-label.test.sh` | Port |
| `mtls-provision.sh`, `gen-dev-certs.sh`, `mtls-dev-env.sh` | R1 | `gen-dev-certs.test.sh`, `sops-secrets.test.sh` | Port (`openssl` stays a subprocess) |
| `buf-gen.sh` | R2 (run inside the codegen image, which has Python) | none | Port last: a linear wrapper around `buf` with 36 doc references |
| `integration-test.sh` | R3 | none | Undecided: it still targets the removed backend HTTP ports, so delete, port as-is or rewrite against gRPC |
| `sops-secrets.test.sh`, `homelab-render.test.sh` and the other `*.test.sh` | — | — | Move to pytest together with the script they test; delete when empty |
| `check-prereqs.py`, `setup-env.py`, `bootstrap.py`, `localenv-setup.py`, `run-e2e.py`, `check-duplication.py`, `security-audit.py`, `setup-branch-protection.py`, `db-connect.py`, `do-setup-check.py`, `migration-rerun.py`, `config-wiring-stored.py`, `config-heal-dryrun.py` (+ `scratch_db.py`), `check-otel-produced-signals.py`, `check-context-map.py`, `check-watcher-copies.py`, `check-migration-contract.py`, `sdd-allocate-feature-number.py`, `check-shell-freeze.py`, `ledger-guard.py`, `homelab-mtls-env.py`, `config-wiring-py-reads.py`, `do-render-app-spec.py`, `sops_secrets.py`, `manage-users.py` | — | pytest | Done |
| `build-launch-pdfs.py`, `measure-insertbars-cost.py` | R3 | none | Lint only: one needs WeasyPrint, the other a live `pg_stat_statements` |
| `check-config-wiring.mjs`, `merge-train-resolve.mjs` | R2 | `node --test` | Keep in Node (already tested) |

## Port order

1. Harness (this document, `scripts-python`, tests for the existing Python scripts) — no behaviour change.
2. `integration-test.sh`, once its fate is decided.
3. R1, one script per PR, each followed by an operator-run `staging-up` before the next is merged.
