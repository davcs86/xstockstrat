# Context Scrub — Findings

Low-signal context surfaced by `/context-scrubber` on **2026-07-28**. Each row is a line in an
**auto-loaded** context file (`CLAUDE.md`, `context-constitution.md`, `context-constitution-findings.md`)
that an agent would find for free, that no longer resolves, that is duplicated, or that the code now
contradicts — dead weight paid for on every load. This is a report for triage; trimming is **gated**
(`/context-scrubber apply`), never automatic. Every row cites both the context line and the evidence it
fails. Re-run `/context-scrubber` to re-audit; run `/context-constitution` to add the knowledge that
*passes* (stale citations below are re-ground by that refresh, not by this skill).

> **Scope:** 52 targets audited (22 `CLAUDE.md` + 15 `context-constitution.md` + 15
> `context-constitution-findings.md`), via 5 parallel read-only auditors, every verdict re-confirmed against
> the actual code by the orchestrator. Protected sentinel blocks (1 behavioral-contract + 14
> constitution-pointers) were excluded by construction — see `## Protected blocks`.
>
> **⚠ security** marks rows touching an authz/authn/secret boundary. **Read this first:** the
> *Contradicted-by-code* section is a **defect log, not a delete list**. Under **CF-N9** every contradicted
> row is a *documentation-that-lies* defect whose honest fix — *implement the missing behavior* or *remove
> the doc* — is a human triage call routed to `/context-constitution`'s findings log; **`apply` never deletes
> it**. Only genuinely *redundant* (restated / duplicated) or *filler* (bloat / relocatable) rows are
> `apply` candidates. (This is the behavior change from the 2026-07-24 run, whose apply pass trimmed
> contradicted-by-code rows in place; those trims are **not** repeated here — those rows are reported and
> deferred instead.)

## Resolution status — full context-forge sequence ran 2026-07-28

This report was produced first (scan); then the sequence continued **constitution-refresh → re-audit →
apply**. What each row's category got:

- **Stale citations (8) → RE-GROUNDED.** All eight `path:line` drifts fixed in the constitution/findings
  files (analysis `servicer.py` after features 069–072; marketdata `handler.go`→`marketdata_handler.go`;
  trading TRADING-1 Example; UI `src/browserClients`→`src/lib/browserClients`; ingest `watcher.py`; agent).
- **Contradicted by code (24) → RESOLVED (nuanced, user-approved).** Unambiguous factual errors corrected
  in place (Go 1.22→1.25, Node 20→22, nginx-removed, config DELTA = full namespace, ledger immutability =
  triggers, indicators pool sizing, identity `jwt.secret` = env var, the four `pnpm run migrate` doc-lies).
  Clearly-fictional cruft removed (fictional ledger/notify deps + their env vars/events, the nine dead
  `ingest.signals.*`, dead `platform.ledger_endpoint` rows, `ingest.data.normalized`, `trading.maintenance_mode`).
  Plausibly-intended-but-unbuilt specs **preserved and reworded** "documented, not yet implemented" so no
  spec is buried (`trading.risk.daily_loss_limit`, `portfolio.risk.max_drawdown_pct`, `order.approved`,
  marketdata retention/compression/`ohlcv_1h`, ledger retention/compression/notify toggle, notify limits,
  indicators `sandbox.max_concurrent`).
- **Restated / Cross-file duplication / Bloat → PARTIALLY APPLIED.** Clean subtractions taken: root Language
  Map (restates Service Registry), three per-service `uv lock` lines (restate the root rule), otel PLAT-3
  gotcha collapsed to a pointer (CF-N3), root all-DONE roadmap table trimmed to prose (bloat). The
  service-specific Node "gRPC-only/80xx-removed" prose, "Running Locally" blocks, ports/env tables were
  **kept** (they carry local detail beyond the root restatement) and are left as reported.
- **Should be just-in-time (8) → DEFERRED.** A `move` needs the destination doc to already hold the content
  (apply never writes the destination — CF-N9/apply-protocol), so these await a follow-up that creates the
  on-demand homes (feature `design.md`, runbooks, `config-governance.md` registered-keys log).
- **Brittle (5) → DEFERRED.** Rewriting a block to a heuristic is an authored change, not a subtraction;
  left for a deliberate follow-up.

The category tables below are the **original audit** (line numbers as first scanned); use them as the triage
record. The live files now reflect the resolutions above.

## Summary

Savings are **measured** — lines and characters counted directly from the flagged ranges, not estimated.
No token-counting tool ran this session, so the token column is an explicit `≈ chars ÷ 4` approximation.

| Category | Failing rows | Lines | Characters | Tokens (≈ chars ÷ 4) |
|---|---|---|---|---|
| Stale citations | 8 | ~13 | — (re-ground) | — |
| Restated (agent reads for free) | 14 | ~62 | ~4,100 | ≈ 1,025 |
| Cross-file duplication | 3 | ~5 | ~1,000 | ≈ 250 |
| Contradicted by code | 24 | ~48 | — (routed, never deleted) | — |
| Should be just-in-time | 8 | ~162 | ~13,900 | ≈ 3,475 |
| Brittle / over-specified | 5 | ~100 | ~5,000 | ≈ 1,250 |
| Bloat / low-value prose | 5 | ~90 | ~4,000 | ≈ 1,000 |
| **Removable total** (restated + dup + bloat + JIT-relocation + brittle-trim; excludes contradicted + keep-but-verify) | **35** | **~257** | **~15,300** | **≈ 3,825** |
| Keep-but-verify (unconfirmed) | 7 | — | — | — |

> "Removable total" counts only what `apply` would actually subtract. A *just-in-time* row **relocates**
> (leaves a one-line pointer) and a *brittle* row **shortens to a heuristic** — neither is a bare deletion,
> so only the net-subtracted portion is counted (JIT/brittle full flagged ranges are ~19 KB; the pointer/
> heuristic left behind is ~4 KB, hence ~15 KB net). **Contradicted-by-code** rows (~48 lines) and
> `keep-but-verify` rows are excluded from any savings claim (CF-N9 / CF-1) — they are defects and
> unknowns, not redundancy.

## Stale citations

Citations that no longer resolve. These live inside `context-constitution*.md` bodies — the action is
**re-ground** (the code moved, the knowledge is intact), best done by a `/context-constitution` refresh, not
a scrubber trim.

| Context line | Citation it makes | Reality | Suggested action |
|---|---|---|---|
| `services/xstockstrat-analysis/docs/context-constitution.md:15` (ANALYSIS-2) — `_aggregate_cells` | `servicer.py:1575-1614`; provisional `:1087-1089` | `servicer.py` grew to ~2,217 lines (features 069–072); `def _aggregate_cells` now ~`:1922`, provisional ~`:1296` | re-ground both anchors |
| `services/xstockstrat-analysis/docs/context-constitution.md:16` (ANALYSIS-3) — `_definition_fingerprint` | `servicer.py:1681-1697`; stamped `:258-264` | now ~`servicer.py:2101`; stamped ~`:292` | re-ground |
| `services/xstockstrat-analysis/docs/context-constitution.md:14,22,30,32` — ANALYSIS-1 legacy path + best-effort/lock/header-prop gotchas | `servicer.py:581,586 / :1051,1141,1179 / :160-165,193-196 / :1054-1060` | all drifted (align now imported from `evaluator.py:46`; real sites ~`:1161/1199/1347`, `:191/224`, `:1261-1266`) | re-ground the `servicer.py` anchors (one root cause — regenerate) |
| `services/xstockstrat-marketdata/docs/context-constitution-findings.md:13` — "`handler.go` doc comment" | `internal/handler/handler.go:20-22` | file does not exist — actual handler is `internal/handler/marketdata_handler.go:20-21` | re-ground to `marketdata_handler.go` |
| `services/xstockstrat-trading/docs/context-constitution.md:14` (TRADING-1) — adapter-twin "Example" | `internal/handler/trading.go:178-209` | `:178` is `toGRPCError`; the `grpcTradingAdapter` is at `trading.go:109-176` | re-ground the Example to `:109-176` |
| `services/xstockstrat-ui/docs/context-constitution.md:16` (UI-2) | `src/browserClients/analysisClient.ts`, `traderAnalysisClient.ts` | dir is `src/lib/browserClients/` (verified: `src/browserClients/` does not exist); the CLAUDE.md copy at `:94/:241` is already correct | re-ground UI-2 paths to `src/lib/browserClients/*.ts` |
| `services/xstockstrat-ingest/docs/context-constitution-findings.md:27` — client_id copy-paste | `watcher.py:38` | actual `client_id=f"indicators-…"` at `watcher.py:36` | re-ground to `:36` |
| `services/xstockstrat-agent/docs/context-constitution-findings.md:11,17` | `client.py:635`, `tools.py:29` | `get_config_value` at ~`client.py:678`/`:689`; `_ALERT_THRESHOLD_CONFIG_KEY` at `tools.py:32` | re-ground |

## Restated facts (agent reads for free) — fails CF-N4

Lines repeating what's plain in the one file an agent would edit, a manifest, or a doc/CI file it already
loads. Root `CLAUDE.md`'s Service Registry, Language table, and env-var convention are the free-to-read
homes.

| Context line | What restates it (free to read) | Why it fails | Suggested action |
|---|---|---|---|
| `CLAUDE.md:99–107` — Language Map | Service Registry table 4 lines up (`CLAUDE.md:76–95`, Language column) | same fact, same file | remove |
| `services/xstockstrat-indicators/CLAUDE.md:164`, `xstockstrat-ingest/CLAUDE.md:105`, `xstockstrat-analysis/CLAUDE.md:302` — "After any change to `pyproject.toml`, run `uv lock`…" | root CLAUDE.md §Language Versions "Python uv lock rule" (global, CI-enforced) | verbatim per-service restatement of a root rule | remove (keep only root) |
| `services/xstockstrat-trading/CLAUDE.md:31–38`, `portfolio:21–28`, `marketdata:29–36` — Ports table + "gRPC-only / 80xx removed" | root Service Registry (ports) + §Service-to-Service Calls | pure restatement of root | remove / collapse to pointer |
| `services/xstockstrat-ledger/CLAUDE.md:25–28`, `identity:31`, `notify:28–29`, `config:26–28` — "former HTTP/Connect-RPC on 80xx removed" | root §Service-to-Service Calls / §Env-var convention | restated root boilerplate | remove |
| `services/xstockstrat-ledger/CLAUDE.md:122–128`, `identity:127–133`, `notify:67–73`, `config:87–93` — "Running Locally" (`pnpm install/migrate/dev`) | `package.json` scripts | free-to-read from the manifest ⚠ **entangled**: the `pnpm run migrate` line is *also* a doc-lie (see Contradicted) — so this block is reported, not auto-trimmed | trim the restated commands **only** via `/context-constitution` (migrate line is CF-N9) |
| `services/xstockstrat-ledger/CLAUDE.md:15–17`, `identity:15–17`, `notify:15–17`, `config:15–17` — "Docker Build Pattern — see docs/patterns/docker-build.md" | contentless pointer stub, identical ×4 | no service-specific delta | collapse to the constitution-pointer or omit |
| Go/Node env-var blocks (`trading:163–174`, `portfolio:88–98`, `marketdata:110–125`; Node `DATABASE_URL=…` line ×4) | `docker-compose.yml` service blocks (the editable source) | restates compose env | trim to non-obvious vars only (e.g. `BROKER_ACCOUNTS_ENCRYPTION_KEY`) |

## Cross-file duplication — CF-N3

Same rule/fact in ≥2 context files. Keep the copy highest in the tree.

| Context line | Duplicate location(s) | Which copy to keep | Suggested action |
|---|---|---|---|
| `packages/otel/docs/context-constitution.md:21` — full port-by-runtime OTLP split gotcha (re-derived evidence) | root `docs/context-constitution.md:28` (PLAT-3); the bullet itself says "This is stated as root PLAT-3" | root | trim to a one-line pointer to PLAT-3 |
| `services/xstockstrat-analysis/CLAUDE.md:88` & `:257` — EB shrinkage formula | same formula at `analysis/docs/context-constitution.md:15` (ANALYSIS-2) **and** root CLAUDE.md §Config Governance | the constitution rule (ANALYSIS-2) | trim the CLAUDE.md prose to a pointer, keep the bare default row |
| `CLAUDE.md:419` — feature "Numbering rule: `max(existing NNN) + 1`" | `docs/roadmap/features/CLAUDE.md:5` + `docs/runbooks/feature-workflow.md` (canonical) | feature-workflow.md (cited authority) | trim root to a one-line pointer |

> Also cross-referenced (counted under Contradicted, not here): the Go 1.22 line duplicates across
> `trading:25 / portfolio:16 / marketdata:23` **and** is stale — a triple duplicate that is *also* a
> version doc-lie.

## Contradicted by code

Context claims the code now disproves — *documentation that lies*. Under **CF-N9** these are **defects, not
scrub targets**: the honest fix (implement the behavior, or remove the doc) is a human triage call, so every
row is **routed to `/context-constitution`'s findings log** and carried as `keep-but-verify` — excluded from
the removable total, and **`apply` never deletes it**. ⚠ security-boundary rows first.

| Context line | What the code does | Evidence | Suggested action |
|---|---|---|---|
| ⚠ `services/xstockstrat-identity/CLAUDE.md:80` — `identity.jwt.secret` listed as a consumed config key | reads `process.env.JWT_SECRET`, throws if unset; `grep src/ = 0` for the config key | `src/grpc/identityServiceImpl.ts:30-31` (IDENTITY-1) | route: it is an **env var**, not a config key — fix via `/context-constitution`, never `apply`-deleted |
| ⚠ `CLAUDE.md:364–368` — Header Propagation "**every** backend must propagate … Node.js **AsyncLocalStorage**"; "**Nginx** strips them" | 4 Node leaf services make no outbound per-request calls; `src/middleware/propagation.ts` has **zero importers** (dead) in all four; nginx removed (feature 045) | `services/xstockstrat-{ledger,identity,notify,config}/src/middleware/propagation.ts` (0 importers); root `CLAUDE.md:205,484`; findings `docs/context-constitution-findings.md:17` | route: scope the rule to outbound callers; drop the AsyncLocalStorage/nginx claims |
| `services/xstockstrat-trading/CLAUDE.md:25`, `portfolio:16`, `marketdata:23` — "Go 1.22" | `go.mod` = `go 1.25.0` in all three; root table says Go 1.25 | `services/xstockstrat-{trading,portfolio,marketdata}/go.mod:3` | route: correct to 1.25 (root Language Map owns it) |
| `services/xstockstrat-ledger/CLAUDE.md:13`, `notify:13`, `config:13` — "Node.js 20" | Dockerfiles are `FROM node:22-alpine`; root table says Node 22 (`identity:13` is already correct) | `services/xstockstrat-{ledger,notify,config}/Dockerfile` | route: correct to 22 |
| `services/xstockstrat-trading/CLAUDE.md:62` — `trading.risk.daily_loss_limit` "Halt trading if day loss exceeds 2%" | no code reads it; no daily-loss halt | grep `internal/`+`cmd/` = zero | route: implement or remove the row |
| `services/xstockstrat-trading/CLAUDE.md:63` — `trading.maintenance_mode` "reject all new orders" | code reads only `platform.maintenance_mode` | `internal/service/trading.go:244` | route: fix the key name / remove |
| `services/xstockstrat-trading/CLAUDE.md:64` — `platform.ledger_endpoint` as a config key | ledger addr from `LEDGER_ENDPOINT` env | `internal/config/config.go:36` | route: remove the config row |
| `services/xstockstrat-trading/CLAUDE.md:103` — `order.approved` in emitted-events table | no emit site, no Approve RPC | grep `internal/` = zero | route: implement approval or remove |
| `services/xstockstrat-portfolio/CLAUDE.md:47` — `portfolio.risk.max_drawdown_pct` "Alert if drawdown exceeds 10%" | value read then discarded: `_ = maxDrawdownPct` | `portfolio_service.go:595,623` | route: remove the "alert" behavior claim (key is inert) |
| `services/xstockstrat-marketdata/CLAUDE.md:72–73` — `retention.quotes_days` / `retention.ohlcv_years` as consumed config | zero code reads | grep `internal/` = zero | route: remove the rows |
| `services/xstockstrat-marketdata/CLAUDE.md:79–81` — hypertables "compress after 7 days / 24 h"; `ohlcv_1h` "auto-computed continuous aggregate" | no `add_compression_policy`/`add_retention_policy`; no `ohlcv_1h` migration | `migrations/` grep = zero | route: remove the claims |
| `services/xstockstrat-ledger/CLAUDE.md:9` & `:32` — immutability "via PostgreSQL **rules** (`NO UPDATE`/`NO DELETE`)" | enforced via **triggers** (`deny_mutation`) | `migrations/001_ledger_events_hypertable.up.sql:47,54,58` | route: fix rules → triggers |
| `services/xstockstrat-ledger/CLAUDE.md:62–71` — config keys `notify_enabled`, `retention.years`, `compression.after_days`, `platform.ledger_endpoint` | zero code reads | grep `src/` = zero | route: remove the rows |
| `services/xstockstrat-notify/CLAUDE.md:46–54` — config keys `max_subscribers`, `retention_days`, `max_body_bytes` | no subscriber cap / retention job / body-size check | grep `src/` = zero | route: remove the rows |
| `services/xstockstrat-notify/CLAUDE.md:43` — dependency "xstockstrat-ledger — emit alert lifecycle events" (+ `LEDGER_ENDPOINT`) | no ledger client; `LEDGER_ENDPOINT` unread | grep `src/` = zero | route: remove the fictional dep |
| `services/xstockstrat-identity/CLAUDE.md:49` — dependency "xstockstrat-ledger — auth event audit trail" (+ `LEDGER_ENDPOINT`) | no ledger client; auth events are `log.info` only | grep `src/` = zero | route: remove the fictional dep |
| `services/xstockstrat-indicators/CLAUDE.md:37–38` — deps on ledger/notify + Events-Emitted table | no ledger/notify client; `LEDGER_ENDPOINT`/`NOTIFY_ENDPOINT` unread | grep `app/` = zero | route: remove the fictional dep surface |
| `services/xstockstrat-indicators/CLAUDE.md:55` — pool `create_pool(…, min_size=2, max_size=10)` | actual `min_size=1, max_size=DB_POOL_MAX(=2)`; `max_size=10` would blow the 20-conn budget | `app/main.py:49-50` | route: fix to the real pool sizing |
| `services/xstockstrat-indicators/CLAUDE.md:66` — `indicators.sandbox.max_concurrent` "Max concurrent sandbox executions" | no `Semaphore`/concurrency limit | grep `app/` = zero | route: remove the row |
| `services/xstockstrat-ingest/CLAUDE.md:74–83` — nine `ingest.signals.*` keys | zero code reads; dedup key contradicted by unconditional INSERT | grep `app/` = zero | route: remove the rows |
| `services/xstockstrat-ingest/CLAUDE.md:68` — `ingest.backfill.default_timeframe` | zero reads; servicer falls back to literal `"1d"` | grep `app/` = zero | route: remove the row |
| `services/xstockstrat-ingest/CLAUDE.md:84` — `platform.ledger_endpoint` config key | zero reads | grep `app/` = zero | route: remove the row (**new this pass** — not in the prior findings) |
| `services/xstockstrat-ingest/CLAUDE.md:94` — Events-Emitted `ingest.data.normalized` | `NormalizeRawData` only counts rows; no `AppendEvent` | `servicer.py:599-611` | route: remove the row |
| `services/xstockstrat-config/CLAUDE.md:51` — "Subsequent messages: `update_type=DELTA` (changed keys only)" | sends the **full** namespace: `changedKeys: Object.keys(values)` | `configServiceImpl.ts:161` (CONFIG-1) | route: fix — DELTA carries the full namespace |
| `services/xstockstrat-config/CLAUDE.md:56` — `pg_notify` payload `{namespace, key}` | payload also carries `environment`, `trading_mode` | `configServiceImpl.ts:266` (CONFIG-4) | route: fix the documented payload |
| `services/xstockstrat-ledger/CLAUDE.md:126`, `identity:131`, `notify:71`, `config:91` — "`pnpm run migrate`" | `package.json` `migrate`=`node-pg-migrate`; real migrations are golang-migrate `NNN_*.sql` via `scripts/db-migrate.sh` | `package.json` + `scripts/db-migrate.sh` | route: fix or drop the command (entangled with the Restated "Running Locally" block) |

## Should be just-in-time (pre-loaded → pointer)

Accurate but narrow / rarely-needed detail auto-loaded on every task. Relocate + leave a one-line pointer;
this is a `move`, not a delete.

| Context line(s) | Why it's mis-placed | On-demand home | Suggested action |
|---|---|---|---|
| `services/xstockstrat-analysis/CLAUDE.md:63–114` — Cross-Stock Score Derivation narrative (worked arithmetic, FR-3/OQ-6/FR-9 caveats) | design.md-grade detail; the binding invariant already lives in ANALYSIS-2/3 | `docs/roadmap/features/065-*/design.md` | move + pointer to the constitution rule |
| `services/xstockstrat-analysis/CLAUDE.md:123–162` — Pre-Window Warm-Up Prefix (feature 071) internals (EMA IIR seed, VWAP anchor, page cap) | deep backtest-engine internals loaded on every analysis task | `services/xstockstrat-analysis/docs/` feature note | move + pointer |
| `CLAUDE.md:178–193` — feature 065/068 "Recently added keys" tables (defaults, provisional thresholds, per-key zero-trap) | per-feature detail loaded on every task; root itself names the registered-keys log as the home | `docs/patterns/config-governance.md` (registered-keys log — currently missing these keys) | move + pointer |
| `services/xstockstrat-trading/CLAUDE.md:183–196` — "IBKR: Hedged Mode not supported" + 3-step add recipe | only matters when editing `internal/broker/ibkr.go` for an unsupported feature | trading constitution gotchas / an IBKR doc | move |
| `services/xstockstrat-identity/CLAUDE.md:100–114` — full `manage-users.sh` create/reset/docker-exec usage | operational detail loaded on every identity task | `scripts/manage-users.sh` header / a runbook | move |
| `services/xstockstrat-identity/CLAUDE.md:116–125` — JWT deploy-secret table (`DEV/PROD_JWT_SECRET` → workflow/app.yaml) | deploy-time detail | deploy workflows / `docs/setup` | move |
| `services/xstockstrat-ui/CLAUDE.md:209–218` — Playwright browser-resolution mechanics (exec path, skip-download, Firefox drop) | narrow e2e-harness detail on every UI task | a comment in `playwright.config.ts` or `docs/patterns/nextjs-frontends.md` | move |
| `services/xstockstrat-ui/CLAUDE.md:166–170` — SSR pre-warming `setup` project / `ROUTES` array maintenance | e2e-only maintenance detail | a testing doc | move |

## Brittle / over-specified (anti-altitude)

Instruction blocks that steer the agent too rigidly — long enumerations a one-line heuristic would cover.
Keep the intent as a heuristic; don't drop the behavior.

| Context line(s) | Why it's brittle | Heuristic it should become | Suggested action |
|---|---|---|---|
| `CLAUDE.md:296–330` — Dockerfile Update Workflow (5-step chain + "Common updates" list) | ~35-line mechanical checklist that rots as files move; already links `docker-build.md` twice | "Touch a Dockerfile → update the service CLAUDE.md + `docs/patterns/docker-build.md`, then rebuild; see docker-build.md" | trim to heuristic |
| `CLAUDE.md:136–154` — Version Bump Workflow file-list table | exhaustive per-tool file map; only the proto-plugin dual-pin drift warning is non-obvious | keep the dual-pin warning; replace the file map with "bump the table first, then propagate to CI + Dockerfiles; CI catches misses" | trim to heuristic (keep drift warning) |
| `services/xstockstrat-ui/CLAUDE.md:172–207` — "Page reuse (future optimization)" BEFORE/AFTER code block + candidate-spec enumeration | a full code sample for a *not-yet-applied* refactor + a hand-maintained spec-file list that drifts | "group same-route tests into a serial `describe` with a shared `beforeAll` to avoid repeated `page.goto`" | trim to a heuristic |
| `services/xstockstrat-trading/CLAUDE.md:124–135` — per-broker replaceable-field matrix (Alpaca vs IBKR PATCH) | reference detail only for `ReplaceOrder` adapter work | pointer to a broker doc / trading constitution | move/trim |
| `services/xstockstrat-config/CLAUDE.md:44–60` — WatchConfig ASCII flow diagram | elaborate step-by-step whose DELTA branch is factually wrong (see Contradicted `:51`) | "WatchConfig streams a SNAPSHOT then full-namespace DELTAs on `config_changed` NOTIFY" | trim to heuristic (DELTA line via `/context-constitution`) |

## Bloat / low-value prose

Verbose filler that shapes no agent action.

| Context line(s) | Why it is filler | Suggested action |
|---|---|---|
| `CLAUDE.md:396–414` — Implementation Roadmap Status (Phase 0–7 table, all **DONE**) | every row is DONE and the section itself says "coarse phase map only; all phases are now DONE" and "do not track individual feature status here" | trim to one line + a pointer to `implementation-roadmap.md` |
| `docs/roadmap/features/CLAUDE.md:102–159` — "Automation: Preventing Stale Statuses" (3 mechanisms + Workflow Summary table) | narrates `ci-validate-feature-status.yml`; the actionable rule is already at the bottom ("don't manually update statuses after promotion") | trim to the one rule + a pointer |
| `services/xstockstrat-analysis/CLAUDE.md:13–31` — Strategy Score Persistence (feature 064) | opens by saying feature 065 supersedes it, then spends ~18 lines on superseded design; the surviving fact ("`strategy_scores` is a restart-surviving cache") is one line | trim to one line |
| `services/xstockstrat-marketdata/CLAUDE.md:84–95` — FMP Fundamentals prose | re-expresses the `marketdata.fmp.*` config table (`:66–71`) in prose | trim |
| `CLAUDE.md:166–170` — Approval Flow matrix | restates the matrix the linked `docs/runbooks/approval-flow.md` owns | trim to the pointer |

## Context budget (file-level)

Whole context files whose **measured** size strains attention (context rot). Advisory — a prompt to
review/split, never an automatic removal. Soft budget ~2,000 chars is deliberately conservative; a monorepo
module CLAUDE.md legitimately runs 3–6 KB, so only files over budget are listed (biggest first).

| File | Measured lines | Measured characters | Over soft budget? |
|---|---|---|---|
| `CLAUDE.md` (root, always-loaded) | 515 | 34,172 | yes — by far the largest |
| `services/xstockstrat-analysis/CLAUDE.md` | 318 | 25,067 | yes — grew via appended feature changelogs (064/065/062/071) |
| `services/xstockstrat-ui/CLAUDE.md` | 248 | 13,917 | yes |
| `services/xstockstrat-trading/CLAUDE.md` | 196 | 13,718 | yes |
| `services/xstockstrat-marketdata/CLAUDE.md` | 135 | 13,429 | yes |
| `docs/context-constitution.md` | 69 | 12,039 | yes (well-maintained; content passes the litmus) |
| `services/xstockstrat-indicators/CLAUDE.md` | 171 | 8,983 | yes |
| `docs/roadmap/features/CLAUDE.md` | 159 | 7,552 | yes |
| `services/xstockstrat-agent/CLAUDE.md` | 119 | 7,036 | yes |
| `services/xstockstrat-identity/CLAUDE.md` | 133 | 6,732 | yes |
| `services/xstockstrat-ingest/CLAUDE.md` | 118 | 6,746 | yes |
| `services/xstockstrat-portfolio/CLAUDE.md` | 98 | 6,627 | yes |
| `services/xstockstrat-ledger/CLAUDE.md` | 128 | 6,192 | yes |

## Keep-but-verify (unconfirmed — CF-1)

Suspected low-signal, but not grounded in this pass. Confirm before treating as removable — never trimmed by
`apply`.

- `CLAUDE.md:224–246` — Connection Pool Budget "Notes" column (per-service `AccountRepo`/`Pool()` reuse, ledger `EventNotifier` narrative): the ≤20-total rule is cross-cutting (keep); are the per-service Notes still accurate vs each service's `DB_POOL_MAX`/`pgxpool.MaxConns`? — status: **unverified**
- `services/xstockstrat-config/docs/context-constitution.md:24–28` — candidate rule flags `waitForSnapshot` default 10 s (`configWatcher.ts:71`) vs 90 s in `docs/patterns/config-startup.md`: confirm whether these are two different timers before treating the "conflict" as real — status: **unverified**
- `services/xstockstrat-notify/docs/context-constitution-findings.md:24` — `jsonwebtoken` + `bcrypt` flagged as dead deps copied from the identity template; confirm with an import scan / `pnpm why` — status: **unverified**
- `packages/proto/docs/context-constitution-findings.md:16–17` — `common.v1.Decimal` / `common.v1.Error` "zero references": grep of `.proto` + service source (excluding `gen/`) shows only the definitions — **appears confirmed**, but re-check before any proto change — status: **likely-real, unactioned**
- `services/xstockstrat-agent/docs/context-constitution.md:19` (AGENT-5) — cites `tools.py:346,405,…`; actual sites are `+1` (likely a whitespace shift, symbols resolve); re-anchor on next refresh — status: **unverified**
- `services/xstockstrat-agent/CLAUDE.md:88–92` — config table lists only `agent.oauth.*` but code also reads `signal.alert_threshold` + `source.<slug>.credentials` (`client.py`, `tools.py`) — an *omission* (table incomplete), not a failing line; decide complete-vs-leave — status: **unverified**
- `docs/patterns/CLAUDE.md` — index may omit `client-api-pattern.md` (present on disk); verify whether it should be listed — status: **unverified**

## Protected blocks (reported, never trimmed)

Sentinel-wrapped blocks owned by `/context-constitution` — excluded from trimming (CF-N11). A stale-looking
pointer here is resolved by re-running `/context-constitution`, not by this skill.

| Block | Location | Marker |
|---|---|---|
| behavioral contract | `CLAUDE.md:1–22` | `context-forge:behavioral-contract` |
| constitution pointer | `services/xstockstrat-trading/CLAUDE.md:3–5` | `context-forge:constitution-pointer` |
| constitution pointer | `services/xstockstrat-portfolio/CLAUDE.md:3–5` | `context-forge:constitution-pointer` |
| constitution pointer | `services/xstockstrat-marketdata/CLAUDE.md:3–5` | `context-forge:constitution-pointer` |
| constitution pointer | `services/xstockstrat-indicators/CLAUDE.md:3–5` | `context-forge:constitution-pointer` |
| constitution pointer | `services/xstockstrat-ingest/CLAUDE.md:3–5` | `context-forge:constitution-pointer` |
| constitution pointer | `services/xstockstrat-analysis/CLAUDE.md:3–5` | `context-forge:constitution-pointer` |
| constitution pointer | `services/xstockstrat-agent/CLAUDE.md:3–5` | `context-forge:constitution-pointer` |
| constitution pointer | `services/xstockstrat-ledger/CLAUDE.md:3–5` | `context-forge:constitution-pointer` |
| constitution pointer | `services/xstockstrat-identity/CLAUDE.md:3–5` | `context-forge:constitution-pointer` |
| constitution pointer | `services/xstockstrat-notify/CLAUDE.md:3–5` | `context-forge:constitution-pointer` |
| constitution pointer | `services/xstockstrat-config/CLAUDE.md:3–5` | `context-forge:constitution-pointer` |
| constitution pointer | `services/xstockstrat-ui/CLAUDE.md:3–5` | `context-forge:constitution-pointer` |
| constitution pointer | `packages/otel/CLAUDE.md:3–5` | `context-forge:constitution-pointer` |
| constitution pointer | `packages/proto/CLAUDE.md:3–5` | `context-forge:constitution-pointer` |

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins). These are low-signal lines to trim,
not rules to keep — nothing grounded is dropped (**CF-N8**). Re-run `/context-scrubber` to re-audit._
