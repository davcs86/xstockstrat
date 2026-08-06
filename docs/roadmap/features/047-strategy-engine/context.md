# Context: strategy-engine  (archived 2026-08-05)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-05 — /sdd-archiver

**What**: Shipped a persisted, composable Strategy model (`analysis.strategies`) with a shared `StrategyEvaluator` module that both `RunBacktest` (this feature) and the live alerting runtime (feature 048) call directly, plus three new admin-scoped MCP tools (`manage_strategy`/`manage_formula`/`manage_signal_source`). Backward compatibility with the legacy SMA-crossover path was preserved as a parallel code path rather than replaced.
**Why (irrecoverable rationale)**: JSON condition tree chosen for entry/exit rules over a string grammar (harder to validate/transform in a future UI) and over a sandboxed formula (overkill for boolean logic) — product-spec.md:49. Evaluator deliberately placed as a plain importable module (not an RPC) so feature 048 could call it in-process with zero signature drift risk (context.md:45,313).
**Rejected alternatives**:
- Signals-as-rule-term — deferred because it would force the evaluator to do gRPC I/O per component, breaking its uniform stateless-series model and complicating look-ahead enforcement, and because feature 048's live-signal contract wasn't defined yet (product-spec.md:201-207).
- Admin gating via `xstockstrat-identity.ValidateApiKey` (`_validate_admin_token`) — built in Step 6, then discarded post-launch (see Permanent Deviations).
**Scars & gotchas**:
- Three inter-service `_ENDPOINT` vars (`INGEST_ENDPOINT`, `IDENTITY_ENDPOINT` for analysis; `INDICATORS_ENDPOINT` for agent) were used in code but silently missing from `docker-compose.yml`/`.do/app*.yaml` — only caught by explicit grep during spec re-runs (context.md:74-78).
- Docker daemon was unavailable on the execute host; migration up/down was verified against a local ephemeral postgres instead (context.md:119-122). Proto toolchain (`buf`, `protoc`) also absent — CI-pinned versions installed manually (context.md:90-93).
- `xstockstrat-agent` is not in the CI lint matrix and carries pre-existing ruff drift (UP045/I001/E501/F841); Steps 8/9/11 explicitly scoped ruff fixes to only the lines they touched (context.md:193-232).
**Permanent deviations**: - design said admin gating for `manage_strategy` via `xstockstrat-identity.ValidateApiKey` + `_validate_admin_token` (product-spec FR-13, implementation-spec Step 6) -> shipped a static `_has_admin_scope` check on the propagated `x-access-scope` bitmask, with `identity_channel`/`IDENTITY_ENDPOINT` fully removed from analysis -> because the user asked, after building feature 048, to "use the same admin gate logic for 047 for consistency" so both features share one authn/authz model (context.md:272-286). `manage_signal_source`→ingest and `manage_formula`→indicators kept their original, different gates.
**Cross-feature signal**: When two features share a security-sensitive contract (the admin gate here, reused by 048), building the second feature can trigger a retroactive rework of the first's shipped code for consistency.
**Deferred follow-ons**: signals-as-rule-term (048 or a dedicated follow-up); a visual strategy builder UI (config-ui/insights); walk-forward validation (feature 032) should reuse this evaluator.
**Ledger entries written**: insights.md (2), fails.md (1) — see the 2026-08-05 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - Candidate PLAT-*: "A service's outbound `_ENDPOINT` env var can exist in application code with a hardcoded default while being absent from `docker-compose.yml` and both `.do/app*.yaml` — grep-verify all three locations, never assume from code alone." (context.md:74-78, 253, 593-594, 725-726)
**Pruned artifacts**: product-spec.md, implementation-spec.md — last present at f5abed5.
