# Context: unify-admin-auth-gates

**Feature**: `docs/roadmap/features/049-unify-admin-auth-gates/feature.md`
**Product Spec**: `docs/roadmap/features/049-unify-admin-auth-gates/product-spec.md`
**Implementation Spec**: _not yet generated_

---

## Session 2026-06-05 — backlog capture (during 047/048 execution)

- Created as a backlog item while executing features 047 (`strategy-engine`) and 048
  (`live-strategy-alert-engine`) sequentially. During the user-requested admin-gate consistency pass,
  `xstockstrat-analysis` was aligned to a single model: **internal services do an `x-access-scope`
  ADMIN-bit role check (`_has_admin_scope`), authentication/authorization lives at the entry points**
  (UI BFF JWT, MCP agent SSE), and the agent validates the admin role at the entry
  (`client.validate_admin`).
- Two gates were **deliberately left out of 047's scope** because changing them means modifying services
  047 doesn't own:
  - `xstockstrat-ingest` `ManageSignalSource` → still uses `_validate_admin_token` (Bearer + identity
    `ValidateApiKey` re-auth inside the internal service).
  - `xstockstrat-indicators` formula management → uses author-ownership (`user_id == author`), a
    genuinely different authorization concern.
- This feature tracks bringing ingest into the unified model and **deciding** (OQ-1) whether the
  indicators ownership model stays distinct or is unified/augmented with admin scope.
- Code references for the future spec:
  - Target pattern: `services/xstockstrat-analysis/app/handlers/servicer.py` `_has_admin_scope`
    (post-047/048); agent `services/xstockstrat-agent/app/client.py` `validate_admin` + `_admin_metadata`.
  - ingest gate today: `services/xstockstrat-ingest/app/handlers/servicer.py` `_validate_admin_token`
    + `ManageSignalSource`.
  - indicators gate today: `services/xstockstrat-indicators/app/handlers/servicer.py`
    `RegisterFormula`/`UpdateFormula`/`DeleteFormula` (`user_id == author`).
  - agent tools: `manage_signal_source`, `manage_formula` in `services/xstockstrat-agent/app/tools.py`.
- **Do NOT start before 047/048 are merged to main-dev** — the `_has_admin_scope` / `validate_admin`
  pattern this feature extends only lands there once 047/048 merge.
