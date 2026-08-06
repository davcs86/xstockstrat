# Context: fundamentals-scoring-model  (archived 2026-08-06)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-06 — /sdd-archiver

**What**: Shipped as a pure per-symbol scoring **formula** (not a service RPC or config-driven rule engine) executed through the existing indicators sandbox, with fundamentals passed straight through the sandbox's untouched `input_data`/`params` contract — zero proto, migration, or config-key changes (feature.md:34-37; context.md:12-14, 67-69).
**Why (irrecoverable rationale)**: Delivering as a formula (vs. hardcoded service logic) was chosen specifically so weights/bands are retunable via typed params with no deploy, and so the model stays transparent/inspectable rather than a black box (context.md:12-14; product-spec.md FR-6). Cross-sectional peer normalization was deliberately excluded from the formula and pushed to feature 062's orchestration to keep the formula a pure, universe-independent per-symbol function (context.md:19-20; product-spec.md OQ-063-d).
**Rejected alternatives**:
- Config keys for weights/bands (`analysis.fundsignal.*`) — lost because typed formula `params` (058-formula-parameters) give the same no-deploy retuning without creating a namespace collision risk with feature 062's config keys (context.md:29-33, OQ-063-c).
- Cross-sectional/peer-relative normalization inside the formula — lost because it would make the formula depend on the rest of the universe, breaking the "pure per-symbol function" property; deferred to 062 (context.md:19-20).
- Original dependency citation "052" for typed params — was factually wrong; corrected to the actually-launched `058-formula-parameters` during spec review (context.md:34-36).
**Scars & gotchas**: - `RegisterFormula` mints a random UUID per call with no name-uniqueness DB constraint, so no seeding mechanism existed anywhere in the codebase before this feature — a naive "register on every startup" would have duplicated rows on every restart (context.md:50-58; implementation-spec.md:59-63). Fixed via an idempotent startup seeding hook (deterministic UUIDv5 `FORMULA_ID`, `FormulasRepository.upsert` with `ON CONFLICT (formula_id) DO UPDATE`), invoked non-fatally from `app/main.py` after the DB pool is established.
**Permanent deviations**: none — implementation matches product-spec/impl-spec closely (context.md session 2026-06-29 confirms all 6 steps as specced).
**Cross-feature signal**: The seeded-formula "system" author pattern this feature introduced ad hoc (no prior governance) turned out to need RPC-level mutation protection that wasn't specced here — already captured as [DUP: docs/roadmap/ledger/fails.md:46].
**Deferred follow-ons**:
- Growth/momentum factors (additive later, out of scope per product-spec.md).
- Peer-relative/cross-sectional normalization enhancement (documented hook, lives in 062).
- beta/market_cap reserved for a future risk/size factor, deliberately excluded from v1 composite (product-spec.md FR-4).
**Ledger entries written**: insights.md (1), fails.md (0) — see the 2026-08-06 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none
**Pruned artifacts**: product-spec.md, implementation-spec.md — last present at f871138.
