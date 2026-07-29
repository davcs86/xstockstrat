# Context: mcp-config-management

**Feature**: `docs/roadmap/features/073-mcp-config-management/feature.md`
**Product Spec**: `docs/roadmap/features/073-mcp-config-management/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/073-mcp-config-management/implementation-spec.md`

---

## Session 2026-07-28 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Trigger: while setting up staging paper-trading alerts, hit the fundamentals-pipeline gap
  (features 059/062 disabled by config flags `marketdata.fmp.enabled` /
  `analysis.fundsignal.enabled`, and `secret.marketdata.fmp.api_key` unset) with no MCP tool, CLI
  script, or config-ui path to fix it — only a raw `SetConfig` gRPC call. User asked to add this
  gap to the feature backlog.
- Read `docs/runbooks/feature-workflow.md`, `docs/runbooks/reviewer-registry.md`,
  `docs/roadmap/ledger/fails.md`, `docs/roadmap/ledger/insights.md` per SDD boot sequence.
- Key ledger read applied: 2026-07-20 (`trigger-backfill-mcp-tool`, design) — a new MCP tool has
  multiple discovery/documentation surfaces (tools.py, agent CLAUDE.md, mcp-tools.md, runbooks
  index, and the task-oriented operational runbook — here `config-rollout.md`). Folded into FR-6.
- No directly-applicable `fails.md` entry found for this specific shape (new admin MCP tool over
  an existing RPC); the closest security-relevant registry entry is the `xstockstrat-agent` row's
  standing "no secret values in tool output" invariant, applied here as FR-4.
- Confirmed via direct inspection (this session, prior to /sdd-story) that `GetConfig`,
  `SetConfig`, `ListKeys` RPCs already exist (`packages/proto/config/v1/config.proto:17-27`) — no
  proto changes anticipated for this feature.
- Flagged as an explicit **known trap** in product-spec Out of Scope: `secret.*` config values
  have no real secret-store resolution today (`SetConfig` stores plaintext); this feature must not
  be designed/reviewed as if it adds secret encryption.

## Session 2026-07-28 (later) — user decisions on Open Questions

User answered the two draft Open Questions directly:
1. `get_config` must never return a value for `is_secret == true` keys, but `set_config` must
   still be allowed to write a new value to those keys. (This was already FR-1/FR-4's intent;
   restated/confirmed as a firm decision, not left open.)
2. `set_config` should allow touching **any** namespace/key (no denylist), but authorization must
   depend on the real calling user's role — explicitly rejecting the hardcoded admin
   `x-access-scope` pattern the other management tools use.

Before writing decision 2 into the spec, ran recon to check feasibility (a "depends on user role"
requirement is meaningless if nothing checks the role). Findings, all cited with file:line in
product-spec.md FR-5/FR-7:
- `xstockstrat-config`'s `SetConfig`/`GetConfig`/`ListKeys` perform **no authorization check at
  all** today (`services/xstockstrat-config/src/grpc/configServiceImpl.ts:251-310`) — anyone
  reaching gRPC port 50060 can already call `SetConfig` unauthenticated.
- The agent's OAuth layer already validates the caller's JWT (`app/auth.py:28-46`
  `validate_bearer_jwt`) and receives `TokenClaims.roles`, but discards everything except a
  boolean audience check — constitution invariant **AGENT-4** documents that the agent forwards
  only `x-mcp-secret` + a hardcoded admin scope today, never real user identity.
- Platform's real role→scope mapping already exists and has a working reference implementation:
  `rolesToAccessScope` (`services/xstockstrat-ui/src/lib/auth.ts:65-76`) +
  `bffShared.ts:41-46` forwarding pattern. `ADMIN_SCOPE = 0x04`.
- **Verdict: two-service change**, not an agent-only fix. `xstockstrat-agent` must retain and
  forward the real per-request role/scope (new, narrow deviation from AGENT-4, scoped to
  `set_config` only — other management tools keep using the hardcoded `_admin_metadata()` helper
  unchanged). `xstockstrat-config` must gain a first-ever `ADMIN`-bit check on `SetConfig`.
- **Adjacent live security gap surfaced, out of this feature's default scope**: the UI's own
  `SetConfig` BFF route (`services/xstockstrat-ui/src/lib/configUiBff.ts:14-22`) only requires a
  valid session (`requireSession`), not admin scope — so today any authenticated UI user of any
  role can already write arbitrary config, including `platform.maintenance_mode`, through the
  browser. FR-7's new RPC-level gate will incidentally close this (same underlying RPC), but it's
  flagged as a pre-existing exposure independent of this feature, not silently rolled in — see
  product-spec.md Open Questions, and told to the user directly to consider via
  `docs/runbooks/bug-triage.md`.
- Updated `product-spec.md` (FR-3/FR-4/FR-5 rewritten, new FR-7, Affected Services expanded to
  include `xstockstrat-config`, Feature Workflow Notes now requires both service owners + a
  mandatory Security review, Acceptance Criteria 7-9 added, Open Questions updated) and
  `feature.md` (Reviewers table: added `xstockstrat-config` owner, Security marked required).

## Session 2026-07-29 — cross-feature reconciliation with 074

Feature **074** (`fix-config-write-authz`) was designed and implemented first in this session (see
that feature's `context.md`), which discharges this feature's FR-7. Rewrote FR-7 from "this feature
must add the ADMIN check" to "already implemented by 074 — verify, do NOT reimplement", closing the
one real collision the `/sdd-review` overlap scan found. Also updated, for the same reason:

- **Affected Services** — `xstockstrat-config` is no longer modified by this feature; it is now a
  pure consumer. This feature is agent-only again.
- **Feature Workflow Notes** — the config service owner's approval is no longer gated on this PR.
  The Security review stays **required**, but the reason changed: it is no longer "this adds the
  first authz check", it is "this is the first caller to forward a real per-user scope instead of
  the hardcoded admin tuple".
- **Open Question (reads)** — resolved. 074 settled it on the code rather than on this feature's
  assumption: every service boots over an **unauthenticated `WatchConfig`** whose first message is a
  full namespace snapshot — a superset of `GetConfig` — so gating reads is incoherent without
  gating `WatchConfig`, which would break platform startup. `get_config`/`list_config_keys`
  therefore inherit no new constraint.
- **Open Question (UI-side gap)** — resolved. The `configUiBff.ts` `requireSession`-only hole was
  split out as SEV-1 bug 074 and fixed there, exactly as this file said it should be (not silently
  bundled).

**New constraint 074 imposes on this feature:** `SetConfig` now also rejects `INVALID_ARGUMENT`
when a write carries neither an explicit `author` nor a propagated `x-user-id`. Because the agent
does not forward `x-user-id` (invariant **AGENT-4**), `set_config` MUST always send an explicit
`author`. FR-3 already makes `author` a required tool parameter, so this holds by construction — but
it is now load-bearing rather than a convention, and any future "make author optional" change would
break the tool.

Verified directly this session, ahead of the design phase:
- `services/xstockstrat-agent/app/tools.py` registers exactly **14** `@server.tool` functions, so
  FR-6's "fourteen → seventeen" count is accurate, and the "fourteen" string appears in
  `services/xstockstrat-agent/CLAUDE.md` and twice in `docs/runbooks/mcp-tools.md`.
- `app/auth.py` `validate_bearer_jwt` returns a bare `bool` and discards `claims.roles` entirely —
  FR-5 genuinely requires reshaping that function's return, not just reading an existing value.
