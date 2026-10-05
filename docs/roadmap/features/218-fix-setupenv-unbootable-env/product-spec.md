# Product Spec: fix-setupenv-unbootable-env

**Type**: bug
**GitHub Issue**: docs/reports/2026-10-02-setupenv-unbootable-env-defect.md (pruned 2026-10-05; `git show 2ce8de0a:docs/reports/2026-10-02-setupenv-unbootable-env-defect.md`) (GitHub Issues disabled on this repo)
**Severity**: SEV-3
**Created**: 2026-10-02

---

## Problem Statement

**Observed:**
- `scripts/setup-env.sh` is the documented first-run path, invoked from `bootstrap.sh`.
- It never collects or generates `CONFIG_SECRETS_ENCRYPTION_KEY` or `BROKER_ACCOUNTS_ENCRYPTION_KEY`.
- `docker-compose.yml:132,466` requires both keys with `${VAR:?…}`, so `docker compose up` aborts on a freshly generated `.env`.
- The script still prompts for and writes `ALPACA_API_KEY`/`ALPACA_API_SECRET` and `MCP_AGENT_SECRET`, all removed by feature 147.

**Expected:**
- A fresh run, interactive or `--defaults`, writes both encryption keys, generated with `openssl rand -hex 32` to match `.env.example`.
- The `.env` contains none of the removed variables.
- `docker compose config` succeeds.

## Reproduction Steps

1. `rm -f .env && ./scripts/setup-env.sh --defaults`
2. `docker compose config >/dev/null`
3. It fails with: `CONFIG_SECRETS_ENCRYPTION_KEY is required - copy .env.example to .env`.

## Root Cause Hypothesis

`setup-env.sh` was not updated when feature 147 (config-secret encryption; vendor credentials moved into config) and the broker-account encryption key landed. `.env.example` was updated at that time.

## Affected Services

`scripts/setup-env.sh` (local developer tooling). `docker-compose.yml` is read-only context. No runtime service changes.

## Fix Scope

- [x] No proto changes anticipated
- [x] No database migrations anticipated
- [x] No config key changes anticipated

Constraint: the script must stay bash 3.2/macOS-compatible (root CLAUDE.md).

## Acceptance Criteria

See `acceptance.feature`: the regression scenario(s) must fail on the buggy behavior and pass after the fix (Constitution **C-15**). In addition, existing tests must pass, and `shellcheck` must stay clean (CI `shell-lint`).

## Out of Scope

- Refactoring unrelated to the bug
- Help and exit-code convention alignment across operator scripts (tracked separately as feature-gap I-11)
