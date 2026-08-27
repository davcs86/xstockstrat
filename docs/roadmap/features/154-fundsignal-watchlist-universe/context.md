# Context: fundsignal-watchlist-universe  (archived 2026-08-26)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-26 — /sdd-archiver

**What**: Shipped feature 062's deferred FR-3 — the fundamentals producer's `universe_source=watchlists`/`both` now resolves the real cross-user union of watchlist symbols via a new privileged portfolio RPC (`ListAllWatchlistSymbols`), instead of silently falling back to the empty `explicit_symbols` CSV that had rendered the producer inert in staging. Two coordinated changes on the pre-existing analysis→portfolio edge (feature 062); no proto breaking change, no migration, no new config key, no new channel/env var.

**Why (irrecoverable rationale)**:
- **Authz = `x-internal-caller` `{callerID,rpc}` allow-list, never the admin `x-access-scope` bit.** A cross-user enumeration is a *service self-assertion* with no authenticated human to forward from; the admin bit has no caller-identity component, so any code path in the caller's binary could forge it. This is the same trust-primitive distinction already established in broker-state-reconciliation (insights.md:1193) and PR #994; feature 154 is a second application, not a new discovery.
- **FMP-gated truncation (operator R4 directive):** the `max_symbols` cap fires *only* when `marketdata.fundamentals.provider == "fmp"` (a real daily-call budget); non-FMP takes the whole union. It was deliberately *not* implemented as `budget = len(union)`, because that would delete the paced-budget/WARN/deferred-resume machinery and let Finnhub's rate limiter silently drop the tail under a false `completed`. An unknown/absent provider → the conservative capped path with **no provider literal baked in** (drift-guard, fails 2026-08-13).
- **Reading the producer's frozen provider selection cross-namespace:** consumed via a *second* boot-frozen `ConfigWatcher(namespace="marketdata")` mirroring marketdata's own boot-freeze — rather than a live read (re-creates producer/consumer divergence) or a mirror key in analysis's namespace (state duplication + C-05). WatchConfig is strictly per-namespace, so a second subscription is the only no-duplication path (already at insights.md:2088).

**Rejected alternatives**:
- Admin `x-access-scope` bit gate — lost: reproduces the feature-092-removed self-asserted-admin pattern; contradicts PR #994.
- Mirror `analysis.fundsignal.*` FMP-active config key — lost: duplicates marketdata's provider state → drift + C-05 sign-off.
- New marketdata provider/active RPC — lost: a whole proto+RPC for a boolean read.
- `budget = len(to_process)` for non-FMP — lost: deletes deferral/WARN/resume; hides Finnhub tail-drops.
- Bare-callerID grant / server-side `limit` param / symbol index — lost: over-broad grant / overbuild; the union is naturally bounded and the DISTINCT seq-scan is sub-ms.
- Reading `x-internal-caller` via portfolio's already-parsed `PropagationData{UserID,AccessScope,TraceID}` struct — lost: the client interceptor re-forwards those propagation keys **outbound** (`propagation.go:39-49`), so an inbound-only authz assertion routed through that struct would *leak* the internal-caller header on every outbound portfolio call; it must be read directly from ctx metadata (`FromIncomingContext`) instead.

**Scars & gotchas**:
- **Host-toolchain codegen doc-comment drift**: the Docker daemon was unavailable, so codegen ran on a host-provisioned buf 1.47.2. That newer-than-CI buf re-emitted a fresh doc-comment on the well-known `google/protobuf/timestamp.ts` (+ its `.d.ts`), unrelated to this feature; CI's pinned buf emits the committed text. Had to `git checkout`-revert those files to keep the `packages/proto/gen/` diff scoped to `portfolio/*`.
- **Gate must read `metadata.FromIncomingContext(ctx)`, not `connect.Request.Header()`** — the grpc adapter's `connect.NewRequest(req)` fabricates *empty* headers, so a header-based read silently fails closed on the real inbound path.
- **Metadata append-don't-replace** (`list(metadata) + [(hdr,caller)]`) — the single resolver impl serves both the loop path (`metadata=()`, internal-caller only) and the manual `RunFundamentalsScan` path (must preserve the caller's `x-trace-id`/`x-user-id`, C-03).

**Permanent deviations**: The FMP-gated cap now governs the manual `RunFundamentalsScan` `override_symbols` path too — a deliberate change from the prior *unconditional* `[:max_symbols]` override cut. Rationale: the cap is a pure FMP-budget guard, not a universe-source policy, so a non-FMP override is scored whole. No design.md-vs-shipped contradiction.

**Cross-feature signal**: This is the **second** feature (after 102-broker-state-reconciliation) to reach for an `x-internal-caller` `{callerID,resource/rpc}` allow-list over the admin bitmap for a background-service self-assertion — the pattern is now recurring and is already flagged in insights.md:1195 as a candidate for a Constitution pass on internal-caller authz.

**Deferred follow-ons**: none explicit (this feature itself *closed* feature 062's deferred FR-3).

**Ledger entries written**: insights.md (1), fails.md (0) — see the 2026-08-26 entry. (The internal-caller-allow-list and boot-frozen cross-namespace ConfigWatcher lessons were already at insights.md:1193 / insights.md:2088; the feature-numbering-scan and harness-branch fails were already at fails.md:211 / fails.md:256.)
**Runtime-invariant recommendations (→ /context-constitution)**: none new — both invariants already landed during execute (Step 7): PORTFOLIO-8 in `services/xstockstrat-portfolio/docs/context-constitution.md` (first cross-user per-user-data enumeration, `x-internal-caller`-gated, not the admin bit) and the analysis→marketdata first cross-namespace `WatchConfig` subscription note in `docs/patterns/config-governance.md`.
**Scenario promotion (C-16)**: 2 `@AC-*` (AC-1/2) → `services/xstockstrat-portfolio/acceptance/fundsignal-watchlist-universe.feature`; 7 (AC-3..AC-9) → `services/xstockstrat-analysis/acceptance/fundsignal-watchlist-universe.feature` (both new suites).
**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 996210e4.
