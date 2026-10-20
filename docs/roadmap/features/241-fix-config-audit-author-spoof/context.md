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
