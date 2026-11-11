# Context: otel-env-provider-scoped-alerts

**Feature**: `docs/roadmap/features/333-otel-env-provider-scoped-alerts/feature.md`
**Product Spec**: `docs/roadmap/features/333-otel-env-provider-scoped-alerts/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/333-otel-env-provider-scoped-alerts/implementation-spec.md`

---

## Session 2026-11-11 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Number 333 reserved on origin via `scripts/sdd-allocate-feature-number.sh`.
- Named C-14 follow-up of feature 332 (`homelab-otel-host-provider`, design D-8): 332 accepted that alerts are not provider-scoped and deferred the scoping here.
- Story-time reads: the heartbeat (`xstk-analysis-no-scoring`) is a Loki rule, so its scoping uses the `deployment_environment` stream label and `host_provider` structured metadata, not the `target_info` join; 297 keeps alert rules a manual import (297 product-spec G11), so changed rules reach Grafana by operator re-import.
- Depends on 332 merged; sequence after 297.

## Session 2026-11-11 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready. Tree: main-dev@f99f667 (332 merged via PR #1518).
- Review rounds:
  - **Iteration 1 FAIL.** Criterion 9: five unchecked Open Questions. Warnings:
    - `.sh` guard paths (ported to `scripts/check-otel-produced-signals.py` by #1516);
    - FR-4/AC-6 required a `host_provider` selector that cannot exist on metric series or Loki stream labels;
    - AC-2/AC-4 asserted live-Grafana outcomes;
    - a hard dependency on 297, which is only `spec-ready`.
  - **Iteration 2 PASS WITH WARNINGS.** The `@manual` tag had no convention, and AC-9 pinned the mechanism.
    - `@manual` was then rejected outright: C-15 requires every scenario to be covered by a CI test step, so a manual-only scenario would block impl-spec review. AC-2/AC-4 were restated as offline evaluation against synthetic input instead.
  - **Iteration 3 PASS WITH WARNINGS.** The AC-4 LogQL fallback had to observe its Then, and AC-9 needed checkable literals.
  - **Iteration 4 PASS.** 0 warnings.
- Resolved:
  - **FR-3 expected stacks** are fixed at three (staging/digitalocean, staging/homelab, production/homelab), kept explicit in the rule file.
  - **Deferred to `/sdd-design`, each with its outcome fixed in an FR:**
    - the heartbeat mechanism (per-pair rule vs per-pair query);
    - LogQL grouping by structured metadata;
    - the `target_info` join inside Grafana-managed rules;
    - the offline evaluator: `promtool test rules` for PromQL; for LogQL, an offline evaluation or the named pair-filter CI test.
  - **Ledger traps** moved to `## Design Notes`.
  - **AC-9 added** (append-only), and **AC-8 extended** with the post-import check doc.
- Warnings: none.
- Overlap findings (WARN, non-blocking): file-level overlap with 297 on `packages/otel/produced-signals.tsv` and `packages/otel/dashboards/README.md`, plus `ci.yml` only if the guard changes (297/298/324). No config key, proto or migration collision.
  - No merge-order row is written. The spec records the dependency as soft, and whichever merges second rebases.
  - The overlap scan's "no guard test file on trunk" claim was wrong (its glob used hyphens). `scripts/tests/test_check_otel_produced_signals.py` exists.
- Recommended design depth: full (an overlap finding fires the escalate signal, and the live-datasource checks are deferred to recon).
