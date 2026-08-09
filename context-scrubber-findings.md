# Context Scrub — Findings

**This file is a merge of two passes, not a fresh full-repo regeneration** — deviating from this
skill's usual "every run is a fresh audit" model (see note below) specifically to avoid silently
dropping the prior full-repo scan's findings (CF-N8: no silent drops).

- **2026-08-09 (this pass)** — scoped to the 15 `context-constitution.md` /
  `context-constitution-findings.md` file pairs touched by the same-day `/context-constitution
  refresh` (root, `packages/proto`, `packages/otel` findings-only, all 12 services), per the root
  CLAUDE.md teardown rule ("scoped to what you touched"). Sections below without a date marker are
  this pass, freshly re-verified against current code.
- **2026-08-02 (carried forward)** — the prior full-repo scan (54 targets: 23 `CLAUDE.md` + all
  `context-constitution*` files + `README.md` + the `strat-lab` plugin skill). Everything from it
  that falls **outside** this pass's 15-target scope (docs-tree `CLAUDE.md` indexes, `README.md`,
  the `strat-lab` skill, and a few still-open per-service `CLAUDE.md` drifts) is carried forward
  verbatim in `## Carried forward from 2026-08-02` at the end, **not re-verified this pass** — it
  may have been fixed since, or may not. Everything from the 2026-08-02 file that *did* fall inside
  this pass's 15-target scope has been superseded by fresh verification below (most of it — the
  `xstockstrat-agent` F-6/F-8/F-9/F-10 resolutions, the `xstockstrat-ingest` 9-key finding, and
  others — was independently confirmed already fixed by today's `/context-constitution refresh`).

This is a report for triage; trimming is gated (`/context-scrubber apply`) and was **not** run —
this is `scan` mode. Every row cites both the context line and the evidence it fails. Re-run
`/context-scrubber` (ideally unscoped, to refresh the carried-forward section too) to re-audit; run
`/context-constitution` to re-ground stale citations (this skill reports them, it doesn't fix them).

> ⚠ No security-boundary-contradicting rows found. All "contradicted by code" rows below are stale
> documentation-drift, not authz/authn/secret gaps.

## Summary

Savings are measured directly from the flagged lines (no tokenizer was available this run, so no
token column — reporting lines/characters only, per CF-1: never an invented token count).

| Category | Failing lines | Lines | Characters |
|---|---|---|---|
| Stale citations | 35 | 35 | not counted — every row is a **re-ground**, not a deletion (see note below) |
| Restated (agent reads for free) | 9 | 9 | 3,820 |
| Cross-file duplication | 7 | 9 | 4,538+ (6 of 7 are explicit, intentional cross-references or a pre-existing unfixed 2026-08-02 finding — low actionability; the proto/root Timeframe pair is a clean, unflagged duplicate) |
| Contradicted by code | 3 | ~6 | — (routed to findings logs, never a removal target) |
| Should be just-in-time | 1 | 26 | 5,039 |
| Brittle / over-specified | 0 | — | — |
| Bloat / low-value prose | 2 | 27 | 5,362 (overlaps with the JIT row above — same section) |
| **Removable total** (restated + the 1 clean duplicate + bloat, excluding the JIT row's own bytes since a move isn't a deletion) | 15 | ~18 | ~4,563 |
| Keep-but-verify (unconfirmed) | 9 | — | — |

> Stale citations aren't counted in the removable total: every one of the 35 is a case where the code
> *moved*, not disappeared — the correct action is `/context-constitution` re-grounding the
> `path:line`, never a scrubber deletion. The dominant real "savings" opportunity here is the fully
> resolved 13-row MCP-tool-alignment audit table in `xstockstrat-agent`'s findings log (JIT + bloat,
> same underlying content, listed once below).

## Stale citations

All 35 are **re-ground**, not remove — the cited knowledge is still true, only the `path:line` drifted
(either from this session's own additions, or from pre-existing drift this refresh's staleness pass
missed). Grouped by target.

| Context line | Citation it makes | Reality | Suggested action |
|---|---|---|---|
| root `context-constitution-findings.md:16` | `docker-compose.yml:119,150,182,216,470` | 4318-port lines are actually `:119,150,182,215,474` | re-ground |
| root `context-constitution-findings.md:32` | `getEnvBool` at `trading/config.go:55`, `portfolio/config.go:195-208`, `marketdata/config.go:201` | actual: trading `:60-66`, portfolio `:237-247`+`:249-250`, marketdata `:231-…` | re-ground |
| root `context-constitution-findings.md:38` | `analysis/watcher.py:36`, `ingest/watcher.py:38` | `client_id=f"indicators-{id(self)}"` is at `:61` in both | re-ground to `:61` |
| root `context-constitution-findings.md:26` | `ingest/watcher.py:60-90` | value traps are at `:93,101,117` (60-90 is `_watch`/`wait_for_snapshot`) | re-ground |
| root `context-constitution-findings.md:19` | `ingest/servicer.py:254,278,806` | actual sites `:255,279,868` | re-ground |
| proto `context-constitution.md:15` (PROTO-2) | `trading.proto:188` for `is_paper` | field is at `:202` (current) / `:225` (deprecated); 188 is inside `HaltSource` | re-ground |
| proto `context-constitution.md:18` (PROTO-5) | `config.proto:56` (`default_value`), `:127` (`current_value`) | actual: `:122` and `:130` | re-ground (this is a citation **I added this session** and didn't independently grep-verify before writing — see note) |
| proto `context-constitution.md:14` (PROTO-1) | `analysis.proto:60` for `CoverageGap` vs `common.TimeRange` | `CoverageGap` starts `:61`, its `TimeRange` fields are `:64,68` | re-ground |
| proto `context-constitution.md:26` (account_id gotcha) | `portfolio.proto:118,124`; `trading.proto:97,132` | portfolio: `:124,130`; trading: `:51,102` (97/132 don't contain `account_id`) | re-ground |
| proto `context-constitution-findings.md:10` | `indicators.proto:48` | field is at `:49` | re-ground |
| proto `context-constitution-findings.md:21` | `analysis.proto:74,141,177`; `trading.proto:44,151` | analysis: `:103,172`; trading: `:44,159` | re-ground |
| config `context-constitution.md:14` (CONFIG-1) | `configServiceImpl.ts:178-200`, `:196` | actual `:181-203`, `:199` (file grew 3 lines) | re-ground |
| config `context-constitution.md:16` (CONFIG-3) | `:19-20`, `:84`, `:90` | actual `:22-23`, `:87`, `:93` | re-ground |
| config `context-constitution.md:26` (gotcha) | `:65` | actual `:68` | re-ground |
| config `context-constitution.md:19` (CONFIG-6, **added this session**) | prose says `environment = $2 AND trading_mode = $3` | actual query is `key = $2 AND environment = $3 AND trading_mode = $4` | fix the prose's param numbers (substance/citation path is correct, only the inline SQL paraphrase is off) |
| ledger `context-constitution-findings.md:23` | `CLAUDE.md:62-67` | table is now at `:65-70` | re-ground |
| trading `context-constitution.md:36` (candidate) | `trading.go:678-728` mutating outside lock at `:676` | that range is `CancelOrder`'s intent-dedup logic; the real fill-poller race is `pollFills` at `:1150` (unlock), `:1192-1200` (mutation) | re-ground — race concern itself still holds, just at the wrong function |
| trading `context-constitution-findings.md:11` | `CLAUDE.md:58` | row is now at `:67` | re-ground |
| trading `context-constitution-findings.md:12` | `CLAUDE.md:63`, `trading.go:244` | row now at `CLAUDE.md:72`; maintenance-mode check now at `trading.go:315` | re-ground |
| trading `context-constitution-findings.md:14` | `CLAUDE.md:99`, `trading.go:320-328` | row now at `CLAUDE.md:120`; approval logic now `trading.go:435-488,573-580` | re-ground |
| trading `context-constitution-findings.md:24` | `trading_repo.go:71` | the literal `false` is at `:75` | re-ground |
| agent `context-constitution.md:19` (AGENT-4, **touched this session**) | `app/client.py:28` for `_metadata` | def is at `:29` (28 is blank) | re-ground |
| agent `context-constitution.md:20` (AGENT-5) | `app/tools.py:96` for `_grpc_error_message` | def is at `:125` — this drifted because *this session's own* AGENT-3b insertion added ~29 lines above it, and the refresh didn't re-check AGENT-5's citation | re-ground |
| agent `context-constitution-findings.md:43` (F-8, **touched this session**) | `app/tools.py:1018-1053` | that range is the signature/docstring; the actual `create_key=create_key` forward is at `:1099` | re-ground / extend range |
| marketdata `context-constitution.md:31` (gotcha) | `cmd/server/main.go:129,133` | those lines are unrelated log/server-init code; poller launches are `:121,125` | re-ground |
| marketdata `context-constitution.md:30` (gotcha) | `internal/alpaca/client.go:145` for `adjustmentParam` | function moved to `:159` | re-ground |
| marketdata `context-constitution.md:26` (MARKETDATA-N1) | `marketdata_service.go:767,797` | `select {` statements are at `:769,799` | re-ground |
| analysis `context-constitution-findings.md:17-18` | `evaluator.py:210-247` for the `MessageToDict` fix | the call is at `:265`, inside `:264-291` | re-ground |
| analysis `context-constitution.md:20,29` (ANALYSIS-7 + its gotcha) | bare paths `docs/reports/2026-08-07-...md` | resolve only from repo root, not from `services/xstockstrat-analysis/docs/` — needs a `../../../` prefix (contrast `xstockstrat-agent`'s findings.md, which does this correctly) | fix the relative path prefix in both citations |
| analysis `context-constitution.md:26` (gotcha) | `app/config/watcher.py:102-113` for `get_int_present` | function body is `:103-114` | re-ground |
| analysis `context-constitution.md:39` (Pointer) | "root `CLAUDE.md` §Config Governance Rules" | that section has no feature-065/zero-trap detail directly — the actual content lives in this service's own `CLAUDE.md` §Config Keys Consumed | repoint to the service's own CLAUDE.md |
| ingest `context-constitution.md:18` (INGEST-4) | `ingest.proto:109` | field is at `:110` | re-ground |
| ingest `context-constitution.md:18` (INGEST-5) | `ingest.proto:126-137` | request/response block is `:127-138` | re-ground |
| ingest `context-constitution.md:14` (INGEST-1) | `backfill_chunks.py:18-22` | that range is status-ordinal constants, unrelated; the proto-free claim is stated in the module docstring `:1-7` | re-ground |
| ingest `context-constitution-findings.md:21` | `signal_sources.py:6` | `get_active_source` def is at `:34` | re-ground |

## Restated facts (agent reads for free) — fails CF-N4

| Context line | What restates it (free to read) | Why it fails | Suggested action |
|---|---|---|---|
| `xstockstrat-ledger/context-constitution.md:16` (LEDGER-3) | this service's own `CLAUDE.md` § Live Streaming Architecture ("on listener reconnect the handler ends the call so the client reconnects and replays the gap") | verbatim mechanism match; LEDGER-3 does add the consumer-risk framing CLAUDE.md lacks | trim the mechanism restatement, keep only the added "why"/risk |
| `xstockstrat-identity/context-constitution.md:17` (IDENTITY-4) | `CLAUDE.md`'s OAuth section (near-identical `aud`-bound-JWT sentence) | same fact, same wording | collapse to a Pointer |
| `xstockstrat-identity/context-constitution.md:14` (IDENTITY-1) | `CLAUDE.md`'s Config Keys note ("JWT signing key is not a config key — read from `JWT_SECRET`") | partial overlap; IDENTITY-1 adds the PLAT-6-exception rationale CLAUDE.md doesn't | keep IDENTITY-1, consider trimming the CLAUDE.md line to a pointer instead |
| `xstockstrat-indicators/context-constitution-findings.md:11` | `CLAUDE.md:64` ("Documented, not yet enforced — intended concurrency cap; no `Semaphore`/limit reads it") | the finding's "docs claim it's real" framing is now stale — CLAUDE.md already self-flags it as unenforced | drop the row or move to Resolved (underlying code gap stays open, just not as a doc-lie) |
| `xstockstrat-analysis/context-constitution.md:25` | `CLAUDE.md:201` (`analysis.strategy.scored` row), which the bullet itself cites as source | adds nothing beyond CLAUDE.md's own row | replace with a one-line pointer |
| `xstockstrat-analysis/context-constitution.md:26` (gotcha) | `CLAUDE.md:167,193` (`get_int_present` config-key rows) | verbatim overlap on the two specific keys | shorten to a pointer; keep only the file-wide "every other key is still trapped" claim |
| `xstockstrat-analysis/context-constitution.md:15` (ANALYSIS-2) | `CLAUDE.md:163` (identical empirical-Bayes formula) | some duplication is by design (CLAUDE.md points *to* ANALYSIS-2 as the binding invariant) — lower severity | consider eliding the formula from one side |
| `xstockstrat-ingest/context-constitution.md:14` (INGEST-1) | `backfill_jobs.py:1-6`, `backfill_chunks.py:1-7` (both docstrings say "proto-free" almost verbatim) | — | keep if meant as a cross-file index; otherwise restates |
| `xstockstrat-ingest/context-constitution.md:15` (INGEST-2) | `backfill_jobs.py:11-12,53-56` (`_UPDATABLE_COLUMNS` comment) | near word-for-word overlap | same as above |

## Cross-file duplication — CF-N3

| Context line | Duplicate location(s) | Which copy to keep | Suggested action |
|---|---|---|---|
| `packages/proto/context-constitution.md:24` (Timeframe not interval-ordered) | root `context-constitution.md:49` (near word-for-word, same numbers, same citation) | root (cross-cutting) | remove from proto module / leave a pointer |
| root `context-constitution.md:55` (candidate: RPC bare-message-vs-wrapper shape) | `packages/proto/docs/context-constitution.md:32` (near-identical candidate row, same evidence) | proto module (this is proto-specific governance, not a platform-wide fact) | **still open from the 2026-08-02 scan** — remove the root duplicate |
| root `context-constitution.md:46` (Python config zero-trap gotcha) | root `context-constitution-findings.md` CF-N10 latent-bug row | — | **explicitly cross-referenced by the authors** ("also logged as a defect... and here as the fix") — low actionability, intentional current-state-vs-fix split |
| `xstockstrat-portfolio/context-constitution.md:24` (gotcha) | `xstockstrat-portfolio/context-constitution-findings.md:10` (latent bug) | — | explicitly cross-referenced ("Recorded as a latent bug in findings") — low actionability |
| `xstockstrat-notify/context-constitution.md:21-22` (gotchas) | `xstockstrat-notify/context-constitution-findings.md:14-18,28` | — | explicitly cross-referenced both directions — low actionability |
| `xstockstrat-agent/context-constitution.md:26` (AGENT-3b) | the feature-111 scar bullet in the same file's Gotchas section | AGENT-3b (standing rule) | scar restates the same specifics rather than adding new info beyond "what broke, what fixed it" — could shrink the scar to "see AGENT-3b" + the historical delta |
| `xstockstrat-analysis/context-constitution.md:20,29` (ANALYSIS-7 + `63a3655` gotcha) | same file | ANALYSIS-7 (standing rule) | cross-referenced by design; scar restates rather than adds |

## Contradicted by code

Routed to each target's findings log, never a scrubber deletion target (CF-N9).

| Context line | What the code does | Evidence | Suggested action |
|---|---|---|---|
| `xstockstrat-marketdata/context-constitution-findings.md:10-11` | CLAUDE.md no longer makes the claimed false statements — it already reads "**Planned, not yet implemented:** continuous aggregate `marketdata.ohlcv_1h`" and "(compression policy planned, not yet applied by any migration)" | `services/xstockstrat-marketdata/CLAUDE.md` (current, lines ~75-85) | move both rows to `## Resolved` via `/context-constitution` — the doc was already fixed, the findings log wasn't updated to match |
| `xstockstrat-analysis/context-constitution-findings.md:15` | the MCP agent's hardcoded `x-access-scope=7` no longer exists anywhere — every call site now forwards a caller-derived scope (feature 092), and root's own findings log already marks this ✓ RESOLVED | `services/xstockstrat-agent/app/client.py` (lines 451,550,714,859,985,1184); root `context-constitution-findings.md:37` | update analysis's cross-reference to match root's already-narrowed framing |
| `xstockstrat-ingest/context-constitution.md:22` (gotcha) | "deliberate superset of the DB CHECK constraint" is no longer true — migration `007_signal_source_type_mediated.up.sql` widened the CHECK to exactly the same 11 values `validate_config_json` allow-lists; the two sets are now equal, not superset/subset | `migrations/007_signal_source_type_mediated.up.sql` vs `signal_sources.py:174-213` | route to findings log — either the allow-list is now genuinely redundant with the CHECK, or a future value should differ; a maintainer call, not a scrub |

## Should be just-in-time (pre-loaded → pointer)

| Context line(s) | Why it's mis-placed | On-demand home | Suggested action |
|---|---|---|---|
| `xstockstrat-agent/context-constitution-findings.md:27-52` (the 13-row "MCP tool ↔ backend alignment audit") | every row is now resolved; the full narrative already lives in a dedicated triage doc and the generalizable lessons are already in the Ledger — the per-row resolution prose here is no longer load-bearing for triage (nothing is open) | `docs/reports/2026-08-01-mcp-tools-alignment-triage.md`; `docs/roadmap/ledger/insights.md`/`fails.md` (2026-08-02 entries) | move-to-pointer: replace the 26-line table with one line — "13/13 resolved, see triage report + ledger" |

## Brittle / over-specified (anti-altitude)

_None._ No long enumerated if-else / step-by-step blocks were found in any of the 15 audited target pairs — every rule row is a short, specific, evidence-cited statement.

## Bloat / low-value prose

| Context line(s) | Why it is filler | Suggested action |
|---|---|---|
| `xstockstrat-agent/context-constitution-findings.md:27-52` | same section as the JIT row above — the process narrative ("Full triage: [...]", re-confirmation dates, CF-N12 citation) is ~47% of the file's lines for content whose only remaining job is a historical pointer | trim (same fix as the JIT row) |
| `xstockstrat-notify/context-constitution.md:15` (NOTIFY-2) | the rule's own "Why" column concedes the deviation is "harmless but out of style" — a pure house-style note with no functional consequence, weak as a numbered binding rule | consider downgrading from a `NOTIFY-*` rule to a Pointers-table line |

## Context budget (file-level)

All 25 audited files are well under a strain-inducing size for an on-demand doc (none of these
auto-load — they're read only when a task sends an agent there). Largest three, for reference:

| File | Measured lines | Measured characters | Over soft budget? |
|---|---|---|---|
| root `docs/context-constitution.md` | 73 | 16,217 | no (this is an on-demand reference file, not auto-loaded — the 2,000-char soft budget targets auto-loaded `CLAUDE.md`s) |
| `xstockstrat-agent/docs/context-constitution-findings.md` | 55 | 7,989 | no |
| `xstockstrat-marketdata/docs/context-constitution.md` | 53 | 7,943 | no |

## Silent skills (weak trigger surface)

Not evaluated this run — out of scope for a scan scoped to "what this session touched" (no skill
files were created or modified in the refresh this scrub follows up on). A full silent-skill sweep
belongs to an unscoped, repo-wide `/context-scrubber` run.

## Keep-but-verify (unconfirmed — CF-1)

- `xstockstrat-identity/context-constitution.md:22` — the `revokeToken` gotcha's citation (`identityServiceImpl.ts:206,209,203`) is missing `:214`, where `success:true` is actually returned on the garbage-decode path — not wrong, just incomplete — status: **unverified whether worth adding**
- `xstockstrat-ui/context-constitution.md:32` — `verifyAccessToken`/`refreshSession`'s uncast-JWT trust boundary — already self-labeled unverified by the file; genuinely needs a maintainer, not resolvable from code — status: **unverified**
- `xstockstrat-ui/context-constitution-findings.md:23` — `DATABASE_URL`-unset silent-empty-audit-log question — same, needs a maintainer — status: **unverified**
- `xstockstrat-agent/context-constitution.md:35` — "n8n/HTTP-webhook migration to gRPC left no residue \| PR #441" — PR existence/content not verifiable without GitHub access in this session — status: **unverified**
- `xstockstrat-config/context-constitution.md:34` (candidate row) — **this one should likely be closed, not left open**: investigation found `xstockstrat-config`'s own copy of `configWatcher.ts` (the 10s-default file) has **zero importers** anywhere in `xstockstrat-config/src` (config never self-subscribes per its own Critical Invariant #1) — the file is dead code in this service, so there is no live 10s/90s conflict to resolve. Recommend a `/context-constitution` pass close this row with that finding rather than leaving it as an open candidate — status: **effectively resolved, needs write-up**
- `packages/proto/context-constitution.md:14` — "all imports are `common/v1` + google well-known (N=all 11)" is true but 2 of the 11 proto files (`identity.proto`, `notify.proto`) import **only** google well-known types, no `common/v1` — phrasing risks being misread — status: **wording nit, not a factual error**
- root/proto/agent — several PR/commit references (`#698,#442,#443,#697,#891`, commits `1eaf6c8`/`1413399`/`d7d185f`) are cited as evidence but weren't independently verified against GitHub in this pass (only `git log`/`git show` locally, which did confirm the commits exist) — status: **commits confirmed locally; PR numbers unverified**
- `xstockstrat-analysis/context-constitution-findings.md:15` — status field says "open" for the fundsignal-loop admin-bit question, but root's findings log has already narrowed this to "loop half accepted-by-design" — is analysis's "open" still the maintainer's live position, or should it mirror root's narrower framing? — status: **framing-currency question, not a code contradiction**
- root `context-constitution.md:42` (PLAT-N3) — the added claim that "a poller-owned long-lived context may also emit synchronously" (trading's reconciliation loop) was not independently re-spot-checked by this scrub pass (it was checked by the refresh pass that added it) — status: **plausible, not re-verified here**

## Protected blocks (reported, never trimmed)

None of the 25 audited files (`context-constitution.md` / `context-constitution-findings.md`) carry
`context-forge:*` sentinel blocks themselves — those blocks (behavioral contract, constitution
pointer) live in each target's `CLAUDE.md`, which was **not** in this scan's scope. Two `CLAUDE.md`
pointer summaries were flagged as stale in passing during the audit but are out-of-scope to trim here
(they belong to `/context-constitution`, per CF-N11):

| Block | Location | Drift observed |
|---|---|---|
| constitution pointer | `services/xstockstrat-ingest/CLAUDE.md:4` | still summarizes findings as "9 dead config keys, unimplemented dedup" — this session's refresh already dropped that premise from the findings file itself but didn't update this one-line CLAUDE.md summary |
| constitution pointer | `services/xstockstrat-notify/CLAUDE.md:4` | still lists "fictional ledger dep" as an open defect — findings.md marked it ✓ RESOLVED back in the **2026-08-02** refresh; this drift has now survived two refresh passes |

## Carried forward from 2026-08-02 (out of scope this pass — not re-verified)

The prior full-repo scan covered 54 targets; this pass only re-verified the 15 that the same-day
`/context-constitution refresh` touched. Everything below is **outside** that 15-target scope
(docs-tree `CLAUDE.md` indexes, `README.md`, the `strat-lab` plugin skill) or is a per-service
`CLAUDE.md` drift (not a `context-constitution*` file) that nobody has re-checked since 2026-08-02 —
carried forward verbatim so it isn't silently lost (CF-N8), **not confirmed still-accurate today**.

> Dropped from the original list below (not carried forward) because today's session independently
> re-confirmed them fixed/superseded: the `## Findings-log rows to mark resolved` section (all of
> F-6/F-8/F-9/F-10, the marketdata `ohlcv_1h` mention, and the ingest 9-key mention — each is now
> either fully resolved per this pass's `xstockstrat-agent` audit, or already captured fresh above in
> this pass's own Contradicted-by-code / Stale-citations sections with current line numbers).

### Stale citations — docs-tree indexes (unverified since 2026-08-02)

| Context line | Citation | Reality (as of 2026-08-02) | Suggested action |
|---|---|---|---|
| `docs/patterns/CLAUDE.md:9` | `nginx-routing.md` "Adding a new frontend to the **nginx** reverse proxy" | nginx removed (feature 045); root + `docs/CLAUDE.md:25` already mark it deprecated | reword cell to "historical reference" |
| `docs/runbooks/CLAUDE.md:8` | approval-flow "(API / **n8n** / UI)" | n8n removed (feature 011); `approval-flow.md` §Approval Mechanisms lists Direct API / agent / UI | drop the "n8n" token |
| `docs/CLAUDE.md:41` | "Import and configure **n8n** workflows → `setup/n8n.md`" | `setup/n8n.md` is a deprecated stub | mark deprecated / delete row |
| `docs/patterns/CLAUDE.md:7-18` (table) | omits `client-api-pattern.md`, `dry-guard-rail.md`, `strat-lab-plugin.md` (all on disk) | reverse-inclusion fail | add the missing rows |
| `docs/runbooks/CLAUDE.md:6-18` (table) | omits `reviewer-registry.md` (on disk) | index lags its directory | add the row |

### Restated — docs-tree index

| Context line | What restates it | Suggested action |
|---|---|---|
| `docs/CLAUDE.md:21-43` "Common Scenarios → Right File" | re-implements the routing already in root `CLAUDE.md` Context Guide + the three child indexes | keep as nav aid, but drift-prone (see n8n/nginx staleness above) |

### Cross-file duplication

| Context line | Duplicate location(s) | Keeper | Suggested action |
|---|---|---|---|
| `README.md:28-41` service/port table | subset of root `CLAUDE.md` §Service Registry | root | defensible (public front door) but will drift — consider trimming to names + link |
| `docs/CLAUDE.md:21-43` route table | root Context Guide | root | third place the same routes must be maintained |

### Contradicted by code — `strat-lab` skill (`davcs86/agent-plugins`) + service CLAUDE.md drifts

Defects (CF-N9) — routed to the plugin owner / human triage; never `apply`-deleted.

| Context line | What the code does | Evidence | Suggested action |
|---|---|---|---|
| `plugins/strat-lab/.../reference/self-grill.md:12-14` — "`manage_strategy update` is **replace-semantics**" | feature 070: partial merge, absent field preserved | `analysis/app/handlers/servicer.py` merge logic; contradicts the skill's own `SKILL.md:36-46` | rewrite to partial-merge — this is the self-grill check the agent runs before reporting, highest priority |
| `plugins/strat-lab/.../reference/output-handling.md:1-46` + `SKILL.md:54-60` — "harness saves the payload to a file; parse the overflow `*run_backtest*.txt`" | feature 072: inline self-truncating summary + attached `application/json` resource — no file | `agent/app/tools.py` | rewrite around the inline summary; the save-and-parse script is dead |
| `plugins/strat-lab/.../reference/aggregation.md:40` — "full-definition update each time" | same partial-merge backend | contradicts `SKILL.md:39` example | drop the full-definition instruction |
| **[still open — re-confirmed by today's session, see grep above]** `services/xstockstrat-ledger/CLAUDE.md:91-92` — "**Compression: after 3 days** … **Retention: 2 years**" as active facts | no migration implements either; same file's own config table annotates the keys "not yet implemented" | `ledger/migrations/` | reword "planned, not yet applied" (mirror marketdata's fix) |
| **[still open — re-confirmed by today's session]** `services/xstockstrat-ui/CLAUDE.md:185` — "part of the platform's **20-connection** budget" | root owns the number and says **~22** | root `CLAUDE.md` §Connection Pool Budget | delete the number, keep the cross-ref |
| **[still present — re-confirmed by today's session, but likely a non-issue]** `services/xstockstrat-marketdata/CLAUDE.md:111` — "nginx 'Authorization Required' page" | describes **Alpaca's** external edge 401, not the removed platform nginx | `internal/alpaca/client.go` | keep-but-verify: reword to avoid the nginx misread |

### Brittle / over-specified — `strat-lab` skill + docs-tree

| Context line(s) | Why brittle | Heuristic / action |
|---|---|---|
| `plugins/strat-lab/.../reference/output-handling.md:22-46` — `glob`/`getmtime`/`json.load` extract script | brittle *and* obsolete (parses a file feature 072 no longer produces) | collapse to "read the inline summary block; open the attachment only for per-bar detail" |
| `docs/runbooks/CLAUDE.md:17` — "all **twenty-two** agent tools" | hardcoded count drifts on any tool add/remove | "the agent's MCP tools" — drop the integer |
| `plugins/strat-lab/.../reference/aggregation.md:29-34` — per-file-load aggregation snippet | assumes the obsolete file-parse source | rewrite: per-symbol scalars come from each call's inline summary |

### Bloat / low-value prose — docs-tree + `strat-lab`

| Context line(s) | Why filler | Action |
|---|---|---|
| `docs/roadmap/features/CLAUDE.md:102-149` — "Automation: Preventing Stale Statuses" | narrates CI/promotion mechanics; the actionable rule is two lines | trim to the invariant + a pointer |
| `plugins/strat-lab/.../reference/{verification,self-grill}.md` overlap | self-grill items restate verification.md's guidance near-verbatim | de-dup across the two Phase-4 files |

### Context budget (file-level) — auto-loaded `CLAUDE.md` files (unverified since 2026-08-02)

Soft budget ~2,000 chars for an auto-loaded file. These are the actual auto-loaded `CLAUDE.md`s (the
`context-constitution*` files audited above are on-demand, not auto-loaded, so they were exempted
from this budget in this pass's own section):

| File | Lines | Chars | Over? |
|---|---|---|---|
| root `CLAUDE.md` | 507 | 35,323 | yes — by far the largest |
| `services/xstockstrat-analysis/CLAUDE.md` | 222 | 18,220 | yes |
| `services/xstockstrat-ui/CLAUDE.md` | 242 | 15,127 | yes |
| `services/xstockstrat-marketdata/CLAUDE.md` | 143 | 14,976 | yes |
| `services/xstockstrat-trading/CLAUDE.md` | 183 | 12,505 | yes |
| `services/xstockstrat-agent/CLAUDE.md` | 174 | 11,914 | yes |
| `docs/roadmap/features/CLAUDE.md` | 159 | 7,552 | yes |
| `plugins/strat-lab/skills/backtest/SKILL.md` | 94 | 6,797 | yes |

### Keep-but-verify — still-open security items (re-confirmed accurate by today's per-target refresh agents)

- ⚠ **security** `xstockstrat-ui/…-findings.md` — config-ui audit route gates on `getSessionFromRequest` only, **no admin-scope check**. Re-confirmed still open by this pass's own UI audit.
- ⚠ **security** `xstockstrat-identity/…-findings.md` — `revokeToken` decodes the JWT **without signature verify**. Not independently re-checked this pass, but nothing in today's identity work touched it — presumed still open.
- ⚠ **security** `xstockstrat-analysis/…-findings.md` — fundsignal loop still injects `x-access-scope=4`; re-confirmed still open (root's framing has narrowed to "accepted-by-design", see this pass's own findings above).
- ⚠ **security** `xstockstrat-indicators/…-findings.md` — sandbox child still inherits full parent `os.environ`. Re-confirmed still open by this pass's own indicators audit.
- `docs/CLAUDE.md:3` "Four subdirectories" — `reports/` is a fifth dir without a CLAUDE.md; unverified whether intentional.

### Protected blocks (reported, never trimmed)

| Block | Location | Marker |
|---|---|---|
| behavioral contract | `CLAUDE.md:1-22` | `context-forge:behavioral-contract` |
| constitution pointer | 14× service/package `CLAUDE.md:3-5` | `context-forge:constitution-pointer` |

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins) (run manually — the plugin
wasn't loaded into this session's skill registry, see the PR/session note). These are low-signal or
drifted lines to fix, not rules to keep — nothing grounded is dropped (**CF-N8**). Re-run
`/context-scrubber` (unscoped, to refresh the carried-forward section too) to re-audit; re-run
`/context-constitution` to re-ground the 35 stale citations and close the 3 contradicted-by-code rows._
