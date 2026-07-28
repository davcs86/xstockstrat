# Context Scrub — Findings

Low-signal context surfaced by `/context-scrubber` on **2026-07-28** (second run of the day). Each row is a
line in an **auto-loaded** context file (`CLAUDE.md`, `context-constitution.md`,
`context-constitution-findings.md`) — or the opt-in `README.md` — that an agent would find for free, that no
longer resolves, that is duplicated, or that the code now contradicts. This is a report for triage; trimming
is **gated** (`/context-scrubber apply`), never automatic. Every row cites both the context line and the
evidence it fails. Re-run `/context-scrubber` to re-audit; run `/context-constitution` to add the knowledge
that *passes* (stale citations below are re-ground by that refresh, not by this skill).

> **Scope:** 54 targets audited (23 `CLAUDE.md` + 15 `context-constitution.md` + 15
> `context-constitution-findings.md`, **plus `README.md` — its first audit ever**, opted in via the new
> `scrubberExtraTargets` config key), via 4 parallel read-only auditors; every load-bearing verdict
> re-confirmed against the actual code by the orchestrator. Protected sentinel blocks (1 behavioral-contract
> + 14 constitution-pointers) excluded by construction — see `## Protected blocks`.
>
> **Delta vs. the earlier 2026-07-28 run:** that run's re-grounding *held* where it was applied (analysis
> `servicer.py`/`evaluator.py`, UI `src/lib/*`, trading/portfolio/marketdata spot-checks: all resolve). The
> new failures concentrate in four places it did not cover: **(1)** the just-imported `plugins/strat-lab/`
> skill (contradicts shipped features 070 and 072), **(2)** `services/xstockstrat-agent`'s constitution
> (4 of 6 rules with dead exemplars, one ⚠ authz), **(3)** the per-service **findings logs**, where ~11 rows
> still assert defects the apply pass already fixed (a findings log listing resolved defects trains agents
> to distrust it), and **(4)** the docs-tree indexes (`docs/CLAUDE.md`, `docs/patterns/CLAUDE.md`,
> `docs/runbooks/CLAUDE.md`) which lag the tree they index.
>
> **⚠ security** marks rows touching an authz/authn/secret boundary. The *Contradicted-by-code* section is a
> **defect log, not a delete list** (CF-N9): the fix — implement, correct, or remove — is a human triage
> call; `apply` never deletes those rows.

## Summary

Measured directly from the flagged lines/ranges (no tokenizer ran; any token figure is `≈ chars ÷ 4`).
Single-line rows counted as 1 line each; multi-line ranges measured with `wc`.

| Category | Failing rows | Lines (measured) | Characters (measured/≈) |
|---|---|---|---|
| Stale citations | 27 | 27 | ≈ 3,300 |
| Restated (agent reads for free) | 5 | ~10 | ≈ 900 |
| Cross-file duplication | 17 | ~60 | ≈ 6,000 |
| Contradicted by code (defects — never apply-deleted) | 20 | ~30 | ≈ 3,500 |
| Should be just-in-time | 6 | 208 | 14,071 |
| Brittle / over-specified | 6 | ~12 | ≈ 1,400 |
| Bloat / low-value prose | 7 | 26 | ≈ 1,700 |
| **Removable total** (remove/trim/move rows only) | 41 | ~300 | ≈ 23,000 |
| Keep-but-verify (unconfirmed) | 16 | — | — |

## Top actions (ranked by behavioral impact)

1. **`plugins/strat-lab/` vs features 070/072 — the only findings that change agent *behavior*.**
   `skills/backtest/SKILL.md:37,39,55` and `reference/output-handling.md:1-7` teach a destructive
   full-replace update flow and a parse-the-overflow-file recipe that no longer matches the backend
   (partial-merge `update_mask` shipped in 070 — `servicer.py:1546-1590`; self-truncating summary +
   attachments shipped in 072 — `tools.py:286-304`). Root `CLAUDE.md:82` declares skill-and-API same-PR
   coupling; the plugin landed (#803) already stale against #796. Fix the skill.
2. **`services/xstockstrat-agent/docs/context-constitution.md`** — give it the re-grounding pass the other
   services got (rows below; includes the ⚠ AGENT-3 authz rule).
3. **Findings-log garbage collection** — retire the ~11 resolved rows via `/context-constitution refresh`
   (its `## Resolved` mechanism), not by hand-deleting.
4. **Docs-tree indexes** — `docs/patterns/CLAUDE.md` is 3 files short of its directory; `docs/CLAUDE.md`
   miscounts subdirs and still routes to n8n; `docs/runbooks/CLAUDE.md` omits `reviewer-registry.md`.
5. **`.md`→`.md` line-number cites keep re-breaking** — 15+ of the stale rows are `CLAUDE.md:<line>`
   self-references; convert to `§ heading` form during the refresh.

## Stale citations

Action `re-ground` via `/context-constitution refresh` unless noted.

| Context line | Citation | Reality | Suggested action |
|---|---|---|---|
| ⚠ `services/xstockstrat-agent/docs/context-constitution.md:17` (AGENT-3, admin `x-access-scope`) | `app/client.py:32,298,466,608,713` | real `_admin_metadata()` sites: `:30,343,520,662,767`; canonical `:298` is an unrelated `raise` | re-ground (authz rule — priority) |
| `services/xstockstrat-agent/docs/context-constitution.md:19` (AGENT-5) | `app/tools.py:346,405,436,452,484,513` | real `AioRpcError`→`_grpc_error_message` pairs at `:435-436,494-495,525-526,541-542,573-574,602-603,617-618` | re-ground |
| `services/xstockstrat-agent/docs/context-constitution.md:15` (AGENT-1) | `app/client.py:56,105,127,151,219,299` | `:151,299` blank, `:219` docstring; real next sites `:192,248,344` (count 22 ✓) | re-ground |
| `services/xstockstrat-agent/docs/context-constitution.md:24` | `app/client.py:44-49,649-651` | `_TF_ALIASES`/`_TF_TO_ENUM`/`_FILL_MODE_MAP` now at `:703-705` | re-ground |
| `docs/context-constitution.md:37` (PLAT-N1 Example) | `trading.go:642-682` | that range is a ticker-reset loop; detached emits at `:315,321,331,377,421,498,732`, helper `:1426` | re-ground |
| `docs/context-constitution.md:37` (PLAT-N1 Evidence) | `servicer.py:1051,1141` | best-effort emits actually at `:1237-1258,:1348` | re-ground |
| `docs/context-constitution-findings.md:19` | notify `CLAUDE.md:39,57`; identity `CLAUDE.md:45,89` | anchors blank/fence; surviving referent is `ingest/CLAUDE.md:75,99-100` only | trim row to ingest + re-ground |
| `docs/context-constitution-findings.md:20` | `services/xstockstrat-{ledger,identity,notify,config}/CLAUDE.md:9` | version line is `:13` and reads "Node.js 22" (see Contradicted) | re-ground surviving half |
| `services/xstockstrat-indicators/docs/context-constitution.md:38` | `CLAUDE.md:157` | file is 156 lines; `--cov-fail-under=50` at `:148` | re-ground |
| `services/xstockstrat-indicators/docs/context-constitution.md:37` | `CLAUDE.md:109,120` | `MAX_PARAMETERS` `:112`, `MAX_OUTPUTS` `:123` (`:120` ✓) | re-ground |
| `services/xstockstrat-analysis/docs/context-constitution.md:23` | `CLAUDE.md:103` | scored-event line is `:107` (and `:288`) | re-ground |
| `services/xstockstrat-analysis/docs/context-constitution.md:32` | `CLAUDE.md:107` | Lock caveat is `:109-110` | re-ground |
| `services/xstockstrat-marketdata/docs/context-constitution-findings.md:19` | `CLAUDE.md:68-69` | retention keys at `:72-73` | re-ground |
| `services/xstockstrat-ingest/docs/context-constitution-findings.md:12` | `CLAUDE.md:79` vs `servicer.py:659` | cite dead and the rebutted doc claim is gone | delete row (refresh) |
| `services/xstockstrat-indicators/docs/context-constitution-findings.md:12` | `CLAUDE.md:51` | pool line is `:53`; row also obsolete (see Contradicted) | delete row (refresh) |
| `packages/proto/docs/context-constitution.md:14` | `analysis.proto:46` (`CoverageGap`) | now `:51` (+5 shift) | re-ground |
| `packages/proto/docs/context-constitution.md:20` | `analysis.proto:48` (timeframe) | now `:53` | re-ground |
| `packages/proto/docs/context-constitution.md:16` | `analysis.proto:161` | `:161` = `bool provisional = 7;` — wrong symbol (`portfolio.proto:108-113` ✓) | re-ground or drop cite |
| `packages/proto/docs/context-constitution.md:23` | `portfolio.proto:97,104` | `:97` ✓; `:104` = `}` | replace second cite |
| `packages/proto/docs/context-constitution-findings.md:21` | `analysis.proto:74,141,177` | `side` @ `:88`, `rating` @ `:157` | re-ground |
| `services/xstockstrat-config/docs/context-constitution.md:35` | `CLAUDE.md:32` | is_secret pass-through at `:36` | re-ground |
| `services/xstockstrat-config/docs/context-constitution.md:36` | `CLAUDE.md:30` | `trading_mode='all'` at `:34` | re-ground |
| `services/xstockstrat-config/docs/context-constitution-findings.md:21` | `CLAUDE.md:71` | blank; actual `:76` | re-ground |
| `services/xstockstrat-ledger/docs/context-constitution.md:28` | `CLAUDE.md:33-49` | Live-Streaming section is `:37-53` | re-ground |
| `services/xstockstrat-ledger/docs/context-constitution.md:29` | `CLAUDE.md:70-90` | idempotent-append section is `:72-84` | re-ground |
| `services/xstockstrat-{ledger,notify}/docs/context-constitution-findings.md:12/:11` | `CLAUDE.md:62-67` / `:48-50` | config-key tables at `:68-70` / `:51-53` | re-ground |
| `services/xstockstrat-notify/docs/context-constitution.md:20` + `findings.md:28` | `notifyServiceImpl.ts:81` | `sub.call.write(alert)` is `:80` | re-ground both |

**Passed spot-checks (no action):** ~110 citations resolved exactly across trading, portfolio, marketdata,
indicators, ingest, analysis (`evaluator.py`, `servicer.py` incl. post-069–072 lines), UI (`src/lib/*`,
`auth.ts:65-76`), otel, docker-compose healthcheck/pool anchors, and all 39 root Context Guide `Task→Read`
paths — including the new `docs/patterns/strat-lab-plugin.md`. The 2026-07-28 re-grounding held where it ran.

## Restated facts (agent reads for free) — fails CF-N4

| Context line | What restates it | Suggested action |
|---|---|---|
| `docs/roadmap/ledger/CLAUDE.md:9-10` | `insights.md:8-11,19` / `fails.md:8-14,20` headers say the same; line 12 already points there | collapse to pointer |
| `docs/roadmap/features/CLAUDE.md:88-96` (skills table) | each `SKILL.md` frontmatter + root `CLAUDE.md:444` chain | delete table |
| `docs/roadmap/CLAUDE.md:6-10` (per-phase one-liners) | each `phase[3-7]-deviations.md` opens with the same summary | reduce to one line |
| `docs/setup/CLAUDE.md:13-19` ("Setup order") | restates the table at `:7-11` in the same order | delete list |
| `services/xstockstrat-indicators/docs/context-constitution.md:36` | points into the same service's always-loaded `CLAUDE.md:79-89` | drop same-file pointer rows |

## Cross-file duplication — CF-N3

| Context line | Duplicate location(s) | Keeper | Suggested action |
|---|---|---|---|
| `docs/CLAUDE.md:23-43` "Common Scenarios" (21 lines / 1,828 c) | ~15 rows duplicate root `CLAUDE.md:52-82` Context Guide | root | delete the docs/ table |
| `CLAUDE.md:365` ∥ `docs/context-constitution.md:29` ∥ `docs/context-constitution-findings.md:17` | "`src/middleware/propagation.ts` presently unused" ×3 | `CLAUDE.md:365` | trim PLAT-4 parenthetical; findings row stays as the defect |
| `README.md:28-41` service/port table | strict subset of `CLAUDE.md:92-105` (ports verified vs `docker-compose.yml`) | `CLAUDE.md` | consider trimming README to names + the `:43` link (publish-facing call) |
| `README.md:49-54` bootstrap block | `CLAUDE.md:291` + `docs/setup/getting-started.md:79-107` | — | keep (publish-facing) but note 3-file co-update |
| `CLAUDE.md:56` nginx row | also `CLAUDE.md:468` + `docs/CLAUDE.md` | `CLAUDE.md:468` | drop the Context Guide row |
| `docs/roadmap/CLAUDE.md:5,12` "all phases DONE" | root `CLAUDE.md:397` (+ intra-file twice) | root | keep only the file table |
| `docs/roadmap/features/CLAUDE.md:3-7` numbering rule | root `CLAUDE.md:403` verbatim | root | pointer |
| `docs/roadmap/features/CLAUDE.md:155` read-context.md-first | root `CLAUDE.md:441-442` | root | delete |
| `docs/roadmap/features/CLAUDE.md:159` /sdd-status | root `CLAUDE.md:436,440` | root | delete |
| `docs/roadmap/features/CLAUDE.md:59` lifecycle enum | same file `:13-24` + root `CLAUDE.md:405` | table `:13-24` | delete `:59` |
| `docs/roadmap/CLAUDE.md:24-26` ledger memory | root `CLAUDE.md:81` + `ledger/CLAUDE.md:9-10` | root | bare link |
| `docs/sdd/CLAUDE.md:9` ID tiers | root `CLAUDE.md:79` | root | trim to read-when half |
| root `CLAUDE.md:181-183` (065 keys + zero-trap) | `services/xstockstrat-analysis/CLAUDE.md:257-259` (+ constitution `:15`) | **unresolved tension**: root `CLAUDE.md:173` says defaults live in service CLAUDE.md | pick one home, then cut the other |
| root `CLAUDE.md:192` (068 key) | *absent* from analysis CLAUDE.md — inverse of the row above | same decision | apply the chosen rule both ways |
| `services/xstockstrat-agent/CLAUDE.md:17` admin-scope fact | same file `:49` + constitution AGENT-3 | AGENT-3 | reduce `:17` to pointer |
| `services/xstockstrat-analysis/CLAUDE.md:107` scored-event | same file `:288` + constitution `:23` | `:288` | drop `:107` |
| `services/xstockstrat-ledger/CLAUDE.md:51` pool split | root Pool Budget table (+ `:116`, constitution `:28`) | root | keep only the portfolio-3-subs scar locally |

## Contradicted by code

Defects (CF-N9) — routed to `/context-constitution`'s findings flow; **never `apply`-deleted**. The
"resolved-row" entries are the findings logs themselves now contradicting the fixed docs — retire them via
`refresh`'s `## Resolved` mechanism.

| Context line | What the code/repo does | Evidence | Suggested action |
|---|---|---|---|
| `plugins/strat-lab/skills/backtest/SKILL.md:37` "replace semantics, not a partial merge" | 070 `update_mask`: present ⇒ merge, absent ⇒ replace | `servicer.py:1546-1590`; `analysis.proto` `update_mask`; agent `CLAUDE.md:38` | rewrite: absent-mask ⇒ replace; mask ⇒ partial merge |
| `plugins/strat-lab/skills/backtest/SKILL.md:39` "every update must carry the full definition" | false when a mask is passed | same | amend with mask path |
| `plugins/strat-lab/skills/backtest/SKILL.md:55` + `reference/output-handling.md:1-7` | 072: tool returns summary + attachments (`summary["attachments"]`), self-truncating | `tools.py:286-304` | rewrite Phase 2 around attachments |
| `CLAUDE.md:90` "HTTP Port column applies … to the frontends, nginx, and the agent" | nginx removed (feature 045); `CLAUDE.md:271` says so itself | `services/` has no nginx | **fixed this run** (branch `claude/ai-literacy-portfolio-review-30pbpe`) |
| ⚠ `docs/context-constitution.md:29` (PLAT-4) "Nginx/edge strips these" | header-trust boundary is now the `xstockstrat-ui` middleware | `src/middleware.ts`, `src/lib/auth.ts:65-76` | re-ground the Why (refresh) |
| `README.md:3` "10 gRPC microservices and a config service" | the 10 include config — double-count | `README.md:28-39` table | **fixed this run** |
| `services/xstockstrat-analysis/CLAUDE.md` config table | feature 068's consumed key + `GetBacktest` + migration 008 absent | `servicer.py:1403`; root `CLAUDE.md:192` | add 068 surface to service doc |
| `services/xstockstrat-ui/CLAUDE.md:206-207` e2e counts | orders 6/1, formulas 3/3, strategy-authoring 15/5 | measured in `e2e/` | drop the counts |
| `docs/patterns/CLAUDE.md:9` "Adding a new frontend to the nginx reverse proxy" | nginx path is historical | `nginx-routing.md:3` deprecated | reword cell |
| `docs/runbooks/CLAUDE.md:17` "all fourteen agent tools" | 13 sections; `set_strategy_live` (real tool, `tools.py:529`) undocumented | grep | drop count; log the gap |
| `docs/runbooks/CLAUDE.md:8` "(API / n8n / UI)" | no n8n in `approval-flow.md` or repo | grep | drop "n8n" |
| `docs/CLAUDE.md:41` "Import and configure n8n workflows" | `docs/setup/n8n.md:1` "No Longer in Use" | — | mark deprecated/delete |
| `docs/CLAUDE.md:13,15` wrong setup list; "issues are disabled" | issues in active use (`sdd-triage` runs `gh issue view`) | `SKILL.md:80` | rewrite cells |
| `docs/CLAUDE.md:3` "Four subdirectories" | 7 subdirs, 5 with CLAUDE.md | ls | fix count |
| `docs/roadmap/features/CLAUDE.md:95` sdd-execute modes | missing `sequential` | `sdd-execute/SKILL.md:4` | fix row |
| `docs/context-constitution-findings.md:18` "Go 1.22" row | all three Go CLAUDE.md say 1.25 | resolved | retire (refresh) |
| `docs/context-constitution-findings.md:20` "Node.js 20" row | all four say Node 22; only `@types/node ^20` half survives | resolved half | narrow row (refresh) |
| resolved-row GC ×9: `indicators/findings:12` (pool), `marketdata/findings:10,11` (ohlcv_1h, compression), `ingest/findings:11,14` (signals keys, data.normalized), `identity/findings:11,12` (jwt.secret, ledger dep), `ledger/findings:11` (rules→triggers), `notify/findings:12` (ledger dep), `config/findings:11,12` (DELTA, pg_notify) | each asserts a doc-lie the current doc no longer contains | verified per-file | retire via refresh `## Resolved` |
| `packages/otel/docs/context-constitution-findings.md:10` | its own cited evidence (`alerts/README.md:19-28`) disproves it | read | retire |
| `docs/context-constitution.md:43` "documents this only for `shrinkage_days`" | root documents the zero-trap at `:181` and `:192` | read | re-ground |

## Should be just-in-time (pre-loaded → pointer)

| Context range | Why mis-placed | On-demand home | Measured |
|---|---|---|---|
| `services/xstockstrat-analysis/CLAUDE.md:63-121` (§065 derivation) | scoring-path rationale on every load; invariants already ANALYSIS-2/3 | `docs/patterns/` | 59 ln / 4,810 c |
| `services/xstockstrat-analysis/CLAUDE.md:123-169` (§071 warm-up) | needed only touching `warmup.py`/bar-fetch | `docs/patterns/` | 47 ln / 3,836 c |
| `services/xstockstrat-ui/CLAUDE.md:172-207` ("Page reuse (future optimization)") | speculative refactor guidance, unused shape | `e2e/README.md` | 36 ln / 1,541 c |
| `docs/roadmap/features/CLAUDE.md:102-137` (status-automation internals) | needed only when a promotion fails | workflow file itself | 36 ln / 1,513 c |
| `docs/roadmap/features/CLAUDE.md:141-149` (Workflow Summary) | third telling of the same pipeline | delete | 9 ln / 543 c |
| `docs/roadmap/CLAUDE.md:10` phase-7 symbol trivia | detail lives in `phase7-deviations.md` | that file | 1 ln |

## Brittle / over-specified (anti-altitude)

| Context line(s) | Why brittle | Heuristic |
|---|---|---|
| `services/xstockstrat-agent/docs/context-constitution.md:13` exemplar column | 4/6 exemplars died within 4 days in the fastest-moving service | cite symbols; line as hint |
| `.md`→`.md` line cites (analysis `:23,32`; indicators `:37,38`; config `:35,36`; ledger `:28,29`; +findings) | 15+ broke this cycle | cite `§ heading` for md→md |
| `docs/roadmap/features/CLAUDE.md:122` paraphrased regex | drifts against `ci-validate-feature-status.yml:46` | delete (workflow is source) |
| `docs/roadmap/features/CLAUDE.md:112` "Marks them code-completed" | promote only *reads*; CI flips | delete |
| `docs/patterns/CLAUDE.md:8` 40-word subheading enumeration | breaks on any edit of the target | "anything else Next.js" |
| `packages/otel/docs/context-constitution.md:17` `="0"` label | repo's only rule is `!="0"` (`alert-rules.yaml:44`) | write `!="0"` |

## Bloat / low-value prose

| Context line(s) | Why filler | Action |
|---|---|---|
| `docs/roadmap/features/CLAUDE.md:99-100` double `---` | rendering artifact | delete one |
| `docs/roadmap/features/CLAUDE.md:130-137` (8 ln / 340 c) | restates `:64-69` | delete |
| `docs/roadmap/features/CLAUDE.md:73-75` (3 ln / 186 c) | restates `:36-38` | delete |
| `docs/roadmap/features/CLAUDE.md:137` hypothetical date example | no repo referent | delete |
| `docs/setup/CLAUDE.md:19` n8n as setup step 5 | deprecated stub | delete step |
| `docs/sdd/CLAUDE.md:11-13` meta-commentary | 13-line file, 1-row table | fold in |
| `docs/patterns/CLAUDE.md:5-18` index 3 files short | missing `strat-lab-plugin.md`, `client-api-pattern.md`, `dry-guard-rail.md` | add rows (index gap) |

## Context budget (file-level)

Soft budget ~2,000 c/auto-loaded file; all measured. 54 files, ~3,300 lines, ~246 KB total. Biggest:

| File | Lines | Chars | Over? |
|---|---|---|---|
| root `CLAUDE.md` | 499 | 34,448 | yes (17×) |
| `services/xstockstrat-analysis/CLAUDE.md` | 316 | 24,980 | yes — §065+§071 = 34% of it |
| `services/xstockstrat-ui/CLAUDE.md` | 248 | 13,917 | yes |
| `services/xstockstrat-trading/CLAUDE.md` | 194 | 13,818 | yes |
| `services/xstockstrat-marketdata/CLAUDE.md` | 134 | 13,611 | yes |
| `docs/context-constitution.md` | 69 | 12,039 | yes |
| `docs/roadmap/features/CLAUDE.md` | 159 | 7,552 | yes |
| `README.md` (opt-in) | 88 | 6,567 | yes (publish-facing; budget advisory only) |

`packages/otel/CLAUDE.md` and `packages/proto/CLAUDE.md` (10 lines each) are the exemplary pointer-only shape.

## Keep-but-verify (unconfirmed — CF-1)

- `README.md:83-86` — should "What's checked in" list the `test-data` skill and the new `strat-lab` plugin/marketplace? — **maintainer call**
- `CLAUDE.md:397` — Phases 0 and 2 carry no ✅ marker in `implementation-roadmap.md` (`:13`, `:146`); done-but-unmarked, or root ahead of source?
- `CLAUDE.md:82` — is the strat-lab same-PR guard enforced anywhere (CI/pre-commit), or doc-only? Should `plugins/strat-lab/` join §Key File Paths?
- `services/xstockstrat-agent/*` — should the agent's own context carry the strat-lab same-PR obligation (the tools are edited there)?
- `services/xstockstrat-agent/docs/context-constitution.md:19` — AGENT-5's "older tools don't have it": 7 wrapped sites vs 14 tools — intended state?
- `services/xstockstrat-agent/docs/context-constitution.md:16` — AGENT-2 "N≈21" vs measured 24 lazy imports — confirm number
- `services/xstockstrat-analysis/app/config/watcher.py:92` — `indicators.sandbox.*` helper block in the analysis service: dead copy-paste to join `findings.md:11`?
- `docs/context-constitution-findings.md:17` — narrow the propagation.ts row to the code-deletion half (doc already scoped)?
- `CLAUDE.md:56` — does the deprecated nginx pattern still earn a Context Guide row? also `.do/app.yaml:8` stale comment
- `docs/CLAUDE.md:15` — `reports/` described as 3 genres; 1 file exists
- `docs/CLAUDE.md` — constitutions + this findings file indexed nowhere in the docs index: intentional?
- `docs/patterns/CLAUDE.md:3` — if root is authoritative, does this file survive as more than a filename list?
- new patterns row target: `docs/patterns/strat-lab-plugin.md` or the plugin itself?
- `services/xstockstrat-notify/docs/context-constitution-findings.md:24` — dead `jsonwebtoken`/`bcrypt` deps: not re-verified this pass
- `services/xstockstrat-config/docs/context-constitution.md:28` — `waitForSnapshot` 10s default vs 90s: **answerable now** — `configWatcher.ts:71` default is overridden at every call site (e.g. `notify/src/index.ts:19` passes 90_000); promote to resolved gotcha
- `services/xstockstrat-ui/docs/context-constitution.md:29-30` — both prior candidates remain legitimately open

## Protected blocks (reported, never trimmed)

| Block | Location | Marker |
|---|---|---|
| behavioral contract | `CLAUDE.md:1-22` | `context-forge:behavioral-contract` |
| constitution pointer ×14 | lines 3-5 of every `services/*/CLAUDE.md` and `packages/{otel,proto}/CLAUDE.md` | `context-forge:constitution-pointer` |

The Teardown section (`CLAUDE.md:24-31`) sits outside the sentinel and audited clean. Two previously-logged
⚠ security defects (UI audit-route admin gap `config-ui/api/audit/route.ts:11,20-23`; identity
unsigned-token revoke `identityServiceImpl.ts:203-209`) re-verified as **still true and correctly cited** —
accurate open defects, not context failures.

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins). These are low-signal lines to trim,
not rules to keep — nothing grounded is dropped (**CF-N8**). Re-run `/context-scrubber` to re-audit._
