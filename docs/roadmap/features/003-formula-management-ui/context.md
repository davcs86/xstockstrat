# Context: formula-management-ui  (archived 2026-08-05)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-05 — /sdd-archiver

**What**: Formulas moved from an in-memory dict in `xstockstrat-indicators` to a `TimescaleDB` table, with three new CRUD RPCs and a Monaco-editor-based `/formulas` UI shipped inside the consolidated `xstockstrat-ui` (not the originally-targeted `xstockstrat-insights`, which was absorbed by feature 045 mid-flight).
**Why (irrecoverable rationale)**: Execution was deliberately held until three concurrent platform-migration features (044 client-api-pattern, 045 ui-consolidation, 046) all merged, rather than landing Steps 1–5 (proto/DB) early — merging the DB/proto layer alone would leave a short-lived PR with no UI surface and higher rebase cost later (context.md 2026-06-01 "re-spec plan confirmed").
**Rejected alternatives**:
- CodeMirror for the formula editor — lost to Monaco because Monaco supports a custom `CompletionItemProvider` for numpy/pandas/indicators API suggestions, judged worth the ~2MB gzip cost for a developer-facing tool (product-spec.md:132, being deleted).
- Executing 003 before 045 (original Stream-2 order 044→046→003→045) — reordered to run after 045 once it became clear 003's UI steps would otherwise target a directory (`xstockstrat-insights`) about to be deleted (context.md 2026-06-01 "stream-2 reorder").
**Scars & gotchas**:
- Docker Hub 429 rate-limited the proto-gen container mid-execution; the CI `proto-freshness` toolchain (buf 1.69.0 + pinned protoc-gen plugins) was installed directly on the host as a workaround (context.md Step 2, 2026-06-04).
- No local `migrate` binary/TimescaleDB — up/down migrations were verified by spinning a throwaway `postgres:16-alpine` container (context.md Step 3).
- `mock-backend.ts` does not stub `IndicatorsService` — the e2e test used a page-level `page.route()` stub instead (context.md Step 12, 2026-06-04).
- The impl-spec's own `RegisterFormula` snippet set `author` on the DB `create()` call but omitted setting it on the in-memory cached `FormulaDefinition` — undetected until execution, which caught that a `GetFormula` served from cache immediately post-registration would return an empty author while a DB-fallback read returned the real one, a cache/DB inconsistency bug (implementation-spec.md Deviation Log, Step 5, lines 1042–1047). The fix is visible in shipped `servicer.py`, but the reasoning is not — a future refactor could silently drop the "redundant-looking" assignment and reintroduce the bug.
**Permanent deviations**:
- product-spec said UI targets `xstockstrat-insights` -> shipped targeting `xstockstrat-ui` -> because feature 045 consolidated insights into xstockstrat-ui before 003 executed (context.md 2026-06-02).
- product-spec said BFF calls over HTTP/Connect-RPC (FR-13) -> shipped gRPC-only via `@connectrpc/connect-node` on `INDICATORS_ENDPOINT` -> because the platform-wide gRPC-only migration removed the indicators HTTP port during this feature's lifetime (context.md 2026-06-01).
- product-spec (OQ-1, FR-13) said identity flows via an `X-User-Id` HTTP header with hardcoded `'dev-user'` fallback -> shipped BFF never reads that header, instead calls `requireSession(ctx)` and overwrites caller-supplied `author`/`userId` with JWT `claims.user_id` (implementation-spec.md Step 7, lines 559-599) -> because 044-client-api-pattern established JWT-claims-based identity as the platform pattern before 003's BFF steps executed, superseding the header design written earlier.
**Cross-feature signal**: delaying UI-touching steps until a consolidating prerequisite lands avoided a second re-spec cycle; the one exception (Step 12's e2e path) still needed targeted rework post-merge.
**Deferred follow-ons**: none remaining — JWT identity enforcement (originally deferred) was superseded by shipped JWT-claims behavior above.
**Ledger entries written**: insights.md (2), fails.md (1) — see the 2026-08-05 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none
**Pruned artifacts**: product-spec.md, implementation-spec.md — last present at 33ff5dc.
