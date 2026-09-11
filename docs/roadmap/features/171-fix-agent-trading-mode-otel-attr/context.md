# Context: fix-agent-trading-mode-otel-attr  (archived 2026-09-09)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-09-09 — /sdd-archiver

**What**: A comment-audit item flagged the `xstockstrat-agent`'s `trading_mode` OTel resource attribute as stale post-feature-147. Recon revealed the attribute was a fleet-wide convention (all 12 telemetry modules emit it identically), redundant with `deployment.environment` 1:1 in both deploy targets, and queried by nothing in-repo. The user chose fleet-wide removal — the only internally-consistent fix — touching all 12 modules (Go ×3, Python ×4, Node ×4, UI ×1) plus the dashboards README, with per-module SDK Resource absence tests for every backend module (no C-08 waiver).

**Why (irrecoverable rationale)**: Three scope options existed — de-scope (leave the label), agent-only drop, fleet-wide drop. Agent-only lost because it would make the agent the lone divergent service. Fleet-wide won as the only internally-consistent fix despite being far larger than a SEV-3 agent bug. Renaming was rejected because the label is redundant, not mislabeled. The user explicitly rejected the C-08 representative-per-language test waiver; every backend module got its own test.

**Rejected alternatives**: De-scope/demote 171 — user wanted consistency cleanup; agent-only drop/rename — fleet divergence; rename to something else — redundant with `deployment.environment`; representative-per-language tests (C-08 waiver) — user rejected; plain-map builder test — asserts a proxy not the built Resource; whole-file deletion of `ui/src/telemetry.ts` — scope expansion.

**Scars & gotchas**: Node ESM vs CJS runner split: deferred `require` broke in ESM mode, fix was static top-level imports for lightweight OTel packages. ESM `.ts` import extension broke `tsc` production build (TS5097), fix was excluding test globs from tsconfig. Go `telemetry/` package excluded from CI coverpkg. Python agent monkeypatch must target module-local name.

**Permanent deviations**: Design said deferred `require` → shipped static imports (ESM incompatibility). Design said import paths resolved at execute → shipped two different extensions (`.ts` for ESM, bare for CJS).

**Cross-feature signal**: Feature 175 surfaced the tsconfig TS5097 build break from 171's `.ts` extension import — stacked PR pattern.

**Deferred follow-ons**: Out-of-repo Grafana Cloud dashboards may have `trading_mode` dimension; accepted as low-severity residual since `OTEL_ENABLED=false` in both deploy specs.

**Ledger entries written**: insights.md (0), fails.md (1) — see the 2026-09-09 entries.

**Runtime-invariant recommendations (→ /context-constitution)**: None.

**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 6c53133e315c7978a97fa36aa05fcdf11aca00a9.
