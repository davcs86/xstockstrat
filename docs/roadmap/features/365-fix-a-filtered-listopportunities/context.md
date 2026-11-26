# Context Log: fix-a-filtered-listopportunities

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-25 (/sdd-triage)

- Bug reported via defect report `docs/reports/2026-11-25-analysis-filtered-empty-opportunity-read-kicks-full-recompute-defect.md` (GitHub Issues disabled): a filtered ListOpportunities read with no matches kicks a full recompute
- Severity: SEV-3
- Routed to SDD path (Track C)
- Created: feature.md, product-spec.md, acceptance.feature (regression scenarios), context.md
- Affected services (from report): xstockstrat-analysis
- Root cause hypothesis: the no-rows branch tests the filtered fresh read and sets kick_full unconditionally (servicer.py:4765-4788)
- Recommended design depth: skip → `/sdd-spec fix-a-filtered-listopportunities` (rationale: SEV-3, single service, no proto/migration/config, clear root cause)
- Development branch: feature/fix-a-filtered-listopportunities
- Note: the behavior was used deliberately on 2026-11-25 as a no-DB lever to force a homelab queue recompute (`list_opportunities(min_conviction=1.01)`); the fix removes that lever, so a manual-recompute path should be considered at /sdd-spec (none exists today — no refresh/invalidate RPC).

## Session 2026-11-26 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings (criteria verdict PASS WITH WARNINGS; no fails, no floor breaches):
  - Criterion 8 (C-15): AC-3's Then stated an internal step — **resolved**: AC-3 now asserts a follow-up read returns `computing` false once the background compute finishes. AC-1's "no background recompute starts" is backed by the observable unchanged `valid_until`; AC-4 asserts `valid_until` advancing.
  - Criterion 8: the filtered-empty case where fresh rows exist but all are muted/snoozed is excluded only by an AC-1 Given; the `has_fresh` gate covers it but no scenario asserts it — design decides whether a scenario is warranted.
  - Criterion 9: no Open Questions section; the manual-recompute lever decision is deferred to design (Out of Scope already states it).
  - Criterion 11: Consumer Surface(s) not in checkbox form; clear, not a violation — no change.
  - Caller passed a doubled-prefix spec path; the real files are under `docs/roadmap/features/365-fix-a-filtered-listopportunities/`.
- Overlap findings (WARN only; no config-key, proto or migration collision):
  - `services/xstockstrat-analysis/app/handlers/servicer.py` `_read_opportunity_queue` (4758-4820) shared with 330-fix-live-enrich-ttl-seed (in-progress): 330's cited reader line 4819 is stale and now sits inside the function 365 rewrites; 330 expects no reader code change — low risk, possible merge conflict; re-verify at merge.
  - Same file vs 366-opportunity-live-only-rotation (spec-ready): 366 changes `_compute_opportunities` step 2b (~5359) and queue `replace_for_user`; semantic coupling on per-row `valid_until` — 365 AC-1/AC-4 `valid_until` fixtures and assertions must stay consistent with 366.
  - Same file vs 308-fix-analysis-per-symbol-isolation (implementation-ready, ~5742/5824/5916) and 327-fix-analysis-evidence-dry (implementation-ready, ~7282): distant lines, low risk.
  - 364-fix-gapsonly-backfill-is: no collision (draft; marketdata/ingest only).
  - Merge-order: no entries for 364/365/366/330 in `merge-order.md`; no blocking row required. Coordination note: merge 365 before or with 366; re-verify 330's reader-line reference at merge time.
- Recommended design depth: full (rubric default full; WARN-level overlap findings rule out quick; operator's /sdd-batch runs the full debate — keep it proportionate).

### OPERATOR DECISIONS (binding, recorded 2026-11-26)

- Operator 2026-11-25: SEV-3, Track C. Triage recommended design depth 'skip'; operator chose the /sdd-batch workflow, which runs a full design debate — keep the design proportionate (single service, clear root cause).
- Root cause evidence: services/xstockstrat-analysis/app/handlers/servicer.py _read_opportunity_queue no-rows branch sets q.kick_full=True after a FILTERED fresh read (min_conviction/sources/action_filter/symbol), so a filtered-empty read kicks a full recompute despite fresh rows; repo already has has_fresh (app/repositories/opportunities.py). UI /trader/positions/[symbol] polls with a symbol filter every 15s.
- The fix removes the only no-DB lever used on 2026-11-25 to force a recompute (list_opportunities(min_conviction=1.01)); there is no refresh/invalidate RPC. Design must state whether a deliberate manual-recompute path is in or out of scope (default: out of scope; record the decision).
- Cross-feature: 366-opportunity-live-only-rotation changes _compute_opportunities and queue persistence in the same servicer; coordinate merge order.
