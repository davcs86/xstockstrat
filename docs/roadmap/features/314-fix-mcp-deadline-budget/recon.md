# Recon: fix-mcp-deadline-budget

**Created**: 2026-11-11
**From**: product-spec.md
**Tree**: origin/main-dev@c4fd48b0 (detached; no `feature/fix-mcp-deadline-budget` branch on origin yet). The discovery digests were UNSTAMPED; every `path:line` below was re-grepped on this tree by the orchestrator.
**Affected services**: xstockstrat-agent, xstockstrat-config, xstockstrat-portfolio, xstockstrat-marketdata, xstockstrat-analysis

---

## Objective

Three agent and config budgets are not enforced end to end (PLAT-13). Recon finds three gaps:

- `extract_email_content` fetches URLs one after another with no whole-call cap, so three slow URLs run past the MCP client's 60 s timeout.
- The `list_opportunities` worst case is 10 s (auth) + 3 s (policy read) + 55 s (SetConfig ceiling) = 68 s, which exceeds 60 s.
- `SetConfig` bounds each cross-hop timeout key on its own, so two writes that each pass their bound can still invert the portfolio > marketdata and analysis-enrich > marketdata-price ordering.

The fix bounds each tool call inside the MCP budget and makes SetConfig refuse writes that invert the ordering. It needs no proto change.

## Codebase Map

- **`xstockstrat-agent`** (Python)
  - `extract_email_content`, `services/xstockstrat-agent/app/tools.py:575`:
    - refuses credentialed sources at `:597-598`;
    - fetches serially in `for url in urls:` at `:609`, with `await _fetch_url(url, password=None)` at `:610`;
    - returns `{"raw_text": "\n\n".join(texts)}` at `:613`.
    - Nothing catches a per-URL failure, so one exception discards the texts already gathered.
  - `extract_website_content`, `tools.py:616`: fetches one URL and returns `{"raw_text": text}` at `:645`.
  - `_fetch_url`, `tools.py:2685`:
    - reads `extract.connect_timeout_seconds` (10.0) at `:2698` and `extract.read_timeout_seconds` (30.0) at `:2699`;
    - builds the client with `egress.build_pinned_client(` at `:2707`;
    - follows a redirect loop driven by `extract.max_redirects`.
    - All of these bounds are per request. httpx's read timeout is per chunk, so bytes that trickle in never trip it.
  - `_agent_policy`, `tools.py:2668`: a snapshot read of `read_config_value("agent", key)` with a default fallback. `_POLICY_READ_TIMEOUT_S = 3.0` is at `tools.py:2665`, and tests monkeypatch it.
  - `list_opportunities`, `tools.py:1722`:
    - `asyncio.wait_for(_agent_policy("opportunities.read_timeout_seconds", 40.0, float), _POLICY_READ_TIMEOUT_S)` at `:1759-1762`;
    - falls back to 40.0 on TimeoutError at `:1763-1765`, and on a non-finite or non-positive value at `:1766`;
    - calls `client.list_opportunities(..., timeout=timeout_s)` at `:1768-1770`;
    - raises `ToolError(_grpc_error_message(e, deadline_s=timeout_s))` at `:1773`.
  - Auth hop: `services/xstockstrat-agent/app/auth.py:46` and `:81` call `ValidateToken` with `timeout=client._RPC_TIMEOUT_S`. `_RPC_TIMEOUT_S = 10.0` is at `services/xstockstrat-agent/app/client.py:44`, and `_LONG_RPC_TIMEOUT_S = 45.0` at `client.py:45`. A second `ValidateToken` call site is at `client.py:1582-1583`.
  - Sandbox deadline (R7 residual), `formula_deadline_s` at `client.py:1121`:
    - computes `(timeout_ms + startup_grace_ms + _FORMULA_DEADLINE_MARGIN_MS) / 1000`, with `_FORMULA_DEADLINE_MARGIN_MS = 2000` at `client.py:47`;
    - clamps the result to `_LONG_RPC_TIMEOUT_S` with a WARN.
  - Migrations: none owned by the agent. Agent keys are seeded by config migrations; `041_heal_config_keys_to_reader_catalog.up.sql:40,43,46` seeds `extract.connect_timeout_seconds` = 10, `extract.read_timeout_seconds` = 30 and `opportunities.read_timeout_seconds` = 40 as relative keys.
- **`xstockstrat-config`** (Node.js)
  - The bounds registry `SCALAR_BOUNDS_REGISTRY` is at `services/xstockstrat-config/src/grpc/configServiceImpl.ts:114`. It is keyed `${namespace}.${relativeKey}` and enforced on writes only. Relevant rows:
    - `:143` `analysis.opportunity.read_db_budget_ms` [1000, 20000]
    - `:144` `analysis.opportunity.live_enrich_timeout_ms` [500, 4000]
    - `:149` `marketdata.price.batch_timeout_ms` [500, 2500]
    - `:150` `agent.opportunities.read_timeout_seconds` [30, 55]
    - `:153` `portfolio.marketdata.quote_timeout_ms` [500, 8000]
    - `:155` `marketdata.quotes.batch_timeout_ms` [500, 5000]
    - `:159` `marketdata.quotes.mark_timeout_ms` [100, 2500]
    - `:171` `portfolio.marketdata.servability_timeout_ms` [500, 4000]
    - `:176` `indicators.sandbox.timeout_ms` [100, 33000]
    - `:177` `indicators.sandbox.startup_grace_ms` [1000, 10000]
  - The ordering invariants appear only as prose comments, at `:141-142` (analysis worst case 27.05 s, below the agent floor of 30) and `:151-152` (the portfolio quote deadline must exceed max(batch, mark) plus the warm read).
  - `lookupScalarBounds` is at `configServiceImpl.ts:181-182`.
  - `setConfig` is at `configServiceImpl.ts:666`. Its per-key bounds gate is at `:750-760` and returns `code: 3` (INVALID_ARGUMENT) with `must be a number in [min, max]`. The gate runs before the existence gate, whose `this.pool.query` reads `config.config_values` by (namespace, key, environment, user_id) at `:767-771`.
  - The second registry consumer is ListKeys, at `configServiceImpl.ts:871`, which surfaces `validation` min/max to config-ui. Digest 1 called this site a batch write path. Re-reading it shows ListKeys, and there is no second write gate.
  - Last migration: `047_config_alias_removal_rows.up.sql` (`services/xstockstrat-config/migrations/`).
  - Seeds of the cross-hop keys appear in `041_heal_config_keys_to_reader_catalog.up.sql`:
    - `:78` analysis `live_enrich_timeout_ms` = 3000
    - `:178` `price.batch_timeout_ms` = 2500
    - `:179` `quotes.batch_timeout_ms` = 2500
    - `:200` portfolio `marketdata.quote_timeout_ms` = 4000
- **`xstockstrat-portfolio`** (Go): reader only.
  - `quoteTimeout()` at `services/xstockstrat-portfolio/internal/service/portfolio_service.go:531` reads `marketdata.quote_timeout_ms` with default 4000, and falls back to that default for values ≤ 0 (`:536`).
  - Last migration: `018_watchlist_signal_expiry.up.sql`. No change is expected.
- **`xstockstrat-marketdata`** (Go): reader only.
  - `resolveBatchPriceBudget` reads `price.batch_timeout_ms` (default 2500) at `services/xstockstrat-marketdata/internal/service/marketdata_service.go:1069-1071`.
  - `resolveQuoteBatchBudget` reads `quotes.batch_timeout_ms` (default 2500) at `:1079-1081`.
  - `quotes.mark_timeout_ms` (default 500) is read at `:1084-1086`.
  - `resolvePositiveInt` is at `:1058`.
  - Last migration: `009_symbol_classification.up.sql`. No change is expected.
- **`xstockstrat-analysis`** (Python): reader only.
  - `opportunity.live_enrich_timeout_ms` (default 3000) is read at `services/xstockstrat-analysis/app/handlers/servicer.py:4822`, inside `_enrich_opportunities_live` (`:4802`).
  - Its own worst case of 20 s (read-DB budget maximum) + 2 s backstop grace (`app/repositories/read_budget.py:12`) + 1 s release + 4 s (enrich maximum) ≈ 27 s sits below the agent floor of 30.

## Patterns to REUSE

- **Extract whole-call cap.** Wrap the URL loop at `tools.py:609` in a monotonic deadline or `asyncio.timeout`. The `asyncio.wait_for` style is already used at `tools.py:1759`. Read the budget through `_agent_policy("extract.<key>", default, cast)` (`tools.py:2668`), as `_fetch_url` already does at `:2698-2699`. Feature 207's AC-8 requires the budget to come from config.
- **A new `agent.extract.*` budget key**, if the design picks one, needs:
  - a relative-key seed migration `048_*`, following the agent rows in `041_heal_config_keys_to_reader_catalog.up.sql:40-46` and the shape in `043_analysis_live_loop_keys.up.sql`;
  - a `SCALAR_BOUNDS_REGISTRY` row;
  - a row in the agent `CLAUDE.md` "Config Keys Consumed" table;
  - an entry in the `docs/patterns/config-governance.md` per-feature key log.
- **`list_opportunities` ceiling.** Change the registry number at `configServiceImpl.ts:150` and keep the floor at 30. Do not change `_RPC_TIMEOUT_S` (`client.py:44`); feature 273's AC-11 pins the 10.5 s auth bound.
- **Cross-key rejection.** Use the same `callback({ code: 3, message })` shape as `configServiceImpl.ts:754-757`, placed directly after the per-key gate at `:760`. Read the sibling's stored value with the existing `this.pool.query` shape at `:767-771`, in the same environment and user scope.
- **Alternative: non-overlapping bounds.** This edits only the registry numbers and the `setConfigScalarBounds.test.ts:272-279` table, with no handler change.
- **Tests, agent.** Use `services/xstockstrat-agent/tests/test_list_opportunities_deadline.py`:
  - the real hung gRPC server `_start_hung_analysis_server` (`:27`);
  - the AC-2 template `test_ac2_hung_analysis_read_fails_fast_with_deadline_error` (`:45`);
  - monkeypatching `_POLICY_READ_TIMEOUT_S`.
  - `test_tool_deadlines.py`, `test_auth_deadline.py` and `test_formula_deadline.py` are the neighbouring deadline tests.
- **Tests, config.** `services/xstockstrat-config/src/__tests__/setConfigScalarBounds.test.ts` provides:
  - the `setConfig` helper (`:72`);
  - the bounds table (`:272-279`, including agent `opportunities.read_timeout_seconds` 30/55 at `:276`);
  - the agent boundary cases (`:369-374`);
  - the reject-and-write-nothing tests (`:94`, `:333`, `:351`).
  - Seed-migration tests to copy: `servabilitySeedMigrations.test.ts` and `barIngestBackoffSeedMigration.test.ts`.
- **Tests, readers** (only if the design touches them):
  - portfolio: `portfolio_quote_deadline_test.go` (`fakeConfig`, `:112`, `:251-253`);
  - marketdata: `marketdata_service_test.go:2094`, `:3681`, `:3714` (`fakeIntGetter`);
  - analysis: `tests/test_list_opportunities_deadlines.py:35`.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-6 @feature-273` "A tool whose backends all stall still answers before the MCP client gives up" (`services/xstockstrat-agent/acceptance/fix-agent-client-deadlines.feature`). Its 57 s / ≥3 s-headroom bar is the target for extract and list_opportunities.
- **PRESERVE** `@AC-8 @feature-273` "A tool with several sequential backend calls stays under the MCP request timeout when its follow-up calls stall" (same file). This is the model for a sequential whole-call budget.
- **PRESERVE** `@AC-9 @feature-273` "A long-running RPC that never responds is bounded by its own budget" (same file). The 45 s long-RPC budget stays.
- **PRESERVE** `@AC-10 @feature-273` "No agent backend stub call is issued without a deadline" (same file).
- **PRESERVE** `@AC-5 @feature-273` "Every agent backend RPC is bounded by its budget" (same file). Do not move the 10 s or 45 s constants.
- **PRESERVE** `@AC-11 @feature-273` "A stalled identity yields a bounded fail-closed 503 that keeps the session" (same file). The 10 s auth leg stays, so the fix lowers the ceiling instead of shrinking auth.
- **EXTEND** `@AC-2 @feature-227` "A hung analysis read fails fast at the agent instead of hanging" (`services/xstockstrat-agent/acceptance/fix-opportunities-read-hangs.feature`). This feature's AC-2 adds the full-stack worst case: auth, then the policy read, then the ceiling.
- **PRESERVE** `@AC-1 @feature-247` "get_config_value is bounded by its default deadline" (`services/xstockstrat-agent/acceptance/fix-agent-getconfig-deadline.feature`). This is the 3 s policy-read bound.
- **PRESERVE** `@AC-2 @feature-247` "extract_website_content proceeds with its default fetch policy" (same file). A single-URL default success must still return `raw_text`.
- **PRESERVE** `@AC-6 @feature-207` "A legitimate public URL is still fetched and extracted" (`services/xstockstrat-agent/acceptance/extract-tool-ssrf-hardening.feature`).
- **PRESERVE** `@AC-8 @feature-207` "The egress policy is sourced from config, not hardcoded literals" (same file). Any extract budget must come from config, not a literal.
- **PRESERVE** `@AC-7 @feature-207` "A blocked fetch does not leak internal targets and is recorded" (same file). The "URLs not fetched" error may name only the URLs the caller supplied, never resolved IPs or internal hosts.
- **PRESERVE** `@AC-31 @feature-295` "The derived deadline never exceeds the long-RPC budget" (`services/xstockstrat-config/acceptance/fix-config-keys-drift.feature`). This pins `indicators.sandbox.timeout_ms` [100, 33000] and the 45 s derived cap; lowering that bound would be a CHANGE.
- **PRESERVE** `@AC-25 @feature-295` "Internal-caller grants and write bounds match on the canonical key" (same file). Any cross-key rule must key on relative names.
- **PRESERVE** `@AC-4 @feature-184` "An out-of-bounds tuning write is rejected at the write edge" (`services/xstockstrat-config/acceptance/opportunity-config-operability.feature`). A rejection returns INVALID_ARGUMENT and writes nothing; AC-3 reuses this.
- **PRESERVE** `@AC-5 @feature-184` "An in-bounds tuning write is accepted without create_key" (same file). Independent writes that are valid today must stay valid unless they invert an ordering.
- **PRESERVE** the `readiness-materializer-config-keys.feature` scenarios "An out-of-bounds tuning write is rejected at the write edge" and "The bounds are write-path only and change no read path" (`services/xstockstrat-config/acceptance/readiness-materializer-config-keys.feature`). Their AC tag lines were not read; re-read them before quoting.
- **PRESERVE** `@AC-2 @feature-304` "A rewritten reader returns the stored value with the alias off" (`docs/sdd/business-rules/platform.feature`). An `indicators` `sandbox.timeout_ms` of 15000 must stay valid.
- **PRESERVE** `@AC-1 @feature-229 @feature-240` "Portfolio reads return unenriched positions when the quote fetch exceeds its deadline and no daily close exists" (`services/xstockstrat-portfolio/acceptance/fix-book-portfolio-page.feature`). A quote deadline of 2500 must stay a valid value.
- **PRESERVE** `@AC-8 @feature-229` "A cold-fetch failure returns the warm subset instead of failing the batch" (`services/xstockstrat-marketdata/acceptance/fix-book-portfolio-page.feature`). A `quotes.batch_timeout_ms` of 500 must stay valid.
- **PRESERVE** `@AC-1 @feature-227` "A stalled price enrichment returns the stored rows unenriched within the deadline" (`services/xstockstrat-analysis/acceptance/fix-opportunities-read-hangs.feature`). This is the analysis worst case behind the floor of 30.
- No CHANGE is proposed. No suite pins the `agent.opportunities.read_timeout_seconds` [30, 55] or `marketdata.price.batch_timeout_ms` [500, 2500] bounds, so tightening them is not a C-16 regression.

## Dependencies

- **Proto/RPC:** none. The work changes SetConfig validation and agent-side budgets only.
- **Migration:** the next config number is `048` (in `services/xstockstrat-config/migrations/`). It is needed only to seed a new `agent.extract.*` budget key (C-05: every read key is seeded) or to heal a seeded value that falls outside a tightened bound.
  - The current seeds all fit the candidate tightened bounds: 40 against a ceiling of 45; 4000 > 2500 for quote over batch; 3000 > 2500 for enrich over price.
  - No portfolio (`019`), marketdata (`010`) or analysis migration is anticipated.
- **Config keys:**
  - existing, with bounds changing: `agent.opportunities.read_timeout_seconds`, `portfolio.marketdata.quote_timeout_ms`, `marketdata.quotes.batch_timeout_ms`, `marketdata.quotes.mark_timeout_ms`, `marketdata.price.batch_timeout_ms`, `analysis.opportunity.live_enrich_timeout_ms`;
  - possibly new: `agent.extract.<whole-call budget>` (namespace `agent`, relative key `extract.<key>`).
- **Inter-service edges:** no new edges. The governed ordering runs portfolio → marketdata `GetLatestQuotes` and analysis → marketdata `BatchGetLatestPrice`. The agent → identity `ValidateToken` and agent → analysis `ListOpportunities` edges stay unchanged.
- **New env vars / ports:** none.

## Risks / Not-found

- **R7 residual does not reproduce.** The worst case is 33 + 10 + 2 = 45 s, clamped at `_LONG_RPC_TIMEOUT_S`. Adding auth's 10 s gives 55 s, still under 60 s. Feature 295 already closed this (AC-31), so recommend no further work on R7 and say so in design.md.
- **The 3 s policy cap is effectively unreachable.** `_agent_policy` reads a snapshot, but the AC-2 arithmetic must still budget for it: 10 + 3 + ceiling < 60. A ceiling of 45 gives 58 s, which leaves only 2 s of headroom against feature 273's "≥3 s under 60" bar (AC-6). A ceiling of 44 meets that bar. This is an open choice for the design.
- **Cross-key rule semantics are unspecified.** The design must settle:
  - which key's write is checked (both directions);
  - environment and user scope (global vs per-user overrides, since a per-user value overrides the global one);
  - what happens when the sibling row is absent: fall back to its code default, or skip the check;
  - the warm-read margin term in "quote > max(batch, mark) + warm read";
  - concurrency (two racing writes each pass against the other's old value).
- **ListKeys** (`configServiceImpl.ts:871`) surfaces only per-key min/max to config-ui. A cross-key rule is invisible there; decide whether that is acceptable.
- **Non-overlapping bounds conflict with existing fixtures.** Keeping portfolio quote 2500 (feature 229 AC-1) and marketdata batch 500 (feature 229 AC-8) both valid forces portfolio min ≥ batch max + margin. With batch max ≤ 2500 that means portfolio min > 2500, which would make the 2500 fixture invalid. Pure non-overlapping bounds therefore likely break a PRESERVE scenario, which favours a cross-key check. Verify this in design.
- **Partial results change the extract response shape.** Adding an error field to the `extract_email_content` response must leave the all-succeed `{"raw_text": ...}` path byte-identical (feature 207 AC-6, feature 247 AC-2). Otherwise it is a CHANGE. Update `docs/runbooks/mcp-tools.md` if the shape grows.
- **No extract timeout test exists**, and no trickling-bytes server fixture was found under `services/xstockstrat-agent/tests/`. AC-1 needs a new harness.
- **Overlap.** The SetConfig path in `configServiceImpl.ts` is shared with feature 319, and the agent `tools.py` with 319, 322, 328 and 331 (sdd-review). Coordinate the registry and tool edits with them, and fix the migration number at merge as max(`origin/main-dev`) + 1 (insights 2026-11-05, fix-analysis-live-loop-budget-seed).
- **Applicable `fails.md` traps:**
  - 2026-11-10 fix-analysis-live-loop-budget-seed (migration): another in-flight feature may seed the same rows. Dedup by key, not by migration number.
  - 2026-11-04 fix-agent-client-deadlines (assumption): ground the design on the `origin/feature/<slug>` revision once that branch exists.
  - 2026-11-04 fix-agent-getconfig-deadline (duplication): dedup-grep `docs/reports/*` before materializing any follow-up report.
- **Applicable `insights.md` items:**
  - 2026-11-10: a bound comment names the invariant it protects, and every proposed maximum is checked against the value observed today.
  - 2026-11-04: a timeout on a write path says "outcome unknown". Not applicable here, since all affected paths are reads.
- **Not found:**
  - any existing whole-call, URL-count or total-time cap on `extract_*`;
  - any cross-key validation in SetConfig;
  - any `agent.extract.*` row in `SCALAR_BOUNDS_REGISTRY` (`grep "'agent\.extract"` returns no hits).
- **Doc-drift to fix with the code change:**
  - `docs/context-constitution-findings.md:44`, `services/xstockstrat-config/docs/context-constitution-findings.md:24` and `services/xstockstrat-portfolio/docs/context-constitution-findings.md:26` hold the cross-hop finding.
  - The agent `CLAUDE.md` row for `opportunities.read_timeout_seconds` says `[30,55]`.
  - The portfolio `CLAUDE.md` "Must exceed max(batch_timeout_ms (2500) …" text is stale against the batch ceiling of 5000.

## Recommended Scope

Advisory; the design debate decides.

1. **Config, cross-key ordering (AC-3).** Add a small ordered-pair rule table next to `SCALAR_BOUNDS_REGISTRY` and enforce it after the per-key gate in `setConfig`, rejecting in both write directions with INVALID_ARGUMENT and nothing written. Cover two pairs: portfolio `marketdata.quote_timeout_ms` > max(marketdata `quotes.batch_timeout_ms`, `quotes.mark_timeout_ms`), and analysis `opportunity.live_enrich_timeout_ms` > marketdata `price.batch_timeout_ms`. Add tests in `setConfigScalarBounds.test.ts`.
2. **Config, agent ceiling (AC-2).** Lower `agent.opportunities.read_timeout_seconds` to a maximum of 44 or 45 (floor 30). Update the bounds table and tests, the registry comment (naming the 60 s MCP invariant), and the agent `CLAUDE.md` row.
3. **Agent, extract whole-call budget (AC-1).** Bound `extract_email_content` (and `extract_website_content`) by a config-sourced whole-call deadline below 60 s minus the auth leg. Return the gathered `raw_text` plus an error naming the unfetched caller-supplied URLs. Leave the all-succeed shape unchanged. Seed the budget key with migration `048` and give it a bound in the registry.
4. **Agent, AC-2 test.** Extend `test_list_opportunities_deadline.py` with auth delay + policy cap + ceiling < 60 s.
5. **Docs.** Resolve the three findings entries. Update `config-governance.md`, `mcp-tools.md` (extract response) and the stale portfolio/marketdata `CLAUDE.md` bound text.
6. **R7.** No code change. Record "closed by feature 295 (AC-31)" in design.md.
