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
