# Context Log: fix-config-audit-author-spoof

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-20 (/sdd-triage)

- Bug recorded as defect report `docs/reports/2026-10-19-config-audit-author-caller-spoofable-defect.md`
  (Issues disabled): SetConfig audit author is caller-supplied free text, not the verified identity.
- Severity: SEV-2. Environment: dev (main-dev) @ 1302e6d. Config-only fix: no. Routed to SDD path (Track C).
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1 human write, AC-2 internal-caller write), context.md.
- Affected services (from report): xstockstrat-config, xstockstrat-agent.
- Root cause hypothesis: `author` predates header propagation; authz moved to verified headers (feature 074,
  PR #994) but attribution stayed on `call.request.author || userIdFrom(metadata)` (`configServiceImpl.ts:404`).
- Confirmation evidence (report, confidence high, static): repro is an admin MCP `set_config` with
  `author="someone-else@example.com"` producing `config_audit.changed_by = someone-else@example.com`. Triage re-grep
  on 2026-10-20 confirmed `configServiceImpl.ts:388,404,507`, `tools.py:1694`, `configUiBff.ts:53`.
- Additional triage findings (not in report):
  - `tools.py:353` (signal-source bearer write) passes `author=tool`; attribution there also changes.
  - trading's reconciliation poller sends `Author: "system:reconciliation-poller"` with
    `x-internal-caller: trading-reconciliation-poller` (`trading.go:2086-2094`); `caller_identity` already
    records the structural identity. The `system:<process>` sentinel convention
    (`docs/patterns/config-governance.md` § Author-sentinel conventions) is a free-text-author convention and
    must be reconciled with the fix.
  - `MISSING_AUTHOR_ERROR` (`configServiceImpl.ts:405-407`) and config CLAUDE.md invariant #5 describe the
    `author`-or-`x-user-id` rule.
  - No durable acceptance scenario in `services/xstockstrat-{config,agent}/acceptance/` pins free-text author
    attribution (grep `author|changed_by|updated_by`: no hits), so no C-16 CHANGE expected.
- Design forks for /sdd-design: (a) reject vs ignore vs store-separately a mismatched free-text `author`;
  (b) deprecate `SetConfigRequest.author` (proto field 4) or keep it as non-authoritative note;
  (c) agent tool contract: drop or make optional the `author` parameter (MCP contract change);
  (d) attribution for internal callers (`x-internal-caller` value vs `system:<process>` sentinel); AC-2 assumes
  the report's expected `x-internal-caller` fallback and may be refined at design.
- Recommended design depth: full → `/sdd-design fix-config-audit-author-spoof` (rationale: SEV-2; 2 affected
  services (config, agent); possible proto deprecation of `SetConfigRequest.author` and possible migration if a
  separate non-authoritative column is chosen).
- Development branch: feature/fix-config-audit-author-spoof

## Session 2026-10-20 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready. Criteria verdict PASS WITH WARNINGS (0 fails, 0 Floor
  breaches); overlap verdict WARN (no FAIL).
- Warnings (9), with resolution in this session:
  1. Line cites drifted (C-01). Re-anchored in product-spec.md against trunk:
     - `configServiceImpl.ts`: `:386` global gate, `:394` per-user branch, `:410` author, `:411-414`
       `MISSING_AUTHOR_ERROR`, `:513` INSERT params;
     - `trading.go:2168-2176`.
     Earlier entries in this log keep the old SHA-1302e6d cites.
  2. The proto approval route was unstated, and C-09 was mis-tagged. Fix Scope now says:
     - non-breaking `[deprecated = true]`, precedent `config.proto:129`;
     - approval by the Proto Reviewer + `packages/proto` owner;
     - the breaking route does not apply;
     - C-09 cited for buf lint/breaking only.
  3. No migration strategy for the conditional DB change. Moot: the operator decision ignores `author`, so
     there is no column and no migration. Recorded as `[x] No DB migration`.
  4. Docs item unchecked. Now checked, with `services/xstockstrat-config/CLAUDE.md:40,55,97`,
     `config-governance.md:93-103` and `mcp-tools.md:1096` listed.
  5. AC-1 scope values were not integers. Changed to `4` (ADMIN_SCOPE, `authz.ts:8`) and `1`.
  6. AC-1 had no prior-value precondition. Added a `<prior>` column: `2` for the global row (021 seed) and
     `absent` for the per-user INSERT. The same precondition was added to AC-2 (`ACTIVE`, the 011 seed),
     since the trigger at 017:69 has the same trap.
  7. No negative scenario. Added AC-3 (append-only, C-15): an admin-scope write with no `x-user-id`, with
     `x-internal-caller` either absent or present but unauthorized for the key, must be rejected with
     `INVALID_ARGUMENT` and leave the row unchanged. Precedence when both `x-user-id` and an authorized
     `x-internal-caller` are present is left open for /sdd-design.
  8. AC-2 pre-empted fork (d). Settled by the operator decision below: the `system:reconciliation-poller`
     sentinel is retired as a `changed_by` value. product-spec.md now lists `trading.go:2176`,
     `trading_reconciliation_test.go:789-790`, `internalCallerSetConfig.test.ts:73` and
     `config-governance.md:103`. No durable suite pins this, so no C-16 sign-off is needed.
  9. The consumer surface list was incomplete. Added `instantiate_template` (`tools.py:1222`) next to
     `manage_signal_source` (`tools.py:1309`), both via `_write_source_bearer` (`tools.py:341-360`), plus
     `client.py:2094,2100,2142`.
- Overlap findings (WARN, all rebase-only once the migration fork closed):
  - Migration `031` vs 243 (`fix-sandbox-seed-keys`): conditional, and moot now that there is no migration.
    No `merge-order.md` entry needed.
  - `configServiceImpl.ts` vs 244 / 243: SCALAR_BOUNDS `:115-117`, a disjoint region.
  - `tools.py` vs 247 (`get_config_value` `wait_for`, `:1550-1556`) and vs 249 (`manage_account`). `client.py`
    vs 247 (`get_config_value`, `:1729`). Different functions in each case.
  - `trading.go` `escalateSystemic` vs 251: the `SourceService` literal at `:2188`, in the same function.
  - `mcp-tools.md` vs 247 / 249: section-disjoint.
  - Proto: clean (no peer touches `config.proto`). Config: clean.
  - 240 is already on trunk.
- Design forks still open for /sdd-design:
  - (c) remove the `set_config` `author` tool parameter, or keep it accepted-but-ignored;
  - the identity precedence noted above;
  - whether trading drops the `Author` line and the UI BFFs drop their `author` sends (staticcheck SA1019,
    `.golangci.yml:7`; C-10).
- Operator decisions (binding, recorded 2026-10-20; relayed verbatim by the workflow orchestrator):
  - Standing authorization: designs run in FULL mode only (no quick designs for automated fixes); the orchestrator auto-approves the design gate once rounds >= 2, no unresolved Floor (F-*) breach remains, no blocking objection remains, and every CHANGE to an existing @AC business rule is covered by an operator decision below.
  - Author comes from verified identity only: config stamps changed_by from the verified x-user-id, or the x-internal-caller grant id for automated writers; request.author is ignored and the proto field is marked [deprecated = true] (non-breaking); the agent stops sending free-text author; trading's reconciliation-poller sentinel moves to the x-internal-caller identity.
- Next: `/sdd-design fix-config-audit-author-spoof` (full).

## Session 2026-10-20 — sdd-review product-spec (re-run of A4)

- Re-run on an already `spec-ready` spec, after Phase 0 recon (`recon.md`, commit 95130ba3). Status unchanged:
  spec-ready. Criteria verdict PASS WITH WARNINGS (0 fails, 0 Floor breaches). Overlap verdict WARN (no FAIL).
- Both verdicts read the pre-revision triage draft. They cite `product-spec.md:22-24` either/or Expected, the
  unchecked boxes at `:48,49,51` and `configServiceImpl.ts:388/404/507`, all fixed in the prior session.
  Warnings (8), with resolution:
  1. No `## Functional Requirements` and no `@FR-N` tags (C-15). Resolved:
     - added FR-1 (human → `x-user-id`), FR-2 (authorized internal caller → grant `callerID`), FR-3 (no
       verified identity → `INVALID_ARGUMENT`) and FR-4 (agent sends no free-text `author`);
     - tagged AC-1 `@FR-1`, AC-2 `@FR-2`, AC-3 `@FR-3 @FR-2` and AC-4 `@FR-4`.
     The Track C template (`.claude/skills/sdd-triage/reference/track-c-sdd.md:103-163`) prescribes neither,
     yet C-15 requires both. That template/criteria gap is a ledger candidate. Not written: A4 calls for no
     ledger line.
  2. AC-1/AC-2 pre-resolve forks. Settled by the operator decision (prior session): ignore `author`, no reject;
     credit the grant id, not the `system:` sentinel. AC-2 is kept as the kill-switch escalation guard
     (`config.go:257-263` sends no `x-user-id`).
  3. Coverage gaps.
     - (a) Agent path: added AC-4 (append-only), covering `set_config`, `manage_signal_source` and
       `instantiate_template`. It asserts the outbound `SetConfigRequest.author == ""` and `x-user-id` = the
       claims `user_id`. It fails today: `tools.py:353` sends the tool name and `:1694` sends the caller's
       text.
     - (b) No-identity rejection: AC-3 (prior session).
     - (c) Precedence: now Open Question Q1.
     - Test pins `setConfigAuthz.test.ts:144,183-199`, `test_config_tools.py:110,133,152,171,237,255` and
       `test_streamable_http_auth.py:86` added to § Affected Services. `client.py` was already listed.
  4. Proto gate unclassified. Already resolved: non-breaking `[deprecated = true]`, Proto Reviewer + owner route.
  5. Migration strategy. Moot: no migration (operator decision).
  6. Forks only in context.md. Added `## Open Questions` Q1-Q5, owned by /sdd-design and closed before
     `design-approved`:
     - Q1 identity precedence;
     - Q2 `set_config` param removed vs ignored (`mcp` 2.2.0 undeclared-arg behaviour unverified);
     - Q3 trading `Author` line;
     - Q4 UI BFF stamps;
     - Q5 agent `_caller_user_id` fail-fast.
     The last unchecked Fix Scope box is now `[x]` and points at Q2.
  7. Stale cites (C-01). Already re-anchored. Re-verified against the tree:
     - `configServiceImpl.ts:376,380,386,394,405,410-414`
     - `authz.ts:46-50,82-97`
     - `tools.py:341-360,1641-1701`
     - `client.py:2094-2151`
  8. Example concreteness. Integer scopes were already done. The feature description now states that a blank
     `<target>` is `user_id ""` (global row, NULL) and that `absent` is the INSERT path.
- Overlap findings (WARN, rebase-only, no FAIL, no `merge-order.md` row required):
  - `configServiceImpl.ts`: this feature's `:394-513` vs 240 (SCALAR_BOUNDS row `:145`, code-completed) and 244
    (bounds rows `:100-127`, conditional). Disjoint hunks.
  - `tools.py`: `:353,1642-1699` vs 240 (`manage_offline_account` `:2035`) and 215 (in-progress; docstrings
    `:735,760-763`, `set_strategy_live` `:1309-1335`). Disjoint.
  - `client.py`: `:2094-2142` vs 240 (`confirm_offline_order` `:2245-2271`). Disjoint.
  - `config-governance.md`: § Author-sentinel conventions `:93-103` vs 240's Per-Feature Registered Keys log.
    Section-disjoint.
  - `mcp-tools.md`: § `set_config` vs 240's `manage_offline_account` / `get_positions`. Conditional on Q2,
    section-disjoint.
  - Trading: `trading.go` is also edited by 240, 249 and 251 (conditional). Disjoint unless the poller line
    moves (Q3).
  - Migration `031` is pre-reserved by 243. Moot, since 241 takes no migration.
  - Proto: clean. Config keys: clean. 247 and the other drafts are disjoint.
  - 241 rebases onto 240, which is already in the checkout. Re-run the Mode B overlap at impl-spec.
- Since recon predates AC-4 and the FRs, /sdd-design must fold AC-4 / FR-4 into the design and the C-16 notes.
  Recon's "AC-1..AC-3 become the first guards" now reads AC-1..AC-4.
- Operator decisions (binding, recorded 2026-10-20; relayed verbatim by the workflow orchestrator):
  - Standing authorization: designs run in FULL mode only (no quick designs for automated fixes); the orchestrator auto-approves the design gate once rounds >= 2, no unresolved Floor (F-*) breach remains, no blocking objection remains, and every CHANGE to an existing @AC business rule is covered by an operator decision below.
  - Author comes from verified identity only: config stamps changed_by from the verified x-user-id, or the x-internal-caller grant id for automated writers; request.author is ignored and the proto field is marked [deprecated = true] (non-breaking); the agent stops sending free-text author; trading's reconciliation-poller sentinel moves to the x-internal-caller identity.
- Next: `/sdd-design fix-config-audit-author-spoof` (full; Phase 0 recon is done, Phase 1 grilling is next).
