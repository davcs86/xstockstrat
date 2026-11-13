# Context Scrub — Findings

Low-signal context surfaced by `/context-scrubber` (mode `apply`) on 2026-11-13 from branch
`ccr-7e428591-3j2he0` at commit `52f6d5a` (= `origin/main-dev`) — the repo state this audit reflects. It
**replaces** the 2026-11-04 report (commit `2f34666`, ~1,170 changed lines stale): every seed row was re-verified
against `52f6d5a` (HOLDS / CHANGED / GONE) and every audited file was re-classified fresh. Each row is a line in an
**auto-loaded** context file (CLAUDE.md, context-constitution*.md) or an opted-in doc (`README.md`,
`docs/patterns/ui-ux-governance.md`) that an agent would find for free, that no longer resolves, that is duplicated,
or that the code now contradicts. Every row cites both the context line and the evidence it fails.

**How the rows were produced.** Seven read-only `context-auditor` passes (root+docs, Go services, Python services,
agent, Node services, UI, packages+skills) classified the 56-file audit set. The orchestrator re-opened the
evidence for every contradicted-by-code row it routes (agent `_metadata`, trading `StreamOrderUpdates`, marketdata
`fundamentals.provider`, UI `vitest.config.ts`, analysis `resolve_universe`, root PLAT-14 `bash …py`,
`approval-flow.md` headings, UI `middleware.ts` runtime) and found each to hold. Rows not individually re-opened by
the orchestrator rest on the auditor's cited evidence, named in the row. Auditor `chars` figures are **estimates**
(the auditors had no `wc`); the measured figures are the file sizes below and the post-apply diff in the PR.

> Rows touching an authz/authn/secret/tenant boundary carry a **⚠**. `Apply` = the Phase-2 disposition
> (owner gate 2026-11-13: H+M confidence, JIT moves create their destination verbatim, webhooks-mcp restatement →
> pointer). `defer` rows stay as report rows with the reason given.

## Orchestrator rulings (applied across all rows)

1. **CI-pinned literals are untouchable**: agent `CLAUDE.md` "registers forty-five tools"
   (`services/xstockstrat-agent/tests/test_tools_endpoint.py#test_every_tool_count_surface_states_the_catalog_size`);
   root `CLAUDE.md` "`**Direct backend total** | | | **8**`" (`…/tests/test_deployment_env_vars.py`); config
   `CONFIG-9` row keeps the three rule sentences (`scripts/check-config-wiring.mjs#DOC_RULE_SENTENCES`). The
   auditor's "trim CONFIG-9 to the PLAT-14 one-liner" is therefore **deferred**.
2. **"Docker Build Pattern" sections stay** — mandated by root `CLAUDE.md` § Dockerfile Update Workflow (prior-run
   ruling, re-confirmed).
3. **Resolved / struck rows and "Filed as defect reports" tables in findings logs stay** — they are
   `/context-constitution`'s triage ledger (prior-run ruling). Only rows that now state something *false* are
   corrected.
4. **Two-way CLAUDE ↔ constitution duplicates**: the constitution is the keeper for invariants; the CLAUDE side is
   trimmed to a pointer. The constitution counterpart rows are deferred.
5. **Contradicted-by-code lines are never trimmed** (CF-N9), even when the same line is also a duplication row.
6. **Sentinel blocks are skipped** (CF-N11) — see the last section.

## Summary

Row counts are the orchestrator's tally of the seven auditor digests (≈, rows grouped in the tables below); the
measured effect is the per-file `git diff` in the PR.

| Category | Rows (≈) | Apply (H/M) (≈) | Defer (≈) | Note |
|---|---|---|---|---|
| Stale citations | 8 | 8 | 0 | re-grounds, not deletions |
| Restated (agent reads for free) | 79 | 68 | 11 | L rows deferred |
| Cross-file duplication | 147 | 121 | 26 | ruling 1/4 deferrals + L |
| Contradicted by code (routed, never trimmed) | 51 | 0 | 51 | ⚠ 5 — logged in the module findings files |
| Should be just-in-time | 37 | 31 | 6 | destinations created verbatim |
| Brittle / over-specified | 14 | 7 | 7 | L rows deferred |
| Bloat / low-value prose | 71 | 44 | 27 | ruling 3 + L rows deferred |
| Keep-but-verify | 27 | — | 27 | questions, never applied |

**Audit set (measured, `wc -lc`):** 56 files · 6,374 lines · 959,651 characters. No tokenizer ran; any token
figure is only `≈ chars ÷ 4` (≈ 239,913 for the whole set). The measured lines/characters actually removed are
reported per file in the PR description (from `git diff`), not estimated here.

## Stale citations

| Context line | Citation | Reality | Action | Conf · Apply |
|---|---|---|---|---|
| `services/xstockstrat-config/CLAUDE.md#Ports` — "config-ui reaches it over gRPC `50060` (`app/lib/connectClients.ts`)" | `app/lib/connectClients.ts` | resolves only at `services/xstockstrat-ui/src/lib/connectClients.ts` | re-ground to the UI path | H · apply |
| `services/xstockstrat-config/CLAUDE.md#Config Keys Managed` — "See `migrations/001_config_tables.up.sql` for the canonical seed list" | `001` as canonical seeds | seeds span `migrations/003…048`; reader↔seed baseline is `scripts/config-wiring.json` | re-ground | M · apply |
| `services/xstockstrat-ledger/docs/context-constitution.md#Gotchas` — "the CLAUDE.md wording "PostgreSQL rules" is wrong (findings)" | ledger CLAUDE wording | ledger `CLAUDE.md#Role` now says "triggers"; findings row RESOLVED | remove bullet | H · apply |
| `services/xstockstrat-agent/docs/context-constitution.md#Pointers` — "`CLAUDE.md` `agent.opportunities.read_timeout_seconds` row" | FQN row key | CLAUDE row is keyed `opportunities.read_timeout_seconds` (feature 296) | re-ground | H · apply |
| `services/xstockstrat-agent/docs/context-constitution.md#Pointers` — OAuth routes "\| `CLAUDE.md` §OAuth" | CLAUDE §OAuth | that section only points onward to `docs/oauth.md` | re-point to `docs/oauth.md` | M · apply |
| `services/xstockstrat-ui/docs/context-constitution.md#Pointers` — "CLAUDE.md § The Edge-runtime trap (HISTORICAL)" | UI CLAUDE § | resolves only in `docs/patterns/frontend-auth.md` | re-point | H · apply |
| `services/xstockstrat-analysis/docs/context-constitution.md#Gotchas` — "(see the SEV-1 scar below)" | SEV-1 scar row | the scar row was removed; nothing below | drop clause | H · apply |
| `docs/context-constitution-findings.md` — "(regenerate with `scripts/config-wiring-stored.sh`)" | `.sh` script | ported to `scripts/config-wiring-stored.py` | re-ground | H · apply |

Seed rows **GONE**: trading `_tasks/x-approval-flow.md` (no longer cited).

## Restated facts (agent reads for free) — fails CF-N4

| Context line | Free-to-read source | Action | Conf · Apply |
|---|---|---|---|
| root `CLAUDE.md#Language Versions` — "(That gate was added 2026-07-27; before then this sentence claimed…" | `.github/workflows/ci.yml` `uv lock --check` | drop the parenthetical history | H · apply |
| root `CLAUDE.md#Language Versions` Go/Python Notes cells ("use `GOWORK=off`…", "`uv lock` after any…") | same file's Go build note / uv lock rule | trim cells | M · apply |
| root `CLAUDE.md#Language Versions` buf row "— bump all three together" tail | `Dockerfile.codegen` `BUF_VERSION` comment | trim | M · apply |
| root `CLAUDE.md#Version Bump Workflow` proto-plugin paragraph | `Dockerfile.codegen` + `ci.yml` "pins duplicated" comments | trim to one sentence | M · apply |
| root `CLAUDE.md#Repository Bootstrap` | `README.md` Bootstrap; `docs/setup/getting-started.md` | trim to pointer | M · apply |
| root `CLAUDE.md#CI/CD Overview` coverage-threshold clause | `docs/patterns/ci-overview.md` | drop clause | M · apply |
| root `CLAUDE.md#Branch Strategy` "To enforce this… Settings → Branches…" | `scripts/setup-branch-protection.py` | remove | L · defer |
| root `CLAUDE.md#Project Overview` root-owns bullets | directory tree | trim | L · defer |
| root `CLAUDE.md#Key File Paths` self-describing rows | filenames | drop; keep never-Read/Grep + allocator rows | M · apply |
| root `CLAUDE.md#Feature Roadmap` "SDD skills: `/sdd-story` → …" | skill descriptions | trim | L · defer |
| `docs/roadmap/CLAUDE.md` per-phase deviation summaries | `phase[3-7]-deviations.md` | trim | M · apply |
| `docs/sdd/business-rules/CLAUDE.md` recon paragraph | `.claude/agents/scenario-recon.md` | trim | L · defer |
| `docs/CLAUDE.md` `reports/` row (Issues disabled / `.status`) | `.claude/skills/sdd-qa/reference/defect-filing.md` | trim | M · apply |
| agent `CLAUDE.md#Environment Variables` 9 `*_ENDPOINT` lines | `docker-compose.yml` agent block | drop the unannotated lines | H · apply |
| agent `CLAUDE.md#Running Tests` "**CI (feature 065):**…" | `ci.yml` python-lint/test matrix | remove | H · apply |
| agent `CLAUDE.md#Management-tool authorization` "The old hardcoded `_admin_metadata()`… **removed** by feature 092." | history | remove | H · apply |
| agent `CLAUDE.md#Config Keys Consumed` "(`SNAPSHOT_WAIT_TIMEOUT_S` = 90 s…)", "`_LONG_RPC_TIMEOUT_S` = 45 s" | `app/config/watch_core.py`, `app/client.py` | drop value clauses | M · apply |
| agent `CLAUDE.md` `opportunities.read_timeout_seconds` row narrative | `app/tools.py#_POLICY_READ_TIMEOUT_S`; config bounds | trim cell | M · apply |
| agent `CLAUDE.md#Observability` instrument inventory | `app/telemetry.py` | replace with pointer | M · apply |
| agent constitution AGENT-1 "72 `mtls.secure_channel` opens…" count | self-admits drift | drop clause | L · defer |
| trading/portfolio/marketdata `CLAUDE.md#Language` "Go 1.27" | `go.mod` | remove section | H · apply |
| trading/portfolio/marketdata Ports table + "former HTTP server removed" | root Service Registry | remove | H · apply |
| trading `CLAUDE.md#Running Locally` | root bootstrap | remove | M · apply |
| trading/portfolio/marketdata env blocks (plain `getEnv` lines) | `internal/config/config.go`; `docker-compose.yml` | trim; keep `BROKER_ACCOUNTS_ENCRYPTION_KEY` hint | M · apply |
| portfolio `CLAUDE.md` "All emissions go through `emitEvent`… GOAWAY… keepalive" | `portfolio_service.go#emitEventAs` comments | trim to one line | H · apply |
| marketdata constitution "Never set `Accept-Encoding` on SEC EDGAR requests." | `internal/edgar/edgar_client.go` comment | remove | M · apply |
| marketdata constitution "`4c91465` — int32-truncation fix" | `internal/repository/pool.go` | remove | M · apply |
| marketdata `CLAUDE.md` chunk-widening history | `docs/runbooks/ohlcv-lock-budget-tuning.md` | trim | H · apply |
| marketdata `CLAUDE.md` remediation_003 / symbol_classification detail | migrations 003/009 | trim | M · apply |
| trading `CLAUDE.md` order_brackets states / snapshot columns | trading migrations | trim | M · apply |
| portfolio `CLAUDE.md` per-migration column lists | portfolio migrations | trim | M · apply |
| marketdata `CLAUDE.md` ETF-filler constants | `internal/service/etf_flags.go` | trim | H · apply |
| ledger/identity/notify/config `CLAUDE.md#Running Locally` | `package.json` `dev`; root bootstrap | remove ×4 | H · apply |
| notify `CLAUDE.md` "**Tests run compile-first**…" | notify `package.json` `test` | remove | H · apply |
| notify / ledger / identity / config `CLAUDE.md#Ports` RPC lists + removed-HTTP history | `src/index.ts`; protos; root registry | trim | M · apply |
| ledger `CLAUDE.md#Database` "Hypertable… chunk = 1 day" | migration `001` | remove | H · apply |
| ledger `CLAUDE.md#Live Streaming` "`QueryEvents` pages by an opaque…" | `ledgerServiceImpl.ts#queryEvents`; LEDGER-9 | remove | M · apply |
| config `CLAUDE.md#WatchConfig Flow` audit-trigger lines | migrations 001/010 | remove | M · apply |
| identity `CLAUDE.md#Environment Variables` "Source: hardcoded in docker-compose…" | `docker-compose.yml`; `.env.example` | remove | M · apply |
| ledger/identity/notify/config `CLAUDE.md#Language` "Node.js 24 + TypeScript" | root tables | remove ×4 | L · defer |
| analysis `CLAUDE.md` `_BOOT_RECOMPUTE_MAX_PAIRS` = 50, `_INTENT_*` = 300/900 values | `app/handlers/servicer.py` | drop values | H · apply |
| analysis `CLAUDE.md#Shared durable scheduler` "`_LOOP_ERROR_BACKOFF_SECONDS` = 30…" | `app/supervision.py` | trim | H · apply |
| analysis `CLAUDE.md#P&L pattern consumer` "Per-event retry and park" six constants | `pnl_pattern_consumer.py` | trim to heuristic | H · apply |
| analysis `CLAUDE.md#Decide-surface RPCs` `_READ_DB_BACKSTOP_GRACE_S`/`_RELEASE_FLOOR_S` sentence | `app/repositories/read_budget.py` | drop sentence | H · apply |
| analysis `CLAUDE.md#Fundamentals availability guard` "**Fixed invariants**… `_FUND_PAGE_SIZE`…" | `servicer.py` | trim | H · apply |
| indicators `CLAUDE.md#Database` "Pool: `asyncpg.create_pool(…`" | `app/main.py`; root pool table | remove | H · apply |
| indicators `CLAUDE.md#Sandbox Security Model` lockdown bullets | `app/services/sandbox.py` docstring; INDICATORS-6..11 | trim to overview | M · apply |
| indicators `CLAUDE.md#Database` migrations enumeration | `migrations/` | remove | M · apply |
| indicators `CLAUDE.md` parameter/output caps | `app/services/parameters.py` | trim | M · apply |
| indicators `CLAUDE.md#Seeded Formulas` UUID + upsert mechanics | `seed_formulas.py` | trim | M · apply |
| indicators/ingest/analysis env blocks (plain lines) | `app/main.py`; `docker-compose.yml` | trim | M · apply |
| indicators/ingest/analysis Running Tests/Locally | `pyproject.toml`; root | trim; keep analysis `real_pg` paragraph | M · apply |
| ingest `CLAUDE.md#Database` bare migration filenames | `migrations/` | remove | M · apply |
| ingest constitution INGEST-1 "Full rationale in the… module docstrings" | `backfill_jobs.py` docstring | trim to exception | H · apply |
| ingest constitution INGEST-2 | `_UPDATABLE_COLUMNS` comment | remove | M · apply |
| indicators constitution INDICATORS-10 | `sandbox.py` import comment | trim to "never lazy" | H · apply |
| UI `CLAUDE.md#Environment Variables` `*_ENDPOINT`/OTEL lines + "Per the root naming convention…" | `docker-compose.yml`; root | trim | H · apply |
| UI `CLAUDE.md#Dependencies` table | root registry; `connectClients.ts` | **defer** — same line is contradicted (Used-by drift) | H · defer (ruling 5) |
| UI `CLAUDE.md#Running Locally` | `package.json#scripts` | trim to e2e line | H · apply |
| UI `CLAUDE.md#Segments` redirect line + segments table | `next.config.js`; same-file `## Role` | remove | H/M · apply |
| UI `CLAUDE.md#Auth + BFF` middleware row; `auth/layout.tsx` row; `auth.ts` row | in-file comments | trim | H/M · apply |
| UI `CLAUDE.md#Styling` `globals.css` scan line; `checkThemeBundle` (a)(b)(c); CI `ui-theme` filter sentence; `sidebar.tsx` `data-active` explanation | in-file comments; `ci.yml` | trim/remove | H/M · apply |
| UI `CLAUDE.md#Docker Build Pattern` | Dockerfile | **defer** (ruling 2) | M · defer |
| UI `CLAUDE.md#PWA` `public/` COPY line; matcher/headers line | Dockerfile; middleware/next.config comments | remove | H · apply |
| UI `CLAUDE.md#Observability` feature-294 label enum list | `bffMetrics.ts`; `bffAllowlist.test.ts` | trim to pointer | H · apply |
| UI `CLAUDE.md#Testing` chromium/sharding; jsdom-out-of-scope clauses | `playwright.config.ts`; `vitest.config.ts` | remove | M · apply |
| UI `CLAUDE.md#Browser typed clients` transport-factory mechanism | `browserClients/transport.ts`; UI-2 | trim | M · apply |
| UI `CLAUDE.md#Key File Paths` rows already listed in-file | same file | trim | M · apply |
| proto `CLAUDE.md` carve-out "It is dependency-free…", "(the feature-056 dual-source fix)", "(`1e-9`, feature 240)" | `packages/proto/pnl/pnl.go`; PLAT-12 | trim | H · apply |

## Cross-file duplication — CF-N3

| Context line | Duplicate site(s) → keeper | Action | Conf · Apply |
|---|---|---|---|
| Inter-service mTLS banner ×12 (every service `CLAUDE.md#Environment Variables`) | root `CLAUDE.md#Environment Variable Naming Convention` mTLS bullet; `docs/patterns/inter-service-mtls.md` → root | trim each to one pointer line; keep service deltas (agent client dial, UI lazy fail-closed) | H · apply |
| "> **Rule (C-05, CONFIG-9):** the stored key is namespace-relative…" in agent/ledger/identity/notify/config/UI (and others) `CLAUDE.md` | root `CLAUDE.md#Config Governance Rules` → root | remove; config keeps its `SetConfig` prefix-reject / migration `045` clause | H · apply |
| `DATABASE_CA_CERT` comment ×4 (ledger/identity/notify/config) | `docs/patterns/database.md` → pattern doc | trim to pointer comment | H · apply |
| Observability preamble "Any fixed value below… code constant… Label values are closed sets" ×N + "INFO `loop tick ok` carries…" lead-in ×3 | `docs/patterns/observability.md` (does **not** hold it) | move one verbatim copy to `observability.md`, delete the copies | M · apply (dest created) |
| agent `CLAUDE.md#MCP Tools` prompt paragraph | `docs/runbooks/mcp-tools.md` L6-10 → runbook | trim; **keep "registers forty-five tools"** | H · apply |
| agent `CLAUDE.md` `set_config` secrets paragraph | root Config Governance; runbook → root | trim to agent-specific clause | H · apply |
| agent `CLAUDE.md` user-admin paragraph | runbook; constitution Gotchas → constitution | trim | M · apply |
| agent `CLAUDE.md` `manage_strategy`/`set_strategy_live` paragraph + Role L34-36 | runbook | trim | M · apply |
| agent `CLAUDE.md` watchlist paragraph | runbook | **defer** — same paragraph is contradicted (⚠ "forward **only**") | M · defer (ruling 5) |
| agent `CLAUDE.md` score-trailer meta sentence "A second trailer contract would justify…" | — | drop sentence | M · apply |
| agent `CLAUDE.md` `EmitAlert` ungated paragraph | notify `CLAUDE.md` (owner) → notify | remove | M · apply |
| agent `CLAUDE.md#Role` propagation-trio mechanism | AGENT-4 → constitution | trim | H · apply |
| agent constitution AGENT-4 / AGENT-3 / AGENT-6 mechanism+history | CLAUDE / docstrings | **defer** (ruling 4: constitution keeper; CLAUDE side trimmed instead) | H · defer |
| agent `CLAUDE.md#OAuth 2.1` stateless narrative | `docs/oauth.md` (holds it) | trim to 2-line summary + pointer | M · apply |
| agent `CLAUDE.md#Config Keys Consumed` snapshot-read mechanism | AGENT-9 | trim | M · apply |
| agent `CLAUDE.md#Role` "`MCP_TRANSPORT=sse` remains accepted…" | runbook; env block comments | drop clause | M · apply |
| agent constitution Gotchas `_require_admin` first clause | CLAUDE; runbook | trim to `manage_account resume` inline-check note | M · apply |
| trading/portfolio `CLAUDE.md` "Caller identity comes from the `x-user-id` header…" | root PLAT-11 | trim to per-RPC list + filter exception | M · apply |
| portfolio `CLAUDE.md` "Internal callers with no inbound header…" | trading `CLAUDE.md` | drop clause | M · apply |
| trading constitution TRADING-N1 (SUPERSEDED) | root PLAT-11 | trim to one-line tombstone | H · apply |
| trading/portfolio constitution "SEV-1 scar (root PLAT-8)" | root PLAT-8 | trim to pointer | H · apply |
| trading constitution AdminScope parity gotcha | root PLAT-5 | trim | M · apply |
| trading constitution TRADING-2 enum half | root PLAT-F1 | trim | M · apply |
| trading `CLAUDE.md` L25 bracket history vs config row | same file | drop clause | H · apply |
| trading `CLAUDE.md` `reconcileTick` throttle sentence vs row | same file | remove | H · apply |
| portfolio `CLAUDE.md` quote-bounded reads; `ListAllWatchlistSymbols`; servability filter; expiry prune; `positionsMu` sentences; `account.positions.synced` row tails; offline valuation | PORTFOLIO-1/8/10/14/16/17/18/19 → constitution | trim CLAUDE side to pointers | H/M · apply |
| portfolio constitution PORTFOLIO-1/3/11 tails | CLAUDE | defer (ruling 4) | M · defer |
| marketdata `CLAUDE.md` feature-147 credential story ×5 | root vendor-credential bullet | keep secret rows; trim the rest | H · apply |
| marketdata `CLAUDE.md` timeframe vocabulary (L17) | MARKETDATA-1/-2 | trim (keep contradicted InvalidArgument clause untouched) | H · apply |
| marketdata `CLAUDE.md` `GetBars` dual-mode / `GetLatestQuotes` cache narrative | MARKETDATA-3/8/14/17 | **defer** — the `GetBars` line also carries a contradicted claim; moved verbatim with the Alpaca section instead (JIT) | H · defer |
| marketdata `CLAUDE.md` Derivation versioning vs MARKETDATA-13 | both | defer (pick-one needs owner call) | H · defer |
| marketdata `CLAUDE.md` "Gate scope — warm-add sites only." | MARKETDATA-16 | trim to pointer + residuals | M · apply |
| marketdata/portfolio findings in-file duplicate questions | same file | merge | H · apply |
| ledger `CLAUDE.md#Live Streaming` portfolio-subscriptions + oversize-NOTIFY lines | LEDGER-2/3/8; root pool table | trim/remove | M · apply |
| ledger constitution LEDGER-2/3 enumerations | CLAUDE | defer (ruling 4) | M · defer |
| identity `CLAUDE.md#Database` seed-admin narrative | `isBlockedDefaultAdmin`; findings Resolved | trim | H · apply |
| identity `CLAUDE.md#OAuth 2.1 backend` mechanism | IDENTITY-2/4/13; code | trim | M · apply |
| identity `CLAUDE.md#Ports` `ListAdminUserIds` SAN detail | IDENTITY-12 | trim to pointer | M · apply |
| identity constitution IDENTITY-6 / `revokeToken` / metadata-size gotchas | PLAT-11; findings; IDENTITY-11 | trim/remove | M · apply |
| notify `CLAUDE.md` Web Push / External fanout / `alert_reads` / One-instance / `FanoutWebhook` gate / URL-rule-in-config-row | NOTIFY-3/6/7/8/10; same file | trim to pointers | H/M · apply |
| notify constitution NOTIFY-1 "(Instance of root PLAT-F1/PLAT-2.)" | root | trim | M · apply |
| notify constitution backpressure / `severities` gotchas | notify findings | remove from constitution | H · apply |
| config `CLAUDE.md` Invariant #6 secrets; scope model ×3; Invariant #4 backoff; existence gate | root Config Governance; CONFIG-6; same file | trim | H/M · apply |
| config constitution `x-internal-caller` gotcha; `GetSecret` allow-list gotcha; Pointers secret row; CONFIG-2; CONFIG-4; `#884` gotcha | CLAUDE #6/#7; root PLAT-6/9; CONFIG-7 | trim/remove | H/M · apply |
| config constitution CONFIG-9 | root; PLAT-14 | **defer** (ruling 1 — CI-pinned sentences) | M · defer |
| PLAT-19 system-templates rule restated in indicators/ingest/analysis `CLAUDE.md` | root `docs/context-constitution.md#PLAT-19` | trim to pointer + local deltas | H · apply |
| analysis `CLAUDE.md` `identity.users` cross-schema sentence | root `CLAUDE.md#Database` | drop | H · apply |
| analysis `CLAUDE.md` "no new pool (budget stays 2)" ×5 | root pool table | keep one | H · apply |
| analysis/ingest/indicators `system`-grant narrative | root Header Propagation | trim to local grant map | M · apply |
| analysis `CLAUDE.md` fundamentals-operand section; availability-guard exclusion; semaphore narrative; "A configured `0` is honoured" ×N | ANALYSIS-3/8/12; constitution L40 | trim | H/M · apply |
| analysis constitution config-zero gotcha | root | trim | M · apply |
| indicators `CLAUDE.md` vs INDICATORS-1/4/5/6/7/8 + seed-id + declared-outputs | constitution | trim CLAUDE side; remove the two verbatim constitution copies (L25, L35) | H · apply |
| indicators `CLAUDE.md` "runs as **root**" ×3 | INDICATORS-6 | trim | H · apply |
| indicators `CLAUDE.md` memory-watchdog R1/R2 residuals | INDICATORS-2 | trim to 2 lines (residuals move to indicators `docs/sandbox.md`) | M · apply |
| ingest `CLAUDE.md` webhook hand-off / once-per-job | INGEST-12 | trim to pointer | H · apply |
| ingest `CLAUDE.md` L24-28 timeframe + constitution gotcha | constitution | trim both | M · apply |
| analysis `CLAUDE.md#Dependencies` feature parentheticals + "New dependency…" | root edges; same table | trim | M · apply |
| analysis constitution best-effort-writes gotcha | root PLAT-N1 | trim | M · apply |
| UI `CLAUDE.md` C-05 rule + "Keys are listed and read as namespace-relative…" | root | remove | H · apply |
| UI `CLAUDE.md#Frontend gotchas` 6 bullets | `docs/patterns/nextjs-frontends.md`, `frontend-auth.md` | keep pointer + handler-map bullet | H · apply |
| UI `CLAUDE.md` Non-happy states; Mobile offcanvas; Copilot rail; Enum render maps; combobox history | `ui-ux-governance.md`; UI-3; constitution | trim | H/M · apply |
| UI `CLAUDE.md` Nav-grouping; theme-bundle trap | `ui-ux-governance.md` → UI CLAUDE is keeper | trim the **governance** side instead | M · apply |
| UI constitution UI-5 deviant sentence | UI findings | drop | M · apply |
| root `CLAUDE.md#Header Propagation Convention` paragraph | root PLAT-4 → constitution (feature-225 clause moved into PLAT-4 first) | trim | M · apply |
| root `CLAUDE.md#Config Governance Rules` secrets mechanism | `docs/patterns/config-governance.md` (holds it) | trim to summary + pointer | H · apply |
| root `CLAUDE.md` "Per-feature registered keys live in…" second sentence | same section | remove | H · apply |
| root `CLAUDE.md` mTLS bullet; vendor-credential + removed-secret bullets | `inter-service-mtls.md`; `config-governance.md` | trim | M · apply |
| root `CLAUDE.md#Service-to-Service Calls` | same file Project Overview / Service Registry | remove section | M · apply |
| root `CLAUDE.md#Generating Proto Stubs` / bootstrap buf-gen clauses | Proto Contract Governance | drop clauses | M · apply |
| root `CLAUDE.md#Context Guide` two `docker-build.md` rows | same table | merge | H · apply |
| root `CLAUDE.md#Key File Paths` rows duplicating the Context Guide; nginx rows | Context Guide; tombstone | remove | H/M · apply |
| `docs/roadmap/CLAUDE.md` phase-status copy; Ledger + Features sections | root; nested CLAUDE.md files | trim | M · apply |
| root `CLAUDE.md#Feature Roadmap` per-dir file list + status-SSOT prose | `docs/roadmap/features/CLAUDE.md` | trim to pointer | M · apply |
| `docs/roadmap/features/CLAUDE.md` numbering rule; rules 1/3/4; bug-fields table; SDD Skills table | root; same file | trim/remove | H/M · apply |
| `docs/patterns/CLAUDE.md` index rows (all in root Context Guide) | root | trim | M · apply |
| `docs/runbooks/CLAUDE.md` 9 rows in root Context Guide | root | drop those 9 | M · apply |
| `docs/setup/CLAUDE.md` DO/Grafana rows | root | trim | L · defer |
| `docs/sdd/CLAUDE.md` `business-rules/` row | nested CLAUDE.md | trim | M · apply |
| root constitution PLAT-2 (= PLAT-F1); PLAT-1 (→ F2); SEV-1 scar gotcha; ts-proto gotcha | same file | remove/merge/trim | H/M · apply |
| proto constitution `user_id` inventory; PROTO-9 defect clause; `owner_only` gotcha; PROTO-13 fail-open; free-text + RPC-shape candidates; PROTO-7 enumerations | root PLAT-11; proto findings; ledger CLAUDE; PORTFOLIO-19; root candidate | trim/remove | H/M · apply |
| proto findings duplicate asymmetry bullet | same file | remove | H · apply |
| otel constitution `:4318` gotcha; `config.read_key` gotcha; otel findings resolved-under-open row | root PLAT-3; root gotcha; same file | remove/trim | H · apply |
| `docs/patterns/ui-ux-governance.md` §1 theme trap; §2 preset/combobox; Cross-references | UI CLAUDE; header bullets | trim | M · apply |
| root findings struck zero-trap row | same file Resolved | defer (ruling 3) | L · defer |

## Contradicted by code — routed to the findings logs, never trimmed (CF-N9)

Each row is (or now is) logged in the named module's `context-constitution-findings.md` § Documentation that lies;
the implement-vs-fix-the-doc call stays with a human. None is an `apply` candidate.

| Context line | Contradicting site | Logged in |
|---|---|---|
| ⚠ agent `CLAUDE.md` "`manage_formula` is different — it forwards **no** admin scope (plain `_metadata()`)" | `app/client.py#_metadata` emits the caller's `x-access-scope` whenever a caller is bound (PR #994) | agent findings (added) |
| ⚠ agent `CLAUDE.md` watchlist tools "forward **only** the caller's own `x-user-id`… never an admin `x-access-scope`" | same `_metadata` (trio always sent) | agent findings (added) |
| ⚠ root `CLAUDE.md#Frontend Authentication Pattern` "`src/lib/auth.ts` (Edge Runtime, `jose`)" | `services/xstockstrat-ui/src/middleware.ts` `runtime: 'nodejs'` (feature 128) | root findings (added) |
| root `CLAUDE.md#Approval Flow` points change-governance roles at `docs/runbooks/approval-flow.md` | that runbook is the **order**-approval flow; roles live in `docs/runbooks/reviewer-registry.md` | root findings (added) |
| root `CLAUDE.md#Inter-Service Dependencies` "All services → notify / ledger" | `NOTIFY_ENDPOINT`/`LEDGER_ENDPOINT` read by a subset only; analysis→portfolio/trading edges missing | root findings (added) |
| root `CLAUDE.md` Vitest `^3`; "all three segments" ×3; pnpm 9.15.9 vs UI 9.15.0 | UI `package.json`; `src/app/accounts/` | root findings (already logged) |
| root constitution PLAT-14 "`bash scripts/config-wiring-stored.py`" | `ci.yml#config-wiring-stored` runs `python3` | root findings (added) |
| root findings row "defect report … status `open`" (portfolio live-fold sell sign) | `.status` = `triaged` → feature 311 | root findings (corrected in place) |
| `ui-ux-governance.md` §8 "holds only **two** files" + "none" rows; §9 row d `CardNotice` | 59 `services/xstockstrat-ui/acceptance/*.feature`; `CardNotice.tsx` `role="alert"` | root findings (already logged) |
| `docs/CLAUDE.md` "Four subdirectories"; n8n mentions in `docs/CLAUDE.md`/`docs/setup/CLAUDE.md`/`docs/runbooks/CLAUDE.md`; `docs/patterns/CLAUDE.md` nginx row; `docs/roadmap/CLAUDE.md` "read `feature.md`" for status | `docs/` has 6 subdirs; `n8n.md` "No Longer in Use"; `nginx-routing.md` deprecated; status lives in `status.md` | root findings (added/already) |
| ⚠ `README.md` "fill in ALPACA_API_KEY, ALPACA_API_SECRET"; "`feature.md` (lifecycle status)"; `docs/setup/CLAUDE.md` alpaca row | `.env.example` (feature 147); `status.md` | root findings (already logged) |
| trading `CLAUDE.md` "the initial snapshot already applied this filter" | served `handler/trading.go#StreamOrderUpdates` sends no snapshot | trading findings (added) |
| trading `CLAUDE.md` `broker_call_timeout` "Read at account-client construction" | per-request closure in `instantiateBrokerLocked` | trading findings (already) |
| trading `CLAUDE.md` "A successful replace persists the order" | `UpsertOrder` `DO UPDATE SET` omits qty/prices/TIF | trading findings (already) |
| trading `CLAUDE.md` Ledger Events table missing `order.broker_call_uncertain`, `account.deregistered` | `trading.go` emit sites | trading findings (already) |
| trading `CLAUDE.md` `trading_state` Default `ACTIVE` | code default `HALTED` | trading findings (added) |
| trading constitution TRADING-4 "`recordOfflineOrder`… persist before the cache write" | `recordOfflineOrder` writes the cache first (auditor-cited; not orchestrator-reopened) | trading findings (already suggests correcting) |
| ⚠ portfolio `CLAUDE.md` "`GetSnapshot` returns `PermissionDenied`…" | handler maps every error to `NotFound` | portfolio findings (already) |
| marketdata `CLAUDE.md` `fundamentals.provider` "Read once at boot"/"boot-frozen" ×3 | `cmd/server/main.go#fundamentalsProvider` live read | marketdata findings (already) |
| marketdata `CLAUDE.md` `alpaca.feed`/`adjustment`/`backfill.*` "Read at startup." | per-request closure | marketdata findings (already) |
| marketdata `CLAUDE.md` non-`1d` → `InvalidArgument` | handler wraps as `CodeInternal` | marketdata findings (already) |
| marketdata `CLAUDE.md` ETF skip reasons omit `not_wired` | `etf_flags.go#etfFillGate` | marketdata findings (already) |
| marketdata `CLAUDE.md` "TRADING_MODE is no longer used"; secrets "resolved at startup" | `main.go` still reads `TRADING_MODE`; `liveSecrets.bindRefresh` | marketdata findings (already) |
| ⚠ analysis `CLAUDE.md` owner-scoped universe "deferred to feature 132" | `app/engine/live_loop.py#resolve_universe` shipped | analysis findings (already) |
| analysis `CLAUDE.md` five limits "Read once in `AnalysisServicer.__init__`"; indicators sandbox semaphore "Read once" | `servicer.py#_live_limit` / `ResizableLimiter` (PLAT-16) | analysis + indicators findings (already) |
| analysis `CLAUDE.md` "Code-default only"/"No seed migration" clauses | config migration `041` seeds them | analysis findings (added) |
| analysis Ledger Events missing `snapshot.captured/.degraded`, `pattern.sealed`; ingest missing `backfill.canceled` | `pnl_pattern_consumer.py`; ingest `servicer.py` | analysis (added) / ingest (already) |
| ingest findings Resolved entry claiming reads "carry the full prefix" | same file feature-304 row (reads are bare) | ingest findings (corrected) |
| ledger `CLAUDE.md` `pg_notify('ledger_stream_{stream_key}'…)`; `TRADING_MODE=paper` ×3 (ledger/identity/notify); config `APPLICATION_ENV` "default environment scope" | migration `001` sanitises + `_all`; `configWatcher.ts`; `telemetry.ts` | ledger/identity/notify/config findings (already) |
| UI `CLAUDE.md` "`coverage.all: false`" | `vitest.config.ts#coverage` has no `all` key | UI findings (added) |
| UI `CLAUDE.md#Dependencies` Used-by ledger/config | `traderBff.ts`/`insightsBff.ts` | UI findings (added) |
| UI `CLAUDE.md` "(Edge bundle)" reason; recharts consumer list incomplete | `middleware.ts` `runtime: 'nodejs'`; grep `from 'recharts'` | UI findings (added) |

## Should be just-in-time (pre-loaded → pointer)

Owner gate: destinations that do not exist are **created in this PR with the section moved verbatim**; the
source keeps a one-line pointer.

| Section | Destination (holds it before?) | Conf · Apply |
|---|---|---|
| agent `CLAUDE.md#MCP Tools` 45-row table | `docs/runbooks/mcp-tools.md` (**yes**) | H · apply (pointer + "registers forty-five tools" kept) |
| agent constitution AGENT-8 fixture inventory | `tests/conftest.py` (**yes**) | M · apply |
| indicators `CLAUDE.md#Maintenance` | `docs/runbooks/legacy-formula-authors.md` (**yes**) | H · apply |
| marketdata `CLAUDE.md#Quote retention` G1–G4 sentence | feature 229 `context.md` (**yes**) | H · apply |
| analysis `CLAUDE.md` Decide-surface RPCs (ListOpportunities … GetWatchlistReadiness) | `services/xstockstrat-analysis/docs/opportunities.md` (no → created) | H · apply |
| analysis `CLAUDE.md#P&L pattern consumer` | `…/analysis/docs/pnl-consumer.md` (created) | H · apply |
| analysis `CLAUDE.md#Fundamentals availability guard` | `…/analysis/docs/fundamentals-guard.md` (created; constitution Pointers re-pointed) | H · apply |
| analysis `CLAUDE.md#Fundamentals Signal Producer` | `…/analysis/docs/fundsignal.md` (created) | H · apply |
| analysis `CLAUDE.md#Owner-keyed evidence` | `…/analysis/docs/ownership-and-templates.md` (created) | M · apply |
| analysis `CLAUDE.md#Strategy Score Persistence` | `…/analysis/docs/scoring.md` (partial → appended) | M · apply |
| analysis `CLAUDE.md#Benchmark operand` | `…/analysis/docs/warmup.md` (partial → appended) | M · apply |
| analysis `CLAUDE.md#Backtest Fill Model` | `…/analysis/docs/backtest-fill-model.md` (created) | M · apply |
| analysis `CLAUDE.md#Per-sector overrides` | `…/analysis/docs/sector-overrides.md` (created) | M · apply |
| analysis `CLAUDE.md#Config Keys Consumed` narrative tails | `docs/patterns/config-governance.md` (partial) | M · defer — ~26k chars of per-row edits; needs per-key owner review |
| trading `CLAUDE.md#Broker State Reconciliation` + Order Status Reconciliation | `services/xstockstrat-trading/docs/reconciliation.md` (created) | H/M · apply |
| trading `CLAUDE.md#Order Replace` per-broker matrix | `…/trading/docs/ibkr.md` | M · defer — section also carries a contradicted claim (ruling 5) |
| trading `CLAUDE.md` credential-health / offline block | `…/trading/docs/offline-accounts.md` (created) | M · apply |
| trading `CLAUDE.md#Position & Balance Sync Observability` | `…/trading/docs/reconciliation.md` | M · apply |
| portfolio `CLAUDE.md` `position.closed` producer contract | `services/xstockstrat-portfolio/docs/position-closed-contract.md` (created) | M · apply |
| portfolio/marketdata `CLAUDE.md#Observability` | `docs/patterns/observability.md` shared sentence only | M · apply (shared lead-in only) |
| marketdata `CLAUDE.md#Fundamentals Integration` | `services/xstockstrat-marketdata/docs/fundamentals.md` (created; constitution Pointers re-pointed) | M · apply — contradicted sentences move verbatim, unchanged |
| marketdata `CLAUDE.md#Alpaca Integration` | `…/marketdata/docs/alpaca-integration.md` (created) | M · apply — contradicted sentences move verbatim, unchanged |
| marketdata `CLAUDE.md#Asset-set servability` | `…/marketdata/docs/` | L · defer |
| notify `CLAUDE.md` Requeue SQL | `services/xstockstrat-notify/docs/operations.md` (created) | M · apply |
| notify `CLAUDE.md` VAPID/Slack/SendGrid deploy-wiring note | `docs/runbooks/sops-secrets.md` (cited) | M · apply |
| config `CLAUDE.md` "Known limitations (feature 258)" | config findings | M · apply |
| UI `CLAUDE.md` fundamentals-skip / formula-unreadable test-ID bullets | `services/xstockstrat-ui/docs/opportunities-shell.md` (created) | M · apply |
| UI `CLAUDE.md#PWA & Push Notifications` | `…/xstockstrat-ui/docs/pwa-push.md` (created) | M · apply |
| UI `CLAUDE.md` positions-page cross-segment exception | UI constitution UI-2 exception | M · apply |
| UI `CLAUDE.md` lightweight-charts history | — (trim in place) | M · apply |
| indicators `CLAUDE.md#Observability` probe fields | — | L · defer |
| root `CLAUDE.md` pooled rows; Observability module list | `docs/patterns/database.md`, `observability.md` | L · defer |
| root `CLAUDE.md` Vitest/Tailwind notes; numbering-rule detail | UI CLAUDE; `feature-workflow.md` (**yes**) | M · apply |

## Brittle / over-specified (anti-altitude)

| Context line | Heuristic it becomes | Conf · Apply |
|---|---|---|
| agent `CLAUDE.md#Role` caller-identity builder enumeration (already incomplete: `snapshot_offline_positions`) | "Identity travels only in `x-user-id`; set a body `user_id` only as a target/scope selector…" | M · apply |
| analysis `CLAUDE.md#P&L pattern consumer` five-step sequence | moved with the section (JIT) | M · apply |
| analysis constitution ANALYSIS-12 "8+ sites" | "Pass the gate to BOTH loader and `assess`." | M · apply |
| UI constitution 30 s deadline gotcha; exhaustive render-map file list | one-line heuristics | M · apply |
| proto constitution PROTO-7 site enumerations | sibling-flag heuristic | M · apply |
| trading bracket step-by-step; marketdata `bar_ingest_timeframe` row; config-row clamp tails; ingest INGEST-10 evidence; UI UI-8/9/10 counts; UI `timestampFromDate` site list; analysis bare `fails.md:` refs | heuristics | L · defer |

## Bloat / low-value prose

| Context line | Action | Conf · Apply |
|---|---|---|
| Constitution preambles (root, agent, trading, portfolio, marketdata, ledger, identity, notify, config, ui, indicators, ingest, analysis, proto) — multi-refresh changelog run-ons | trim to "Derived 2026-07-24; last refreshed 2026-11-10 @ `3b0fa6ab`." (refresh re-stamps) | M · apply |
| Findings-log header changelogs (all modules) | trim to one line | L/M · apply where M |
| trading constitution refuted fill-poller candidate; portfolio struck gotcha "Original note:" | remove | M · apply |
| portfolio findings "GetPnL wire-code changes are intended" | remove | M · apply |
| proto constitution "the former `UpdateStrategyRequest` no longer exists"; otel OTEL-2 history parenthetical | drop clauses | L/M · apply where M |
| otel findings dead "Filed as defect reports" section | remove | M · apply |
| identity constitution IDENTITY-14 (restates header comment); bcrypt-parity gotcha | remove / trim | H/M · apply |
| ledger `CLAUDE.md` "**All services write here.**" | remove | L · defer |
| analysis constitution `bef4258` story; feature 144/245/246 changelog; post-147 residual | trim | M · apply |
| ingest `CLAUDE.md` "As of Phase 3…"; feature-092 gate parenthetical; migration-005 parenthetical; "## Ports" heading holding only Authorization (rename) | trim; rename heading | M/H · apply |
| ingest constitution struck INGEST-9 row | remove | H · apply |
| analysis `CLAUDE.md` "Before 193…" config-cell history | drop | M · apply |
| UI `CLAUDE.md#Role` feature-045 history; Styling feature-119 history; `HALT_SOURCE` parenthetical; constitution `#901/#884` `trading_mode` half; `63a3655` story | trim | H/M · apply |
| `docs/roadmap/features/CLAUDE.md` "These tracking fields make production audits easy…" | remove | M · apply |
| `docs/patterns/ui-ux-governance.md` icon counts; literal colour values | trim | M · apply |
| `docs/sdd/CLAUDE.md` meta paragraph; `docs/roadmap/ledger/CLAUDE.md` "See also" | remove | L · defer |
| Resolved / struck rows inside findings tables (agent, trading, portfolio, marketdata, indicators, ingest, notify, UI) | — | defer (ruling 3) |

## webhooks-mcp seam (cross-repo)

Owner gate: the listener contract (frozen C1–C9) lives in `docs/contracts.md` of the `davcs86/webhooks-mcp`
repository; xstockstrat files point there instead of restating it. **No value is changed.**

| Context line | Action |
|---|---|
| `services/xstockstrat-notify/CLAUDE.md#Outbound webhooks` Worker bullet — "POSTs `{event_name, payload: {source_service, environment, occurred_at, data}}` with an `Idempotency-Key` header" | wire-format clause → pointer to `davcs86/webhooks-mcp` `docs/contracts.md`; sender policy (retry classes, `redirect: 'manual'`, dead letter) kept |
| `services/xstockstrat-notify/docs/context-constitution.md#NOTIFY-10` — "the receiver dedups on `Idempotency-Key`" | receiver-semantics clause → same pointer |

No other audited file restates ports 9100/9101, `/hooks`, the 201/200/404/413/422/503 codes or the wire format.

## Context budget (file-level, measured `wc -lc`, biggest first; soft budget ~2,000 chars)

| File | Lines | Characters |
|---|---|---|
| `services/xstockstrat-analysis/CLAUDE.md` | 695 | 86,653 |
| `services/xstockstrat-marketdata/CLAUDE.md` | 290 | 46,509 |
| `docs/context-constitution.md` | 105 | 42,440 |
| `CLAUDE.md` | 463 | 39,062 |
| `services/xstockstrat-ui/CLAUDE.md` | 447 | 37,963 |
| `services/xstockstrat-trading/CLAUDE.md` | 311 | 34,774 |
| `docs/context-constitution-findings.md` | 101 | 30,516 |
| `services/xstockstrat-portfolio/docs/context-constitution.md` | 61 | 30,172 |
| `services/xstockstrat-analysis/docs/context-constitution.md` | 67 | 29,744 |
| `services/xstockstrat-marketdata/docs/context-constitution.md` | 69 | 26,836 |
| `services/xstockstrat-portfolio/CLAUDE.md` | 215 | 25,807 |
| `services/xstockstrat-agent/CLAUDE.md` | 255 | 25,532 |
| `services/xstockstrat-ui/docs/context-constitution.md` | 68 | 25,052 |
| `services/xstockstrat-indicators/CLAUDE.md` | 286 | 24,178 |
| `packages/proto/docs/context-constitution.md` | 59 | 23,204 |
| … every other audited file except `packages/proto/CLAUDE.md`, `packages/otel/CLAUDE.md`, `docs/CLAUDE.md`, `docs/setup/CLAUDE.md`, `docs/roadmap/ledger/CLAUDE.md` is also over budget | | |

## Silent skills (weak trigger surface)

None. 19 repo skills scanned (`.claude/skills/*`, `.agents/skills/*`, `plugins/strat-lab/skills/backtest`);
0 excluded as symlinked-out (`.claude/skills/{shadcn,migrate-radix-to-base}` are in-repo symlinks to
`.agents/skills/*`). `backtest` is `disable-model-invocation: true` (command-only, has a human cue).

## Keep-but-verify (unconfirmed — CF-1)

- ⚠ trading `CLAUDE.md` "`ListOrders` and `StreamOrderUpdates` keep their body `user_id`… (empty = all users, for trusted internal callers)" — what restricts an empty selector to internal callers? No gate found in `internal/middleware`.
- ingest `CLAUDE.md` "`TriggerBackfill` also rejects any timeframe other than `1d`" — should it say "bar backfills only" (FUNDAMENTALS skips the reject, `servicer.py`)?
- analysis `CLAUDE.md` "Feature-131 fan-out worst case = 200" — anything enforcing the compound ceiling?
- indicators/ingest/analysis/ledger/identity/notify env `TRADING_MODE=paper` — remove after the open root findings row is ruled on?
- indicators `CLAUDE.md` ATR/VWAP close-only parenthetical — restated by `INDICATOR_REGISTRY` descriptions?
- indicators `CLAUDE.md` container-sizing "Re-check it whenever…" — runbook material?
- indicators constitution stderr-classification candidate vs findings — is the 2026-10-19 report still open?
- agent `Running Tests` `--cov-fail-under=40`; agent telemetry allowlist test existence; `_BUCKETS_MS` parity test.
- UI copilot "forces `event_type`" on reads too? UI-1 "THREE sanctioned forms"; PWA "SYNCHRONOUSLY" gotcha vs `PushToggle.tsx` comment; "Next 16 / Turbopack" advice.
- proto findings `Watchlist.symbols` asymmetry vs constitution sentence; root findings `owner_only` row type.
- notify `webhook.*` config rows vs `config-governance.md` copy — which copy is trimmed?
- notify Key Design 3-line overview; ledger/identity/notify/config instrument lists vs pinned tests; CONFIG-12 pinned by AC-26?
- root Language table "soft source of truth" policy; `ui-ux-governance.md` "zero orphans today" / §9 row e; "Edge-runtime safety" wording; business-rules promotion lifecycle vs `scenario-promoter.md`; Context Guide gaps (`client-api-pattern.md`, `inter-service-mtls.md`, `sops-secrets.md`, `operator-db-access.md`, `infra-cost-reduction.md`).

## Protected blocks (reported, never trimmed)

| Block | Location | Marker |
|---|---|---|
| behavioral contract | `CLAUDE.md` L1-28 | `context-forge:behavioral-contract` |
| constitution pointer | L3-5 of every `services/*/CLAUDE.md` (12) and `packages/{proto,otel}/CLAUDE.md` | `context-forge:constitution-pointer` |
| machine-managed fence (not context-forge; treated as protected) | `docs/patterns/ui-ux-governance.md` | `307:staging-contrast-deviations:begin/end` |

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins). These are low-signal lines to trim, not rules to keep — nothing grounded is dropped (**CF-N8**). Re-run `/context-scrubber` to re-audit._
