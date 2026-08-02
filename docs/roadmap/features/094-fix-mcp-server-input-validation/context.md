# Context Log: fix-mcp-server-input-validation

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-08-02 (/sdd-triage --from-report)

- Routed from the MCP-alignment triage report: docs/reports/2026-08-01-mcp-tools-alignment-triage.md
- Findings bundled into this feature: F-9 (code), F-10 (notify field validation)
- Severity: SEV-3 (max across bundled findings)
- Routed to SDD path (Track C)
- Created: feature.md, product-spec.md, context.md
- Affected services: xstockstrat-ingest, xstockstrat-notify
- Root cause(s) from the report: RC-4
- Recommended design depth: quick → `/sdd-design fix-mcp-server-input-validation quick` (rationale: two independent single-clause server guards, no cross-service coupling or proto)
- Development branch: feature/fix-mcp-server-input-validation
- Bundling rationale: the report's cross-finding notes tie these findings to one surface/root
  cause, so they land as one feature (one PR-able change) rather than artificially-split dirs.
  The full per-finding fix plan (verified 2026-08-02, one read-only investigator per finding)
  lives in the source report; consult it during /sdd-design and /sdd-spec.

## Session 2026-08-02 — sdd-design (quick)

- Phase 0 Recon: wrote recon.md (services: xstockstrat-ingest, xstockstrat-notify). Key reuse
  patterns: ingest direction-guard `abort+return` idiom (`servicer.py:667-672`); notify identity
  numeric-`code:3` guard (`identityServiceImpl.ts:52`); config compile-first test harness
  (`config/package.json:12`).
- Phase 1 Grilling: 1 round (quick). Chosen approach: two additive server guards —
  F-9 `if not (0.0 <= signal.conviction <= 1.0): abort(INVALID_ARGUMENT)` in IngestSignal;
  F-10 `if (!req.title?.trim() || !req.body?.trim()) callback({code:3})` in emitAlert. Rejected:
  the naive `c<0 or c>1` form (lets NaN through → silent NULL, the feature's own bug), splitting
  into 094a/094b (violates one-PR-per-feature), and skipping the notify harness flip.
- Adversary round 1 folded in (NEEDS WORK → resolved, no Floor breach): (1) **NaN slip** — switched
  to the inverted-range form so NaN is rejected instead of stored NULL; (2) **tools.py docstring
  drift** — both `ingest_signal` (`:214-216`) and `emit_alert` (`:274-275`) docstrings added to the
  change surface (RC-1 / C-10); (3) **074 de-cloak** — Step 2 must green the never-executed notify
  suite before adding F-10; (4) **092 overlap** — recorded, 094 stays self-contained + merge-order
  entry; (5) **080 absence claim** — the `EmitAlert|IngestSignal` caller grep recorded in design.md.
- Constitution rules touched: C-01, C-08, C-10, C-13, P-03, P-06, F-04, F-11. Floor breaches: none.
- Status: draft → design-approved.

### Decisions

- F-9 uses the inverted-range form `not (0.0 <= c <= 1.0)` (not `c<0 or c>1`) specifically to reject
  NaN; `0.0` intentionally still passes (plain-scalar-double unset sentinel → NULL at `:692`).
- F-10 uses `.trim()` — a deliberate widening of AC-2 ("empty") to cover whitespace-only, justified
  by the "delivered blank" harm.
- notify flips to the compile-first harness (mirrors config + feature 092) — mandatory for a real RED.

### Open Threads

- [ ] 092↔094 notify-harness collision (`package.json` + `notifyServiceImpl.test.ts`) — reconcile at
  rebase; record in merge-order.md; confirm at `/sdd-review impl-spec`. Target: Step 2 + merge-order.
- [ ] notify de-cloak may surface latent red in never-run existing cases — green them first in Step 2;
  escalate as a P-03 deviation if remediation balloons. Target: Step 2.

## Session 2026-08-02 — sdd-spec

- Generated implementation-spec.md with 5 steps. Status → implementation-ready.
- Step model: 2 service/test pairs (ingest F-9, notify F-10) + 1 docs step; ingest and notify
  are fully decoupled (either pair may land first).
- Key codebase findings (all verified this session, not from recon alone):
  - F-9 guard inserts between `servicer.py:672` (direction-guard return) and `:674` (FR-3 comment);
    NULL-sentinel at `:692` and DB CHECK (`001_newsletter_signals.up.sql:14`) left untouched. Inverted
    range form `not (0.0 <= c <= 1.0)` mandated (rejects NaN; naive form would store NaN as NULL).
  - F-9 test mirrors `TestIngestSignalRegistryValidation` (`:822`, real proto + abort AsyncMock) and
    the green path `test_proceeds_when_source_registered` (`:848`, fetchrow side_effect
    `[{"slug":...},{"id":42}]` + mocked `_ledger`).
  - F-10 guard inserts after `notifyServiceImpl.ts:31` (`const req = call.request;`); numeric `code:3`
    mirrors `identityServiceImpl.ts:52`; `.trim()` widens to whitespace-only (recorded).
  - notify harness flip is mandatory (074 trap): `package.json:12-13` strip-types + param-property
    constructor `:21-24` = zero-assertion green suite that never runs. Flip to config's byte-identical
    compile-first script (`config/package.json:12-13`); notify tsconfig already emits `dist/__tests__`.
    Step 4 enumerates all 13 pre-existing cases to green (de-cloak) before the RED empty-field case.
  - Docs surfaces confirmed: `tools.py:215-216` (ingest_signal) + `:274-275` (emit_alert) stale
    docstrings; `mcp-tools.md:200/:216-217/:244`; merge-order.md 092↔094 rebase note.
- Neither `xstockstrat-ingest/CLAUDE.md` nor `xstockstrat-notify/CLAUDE.md` documents the input-
  validation surface (grep confirmed), so no service CLAUDE.md edit is in scope — matches design.md's
  change-surface list (tools.py + mcp-tools.md + merge-order.md only).

### Open Threads

- [ ] 092↔094 notify-harness collision — recorded as a Step 5 merge-order.md entry (rebase-only,
  identical-intent flip; union of the two added test cases). `/sdd-review impl-spec` overlap scan must confirm.
- [ ] notify de-cloak latent red — Step 4 greens all pre-existing cases before the RED case; escalate
  as a P-03 deviation if remediation balloons.

## Session 2026-08-02 — sdd-review impl-spec + sdd-execute

- **Review (Mode B, advisory):** criteria pass = PASS WITH WARNINGS (0 failures); overlap scan =
  no FAIL-class collision (no proto/migration/config), only rebase-only source-file unions with 085
  (`tools.py` wholesale rewrite vs 094's two docstrings) and 092 (notify harness + adjacent emitAlert
  guard; ingest servicer.py different handlers). Folded in: Step 2 clean-RED mocking; merge-order note
  names the notify files + the 085 `tools.py` overlap.
- **Execute — all 5 steps done, RED-first, both suites green:**
  - Step 1/2 (ingest F-9): added the inverted-range guard `not (0.0 <= signal.conviction <= 1.0)` in
    `IngestSignal` after the direction guard. RED demonstrated (3 abort cases `1.5`/`-0.1`/`NaN` →
    DID NOT RAISE pre-guard; GREEN after). Full ingest suite **155 passed**, ruff clean, cov 76%.
  - Step 3/4 (notify F-10): flipped `package.json` to compile-first, rewrote `notifyServiceImpl.test.ts`
    to static imports (removed the lazy try/catch + all `if (!X) return` skip-guards), de-cloaked the
    suite. **De-cloak surfaced NO latent red** — all 14 pre-existing cases passed green on first
    compiled run (contra config's "1 fails/1 hangs"); no P-03 deviation needed (D-2). Added the
    empty/whitespace title-body guard `if (!req.title?.trim() || !req.body?.trim()) callback({code:3})`.
    RED demonstrated (4 empty-field cases failed pre-guard while all pre-existing passed; GREEN after).
    Full notify suite **19 passed**, lint 0 errors, cov 85%.
  - Step 5 (docs): synced both `tools.py` docstrings (`ingest_signal`, `emit_alert`), the `mcp-tools.md`
    conviction row + both error tables + emit_alert prose, and added the 085/092↔094 rebase note to
    `merge-order.md`. ruff clean.
- **Deviations:** D-1 (Step 2 clean-RED mocking), D-2 (clean de-cloak, no latent red), D-3 (inline pool
  `as any` cast under tsc) — see implementation-spec.md § Deviation Log. None changed scope.
- **context-scrubber:** the context-forge/context-scrubber plugin is not available in this session
  (no `/context-scrubber` skill), so the teardown scan of the touched docs (`mcp-tools.md`,
  `merge-order.md`) could not run — noted in the PR body per root CLAUDE.md teardown.
- Status: implementation-ready → code-completed.
