# Context: config-ui-weight-validation  (archived 2026-08-05)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-05 — /sdd-archiver

**What**: Shipped a proto-declared `ValidationRule` (value_type/min/max) on `ConfigKeyMeta` so the config-ui weight editor rejects out-of-range values client-side before `SetConfig`, instead of relying on the analysis service's silent server-side clamp. Landed as 6 stacked PRs (#544–#549), fully backward-compatible (absent field = no validation).
**Why (irrecoverable rationale)**: At the product-spec review gate, client-side key-name heuristic detection (Option A) was explicitly rejected in favor of proto-declared rules (Option B) because heuristics don't generalize — every future config key needing bounds would need new UI pattern-matching, whereas a proto field gives automatic enforcement to any client (UI or agent) (context.md Session 2026-06-01T00:01:00Z).
**Rejected alternatives**:
- Option A (client-side key-name/suffix heuristic, no proto/backend change) — lost because it doesn't scale to future validated keys without repeated UI-side pattern additions (context.md Session 2026-06-01T00:01:00Z; also product-spec.md Out of Scope).
- Implementing before feature 045 landed (targeting `xstockstrat-config-ui`) — rejected in favor of waiting, since 045 was going to delete that service; building there would be immediately obsolete (product-spec.md Merge-order Dependencies; context.md 2026-06-01 review notes).
**Scars & gotchas**:
- `buf breaking --against ".git#branch=main-dev"` fails when run from `packages/proto` because `.git` lives at the repo root, not under the subdir — must use `<repo-root>/.git#branch=main-dev,subdir=packages/proto` (the form `scripts/buf-gen.sh` already uses) (implementation-spec.md Deviation Log, Step 1; context.md 2026-06-04).
- The DB `value_type` column on config keys is a **storage type** (`string`/`int`/`float`/…), not the semantic type needed for validation — a naive dev could assume it already encodes bounds-checkable semantics; validation had to be computed from a separate static key-name registry (`WEIGHT_KEY_REGISTRY`) instead (context.md Session 2026-06-01T00:02:00Z, sdd-spec findings).
- Playwright e2e for `xstockstrat-ui` timed out under the harness (Next.js dev-server on-demand compile) — same class of failure seen earlier in feature 003; tsc/lint fallback was pre-approved in the spec and used again here (implementation-spec.md Deviation Log, Step 6; context.md 2026-06-04).
**Permanent deviations**: - design said: Steps 5–6 target `services/xstockstrat-config-ui/app/[namespace]/page.tsx` -> shipped: `services/xstockstrat-ui/src/app/config-ui/[namespace]/page.tsx` using the 044 TanStack Query hooks (`useConfigKeys`/`useSetConfig`) and an inline-typed (not named-interface) `keys` array -> because feature 045 (`ui-consolidation-nextjs`) merged and deleted `xstockstrat-config-ui` before this feature's execute phase, forcing a mid-flight re-spec of Steps 5–6 (context.md Session 2026-06-04, "Steps 5–6 re-spec").
**Cross-feature signal**:
- Second occurrence (after feature 003) of Playwright e2e timing out under this harness due to Next.js dev-server on-demand compilation, both resolved via the documented tsc/lint fallback — suggests the harness itself, not the test code, is the recurring constraint for `xstockstrat-ui` e2e runs.
- Confirmed pattern: features whose UI step depends on an in-flight consolidation feature (045) should sequence execution *after* that feature merges rather than spec against a soon-to-be-deleted path — this feature paid the re-spec cost by not waiting.
**Deferred follow-ons**:
- Product-spec Out of Scope: validation of non-weight key types (enums, booleans, free-form strings) — explicitly deferred as a follow-on feature.
- Step-review W4 flagged mock-backend.ts overlap with feature 019 (both add to the shared config-ui `listKeys` mock) — resolved by execution ordering (019 before 016), not a structural fix; future features touching the same mock file should check ordering again.
**Ledger entries written**: insights.md (2), fails.md (1) — see the 2026-08-05 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none — the DB `value_type` vs proto `ValueType` naming collision is feature-local color captured above in fails.md; not proposed as a standalone PLAT-*/CONFIG-* invariant since `xstockstrat-config`'s own CLAUDE.md/docs are the natural home if it recurs.
**Pruned artifacts**: product-spec.md, implementation-spec.md — last present at 33ff5dc.
