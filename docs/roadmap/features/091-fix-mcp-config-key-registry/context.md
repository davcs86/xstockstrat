# Context Log: fix-mcp-config-key-registry

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-08-02 (/sdd-triage --from-report)

- Routed from the MCP-alignment triage report: docs/reports/2026-08-01-mcp-tools-alignment-triage.md
- Findings bundled into this feature: F-8
- Severity: SEV-3 (max across bundled findings)
- Routed to SDD path (Track C)
- Created: feature.md, product-spec.md, context.md
- Affected services: xstockstrat-config, xstockstrat-agent
- Root cause(s) from the report: RC-3
- Recommended design depth: full → `/sdd-design fix-mcp-config-key-registry` (rationale: DB migration (key registry) + ≥2 services)
- Development branch: feature/fix-mcp-config-key-registry
- Bundling rationale: the report's cross-finding notes tie these findings to one surface/root
  cause, so they land as one feature (one PR-able change) rather than artificially-split dirs.
  The full per-finding fix plan (verified 2026-08-02, one read-only investigator per finding)
  lives in the source report; consult it during /sdd-design and /sdd-spec.

---

## Session 2026-08-02 — sdd-design

- Phase 0 Recon: wrote recon.md (services: xstockstrat-config, xstockstrat-agent). Confirmed RC-3
  (config_values = registry+value store); last migration 009→next 010; setConfig blind upsert; audit
  trigger BEFORE UPDATE only (new-key INSERT unaudited); proto SetConfigRequest max field 7; config
  tests run against compiled dist/ (074 zero-assertion trap fixed).
- Phase 1 Grilling: 2 rounds (full). R1 proposer offered a `config.config_registry` table; adversary
  out-argued it (dead is_secret/metadata columns → drift/leak; audit trigger targeted the wrong row).
  R2 adopted single-table (Alt A); R2 adversary caught two real defects and both are folded in.
- Chosen approach: single-table. Migration 010 = dedicated `AFTER INSERT` audit trigger
  (`config_value_audit_insert` + `audit_config_insert()`), leaving BEFORE UPDATE untouched — avoids
  the `BEFORE INSERT OR UPDATE` double-fire under `ON CONFLICT DO UPDATE`. setConfig existence gate is
  **mode-EXACT** (matches the ON CONFLICT target; mode-broadening manufactures a nondeterministic
  read-shadow). Additive proto `SetConfigRequest.create_key = 8`, forwarded by agent client (+ descriptor-
  parity test). Reads unchanged; AC-4 secret refusal untouched.
- Rejected: registry table; nullable value_data; widened single trigger; mode-broadening gate; agent
  client-side existence refusal.
- **Design-gate resolution (AC-3 reinterpretation)** — proceeded without a live user gate under the
  session's standing "continue" directive. AC-3's "registered but unset as a distinct persisted state"
  is NOT met and is reinterpreted as "registered ≙ has a value row + audit-on-insert." Justification
  (adversary R1 §4): that state is invisible to every reader (ListKeys/GetConfig read value rows;
  defaults are call-site, not DB default_value), so it buys nothing operationally; a second table to
  represent it was rejected. Audit half of AC-3 is fully met. Revisit only if a future feature needs a
  value-less registered key (→ nullable value_data). If the user wants the literal persisted state,
  reopen here.
- Constitution rules touched: F-01, F-06, F-07/F-04, C-09, C-08/P-06, C-01, C-10, C-11/P-03. Floor
  breaches: none (010 is a new file; no new pool; nothing hardcoded).
- Status: draft → design-approved.

### Open Threads
- AC-3 unset-half reinterpretation — resolved as "registered ≙ has a value row"; target: /sdd-spec
  product-spec AC-3 note. Reopen if the literal persisted state is required.
- Governance narrowing (config-ui can no longer typo-mint keys) — verify-only; target: spec verify step.
- 074 compiled-JS zero-assertion trap — every config test step must prove a red in dist/.

---

## Session 2026-08-02 — sdd-spec

- Generated implementation-spec.md with 8 steps. Status: design-approved → implementation-ready.
- Step order: 1 proto (`SetConfigRequest.create_key = 8`) → 2 proto-gen → 3 migration `010` (AFTER
  INSERT audit trigger) → 4 config service (mode-exact existence gate) → 5 config test (paired,
  loopback) → 6 agent service (tool + client forward `create_key`) → 7 agent test (paired,
  descriptor-parity) → 8 docs.
- Key codebase findings (verified against source, not just recon):
  - `SetConfigRequest` ends at field 7 (`trading_mode`) — `config.proto:88-96`; `create_key = 8` is additive.
  - Last config migration is `009` → next is `010`; audit trigger `config_value_audit` is `BEFORE UPDATE`
    only (`001:49-51`), function redefined in `002:33-43`. `010` adds a NEW `AFTER INSERT` trigger, leaves
    the update trigger untouched (F-01).
  - `setConfig` upsert conflict key is `(namespace,key,environment,trading_mode)` (`configServiceImpl.ts:319`);
    existence SELECT is mode-EXACT on that grain, inserted after the author check (`:309-313`) and before the
    upsert (`:315`). Use `existing.rows.length === 0` (mock-pool compatible; real pg has no rowCount in the stub).
  - **Wire trap surfaced**: ts-proto sends camelCase over the wire (`listKeysWire.test.ts:4-8`; impl's snake_case
    `trading_mode` read is a logged defect, `setConfigAuthz.test.ts:173-178`). Impl must read `call.request.createKey`
    (read `createKey ?? create_key`); the Step 5 loopback case passing `createKey: true` is the end-to-end proof.
  - **Existing test breakage identified**: `setConfigAuthz.test.ts`'s always-`{rows:[]}` pool (`:83-88`) flips the
    "allows an admin write" case to NOT_FOUND once the gate lands, and its `queries[0]` INSERT assertions
    (`:153, :162`) shift because the existence SELECT becomes query 0. Step 5 branches the pool on SQL and finds
    the INSERT by name.
  - Agent gate is **server-side only** (design §3) — the empty-`keys` mocks (`test_config_tools.py:168/189/211`)
    stay valid; agent change is a pure `create_key` passthrough (tool `:786-796`, `:859-870`; client `:916-962`).
  - Descriptor-parity test template: `test_backtest_view.py:157-174` — applied to `SetConfigRequest` via
    `ListFields()` vs `DESCRIPTOR.fields_by_name` (ledger insight 2026-08-02, RC-1 guard).
- Reviewers snapshot written to feature.md (Proto Reviewer, DBA, xstockstrat-config, xstockstrat-agent).

### Open Threads
- AC-3 unset-half reinterpretation carried into the spec (design decision; no literal persisted "registered but
  unset" state) — reopen only if a future feature needs a value-less registered key.
- Governance narrowing (config-ui can no longer typo-mint keys) — surfaced as a docs note in Step 8, not a code gate.
- 074 zero-assertion trap — Step 5 must prove a red in the COMPILED `dist/` suite with non-zero assertions.

---

## Session 2026-08-02 — sdd-review impl-spec (advisory)

- Criteria pass (spec-reviewer): PASS — 0 blockers, 0 warnings, 3 accepted-pattern NOTES (Step 2
  codegen wildcards; Steps 4/6 prose-only Verification delegating to their paired test steps). Every
  spot-checked path:line verified accurate (proto field 8 free, migration 010 next, setConfig
  structure, agent tool/client, descriptor-parity template). No Floor risk (F-01/F-06 honored).
- Overlap pass (feature-overlap): CLEAN. Proto field 8 free; config migration 010 free; 091 is the
  cohort's only implementation-ready feature so it lands first. Forward coordination: 092
  (writepath-authz) and 093 (extract-credentials) will touch client.set_config scope forwarding —
  they rebase onto merged 091; no blocking merge-order row needed now.
- Proceeding to implementation directly on the feature branch (one PR per feature, per the session's
  branch directive), honoring each step's TDD/verification gate.

---

## Session 2026-08-02 — sdd-execute (implementation)

All 8 steps implemented on feature/fix-mcp-config-key-registry (one PR into main-dev, per the
session's branch directive), each step's TDD/verification gate honored.

- **Step 1-2 (proto)**: `SetConfigRequest.create_key = 8` (additive). `buf lint` + `buf breaking`
  (vs main-dev) pass; `buf-gen.sh` regenerated all three language stubs — diff scoped to create_key.
- **Step 3 (migration 010)**: dedicated `config.audit_config_insert()` + `config_value_audit_insert`
  AFTER INSERT trigger; BEFORE UPDATE trigger untouched (F-01). **Verified on a live Postgres 16
  container** (migrations 001→010 applied): a fresh INSERT audits exactly once (old_value NULL); a
  subsequent ON CONFLICT update adds NO phantom insert-audit (insert_audits=1, total=2). Down reverts
  cleanly; up is idempotent.
- **Step 4-5 (config)**: mode-exact existence gate in `setConfig` before the upsert (reads
  `call.request.createKey ?? create_key` for the camelCase wire encoding). RED demonstrated in the
  COMPILED suite (gate disabled → "refuses unregistered → NOT_FOUND" case fails); GREEN 37/37,
  coverage 70%. Also fixed two SIBLING suites the gate broke (configValueRoundtrip, scopeResolution)
  — their always-empty mock pools now return a row for the existence SELECT (fix-every-affected-
  surface, not just the flagged file).
- **Step 6-7 (agent)**: `set_config` tool + `client.set_config` forward `create_key` (pure
  passthrough; server authoritative; empty-`keys` mocks stay valid). Docstring's now-false
  "blind upsert / no reachable key-not-found / creation unaudited" claims rewritten. Added a
  `SetConfigRequest` descriptor-parity guard (RC-1) — RED demonstrated (drop the field → fails
  closed). GREEN 141 tests, coverage 70%, ruff clean.
- **Step 8 (docs, C-10)**: mcp-tools.md (create_key row, NOT_FOUND error, audited-creation), agent
  CLAUDE.md (tool row + authz block), config CLAUDE.md (WatchConfig flow: gate + dual audit
  triggers), config findings doc (audit-on-UPDATE-only marked RESOLVED). strat-lab does not cover
  set_config (verified — no edit).
- **Context-scrubber**: the context-forge plugin / `/context-scrubber` skill is not available in
  this session, so the teardown scan could not run; touched context/docs were updated by hand to
  match the new behavior (noted in the PR body).
- Status: implementation-ready → code-completed.

## Session 2026-08-02 (CI: feature status automation)

- Promotion PR #844 merged to main
- Feature promoted and committed: a76237080a282abac145b7f88a6044869132ba5f
- Status updated: `code-completed` → `launched`
- Launched date: 2026-08-02
