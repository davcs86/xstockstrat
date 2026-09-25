# sdd-design — recon.md template

Write `$FEATURE_DIR/recon.md` using this exact structure. Every `path:line` must come from a
`codebase-discovery` digest — never invent (Constitution **F-04**).

```markdown
# Recon: <slug>

**Created**: <ISO date>
**From**: product-spec.md
**Affected services**: <list from product-spec>

---

## Objective

<2–3 sentences distilled from product-spec.md — what is being built and why>

## Codebase Map

For each affected service:
- **`xstockstrat-<name>`** (<lang>)
  - Entry point: `path:line`
  - Handler/servicer: `path:line`
  - Last migration: `NNN_<name>.up.sql` (`path`)
  - Config-read pattern: `path:line`
  - Other key symbols: `<symbol>` — `path:line`

## Patterns to REUSE

<The anti-duplication core. For each thing the feature needs, name the existing pattern to reuse.>
- `<what to build>` → reuse `<existing pattern/helper/type>` at `path:line`
- ...

## Existing Business Rules (preserve / extend)

<Constitution **C-16** — the behavioral counterpart to Patterns to REUSE. Folded from the
`scenario-recon` subagent's digest, which reads `services/xstockstrat-<svc>/acceptance/*.feature` for
each affected service plus `docs/sdd/business-rules/platform.feature` and lists the existing
guarantees this feature must not break, plus any it intends to extend or change.>
- **PRESERVE** `@AC-<n>` "<scenario title>" (`services/xstockstrat-<svc>/acceptance/<file>.feature`) — this feature must not regress it
- **EXTEND** `@AC-<n>` "<scenario title>" — this feature adds a new case alongside it
- **CHANGE** `@AC-<n>` "<scenario title>" — this feature deliberately alters the guarantee (requires user sign-off recorded in `context.md`; carry into design.md)
- <none found for a service → "no existing acceptance suite for xstockstrat-<svc> yet">

## Dependencies

- Proto/RPC: <messages/RPCs touched; existing field numbers `path:line`> | none
- Migration: next number `NNN` for `services/<name>/migrations/` | none
- Config keys: `<service>.<category>.<key>` (new/existing) | none
- Inter-service edges: <caller → callee (gRPC)> | none
- New env vars / ports: `<VAR>` — absent from docker-compose.yml / .do/app.dev.yaml / .do/app.yaml | none

## Risks / Not-found

- <unknown, gap, or `## Not found` item from discovery — carry forward, never guess>
- <applicable `fails.md` trap: ...>

## Recommended Scope

<advisory proposed step boundaries — input to the grilling and /sdd-spec; not binding>
```
