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
