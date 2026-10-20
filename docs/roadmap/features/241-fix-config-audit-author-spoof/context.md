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
