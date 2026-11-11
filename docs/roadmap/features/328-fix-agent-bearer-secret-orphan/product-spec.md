# Product Spec: fix-agent-bearer-secret-orphan

**Type**: bug
**GitHub Issue**: none (Issues disabled) — reports: docs/reports/2026-10-19-agent-bearer-secret-orphan-on-failed-register-defect.md
**Severity**: SEV-3
**Created**: 2026-11-10

---

## Problem Statement

### Signal-source bearer secret is orphaned when the source register fails

- **Observed**: `manage_signal_source register` (source_type `mcp_client`) and `instantiate_template`
  (kind `signal_source`) write the bearer token as a per-user encrypted config secret under a fresh
  `ingest.mcp_credential.<uuid>` key BEFORE calling ingest. If ingest then fails, the except branch
  only re-raises — no compensating delete. Each failed retry mints another orphan secret row
  (redacted on read, ciphertext persisting indefinitely, unreferenced). The config-ui hook
  `useSignalSourceMutations.ts` follows the same secret-first flow.
- **Expected**: either a compensating cleanup of the just-written secret on a failed register, or an
  explicit maintainer ruling that orphans are an accepted trade-off plus a sweep of
  `ingest.mcp_credential.*` keys no source's `credentials_ref` references.
- Report: [docs/reports/2026-10-19-agent-bearer-secret-orphan-on-failed-register-defect.md](../../../reports/2026-10-19-agent-bearer-secret-orphan-on-failed-register-defect.md)

## Reproduction Steps

1. Call `manage_signal_source` `register` with `source_type=mcp_client`, a `bearer_token`, and a slug
   that already exists (ingest rejects).
2. Tool returns the mapped error.
3. `list_config_keys namespace=ingest` (caller scope) shows a new `mcp_credential.<uuid>` key
   referenced by no source. Retrying mints one more per attempt (report's scratch pytest: 2 retries →
   2 distinct rows, no delete called, for both tool paths).

## Root Cause Hypothesis

No two-phase write across config and ingest; secret-first ordering was chosen (feature 224) so a
source never references a missing secret, accepting orphans without cleanup. `config.proto` exposes
no delete RPC (only WatchConfig, GetConfig, SetConfig, ListKeys, GetSecret), so the agent client has
no config-delete helper. Current sites:
- `services/xstockstrat-agent/app/tools.py:399` (`_write_source_bearer`), `:402` (secret-first docstring)
- `services/xstockstrat-agent/app/tools.py:1392-1409` (`instantiate_template` write, then re-raise)
- `services/xstockstrat-agent/app/tools.py:1483-1500` (`manage_signal_source register` write, then re-raise)
- `services/xstockstrat-ui/src/app/config-ui/hooks/useSignalSourceMutations.ts:36` (same note)

## Affected Services

- xstockstrat-agent
- xstockstrat-config
- xstockstrat-ingest
- xstockstrat-ui (`src/app/config-ui/hooks/useSignalSourceMutations.ts`)

## Fix Scope

- Proto changes anticipated: **no** — sweep chosen (2026-11-10). With no config delete RPC, the sweep must run where it can delete rows directly (inside `xstockstrat-config`, or as a config data migration / operator runbook); `/sdd-design` picks one (OQ2).
- DB migrations anticipated: **no (schema)** — no schema change is implied; a one-off sweep of orphan rows, if chosen, may ship as a config data migration (decided with Open Question 1).
- Config key changes anticipated: **no new keys** — the fix removes or avoids orphan `mcp_credential.<uuid>` secret rows under namespace `ingest`; it registers no key.

## Open Questions

1. **Decided 2026-11-10 (operator): sweep.** Keep the secret-first write; add a sweep that deletes
   `mcp_credential.*` rows no source's `credentials_ref` references. No new config RPC, no proto change.
   ~~Maintainer ruling (the report's stated open item): compensating delete on a failed register~~
   (new config delete RPC — proto + approval flow, and who is allowed to delete a per-user secret), or
   accept orphans as the documented secret-first trade-off plus a sweep, or accept as-is?
2. If a sweep: where it lives and how it runs (scheduled job, operator runbook, or one-off data
   migration), keyed on `mcp_credential.*` rows that no source's `credentials_ref` references.

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). The scenarios assume the cleanup branch of Open Question 1;
refine them in `/sdd-design` if the ruling is accept-plus-sweep. Plus: existing tests pass; affected
service(s) smoke-tested on dev.

## Out of Scope

- Changing the secret-first ordering itself (a source must never reference a missing secret)
- Refactoring unrelated to the bug
