# Context Scrub — Findings

Low-signal content surfaced by `/context-scrubber scan` on 2026-08-09 — a **fully unscoped, full-repo
consolidation** superseding both the 2026-08-02 full scan and this same day's earlier 15-target scoped
scan. Every one of the 54 context targets (23 `CLAUDE.md` + 30 `context-constitution*.md` + `README.md`)
plus all 15 repo skills and the `plugins/strat-lab/` reference files were freshly re-verified against
current code via 8 parallel read-only auditors (10, counting the earlier same-day 15-target pass whose
results are folded in unchanged since nothing in scope has moved since). Every row cites both the
context line and the evidence it fails.

**Apply update (same day):** 9 clean, mechanical, pure-subtraction rows were applied immediately —
marked **✅ APPLIED** below wherever they appear. The remaining restated/duplicate/JIT/bloat rows
needed a structural rewrite (a new pointer, a merged table, a judgment call on which copy to keep)
rather than a pure deletion, so they went through a follow-up **interactive fix pass**: each judgment
call was put to the user via 4 batches of questions, and every explicit choice (not just the
recommended option — several times the user picked the non-default) was applied. **28 rows are now
✅ APPLIED** in total; a small number were explicitly reviewed and left as-is per the user's choice
(marked **left as-is** with the reason). Stale citations and contradicted-by-code rows are still
never scrubber-trimmed by design (CF-N9) — those remain `scan`-only, routed to `/context-constitution`
and the plugin owner respectively.

> ⚠ No security-*boundary*-contradicting rows found in this pass. Four still-open ⚠ security findings
> (config-ui audit-route admin gap, identity's unsigned-token revoke, the fundsignal admin-bit
> self-grant, the indicators sandbox env-inheritance) were reconfirmed live in their own findings logs —
> they are legitimate open questions already correctly tracked there, not new context-drift.

## Summary

Measured directly from the flagged lines (no tokenizer available this run — lines/characters only, per
CF-1: never an invented token count).

| Category | Failing rows | Lines | Characters |
|---|---|---|---|
| Stale citations | 45 | ~50 | not counted — every row is a **re-ground**, not a deletion |
| Restated (agent reads for free) | 14 | ~16 | ≈ 5,900 |
| Cross-file duplication | 16 | ~22 | ≈ 8,700 (most are intentional current-state/history splits or pointer-pattern-working-as-intended — low actionability; ~6 are clean, unflagged duplicates worth trimming) |
| Contradicted by code | 9 | ~20 | — (routed to findings logs / the plugin owner, never a removal target — CF-N9) |
| Should be just-in-time | 5 | ~130 | ≈ 12,000 |
| Brittle / over-specified | 5 | ~60 | ≈ 3,600 |
| Bloat / low-value prose | 5 | ~55 | ≈ 6,900 |
| **Removable total** (restated + ~6 clean duplicates + bloat, excluding JIT bytes since a move isn't a deletion) | ~25 | ~35 | ≈ 12,800 |
| **Applied same-day** (pure subtractions, no new content needed) | 9 | ~30 | ≈ 4,300 |
| **Applied via interactive follow-up** (structural rewrites: new pointers, merged tables, judgment calls — 4 user-decision batches) | 19 | — | — |
| **Applied total** | 28 | — | — |
| Keep-but-verify (unconfirmed) | 15 | — | — |

> The single highest-value fix in this whole report is still the fully-resolved 13-row MCP-tool-alignment
> audit table in `xstockstrat-agent`'s findings log (JIT + bloat, same content, listed once). The single
> highest-value **defect** is the `strat-lab` plugin skill's self-grill/output-handling contradiction with
> the live backend (features 070/072) — it teaches the agent to run a self-check that fails against
> current code, and it needs an upstream fix in `davcs86/agent-plugins`.

## Stale citations

All 45 are **re-ground**, not remove — the cited knowledge is still true, only the `path:line`/target
drifted. Grouped by target; the first 35 are unchanged from this session's earlier 15-target pass
(re-verified, still accurate), the next 10 are new from this consolidation's `CLAUDE.md`/`README.md` sweep.

### Constitution/findings layer (15-target pass, unchanged)

| Context line | Citation it makes | Reality | Suggested action |
|---|---|---|---|
| root `docs/context-constitution-findings.md:16` | `docker-compose.yml:119,150,182,216,470` | 4318-port lines are actually `:119,150,182,215,474` | re-ground |
| root `docs/context-constitution-findings.md:32` | `getEnvBool` at `trading/config.go:55`, `portfolio/config.go:195-208`, `marketdata/config.go:201` | actual: trading `:60-66`, portfolio `:237-247`+`:249-250`, marketdata `:231-…` | re-ground |
| root `docs/context-constitution-findings.md:38` | `analysis/watcher.py:36`, `ingest/watcher.py:38` | `client_id=f"indicators-{id(self)}"` is at `:61` in both | re-ground to `:61` |
| root `docs/context-constitution-findings.md:26` | `ingest/watcher.py:60-90` | value traps are at `:93,101,117` | re-ground |
| root `docs/context-constitution-findings.md:19` | `ingest/servicer.py:254,278,806` | actual sites `:255,279,868` | re-ground |
| proto `docs/context-constitution.md:15` (PROTO-2) | `trading.proto:188` for `is_paper` | field is at `:202` (current) / `:225` (deprecated) | re-ground |
| proto `docs/context-constitution.md:18` (PROTO-5) | `config.proto:56` (`default_value`), `:127` (`current_value`) | actual: `:122` and `:130` | re-ground — added this session, not independently grep-verified before writing |
| proto `docs/context-constitution.md:14` (PROTO-1) | `analysis.proto:60` for `CoverageGap` vs `common.TimeRange` | `CoverageGap` starts `:61`, `TimeRange` fields `:64,68` | re-ground |
| proto `docs/context-constitution.md:26` (account_id gotcha) | `portfolio.proto:118,124`; `trading.proto:97,132` | portfolio: `:124,130`; trading: `:51,102` | re-ground |
| proto `docs/context-constitution-findings.md:10` | `indicators.proto:48` | field is at `:49` | re-ground |
| proto `docs/context-constitution-findings.md:21` | `analysis.proto:74,141,177`; `trading.proto:44,151` | analysis: `:103,172`; trading: `:44,159` | re-ground |
| config `docs/context-constitution.md:14` (CONFIG-1) | `configServiceImpl.ts:178-200`, `:196` | actual `:181-203`, `:199` | re-ground |
| config `docs/context-constitution.md:16` (CONFIG-3) | `:19-20`, `:84`, `:90` | actual `:22-23`, `:87`, `:93` | re-ground |
| config `docs/context-constitution.md:26` (gotcha) | `:65` | actual `:68` | re-ground |
| config `docs/context-constitution.md:19` (CONFIG-6, added this session) | prose says `$2`/`$3` | actual query params are `$3`/`$4` | fix the prose paraphrase |
| ledger `docs/context-constitution-findings.md:23` | `CLAUDE.md:62-67` | table is now at `:65-70` | re-ground |
| trading `docs/context-constitution.md:36` (candidate) | `trading.go:678-728` | that's `CancelOrder`; the real fill-poller race is `pollFills` at `:1150,1192-1200` | re-ground |
| trading `docs/context-constitution-findings.md:11` | `CLAUDE.md:58` | row now at `:67` | re-ground |
| trading `docs/context-constitution-findings.md:12` | `CLAUDE.md:63`, `trading.go:244` | row now at `CLAUDE.md:72`; check now at `trading.go:315` | re-ground |
| trading `docs/context-constitution-findings.md:14` | `CLAUDE.md:99`, `trading.go:320-328` | row now at `CLAUDE.md:120`; logic now `trading.go:435-488,573-580` | re-ground |
| trading `docs/context-constitution-findings.md:24` | `trading_repo.go:71` | the literal `false` is at `:75` | re-ground |
| agent `docs/context-constitution.md:19` (AGENT-4, touched this session) | `app/client.py:28` | def is at `:29` | re-ground |
| agent `docs/context-constitution.md:20` (AGENT-5) | `app/tools.py:96` | def is at `:125` — drifted because this session's own AGENT-3b insertion added ~29 lines above it | re-ground |
| agent `docs/context-constitution-findings.md:43` (F-8, touched this session) | `app/tools.py:1018-1053` | actual forward is at `:1099` | re-ground / extend range |
| marketdata `docs/context-constitution.md:31` (gotcha) | `cmd/server/main.go:129,133` | poller launches are `:121,125` | re-ground |
| marketdata `docs/context-constitution.md:30` (gotcha) | `internal/alpaca/client.go:145` | function moved to `:159` | re-ground |
| marketdata `docs/context-constitution.md:26` (MARKETDATA-N1) | `marketdata_service.go:767,797` | `select {` statements are at `:769,799` | re-ground |
| analysis `docs/context-constitution-findings.md:17-18` | `evaluator.py:210-247` | the call is at `:265`, inside `:264-291` | re-ground |
| analysis `docs/context-constitution.md:20,29` (ANALYSIS-7 + gotcha) | bare `docs/reports/...md` paths | need a `../../../` prefix to resolve from this service's own docs/ | fix relative path prefix |
| analysis `docs/context-constitution.md:26` (gotcha) | `app/config/watcher.py:102-113` | function body is `:103-114` | re-ground |
| analysis `docs/context-constitution.md:39` (Pointer) | "root CLAUDE.md §Config Governance Rules" | detail actually lives in this service's own CLAUDE.md §Config Keys Consumed | repoint |
| ingest `docs/context-constitution.md:18` (INGEST-4) | `ingest.proto:109` | field is at `:110` | re-ground |
| ingest `docs/context-constitution.md:18` (INGEST-5) | `ingest.proto:126-137` | block is `:127-138` | re-ground |
| ingest `docs/context-constitution.md:14` (INGEST-1) | `backfill_chunks.py:18-22` | proto-free claim is stated at `:1-7` | re-ground |
| ingest `docs/context-constitution-findings.md:21` | `signal_sources.py:6` | `get_active_source` def is at `:34` | re-ground |

### `CLAUDE.md` / `README.md` layer (this consolidation, new)

| Context line | Citation it makes | Reality | Suggested action |
|---|---|---|---|
| root `CLAUDE.md:169` (Approval Flow) | points readers to `docs/runbooks/approval-flow.md` for proto/config/service/DB-migration approvals | that doc is entirely about **trading order approvals** — the actual role matrix (Platform Lead/DBA/Proto Reviewer) lives in `docs/runbooks/reviewer-registry.md`. Same wrong citation also exists at `docs/runbooks/feature-workflow.md:178` — a repo-wide mixup | repoint both to `reviewer-registry.md` |
| root `CLAUDE.md:117` | "buf ... installed by `scripts/bootstrap.sh`" | buf is installed inside `Dockerfile.codegen` (run via `scripts/localenv-setup.sh`), not `bootstrap.sh` | fix the install-location claim |
| root `CLAUDE.md:118` | "golang-migrate \| latest \| ... installed by `scripts/bootstrap.sh`" | installed via `scripts/Dockerfile.migrate`, and pinned to `MIGRATE_VERSION=4.17.1`, not "latest" | fix both the location and the version claim |
| root `CLAUDE.md:119` | "golangci-lint ... run via `golangci-lint-action@v6`" | CI (`.github/workflows/ci.yml:223`) now pins `@v7` | re-ground the action version |
| `docs/patterns/CLAUDE.md:9` | `nginx-routing.md` = "Adding a new frontend to the nginx reverse proxy" | nginx removed (feature 045); the file's own neighbors already say "historical reference" | reword to match |
| `docs/runbooks/CLAUDE.md:8` | approval-flow described as "(API / n8n / UI)" | n8n removed (feature 011) | drop the "n8n" token |
| `docs/CLAUDE.md:13` | `setup/` row says "First-time Alpaca, DigitalOcean, Grafana Cloud, **or n8n setup**" | `docs/setup/n8n.md` is a deprecated stub (`docs/setup/CLAUDE.md:11` marks it) | drop "or n8n setup" |
| `docs/patterns/CLAUDE.md:5-18` (table) | lists 12 pattern files | `docs/patterns/*.md` has 15 files on disk — missing `client-api-pattern.md`, `dry-guard-rail.md`, `strat-lab-plugin.md` | add the 3 missing rows |
| `docs/runbooks/CLAUDE.md:5-18` (table) | lists 12 runbook files | 14 files on disk now — missing `reviewer-registry.md` **and** `infra-cost-reduction.md` (new since 2026-08-02) | add both missing rows |
| `README.md:83` | SDD skill list omits `sdd-archiver` and `sdd-qa` | both exist on disk and are referenced elsewhere in this same repo | add both to the list |

## Restated facts (agent reads for free) — fails CF-N4

| Context line | What restates it (free to read) | Why it fails | Suggested action |
|---|---|---|---|
| `xstockstrat-ledger/docs/context-constitution.md:16` (LEDGER-3) | this service's own `CLAUDE.md` § Live Streaming Architecture | verbatim mechanism match; LEDGER-3 adds the consumer-risk framing CLAUDE.md lacks | ✅ **APPLIED** — trimmed the mechanism restatement, kept the added "why" |
| `xstockstrat-identity/docs/context-constitution.md:17` (IDENTITY-4) | `CLAUDE.md`'s OAuth section (near-identical `aud`-bound-JWT sentence) | same fact, same wording | ✅ **APPLIED** — CLAUDE.md's OAuth section now points at IDENTITY-4 instead of restating it |
| `xstockstrat-identity/docs/context-constitution.md:14` (IDENTITY-1) | `CLAUDE.md`'s Config Keys note | partial overlap; IDENTITY-1 adds the PLAT-6-exception rationale | ✅ **APPLIED** — kept IDENTITY-1 in full, trimmed the CLAUDE.md Config Keys note to a pointer |
| `xstockstrat-indicators/docs/context-constitution-findings.md:11` | `CLAUDE.md:64` (already self-flags "not yet enforced") | the finding's "docs claim it's real" framing is now stale | ✅ **APPLIED** — moved to `## Resolved` with a note that CLAUDE.md now self-documents the gap |
| `xstockstrat-analysis/docs/context-constitution.md:25` | `CLAUDE.md:201` (`analysis.strategy.scored` row) | adds nothing beyond CLAUDE.md's own row | ✅ **APPLIED** — replaced with a one-line pointer |
| `xstockstrat-analysis/docs/context-constitution.md:26` (gotcha) | `CLAUDE.md:167,193` (`get_int_present` rows) | verbatim overlap on the two specific keys | ✅ **APPLIED** — shortened to a pointer, kept the file-wide claim |
| `xstockstrat-analysis/docs/context-constitution.md:15` (ANALYSIS-2) | `CLAUDE.md:163` (identical formula) | some duplication is by design (CLAUDE.md points *to* ANALYSIS-2) | ✅ **APPLIED** — elided the formula from CLAUDE.md, kept it only in ANALYSIS-2 |
| `xstockstrat-ingest/docs/context-constitution.md:14` (INGEST-1) | `backfill_jobs.py:1-6`, `backfill_chunks.py:1-7` docstrings | near word-for-word | ✅ **APPLIED** — trimmed to a shorter pointer at the docstring |
| `xstockstrat-ingest/docs/context-constitution.md:15` (INGEST-2) | `backfill_jobs.py:11-12,53-56` comment | near word-for-word | ✅ **APPLIED** — trimmed to a shorter pointer at the docstring |
| `xstockstrat-agent/CLAUDE.md:133-140` | `app/client.py:878-889` (`get_config_value` docstring) | the feature-093 environment-scoping paragraph paraphrases the docstring 1:1 | ✅ **APPLIED** — shrunk to a pointer, kept the config-key table |
| `xstockstrat-config/CLAUDE.md:38-52` (Critical Invariant #7) | `src/grpc/authz.ts:29-97` (JSDoc + `INTERNAL_CALLER_ALLOWLIST`) | structure/allowlist example verified verbatim in both | acceptable overlap (this is the canonical doc site) — low priority |
| `docs/CLAUDE.md:19-42` ("Common Scenarios → Right File") | root `CLAUDE.md` Context Guide + the child indexes (`patterns/`, `runbooks/`, `setup/CLAUDE.md`) | an agent following any single link gets the same routing for free | ✅ **APPLIED** — every row mapped to one file in one subdirectory (zero genuinely cross-directory scenarios survived the filter), so the table was replaced with a pointer to the child indexes |
| `packages/proto/CLAUDE.md:7` | root `CLAUDE.md:39` ("single source of truth for all gRPC/Protobuf contracts") | verbatim phrase | harmless one-liner intro — low priority |
| `packages/otel/CLAUDE.md:7-9` | `docs/patterns/observability.md:5-6` (local-dev vs. production OTLP routing) | identical split stated in both | low-value churn to fix — verified accurate, not urgent |

## Cross-file duplication — CF-N3

| Context line | Duplicate location(s) | Which copy to keep | Suggested action |
|---|---|---|---|
| `packages/proto/docs/context-constitution.md:24` (Timeframe not interval-ordered) | root `docs/context-constitution.md:49` | root (cross-cutting) | ✅ **APPLIED** — removed from proto |
| root `docs/context-constitution.md:55` (candidate: RPC bare-message-vs-wrapper) | `packages/proto/docs/context-constitution.md:32` | proto (proto-specific governance) | ✅ **APPLIED** — removed from root |
| `packages/proto/CLAUDE.md:10` ("never Read/Grep `gen/`") | root `CLAUDE.md:464-466` (stated 3× — once per stub language) | root | intentional local-echo pattern for a package a reader opens directly — low priority |
| `README.md:24-42` (Service Registry table) | root `CLAUDE.md` §Service Registry (same 12 rows minus Role) | root | ✅ **APPLIED** — trimmed README to names + a pointer to CLAUDE.md §Service Registry for the detail |
| `docs/roadmap/features/CLAUDE.md:13-24` (Feature Lifecycle Statuses, includes `design-approved`) | root `CLAUDE.md` §Feature Roadmap (same enum, **missing** `design-approved`) | `docs/roadmap/features/CLAUDE.md` (more complete) | ✅ **APPLIED** — replaced root's enum enumeration with a pointer to `docs/roadmap/features/CLAUDE.md` |
| root `docs/context-constitution.md:46` (Python config zero-trap gotcha) | root `docs/context-constitution-findings.md` CF-N10 row | — | explicitly cross-referenced by the authors ("also logged as a defect... and here as the fix") — intentional, low actionability |
| `xstockstrat-portfolio/docs/context-constitution.md:24` (gotcha) | `xstockstrat-portfolio/docs/context-constitution-findings.md:10` | — | explicitly cross-referenced — low actionability |
| `xstockstrat-notify/docs/context-constitution.md:21-22` (gotchas) | `xstockstrat-notify/docs/context-constitution-findings.md:14-18,28` | — | explicitly cross-referenced both directions — low actionability |
| `xstockstrat-agent/docs/context-constitution.md:26` (AGENT-3b) | the feature-111 scar bullet, same file | AGENT-3b (standing rule) | **left as-is** — this rule+narrative split is a repo-wide pattern used elsewhere (e.g. CONFIG-6/CONFIG-7 + the `#884` scar); the scar's forensic detail isn't redundant with the rule's forward-looking statement |
| `xstockstrat-analysis/docs/context-constitution.md:20,29` (ANALYSIS-7 + `63a3655` gotcha) | same file | ANALYSIS-7 (standing rule) | cross-referenced by design; scar restates rather than adds |
| `xstockstrat-config/CLAUDE.md:38-52` | `xstockstrat-config/docs/context-constitution.md` PLAT-9 gotcha (which itself says "already documented in this service's own CLAUDE.md item 7") | CLAUDE.md (this is the primary doc site) | self-acknowledged, intentional — low actionability |
| `xstockstrat-config/CLAUDE.md:67` ("DELTA ... FULL namespace ... wholesale replace") | CONFIG-1 (same invariant, same wording) — stated a **third** time in the CLAUDE.md constitution-pointer summary too | CLAUDE.md body | ✅ **APPLIED** — CONFIG-1's Rule cell now points at CLAUDE.md § WatchConfig Flow instead of restating the mechanism; the constitution-pointer summary line is untouched (protected sentinel, CF-N11) |
| `xstockstrat-identity/CLAUDE.md:80` | IDENTITY-1 (`docs/context-constitution.md:14`) | either | ✅ **APPLIED** — same edit as the IDENTITY-1 row above |
| `xstockstrat-analysis/CLAUDE.md:167,193` | `docs/context-constitution.md`'s `get_int_present` gotcha | CLAUDE.md (per-key table is the right home) | same underlying fact stated 3× total — trim the constitution copy (see Restated above) |
| `README.md:28-41` (service/port table) | root `CLAUDE.md` §Service Registry | root | ✅ **APPLIED** — same edit as the README Service Registry row above |
| `docs/CLAUDE.md:21-43` (route table) | root Context Guide + child indexes | root | ✅ **APPLIED** — same edit as the "Common Scenarios → Right File" row above |

## Contradicted by code

Routed to each target's findings log (or, for the plugin, its owner repo) — never a scrubber deletion target (CF-N9).

| Context line | What the code does | Evidence | Suggested action |
|---|---|---|---|
| `xstockstrat-marketdata/docs/context-constitution-findings.md:10-11` | CLAUDE.md no longer makes the claimed false statements — already reads "Planned, not yet implemented" for both the `ohlcv_1h` CAGG and the compression policy | `services/xstockstrat-marketdata/CLAUDE.md` (current) | move both rows to `## Resolved` via `/context-constitution` |
| `xstockstrat-analysis/docs/context-constitution-findings.md:15` | the MCP agent's hardcoded `x-access-scope=7` no longer exists anywhere; root's own findings log already marks this ✓ RESOLVED | `services/xstockstrat-agent/app/client.py` (6 call sites checked); root findings:37 | update analysis's cross-reference to match root's narrowed framing |
| `xstockstrat-ingest/docs/context-constitution.md:22` (gotcha) | "deliberate superset of the DB CHECK constraint" is no longer true — migration `007` widened the CHECK to exactly the same 11 values `validate_config_json` allow-lists | `migrations/007_signal_source_type_mediated.up.sql` vs `signal_sources.py:174-213` | route to findings log — a maintainer call, not a scrub |
| `services/xstockstrat-ledger/CLAUDE.md:91-92` | "**Compression: after 3 days** ... **Retention: 2 years**" stated as active facts; no migration implements either, and this same file's own Config Keys table (68-70) already says "not yet implemented" — a self-contradiction inside one file | `ledger/migrations/*.sql` (grep zero for `compress`/`retention` policy DDL) | reword lines 91-92 to match the "documented, not yet implemented" framing already used 20 lines below |
| `services/xstockstrat-ui/CLAUDE.md:185` | "part of the platform's **20-connection** budget" | root `CLAUDE.md` §Connection Pool Budget says **~22** | fix the number or delete it, keep the cross-ref |
| `plugins/strat-lab/skills/backtest/reference/self-grill.md:10-14` | "`manage_strategy update` is replace-semantics — a partial update wipes components" | `services/xstockstrat-analysis/app/handlers/servicer.py:1634-1651,2894-2915` — feature 070 partial-merge is fully implemented; this directly contradicts the skill's *own* `SKILL.md:36-46` | **upstream fix required in `davcs86/agent-plugins`** — this is the self-grill check the agent runs before reporting, highest priority in this whole report |
| `plugins/strat-lab/skills/backtest/{SKILL.md:65-71, reference/output-handling.md:1-46}` | claims the harness "saves the payload to a file... do not read that file raw," and ships a `glob`/`getmtime`/`json.load` extract script for `*run_backtest*.txt` | `services/xstockstrat-agent/app/tools.py:416-437` + `app/backtest_view.py:1-16,84-107` — feature 072 returns an inline self-truncating JSON summary plus one attached `application/json` `EmbeddedResource`; no file is ever written | **upstream fix required** — wrong in *both* `SKILL.md` and the reference file, not just the reference file; drop the file-parsing flow entirely |
| `plugins/strat-lab/skills/backtest/reference/aggregation.md:39-40` | "full-definition update each time" for sweeping a parameter | same partial-merge backend as above; contradicts the skill's own `SKILL.md:39-42` example (`manage_strategy(operation="update", strategy_id=..., cooldown_days=45)`) | **upstream fix required** — change to "partial-merge update naming only the swept field" |
| root `CLAUDE.md:119` | "run via `golangci-lint-action@v6`" | `.github/workflows/ci.yml:223` pins `@v7` | fix the citation (the `v2.5.0` linter-version pin itself is correct) |

## Should be just-in-time (pre-loaded → pointer)

| Context line(s) | Why it's mis-placed | On-demand home | Suggested action |
|---|---|---|---|
| `xstockstrat-agent/docs/context-constitution-findings.md:27-52` (13-row "MCP tool ↔ backend alignment audit") | every row is now resolved; the full narrative already lives in a dedicated triage doc and the ledger | `docs/reports/2026-08-01-mcp-tools-alignment-triage.md`; `docs/roadmap/ledger/insights.md`/`fails.md` | ✅ **APPLIED** — collapsed 26 lines to "13/13 resolved, see triage report + ledger" |
| root `CLAUDE.md:209-252` (Connection Pool Budget, ~44 lines with full per-service table) | duplicates `docs/patterns/database.md` § Connection pooling almost entirely, per its own text ("Full rationale... → docs/patterns/database.md") | `docs/patterns/database.md` | ✅ **APPLIED** — kept the summary line + per-service table, moved the PgBouncer rationale paragraph fully into the linked doc |
| root `CLAUDE.md:304-337` (Dockerfile Update Workflow, 5 steps + "Common updates") | narrow, rarely-touched procedure | `docs/patterns/docker-build.md` | **left as-is** (human call) — kept inline per the Brittle-section resolution below, which the user chose to leave unchanged too |
| `xstockstrat-agent/CLAUDE.md:102-131` (OAuth 2.1 edge auth, ~30 lines: full route table, RFC citations, path-insertion quirk) | narrow, only touched when modifying OAuth flow — mirrors how analysis already points scoring/warmup detail out to `docs/scoring.md`/`docs/warmup.md` | a new `docs/oauth.md` (doesn't exist yet) | ✅ **APPLIED** — moved the route table/RFC citations/path-insertion quirk to new `docs/oauth.md`; CLAUDE.md keeps a short summary + pointer |
| `xstockstrat-identity/CLAUDE.md:51-69` (Database/Migrations, full per-migration column enumeration) | duplicates what `migrations/*.sql` already states declaratively | the migration files themselves | ✅ **APPLIED** — shrunk to one line per migration + pointer to `migrations/*.up.sql` |

## Brittle / over-specified (anti-altitude)

| Context line(s) | Why brittle | Heuristic it should become | Suggested action |
|---|---|---|---|
| root `CLAUDE.md:304-337` (Dockerfile Update Workflow) | 5-step + 3-row checklist for what's fundamentally one idea | "Update the Dockerfile, the service's CLAUDE.md, and `docs/patterns/docker-build.md` together; test with `docker compose build --no-cache`" | **left as-is** — user reviewed both this and the JIT-move alternative above and chose to keep the full workflow inline |
| root `CLAUDE.md:142-151` (Version Bump Workflow propagation table) | a long enumerated table for "bump it everywhere `grep` finds the old version, CI catches stragglers" (already stated at :153) | keep the proto-plugin row (genuinely non-obvious: CI installs its own copies), compress the rest | partial trim |
| `docs/runbooks/CLAUDE.md:17` ("all twenty-two agent tools") | a hardcoded count that drifts on any tool add/remove — `docs/runbooks/mcp-tools.md` itself already documents only 21, missing `set_strategy_live` | "the agent's MCP tools" | ✅ **APPLIED** — dropped the integer |
| `plugins/strat-lab/skills/backtest/reference/output-handling.md:22-46` | brittle *and* obsolete — parses a file format feature 072 no longer produces | "read `summary['attachments']`; open the attached `EmbeddedResource` only for per-bar detail" | **upstream fix required** |
| `plugins/strat-lab/skills/backtest/reference/aggregation.md:29-34` | per-file-load snippet assumes the obsolete file-parse source | "per-symbol scalars come from each call's inline summary" | **upstream fix required** |

## Bloat / low-value prose

| Context line(s) | Why it is filler | Suggested action |
|---|---|---|
| `xstockstrat-agent/docs/context-constitution-findings.md:27-52` | process narrative (dates, "Full triage: [...]", CF-N12 citation) is ~47% of the file's lines for content whose only remaining job is a pointer | ✅ **APPLIED** (same edit as the JIT row above) |
| `xstockstrat-notify/docs/context-constitution.md:15` (NOTIFY-2) | the rule's own "Why" column concedes the deviation is "harmless but out of style" — weak as a numbered binding rule | ✅ **APPLIED** — downgraded from a `NOTIFY-*` rule to a Pointers-table line |
| root `CLAUDE.md:330` | "CI validates: Docker builds, lint checks, and documentation links" — there is no generic doc-link checker; the closest job (`check-context-map.sh`) validates something narrower | ✅ **APPLIED** — cut the "documentation links" claim |
| root `CLAUDE.md:179` | naming two arbitrary old feature examples ("065 cross-stock scoring, 068 backtest visualization") in a log that's grown well past both | ✅ **APPLIED** — dropped the named examples |
| `plugins/strat-lab/skills/backtest/reference/{verification,self-grill}.md` overlap | self-grill items 4-5 restate verification.md's window-artifact/ddof/NaN guidance near-verbatim — content itself still accurate, just duplicated | **upstream**: cross-reference instead of restating |

## Context budget (file-level)

All 23 auto-loaded `CLAUDE.md` files, measured fresh this pass, against the skill's default ~2,000-char
soft budget for a *single* auto-loaded file. **Every service/root `CLAUDE.md` in this monorepo exceeds
it** — this budget is calibrated for a small single-purpose project, not a 12-service monorepo's
per-service reference doc, so treat "over" here as informational sizing data, not an actionable alarm
list; only the largest ones are worth a genuine trim conversation.

| File | Lines | Characters | Over soft budget? |
|---|---|---|---|
| root `CLAUDE.md` | 509 | 35,840 | yes — by far the largest |
| `xstockstrat-analysis/CLAUDE.md` | 230 | 22,703 | yes |
| `xstockstrat-trading/CLAUDE.md` | 228 | 20,354 | yes |
| `xstockstrat-ui/CLAUDE.md` | 283 | 18,479 | yes |
| `xstockstrat-marketdata/CLAUDE.md` | 143 | 14,976 | yes |
| `xstockstrat-agent/CLAUDE.md` | 173 | 11,894 | yes |
| `xstockstrat-indicators/CLAUDE.md` | 156 | 8,945 | yes |
| `xstockstrat-config/CLAUDE.md` | 114 | 7,266 | yes |
| `xstockstrat-portfolio/CLAUDE.md` | 100 | 7,585 | yes |
| `xstockstrat-ingest/CLAUDE.md` | 123 | 7,291 | yes |
| `xstockstrat-ledger/CLAUDE.md` | 127 | 6,533 | yes |
| `xstockstrat-identity/CLAUDE.md` | 109 | 5,910 | yes |
| `xstockstrat-notify/CLAUDE.md` | 90 | 4,625 | yes |
| `docs/roadmap/features/CLAUDE.md` | 106 | 5,467 | yes |
| `docs/CLAUDE.md` | 42 | 3,212 | yes |
| `docs/roadmap/CLAUDE.md` | 26 | 2,640 | yes |
| `docs/runbooks/CLAUDE.md` | 18 | 2,500 | yes |
| `docs/roadmap/ledger/CLAUDE.md` | 19 | 1,338 | no |
| `docs/setup/CLAUDE.md` | 19 | 1,559 | no |
| `docs/patterns/CLAUDE.md` | 18 | 1,939 | no |
| `packages/proto/CLAUDE.md` | 10 | 1,065 | no |
| `packages/otel/CLAUDE.md` | 10 | 995 | no |
| `docs/sdd/CLAUDE.md` | 13 | 915 | no |
| `README.md` (scrubberExtraTargets) | 88 | 6,557 | yes |
| `plugins/strat-lab/skills/backtest/SKILL.md` | 94 | 6,797 | yes (though the body loads only on invocation, not every session) |

The 15 on-demand `context-constitution*.md` files (audited separately, not auto-loaded) are all well
under strain; largest is root's own `docs/context-constitution.md` at 73 lines / 16,217 chars.

## Silent skills (weak trigger surface)

**Scanned: 15 · excluded as symlinked-out: 0.** None are silent — every skill has a usable trigger
surface:

- All 14 `.claude/skills/*` are model-invocable with an explicit "Use this whenever..." clause naming
  concrete user phrasings (e.g. `sdd-story`: "'new feature', 'I want it to…'"; `promote`: "'let's go
  live'"; `onboard`: "'how do I run this locally'").
- `plugins/strat-lab/skills/backtest/SKILL.md` is command-only (`disable-model-invocation: true`) with a
  clear human cue: "Use when the user asks to backtest a strategy, sweep a parameter such as cooldown,
  reconfirm or reproduce the numbers in a strategy report..."

## Keep-but-verify (unconfirmed — CF-1)

- `xstockstrat-identity/docs/context-constitution.md:22` — the `revokeToken` gotcha's citation is missing `:214`, where `success:true` is actually returned on the garbage-decode path — not wrong, just incomplete
- `xstockstrat-ui/docs/context-constitution.md:32` — `verifyAccessToken`/`refreshSession`'s uncast-JWT trust boundary — already self-labeled unverified, needs a maintainer
- `xstockstrat-ui/docs/context-constitution-findings.md:23` — `DATABASE_URL`-unset silent-empty-audit-log question — same, needs a maintainer
- `xstockstrat-agent/docs/context-constitution.md:35` — "n8n/HTTP-webhook migration to gRPC left no residue \| PR #441" — PR content not verifiable without GitHub access this session
- `xstockstrat-config/docs/context-constitution.md:34` (candidate row) — **should likely be closed**: `xstockstrat-config`'s own copy of `configWatcher.ts` (the 10s-default file) has zero importers in `xstockstrat-config/src` — dead code, no live 10s/90s conflict — recommend a `/context-constitution` pass close this with that finding
- `packages/proto/docs/context-constitution.md:14` — "all imports are `common/v1` + google well-known (N=all 11)" — true, but 2 of 11 files (`identity.proto`, `notify.proto`) import only google well-known types — phrasing risks misreading, not a factual error
- root/proto/agent — several PR references (`#698,#442,#443,#697,#891`) weren't independently checked against GitHub (only `git log`/`git show` locally, which did confirm the underlying commits exist)
- `xstockstrat-analysis/docs/context-constitution-findings.md:15` — status says "open" for the fundsignal-loop admin-bit question, but root's log has already narrowed this to "accepted-by-design" — a framing-currency question, not a code contradiction
- root `docs/context-constitution.md:42` (PLAT-N3) — the "poller-owned long-lived context may also emit synchronously" claim (trading's reconciliation loop) wasn't independently re-spot-checked by the scrub pass (checked by the refresh pass that added it)
- `xstockstrat-agent/CLAUDE.md:19-22,58-100` — describes indicators-side "admin is only an override" enforcement for `manage_formula`; confirmed the agent-side no-scope-forwarding behavior, but the indicators-side enforcement itself wasn't independently checked in this pass (out of this cluster's scope)
- `docs/CLAUDE.md` §Quick Reference — `docs/launch-pdfs/` (4 `.md`+`.pdf` pairs: infra-ci, product-features, sdd-flow, sdd-lifecycle) has no `CLAUDE.md` and no mention in the directory table — unclear if these are agent-relevant working docs or generated external collateral; a human call
- `docs/roadmap/CLAUDE.md:9` — "webhook path cleanup via feature-011 (`packages/n8n/` deleted)" — historical note, plausible, not independently re-checked against the filesystem this pass
- **Feature-numbering hygiene** (not a context-file defect, but adjacent): `docs/roadmap/features/` has **two** `097-*` directories (`097-opportunity-universe-unification` and `097-remove-x-mcp-secret-header`) — root `CLAUDE.md:412`'s own "never reuse a number" rule isn't being enforced in practice; worth flagging to whoever owns feature-numbering hygiene
- root `CLAUDE.md:82` — the `strat-lab` plugin same-PR-sync requirement is correctly stated, but this pass's own strat-lab audit (see Contradicted-by-code) shows it *hasn't* been honored for features 070/072 — the rule is accurate, compliance with it isn't; not a rule-wording defect
- `services/xstockstrat-marketdata/CLAUDE.md:111` — "nginx 'Authorization Required' page" describing Alpaca's own edge (not the removed platform nginx) — reconfirmed still present; likely a non-issue but a reword would remove the ambiguity

## Protected blocks (reported, never trimmed)

| Block | Location | Marker |
|---|---|---|
| behavioral contract | `CLAUDE.md:1-22` (root only) | `context-forge:behavioral-contract` |
| constitution pointer | `packages/otel/CLAUDE.md:3-5` | `context-forge:constitution-pointer` |
| constitution pointer | `packages/proto/CLAUDE.md:3-5` | `context-forge:constitution-pointer` |
| constitution pointer | 12× `services/xstockstrat-*/CLAUDE.md:3-5` | `context-forge:constitution-pointer` |

Two pointer-block summaries were flagged as stale in passing (drifted relative to their own findings
docs) — reported here as `keep-but-verify`, deferred to `/context-constitution` per CF-N11, never
scrubber-trimmed:

- `services/xstockstrat-ingest/CLAUDE.md:4` — still summarizes "9 dead config keys, unimplemented dedup" though the findings file itself already dropped that premise and dedup has shipped (feature 111)
- `services/xstockstrat-notify/CLAUDE.md:4` — still lists "fictional ledger dep" though findings.md marked it ✓ RESOLVED back in 2026-08-02 — this drift has now survived **two** consolidation passes
- `services/xstockstrat-indicators/CLAUDE.md:4` — still lists "fictional ledger/notify deps" though findings.md marks it ✓ Resolved (2026-08-09)
- `services/xstockstrat-marketdata/CLAUDE.md:4` — still lists "fictional CAGG/compression docs" though the CLAUDE.md body itself is already honest and matches code

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins) (run manually — the plugin
wasn't loaded into this session's skill registry; see the PR/session note). These are low-signal or
drifted lines to fix, not rules to keep — nothing grounded is dropped (**CF-N8**). Re-run
`/context-scrubber` to re-audit; re-run `/context-constitution` to re-ground the 45 stale citations and
close the 9 contradicted-by-code rows (6 of which need an upstream PR to `davcs86/agent-plugins` for the
`strat-lab` skill)._
