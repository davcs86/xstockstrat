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

## Session 2026-06-06 — sdd-story (flesh out product spec)

- **Dependency cleared:** 047 (`strategy-engine`, PR #581) and 048 (`live-strategy-alert-engine`,
  PR #596) are both merged to `main-dev`. The `_has_admin_scope` / `validate_admin` pattern is present.
- Fast-forwarded `claude/product-spec-049-ZiIXN` to `origin/main-dev` (`8b0245c`) so the 049 files
  are on the working branch.
- **Verified the backlog spec's premises against the merged code** — all accurate:
  - analysis target: `_has_admin_scope` at `services/xstockstrat-analysis/app/handlers/servicer.py:58`
    (checks `x-access-scope & 0x04`); gates `ManageStrategy` (`:655`) and `SetStrategyLive` (`:726`).
  - agent: `validate_admin` (`app/client.py:374`), `_admin_metadata` (`app/client.py:30`); strategy
    tools forward `x-access-scope: 7`.
  - ingest: `_validate_admin_token` (`app/handlers/servicer.py:47`) re-auths via identity
    `ValidateApiKey`; **only** call site is `ManageSignalSource` (`:427`) → `identity_channel` removal
    (FR-3) is clean. Wiring at `app/main.py:60,67`.
  - agent `manage_signal_source` tool (`app/tools.py:320-351`) has **no** entry `validate_admin` and
    forwards no `x-access-scope` (the `validate_admin` at `:364` belongs to `set_strategy_live`).
  - indicators: `UpdateFormula`/`DeleteFormula` enforce `row["author"] != request.user_id`
    (`:211,236`); **`RegisterFormula` (`:135-150`) is effectively ungated** — `author` defaults to
    `"dev-user"`. New finding surfaced into the spec.
  - UI BFF callers exist: `config-ui/hooks/useSignalSourceMutations.ts`, `hooks/useFormulas.ts`.
- **Fleshed out `product-spec.md`** to the standard SDD template + grounding: added User Story,
  Affected Services (with file:line evidence), Proto/Config/DB change declarations (all "none"),
  Feature Workflow Notes (dependency satisfied; approval gates), FR-7 + AC-4/5/6, the
  `RegisterFormula` gap, and an "Open Questions — Review & Recommendations" section (OQ-1 keep
  ownership + admin override + close RegisterFormula gap; OQ-2 verify ingress header-strip; OQ-3 defer
  shared helper, duplicate now).
- Status stays `draft`. Next action unchanged: `/sdd-review unify-admin-auth-gates product-spec`.

## Session 2026-06-06 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Criteria: all PASS (Problem Statement, FR-1..7, Out of Scope/Non-Goals, Affected Services exact-match
  registry, Proto/Config/DB all declared none, AC-1..6, Open Questions no unchecked checkboxes).
- Trading-domain checks: skipped (non-trading feature).
- Warnings: 1 — `018-agent-mcp-oauth` (implementation-ready) also modifies `xstockstrat-agent`;
  coordinate merge order. Low collision risk (018 = SSE/OAuth auth layer `app/auth.py` + `agent.oauth.*`
  config keys; 049 = tool layer `manage_signal_source` + `client.py`; different files, no shared key).
- Advisory: OQ-1 (formula author-ownership vs admin-scope) is a genuine pending decision with an owner
  (Platform Lead + Security) and a recommendation; settle it before/at /sdd-spec. FR-4 accommodates
  either outcome, so it does not block product-spec approval.
- Note: 041-upgrade-nextjs15 touches the UI but 049 expects no UI code change → no real overlap.
- Next: /sdd-spec unify-admin-auth-gates.
