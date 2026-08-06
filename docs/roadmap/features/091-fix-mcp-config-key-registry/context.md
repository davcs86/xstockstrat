# Context: fix-mcp-config-key-registry  (archived 2026-08-06)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-06 — /sdd-archiver

**What**: Closed the `set_config` typo-orphan hole with a single-table, server-authoritative fix — no new registry table. A mode-exact existence gate in `setConfig` refuses writes to an unregistered `(namespace,key,environment,trading_mode)` scope unless the additive `create_key` proto field is set, and a dedicated `AFTER INSERT` audit trigger (migration 010) makes creation auditable without touching the existing `BEFORE UPDATE` trigger. Agent `set_config` is a pure passthrough; the refusal lives only server-side. The NOT_FOUND surface was deliberately narrowed to the write path only — reads stay open.
**Why (irrecoverable rationale)**: A registry table (Round-1 proposal) was rejected because it would duplicate `is_secret`/metadata that no read path would consult — dead columns plus a two-write drift/leak surface for a structural win nobody needed. AC-3's "registered but unset as a distinct persisted state" was deliberately reinterpreted as "registered ≙ has a value row" because every reader (`ListKeys`/`GetConfig`) reads value rows only (context.md 2026-08-02 design session; design.md Open Risks).
**Rejected alternatives**:
- `config.config_registry` table — dead `is_secret`/metadata columns, drift/leak risk (design.md Rejected Alternatives).
- Nullable `value_data` (Alt B) — satisfies AC-3 literally but ripples NULL-handling into 3 read paths for an unobserved state.
- Single widened `BEFORE INSERT OR UPDATE` trigger — double-fires under `ON CONFLICT DO UPDATE` (phantom creation rows).
- Mode-broadening existence SELECT — manufactures a nondeterministic read-shadow (design.md §2).
- Agent client-side existence refusal — breaks empty-`keys` mocks and leaves config-ui ungated.
- Advisory lock around existence-SELECT-then-upsert — deliberately **not** added; the upsert's `ON CONFLICT DO UPDATE` demotes the TOCTOU loser to a harmless UPDATE (design.md Open Risks — Concurrency, accepted).
- **Extending NOT_FOUND to `getConfig`/`listKeys`/`watchConfig` on a miss** (recon.md:74's recommended scope) — rejected at design time in favor of leaving all three on empty-return, with two *different* rationales per surface: `getConfig`/`watchConfig` stay empty for **boot safety** (a NOT_FOUND on a startup config fetch could crash a service's boot path), while `listKeys` stays empty on **UX grounds** — "it is an admin/config-ui read, not a boot path" (design.md:65-70, AC coverage §AC-2). This is a genuine narrowing of AC-2 from recon's proposal, not an oversight: shipped code still returns empty on all three reads, so a future agent must not "fix" this as inconsistent with the write-path NOT_FOUND behavior.
**Scars & gotchas**:
- ts-proto sends **camelCase** over the real gRPC wire (`createKey`, not `create_key`); impl reads defensively as `call.request.createKey ?? call.request.create_key` — a prior snake_case-only read was already a logged defect (`setConfigAuthz.test.ts:173-178`; context.md sdd-spec session 2026-08-02).
- Landing the existence gate silently broke two **sibling** suites (`configValueRoundtrip`, `scopeResolution`) whose always-empty mock pools stopped returning a row for the new existence SELECT.
- Config tests run against **compiled `dist/`**; a suite can report pass with zero assertions (074 trap) — every new case had to be proven red in compiled output.
- The TOCTOU race was accepted, not eliminated — no lock/race comment exists in shipped code, so this rationale survives only here.
**Permanent deviations**: none — all 8 steps landed as designed.
**Cross-feature signal**: - Features 092 (writepath-authz) and 093 (extract-credentials) both touch `client.set_config` scope forwarding and rebase onto merged 091 rather than race it (context.md:106-107).
**Deferred follow-ons**:
- AC-3 unset-half reinterpretation: revisit if a future feature needs a value-less registered key (→ nullable `value_data`).
- AC-2 read-path NOT_FOUND narrowing: revisit if `getConfig`/`listKeys`/`watchConfig` ever need miss-signaling — was consciously deferred, not forgotten.
- Governance narrowing (config-ui can no longer typo-mint keys) documented but not gated in code — verify-only.
**Ledger entries written**: insights.md (2), fails.md (1) — see the 2026-08-06 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none — audit-on-UPDATE-only defect already tracked in `docs/context-constitution-findings.md:22`, marked RESOLVED per Step 8.
**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at f871138.
