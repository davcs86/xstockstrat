# Context Scrub — Findings

Low-signal context surfaced by `/context-scrubber` (scan mode) on **2026-08-27**. Each row is a line in an
**auto-loaded** context file (root + nested `CLAUDE.md`, per-module `context-constitution.md` /
`context-constitution-findings.md`) or an opt-in publish-facing target (`README.md`,
`docs/patterns/ui-ux-governance.md`) that an agent would find for free, that no longer resolves, that is
duplicated, or that the code now contradicts — dead weight paid for on every load. This is a report for triage;
trimming is **gated** (`/context-scrubber apply`), never automatic. Every row cites both the context line and the
evidence it fails. Re-run `/context-scrubber` to re-audit; run `/context-constitution` (refresh) to fix the
drift that dominates this report.

> **Scope:** 56 context files audited across the monorepo via 8 parallel read-only auditors (root, docs+extra
> targets, and one per service/package cluster); every verdict below was confirmed by the orchestrator against
> the current tree. **No protected sentinel block was audited** — every `CLAUDE.md`'s
> `context-forge:constitution-pointer` block (lines 3–5) was found and skipped.

> **⚠ Read this first — the shape of the problem.** The overwhelming majority of findings are **drift, not
> filler**: the per-module constitutions were forged 2026-07-24 (a few re-grounded 2026-07-28) and code has
> moved since, so their `path:line` anchors point at the wrong lines (symbols still resolve — moved, not gone),
> and **feature 147** (removed the `trading_mode` config axis, moved secrets into encrypted config) plus
> **feature 020** (live-config fanout in notify) left several rules describing behavior the code no longer has.
> **The right remedy for most of this is a `/context-constitution` refresh per module, not a scrubber delete.**
> Only a modest set of genuinely-redundant / over-loaded lines are `apply`-trimmable (see Summary).

## Summary

Savings are **measured** — characters counted directly from the flagged line ranges (not estimated). No
token-counting tool ran this session, so no token column is shown; any token figure would be an explicit
`≈ chars ÷ 4` approximation.

| Category | Failing findings | Action class | Measured chars | In removable total? |
|---|---|---|---|---|
| Stale citations (line-drift) | ~40 (grouped by file) | **re-ground** via `/context-constitution` | — (symbols resolve; not deletable) | no |
| Restated (agent reads for free) | 8 | remove / compress | ~2,300 | yes |
| Cross-file duplication | 9 | remove-from-module / point-to-root | ~1,600 | yes |
| Contradicted by code | 12 (7 in config alone) | **route to findings log** (defect) | — (never `apply`-deleted, CF-N9) | no |
| Should be just-in-time | 8 | move-to-`docs/` + pointer | ~15,700 (relocated off every load) | partial (relocated, not deleted) |
| Brittle / over-specified | 5 | trim to a heuristic | ~1,900 | partial |
| Bloat / low-value prose | 3 | trim | ~1,700 | yes |
| **Removable total** (remove/trim only; excludes keep-but-verify, contradicted, and JIT relocations) | 16 | — | **~5,600** | — |
| Keep-but-verify (unconfirmed) | 9 | verify first | — | no |

> The biggest *attention* win is not deletion but the ~15,700 chars of **just-in-time** feature-internal detail
> that could move behind pointers (the pattern the analysis service already models at `CLAUDE.md:137–139`). The
> biggest *correctness* win is the **config** service constitution, whose feature-147 drift makes 7 of its rules
> actively wrong.

---

## Stale citations

Systemic `path:line` drift: the per-module constitutions were forged 2026-07-24 and code grew since, so nearly
every line anchor is off (by tens to thousands of lines). **Symbols still resolve by name** (grep-confirmed), so
the action is **re-ground**, a `/context-constitution` refresh — **not** remove. Grouped by file with a
confirmed representative; the whole file is affected unless noted.

| Context file | Representative drift (confirmed) | Reality | Suggested action |
|---|---|---|---|
| `services/xstockstrat-analysis/docs/context-constitution.md` (ANALYSIS-1..6, gotchas) | cites `align_indicator_points` at `evaluator.py:295` | actual `services/xstockstrat-analysis/app/services/evaluator.py:437` | re-ground whole file (`servicer.py` now 4,363 lines) |
| `packages/proto/docs/context-constitution.md` (PROTO-1..5, gotchas) | PROTO-5 cites `config.proto:56/127` (default/current_value) | actual `config.proto:159` (field 3) / `:167` (field 9) | re-ground every proto anchor; field numbers are correct |
| `packages/proto/docs/context-constitution-findings.md:21` | `analysis.proto:74,141,177` (side/rating) | `side` at `:160`, `rating` at `:229` | re-ground |
| `services/xstockstrat-config/docs/context-constitution.md` (CONFIG-3,5,6) | CONFIG-3 cites `MODE_MAP`/`ENV_MAP` at `configServiceImpl.ts:19-20` | `MODE_MAP` gone (grep zero); `ENV_MAP` now `{0:staging,1:staging,2:production,3:staging}` at `:33` | re-ground **and** rewrite (see Contradicted) |
| `services/xstockstrat-agent/docs/context-constitution.md` (AGENT-1,2,3,5, scar 111) | AGENT-5 cites `_grpc_error_message` def `tools.py:96` | actual `app/tools.py:184`; `insecure_channel` first open `client.py:172` not `:115` | re-ground |
| `services/xstockstrat-ingest/docs/context-constitution.md` (INGEST-3,5, dedup gotcha) | INGEST-3 `page_token` at `servicer.py:606,948` | actual `:632,974`; `_DuplicateSignal` def `:777` | re-ground (~20–60 line drift) |
| `services/xstockstrat-trading/docs/context-constitution.md` (TRADING-1, N1) | TRADING-N1 cites `extractUserID` at `handler/trading.go:211-221` | actual `:234`; adapter method ranges no longer line up | re-ground |
| `services/xstockstrat-portfolio/docs/context-constitution.md` (PORTFOLIO-1,6) | `enrichPositions` at `portfolio_service.go:312-314` | actual def `:332`, skip-guard `:334` | re-ground |
| `services/xstockstrat-marketdata/CLAUDE.md:70` + constitution Pointers | both cite `fundamentalsEnabled()` at `marketdata_service.go:966` | actual `:1143` (line 966 is a bare `return`) | re-ground (same wrong line in two files) |
| `services/xstockstrat-marketdata/docs/context-constitution-findings.md:10,11,19` | self-cite `CLAUDE.md:77/75-76/68-69` | actual CAGG/compression text at `CLAUDE.md:87-88,95`; retention keys at `:81-82` | re-ground self-references |
| `services/xstockstrat-ui/docs/context-constitution.md` (UI-1,4, scar `d92960b`) | UI-4 cites `src/lib/auth.ts:63-79` | actual `auth.ts:93-113`; `OrderForm` `symbolLocked` now `:76` | re-ground |
| `services/xstockstrat-trading/docs/context-constitution-findings.md:12-15` | self-cite `CLAUDE.md:58/59/60/99` | rows now at `CLAUDE.md:69` / removed / removed / `123` | re-ground self-references |
| `docs/context-constitution.md:28,33` (PLAT-3, PLAT-8 example) | PLAT-3 docker-compose 4318 at `:119,150,182,215,474` | actual `:127,158,190,223,484` (~+8 each) | re-ground |
| `services/xstockstrat-identity/CLAUDE.md:52-58` | enumerates migrations `000`–`005` | `migrations/006_user_metadata.*.sql` exists, undocumented | re-ground (or drop the enumeration — it's a free `ls`) |

> **otel** (`packages/otel/**`) is the clean exception: every cited `path:line`/metric/label was confirmed
> accurate — no drift.

## Restated facts (agent reads for free) — fails the litmus test

| Context line | What restates it (free to read) | Why it fails | Suggested action |
|---|---|---|---|
| `services/xstockstrat-ui/CLAUDE.md:191-203` (Dependencies table gRPC ports) | root `CLAUDE.md:96-105` Service Registry | ports 50051–50060 are the registry; only the "Used by" column is new | remove ports, keep "Used by" |
| `services/xstockstrat-ui/CLAUDE.md:254-271` (Environment Variables list) | root §Environment Variable Naming + Service Registry | `<SVC>_ENDPOINT=host:port` is mechanically derivable | keep only `DB_POOL_MAX=1` + `JWT_SECRET` edge note |
| `services/xstockstrat-ui/CLAUDE.md:104-110` (Ports table) | root Service Registry (`xstockstrat-ui … 3000`) | "HTTP 3000, no gRPC" already in root | compress to one line |
| `services/xstockstrat-analysis/CLAUDE.md:155-157` (gRPC-only, port 8056 removed) | root §Service-to-Service Calls | negative-history note; `8056` exists nowhere in-tree | remove |
| `services/xstockstrat-analysis/CLAUDE.md:143` (Language "Python 3.13") | root §Language Versions + `pyproject.toml` | free to read | remove |
| `services/xstockstrat-ingest/CLAUDE.md:98-106` (Ledger Events Emitted table) | grep-able literals in `app/handlers/servicer.py:256,326,406,341,896` | table adds only a trivial trigger gloss | trim to pointer |
| `services/xstockstrat-agent/CLAUDE.md:19-28, 72-120` (propagation + authz prose) | this service's own constitution (AGENT-3/4) + `app/tools.py` | prose is longer than the rule it mirrors | compress; defer to constitution |
| `services/xstockstrat-ledger/docs/context-constitution-findings.md:23` & `services/xstockstrat-notify/docs/context-constitution-findings.md:11` | each service's own `CLAUDE.md` "Documented, not yet enforced" annotation | findings row restates the CLAUDE.md flag | trim to a back-pointer |

## Cross-file duplication — keep the copy highest in the tree

| Context line | Duplicate location(s) | Keep | Suggested action |
|---|---|---|---|
| `docs/context-constitution.md:29` (PLAT-4 dead `propagation.ts`) | root `CLAUDE.md:369` (states it) + `docs/context-constitution-findings.md:17,33` + `services/xstockstrat-config/docs/context-constitution-findings.md:21` | root `CLAUDE.md` | drop the PLAT-4 parenthetical; findings owns the fix |
| `services/xstockstrat-config/docs/context-constitution-findings.md:21` (dead propagation.ts) | root `CLAUDE.md:369` | root | keep only the feature-074/eslint detail |
| `services/xstockstrat-ui/CLAUDE.md:226-231` (per-service×segment baseUrl binding) | `services/xstockstrat-ui/docs/context-constitution.md:16` (UI-2, + 404 symptom) | CLAUDE.md (highest) | consolidate the 404 note into one home |
| `services/xstockstrat-ui/CLAUDE.md:247` "20-connection budget" | root `CLAUDE.md:214` "~22 connections" | root | fix number (also a Contradiction — see below) |
| `services/xstockstrat-agent/CLAUDE.md:122-129` (secret-write: AES-GCM, `is_secret`, `secret.*` retired) | root `CLAUDE.md` §Config Governance | root | compress to "secrets follow root config-governance rules" |
| `services/xstockstrat-indicators/CLAUDE.md:80-91` (sandbox: RLIMIT_DATA, BLAS/OMP pin, builtin filter) | `services/xstockstrat-indicators/docs/context-constitution.md:15-18` (INDICATORS-1/2/4) | CLAUDE.md | state once; the constitution already cross-refs it |
| Alpaca API-surface boundary | `services/xstockstrat-trading/CLAUDE.md:11` + `services/xstockstrat-marketdata/CLAUDE.md:9,18-19` | root Service Registry roles | one canonical statement |
| SEV-1 `WatchConfig` zero-scope scar (root PLAT-8) | trading `constitution.md:30`, portfolio `:28`, marketdata `:33` (+ marketdata findings Resolved:29) | root PLAT-8 | compress per-service copies to "our instance of root PLAT-8, fixed in `1413399`" |
| `services/xstockstrat-ledger/CLAUDE.md:37-53` (pool max=1 + EventNotifier=2) | root `CLAUDE.md` Connection Pool Budget (ledger row) | root | trim the arithmetic; **keep the portfolio-3-subscriptions deadlock scar** (value-add) |

## Contradicted by code — defects (CF-N9), routed to `/context-constitution` findings, never `apply`-deleted

⚠-marked rows touch a secret/authz boundary. These are **documentation that lies**; the fix (implement, or
correct the doc) is a human triage call. Every row is **routed to the relevant module's
`context-constitution-findings.md`** and carried in Keep-but-verify below — none is `apply`-deletable.

| Context line | What the code does | Evidence | Route to |
|---|---|---|---|
| ⚠ `services/xstockstrat-config/docs/context-constitution.md:41` (Pointer, secret-handling) — "`is_secret` rows store a **reference key**, never plaintext; pass-through, never resolved/masked" | AES-256-GCM ciphertext in `value_encrypted`, `[redacted]` sentinel in `value_data`, decrypt only via `GetSecret` | `configServiceImpl.ts:17,24,314-326`; `migrations/017_*.up.sql:8-11` | config findings — retired feature-076 model; rewrite to feature-147 |
| `services/xstockstrat-config/docs/context-constitution.md:16-21` (CONFIG-3..8) — describe the `trading_mode` axis + `MODE_MAP`/`resolveMode` | feature 147 removed the axis; scope is now `environment × user_id` | `migrations/017_*.up.sql:5-22`; `configServiceImpl.ts:33,85,423` | config findings — rewrite CONFIG-3..8 |
| `services/xstockstrat-config/CLAUDE.md:85` (WatchConfig diagram) — `pg_notify` payload `{…, trading_mode}` | payload is `{namespace, key, environment, user_id}` | `configServiceImpl.ts:503-504` | config findings — doc-lie |
| `services/xstockstrat-config/docs/context-constitution.md:42` (Pointer) — "`trading_mode='all'` rows fan into paper+live+all" | axis removed | `migrations/017_*.up.sql:13-22` | config findings |
| ⚠ `services/xstockstrat-notify/docs/context-constitution.md:15` (NOTIFY-3) — "`ConfigWatcher` only gates startup; no config read at runtime; `this.config` referenced nowhere" | 5 `notify.fanout.*` keys read live per dispatch | `src/fanout/fanout.ts:61,69,76,100,101`; service's own `CLAUDE.md:85` agrees | notify findings — feature-020 drift |
| `docs/context-constitution.md:33,48` (PLAT-8) — mandates resolving `TRADING_MODE` into the `trading_mode` request field | field deprecated + no longer set | `services/xstockstrat-trading/internal/config/config.go:140` ("deprecated and ignored … feature 147") | root findings — strike the `trading_mode` half (env half still holds) |
| `docs/context-constitution.md:31` (PLAT-6) — "secrets are the deliberate exception (env-only)" | secrets moved into encrypted config | root `CLAUDE.md` §Config Governance; `configServiceImpl.ts:22-23,57` | root findings — drop the env-only clause |
| `services/xstockstrat-ui/CLAUDE.md:247` — "part of the platform's **20-connection** budget" | root now says **~22** | root `CLAUDE.md:214` | ui findings (also cross-file dup above) |
| `README.md:35` — `cp .env.example .env # fill in ALPACA_API_KEY, ALPACA_API_SECRET, JWT_SECRET` | those two vendor vars were removed (feature 147); `.env.example` says "never in this file" | `.env.example:29-33`; root §Environment Variable Naming | root findings — doc-lie; misleads first-run setup (JWT_SECRET still valid) |
| `docs/patterns/ui-ux-governance.md:193` — durable UI suite "holds only **two** files, both partial" | 8 `.feature` files on disk | `services/xstockstrat-ui/acceptance/*.feature` (8 files) | ui findings — stale count; §8 "none" coverage cells follow |
| `services/xstockstrat-config/docs/context-constitution.md:17` (CONFIG-4) — LISTEN handler defaults missing fields to `'dev'`/`'all'` | reads `{namespace, environment}`, defaults env to `'staging'`, no mode field | `configServiceImpl.ts` LISTEN handler | config findings |
| `services/xstockstrat-config/docs/context-constitution.md:20` (CONFIG-7) — `ListKeys` de-dupes mode-`all` vs shadow rows | JS dedup removed by feature 147; the service's own test says so | `src/__tests__/listKeysDedup.test.ts:4-5` | config findings |

## Should be just-in-time (pre-loaded → pointer)

Accurate, feature-internal detail auto-loaded on **every** task in that service. The analysis service already
models the fix at `CLAUDE.md:137-139` (defers fingerprint/EB math to `docs/scoring.md`); these do not. Relocate
+ leave a one-line pointer.

| Context line(s) | Why it's mis-placed | On-demand home | Chars off every load |
|---|---|---|---|
| `services/xstockstrat-ui/CLAUDE.md:123-185` (Opportunities-first shell, feature 083) | ~60 lines of component/nav/mobile-offcanvas internals | this service's `docs/` (like the e2e split at `:310`) | 5,525 |
| `services/xstockstrat-analysis/CLAUDE.md:92-124` (P&L pattern consumer, feature 042) | migration-016 table + retention + v1 limitations | `docs/pnl-patterns.md` | 2,859 |
| `services/xstockstrat-trading/CLAUDE.md:173-203` (Broker State Reconciliation) | grace-ticks / halted-poll / feature-101 UNKNOWN internals | this service's `docs/` | 2,787 |
| `services/xstockstrat-agent/CLAUDE.md:105-137` (authz corner cases) | `manage_formula`/`EmitAlert`/secret-write/key-gate narrow cases | service `docs/` alongside `oauth.md` | 2,559 |
| `services/xstockstrat-analysis/CLAUDE.md:187-215` (Backtest Fill Model, feature 151) | deferred-execution state-machine mechanics | `docs/` (config-key row `:289` already carries the default) | 1,963 |
| `services/xstockstrat-analysis/CLAUDE.md:128-135` (Decide-surface RPCs) | dense per-RPC internals incl. fan-out worst-case math | feature dirs / `docs/opportunities.md` | (subset) |
| `services/xstockstrat-trading/CLAUDE.md:147-158` (per-broker replaceable-field matrix) | Alpaca-vs-IBKR mapping needed only for `ReplaceOrder` | alongside `ibkr.md` | (subset) |
| `services/xstockstrat-ui/CLAUDE.md:37-42` (shadcn `add`/`--preset` command incantations) | narrow procedural how-to | a styling doc (keep the regenerate-overwrites scar inline) | (subset) |

## Brittle / over-specified (anti-altitude)

| Context line(s) | Why it's brittle | Heuristic it should become |
|---|---|---|
| `services/xstockstrat-ui/docs/context-constitution.md:15` (UI-1) — "Only **2 of ~10** conversion sites import the helper" | hand-maintained adoption inventory; grep now shows **4** importers | "use `timestampToMillis`/`timestampToDate`; don't hand-roll" |
| `services/xstockstrat-ui/CLAUDE.md:49-58` (`sidebar.tsx` `data-active` fix) | ~10 lines explaining a one-line change | "pass `\|\| undefined`, not the raw boolean — bare `[data-active]` matches on presence" |
| `services/xstockstrat-trading/CLAUDE.md:81,89` (config-key description cells) | 3–5-line clamp/throttle algorithm prose duplicating code comments | "read live; `<=0` = pause/disable — see `syncPositions`/`reconcileTick`" |
| `services/xstockstrat-analysis/CLAUDE.md:70-77` (Fundamentals producer) | 7 sub-bullets restating `_resolve_universe` branch logic | "daily FMP-cache-only producer; see `fundsignal_loop.py`" + config keys |
| `services/xstockstrat-agent/docs/context-constitution.md:20` (AGENT-5) | inline apology about citation drift ("the line list is intentionally not enumerated") | keep only "a new tool must add `_grpc_error_message` explicitly" |

## Bloat / low-value prose

| Context line(s) | Why it is filler | Suggested action |
|---|---|---|
| `docs/context-constitution-findings.md:18` (Go 1.22 row, ✓ RESOLVED) | resolution text says "now read Go 1.25" but repo pins **Go 1.27** — a resolved row with stale resolution text | prune (or move to a dated `## Resolved`) |
| `docs/context-constitution-findings.md:19` (notify/identity deps row, ✓ RESOLVED) | fully resolved; no open defect | prune to `## Resolved` |
| `services/xstockstrat-analysis/CLAUDE.md:172-185` (Backtesting defaults) | restates runtime defaults (SMA 20/50, 95% sizing) an agent reads from the evaluator | trim |

## Context budget (file-level)

Measured, advisory — a prompt to review/split, never an automatic removal. This repo's convention runs large,
richly-structured module docs, so the template's ~2,000-char soft budget flags nearly every file; the meaningful
signal is the **top attention-rot risks**, biggest first. (The JIT relocations above are the concrete lever for
the top three.)

| File | Measured lines | Measured chars | Note |
|---|---|---|---|
| `services/xstockstrat-analysis/CLAUDE.md` | 378 | 42,557 | largest; JIT relocations (`92-124`, `128-135`, `187-215`) trim most |
| `CLAUDE.md` (root) | 509 | 37,938 | the always-loaded platform doc; unavoidably large, but audit its tables against the registry |
| `services/xstockstrat-ui/CLAUDE.md` | 348 | 24,983 | JIT relocation of `123-185` is the main lever |
| `services/xstockstrat-trading/CLAUDE.md` | 241 | 22,841 | JIT `173-203`, `147-158` |
| `services/xstockstrat-marketdata/CLAUDE.md` | 165 | 21,948 | mostly config-key tables (mandated) |
| `docs/patterns/ui-ux-governance.md` | 257 | 20,112 | extra target; strong except the §8 stale suite table |
| `docs/context-constitution.md` (root PLAT-*) | 73 | 16,628 | fix PLAT-6/8 (Contradicted) |
| `services/xstockstrat-agent/CLAUDE.md` | 188 | 14,707 | JIT `105-137` |

## Silent skills (weak trigger surface)

Scanned: **18** in-repo skills · excluded as symlinked-out: **0** (the two `.claude/skills → .agents/skills`
symlinks resolve inside the repo).

_None._ Every audited skill `description` carries a usable trigger surface — an explicit *when-to-use* clause,
user-facing phrasings, or named artifacts/commands (e.g. `plugins/strat-lab/skills/backtest/SKILL.md:3`
"Use when the user asks to backtest a strategy, sweep a parameter…", command-only with a clear human cue; all
`sdd-*`, `onboard`, `promote`, `digitalocean-setup`, `proofread-claude-md`, `form4-enhanced-ingest`,
`migrate-radix-to-base`, `shadcn` likewise). Nothing to flag.

## Keep-but-verify (unconfirmed — CF-1)

Suspected or defect-routed items needing a human decision before any action:

- **Contradicted-by-code rows above are carried here by construction** — each is a defect for
  `/context-constitution` to fix (implement vs. correct the doc); `apply` never touches them.
- `services/xstockstrat-analysis/CLAUDE.md:377`, `services/xstockstrat-indicators/CLAUDE.md` & `-ingest/CLAUDE.md` — list `TRADING_MODE=paper` env var; code **still reads it** (`app/config/watcher.py:48`, `app/telemetry.py:29`) as a telemetry attribute, so the listing is faithful to code, but it's in tension with root's "paper/live derived from environment (feature 147)." Confirm whether these services should still resolve mode from `TRADING_MODE`, or annotate it telemetry-only. Same for `ledger/identity/notify` `CLAUDE.md` env blocks.
- `services/xstockstrat-trading/CLAUDE.md:13` — mode-resolution fallback lists `ALPACA_PAPER (env)`, but no reader of `ALPACA_PAPER` was found in trading source. Verify it exists or drop it.
- `services/xstockstrat-trading/CLAUDE.md:75` — `platform.trading_state` "Seeded per `trading_mode` (feature 100)" likely stale post-147 (migration `011` seeds by environment). Verify against migration 011.
- `README.md:3,26` — describes **three** UI segments (trader/insights/config); the app ships **four** (`src/app/{trader,insights,config-ui,accounts}/`; `ui-ux-governance.md:3` lists four). Root `CLAUDE.md` also says three. Publish-facing README is behind the code — confirm and add `/accounts`.
- `services/xstockstrat-ui/docs/context-constitution-findings.md:10,16,18` — three open UI defects (missing `BASE_PATH_ACCOUNTS`; ⚠ audit route has no admin check; NamespaceEditor non-admin Edit affordance) — all re-confirmed still reproducing; **keep open**, not scrub targets.
- `services/xstockstrat-ingest/docs/context-constitution-findings.md:12,13` — `ingest.backfill.default_timeframe` still documented-but-unwired (`servicer.py:125` hardcodes `"1d"`); the `data.normalized` doc-lie row references a table entry that no longer exists — close or rewrite the latter.
- `services/xstockstrat-marketdata/docs/context-constitution-findings.md:10,11` — CAGG/compression "documentation that lies" rows are now **stale-resolved** (`CLAUDE.md:87-88,95` correctly say "planned, not yet applied") — move to a Resolved section; the sibling migration-001 / dual-RPC rows remain valid.
- `docs/context-constitution-findings.md:20` (Node 20→22 row) — narration says "Node.js 22" but repo pins **Node 24**; the underlying `@types/node ^20` pin is **still live** (`services/xstockstrat-ledger/package.json`). Keep the row, bump "22"→"24".

## Protected blocks (reported, never trimmed)

Every `CLAUDE.md` carries a `context-forge:constitution-pointer` sentinel block at lines **3–5** (root, all 10
service dirs, both packages) — the constitution/findings pointer owned by `/context-constitution`. Found and
excluded from the audit; not listed individually. No `behavioral-contract` sentinel block was found in any file.

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins). These are low-signal lines to trim, not
rules to keep — nothing grounded is dropped (**CF-N8**). The dominant remedy here is a per-module
`/context-constitution` refresh (re-ground drifted anchors, rewrite feature-147/020 contradictions), not
deletion. Re-run `/context-scrubber` to re-audit._
