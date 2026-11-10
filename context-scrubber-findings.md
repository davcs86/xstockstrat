# Context Scrub — Findings

Low-signal context surfaced by `/context-scrubber` (mode `scan`) on 2026-11-04 from branch
`ccr-d09db3b6-ao7ybn` at commit `2f34666` — the repo state this audit reflects. Each row is a line in an
**auto-loaded** context file (CLAUDE.md, context-constitution*.md) or an opted-in doc (`README.md`, `docs/patterns/ui-ux-governance.md`)
that an agent would find for free, that no longer resolves, that is duplicated, or that the code now contradicts —
dead weight paid for on every load. This is a report for triage; trimming is **gated** (`/context-scrubber apply`), never
automatic. Every row cites both the context line and the evidence it fails. Re-run `/context-scrubber` to re-audit; run
`/context-constitution` to add the knowledge that *passes*.

**How the rows were produced.** Ten read-only `context-auditor` passes classified the 56-file audit set against the repo; the orchestrator
then re-checked a sample of the highest-value verdicts directly (stale paths, the credential/secret rows, the `HALTED` default, the agent tool table
1:1 against the runbook, the 12 mTLS copies, feature 132 `launched`, the 53 acceptance files, the `ledger` compression/retention migrations)
and found them all to hold. **Rows the orchestrator did not itself re-verify rest on the auditor's cited evidence, which is named in every row.**
Auditor claims that did not hold were dropped (see "Dropped as false positives").

> Rows touching an authz/authn/secret/tenant boundary carry a **⚠**. Every section is ordered by confidence, then measured size.

## Summary

All figures are **measured** by counting the flagged lines directly in the files (`wc`-style: characters include the newline). A row's
lines are the *whole* flagged lines, so for `trim`/`trim to a heuristic` rows this is an **upper bound** on what `apply` would subtract; for
`move-to` rows it is the amount that *relocates* behind a pointer, not deleted knowledge. No tokenizer was available this run, so tokens are
only the labelled approximation `≈ chars ÷ 4`. Rows with confidence **L** are listed but excluded from every savings figure.

| Category | Rows (H/M) | Rows (L) | Lines (H/M) | Characters (H/M) | ≈ tokens (chars ÷ 4) |
|---|---|---|---|---|---|
| Stale citations | 2 | 0 | 2 | 351 | ≈ 87 |
| Restated (agent reads for free) | 68 | 10 | 550 | 53,003 | ≈ 13,250 |
| Cross-file duplication | 184 | 10 | 791 | 190,562 | ≈ 47,640 |
| Contradicted by code (routed, not removable) | 31 | 0 | 150 | 16,394 | ≈ 4,098 |
| Should be just-in-time | 34 | 2 | 781 | 94,071 | ≈ 23,517 |
| Brittle / over-specified | 10 | 8 | 92 | 15,657 | ≈ 3,914 |
| Bloat / low-value prose | 43 | 20 | 168 | 37,529 | ≈ 9,382 |
| **Deletable / trimmable total** (stale + restated + dup + bloat, deduped, minus contradicted lines) | — | — | 1,471 | 268,056 | ≈ 67,014 |
| **Relocatable / shortenable total** (just-in-time + brittle, deduped, minus contradicted lines) | — | — | 811 | 104,310 | ≈ 26,077 |
| **Removable total** (all of the above, deduped across categories) | — | — | 2,170 | 354,258 | ≈ 88,564 |
| of which **whole-line removals / relocations** (action is `remove` / `delete` / `move-to` / `merge` outright) | — | — | 977 | 119,225 | ≈ 29,806 |
| of which **partial trims** (the line stays; only part of it goes — whole-line measure is an upper bound) | — | — | 1,193 | 235,033 | ≈ 58,758 |
| Low-confidence (L) rows, not counted above | — | 50 | 170 | 38,890 | ≈ 9,722 |
| Keep-but-verify (unconfirmed) | 41 | — | — | — | — |

Audit set: **56 files · 6,029 lines · 858,699 characters** (≈ 214,674 tokens, chars ÷ 4). Whole-line removals/relocations alone are **13.9%** of that; adding every partial trim at whole-line measure is a hard ceiling of **41.3%** — the realistic saving sits between the two.

> The "Removable total" counts only rows whose action is `remove`/`trim`/confirmed `move`. `keep-but-verify` rows and **contradicted-by-code**
> rows are excluded (unproven → no savings claim, CF-1; defects routed to `/context-constitution`, never `apply`-deleted, CF-N9).

## Stale citations

Citations whose **content anchor** no longer resolves (**CF-N13**). Drifted `~L` hints are never listed. Only two anchors failed across all ten audits.

| Context line | Citation it makes | Reality | Suggested action | Lines / chars · conf |
|---|---|---|---|---|
| `services/xstockstrat-trading/CLAUDE.md` L140 — "`_tasks/x-approval-flow.md`" cited for the approval flow | `_tasks/x-approval-flow.md` | glob finds no such file anywhere (only `docs/reports/2026-10-19-trading-claude-md-drift-defect.md` (pruned 2026-11-10; `git show adf411c3:docs/reports/2026-10-19-trading-claude-md-drift-defect.md`) mentions it); `docs/runbooks/approval-flow.md` exists | re-ground to `docs/runbooks/approval-flow.md` | 1 / 250 H |
| `services/xstockstrat-config/CLAUDE.md` L25 — "config-ui reaches it over gRPC `50060` (`app/lib/connectClients.ts`)" | `app/lib/connectClients.ts` | no such file in this service; the basename resolves only at `services/xstockstrat-ui/src/lib/connectClients.ts` | re-ground to the UI path, or drop the parenthetical | 1 / 101 H |

## Restated facts (agent reads for free) — fails CF-N4

| Context line | What restates it (free to read) | Note | Suggested action | Lines / chars · conf |
|---|---|---|---|---|
| `services/xstockstrat-analysis/CLAUDE.md` L563-574, L576, L578-581, L583-585 — "Seeded by migration 028/027; bounds [a,b]" and "Code-default only" tails | config migrations 027/028; `configServiceImpl.ts#SCALAR_BOUNDS_REGISTRY` |  | remove the tails | 20 / 8,770 H |
| `services/xstockstrat-ui/CLAUDE.md` L204-220 — Dependencies table | `src/lib/connectClients.ts`; `docker-compose.yml` L503-512; root Inter-Service Dependencies |  | remove | 17 / 970 H |
| `services/xstockstrat-analysis/CLAUDE.md` L202-210 — pnl-consumer constants + poison allow-list | `app/engine/pnl_pattern_consumer.py` L53-58, `_is_poison` | keep the rationale (don't use `is_transient_db_error`) | trim to the rationale | 9 / 899 H |
| `services/xstockstrat-trading/CLAUDE.md` L61-68<br>`services/xstockstrat-portfolio/CLAUDE.md` L76-83<br>`services/xstockstrat-marketdata/CLAUDE.md` L29-36 — Ports table; "former HTTP server removed" | root Service Registry; `config.go getEnv("GRPC_PORT",…)` |  | remove or one line | 24 / 890 H |
| `services/xstockstrat-identity/CLAUDE.md` L25-34 — RPC list; `ListAdminUserIds`; "former 8058 server removed" | `identity.proto`; `identityServiceImpl.ts`; IDENTITY-12; `adminDirectory.ts` L6; `src/connect/` no longer exists |  | trim | 10 / 835 H |
| `services/xstockstrat-ingest/docs/context-constitution.md` L36 — gotcha that says "Already self-documented at the site" | `servicer.py:1087` comment ("ordered before the generic `except Exception`…") |  | remove | 1 / 793 H |
| `services/xstockstrat-analysis/CLAUDE.md` L154-156, L63-66, L38-39 — constant values (`_LOOP_ERROR_BACKOFF_SECONDS`, `_BOOT_RECOMPUTE_MAX_PAIRS`, `_INTENT_*`) | `app/supervision.py` L10; `servicer.py` L350-354 |  | remove the values | 9 / 771 H |
| `services/xstockstrat-ingest/docs/context-constitution.md` L20 — INGEST-1 (repositories stay proto-free) | `app/repositories/backfill_jobs.py:1-7` docstring | keep the `signal_sources.py#owner_scope_predicate` exception | trim to the exception | 1 / 746 H |
| `services/xstockstrat-marketdata/CLAUDE.md` L174-181 — ETF-filler constants, log message names | `etf_flags.go` (`etfFlagTTL`, `etfFlagCacheMax`, …) |  | trim | 8 / 715 H |
| `services/xstockstrat-ingest/CLAUDE.md` L11-15, L21-29 — "As of Phase 3…", Language, port table, removed `8055`/`/webhooks/*` narrative | root Service Registry; "Service-to-Service Calls" |  | remove | 14 / 683 H |
| `services/xstockstrat-ui/CLAUDE.md` L284-295, L301-303 — `*_ENDPOINT` and OTEL env lines | `docker-compose.yml` L503-513; `docs/patterns/observability.md` | keep annotated lines L296-300 | trim | 15 / 644 H |
| `services/xstockstrat-ui/CLAUDE.md` L383-396 — Running Locally | `package.json` scripts |  | remove | 14 / 583 H |
| `services/xstockstrat-agent/CLAUDE.md` L162-167 — "That plumbing is also why…" (dangling antecedent) | `app/tools.py#_claims_from_context` docstring L100-106 |  | remove | 6 / 578 H |
| `services/xstockstrat-agent/CLAUDE.md` L180-186 — key-creation gate; refers to a "secret-refusal" that AG L169 says PR #994 lifted | `app/tools.py#set_config` docstring L1829-1840; runbook |  | remove | 7 / 564 H |
| `services/xstockstrat-identity/docs/context-constitution.md` L31 — IDENTITY-14 ("No relative imports") | `src/grpc/adminDirectory.ts:1` header comment — the rule itself says "one authoritative site (the header comment)" |  | remove | 1 / 474 H |
| `services/xstockstrat-agent/CLAUDE.md` L226-234 — `*_ENDPOINT` lines | `docker-compose.yml` L559-567; root naming convention | keep annotated lines L223-225, L236 | trim | 9 / 451 H |
| `services/xstockstrat-indicators/CLAUDE.md` L42-44, L52-60 — Language, Ports, "former HTTP server on 8054 removed" | root Service Registry; "Service-to-Service Calls" |  | remove | 12 / 392 H |
| `services/xstockstrat-ingest/docs/context-constitution.md` L21 — INGEST-2 (`_UPDATABLE_COLUMNS`) | `backfill_jobs.py:11-13` comment |  | remove | 1 / 392 H |
| `services/xstockstrat-agent/CLAUDE.md` L239-248 — tests and CI history ("no longer local-only") | `.github/workflows/ci.yml` L58, L338-402 |  | trim | 10 / 361 H |
| `services/xstockstrat-analysis/CLAUDE.md` L237-240 — read-budget constants (`_READ_DB_BACKSTOP_GRACE_S` etc.) | `app/repositories/read_budget.py` L12-15 | keep "fixed invariants, not config keys" | remove the numbers | 4 / 359 H |
| `services/xstockstrat-ui/CLAUDE.md` L65-68 — `vitest.config.ts` alias | `vitest.config.ts` L12-16 comment says the same |  | remove | 4 / 341 H |
| `services/xstockstrat-analysis/CLAUDE.md` L482-485 — `_FUND_PAGE_SIZE`, `_MAX_FUND_PAGES`, … | `app/handlers/servicer.py` L305-311 |  | remove | 4 / 332 H |
| `services/xstockstrat-notify/CLAUDE.md` L57-60 — "compile-first" test command; 074/092 narrative | `package.json` L12 `"test": "tsc && node --test …"` |  | remove | 4 / 316 H |
| `services/xstockstrat-analysis/CLAUDE.md` L220 — "New dependency edges…" | this file L272-273, L124 |  | remove | 1 / 264 H |
| `services/xstockstrat-analysis/CLAUDE.md` L256-263 — Ports + "gRPC-only" | root `CLAUDE.md#Service Registry` |  | remove | 8 / 259 H |
| `services/xstockstrat-ledger/docs/context-constitution.md` L31 — "the CLAUDE.md wording 'PostgreSQL rules' is wrong" | ledger CLAUDE L9 now says triggers (`deny_mutation`); findings L12 marks it RESOLVED |  | remove (the claim is itself stale) | 1 / 245 H |
| `services/xstockstrat-ui/CLAUDE.md` L106-112 — Ports | root Service Registry; `docker-compose.yml "3000:3000"` |  | remove | 7 / 210 H |
| `services/xstockstrat-trading/CLAUDE.md` L135-136<br>`services/xstockstrat-portfolio/CLAUDE.md` L135<br>`services/xstockstrat-marketdata/CLAUDE.md` L128 — golang-migrate + run command | root `CLAUDE.md#Database` |  | remove | 4 / 168 H |
| `services/xstockstrat-identity/CLAUDE.md` L19-23 — Ports | root Service Registry; `docker-compose.yml GRPC_PORT: "50058"` |  | remove | 5 / 114 H |
| `services/xstockstrat-ui/CLAUDE.md` L25 — Language (Next 15, React 18, Node 24) | `package.json`; root Language table |  | remove | 1 / 89 H |
| `services/xstockstrat-trading/CLAUDE.md` L55-57<br>`services/xstockstrat-portfolio/CLAUDE.md` L68-70<br>`services/xstockstrat-marketdata/CLAUDE.md` L21-23 — "Go 1.27" section | `go.mod` `go 1.27.0`; root Language table |  | remove the section | 9 / 75 H |
| `services/xstockstrat-agent/CLAUDE.md` L38-40 — Language (Python 3.13) | `Dockerfile` `python:3.13-slim`; `pyproject.toml requires-python >=3.12`; root Language table | (already logged as drift in agent findings L22) | remove | 3 / 67 H |
| `services/xstockstrat-portfolio/CLAUDE.md` L131-133 — column lists by migration 005/006/009/012/013/017 | `services/xstockstrat-portfolio/migrations/*` | keep broker-first valuation, offline has no balance row | trim | 3 / 2,371 M |
| `services/xstockstrat-ui/CLAUDE.md` L361-381 — Testing commands/config | `package.json` scripts; `vitest.config.ts`; `playwright.config.ts`; `docs/e2e-testing.md` |  | trim | 21 / 1,675 M |
| `services/xstockstrat-ingest/CLAUDE.md` L85-102 — migration-by-migration narrative (008/009/013/014) | migrations; `signal_sources.py#derive_health_status` | keep dedup-claim semantics L90-96 | trim | 18 / 1,670 M |
| `docs/roadmap/CLAUDE.md` L6-10 — per-phase deviation summaries | `docs/roadmap/phase3…7-deviations.md` headers/bodies |  | trim to a one-phrase description per row | 5 / 1,481 M |
| `services/xstockstrat-trading/CLAUDE.md` L132-134 — order_brackets states; offline snapshot columns; migrations 009/011 | `services/xstockstrat-trading/migrations/*` |  | trim to semantics | 3 / 1,446 M |
| `services/xstockstrat-analysis/CLAUDE.md` L516, L520-522 — read-presence / `float_positive` mechanics | `servicer.py` L801-835, L1222-1225 |  | trim | 4 / 1,419 M |
| `services/xstockstrat-indicators/CLAUDE.md` L109-124 — seeded formula UUID, 6-metric list, upsert mechanics | `seed_formulas.py` docstring; `fundamentals_value_quality.py`; constitution Gotcha |  | trim to 2 lines | 16 / 1,414 M |
| `services/xstockstrat-analysis/CLAUDE.md` L265-276 — dependency edges | root `CLAUDE.md#Inter-Service Dependencies`; compose | keep the feature-224 saga and 116 backfill cells | trim | 12 / 1,356 M |
| `services/xstockstrat-trading/CLAUDE.md` L283-294<br>`services/xstockstrat-portfolio/CLAUDE.md` L181-189<br>`services/xstockstrat-marketdata/CLAUDE.md` L241-250 — env var blocks with defaults | `internal/config/config.go getEnv(...)`; `docker-compose.yml` | keep non-obvious lines (trading `BROKER_ACCOUNTS_ENCRYPTION_KEY` generate hint) | trim | 31 / 1,317 M |
| `CLAUDE.md` L428-430<br>`CLAUDE.md` L438-441<br>`CLAUDE.md` L446-449<br>`CLAUDE.md` L452-457<br>`CLAUDE.md` L462-464<br>`CLAUDE.md` L470-472 — Key File Paths index rows (self-describing filenames) | Glob / directory listing | keep L431-433 (never-Read/Grep directives) and L450-451 | trim to the heuristic | 23 / 1,295 M |
| `services/xstockstrat-marketdata/CLAUDE.md` L115-126 — `ohlcv_remediation_003` and `symbol_classification` column/SCD detail | migrations 003/009 |  | trim | 12 / 1,080 M |
| `services/xstockstrat-ingest/CLAUDE.md` L158-178 — tests, env list, mTLS note | `pyproject.toml`; root CI coverage; `docker-compose.yml` |  | remove; keep non-obvious vars | 21 / 1,021 M |
| `services/xstockstrat-indicators/CLAUDE.md` L167-173, L178-181 — parameter validation, 32/16 caps | `app/services/parameters.py` docstring L1-21, `MAX_PARAMETERS`/`MAX_OUTPUTS` | keep L174-177 | trim | 11 / 975 M |
| `services/xstockstrat-ui/CLAUDE.md` L229-231, L240-241 — Auth+BFF rows; "(was Edge-safe pre-128)" | file headers in `auth.ts`, `identity.ts`, `connectClients.ts` | keep the "canonical, do not re-implement" rows L232-236 | trim | 5 / 917 M |
| `docs/patterns/ui-ux-governance.md` L34-36, L40-45 — literal hsl values, font stack, radius | `src/app/globals.css` L44-46, L51, L106 | keep the role-name rules | trim values | 9 / 791 M |
| `services/xstockstrat-indicators/CLAUDE.md` L86-93 — per-migration enumeration | `migrations/001…007_*.up.sql` | keep DB column semantics L73-85 | remove the enumeration | 8 / 714 M |
| `services/xstockstrat-ui/CLAUDE.md` L29-35, L37 — Styling intro; `npx shadcn add` (feature-119 history) | `components.json`; `globals.css` |  | trim | 8 / 714 M |
| `services/xstockstrat-analysis/CLAUDE.md` L628-640 — env list | `docker-compose.yml` analysis block; root env-naming | keep the feature notes L634-635 | trim to a pointer | 13 / 679 M |
| `docs/patterns/ui-ux-governance.md` L101-107 — exact class strings and wrap rationale | `PlatformHeader.tsx` L201/218/251-253 (inline comment), `AppShell.tsx` | keep 44px tap-target + "wrap the whole subtree" | trim | 7 / 660 M |
| `services/xstockstrat-indicators/CLAUDE.md` L128-134 — lockdown order (eager import → setuid → NO_NEW_PRIVS → …) | `sandbox.py#_SANDBOX_WRAPPER` (commented; L280 "Import before RLIMIT_NPROC") |  | trim to "order is load-bearing; see `_SANDBOX_WRAPPER`" | 7 / 652 M |
| `services/xstockstrat-config/CLAUDE.md` L132-134 — DATABASE_CA_CERT / boot behaviour; narrated comment | `src/dbTls.ts`, `src/index.ts` L16-24 |  | trim | 3 / 630 M |
| `services/xstockstrat-trading/CLAUDE.md` L274-277 — heartbeat / watchdog log strings | `syncPositions` source |  | trim | 4 / 614 M |
| `services/xstockstrat-marketdata/docs/context-constitution.md` L46 — EDGAR Accept-Encoding | `internal/edgar/edgar_client.go` carries "Never set Accept-Encoding here" above `c.hc.Do(req)` |  | remove | 1 / 597 M |
| `services/xstockstrat-config/CLAUDE.md` L19-28 — Ports table; "former Connect-RPC on 8060 removed" | root Service Registry; `Dockerfile` L33 |  | trim to the RPC list | 10 / 595 M |
| `services/xstockstrat-marketdata/docs/context-constitution.md` L44 — `4c91465` int32 fix | `internal/repository/pool.go` already uses `strconv.ParseInt(v, 10, 32)` | keep only "other services may do the same" or fold into root | remove | 1 / 517 M |
| `services/xstockstrat-indicators/docs/context-constitution.md` L27 — INDICATORS-10 | `sandbox.py` L280 comment "Import before RLIMIT_NPROC…" |  | remove | 1 / 477 M |
| `services/xstockstrat-identity/CLAUDE.md` L86, L89-92 — env source prose and values | `docker-compose.yml` L193-198; `.env.example` | keep the L94 `DATABASE_CA_CERT` note | trim | 5 / 459 M |
| `services/xstockstrat-config/CLAUDE.md` L85-89 — audit trigger structure | `migrations/010_config_audit_insert_trigger.up.sql`, `001_config_tables.up.sql` |  | remove | 5 / 371 M |
| `services/xstockstrat-indicators/CLAUDE.md` L11-13 — ATR/VWAP approximation caveat | `indicators_engine.py` `_atr`, `_vwap` descriptions L146-153 |  | remove the parenthetical | 3 / 334 M |
| `services/xstockstrat-indicators/CLAUDE.md` L208-215 — env list incl. dev `devpassword` DATABASE_URL | `docker-compose.yml`; `.do/app.yaml` |  | trim to non-compose vars | 8 / 320 M |
| `services/xstockstrat-ledger/CLAUDE.md` L25-28 — RPC list (omits `ExportEvents`); "former HTTP server removed" | `src/index.ts#addService`; `ledgerServiceImpl.ts#exportEvents` |  | trim to "gRPC-only, 50057" | 4 / 292 M |
| `services/xstockstrat-analysis/CLAUDE.md` L609-616 — standard test commands | root Language table; `pyproject.toml` | keep the `real_pg`/`XSTOCKSTRAT_PG_BIN` note | trim L611-616 | 8 / 255 M |
| `services/xstockstrat-ingest/CLAUDE.md` L112, L118 — migration filenames | `migrations/003…005` |  | remove | 2 / 163 M |
| `services/xstockstrat-ledger/CLAUDE.md` L102, L106 — hypertable / chunk interval; NOTIFY channel | `migrations/001_ledger_events_hypertable.up.sql` |  | remove | 2 / 161 M |
| `services/xstockstrat-identity/CLAUDE.md` L101-107 — Running Locally | `package.json` scripts; root § Database |  | remove | 7 / 153 M |
| `services/xstockstrat-trading/CLAUDE.md` L296-301 — `go mod download; go run ./cmd/server` | root Repository Bootstrap |  | remove | 6 / 68 M |
| `services/xstockstrat-identity/docs/context-constitution.md` L20 — IDENTITY-3 raw `code: N` house style | visible in every handler of `identityServiceImpl.ts` | keep the `authz.ts`/`adminDirectory.ts` exceptions | trim | 1 / 1,386 L |
| `CLAUDE.md` L420 — skills one-liner | `.claude/skills/*/SKILL.md` descriptions (auto-listed) | keep the batch-gates pointer | trim | 1 / 730 L |
| `services/xstockstrat-ingest/docs/context-constitution.md` L27 — INGEST-8 | `mcp_client_loop.py#run_mcp_client_loop` loop body |  | trim to one sentence | 1 / 604 L |
| `services/xstockstrat-notify/CLAUDE.md` L25-30 — RPC list; "former HTTP 8059 / src/connect removed" | `src/index.ts` service def |  | trim | 6 / 504 L |
| `services/xstockstrat-agent/CLAUDE.md` L201-205 — `_CONFIG_READ_TIMEOUT_S` = 3.0 s | `app/client.py` L35 | keep the sentence (constitution cites the section); drop the value | trim | 5 / 454 L |
| `services/xstockstrat-ingest/CLAUDE.md` L147-156 — event table (already omits `ingest.backfill.canceled`) | `servicer.py` event_type literals L431/507/530/567/922/1145 |  | remove, or add the missing event | 10 / 429 L |
| `CLAUDE.md` L49-54 — root-owns bullets | directory tree + L56 |  | trim | 6 / 374 L |
| `CLAUDE.md` L278 — frontend-auth file list | `src/lib/auth.ts`, `src/middleware.ts`; L280 already points at the pattern doc |  | trim | 1 / 366 L |
| `services/xstockstrat-notify/CLAUDE.md` L34-36, L41 — synchronous fan-out, persisted alerts, subscriber matching | `notifyServiceImpl.ts#emitAlert`, `#matchesSubscriber` |  | remove | 4 / 312 L |
| `services/xstockstrat-indicators/CLAUDE.md` L217-230 — Running Locally | `pyproject.toml`; root Language table, CI thresholds |  | remove; keep one test line | 14 / 262 L |

## Cross-file duplication — CF-N3

Keeper direction is decided per row: the root wins for root facts, a constitution wins for an invariant it states with a *why*, a service `CLAUDE.md` wins where it is the nearest file to the edit.

| Context line | Duplicate location(s) | Which copy to keep | Suggested action | Lines / chars · conf |
|---|---|---|---|---|
| `services/xstockstrat-agent/CLAUDE.md` L52-98 — 45-row MCP tool table (mostly `feature NNN` history + parameter detail) | `docs/runbooks/mcp-tools.md` has all 45 tool names as `###` sections (checked 1:1) with parameter tables, return shapes and errors; `app/tools.py` registers the same 45 `@tool`s | runbook | keep "45 tools, see runbook" + at most a name→one-clause index (≈7.9k chars today) | 47 / 7,895 H |
| `services/xstockstrat-trading/CLAUDE.md` L281<br>`services/xstockstrat-portfolio/CLAUDE.md` L179<br>`services/xstockstrat-marketdata/CLAUDE.md` L237<br>`services/xstockstrat-indicators/CLAUDE.md` L206<br>`services/xstockstrat-ingest/CLAUDE.md` L168<br>`services/xstockstrat-config/CLAUDE.md` L127<br>`services/xstockstrat-ledger/CLAUDE.md` L123<br>`services/xstockstrat-notify/CLAUDE.md` L112<br>`services/xstockstrat-agent/CLAUDE.md` L220<br>`services/xstockstrat-ui/CLAUDE.md` L280<br>`services/xstockstrat-identity/CLAUDE.md` L84 — inter-service mTLS paragraph / banner (feature 210) | root `CLAUDE.md#Environment Variable Naming Convention` (the mTLS bullet) and `docs/patterns/inter-service-mtls.md` | root | keep one pointer sentence per service; remove the copy | 11 / 5,369 H |
| `services/xstockstrat-marketdata/CLAUDE.md` L19, L59-62, L195-201, L239 — vendor credentials via `GetSecret`, env vars removed (5×) | root `CLAUDE.md#Environment Variable Naming Convention` | root; keep only L223 (SAN/boot-WARN detail) | delete the rest | 13 / 2,539 H |
| `services/xstockstrat-marketdata/CLAUDE.md` L17<br>`services/xstockstrat-marketdata/CLAUDE.md` L220 — timeframe vocabulary; streamed 1m bars not persisted | marketdata constitution MARKETDATA-1, -2 | constitution | trim to a pointer | 2 / 2,411 H |
| `packages/proto/docs/context-constitution.md` L37 — deprecated-`user_id` inventory | root PLAT-11 (L49) | PLAT-11 | trim to the delta (wider list + `SnapshotOfflinePositions` conflict) | 1 / 2,119 H |
| `services/xstockstrat-portfolio/CLAUDE.md` L123-124 — empty-snapshot delete guard; `boundedRetry` retry/park | portfolio constitution PORTFOLIO-10, PORTFOLIO-3 | constitution | trim; keep the event-to-effect mapping | 2 / 2,029 H |
| `services/xstockstrat-analysis/CLAUDE.md` L394-415 — feature-200 operand routing, two channels, gate, XOR | `docs/context-constitution.md#ANALYSIS-12`, `#ANALYSIS-10` | constitution | trim | 22 / 2,016 H |
| `services/xstockstrat-portfolio/docs/context-constitution.md` L22 — PORTFOLIO-3 retry/park tail | portfolio CLAUDE "Ledger Events Consumed" rows (identical feature-256 `boundedRetry` contract) | CLAUDE rows | trim to a pointer; keep cursor-withholding and `ackAlways` | 1 / 1,880 H |
| `services/xstockstrat-config/CLAUDE.md` L43, L122 — AES-256-GCM / `value_encrypted` / `GetSecret` / per-user secrets | root `CLAUDE.md#Config Governance Rules`; config constitution Gotcha L35 (grants) | root | trim to the unique parts | 2 / 1,879 H |
| `services/xstockstrat-agent/docs/context-constitution.md` L21 — AGENT-4 mechanism + PR #994 history | agent CLAUDE Role paragraph (`CallerPropagationMiddleware`) | one side | trim AGENT-4 to the invariant | 1 / 1,797 H |
| `services/xstockstrat-trading/CLAUDE.md` L25 — `bracket_orders_enabled` history (features 030/189/192) | same file L116 (config row) | L116 | trim L25 to the mechanism; drop history | 1 / 1,783 H |
| `services/xstockstrat-portfolio/docs/context-constitution.md` L29 — PORTFOLIO-10 | portfolio CLAUDE `account.positions.synced` row (empty-snapshot delete guard) | CLAUDE | trim to the offline-producer landmine | 1 / 1,765 H |
| `CLAUDE.md` L176 — ~2.4k-char secrets-mechanism paragraph (AES-256-GCM, `value_encrypted`, `GetSecret`, `peerSan`, feature 224, `secret.*`) | `docs/patterns/config-governance.md` (AES-256-GCM ×3, `value_encrypted` ×3, `GetSecret` ×14, `peerSan` ×1) | config-governance | trim to a 2-3 sentence rule (naming, scope, "secrets are `is_secret` rows, never env vars") + the pointer already at L178/L180 | 1 / 1,724 H |
| `services/xstockstrat-portfolio/docs/context-constitution.md` L34 — PORTFOLIO-16 | portfolio CLAUDE "Quote-dependent reads…"; root PLAT-13 | CLAUDE/PLAT-13 | trim to the per-path `!ok` asymmetry and "don't unify" | 1 / 1,557 H |
| `services/xstockstrat-marketdata/docs/context-constitution.md` L18 — MARKETDATA-2 | marketdata CLAUDE "Timeframe vocabulary", "Alpaca Integration" | CLAUDE | trim to "don't make the stream path InsertBars" | 1 / 1,518 H |
| `services/xstockstrat-analysis/CLAUDE.md` L245, L585 — semaphore separation (materializer vs interactive) | `docs/context-constitution.md#ANALYSIS-8` | constitution | trim the cells to key semantics | 2 / 1,509 H |
| `services/xstockstrat-portfolio/CLAUDE.md` L24-33 — quote-bounded reads, `classifyGetPnLError`, `latestQuotesFor` | portfolio constitution PORTFOLIO-16 | constitution | trim to a pointer | 10 / 1,450 H |
| `services/xstockstrat-config/CLAUDE.md` L9, L33, L34 — env × global/per-user scope model; `trading_mode` removed | root `CLAUDE.md#Config Governance Rules` | root | keep the ENVIRONMENT_DEV→staging mapping (also CONFIG-3) | 3 / 1,395 H |
| `services/xstockstrat-portfolio/docs/context-constitution.md` L27 — PORTFOLIO-8 | portfolio CLAUDE "Cross-user watchlist enumeration & first authz gate" | one copy | trim to the "future gated RPCs follow this mechanism" convention | 1 / 1,297 H |
| `services/xstockstrat-marketdata/CLAUDE.md` L226 — `GetBars` dual-mode, live-fallback → persist → re-read | marketdata constitution MARKETDATA-8, -3 | constitution | trim | 1 / 1,229 H |
| `services/xstockstrat-marketdata/docs/context-constitution.md` L24 — MARKETDATA-8 | CLAUDE `GetBars` bullet | CLAUDE | trim to "never run the staleness refetch on explicit-start reads" | 1 / 1,214 H |
| `services/xstockstrat-ui/CLAUDE.md` L306-317 — Frontend gotchas (basePath, Suspense, Radix, matcher) | `docs/patterns/nextjs-frontends.md` (40 hits); `frontend-auth.md` L31 | nextjs-frontends | trim to the pointer | 12 / 1,211 H |
| `services/xstockstrat-agent/docs/context-constitution.md` L19 — AGENT-3 (`_caller_access_scope`, feature 092 removal) | agent CLAUDE § Management-tool authorization | one side | trim to the single directive | 1 / 1,183 H |
| `services/xstockstrat-trading/docs/context-constitution.md` L37 — cancel-detached emits gotcha | root PLAT-N1 (rule, poller-ctx exception, same sync-emit sites) | PLAT-N1 | remove | 1 / 1,139 H |
| `services/xstockstrat-identity/CLAUDE.md` L55-68 — migration list (omits `006_user_metadata`); seed-admin block | identity constitution L37; identity findings L39-46; `migrations/` | constitution | trim to a pointer | 14 / 1,098 H |
| `services/xstockstrat-config/docs/context-constitution.md` L34 — gotcha that says "Already documented in this service's own CLAUDE.md item 7" | config CLAUDE Invariant #7; root PLAT-9 | CLAUDE | remove (self-admitted duplicate) | 1 / 1,085 H |
| `services/xstockstrat-config/docs/context-constitution.md` L35 — `marketdata`/`ingest` grants, `peerSan`, `keyPrefixes` | config CLAUDE Invariant #6; C-K:51 | CLAUDE | trim to "exact `keys` can't enumerate `mcp_credential.<uuid>` → fails closed" | 1 / 1,004 H |
| `services/xstockstrat-analysis/CLAUDE.md` L468-479 — EXTEND-215 fundamentals-guard invariant (`fetch_all_for_fingerprint`, `_exclude_refused_cells`) | `docs/context-constitution.md#ANALYSIS-3` | constitution | trim to a pointer | 12 / 988 H |
| `services/xstockstrat-trading/docs/context-constitution.md` L31 — TRADING-N1 (SUPERSEDED) with an Evidence cell of ~L numbers | root PLAT-11; trading CLAUDE caller-identity section | PLAT-11 | trim to "ID retired; see PLAT-11" | 1 / 957 H |
| `services/xstockstrat-indicators/docs/context-constitution.md` L26 — INDICATORS-9 defect half ("finally killpg is a no-op") | indicators findings L44 (near-verbatim) | findings | trim the rule to the load-bearing `start_new_session`+`killpg`; point to findings | 1 / 956 H |
| `services/xstockstrat-notify/docs/context-constitution.md` L17 — NOTIFY-3 | notify CLAUDE Config Keys | CLAUDE | trim to "waitForSnapshot is a startup gate only" | 1 / 949 H |
| `services/xstockstrat-agent/CLAUDE.md` L169-178 — `set_config` can write `is_secret`; per-user secrets; `secret.*` retired | root `CLAUDE.md#Config Governance Rules`; runbook `### set_config` | root | trim | 10 / 924 H |
| `services/xstockstrat-indicators/docs/context-constitution.md` L22 — INDICATORS-5 | CLAUDE bullets Identity gate / Reads / Admin audited / SAN-bound grants; root PLAT-5 | CLAUDE | trim to "no interceptor; per-method `invocation_metadata()`" | 1 / 919 H |
| `services/xstockstrat-portfolio/CLAUDE.md` L58-66 — ListAllWatchlistSymbols and first authz gate (feature 154) | portfolio constitution PORTFOLIO-8 | constitution | trim to one line | 9 / 885 H |
| `services/xstockstrat-trading/docs/context-constitution-findings.md` L17, L24 — `max_retries`/`retry_delay_ms` "only `flattenAndHalt` reads" (3×) | same file L14 | L14 | merge into L14 | 2 / 877 H |
| `services/xstockstrat-trading/docs/context-constitution.md` L40 — SEV-1 scar (`NewWatcher`, commit `1413399`) | root PLAT-8 + root gotcha L66 | PLAT-8 | trim to a pointer + the trading-specific `bracket_orders_enabled` example | 1 / 857 H |
| `services/xstockstrat-indicators/docs/context-constitution.md` L19 — INDICATORS-2 | CLAUDE "Expanded rlimits" restates and points here | constitution (richer why) | shrink the CLAUDE bullet instead | 1 / 838 H |
| `services/xstockstrat-indicators/docs/context-constitution.md` L24 — INDICATORS-7 (seccomp) | CLAUDE seccomp allowlist bullet + lockdown-order paragraph | CLAUDE | trim to a pointer | 1 / 809 H |
| `services/xstockstrat-notify/docs/context-constitution.md` L21 — NOTIFY-7 | notify CLAUDE Key Design bullet (near word-for-word) | NOTIFY-7 | trim to the contrast with NOTIFY-5 | 1 / 797 H |
| `docs/roadmap/features/CLAUDE.md` L3-7, L145 — feature-number allocation rule (`sdd-allocate-feature-number.sh`, `sdd/feature-cursor`) | root `CLAUDE.md#Feature Roadmap` | root | keep one pointer to `feature-workflow.md § Feature Numbering` | 6 / 783 H |
| `services/xstockstrat-notify/docs/context-constitution.md` L30-31 — backpressure + severities-type gotchas (defects) | notify findings L34, L23 | findings | route to findings; remove from the constitution | 2 / 772 H |
| `services/xstockstrat-portfolio/docs/context-constitution-findings.md` L42 — restart-replay double-count question | same file L43 (confirmed) | L43 | merge into one | 1 / 744 H |
| `services/xstockstrat-marketdata/docs/context-constitution.md` L29 — MARKETDATA-13 | CLAUDE "Derivation versioning (feature 223)" | CLAUDE | remove | 1 / 739 H |
| `services/xstockstrat-notify/docs/context-constitution.md` L16 — NOTIFY-1 ("Instance of root PLAT-F1/PLAT-2") | root PLAT-F1/PLAT-2 (same evidence, PR #698); the row names itself an instance | root | remove or reduce to a pointer | 1 / 715 H |
| `services/xstockstrat-portfolio/docs/context-constitution.md` L40 — SEV-1 scar | root PLAT-8 | PLAT-8 | remove or one pointer line | 1 / 671 H |
| `services/xstockstrat-config/docs/context-constitution.md` L32 — Python/Node zero-honouring gotcha ("Root gotcha; CF-N10 resolved by feature 244") | root L65 | root | remove | 1 / 652 H |
| `CLAUDE.md` L442-444<br>`CLAUDE.md` L465-469 — Key File Paths rows repeating docs/patterns and docs/runbooks pointers | Context Guide rows L66, L68, L70, L80, L85, L89 | Context Guide | remove the duplicate rows | 8 / 644 H |
| `services/xstockstrat-agent/docs/context-constitution.md` L23 — AGENT-6 | agent CLAUDE Env block + OAuth section; root env-naming bullet | root | trim to "rotate with the dual role in mind", or remove | 1 / 640 H |
| `services/xstockstrat-ledger/docs/context-constitution.md` L30 — RESOLVED NOTIFY-trim gotcha | ledger CLAUDE Live Streaming; LEDGER-2/-8; findings L22/L41 | findings | remove; history stays in findings | 1 / 627 H |
| `services/xstockstrat-indicators/docs/context-constitution.md` L34 — seed formula id gotcha | CLAUDE "Seeded Formulas" (UUIDv5, `analysis.fundsignal.scoring_formula_id`) | CLAUDE | remove | 1 / 615 H |
| `services/xstockstrat-indicators/CLAUDE.md` L94 — pool size / PgBouncer behaviour | `app/main.py` L54-57; root `CLAUDE.md#Connection Pool Budget`; `docs/patterns/database.md` | root | remove or one line | 1 / 608 H |
| `services/xstockstrat-config/docs/context-constitution.md` L19 — CONFIG-2 (restates PLAT-6; says "(Root PLAT-6.)") | root PLAT-6 | PLAT-6 | remove, or keep only the `buildConfigValue` redaction note | 1 / 602 H |
| `services/xstockstrat-config/CLAUDE.md` L117-123 — second "Config Governance" summary | root `CLAUDE.md#Config Governance Rules`; `docs/patterns/config-governance.md` | root | remove | 7 / 599 H |
| `services/xstockstrat-indicators/docs/context-constitution.md` L23 — INDICATORS-6 ("no `USER` line") | indicators CLAUDE "Docker Build Pattern" + "Distinct UID" | CLAUDE | remove or fold the why into one line | 1 / 573 H |
| `services/xstockstrat-analysis/docs/context-constitution.md` L41 — "Python config getters honour a stored 0" | root L65 gotcha (evidence already cites analysis `watcher.py#get_int`, `#int_positive`) | root | remove, or trim to the AST-guard sentence | 1 / 571 H |
| `services/xstockstrat-agent/CLAUDE.md` L133-138 — `score` trailer contract; "a second trailer contract would justify a PLAT row" | runbook L601; `app/client.py#_EXCLUDED_TRAILER_KEY` comment | runbook | remove | 6 / 569 H |
| `services/xstockstrat-analysis/CLAUDE.md` L94, L118, L179, L220, L224 — "no new pool, budget stays 2" (5×) | root `CLAUDE.md#Connection Pool Budget` | root | keep one | 5 / 562 H |
| `services/xstockstrat-portfolio/CLAUDE.md` L121 — `positionsMu` / `instance_count: 1` | portfolio constitution PORTFOLIO-14 | constitution | remove sentence | 1 / 560 H |
| `services/xstockstrat-marketdata/CLAUDE.md` L203-208 — derivation versioning (feature 223) | marketdata constitution MARKETDATA-13 | constitution | remove | 6 / 516 H |
| `services/xstockstrat-marketdata/docs/context-constitution.md` L43 — SEV-1 scar | root PLAT-8 | PLAT-8 | remove | 1 / 505 H |
| `services/xstockstrat-analysis/CLAUDE.md` L626 — analysis mTLS note | root `CLAUDE.md#Environment Variable Naming Convention` (mTLS bullet) | root | reduce to one line "see root" | 1 / 481 H |
| `services/xstockstrat-marketdata/docs/context-constitution.md` L21 — MARKETDATA-5 | CLAUDE config rows `warm_interval_ms`, `bar_ingest_interval_ms` | rows | remove | 1 / 452 H |
| `docs/context-constitution.md` L40 — PLAT-2 | PLAT-F1 at L32 (same anchors, same Why) | PLAT-F1 | remove | 1 / 429 H |
| `services/xstockstrat-analysis/docs/context-constitution.md` L44 — `63a3655` story | ANALYSIS-7 Why; report `2026-08-07-disabled-strategies-usable` | ANALYSIS-7 | remove | 1 / 427 H |
| `docs/roadmap/CLAUDE.md` L5, L12 — "All phases (0–7) are DONE" | root `CLAUDE.md#Implementation Roadmap Status` (and again within this file) | root | trim to the table only | 2 / 423 H |
| `services/xstockstrat-indicators/docs/context-constitution.md` L25 — INDICATORS-8 | CLAUDE: "`NO_NEW_PRIVS` must stay set (pyseccomp sets it on load — never disable)" (verbatim) | CLAUDE | remove | 1 / 398 H |
| `packages/proto/docs/context-constitution.md` L33 — #901 bug and fix | PROTO-5 (L23) | PROTO-5 | remove | 1 / 391 H |
| `services/xstockstrat-trading/CLAUDE.md` L236-239 — `halted_poll_interval_ms` | same file L122 | L122 | trim one | 4 / 387 H |
| `packages/proto/CLAUDE.md` L7-10 — proto governance + "never Read/Grep `gen/`" | root `CLAUDE.md#Proto Contract Governance` and Key File Paths | root | remove | 4 / 386 H |
| `docs/roadmap/features/CLAUDE.md` L143 — rule 4 (status SSOT) | same file L46 and L84-86 | L84-86 | trim | 1 / 360 H |
| `docs/roadmap/features/CLAUDE.md` L32-38 — bug fields `Type`/`Severity`/`GitHub Issue` listed twice | same file L101-105 | L101-105 | remove this copy | 7 / 333 H |
| `docs/roadmap/CLAUDE.md` L22-26 — Institutional Ledger section | `docs/roadmap/ledger/CLAUDE.md` L3-17; root Context Guide row | ledger CLAUDE.md | leave a one-line link | 5 / 330 H |
| `docs/context-constitution.md` L75 — candidate rule | identical candidate in the proto constitution L45 | root | remove the proto copy | 1 / 323 H |
| `docs/roadmap/features/CLAUDE.md` L137, L141 — rules 1 and 3: "Read context.md first", "Run /sdd-status" | root `CLAUDE.md#Feature Roadmap` (verbatim) | root | remove | 2 / 306 H |
| `services/xstockstrat-indicators/docs/context-constitution.md` L35 — declared outputs gotcha | CLAUDE "Declared Formula Outputs" (verbatim) | CLAUDE | remove | 1 / 289 H |
| `docs/roadmap/ledger/CLAUDE.md` L15-17 — who-writes-what restated | same file L9-10 ("Written by" column) | L9-10 | remove | 3 / 284 H |
| `services/xstockstrat-marketdata/docs/context-constitution-findings.md` L39 — `fmp.getJSON` "never include the URL" question (asked twice) | same file L38 | L38 | delete the duplicate half | 1 / 277 H |
| `CLAUDE.md` L434-437 — Key File Paths service-language groupings | Service Registry L108-119 (language column) | Service Registry | remove | 4 / 271 H |
| `services/xstockstrat-analysis/docs/context-constitution.md` L43 — SEV-1 scar behind PLAT-8 (hotfix #891, `d7d185f`) | root L66 | root | remove | 1 / 230 H |
| `services/xstockstrat-marketdata/CLAUDE.md` L224 — feed / adjustment parameter defaulting | same file config rows L64-65; constitution Gotcha "Belt-and-suspenders param defaulting" | rows | remove | 1 / 222 H |
| `CLAUDE.md` L71-72 — two Context Guide rows pointing at the same `docker-build.md` | same file | merge | merge the rows | 2 / 198 H |
| `services/xstockstrat-analysis/docs/context-constitution.md` L39 — pointer-only row ("see CLAUDE.md") for `analysis.strategy.scored` | analysis CLAUDE § Ledger Events Emitted already states the scoping | CLAUDE | remove | 1 / 167 H |
| `services/xstockstrat-marketdata/CLAUDE.md` L221 — all REST via a shared limiter and central auth headers | marketdata constitution MARKETDATA-4 | constitution | remove | 1 / 133 H |
| `services/xstockstrat-analysis/CLAUDE.md` L515-589 — Config Keys narrative columns | `docs/patterns/config-governance.md` per-feature registered-keys log | governance doc | shorten descriptions to ≤1 line; keep key/type/default | 75 / 24,082 M |
| `services/xstockstrat-analysis/CLAUDE.md` L530-535, L561, L568 — "A configured `0` is honoured" repeated per row | constitution Gotcha ("a stored 0 is honoured by every getter…") | constitution | keep only the exceptions | 8 / 3,530 M |
| `docs/runbooks/CLAUDE.md` L7-21 — index rows copied from the root Context Guide | root `CLAUDE.md#Context Guide` | root | trim to the rows root lacks (`inter-service-mtls-rollout`, `infra-cost-reduction`, `reviewer-registry`) | 15 / 3,222 M |
| `services/xstockstrat-analysis/CLAUDE.md` L45-47, L133, L174-176, L570-572 — system-identity grant story (feature 224) | root `CLAUDE.md#Header Propagation Convention`; this file L70-78 (keeper) | L70-78 | trim to pointers | 10 / 2,619 M |
| `services/xstockstrat-trading/CLAUDE.md` L31-47<br>`services/xstockstrat-portfolio/CLAUDE.md` L13-22 — caller identity from the `x-user-id` header; body `user_id` deprecated | root `docs/context-constitution.md#PLAT-11`; TRADING-N1 says it is "fully stated in CLAUDE.md" | PLAT-11 | trim to the unique parts (trading: per-RPC ownership list C-1/C-2/H-2) | 27 / 2,565 M |
| `services/xstockstrat-marketdata/CLAUDE.md` L225 — windowed quote cache, `cacheQuote` | marketdata constitution MARKETDATA-14 + config rows L73-76 | constitution/rows | trim to what the rows do not say | 1 / 2,478 M |
| `services/xstockstrat-indicators/CLAUDE.md` L136-160 — sandbox bullets (threads pinned, RLIMIT_DATA, distinct UID, seccomp allowlist, NO_NEW_PRIVS, killpg) | indicators constitution INDICATORS-1, -2, -6, -7, -8, -9 (each with why + evidence) | constitution | trim to a short overview + pointer (keep secret-free env and builtin filter) | 25 / 2,281 M |
| `docs/patterns/CLAUDE.md` L5-19 — index rows copied from root Context Guide (frontend-auth, nextjs-frontends, ui-ux-governance, nginx, header-propagation, docker-build, config-*, database, observability, ci-overview, context-engineering, test-data-inventory) | root `CLAUDE.md#Context Guide` | root | trim to the rows root lacks (`client-api-pattern`, `inter-service-mtls`, `dry-guard-rail`, `strat-lab-plugin`) | 15 / 2,106 M |
| `packages/proto/docs/context-constitution.md` L27 — PROTO-9 with an embedded defect clause | proto findings L11 | findings | remove the clause here | 1 / 2,043 M |
| `CLAUDE.md` L375-382<br>`CLAUDE.md` L408-412 — feature-directory file inventory and the status-SSOT prose | `docs/roadmap/features/CLAUDE.md` L11, L46, L55 | features CLAUDE.md | keep the numbering rule (L375) and the Mandatory Entry Point; trim the rest to a pointer | 13 / 1,922 M |
| `services/xstockstrat-ui/docs/context-constitution.md` L25, L30 — UI-5 and UI-10 deviants (`ledger/export` inline headers, unwrapped audit route) | ui findings L26-27 | findings | keep the rule here; deviant detail in findings only | 2 / 1,900 M |
| `services/xstockstrat-config/docs/context-constitution.md` L26 — CONFIG-9 bare-vs-dotted consequence + per-migration inventory | root PLAT-14; `scripts/config-wiring.json` | PLAT-14 | keep "seed `key` = reader's literal getter string"; drop the inventory | 1 / 1,823 M |
| `docs/context-constitution.md` L42 — PLAT-4 (Node-leaf propagation, features 175/224) | root `CLAUDE.md#Header Propagation Convention` (near-identical long paragraph) | PLAT-4 | trim the CLAUDE.md paragraph to a pointer (that file is outside this row) | 1 / 1,763 M |
| `services/xstockstrat-analysis/docs/context-constitution.md` L24 — ANALYSIS-8 semaphore split (3× in CLAUDE + here) | analysis CLAUDE Decide-surface + config rows | one side | drop the config-row restatement or this | 1 / 1,611 M |
| `services/xstockstrat-portfolio/docs/context-constitution.md` L30 — PORTFOLIO-11 parenthetical | portfolio CLAUDE "Offline valuation" | CLAUDE | trim | 1 / 1,559 M |
| `services/xstockstrat-agent/CLAUDE.md` L115-131 — admin-gated user tools; `manage_strategy` ownership gating | agent constitution Gotchas L31; `app/tools.py#_require_admin`; runbook `### manage_user`/`### manage_strategy` | constitution/runbook | trim | 17 / 1,534 M |
| `services/xstockstrat-notify/CLAUDE.md` L86-100 — Web Push paragraph (admin-only audience, uncached lookup, VAPID disable-once, severity gate) | notify constitution NOTIFY-8, -5/-6, Gotchas L27-28; root PLAT-4 | constitution | trim to mechanism pointer + config key | 15 / 1,533 M |
| `services/xstockstrat-analysis/docs/context-constitution.md` L23 — ANALYSIS-7 "import cycle justification does not hold" narrative | analysis findings L31 + report `2026-10-19-analysis-live-gate-sql-duplicated-defect` | findings | trim to "see findings"; keep rule + 4-site list | 1 / 1,436 M |
| `docs/roadmap/features/CLAUDE.md` L116-131 — SDD Skills table | root `CLAUDE.md#Feature Roadmap` skill list + each `.claude/skills/*/SKILL.md` description | root | remove (point to root) | 16 / 1,304 M |
| `services/xstockstrat-trading/docs/context-constitution.md` L20 — TRADING-2 enum-to-string half | root PLAT-F1 | PLAT-F1 | trim to "see PLAT-F1"; keep the 0→NULL / `UpsertOrder` / TIF parts | 1 / 1,272 M |
| `services/xstockstrat-ledger/docs/context-constitution.md` L20 — LEDGER-3 consumer enumeration (already re-grounded 3→5) | ledger CLAUDE lists the "five" portfolio subscriptions + analysis stream | CLAUDE | keep "resume from last sequence, don't treat stream end as terminal" | 1 / 1,256 M |
| `services/xstockstrat-portfolio/docs/context-constitution.md` L20 — PORTFOLIO-1 last clause | PORTFOLIO-17 (L35); CLAUDE "Offline valuation" | L35 | drop the clause | 1 / 1,251 M |
| `services/xstockstrat-portfolio/CLAUDE.md` L35-46 — offline valuation, `valueRead`, source discriminator | portfolio constitution PORTFOLIO-1/-11/-17 | constitution | trim | 12 / 1,245 M |
| `services/xstockstrat-ingest/docs/context-constitution.md` L28 — INGEST-9 (3rd statement of bare vs full-dotted) | root PLAT-14; CONFIG-9 | PLAT-14 | trim Evidence; keep "getters do no namespace auto-prefix" | 1 / 1,228 M |
| `services/xstockstrat-ui/CLAUDE.md` L243-258 — browser typed clients / transport factory | UI-2 in the UI constitution; `browserClients/transport.ts#makeBrowserTransport` | constitution | keep the single rule "add clients via `makeBrowserTransport`" | 16 / 1,214 M |
| `services/xstockstrat-identity/docs/context-constitution.md` L29 — IDENTITY-12 Rule text | identity CLAUDE Ports; `adminDirectory.ts` L1-2 | CLAUDE | trim the Rule to the Why | 1 / 1,049 M |
| `services/xstockstrat-notify/docs/context-constitution.md` L27-28 — severity-only gate; VAPID gotcha | notify CLAUDE Web Push paragraph | CLAUDE | keep the fanout-conviction contrast and "don't simplify the subject regex" | 2 / 1,047 M |
| `services/xstockstrat-notify/docs/context-constitution.md` L22 — NOTIFY-8 mechanism | notify CLAUDE Web Push paragraph | constitution (prohibitions) | trim to the prohibitions | 1 / 964 M |
| `services/xstockstrat-marketdata/docs/context-constitution.md` L23 — MARKETDATA-7 vestigial `tradingMode` sentence | marketdata findings L33; root PLAT-8 | findings | drop the sentence | 1 / 933 M |
| `docs/patterns/ui-ux-governance.md` L67-75, L156-157 — `apply --preset` clobbers variants; `data-active` fix; regression guards | `services/xstockstrat-ui/CLAUDE.md#Styling` L38-64 (near-verbatim). Two auditors named opposite keepers; ruling: the UI CLAUDE.md is the operational home at the edit site | UI CLAUDE.md | trim the governance copy to the rule + pointer | 11 / 922 M |
| `services/xstockstrat-portfolio/docs/context-constitution.md` L33 — PORTFOLIO-14 | portfolio CLAUDE `order.filled` row | CLAUDE | trim to "any NEW writer of positions must take `positionsMu`" + guard test | 1 / 911 M |
| `services/xstockstrat-marketdata/docs/context-constitution.md` L28 — MARKETDATA-12 | CLAUDE rows `fmp.daily_request_cap`, `fmp.enabled` | rows | trim to "never construct a 2nd `fmp.NewClient`" | 1 / 905 M |
| `services/xstockstrat-agent/CLAUDE.md` L140-149 — watchlist tools; read-modify-write merge | runbook `### manage_watchlist`; tool table row | runbook | trim | 10 / 884 M |
| `services/xstockstrat-ingest/CLAUDE.md` L137-145 — `SECRET_CALLER_ALLOWLIST`, `keyPrefixes`, `peerSan` grant sentence | config constitution Gotcha L35 + Pointers L51; config CLAUDE.md L43; INGEST-7 | config constitution | trim the grant sentence; keep the writer-side flow | 9 / 877 M |
| `services/xstockstrat-identity/docs/context-constitution-findings.md` L38-46 — Resolved (2026-09-16 audit) narrative | identity CLAUDE § Database (`002_seed_admin`, `isBlockedDefaultAdmin`, H-4) | CLAUDE | trim to a 1-line resolved entry | 9 / 863 M |
| `services/xstockstrat-trading/docs/context-constitution.md` L39 — AdminScope parity gotcha | root PLAT-5 | PLAT-5 | trim to the agent pre-check and the site list | 1 / 861 M |
| `services/xstockstrat-ledger/CLAUDE.md` L51-59 — portfolio subscriptions / analysis stream; "old design froze" | ledger constitution LEDGER-3 | constitution | trim to the heuristic (query pool=1 + 1 dedicated LISTEN conn; never hold a pooled conn for a stream's lifetime) | 9 / 834 M |
| `services/xstockstrat-ingest/docs/context-constitution-findings.md` L48 — 2026-09-03 resolved item | INGEST-9 | INGEST-9 | trim to 1 line | 1 / 819 M |
| `services/xstockstrat-ledger/docs/context-constitution.md` L19 — LEDGER-2 ordering sequence | ledger CLAUDE Live Streaming Architecture | CLAUDE | trim the sequence, keep the why | 1 / 815 M |
| `services/xstockstrat-identity/docs/context-constitution.md` L23 — IDENTITY-6 general identity-from-header rule | root PLAT-11 | PLAT-11 | trim to the legacy `listAuthorizedApps`/`revokeAuthorizedApp` contrast | 1 / 794 M |
| `services/xstockstrat-marketdata/docs/context-constitution.md` L30 — MARKETDATA-14 | CLAUDE `GetLatestQuotes` bullet, "Quote retention" | CLAUDE | trim to "never call `quoteStore.InsertQuote` directly" | 1 / 789 M |
| `services/xstockstrat-analysis/docs/context-constitution.md` L42 — "Post-147 residual" clause | analysis findings L33; root PLAT-8 | findings | trim the residual clause; keep the cross-service mirror warning | 1 / 772 M |
| `packages/proto/CLAUDE.md` L12-19 — `pnl/` carve-out; `QtyEpsilon` value | `packages/proto/pnl/pnl.go` L43; proto constitution L25 | constitution | trim | 8 / 761 M |
| `CLAUDE.md` L200-201 — removal tombstones for N8N, `MCP_AGENT_SECRET`, vendor-key env vars | `.env.example` L29-30, `docker-compose.yml` L573, `.do/app.dev.yaml` L333 | one line | trim to "vendor credentials are encrypted config rows, not env vars" | 2 / 757 M |
| `docs/patterns/ui-ux-governance.md` L248-257 — Cross-references list | the L10-18 header bullets | header | remove | 10 / 750 M |
| `docs/context-constitution.md` L66 — SEV-1 scar behind PLAT-8 | PLAT-8 (L46) already says it | PLAT-8 | keep one | 1 / 749 M |
| `services/xstockstrat-config/docs/context-constitution.md` L21 — CONFIG-4 payload shape | config CLAUDE § WatchConfig Flow / Invariant #4 | CLAUDE | trim to the wrong-scope warning + `staging` default | 1 / 740 M |
| `services/xstockstrat-agent/CLAUDE.md` L188-197 — OAuth summary (`JWT_SECRET`/`MCP_AGENT_SECRET` narrative, 3×) | AGENT-6; root env-naming bullet; AG L225 | AGENT-6 | keep the `aud` rule + `oauth.md` pointer | 10 / 737 M |
| `CLAUDE.md` L202-204 — mTLS contract paragraph inside the Env Var Naming Convention | `docs/patterns/inter-service-mtls.md` (contract, circularity, fail-closed) | pattern doc | trim to "not a connection var; see doc" | 3 / 733 M |
| `services/xstockstrat-identity/CLAUDE.md` L36-44 — OAuth backend (single-use, PKCE S256, TTL keys) | `identityServiceImpl.ts` L477-504; IDENTITY-4; config table L75-78 | code | keep "refresh token reuses `identity.refresh_tokens`" | 9 / 721 M |
| `services/xstockstrat-marketdata/CLAUDE.md` L227 — (GetBars parameter narrative) | same file rows L69-71; MARKETDATA-2 | rows | trim | 1 / 706 M |
| `services/xstockstrat-indicators/docs/context-constitution.md` L18 — INDICATORS-1 | CLAUDE "BLAS/OMP threads pinned to 1" | CLAUDE | trim; keep "before numpy import" + the OpenBLAS error | 1 / 697 M |
| `services/xstockstrat-notify/CLAUDE.md` L102-108 — "Five knobs read live", channel enablement, microtask dispatch | `fanout.ts#dispatch`; config table L79-83; NOTIFY-3 | config table | trim | 7 / 692 M |
| `services/xstockstrat-config/CLAUDE.md` L35 — LISTEN reconnect/backoff stated twice | this file L95-97; CONFIG-1 | L95-97 | trim | 1 / 691 M |
| `services/xstockstrat-ui/CLAUDE.md` L356-359 — Observability | root `CLAUDE.md#Observability`; `docs/patterns/observability.md`; UI-10 | root | keep the `src/instrumentation.ts` placement rule | 4 / 687 M |
| `services/xstockstrat-config/docs/context-constitution.md` L51 — Pointers row re-describing encryption/grants | config CLAUDE Invariant #6 | CLAUDE | trim to the link | 1 / 681 M |
| `services/xstockstrat-agent/CLAUDE.md` L44-50 — prompt and `instructions` paragraph | runbook L6-12; `app/main.py` L38 | runbook | trim to a pointer | 7 / 674 M |
| `services/xstockstrat-ledger/CLAUDE.md` L128<br>`services/xstockstrat-notify/CLAUDE.md` L120 — DATABASE_CA_CERT sentence | root constitution Pointers L92; `docs/patterns/database.md` | pattern doc | keep one fact (required unless exactly `sslmode=disable`) | 2 / 661 M |
| `packages/proto/docs/context-constitution.md` L38 — `owner_only` default (4th statement) | ledger CLAUDE L36, LEDGER-6, root findings L38 | ledger | trim to a pointer | 1 / 642 M |
| `services/xstockstrat-agent/docs/context-constitution.md` L31 — admin-gated gotcha (first clause) | agent CLAUDE user-admin section | CLAUDE | trim to the `manage_account resume` inline-check asymmetry | 1 / 642 M |
| `services/xstockstrat-indicators/docs/context-constitution.md` L29 — INDICATORS-12 | CLAUDE "Maintenance" paragraph | CLAUDE | trim to the SQL-guard fact | 1 / 638 M |
| `services/xstockstrat-ui/CLAUDE.md` L114-123 — Segments table | same file L9-13 (Role); `next.config.js` redirect | Role | trim | 10 / 619 M |
| `docs/context-constitution.md` L39 — PLAT-1 | PLAT-F2 at L33 | PLAT-F2 | merge the one delta into F2; remove | 1 / 591 M |
| `services/xstockstrat-ui/docs/context-constitution-findings.md` L26-27 — (duplicated in UI-5/UI-10) | UI constitution L25/L30 | findings | keep here | 2 / 588 M |
| `services/xstockstrat-marketdata/docs/context-constitution.md` L22 — MARKETDATA-6 `scope & 0x04` gate | root PLAT-5 | PLAT-5 | drop the gate half; keep the symbol-`$1` predicate | 1 / 583 M |
| `services/xstockstrat-config/CLAUDE.md` L79-84 — existence-gate wording | config constitution CONFIG-6 | constitution | trim to a pointer | 6 / 575 M |
| `CLAUDE.md` L248-258 — "gRPC-only, no HTTP/webhooks/80xx" (Service-to-Service Calls, incl. diagram) | same file L56, L102-104, L196 | L102-104 | remove the section | 11 / 563 M |
| `services/xstockstrat-marketdata/docs/context-constitution.md` L19 — MARKETDATA-3 cache-miss idiom | CLAUDE `GetBars` bullet | CLAUDE | remove or one line | 1 / 543 M |
| `CLAUDE.md` L286, L292 — "run `./scripts/buf-gen.sh` after proto change" (3rd and 4th statement) | same file L160 | L160 | trim L286 and the L292 clause | 2 / 539 M |
| `services/xstockstrat-identity/docs/context-constitution.md` L36 — `revokeToken` unverified-decode text | identity findings L30 | findings | trim to the `user_id` revoke sentence + findings pointer | 1 / 537 M |
| `services/xstockstrat-trading/CLAUDE.md` L43-47 — portfolio-call header injection | root `CLAUDE.md#Header Propagation Convention`; `docs/patterns/header-propagation.md` | root | trim | 5 / 534 M |
| `services/xstockstrat-ingest/CLAUDE.md` L46-52 — grant/SAN rule for `system` identity | root `CLAUDE.md#Header Propagation Convention`; `indicators/CLAUDE.md` L34-36; `servicer.py#_SYSTEM_GRANTS` | root | keep the RPC-to-grant mapping only | 7 / 511 M |
| `services/xstockstrat-ingest/CLAUDE.md` L36-40 — 1d-only backfill gate | `servicer.py` L412-414; ingest constitution Gotcha (`_STR_TO_ENUM`, `_BARS_PER_DAY`) | constitution | trim to one line | 5 / 482 M |
| `services/xstockstrat-identity/docs/context-constitution.md` L38 — DB-CHECK / `mapDbError` | IDENTITY-11 Why; `006_user_metadata.up.sql` | IDENTITY-11 | remove | 1 / 478 M |
| `services/xstockstrat-notify/CLAUDE.md` L37-40 — `alert_reads` no-FK, header-then-body fallback | notify constitution NOTIFY-7 | NOTIFY-7 | trim to one line | 4 / 472 M |
| `services/xstockstrat-analysis/docs/context-constitution.md` L37 — best-effort gotcha | analysis CLAUDE Strategy Score Persistence; root PLAT-N1 | PLAT-N1 | trim to the `ScoreStrategy` stale-grade-delete exception | 1 / 460 M |
| `docs/patterns/ui-ux-governance.md` L239 — §9 row a (icon libraries; "lucide ×26") | §6 L166-171; actual imports: tabler 10, phosphor 7, lucide 30 files | §6 | trim the row to a pointer; drop the counts | 1 / 440 M |
| `services/xstockstrat-agent/CLAUDE.md` L14-18 — transport history / `sse` alias (stated 3×) | `app/main.py#resolve_transport` docstring; AG L223-224 | code | trim | 5 / 437 M |
| `docs/context-constitution.md` L67 — "ts-proto strict path" scar | PLAT-F1/F2 Why text | F1/F2 | trim to one line | 1 / 430 M |
| `services/xstockstrat-indicators/docs/context-constitution.md` L21 — INDICATORS-4 | CLAUDE "Import whitelist + builtin filter" | CLAUDE | trim to the "never del from shared builtins" failure mode | 1 / 402 M |
| `docs/sdd/CLAUDE.md` L11 — parent-index description of the business-rules sibling | `docs/sdd/business-rules/CLAUDE.md` L1-7 | nested file | trim the parent row | 1 / 399 M |
| `services/xstockstrat-indicators/docs/context-constitution.md` L41 — candidate: stderr substring classification | indicators findings L21 (same question) | findings | remove the candidate row | 1 / 397 M |
| `services/xstockstrat-indicators/CLAUDE.md` L50 — runs as root on purpose (3rd statement) | `Dockerfile` L5-14 comments; INDICATORS-6 | INDICATORS-6 | trim to "runs as root on purpose (INDICATORS-6)" | 1 / 394 M |
| `services/xstockstrat-ledger/CLAUDE.md` L36 — `owner_only` fail-open rule | ledger LEDGER-6; proto constitution L38; root findings L38 | this file (auto-loaded invariant) | trim the copies elsewhere | 1 / 376 M |
| `services/xstockstrat-indicators/docs/context-constitution-findings.md` L26 — unclamped override (resolved by `_clamp_override`) | same file L24 | L24 | delete L26 | 1 / 373 M |
| `services/xstockstrat-config/docs/context-constitution.md` L37 — `#884` own-scope echo | CONFIG-7 Why | CONFIG-7 | remove | 1 / 369 M |
| `CLAUDE.md` L290-292 — bootstrap command sequence | `README.md` L34-39; `docs/setup/getting-started.md` | getting-started | trim to a pointer | 3 / 348 M |
| `services/xstockstrat-indicators/CLAUDE.md` L193-196 — declared outputs must be emitted; inline runs exempt; `value` reserved | indicators constitution Gotcha L35 | constitution | trim | 4 / 344 M |
| `services/xstockstrat-agent/CLAUDE.md` L151-154 — `manage_formula` "forwards no admin scope" | AGENT-3, AGENT-4; `app/client.py#_metadata` (forwards the caller's derived scope since PR #994, so the sentence is also misleading) | constitution | trim | 4 / 334 M |
| `services/xstockstrat-ledger/CLAUDE.md` L61-63 — trimmed-NOTIFY resolve-by-PK text | LEDGER-8 and its RESOLVED gotcha | LEDGER-8 | keep one copy | 3 / 311 M |
| `docs/roadmap/CLAUDE.md` L16-20 — Feature Implementations lifecycle + `/sdd-status` pointer | `docs/roadmap/features/CLAUDE.md` L3-24; root | features CLAUDE.md | trim to the link | 5 / 307 M |
| `services/xstockstrat-agent/docs/context-constitution-findings.md` L22 — AGENT-2 "trips the linter" half (fixed) | AGENT-2 now says "convention, not a lint gate" | findings | trim to the Python-version half | 1 / 304 M |
| `CLAUDE.md` L304 — coverage thresholds incl. the Node "declared, not enforced" note | `docs/patterns/ci-overview.md` L14-18 | ci-overview | trim to the pointer | 1 / 286 M |
| `services/xstockstrat-indicators/CLAUDE.md` L34-36 — SAN-bound grant; `system` needs `analysis-fundsignal` | root `CLAUDE.md#Header Propagation Convention` | root | trim to a pointer | 3 / 257 M |
| `CLAUDE.md` L127-128 — version-table Notes cells repeat the uv-lock rule and the `GOWORK=off` note | same file L139 and L141 | L139/L141 | trim cell text | 2 / 227 M |
| `services/xstockstrat-marketdata/docs/context-constitution-findings.md` L14 — vestigial `trading_mode` / `NewWatcher` comment point | same file L33; root findings | L33 | merge into L33 | 1 / 226 M |
| `packages/otel/docs/context-constitution.md` L21 — OTLP/HTTP `:4318` env-only rule (while saying "not restated") | root PLAT-3 | PLAT-3 | reduce to the pointer sentence | 1 / 218 M |
| `CLAUDE.md` L352 — `claude/*`/`ccr-*` rule with hash-named example branches | same file L358, L480 | L358 | trim the examples | 1 / 203 M |
| `services/xstockstrat-notify/docs/context-constitution-findings.md` L36 — `unregisterPushSubscription` takes no `x-user-id`: intended? | NOTIFY-6 already answers: intentional | NOTIFY-6 | close the question citing NOTIFY-6 | 1 / 144 M |
| `services/xstockstrat-ledger/CLAUDE.md` L49 — page size (default 100, cap 1000), keyset token | `ledgerServiceImpl.ts#queryEvents`; LEDGER-9 | LEDGER-9 | remove | 1 / 122 M |
| `docs/roadmap/features/CLAUDE.md` L139 — rule 2 | same file L94 ("auto-populated by CI") | L94 | trim | 1 / 106 M |
| `docs/sdd/business-rules/CLAUDE.md` L44-50 — recon/promoter pairing | `.claude/agents/scenario-recon.md`, `scenario-promoter.md`; root Context Guide | agent files | trim to a one-line pointer | 7 / 666 L |
| `docs/setup/CLAUDE.md` L9-10 — DO setup / Grafana wiring rows | root Context Guide rows | root | trim | 2 / 576 L |
| `packages/otel/CLAUDE.md` L7-11 — collector/provisioning inventory | root `CLAUDE.md#Observability`; `docs/patterns/observability.md`; otel constitution L4/L17 | otel constitution | trim (optional — file is already tiny) | 5 / 550 L |
| `services/xstockstrat-ingest/CLAUDE.md` L70-78 — Inter-Service Dependencies edges | root `CLAUDE.md#Inter-Service Dependencies` | root | trim | 9 / 439 L |
| `docs/patterns/ui-ux-governance.md` L24-28 — preset id / theme-mapping prose | `services/xstockstrat-ui/CLAUDE.md` L29-35; `globals.css` L5/L83 | UI CLAUDE.md | trim | 5 / 388 L |
| `services/xstockstrat-ingest/CLAUDE.md` L58-61 — admin cross-owner read + fail-closed audit | ingest constitution Pointers (`audit.admin_read`, `_audit_or_abort`, PLAT-15) | constitution | trim | 4 / 364 L |
| `CLAUDE.md` L262-266 — per-language telemetry file paths | `docs/patterns/observability.md` | observability | keep "init errors must never prevent startup"; trim the rest | 5 / 340 L |
| `docs/patterns/ui-ux-governance.md` L152-154 — `sm:hidden` / off-screen rule | same file §3 L103-105 | §3 | trim to a cross-reference | 3 / 296 L |
| `packages/proto/docs/context-constitution.md` L44 — open RPC-shape question | proto findings L27 | findings | remove one | 1 / 279 L |
| `docs/context-constitution-findings.md` L60 — Python zero-trap (feature 244, resolved) | same file L33 | L33 | trim | 1 / 212 L |

## Contradicted by code

Context claims the code or a sibling doc now disproves — *documentation that lies*. **Defects (CF-N9), not scrub targets**: every row is routed to `/context-constitution`'s findings log and carried as `keep-but-verify`; it is excluded from the removable total and `apply` never deletes it. Many are already logged in the owning module's findings file — the row then only needs this line added to it. ⚠ rows first.

| Context line | What the code does | Evidence | Suggested action | Lines / chars · conf |
|---|---|---|---|---|
| `docs/patterns/ui-ux-governance.md` L189-227 — §8 coverage audit: durable suite "holds only **two** files"; screener, formulas, strategies, offline accounts, config-ui users rated "none" | `services/xstockstrat-ui/acceptance/` holds 53 `.feature` files (e.g. `screener-preset-criteria`, `user-management-ui`, `offline-account-portfolios`) | `ls services/xstockstrat-ui/acceptance/*.feature \| wc -l` = 53 | route to findings; regenerate via `/sdd-qa gaps` or move the snapshot to `docs/reports/` | 39 / 3,767 H |
| `services/xstockstrat-trading/CLAUDE.md` L144-163 — Ledger Events table (incl. `order.approved` marked "not yet implemented") | three emitted events are missing (`order.broker_call_uncertain`, `account.deregistered`, `account.halt.resumed`); `order.approved` has zero emit sites | `internal/service/trading.go` emit sites | route to findings; complete or reduce the table | 20 / 2,834 H |
| `services/xstockstrat-ui/CLAUDE.md` L398-421 — Key File Paths row "Edge-safe auth `src/lib/auth.ts`" | UI L229 says `auth.ts` is "Node-safe (was Edge-safe pre-128)" | `services/xstockstrat-ui/CLAUDE.md#Auth + BFF` | route to findings; fix or drop the row | 24 / 1,432 H |
| `services/xstockstrat-analysis/CLAUDE.md` L573 — config row: `_bars_fetch_sem` bounds `_enrich_opportunities_live` | that function takes no semaphore (one `BatchGetLatestPrice` under `wait_for`); `_bars_fetch_sem` guards only the `EvaluateReadiness` SLOW path (`servicer.py` ~L3997) | `app/handlers/servicer.py#_enrich_opportunities_live`; `docs/context-constitution.md#ANALYSIS-8` states the correct version | route to findings; fix the row, then trim | 1 / 1,040 H |
| ⚠ `services/xstockstrat-portfolio/CLAUDE.md` L48-56 — H-3: "GetSnapshot returns PermissionDenied unless portfolio_id == caller" | the handler re-wraps every error as `CodeNotFound`, so the service-level PermissionDenied never reaches the wire (authz-boundary doc/wire gap) | `internal/handler/portfolio_handler.go#GetSnapshot` L139; portfolio findings row 28 | route to findings (already logged); human decides doc vs code | 9 / 837 H |
| ⚠ `services/xstockstrat-trading/CLAUDE.md` L105 — config table: `platform.trading_state` default `ACTIVE` | the reader defaults to `"HALTED"` (fails closed); `ACTIVE` is only the seed | `internal/service/trading.go#currentTradingState` — `GetString("platform.trading_state", "HALTED")` | route to findings (already logged); fix the Default column | 1 / 663 H |
| `CLAUDE.md` L118, L135, L272 — "all three frontend segments" (`/trader`, `/insights`, `/config-ui`) | a fourth segment `/accounts` ships (`src/app/accounts/layout.tsx`, `e2e/accounts/*.spec.ts`; the UI CLAUDE.md and `ui-ux-governance.md` both say four) | `services/xstockstrat-ui/CLAUDE.md#Segments` | route to findings; reword to four segments | 3 / 629 H |
| `services/xstockstrat-ui/CLAUDE.md` L260-265 — "part of the platform's 20-connection budget" | root § Connection Pool Budget says ~22; the route defaults `DB_POOL_MAX` to 1 | root `CLAUDE.md#Connection Pool Budget` | route to findings; fix the figure | 6 / 385 H |
| `services/xstockstrat-trading/CLAUDE.md` L17, L96-97 — "a retried submission (`trading.order.max_retries`) is de-duplicated"; keys described as "Max broker submission retries" | `submitOrder` has no retry loop; only the emergency `flattenAndHalt` loop reads these keys (via `GetFloat`, though the table says int) | `internal/service/trading.go#flattenAndHalt`; trading findings rows 14/17 | route to findings (already logged); reword | 3 / 370 H |
| `docs/CLAUDE.md` L13<br>`docs/setup/CLAUDE.md` L11, L19 — docs index sends readers to "n8n setup"; setup index lists n8n as step 5 of the "setup order" | `docs/setup/n8n.md` L1 is "No Longer in Use" | `docs/setup/n8n.md` | route to findings; drop the n8n mentions | 3 / 357 H |
| `services/xstockstrat-trading/CLAUDE.md` L232-235 — "nothing in this service ever clears a halt (resuming is a manual DB edit)" | `ResumeAccountSvc` is an admin-gated RPC that clears the halt and emits `account.halt.resumed` | `internal/service/trading.go#ResumeAccountSvc` | route to findings (already logged) | 4 / 327 H |
| `docs/patterns/ui-ux-governance.md` L242 — §9 row d: `CardNotice` has no `role="alert"` | `CardNotice.tsx` sets `role={variant==="error"?"alert":undefined}`; the doc's own §4 says so too | `services/xstockstrat-ui/src/components/shared/CardNotice.tsx` | route to findings; narrow the row to the remaining gap (`QueryStateMessages`, `EmptyState` lack aria-live) | 1 / 259 H |
| `docs/CLAUDE.md` L3 — "Four subdirectories" | the table lists five (`patterns/`, `runbooks/`, `setup/`, `roadmap/`, `reports/`) | `docs/CLAUDE.md` L9-15 | route to findings; fix the count | 1 / 192 H |
| ⚠ `services/xstockstrat-indicators/CLAUDE.md` L157-158 — "`killpg(SIGKILL)` on timeout **and every exit** — a `fork()+sleep(∞)` grandchild cannot survive" | after `communicate()` reaps the child, `os.getpgid` raises ESRCH, which `_killpg` swallows — the success/non-zero-exit paths do not kill the group (leaks an RLIMIT_NPROC slot); same wording in the `sandbox.py` module docstring L27-28 | `app/services/sandbox.py#_killpg`, `#execute_formula`; INDICATORS-9; indicators findings | route to findings (already logged — add this line and the docstring to that row) | 2 / 188 H |
| `services/xstockstrat-trading/CLAUDE.md` L177-178 — "A successful replace persists the order" | `UpsertOrder`'s `ON CONFLICT … DO UPDATE SET` omits qty, limit_price, stop_price, time_in_force, so replaced values never reach the DB | `internal/repository/trading_repo.go#UpsertOrder`; trading findings | route to findings (known latent bug) | 2 / 175 H |
| `CLAUDE.md` L136 — Language table: "Vitest \| ^3" | `services/xstockstrat-ui/package.json` pins `"vitest": "^5.0.3"` | `package.json#devDependencies` | fix the table (or route to findings) | 1 / 171 H |
| `docs/runbooks/CLAUDE.md` L8 — index row: approval mechanisms "API / n8n / UI" | `approval-flow.md#Approval Mechanisms` lists Direct API / Agent-Webhook / UI; zero "n8n" hits; n8n removed by feature 011 | `docs/runbooks/approval-flow.md` L57-71 | route to findings; fix the description | 1 / 167 H |
| `services/xstockstrat-ledger/CLAUDE.md` L104-105 — "Compression: after 3 days… Retention: 2 years" stated as fact | no compress/retention/`add_*_policy` in `migrations/*` (zero grep hits); the file's own L79-80 rows say both are "Documented, not yet implemented" | `services/xstockstrat-ledger/migrations/*` | route to findings (dead-keys defect already filed) | 2 / 92 H |
| ⚠ `README.md` L35 — Bootstrap: "fill in ALPACA_API_KEY, ALPACA_API_SECRET, JWT_SECRET" | feature 147 moved the Alpaca credentials to encrypted config rows; `.env.example` L29-30 says they are "no longer" env vars and `marketdata/internal/config/config_test.go` asserts the env value is ignored | `.env.example#Feature 147`; root `CLAUDE.md#Environment Variable Naming Convention` | route to findings; list `JWT_SECRET` and `CONFIG_SECRETS_ENCRYPTION_KEY` instead | 1 / 86 H |
| `services/xstockstrat-marketdata/CLAUDE.md` L63 — config row `marketdata.alpaca.paper`: "Use paper trading endpoint" | no reader of `marketdata.alpaca.paper` in the Go sources; findings: nothing reads `ClientConfig.Paper` | marketdata findings (dead-key row) | route to findings (already logged) | 1 / 75 H |
| `docs/patterns/CLAUDE.md` L10 — index row: `nginx-routing.md` — "Adding a new frontend to the nginx reverse proxy" | nginx was removed by feature 045; the file opens "The nginx reverse proxy has been removed" | `docs/patterns/nginx-routing.md` L4; root `CLAUDE.md#Frontend Ingress` | route to findings; relabel "deprecated, historical" | 1 / 74 H |
| `services/xstockstrat-agent/CLAUDE.md` L100-107 — "One management write tool still hits a backend admin gate — `trigger_backfill`" | the file's own tool table marks `set_config`, `run_fundamentals_scan`, `cancel_backfill` "admin-scoped" and `app/tools.py` calls `_caller_access_scope` for five tools | `app/tools.py` L1441/1484/1562/1614/1855; AG L52-98 | route to findings; rewrite or remove | 8 / 623 M |
| `README.md` L58 — "feature.md" described as the lifecycle status | `status.md` is the canonical lifecycle status; `feature.md` is the Status History log; `acceptance.feature` is omitted | `docs/roadmap/features/CLAUDE.md#Feature Directory` | route to findings (doc drift) | 1 / 484 M |
| `docs/setup/CLAUDE.md` L8, L16 — setup index: "wire credentials into dev and prod environments" via `alpaca.md` | `alpaca.md` L49/71/111/143 still instruct `ALPACA_API_KEY`/`ALPACA_API_SECRET` env vars; feature 147 removed them (config rows `marketdata.alpaca.api_key`/`api_secret`) | `docs/setup/alpaca.md`; `marketdata/cmd/server/main.go` L116 | route to findings (fix `alpaca.md`, then the index inherits) | 2 / 248 M |
| ⚠ `services/xstockstrat-identity/CLAUDE.md` L46-51 — Dependencies: config supplies "Live config (JWT secrets, token TTLs)" | the JWT secret is env-only (`process.env.JWT_SECRET`, IDENTITY-1); config supplies only the TTLs | `src/grpc/identityServiceImpl.ts` L115; ID L80 | route to findings; reword (secret-boundary drift) | 6 / 231 M |
| `services/xstockstrat-trading/CLAUDE.md` L99 — config row `daily_loss_limit` (self-labelled "not yet implemented") | zero code readers | trading findings (dead-config row) | route to findings; whether to drop the row is a human call | 1 / 193 M |
| `services/xstockstrat-ledger/CLAUDE.md` L131<br>`services/xstockstrat-notify/CLAUDE.md` L119<br>`services/xstockstrat-identity/CLAUDE.md` L93 — `TRADING_MODE` documented as an env var (`=paper # paper \| live`) | no code reads it; each `configWatcher.ts` sends `TRADING_MODE_UNSPECIFIED`; root: the `trading_mode` axis was removed by feature 147 | `src/services/configWatcher.ts` (ledger, notify, identity); filed as `2026-10-19-trading-mode-axis-retained-defect` | route to findings (already filed); then remove | 3 / 162 M |
| `services/xstockstrat-marketdata/CLAUDE.md` L108 — config row `marketdata.retention.ohlcv_years` (self-labelled "not yet implemented") | zero code readers | marketdata findings (dead/orphaned) | route to findings | 1 / 153 M |
| `docs/setup/CLAUDE.md` L11 — setup index advertises "the surviving webhook path table" | root says there are no HTTP `/webhooks/` handlers; the table in `n8n.md` L11-24 is itself a doc defect | root `CLAUDE.md#Service-to-Service Calls` | route to findings | 1 / 140 M |
| `services/xstockstrat-config/CLAUDE.md` L131 — `APPLICATION_ENV` is the "default environment scope for this instance" | live code uses it only for telemetry (`deployment.environment`); scope comes from the request and CONFIG-4 defaults a missing env to `staging` | `src/telemetry.ts` L24; `src/index.ts` | route to findings | 1 / 102 M |
| ⚠ `services/xstockstrat-analysis/CLAUDE.md` L30 — strategy ownership: owner-scoped universe "deferred to feature 132's `resolve_universe`" | feature 132 is `launched` (`docs/roadmap/features/132-*/status.md`) and `app/engine/entry_backfill.py` imports `resolve_universe` from `live_loop`; `analysis` findings row 35 carries the same stale forward-pointer | `app/engine/entry_backfill.py#resolve_universe` | route to findings; re-triage the live-loop synthetic `x-user-id` question | 1 / 78 M |

## Should be just-in-time (pre-loaded → pointer)

`move-to` is advisory: this skill does not write the destination. Where a constitution cites the section being moved, re-point the constitution in the same change.

| Context line(s) | Why it is mis-placed | On-demand home | Suggested action | Lines / chars · conf |
|---|---|---|---|---|
| `services/xstockstrat-ui/CLAUDE.md` L125-202 — Opportunities-first shell (feature 083/124/126/155/215/263), ~78 lines | test ids are in the source; enum-map text duplicates UI constitution L36; copilot forcing duplicates UI-3; offcanvas archaeology duplicates `ui-ux-governance.md` L155 | new `services/xstockstrat-ui/docs/` file; keep the `NAV_GROUPS` import-cycle rule (L130-135) | move-to | 78 / 6,646 H |
| `services/xstockstrat-analysis/CLAUDE.md` L120-136 — fundsignal producer (features 062/154/224/246/260) | editing `fundsignal_loop.py` only | new `docs/fundsignal.md`; keep 3 lines | move-to | 17 / 5,981 H |
| `services/xstockstrat-analysis/CLAUDE.md` L226 — ListOpportunities paragraph (features 097/177/185/132/215) — one ~6.0k-char line | only needed when editing the opportunity queue | new `docs/opportunities.md`; leave a 3-line summary | move-to + pointer | 1 / 5,948 H |
| `services/xstockstrat-trading/CLAUDE.md` L206-266 — Broker State Reconciliation (~60 lines, features 102/206) | only when touching `reconcileTick` | new `trading/docs/reconciliation.md` | move-to + 3-line pointer | 61 / 5,416 H |
| `services/xstockstrat-analysis/CLAUDE.md` L160-218 — P&L consumer narrative (features 042/259) | editing `pnl_pattern_consumer.py` only; keepers are ANALYSIS-9/-17 | new `docs/pnl-consumer.md`; keep 4 lines | move-to | 59 / 5,377 H |
| `services/xstockstrat-analysis/CLAUDE.md` L424-485 — 62-line feature-215 guard section | only when touching fundamentals-requiring strategies | new `docs/fundamentals-guard.md` | move-to | 62 / 4,405 H |
| `services/xstockstrat-analysis/CLAUDE.md` L241-246 — SetOpportunityAction / EvaluateReadiness / GetStrategyAnalytics / GetWatchlistReadiness narratives | only needed in `servicer.py` readiness paths | `docs/opportunities.md` | move-to | 6 / 4,343 H |
| `services/xstockstrat-analysis/CLAUDE.md` L383-422 — feature-200 fundamentals-formula operand | ANALYSIS-10/-12 hold the rules | trim to 4 lines + pointer; rest to `docs/fundamentals-guard.md` | move-to | 40 / 3,463 H |
| `services/xstockstrat-indicators/CLAUDE.md` L232-239 — legacy-formula-authors operator procedure; CLI flags | operator-run, rarely needed; flags in argparse (`legacy_authors.py` L269-283) | `docs/runbooks/legacy-formula-authors.md` (exists) | move-to + one-line pointer | 8 / 1,481 H |
| `services/xstockstrat-marketdata/CLAUDE.md` L231-233 — Quote retention; "Pre-merge staging gates G1–G4" | gates recorded in `docs/roadmap/features/229-…/context.md` | — | trim to the fixed invariants | 3 / 1,227 H |
| `services/xstockstrat-marketdata/CLAUDE.md` L217-229 — Alpaca Integration (L225 alone ~1.7k chars) | narrow | `marketdata/docs/alpaca-integration.md` | move-to | 13 / 7,919 M |
| `services/xstockstrat-marketdata/CLAUDE.md` L130-215 — Fundamentals Integration (~85 lines) | only when editing fundamentals; the constitution Pointers row cites a CLAUDE.md § — re-point on move | `marketdata/docs/fundamentals.md` | move-to | 86 / 6,658 M |
| `services/xstockstrat-trading/CLAUDE.md` L23-29 — credential health, offline accounts (features 157/159/240/249) | narrow | `trading/docs/offline-accounts.md` (+ existing `ibkr.md`) | move-to | 7 / 4,548 M |
| `services/xstockstrat-analysis/CLAUDE.md` L80-118 — features 064/065 score-persistence "update" notes | two sections on the same topic | `docs/scoring.md` | merge + 4-line summary | 39 / 3,065 M |
| `services/xstockstrat-ui/CLAUDE.md` L319-354 — PWA & Push (feature 165) | narrow to `/accounts` + PWA; `layout.tsx` comments cover `VAPID_PUBLIC_KEY` | `services/xstockstrat-ui/docs/pwa-push.md` | move-to | 36 / 3,044 M |
| `services/xstockstrat-analysis/CLAUDE.md` L32-66 — feature-224 migration/saga detail | only template saga + unreadable-formula bullets are non-obvious | `docs/ownership-and-templates.md` | move-to | 35 / 3,031 M |
| `services/xstockstrat-analysis/CLAUDE.md` L351-381 — feature-152 benchmark operand | only when touching the evaluator | `docs/warmup.md` or new `docs/benchmark-operand.md` | move-to | 31 / 2,577 M |
| `services/xstockstrat-portfolio/CLAUDE.md` L146-167 — `position.closed` producer contract (features 042/029/031) | narrow | `portfolio/docs/`; keep "do not rename keys" | move-to | 22 / 2,053 M |
| `services/xstockstrat-analysis/CLAUDE.md` L293-321 — feature-151 fill model | narrow | `docs/backtest-fill-model.md` | move-to (or keep 4 lines) | 29 / 1,951 M |
| `services/xstockstrat-analysis/CLAUDE.md` L487-508 — feature-217 per-sector overrides (22 lines) | only when touching `sector_params.py` | new `docs/sector-overrides.md`; keep 3 lines | move-to | 22 / 1,724 M |
| `services/xstockstrat-analysis/CLAUDE.md` L138-158 — features 158/259 scheduler narrative | keep the supervision rule L157-158 (live directive, constitution cites it) | trim L138-150 to 3 lines | trim | 21 / 1,704 M |
| `services/xstockstrat-trading/CLAUDE.md` L165-191 — ReplaceOrder matrix | per-broker field map readable in the adapters | `docs/ibkr.md` | move-to | 27 / 1,552 M |
| `services/xstockstrat-analysis/CLAUDE.md` L227-240 — "Bounded read (feature 227)" bullet | ANALYSIS-14 cites this section by name — keep a 3-line version | trim, or move and re-point ANALYSIS-14 | trim | 14 / 1,335 M |
| `CLAUDE.md` L337 — recorded fundsignal exception + feature-175 removal of `propagation.ts` | narrow, history-heavy, already in module docs | `docs/context-constitution.md`; keep the root rule + pointer | move-to | 1 / 1,265 M |
| `services/xstockstrat-ui/CLAUDE.md` L69-81 — charting on `lightweight-charts` v5; "do not re-flag in an audit" | audit-suppression is not a behaviour; recharts consumer list is incomplete (`PerformanceDashboard.tsx`, `data-explorer/page.tsx` also import it) | ui-ux-governance or UI constitution | move-to | 13 / 1,199 M |
| `services/xstockstrat-ui/CLAUDE.md` L82-93 — sanctioned cross-segment client exception | a durable invariant with an audit-suppression tail | UI constitution (UI-2 neighbourhood) | move-to | 12 / 1,126 M |
| `services/xstockstrat-trading/CLAUDE.md` L268-277 — Position & Balance Sync Observability | narrow | docs, or drop | move-to | 10 / 941 M |
| `services/xstockstrat-trading/CLAUDE.md` L193-204 — Order Status Reconciliation (`done_for_day`) | only when touching `pollFills` | reconciliation doc; keep "unrecognised broker status → UNSPECIFIED, skipped" | move-to | 12 / 884 M |
| `services/xstockstrat-agent/CLAUDE.md` L216 — `agent.opportunities.read_timeout_seconds` row (~900 chars of implementation narrative) | `app/tools.py _POLICY_READ_TIMEOUT_S`; constitution Pointers L42 | — | trim to key, type, default, bounds | 1 / 733 M |
| `services/xstockstrat-portfolio/CLAUDE.md` L169-175 — `emitEvent` retry and GOAWAY history | incident narrative | — | trim to one line | 7 / 633 M |
| `docs/CLAUDE.md` L15 — `reports/` row incl. sidecar lifecycle and why Issues are off | skill-owned detail loaded on every docs task | `.claude/skills/sdd-qa/reference/defect-filing.md` | trim to a one-line row | 1 / 597 M |
| `services/xstockstrat-marketdata/CLAUDE.md` L113 — chunk-widening history (feature 153) | `docs/runbooks/ohlcv-lock-budget-tuning.md` | runbook; keep "new chunks 30d; old stay 1d" | trim | 1 / 574 M |
| `services/xstockstrat-config/CLAUDE.md` L103-107 — known limitations (30 s lag, pool competition, stale namespace) | defect-log material | config findings | move-to findings | 5 / 342 M |
| `docs/context-constitution.md` L68 — proto `timeframe` gotcha in the root constitution | proto-module fact | proto constitution L34 | move-to | 1 / 329 M |
| `docs/sdd/business-rules/CLAUDE.md` L21-30 — promotion lifecycle, three invocation points | skill-internal orchestration | `.claude/agents/scenario-promoter.md` | move-to + one-line pointer | 10 / 972 L |
| `CLAUDE.md` L362-363 — one-time branch-protection UI click path | `scripts/setup-branch-protection.sh` | runbook | move-to | 2 / 178 L |

## Brittle / over-specified (anti-altitude)

| Context line(s) | Why it is brittle | Heuristic it should become | Suggested action | Lines / chars · conf |
|---|---|---|---|---|
| `packages/proto/docs/context-constitution.md` L25 — PROTO-7: two long "other / further sibling sites" enumerations with ~L hints | enumeration | "singular optional = unavailable, not 0; sibling-flag/missing_metrics where the metric stayed a plain double" | trim to a heuristic | 1 / 2,328 M |
| `services/xstockstrat-analysis/docs/context-constitution.md` L28 — ANALYSIS-12 "8+ sites" enumeration (~10 `~L` hints) | three of four clauses are in analysis CLAUDE | keep the ANALYSIS-4 carve-out + "pass the gate to BOTH loader and `assess`" | trim to a heuristic | 1 / 2,289 M |
| `services/xstockstrat-analysis/CLAUDE.md` L441-467 — per-surface if-else (backtest, live, opportunity, quota ripple) | enumerates cases | "UNAVAILABLE refuses or denies entry, UNKNOWN never refuses, DISABLED/NOT_ASSESSED change nothing" | trim to a heuristic | 27 / 2,056 M |
| `services/xstockstrat-analysis/CLAUDE.md` L193-210 — retry/park/probe step list | describes code flow | "retry in place; park only allow-listed poison errors; else replay from the unadvanced cursor; park order is log, emit, advance" | trim to a heuristic | 18 / 1,820 M |
| `services/xstockstrat-agent/CLAUDE.md` L19-36 — propagation trio + per-builder body-`user_id` list (already incomplete: omits `snapshot_offline_positions`) | enumerates sites | "identity travels in headers; body `user_id` only as a target/scope selector" | trim to a heuristic | 18 / 1,692 M |
| `services/xstockstrat-ui/docs/context-constitution.md` L43 — 30 s deadline gotcha lists 5 constants and 8 call-site hints | values are free to read in `src/lib/deadlines.ts` | "unary default 30 s, streams unbounded; set per-call `timeoutMs` for long RPCs" | trim to a heuristic | 1 / 1,250 M |
| `services/xstockstrat-config/docs/context-constitution.md` L28 — CONFIG-11 clause "`sparkline_bars` still registered although nothing reads it" | a defect statement inside a rule (C-F:15, PLAT-14 carry it) | keep in findings only | trim the clause | 1 / 1,185 M |
| `services/xstockstrat-notify/CLAUDE.md` L43-55 — EmitAlert narrative (features 092/097, header-removal essay) | only "EmitAlert is intentionally not role-gated (F-11); internal callers send no admin bit" steers behaviour | that one line (pinned by `notifyServiceImpl.test.ts`) | trim to a heuristic | 13 / 1,055 M |
| `services/xstockstrat-analysis/CLAUDE.md` L166-176 — five-step numbered per-event sequence | describes code flow | "events in order; short-circuit `sequence <= cursor`; snapshot before the txn; cursor advance atomic with writes; audit emits after commit" | trim to a heuristic | 11 / 1,040 M |
| `services/xstockstrat-ui/docs/context-constitution.md` L36 — enum-map gotcha lists 7+ files and "6 maps" | file-by-file list that drifts | "every proto-enum→label map is `Record<Enum,…>` so `tsc` fails; never `switch`+`default`" | trim to a heuristic | 1 / 942 M |
| `services/xstockstrat-analysis/docs/context-constitution.md` L17, L26, L27, L32 — bare line numbers (`pnl_positions.py:57,66`, `fails.md:313/:418/:1153`, 7 `store unavailable` lines) | bare `path:line` cites are brittle (CF-N13) | "N≥6 sites"; anchors not lines | trim to anchors/counts | 4 / 3,442 L |
| `services/xstockstrat-ui/docs/context-constitution.md` L28-29 — "N=14 uses across 13 files", "N=3, complete", test line ranges | counts rot | keep the rule | drop counts | 2 / 2,239 L |
| `services/xstockstrat-analysis/docs/context-constitution.md` L29 — ANALYSIS-13 γ clamp clause | analysis CLAUDE config row `symbol_score_decay` states it | keep owner-gate + determinism-parity clauses | trim the clamp clause | 1 / 1,817 L |
| `services/xstockstrat-trading/CLAUDE.md` L25 — bracket step-by-step across Alpaca/IBKR/watchdog/flatten/halt | enumerates cases | "brackets protect auto-sized entries; halt blocks Place/Replace, never Cancel" | trim to a heuristic | 1 / 1,783 L |
| `services/xstockstrat-ingest/docs/context-constitution.md` L29 — INGEST-10 Evidence: ~9 `~L` hints across 6 functions | enumeration | "every guard reads only `_canceled_jobs`; sole writer is `CancelBackfill`" | trim Evidence | 1 / 1,460 L |
| `services/xstockstrat-marketdata/CLAUDE.md` L70 — `bar_ingest_timeframe` row lists parse/skip/fallback/pause behaviours | enumerates cases | "comma-list of canonical timeframes; bad entries skipped with WARN; pause via interval ≤ 0" | trim to a heuristic | 1 / 810 L |
| `services/xstockstrat-agent/docs/context-constitution.md` L17 — "72 opens: 70 + 2" | text already says the list drifts | — | drop the count | 1 / 711 L |
| `CLAUDE.md` L228-233 — six identical pooled-service rows in the pool-budget table | enumerates what one row can say | "six stateless services route through PgBouncer; DB_POOL_MAX unset" | trim to a heuristic | 6 / 619 L |

## Bloat / low-value prose

| Context line(s) | Why it is filler | Suggested action | Lines / chars · conf |
|---|---|---|---|
| `CLAUDE.md` L139 — "(That gate was added 2026-07-27; before then…)" | history; `ci.yml#uv lock --check` shows the gate exists | trim | 1 / 552 H |
| `services/xstockstrat-portfolio/CLAUDE.md` L112-115 — blockquote narrating the removed `platform.ledger_endpoint` row; line-only cite into trading findings (row 14 is now a different row) | history; anchor resolves only in a Resolved section | remove | 4 / 370 H |
| `docs/CLAUDE.md` L19-24 — "Finding the Right File" ("Every scenario below…" — no scenario table exists) | same file L9-15 | remove | 6 / 369 H |
| `services/xstockstrat-analysis/CLAUDE.md` L408-411 — self-garbled "lowered by `_load_fundamentals_snapshot` (live loop: `_load_fundamentals_snapshot`)" | redundant parenthetical | remove | 4 / 317 H |
| `services/xstockstrat-config/CLAUDE.md` L113-115 — "No webhooks" filler; ADMIN-scope pointer | root "Service-to-Service Calls"; invariant #5 | remove | 3 / 213 H |
| `services/xstockstrat-agent/CLAUDE.md` L112-113 — `_admin_metadata()` "removed by feature 092" | only comments mention it (`app/scopes.py` L9, `app/client.py` L2238) | remove | 2 / 122 H |
| `services/xstockstrat-config/docs/context-constitution.md` L3-9 — multi-line "refreshed on <date> @ <sha>" changelog preamble (git history holds it; loaded on every task) | shapes no agent action | trim to one "Derived <date>; last refreshed <date> @<sha>" line | 7 / 2,001 M |
| `services/xstockstrat-identity/docs/context-constitution.md` L3-9 — multi-line "refreshed on <date> @ <sha>" changelog preamble (git history holds it; loaded on every task) | shapes no agent action | trim to one "Derived <date>; last refreshed <date> @<sha>" line | 7 / 1,689 M |
| `services/xstockstrat-ui/docs/context-constitution.md` L3-8 — multi-line "refreshed on <date> @ <sha>" changelog preamble (git history holds it; loaded on every task) | shapes no agent action | trim to one "Derived <date>; last refreshed <date> @<sha>" line | 6 / 1,622 M |
| `services/xstockstrat-trading/CLAUDE.md` L84-90<br>`services/xstockstrat-portfolio/CLAUDE.md` L97-100<br>`services/xstockstrat-marketdata/CLAUDE.md` L50-55 — feature-189 migration history in the Config intro | history · keep "read by full-dotted name (CONFIG-9)" | trim | 17 / 1,588 M |
| `docs/context-constitution.md` L3-17 — multi-line "refreshed on <date> @ <sha>" changelog preamble (git history holds it; loaded on every task) | shapes no agent action | trim to one "Derived <date>; last refreshed <date> @<sha>" line | 15 / 1,550 M |
| `services/xstockstrat-analysis/docs/context-constitution.md` L46 — Feature 144/245/246 changelog (~300 words) | only the sort key `(score_unavailable, eval_failed, -score)` and "do not fold into INSUFFICIENT_DATA" shape behaviour | trim to those two directives | 1 / 1,506 M |
| `packages/proto/docs/context-constitution.md` L3-8 — multi-line "refreshed on <date> @ <sha>" changelog preamble (git history holds it; loaded on every task) | shapes no agent action | trim to one "Derived <date>; last refreshed <date> @<sha>" line | 6 / 1,501 M |
| `services/xstockstrat-analysis/docs/context-constitution.md` L3-8 — multi-line "refreshed on <date> @ <sha>" changelog preamble (git history holds it; loaded on every task) | shapes no agent action | trim to one "Derived <date>; last refreshed <date> @<sha>" line | 6 / 1,497 M |
| `services/xstockstrat-portfolio/docs/context-constitution.md` L3-9 — multi-line "refreshed on <date> @ <sha>" changelog preamble (git history holds it; loaded on every task) | shapes no agent action | trim to one "Derived <date>; last refreshed <date> @<sha>" line | 7 / 1,486 M |
| `services/xstockstrat-ingest/docs/context-constitution.md` L3-11 — multi-line "refreshed on <date> @ <sha>" changelog preamble (git history holds it; loaded on every task) | shapes no agent action | trim to one "Derived <date>; last refreshed <date> @<sha>" line | 9 / 1,481 M |
| `services/xstockstrat-notify/docs/context-constitution.md` L3-5 — multi-line "refreshed on <date> @ <sha>" changelog preamble (git history holds it; loaded on every task) | shapes no agent action | trim to one "Derived <date>; last refreshed <date> @<sha>" line | 3 / 1,378 M |
| `services/xstockstrat-ledger/docs/context-constitution.md` L3-7 — multi-line "refreshed on <date> @ <sha>" changelog preamble (git history holds it; loaded on every task) | shapes no agent action | trim to one "Derived <date>; last refreshed <date> @<sha>" line | 5 / 1,362 M |
| `services/xstockstrat-agent/docs/context-constitution.md` L3-6 — multi-line "refreshed on <date> @ <sha>" changelog preamble (git history holds it; loaded on every task) | shapes no agent action | trim to one "Derived <date>; last refreshed <date> @<sha>" line | 4 / 1,328 M |
| `services/xstockstrat-agent/docs/context-constitution.md` L25 — AGENT-8 test-fixture inventory | discoverable in the test dir (`tests/conftest.py#set_env`) · keep "patch the module attribute, not env" + the four-module `AGENT_PUBLIC_URL` fact | trim | 1 / 1,281 M |
| `services/xstockstrat-portfolio/docs/context-constitution-findings.md` L21 — struck row with long original text (feature 231) | resolved | reduce to the RESOLVED line | 1 / 1,257 M |
| `services/xstockstrat-marketdata/docs/context-constitution.md` L3-5 — multi-line "refreshed on <date> @ <sha>" changelog preamble (git history holds it; loaded on every task) | shapes no agent action | trim to one "Derived <date>; last refreshed <date> @<sha>" line | 3 / 1,241 M |
| `services/xstockstrat-trading/docs/context-constitution.md` L3-7 — multi-line "refreshed on <date> @ <sha>" changelog preamble (git history holds it; loaded on every task) | shapes no agent action | trim to one "Derived <date>; last refreshed <date> @<sha>" line | 5 / 1,231 M |
| `services/xstockstrat-indicators/docs/context-constitution.md` L3-6 — multi-line "refreshed on <date> @ <sha>" changelog preamble (git history holds it; loaded on every task) | shapes no agent action | trim to one "Derived <date>; last refreshed <date> @<sha>" line | 4 / 1,073 M |
| `services/xstockstrat-ingest/CLAUDE.md` L103-111 — "feature 054 shipped the proto fields… omitted the backing columns"; restart reconcile | `main.py` L76; `servicer.py#resume_incomplete_jobs`; overlaps INGEST-10 | trim history and restart mechanics | 9 / 925 M |
| `services/xstockstrat-ingest/docs/context-constitution.md` L35 — feature-143 mechanism narrative (~170 words) | `backfill_chunks.py:15 _BARS_PER_DAY = {"1d": 1}`; ingest CLAUDE Ports · keep "`_STR_TO_ENUM` must keep resolving stored 15m/1h" | trim | 1 / 789 M |
| `services/xstockstrat-portfolio/docs/context-constitution.md` L39 — struck gotcha with full "Original note:" tail | `unvaluedSymbols`/`applyQuotes` now shared by both paths | cut to one line | 1 / 771 M |
| `services/xstockstrat-ui/docs/context-constitution-findings.md` L38 — closed open-question with a long narrative | status says "closed" | move to Resolved or trim | 1 / 743 M |
| `services/xstockstrat-notify/docs/context-constitution-findings.md` L10-11 — "None currently open" italic followed by a headerless table row (malformed table) |  | fix formatting | 2 / 701 M |
| `services/xstockstrat-ui/docs/context-constitution.md` L40 — #901/#884 gotcha: `trading_mode='all'` half | `NamespaceEditor.tsx` has no `trading_mode`; axis removed by feature 147 · keep "read `currentValue`, not `defaultValue`" if still a live trap | trim | 1 / 692 M |
| `services/xstockstrat-identity/docs/context-constitution.md` L37 — bcrypt-parity half (compare reads cost from the hash → non-load-bearing) | `migrations/002_seed_admin.up.sql:12`; keep the `SEED_ADMIN_PASSWORD_HASH` byte-equal sentence | trim | 1 / 643 M |
| `services/xstockstrat-trading/docs/context-constitution.md` L46 — refuted candidate (fill-poller race), "kept for history" | `trading.go#updateOrder` clones under `s.mu` | remove | 1 / 525 M |
| `services/xstockstrat-analysis/CLAUDE.md` L82-86 — "Feature 065 update" blockquote | history narration | remove | 5 / 504 M |
| `services/xstockstrat-analysis/docs/context-constitution.md` L45 — `screener.py` fix + report `2026-08-08-screener-fundamental-criteria-silently-inert` | fixed-bug narrative; lesson enforced in code (fail closed to INSUFFICIENT_DATA) | trim to a 1-line scar or remove | 1 / 457 M |
| `services/xstockstrat-agent/docs/context-constitution-findings.md` L90-91 — placeholder cells "(open report absent from this table until 2026-11-04; title not re-read)" | introduced by the 2026-11-04 refresh | fill the real titles or drop the rows | 2 / 436 M |
| `CLAUDE.md` L369 — coarse "all phases DONE" snapshot with stale-prone phase list | `docs/roadmap/implementation-roadmap.md`, `phase[3-7]-deviations.md` | remove | 1 / 392 M |
| `services/xstockstrat-analysis/CLAUDE.md` L576 — `sparkline_bars` row (~300 chars documenting a dead key) | zero hits for `sparkline_bars` in `app/` | trim to one line | 1 / 338 M |
| `services/xstockstrat-ui/docs/context-constitution.md` L41 — `63a3655` commit narrative | history, no forward directive; `live_enabled` is used in 8 UI files | remove or fold into one line | 1 / 334 M |
| `docs/setup/CLAUDE.md` L13-19 — setup order (repeats "start with getting-started.md"; step 5 is a deprecated doc) | `docs/setup/getting-started.md` | trim (drop step 5) | 7 / 325 M |
| `services/xstockstrat-portfolio/docs/context-constitution-findings.md` L24 — "GetPnL wire-code changes are intended" (not a defect) | portfolio CLAUDE documents `classifyGetPnLError` | remove or move to CLAUDE | 1 / 283 M |
| `CLAUDE.md` L69<br>`CLAUDE.md` L445 — deprecated nginx rows (repeated at L192, L197, L272, L337) | `docs/patterns/nginx-routing.md` L4 ("removed"); no task needs it · keep one tombstone at L192 | remove both rows | 2 / 240 M |
| `services/xstockstrat-trading/docs/context-constitution-findings.md` L18 — row about bare `:NN` cites in the constitution header | the constitution now cites symbols | remove the row | 1 / 236 M |
| `services/xstockstrat-ingest/CLAUDE.md` L35-36 — "(`TriggerBackfill`'s gate was added by feature 092…; before that it queued paid jobs…)" | history (root "How to Act" #5: belongs in PR/ledger) | remove parenthetical | 2 / 180 M |
| `services/xstockstrat-portfolio/CLAUDE.md` L109-110<br>`services/xstockstrat-marketdata/CLAUDE.md` L72-76<br>`services/xstockstrat-trading/CLAUDE.md` L162 — long "Unseeded; SetConfig-bounded" tails; `order_intent.reclaimed_unknown` payload narrative | bounds/seeds live in config migrations; payload in `order_intent.go` | trim | 8 / 4,024 L |
| `services/xstockstrat-trading/docs/context-constitution-findings.md` L13, L15, L55 — RESOLVED rows in the open doc-lie table; long IBKR resolved entry | history only | collapse to one line each / move to Resolved | 3 / 1,491 L |
| `services/xstockstrat-ingest/docs/context-constitution-findings.md` L12-13 — rows saying "Resolved — row kept for history" / "STALE premise (resolved)" inside the "Documentation that lies" table | another Resolved section exists | move to Resolved or remove | 2 / 1,409 L |
| `services/xstockstrat-ledger/docs/context-constitution-findings.md` L13 — subscriber-count half RESOLVED but kept in the open row | `TRADING_MODE` half still open | split; keep the open half | 1 / 1,139 L |
| `services/xstockstrat-portfolio/docs/context-constitution-findings.md` L3-7 — findings-file header changelog | shapes no agent action | trim to one line | 5 / 1,069 L |
| `services/xstockstrat-analysis/CLAUDE.md` L140-149 — "…a ~60s loop gains almost nothing…" and 156/158 history | no directive | trim | 10 / 984 L |
| `docs/context-constitution-findings.md` L3-5 — findings-file header changelog | shapes no agent action | trim to one line | 3 / 950 L |
| `services/xstockstrat-config/docs/context-constitution-findings.md` L36-42 — "Root CLAUDE.md lists `shrinkage_days`… zero hits" point-in-time grep note |  | trim | 7 / 897 L |
| `services/xstockstrat-analysis/docs/context-constitution-findings.md` L3-6 — findings-file header changelog | shapes no agent action | trim to one line | 4 / 888 L |
| `services/xstockstrat-identity/docs/context-constitution-findings.md` L3-6 — findings-file header changelog | shapes no agent action | trim to one line | 4 / 742 L |
| `services/xstockstrat-marketdata/docs/context-constitution-findings.md` L3-4 — findings-file header changelog | shapes no agent action | trim to one line | 2 / 714 L |
| `services/xstockstrat-trading/docs/context-constitution-findings.md` L3-4 — findings-file header changelog | shapes no agent action | trim to one line | 2 / 696 L |
| `services/xstockstrat-indicators/docs/context-constitution-findings.md` L3 — findings-file header changelog | shapes no agent action | trim to one line | 1 / 607 L |
| `services/xstockstrat-config/docs/context-constitution-findings.md` L25 — row "Cross-ref only" (tracked as a ROOT finding) |  | remove or 1-line pointer | 1 / 583 L |
| `packages/otel/docs/context-constitution.md` L3 — multi-line "refreshed on <date> @ <sha>" changelog preamble (git history holds it; loaded on every task) | shapes no agent action | trim to one "Derived <date>; last refreshed <date> @<sha>" line | 1 / 525 L |
| `packages/proto/docs/context-constitution-findings.md` L4 — findings-file header changelog | shapes no agent action | trim to one line | 1 / 503 L |
| `services/xstockstrat-agent/docs/context-constitution-findings.md` L47 — open question marked "resolved (feature 241)" |  | move to Resolved | 1 / 474 L |
| `services/xstockstrat-agent/docs/context-constitution-findings.md` L14 — empty table header + italic "None" + resolved-history sentence |  | collapse | 1 / 414 L |
| `docs/sdd/CLAUDE.md` L13-15 — meta-narrative about the Constitution consolidating rules | root Context Guide; `docs/sdd/constitution.md` | remove | 3 / 263 L |
| `docs/roadmap/ledger/CLAUDE.md` L19-20 — "See also" cross-reference list | shapes no action | remove | 2 / 184 L |

## Context budget (file-level)

Whole context files whose **measured** size strains attention (context rot) even when no single line above fails. Advisory — a prompt to review/split,
never an automatic removal. Soft budget ~2,000 characters per auto-loaded file; **only the files at or under it are listed below the table.** "Flagged" = the
deduped H/M removable-or-relocatable lines in that file.

| File | Measured lines | Measured characters | Over soft budget? | Flagged lines / chars |
|---|---|---|---|---|
| `services/xstockstrat-analysis/CLAUDE.md` | 640 | 80,779 | yes (40×) | 494 / 71,366 |
| `services/xstockstrat-marketdata/CLAUDE.md` | 260 | 39,730 | yes (20×) | 151 / 22,610 |
| `CLAUDE.md` | 480 | 39,146 | yes (20×) | 80 / 11,836 |
| `services/xstockstrat-ui/CLAUDE.md` | 421 | 33,359 | yes (17×) | 274 / 22,370 |
| `services/xstockstrat-trading/CLAUDE.md` | 305 | 33,299 | yes (17×) | 171 / 18,461 |
| `docs/context-constitution.md` | 97 | 32,141 | yes (16×) | 22 / 6,164 |
| `services/xstockstrat-analysis/docs/context-constitution.md` | 63 | 28,492 | yes (14×) | 17 / 11,423 |
| `services/xstockstrat-portfolio/docs/context-constitution.md` | 59 | 24,617 | yes (12×) | 16 / 13,148 |
| `services/xstockstrat-agent/CLAUDE.md` | 248 | 23,692 | yes (12×) | 173 / 19,115 |
| `docs/context-constitution-findings.md` | 89 | 23,575 | yes (12×) | 0 / 0 |
| `services/xstockstrat-ui/docs/context-constitution.md` | 67 | 22,568 | yes (11×) | 12 / 6,740 |
| `services/xstockstrat-marketdata/docs/context-constitution.md` | 68 | 21,242 | yes (11×) | 15 / 10,536 |
| `packages/proto/docs/context-constitution.md` | 58 | 20,334 | yes (10×) | 11 / 9,024 |
| `services/xstockstrat-portfolio/CLAUDE.md` | 189 | 20,253 | yes (10×) | 106 / 13,982 |
| `docs/patterns/ui-ux-governance.md` | 257 | 20,011 | yes (10×) | 38 / 3,563 |
| `services/xstockstrat-config/docs/context-constitution.md` | 57 | 19,741 | yes (10×) | 16 / 10,142 |
| `services/xstockstrat-indicators/CLAUDE.md` | 239 | 18,458 | yes (9×) | 106 / 10,459 |
| `services/xstockstrat-identity/docs/context-constitution.md` | 53 | 17,155 | yes (9×) | 13 / 5,664 |
| `services/xstockstrat-trading/docs/context-constitution-findings.md` | 77 | 16,124 | yes (8×) | 3 / 1,113 |
| `services/xstockstrat-trading/docs/context-constitution.md` | 58 | 15,492 | yes (8×) | 11 / 6,842 |
| `services/xstockstrat-agent/docs/context-constitution.md` | 46 | 15,413 | yes (8×) | 9 / 6,871 |
| `services/xstockstrat-config/CLAUDE.md` | 143 | 14,141 | yes (7×) | 45 / 7,545 |
| `services/xstockstrat-analysis/docs/context-constitution-findings.md` | 66 | 14,101 | yes (7×) | 0 / 0 |
| `services/xstockstrat-agent/docs/context-constitution-findings.md` | 94 | 14,080 | yes (7×) | 3 / 740 |
| `services/xstockstrat-ingest/docs/context-constitution.md` | 50 | 13,990 | yes (7×) | 14 / 5,429 |
| `services/xstockstrat-portfolio/docs/context-constitution-findings.md` | 67 | 13,548 | yes (7×) | 3 / 2,284 |
| `services/xstockstrat-ingest/docs/context-constitution-findings.md` | 64 | 13,408 | yes (7×) | 1 / 819 |
| `services/xstockstrat-indicators/docs/context-constitution.md` | 55 | 12,857 | yes (6×) | 17 / 9,081 |
| `services/xstockstrat-ingest/CLAUDE.md` | 178 | 12,854 | yes (6×) | 86 / 6,418 |
| `services/xstockstrat-ui/docs/context-constitution-findings.md` | 65 | 12,680 | yes (6×) | 3 / 1,331 |
| `services/xstockstrat-indicators/docs/context-constitution-findings.md` | 61 | 12,558 | yes (6×) | 1 / 373 |
| `services/xstockstrat-config/docs/context-constitution-findings.md` | 60 | 12,364 | yes (6×) | 0 / 0 |
| `services/xstockstrat-notify/docs/context-constitution.md` | 46 | 11,970 | yes (6×) | 11 / 6,622 |
| `services/xstockstrat-marketdata/docs/context-constitution-findings.md` | 65 | 11,658 | yes (6×) | 2 / 503 |
| `services/xstockstrat-ledger/docs/context-constitution.md` | 43 | 11,555 | yes (6×) | 9 / 4,305 |
| `services/xstockstrat-ledger/docs/context-constitution-findings.md` | 62 | 11,111 | yes (6×) | 0 / 0 |
| `services/xstockstrat-notify/CLAUDE.md` | 141 | 11,025 | yes (6×) | 45 / 4,907 |
| `services/xstockstrat-identity/docs/context-constitution-findings.md` | 64 | 10,633 | yes (5×) | 9 / 863 |
| `services/xstockstrat-ledger/CLAUDE.md` | 140 | 9,194 | yes (5×) | 22 / 2,880 |
| `services/xstockstrat-notify/docs/context-constitution-findings.md` | 65 | 9,076 | yes (5×) | 3 / 845 |
| `docs/roadmap/features/CLAUDE.md` | 145 | 8,949 | yes (4×) | 33 / 3,192 |
| `packages/proto/docs/context-constitution-findings.md` | 53 | 8,884 | yes (4×) | 0 / 0 |
| `services/xstockstrat-identity/CLAUDE.md` | 107 | 6,418 | yes (3×) | 51 / 3,861 |
| `README.md` | 73 | 6,181 | yes (3×) | 0 / 0 |
| `packages/otel/docs/context-constitution.md` | 33 | 4,151 | yes (2×) | 1 / 218 |
| `packages/otel/docs/context-constitution-findings.md` | 31 | 3,898 | yes (2×) | 0 / 0 |
| `docs/runbooks/CLAUDE.md` | 22 | 3,711 | yes (2×) | 14 / 3,055 |
| `docs/sdd/business-rules/CLAUDE.md` | 52 | 3,507 | yes (2×) | 0 / 0 |
| `docs/roadmap/CLAUDE.md` | 26 | 2,638 | yes (1×) | 17 / 2,541 |
| `docs/patterns/CLAUDE.md` | 19 | 2,356 | yes (1×) | 14 / 2,032 |

At or under the budget: `docs/CLAUDE.md`, `packages/proto/CLAUDE.md`, `docs/sdd/CLAUDE.md`, `docs/setup/CLAUDE.md`, `docs/roadmap/ledger/CLAUDE.md`, `packages/otel/CLAUDE.md`.

Two outliers dominate: `services/xstockstrat-analysis/CLAUDE.md` alone is 80,779 characters; its Config Keys table (L514-589) is ≈ 24.3k and one paragraph (L226) is ≈ 6.0k. The agent CLAUDE.md tool table (L52-98) is ≈ 7.9k of that file's 23.8k and is fully duplicated by `docs/runbooks/mcp-tools.md`.

## Silent skills (weak trigger surface)

Scanned: `21` `SKILL.md` files (`.claude/skills/*` ×17, `.agents/skills/*` ×2, `plugins/strat-lab/skills/backtest`; two `.claude/skills` entries — `shadcn`, `migrate-radix-to-base` — are symlinks into `.agents/skills/*`, which is inside the repo) · excluded as symlinked-out: `0`.

_None._ Every scanned description carries a trigger surface. `plugins/strat-lab/skills/backtest` is command-only (`disable-model-invocation: true`), so it is reached by `/` and is not a silent skill.

## Keep-but-verify (unconfirmed — CF-1)

Suspected low-signal or possibly-wrong, but not grounded to the standard of a category row. Confirm before treating as removable — never trimmed by `apply`.

- `CLAUDE.md` L127-137 — version table — suspected: restated: every pin is in `ci.yml` / `package.json#packageManager` / `Dockerfile.codegen`; what would confirm it: L152 calls this table the "soft source of truth", so trim only if that policy is dropped — decide the policy first — status: **unverified**
- `CLAUDE.md` L170 — Approval Flow roles — suspected: duplicate or divergent of `docs/runbooks/approval-flow.md`; what would confirm it: `approval-flow.md` has no "platform lead"/"DBA" strings; read it to see whether L170 is a paraphrase or a different role list — status: **unverified**
- `CLAUDE.md` L43 — "ledger `fails.md:670`" — suspected: bare line cite; what would confirm it: anchor resolves (now `fails.md` L671) — `~L` drift only, **not** stale; re-anchor to the entry text — status: **unverified**
- `docs/runbooks/feature-workflow.md` L52 (out of scope, noticed) — suspected: shows step branches as `feature/<slug>/step-N`; what would confirm it: root CLAUDE.md and `.claude/skills/sdd-execute/SKILL.md` both say `feature-steps/<slug>-step-<N>` — the runbook is the likely outlier — status: **unverified**
- `package.json` vs `services/xstockstrat-ui/package.json` (out of scope, noticed) — suspected: root `packageManager pnpm@9.15.9`; UI `pnpm@9.15.0`; what would confirm it: which is authoritative? Root and `ui/CLAUDE.md` both say 9.15.9 — status: **unverified**
- `docs/patterns/ui-ux-governance.md` L243 (§9 row e) — suspected: partly fixed: `AlertStream.tsx` L66 now has `aria-label="Alerts"`; what would confirm it: RuleEditor / ComponentEditor labels ("left operand") still look un-indexed — confirm, then trim the fixed item — status: **unverified**
- `docs/patterns/ui-ux-governance.md` L97-98 — suspected: snapshot claim "zero orphans today"; what would confirm it: confirm `e2e/nav-reachability.spec.ts` passes on the current `NAV_GROUPS` — status: **unverified**
- `docs/roadmap/features/CLAUDE.md` L13-24 (lifecycle enum), L44-53 (file table), L55-80 (Bulk Status Reads), L34-38 + L105 (`GitHub Issue` field) — suspected: enum possibly enforced in `.github/workflows/ci-validate-feature-status.yml` and skills; file table partly in root; Issues disabled; what would confirm it: confirm the CI/skills duplicate the enum before trimming; check recent bug `feature.md` files for the `GitHub Issue` field; confirm nothing relies on the nested table's `recon.md`/`design.md` rows — status: **unverified**
- `docs/sdd/business-rules/CLAUDE.md` L32-40 — suspected: scenario conventions may already be in `/sdd-story`, `scenario-promoter.md`, constitution C-15/C-16; what would confirm it: not verified in this pass — status: **unverified**
- `docs/patterns/CLAUDE.md`, `docs/runbooks/CLAUDE.md` — suspected: is the root Context Guide meant to be the single index?; what would confirm it: if yes, both reduce to the rows root lacks (see the duplication rows) — status: **unverified**
- `docs/setup/CLAUDE.md` L8 — suspected: after `alpaca.md` is fixed, should this row say "credentials as config rows"?; what would confirm it: depends on the `alpaca.md` fix — status: **unverified**
- analysis `CLAUDE.md` L70 — "22 RPCs carry `owner_scoped`" — suspected: count may be wrong; what would confirm it: `owner_scoped` has 25 hits in `servicer.py` incl. definitions/comments; count decorator uses — status: **unverified**
- analysis `CLAUDE.md` — undocumented key — suspected: gap in the other direction; what would confirm it: `servicer.py` L3003 reads `analysis.backtest.detail_retention_per_strategy` (default 20) but the Config Keys table omits it — status: **unverified**
- analysis `CLAUDE.md` L124 — "`main.py` `md_config_watcher`" — suspected: kwarg is `md_config_watcher` in `fundsignal_loop.py` L88; `main.py` L194 passes `md_cfg_watcher`; what would confirm it: anchor resolves (not stale); decide whether the prose should name the local variable — status: **unverified**
- analysis `CLAUDE.md` L97 — "no retention or pagination yet" for `strategy_scores_v2` — suspected: unconfirmed; what would confirm it: check migrations 026/027 and `app/repositories` for a pruner — status: **unverified**
- analysis `docs/patterns/config-governance.md` L326 (out of scope) — suspected: governance doc says `get_int`; `servicer.py` L558 uses `int_positive` (as CLAUDE.md says); what would confirm it: note for that file's owner — status: **unverified**
- analysis constitution `ANALYSIS-11` / `-13` — suspected: the proto doc-comments (`composite_score = 21`, `symbol_score = 22`) may already state the ordinal discipline; what would confirm it: read those fields; if explicit, the "never wire into sizing" directive is partly free to read — status: **unverified**
- analysis constitution `ANALYSIS-17` — suspected: alias list (`qty`/`quantity`, `fill_price`/`price`, `mode`/`trading_mode`) and `"alpaca-default"` default; what would confirm it: only the anchors were verified, not the alias list — check `pnl_pattern_consumer.py#_handle_order_event` / `#_handle_close_event` — status: **unverified**
- analysis findings row 35 (A-F:35) — "deferred to feature 132" — suspected: stale finding (132 is `launched`); what would confirm it: retire via `/context-constitution refresh` after confirming `entry_backfill.py` imports `resolve_universe` (it does — see the contradicted row) — status: **unverified**
- trading `CLAUDE.md` L263 — `order_intent.late_response_conflict` "not yet emitted" — suspected: possible doc-lie; what would confirm it: grep the string; if emitted now, route as contradicted — status: **unverified**
- trading / portfolio / marketdata `CLAUDE.md` — Ledger Events tables (L144-163 / L137-144 / L252-260) — suspected: event names are string literals at the emit sites, and the tables are incomplete (portfolio omits `portfolio.position.updated`, `portfolio.watchlist.*`; marketdata omits `marketdata.backfill.data_deleted`); what would confirm it: decide: complete them as a consumer catalog, or reduce each to a pointer — status: **unverified**
- portfolio `CLAUDE.md` L108 — "marketdata exposes no sector" — suspected: rationale may be stale; what would confirm it: marketdata now has `GetCurrentSector`/`GetSectorAsOf` (feature 217); does Exposure deliberately not use it? — status: **unverified**
- trading `CLAUDE.md` L98, L13/L106, L126 — suspected: `max_position_pct` warn-only claim; paper/live priority (account `is_paper` > `trading.broker.paper` > `TRADING_MODE`); `ledgerEmitTimeout` 10 s; what would confirm it: confirm against `trading.go` L525, the L2683 comment, and the constant — status: **unverified**
- marketdata `CLAUDE.md` L210-215, L229 — suspected: EDGAR ROE/D-E bases; `BatchGetBars allow_partial`; what would confirm it: check whether `internal/edgar` doc comments already state the bases; decide CLAUDE.md vs constitution MARKETDATA-15 candidate — status: **unverified**
- trading / portfolio / marketdata / indicators constitutions: TRADING-5, TRADING-3, PORTFOLIO-4, PORTFOLIO-7, PORTFOLIO-13 (`PROTO-9` cross-ref), MARKETDATA-4, -9, -N2, INDICATORS-11 — suspected: possibly restated by in-code comments or dangling cross-refs; what would confirm it: each needs one grep/read named in the auditor digest (e.g. does `orderFillPayload` carry a "must match emitter tags" comment; does `PROTO-9` exist; does `sandbox.py:266` comment the `tempfile` pre-cache) — status: **unverified**
- trading findings L37 / L30; portfolio findings L38 — suspected: verified still open (`UpsertOrder` omits columns; `StreamOrderUpdates` has no caller; `CountPositions` has no callers); what would confirm it: keep open — listed so they are not mistaken for stale — status: **unverified**
- marketdata findings L11-12 — suspected: trivial comment drift tracked by `2026-10-19-marketdata-claude-md-drift-defect`; what would confirm it: drop if that report is no longer `open` — status: **unverified**
- indicators findings L37 (ATR two meanings) — suspected: indicators CLAUDE "Role" now states the close-to-close approximation (feature 268); what would confirm it: move to root findings / a PLAT note, or accept as a cross-module gotcha — status: **unverified**
- indicators `CLAUDE.md` L214 / ingest L177 `TRADING_MODE=paper`; L66-67 `LEDGER_ENDPOINT`; L20-22 owner-scoped list — suspected: `watcher.py` still reads/sends `TRADING_MODE`; ledger edge may be covered by root; list exactness; what would confirm it: vestigial env or needed proto field?; confirm with `tests/test_owner_scoped_completeness.py` — status: **unverified**
- config `CLAUDE.md` L28, L111 — suspected: "Docker healthcheck probes 50060 directly"; "`001_config_tables.up.sql` is the canonical seed list"; what would confirm it: only `EXPOSE 50060` found — check compose/`.do` HEALTHCHECK; CONFIG-9 says seeds are spread across 005/008/019/021–033 — status: **unverified**
- ingest `CLAUDE.md` L127 — suspected: `ingest.backfill.default_timeframe` "documented, not yet wired" matches code; what would confirm it: is the per-key note redundant with the findings ("9 dead config keys")? — status: **unverified**
- ingest constitution INGEST-4, INGEST-5; ingest findings N-F:15 — suspected: proto doc-comments may already state the `conviction` sentinel / `active_window` semantics; `main.py` resume comments (~L66, ~L117-119) unverified; what would confirm it: read `ingest.proto#ExternalSignal`, `#QuerySignalsRequest`, `app/main.py` — status: **unverified**
- config constitution L39-44 (candidate-rule row) — suspected: single maintainer-question table with no agent directive; what would confirm it: keep, fold into `C-F`, or delete after the feature-189 decision — status: **unverified**
- notify `CLAUDE.md` L128-133 — "never config-service rows (feature 076)" — suspected: root says feature 147 allows encrypted secret rows; code does read env (`fanout.ts:47-48`); what would confirm it: confirm Slack/SendGrid/VAPID are intentionally env-only, then reword "never" → "currently env-only" — status: **unverified**
- ledger constitution LEDGER-4, LEDGER-6; notify NOTIFY-4; ui constitution UI-8…UI-10, L35, L44, L50 — suspected: borderline restated (INSERT column list / handler guard visible in the edited file); LEDGER-6 duplicates ledger Invariant 5; what would confirm it: keep only if there are known regressions (PR #639, feature 094); confirm which side owns `owner_only` — status: **unverified**
- ui `CLAUDE.md` L269; L377-379; L82-93 — suspected: "read via `GetConfig` in `insightsBff.ts`" looks imprecise (the read is browser `insightsConfigClient` in `PerformanceDashboard.tsx` L75); "sharded across 2 runners"; the four facts behind the sanctioned exception; what would confirm it: confirm against `ci.yml`/`playwright.config.ts`/`.do/app.yaml` — status: **unverified**
- agent `CLAUDE.md` L156-160 ("EmitAlert is ungated; trust boundary is the network plus the OAuth edge"), L216, L35 — suspected: mTLS is fail-closed since feature 210; stored key `opportunities.read_timeout_seconds` `[30,55]` default `40` not grepped; what would confirm it: does notify check the peer SAN for `EmitAlert`? grep `app/tools.py`/`client.py` for the key — status: **unverified**
- agent constitution L29-32; agent findings L23 — suspected: `_BUCKETS_MS` ↔ `scripts/testdata/rpc-status-vectors.json` parity claim; `notify.proto` line anchors; what would confirm it: not re-verified — status: **unverified**
- `packages/proto/CLAUDE.md` L16-17 — suspected: "no CI job runs `go test` inside `packages/proto/`"; what would confirm it: `ci.yml` L287-301 runs `go test ./... -coverpkg=…` for some Go modules — confirm `packages/proto` is excluded — status: **unverified**
- root constitution PLAT-3/5/6/7/9/12/13/15 `~L` anchors, PLAT-N2 compose claims; LEDGER-3 consumer symbols; proto findings L12; root findings L25/27/36/37/40/41; NOTIFY-9 boot order — suspected: not re-grounded by the auditor for lack of budget; what would confirm it: spot-check at the next refresh — status: **unverified**
- docs/CLAUDE.md L15 `reports/` row — suspected: sidecar states (`open → triaged → resolved/wont-fix`) cited to `defect-filing.md`; what would confirm it: file exists; the states were not confirmed to match — status: **unverified**

**Contradicted-by-code rows** (the "Contradicted by code" section above) are carried here as `keep-but-verify` by rule (CF-N9) and are routed to `/context-constitution`'s findings log.

## Dropped as false positives (not in any table)

- **"Docker Build Pattern" pointer sections** in the service `CLAUDE.md` files (flagged `restated` by three auditors for trading, portfolio, marketdata, identity, ui). Root `CLAUDE.md` § Dockerfile Update Workflow *requires* each service's "Docker Build Pattern" section to be updated with its Dockerfile, so these are mandated, not redundant.
- **UI `CLAUDE.md` L38-64 vs `ui-ux-governance.md` L67-75 / L156-157** — two auditors named opposite keepers. Ruled: keep the UI `CLAUDE.md` (the operational home at the edit site), trim the governance doc to the rule + pointer (the one `dup` row above).
- **README L26 "gRPC-only… re-expose HTTP"** — duplicated in root, but README is human-facing and defers to the pattern docs; kept.
- **Resolved / struck-through rows and "Filed as defect reports" tables** in the findings files, and the `Pointers` tables in the constitutions, are deliberate history/navigation and pass the litmus test.

## Protected blocks (reported, never trimmed)

Sentinel-wrapped blocks owned by `/context-constitution` — listed for transparency, excluded from trimming (**CF-N11**). No row above touches them (checked mechanically: no flagged range intersects them).

| Block | Location | Marker |
|---|---|---|
| behavioral contract | `CLAUDE.md` L1-28 | `context-forge:behavioral-contract` |
| constitution pointer | `services/xstockstrat-ui/CLAUDE.md` L3-5 | `context-forge:constitution-pointer` |
| constitution pointer | `services/xstockstrat-agent/CLAUDE.md` L3-5 | `context-forge:constitution-pointer` |
| constitution pointer | `services/xstockstrat-identity/CLAUDE.md` L3-5 | `context-forge:constitution-pointer` |
| constitution pointer | `services/xstockstrat-ledger/CLAUDE.md` L3-5 | `context-forge:constitution-pointer` |
| constitution pointer | `services/xstockstrat-notify/CLAUDE.md` L3-5 | `context-forge:constitution-pointer` |
| constitution pointer | `services/xstockstrat-trading/CLAUDE.md` L3-5 | `context-forge:constitution-pointer` |
| constitution pointer | `services/xstockstrat-portfolio/CLAUDE.md` L3-5 | `context-forge:constitution-pointer` |
| constitution pointer | `services/xstockstrat-marketdata/CLAUDE.md` L3-5 | `context-forge:constitution-pointer` |
| constitution pointer | `services/xstockstrat-indicators/CLAUDE.md` L3-5 | `context-forge:constitution-pointer` |
| constitution pointer | `services/xstockstrat-ingest/CLAUDE.md` L3-5 | `context-forge:constitution-pointer` |
| constitution pointer | `services/xstockstrat-config/CLAUDE.md` L3-5 | `context-forge:constitution-pointer` |
| constitution pointer | `services/xstockstrat-analysis/CLAUDE.md` L3-5 | `context-forge:constitution-pointer` |
| constitution pointer | `packages/proto/CLAUDE.md` L3-5 | `context-forge:constitution-pointer` |
| constitution pointer | `packages/otel/CLAUDE.md` L3-5 | `context-forge:constitution-pointer` |

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins). These are low-signal lines to trim, not rules to keep — nothing grounded is dropped (**CF-N8**). Re-run `/context-scrubber` to re-audit._
