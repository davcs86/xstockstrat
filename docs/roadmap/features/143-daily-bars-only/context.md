# Context: daily-bars-only  (archived 2026-08-26)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-26 — /sdd-archiver

**What**: Removed `15m`/`1h` timeframe support platform-wide (broad scope, chosen by the user over an ingester-only narrow option). Shipped as one cohesive PR across proto → marketdata → ingest → agent → UI: deprecate-not-remove the two proto enum values, layered `INVALID_ARGUMENT` rejection at every hop, no DB migration. Historical `15m`/`1h` rows in `marketdata.ohlcv` were deliberately left inert (read-only forever), with `GetDataCoverage`/`DeleteBackfilledData` kept permissive on purpose so an operator can still inspect/clean them later.

**Why (irrecoverable rationale)**:
- **Rejection was placed at the RPC-handler layer, not inside `internal/timeframe.Resolve`**, specifically because that package has a documented defect history (`080-fix-backfill-timeframe-enum`) and `GetDataCoverage`/`resolveDeletePlan` still need it to resolve historical rows. Handler-layer rejection is a strict superset of FR-1/FR-2 at zero risk to the trap-prone package.
- **No migration**: the only precedent (`003_canonicalize_ohlcv_timeframe`) requires quiescing `StartBarIngestPoller` + DBA review because `timeframe` is a PK column under 60s-cadence concurrent writes; deletion has zero functional payoff once the RPCs reject the rows.

**Rejected alternatives**:
- Reject inside `internal/timeframe.Resolve` — lost: trap-prone package + still needed by the permissive read paths.
- DB migration deleting historical rows — lost: PK-column concurrent-write risk, no payoff.
- Reject `GetDataCoverage` too — lost: read-only, no Alpaca spend, it's the sanctioned inspection tool for the inert rows (preserved as an inline code comment).
- Step order UI/agent/ingest-first, marketdata-last — lost: leaves the authoritative RPC open longest to uncovered callers (scripts/grpcurl) and doesn't stop the always-on poller writing fresh `15m` rows.
- Shared cross-service/cross-language timeframe-validation library (to eliminate the ingest/agent/marketdata triple-validation) — lost: oversized/out-of-scope; minimal-scope-per-table narrowing is the accepted drift mitigation (why three parallel alias tables are tolerated).

**Scars & gotchas**:
- `pytest.raises(match=...)` uses `re.search`, so narrowing an error-message substring yields NO red-before-green when the new string is a substring of the old; probing an always-invalid value (`"1w"`) also tests nothing about the narrowing. The RED must probe a value that flipped accepted→rejected (`15m`/`1h`) (D-5).
- ChartPanel e2e AC-8: the mount's `GetBars` fetch races the async lightweight-charts series init and is never retried because `seriesRef` is not a `fetchBars` effect dependency — so capturing the mount fetch is flaky. Deterministic trigger = change an actual `fetchBars` dep (the still-present bar-count selector 100→200), not the removed timeframe tab. Only surfaced by a real prebuilt/CI-mode e2e run, not `pnpm dev` (D-6).
- In `TriggerBackfill`, the admin gate (`_has_admin_scope`, feature 092) runs BEFORE the feature-143 reject check; a bare `MagicMock()` context fails the admin gate first with `PERMISSION_DENIED`, masking the `INVALID_ARGUMENT` under test (fix: `_ctx("4")`) (D-4).
- Proto enum `[deprecated = true]` triggers Go staticcheck **SA1019** at every remaining in-repo consumer (D-1): marking the values deprecated was buf-non-breaking (Step 1 buf lint/breaking both passed), but SA1019 (enabled in every service's `.golangci.yml`) then flags EVERY surviving Go reference as a lint error — an unanticipated cross-cutting linter consequence. The fix forced `//nolint:staticcheck // SA1019` at six legitimate sites AND expanded Steps 3/4's file scope beyond their declared **Files** lists (`internal/timeframe/timeframe.go`, `timeframe_test.go`, `internal/alpaca/client_test.go`). Generalizable: any future proto-enum-value deprecation in a Go-consuming repo must budget for a platform-wide SA1019 sweep + file-scope expansion in the same PR.
- Installed `grpcio` makes `grpc.aio.AioRpcError`'s `initial_metadata`/`trailing_metadata` required-positional (D-3, test-only): the spec verified an optional-arg signature; the installed version raises `TypeError` on the 2-arg form, forcing the 4-arg construction — a spec-verified-signature-vs-installed-lockfile divergence.

**Permanent deviations**:
- design §Chosen Approach pt4 named `plugins/strat-lab/skills/backtest/reference/backfill.md` as a same-PR edit target → shipped edited only `mcp-tools.md` → grep proved that plugin file never documents timeframe values; the strat-lab same-PR governance rule was vacuously satisfied.
- design §Chosen Approach pt5 described a single uniform narrowing of `/insights/backfills`' `TIMEFRAMES` const → shipped removed only the create-form select (hardcoded `TIMEFRAME_1DAY`) and left the const + delete-scope select's 3 entries untouched → the const feeds two forms with opposite requirements (create must narrow, delete-scope must stay permissive per design's own DeleteBackfilledData decision).

**Cross-feature signal**:
- Adding a permanent (`INVALID_ARGUMENT`) rejection to a downstream service can weaponize an upstream caller's over-broad retry loop: ingest's chunk-retry treated *any* exception as transient and retried 3× with backoff, so the new rejection would have caused a retry-storm — caught in design round 1, fixed by adding a non-retryable-gRPC-code branch and sequencing it no later than marketdata's step.
- Possible prompt-injection observed: two subagents independently encountered a `system-reminder`-styled block (one purporting to instruct "don't tell the user of a docs change") during a concurrent foreground `git merge`/renumber in the same working tree. Both declined and surfaced it; verified it changed no review verdict. Flagged for visibility only.

**Deferred follow-ons**: Eventual deletion of the inert historical `15m`/`1h` OHLCV rows is deferred, NOT decided — `GetDataCoverage`/`DeleteBackfilledData` were kept permissive specifically to enable a future cleanup feature if ever needed.

**Ledger entries written**: insights.md (2), fails.md (2) — see the 2026-08-26 entries. (The single-entry-alias-table trap and the proto-deprecation→SA1019 blast radius were already recorded at fails.md:1391 / fails.md:1439.)
**Runtime-invariant recommendations (→ /context-constitution)**: none — both invariants were already written to their modules during execute: MARKETDATA-2 (permissive `GetDataCoverage`/`Delete` vs rejecting `GetBars`/`BackfillBars`; inert historical rows) and ingest's `context-constitution.md` gotcha (`_STR_TO_ENUM`/`_BARS_PER_DAY` no longer aligned; `_STR_TO_ENUM` dual-purposed for the resumed-job read path).
**Scenario promotion (C-16)**: none — this feature has no `acceptance.feature` file.
**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 996210e4.
