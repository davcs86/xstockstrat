# Context: fix-mcp-extract-credentials  (archived 2026-08-06)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-06 — /sdd-archiver

**What**: Extract-tool credentials were never made to work — the design ruled out entrenching a plaintext-config secret and instead shipped a loud `RuntimeError` for `has_credentials=True` sources plus an env-scoped, typed-oneof `get_config_value` fix for the legitimate callers (alert threshold, OAuth DCR). AC-3 (a real per-source credential resolver via ingest) was deferred as an underspecified separate feature (recon.md:76-83, design.md:67-69).
**Why (irrecoverable rationale)**: [DUP:docs/roadmap/ledger/insights.md:473] — secrets are `is_secret` references that `GetConfig` redacts on read; a plaintext credential config key would violate C-05 *and* be disclosed unredacted by the same `get_config` tool meant to protect it. Loud failure was judged more honest than a governance-breaking "fix."
**Rejected alternatives**:
- Option (a) plaintext credential + document seeding — breaches C-05/invariant #6, discloses via `get_config` (design.md:75-77)
- Option (b) `secret.*`-prefixed reference — redacted value never materializes for actual use, collapses into the radical anyway (design.md:78-79)
- Radical now (AC-3) — `credentials_ref` has zero resolution convention in ingest (opaque free-text, mixed `secret.*`/`vault://` styles in test data); building one is a separate feature (recon.md:76-83)
- Re-typing `signal.alert_threshold` to string to dodge the oneof bug — leaves `get_config_value` a string-only footgun for the next typed key (design.md:83-85)
**Scars & gotchas**:
- Best-effort callers (alert threshold, OAuth DCR) needed **broad `except Exception`**, not narrow `AioRpcError`, because those reads sit *after* the signal is already persisted or outside `register()`'s try — a re-raised transport or lazy-import error would otherwise fail an already-committed operation (design.md:39-43, context.md:34-35, O2)
- The RED-first float_val→`"0.7"` test was the actual antidote proof: reverting the projection to `string_val`-only made it fail (context.md:139-141) — a scope-only test would have missed the hidden oneof bug entirely
**Permanent deviations**: none — design's option (c) shipped as specified; AC-3/AC-4 deferral/reinterpretation was a design-time gate resolution, not a build-time divergence (context.md:44-47, 152-153).
**Cross-feature signal**: none beyond [DUP:insights.md:473]'s RC-1-projection extension.
**Deferred follow-ons**: - AC-3: a secure per-source credential resolver (ingest `ResolveSourceCredential` or server-side extraction) — needs a credential-resolution convention defined first (product-spec.md:62-63, design.md:67-69)
**Ledger entries written**: insights.md (1), fails.md (0) — see the 2026-08-06 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none
**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at f871138.
