# Product Spec: proto-deprecated-field-removal-program

**Type**: tech-debt / breaking-change program · **Severity**: SEV-3 · **Config-only**: no
**Status**: draft (design-only — NOT implemented in the today's-triage bug PR)

## Source

`docs/reports/2026-09-18-deprecated-fields-in-rpc-contracts-defect.md` **Defect 2** — the per-proto
inventory of the 33 `[deprecated = true]` fields. That report is the authoritative candidate list.

## Objective

Retire the genuinely-dead deprecated proto fields safely, `reserving` their field numbers / enum
values, without breaking old clients or any BSR/external consumer, and while keeping the fields that
turn out to still be load-bearing.

## Consumer Surface(s)

**None — internal/platform-only** (C-14). Removing verified-dead proto fields has no end-user-visible
consequence; the "surface" is the wire contract, whose consumers are the platform's own services
(covered by the per-field reader audit) and any BSR/external consumer (an open question below).

## Out of Scope

- `portfolio.proto` `repeated string symbols` (field 235) — has a **live reader**
  (`live_loop.py:525`, `_drain_watchlist` legacy-row fallback) and staging returns it populated. Not
  removed until legacy rows are migrated onto `bindings`.
- The enum-value cohort (`TIMEFRAME_*`, `ENVIRONMENT_DEV`, `VALUE_TYPE_FLOAT_MAP`) may stay
  `deprecated` **indefinitely** — removal is gated on a data audit and may never be worth it.
- Any field a per-field reader audit finds still consumed.

## Open Questions

- [ ] **BSR / external-consumer exposure** — are these protos published to a BSR/external consumer? If
  so, removal breaks consumers outside this repo's CI and changes the deprecation window entirely.
  Must be resolved before any removal batch begins.

## Inventory (candidate — NOT verified-dead)

| Proto | Count | Fields |
|---|---|---|
| analysis | 1 | `ListStrategiesRequest.user_id` |
| common | 5 | `ENVIRONMENT_DEV`; `TIMEFRAME_1MIN`/`_5MIN`/`_15MIN`/`_1HOUR` |
| config | 7 | `trading_mode` ×6; `VALUE_TYPE_FLOAT_MAP` |
| indicators | 2 | `user_id` ×2 |
| ingest | 3 | `timeframe` ×2; `operation` (string) |
| marketdata | 4 | `timeframe` ×4 |
| portfolio | 6 | `user_id` ×5; `symbols` (**live reader — do NOT remove without migration**) |
| trading | 5 | `user_id` ×4; `is_paper` |

## Hard constraints

1. `buf breaking` rejects each removal by design — follow `docs/runbooks/proto-versioning.md`.
2. Every removed field number **and** enum value must be `reserved` (else a later feature silently
   reuses a number old clients still populate).
3. Enum-value removals (`TIMEFRAME_*`, `ENVIRONMENT_DEV`, `VALUE_TYPE_FLOAT_MAP`) have **stored
   numeric values** — a data audit is required before any are touched; likely stay deprecated
   indefinitely.
4. Per-field reader verification is mandatory before removal — `portfolio.proto:235 symbols` is a
   proven counter-example (live reader at `live_loop.py:525`; staging returns it populated).

## Governance gates (why this is a program, not a PR)

- **Approval**: 2 owners + platform lead per breaking proto change (root `CLAUDE.md` § Approval Flow; `docs/runbooks/proto-versioning.md` for the approval requirements — **not** `docs/runbooks/approval-flow.md`, which covers order approval).
- **BSR / external consumers**: confirm exposure; if published, removal breaks consumers outside this
  repo's CI and changes the deprecation window entirely.

## Suggested sequencing (for /sdd-design)

1. Safest cohort first: the 12 already-server-ignored `user_id` body fields (identity comes from
   `x-user-id`) as one approved batch.
2. Then the remaining dead scalar fields after per-field reader audits.
3. Enum-value cohort last, gated on the data audit — or an explicit decision to leave them
   "deprecated forever with a comment" as the correct terminal state.

## Acceptance

See `acceptance.feature` — old-client safety + reserved-numbering guards (to be expanded during
`/sdd-design`/`/sdd-spec`).
