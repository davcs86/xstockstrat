# Context Log: fix-config-watcher-client-id

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-09-04 (/sdd-triage --from-report)

- Bug surfaced via `docs/reports/2026-09-04-comment-audit-triage.md` item 4 (comment-audit pass).
  No GitHub issue — Issues disabled on this repo; the dated report is the routable artifact.
- Severity: SEV-3.
- Routed to SDD path (Track C).
- Created: feature.md, product-spec.md, acceptance.feature (regression scenario), context.md, status.md.
- Affected services: `xstockstrat-analysis`, `xstockstrat-ingest` (both `app/config/watcher.py`).
- Triage verification: **confirmed** the copy-paste. ingest `watcher.py:73` sends
  `client_id=f"indicators-{id(self)}"`; report also cites analysis `watcher.py:61` with the same
  literal. indicators' own `client_id` (`watcher.py:60`) is correct. The remaining unknown is
  significance, not existence.
- Root cause hypothesis: copy-paste from the indicators watcher template; the prefix was never
  localized when the analysis/ingest watchers were created.
- Recommended design depth: **quick** → `/sdd-design fix-config-watcher-client-id quick`.
  Rationale: this touches 2 services, which C-0 would push to `full`, BUT the change is a cosmetic
  label with no cross-service contract and a single open yes/no question (does `xstockstrat-config`
  key on `client_id`?). A full architectural debate is unwarranted; one adversarial round — or even
  the `/sdd-spec` codebase search of the config service — resolves the significance question and sets
  priority. Reasoned downgrade from the deterministic ≥2-services rule, recorded here.
- Development branch: `feature/fix-config-watcher-client-id`.

---

## Session 2026-09-04 — sdd-review product-spec

- Product spec approved (PASS WITH WARNINGS). Status: draft → spec-ready.
- Added FR-1 (per-service client_id prefix) + `## Consumer Surface(s)` (None — internal/platform-only);
  tagged @AC-1 @FR-1 / @AC-2 @FR-1. Reworded the open-question checkbox into a non-checkbox
  design-phase investigation note (FR-1 is unconditional; significance only affects priority).
- Code verified: ingest watcher.py:73 and analysis watcher.py send `client_id=f"indicators-{id(self)}"`.
  NOTE for /sdd-spec: the analysis site is `watcher.py:60`, NOT :61 (both the spec and the source
  findings doc inherited the off-by-one). Cite :60 for C-01 grounding.
- Warning (advisory): fold the two prose regression conditions (existing tests pass; subscription
  still establishes) into @AC scenarios at spec time.
- Overlap: CLEAN — soft/rebase-only textual overlap with 173 on ingest watcher.py (disjoint regions:
  173 the accessor bodies, 174 the client_id line); no merge-order row required.
- Design depth: quick (SEV-3, 2 services, one significance question — DRY shared-prefix helper worth
  weighing at design).

---

## Session 2026-09-04 — sdd-design

- Phase 0 Recon: wrote recon.md (services: analysis, ingest; config investigation-only).
- **Significance RESOLVED — cosmetic.** xstockstrat-config never keys on client_id (opaque subId
  segment + logs; subscriber map keys on Date.now()-unique subId; id(self) already unique). The shared
  `indicators-` prefix is a log-mislabel, not a collision. Field number 2; no test asserts it.
- Phase 1 Grilling: **2 rounds (quick base + 1 extra)**, approved, no Floor breach.
  - R1: proposer = _client_id() str seam. Adversary APPROVE-READY but flagged: (a) a str-only seam
    asserts the source not the wire → prefer `_build_watch_request() -> WatchConfigRequest` (asserts
    the real request + gives @AC-10 a live assertion); (b) teardown must include the CLAUDE.md:3 lines.
  - **User decision (R1 gate): run another round.**
  - R2: locked `_build_watch_request()` wire-object seam; also fix the module docstring line 2
    (`-indicators` → `-analysis`/`-ingest`, bound to the same finding); teardown NARROWS the ingest
    findings entry (strike the identity clause, KEEP the separate dead `sandbox_*` helper clause open —
    a different change class, out of scope; wholesale-resolving would drop a live defect).
  - **User decision (R2 gate): approve.**
- Chosen approach: extract `_build_watch_request()` per watcher (byte-identical except the client_id
  prefix), flip `indicators-` → `analysis-`/`ingest-`, fix docstring; RED-before-green wire-object test
  via the existing non-dialing `_StubWatcher` (sets `_environment`/`_trading_mode`, asserts client_id
  prefix + environment + trading_mode). No shared DRY helper. No proto/config/migration change.
- Constitution: C-08/P-06/C-15 (wire-object test, non-vacuous), C-16 (@AC-10 preserved + asserted),
  C-14 (internal-only), C-13/DRY (no helper), C-01/F-04 (sites confirmed; stale findings line numbers
  corrected). No Floor breach.
- Status: spec-ready → design-approved.
- Open Threads (→ /sdd-spec / execute): teardown 4 locations (analysis/ingest CLAUDE.md:3 +
  findings.md), NARROW the ingest finding (keep dead sandbox_* helpers open), stale line-number
  correction (analysis findings :61→:60, ingest :75→:73), _StubWatcher location confirm.

---

## Session 2026-09-04 — sdd-spec

- Generated implementation-spec.md with 5 steps. Status → implementation-ready.
- Step map: 1 service(analysis) + 2 test(analysis, @AC-1) + 3 service(ingest) + 4 test(ingest, @AC-2) + 5 docs(teardown).
- Key codebase findings (grep/Read-confirmed):
  - analysis `app/config/watcher.py`: `client_id=f"indicators-{id(self)}"` at **L60** (docstring L2); request also carries `trading_mode=self._trading_mode` (L62) — the design's byte-verbatim move is accurate. Ingest counterpart at **L73** (docstring L2, trading_mode L75).
  - Test seams confirmed: existing non-dialing `_StubWatcher(ConfigWatcher)` at analysis `tests/test_analysis_servicer.py:475` and ingest `tests/test_ingest_servicer.py:1017`; neither `__init__` sets `_environment`/`_trading_mode`, so the wire-object test sets them explicitly. Reused per design (no new stub). Each service also has a `tests/test_config_watcher.py` (resolve_* helpers) — left untouched; the new test lives with `_StubWatcher`.
  - Teardown grounded to **5** locations (design listed 4; found a 5th): analysis findings `:18` (stale client_id `:61`→`:60`), ingest findings `:27` (stale `:75`→`:73`, dead `sandbox_*` helpers actual `:150-163` — KEEP open, NARROW only the identity clause), analysis+ingest `CLAUDE.md:**4**` (not :3 as design said — off-by-one; blockquote defect list), and root `docs/context-constitution-findings.md:39` (open significance question — resolved as cosmetic; stale `:61`/`:61`).
  - ingest watcher legitimately keeps `indicators.sandbox.*` config-key strings (L150-161) — verification greps must not flag those; only the client_id/docstring `indicators-` identity is removed.
- Reviewers snapshot written to feature.md: analysis owner (service/test), ingest owner (service/test), docs none.

---

## Session 2026-09-04T18:52:00Z — sdd-review impl-spec (advisory)

- Result: **PASS** — 5 steps 0 failures, 0 warnings, 2 informational notes (advisory — did not block). Wire-object test seam non-vacuous; Step 5 teardown correctly NARROWS (keeps the dead sandbox_* helper defect open); no Floor risk.
- Carried into execution:
  - Note: test comments tag environment/trading_mode assertions `@AC-10`, which is NOT a scenario in this feature's acceptance.feature (only AC-1/AC-2) — [x] no action (comment-only; **Covers** correctly cites AC-1/AC-2; C-15 intact). Cosmetic; may mislead a reader grepping this feature's ACs.
  - Note: WatchConfigRequest.trading_mode may be vestigial (root CLAUDE.md: the trading_mode config axis was removed by feature 147) — [x] no action (preserving it verbatim is the correct minimal-change choice for a cosmetic fix; out of scope).
- Overlap findings: SOFT (WARN, rebase-only) — shares three xstockstrat-ingest files with 173 (disjoint line ranges) and the root findings log with 175 (disjoint rows). Recommend landing 173 BEFORE 174 (see 173 note); 174 rebases the shared ingest files. No FAIL-level collision.

---

## Session 2026-09-04 — sdd-execute (sequential; stacked PR #2 of 5, base feature/fix-python-config-zero-trap)

Stacked directly on 173's branch (so the ingest watcher already carries 173's `get_int_present`; the client_id/docstring sites at ingest L2/L73 sit above 173's edits — no drift). Auto-proceed through checkpoints.

### Step 1 — analysis watcher: extract `_build_watch_request()`, flip prefix, fix docstring [done]
- Extracted the inline `WatchConfigRequest` build into `_build_watch_request()`, flipped `indicators-` → `analysis-`, fixed the module docstring L2 to `xstockstrat-analysis`. `environment`/`trading_mode` preserved verbatim (guards @AC-10). Whole-request seam (not str) so a future inline revert stays caught.
- Files modified: `services/xstockstrat-analysis/app/config/watcher.py`
- Deviations: none

### Step 2 — analysis wire-object test (AC-1) [done]
- Reused the existing non-dialing `_StubWatcher` (no second stub); asserts the built request's `client_id` starts `analysis-` (not `indicators-`) and preserves environment/trading_mode/namespace.
- Red→green: AttributeError (`_build_watch_request` absent) on pre-fix tree → passed after Step 1. Full suite: 655 passed, coverage 85.01% (≥40). ruff clean.
- Files modified: `services/xstockstrat-analysis/tests/test_analysis_servicer.py`
- Deviations: none
