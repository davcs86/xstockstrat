# Context Scrub — Findings

Low-signal context surfaced by `/context-scrubber scan` on **2026-08-02**, run on `main-dev` HEAD
`53608da` — **immediately after** the context-constitution refresh that landed this session. Each row is a
line in an **auto-loaded** context file (`CLAUDE.md`, `context-constitution.md`,
`context-constitution-findings.md`, the opt-in `README.md`) — or the shipped `plugins/strat-lab/` skill,
which root `CLAUDE.md:82` binds to the backtest APIs — that an agent would find for free, that no longer
resolves, that is duplicated, or that the code now contradicts. **Report only — nothing was trimmed** (scan
mode). Every row cites both sides.

> **Scope:** 54 targets (23 `CLAUDE.md` + 15 `context-constitution.md` + 15
> `context-constitution-findings.md` + `README.md`) plus the `strat-lab` backtest skill, via 4 parallel
> read-only auditors; every load-bearing verdict re-confirmed against the actual code.
>
> **✅ The refresh held.** Pass 1 re-verified every re-grounded citation and all 5 new rules (`PLAT-7`,
> `PORTFOLIO-5`, `CONFIG-5`, `NOTIFY-4`, `ANALYSIS-6`) against current code — **all resolve; zero stale
> constitution citations remain.** The large stale-citation backlog the 2026-07-28 run reported across the
> module constitutions is closed. What this scan surfaces is concentrated in three places the refresh did
> **not** touch: **(1)** the `strat-lab` skill's reference files (stale vs shipped features 070/072),
> **(2)** the docs-tree index `CLAUDE.md` files, and **(3)** per-service findings-log rows that assert
> defects later features already fixed.
>
> **⚠ security** marks authz/secret rows. The *Contradicted-by-code* section is a **defect log, not a
> delete list** (CF-N9) — the fix is a human triage call; `apply` never deletes those rows.

## Summary

Measured directly from the flagged lines/ranges (no tokenizer; any token figure is `≈ chars ÷ 4`).

| Category | Failing rows | Lines | Characters |
|---|---|---|---|
| Stale citations | 6 | ~7 | ≈ 700 |
| Restated (agent reads for free) | 1 | ~2 | ≈ 200 |
| Cross-file duplication | 3 | ~40 | ≈ 3,900 |
| Contradicted by code (defects — never apply-deleted) | 6 | ~60 | ≈ 4,600 |
| Should be just-in-time | 0 | — | — |
| Brittle / over-specified | 3 | ~30 | ≈ 2,700 |
| Bloat / low-value prose | 2 | ~50 | ≈ 2,300 |
| **Removable total** (trim/bloat/dup — pure subtractions) | 4 | ~90 | ≈ 6,000 |
| Findings-log rows to mark resolved (via refresh) | 7 | — | — |
| Keep-but-verify (unconfirmed / still-open defects) | 8 | — | — |

## Top actions (ranked by behavioral impact)

1. **Fix the `strat-lab` backtest skill — the only findings that change agent *behavior*.** Its reference
   files still teach the pre-070/072 flow while `SKILL.md`'s own top-level teaches the correct one, so the
   skill is *internally self-contradictory* and the stale copy wins at the decisive moment (the self-grill
   check the agent runs before reporting). Owned by the plugin; per root `CLAUDE.md:82` it must be fixed in
   the same PR as the APIs — file the fix against `davcs86/agent-plugins`.
2. **Re-ground the docs-tree indexes** — stale nginx/n8n routes and three missing pattern/runbook files
   (`client-api-pattern.md` is routed from *no* index).
3. **Findings-log GC** — retire the ~7 resolved rows via `/context-constitution refresh`'s `## Resolved`
   mechanism, not by hand-deleting (mirrors the resolved-annotations this session already added).
4. **Two CLAUDE.md drifts** — `ledger:91-92` states unimplemented compression/retention as active fact
   (contradicting its own config table); `ui:144` restates the pool budget as "20" where root says "~22".

## Stale citations

Action `re-ground` via `/context-constitution refresh` (for constitution rows) or fix the index (for docs).

| Context line | Citation | Reality | Suggested action |
|---|---|---|---|
| `docs/patterns/CLAUDE.md:9` | `nginx-routing.md` "Adding a new frontend to the **nginx** reverse proxy" | nginx removed (feature 045); root + `docs/CLAUDE.md:25` already mark it deprecated | reword cell to "historical reference" |
| `docs/runbooks/CLAUDE.md:8` | approval-flow "(API / **n8n** / UI)" | n8n removed (feature 011); `approval-flow.md` §Approval Mechanisms lists Direct API / agent / UI | drop the "n8n" token |
| `docs/CLAUDE.md:41` | "Import and configure **n8n** workflows → `setup/n8n.md`" | `setup/n8n.md` is a deprecated stub; `setup/CLAUDE.md:11,19` mark it so | mark deprecated / delete row |
| `docs/patterns/CLAUDE.md:7-18` (table) | omits `client-api-pattern.md`, `dry-guard-rail.md`, `strat-lab-plugin.md` (all on disk) | `client-api-pattern.md` (feat 044) is routed from **no** index — reverse-inclusion fail | add the missing rows |
| `docs/runbooks/CLAUDE.md:6-18` (table) | omits `reviewer-registry.md` (on disk; cited by features/CLAUDE.md:82 + root Key File Paths) | index lags its directory | add the row |
| `docs/context-constitution.md` NOTIFY-1/PLAT-F1 loose anchor | `notifyServiceImpl.ts:47,183` | resolves to the block *start*; the actual `alertSeverityToNumber`/`FromJSON` calls are `:54`/`:188` | optional tighten (points to right block) |

## Restated facts (agent reads for free) — fails CF-N4

| Context line | What restates it | Suggested action |
|---|---|---|
| `docs/CLAUDE.md:21-43` "Common Scenarios → Right File" | re-implements the routing already in root `CLAUDE.md` Context Guide + the three child indexes | keep as nav aid, but it's the most drift-prone copy (already carries the n8n/nginx staleness above) |

## Cross-file duplication — CF-N3

| Context line | Duplicate location(s) | Keeper | Suggested action |
|---|---|---|---|
| `README.md:28-41` service/port table | subset of root `CLAUDE.md` §Service Registry | root | defensible (public front door) but a second port copy that will drift — consider trimming to names + link |
| proto candidate rules (RPC-return-shape, closed-set-strings) | `docs/context-constitution.md:52-53` **and** `packages/proto/docs/context-constitution.md:29-30` (+ proto findings:21) | proto module | drop the two root duplicates (both flagged unverified) |
| `docs/CLAUDE.md:21-43` route table | (see Restated) | root Context Guide | third place the same routes must be maintained |

## Contradicted by code

Defects (CF-N9) — routed to human triage / the plugin owner; **never `apply`-deleted**.

| Context line | What the code does | Evidence | Suggested action |
|---|---|---|---|
| `plugins/strat-lab/.../reference/self-grill.md:12-14` — "`manage_strategy update` is **replace-semantics** — a partial update wipes components" | feature 070: `update_mask` present ⇒ partial merge, absent field is **preserved** | `analysis/app/handlers/servicer.py:1649-1652`, merge `_merge_definition_json:2500-2521`, erasure guard `:2542-2551`; contradicts the skill's *own* `SKILL.md:36-46` | rewrite to partial-merge; this is the check the agent runs before reporting — highest priority |
| `plugins/strat-lab/.../reference/output-handling.md:1-46` + `SKILL.md:54-60` — "harness saves the payload to a file; python3-parse the overflow `*run_backtest*.txt`" | feature 072: `run_backtest` returns an inline self-truncating summary **text block** + an attached `application/json` resource — no file | `agent/app/tools.py:363-398`, `backtest_view.summarize:54-82` (drops bars/trades), `build_blocks` EmbeddedResource `:85-114` | rewrite around the inline summary + attachment; the save-and-parse script is dead |
| `plugins/strat-lab/.../reference/aggregation.md:40` — "full-definition update each time" | same partial-merge backend as above; a sweep changes only the swept param | `servicer.py:1649`; contradicts `SKILL.md:39` example | drop the full-definition instruction |
| `services/xstockstrat-ledger/CLAUDE.md:91-92` — "**Compression: after 3 days** … **Retention: 2 years**" as active facts | no migration implements either (only migrations 000/001/002; grep `add_*_policy` = 0); same file's config table `:69-70` annotates the keys "**not yet implemented**" | `ledger/migrations/`; self-contradiction | reword "planned, not yet applied" (mirror marketdata's fix) |
| `services/xstockstrat-ui/CLAUDE.md:144` — "part of the platform's **20-connection** budget" | root owns the number and says **~22** | root `CLAUDE.md` §Connection Pool Budget | delete the number, keep the cross-ref |
| `services/xstockstrat-marketdata/CLAUDE.md:111` — "nginx 'Authorization Required' page" | describes **Alpaca's** external edge 401, not the removed platform nginx | `internal/alpaca/client.go` | keep-but-verify: reword to avoid the nginx misread |

## Findings-log rows to mark resolved (defect fixed, row still asserts it open)

Retire via `/context-constitution refresh`'s `## Resolved` mechanism — never hand-delete (CF-N8/CF-N9).

| Row | Fixed by / at | Note |
|---|---|---|
| `xstockstrat-agent/…-findings.md:41` (F-6) — `manage_signal_source` "always reactivates (`active=True` hardcoded)" | feature 088 honest verbs: `agent/app/client.py:687` (`SIGNAL_SOURCE_OPERATION_REACTIVATE`/`DEACTIVATE`) | mark resolved |
| `…-agent/…-findings.md:43` (F-8) — `set_config` typo "silently creates orphan key" | feature 091 create_key gate (already annotated in `config/…-findings.md:22`) | mark resolved |
| `…-agent/…-findings.md:44` (F-9) — conviction `>1.0` "fails INTERNAL not INVALID_ARGUMENT" | feature 092: `ingest/app/handlers/servicer.py:722` rejects out-of-range with `INVALID_ARGUMENT` (INGEST-4 already cites this) | mark resolved |
| `…-agent/…-findings.md:45` (F-10) — "built RPCs with no MCP surface" | all now surfaced: `tools.py` `get_formula:662`, `list_formulas:675`, `cancel_backfill:840`, `test_formula:853`, `list_strategies:883`; `emit_alert` passes context/tags/correlation_id | mark resolved |
| `…-agent/…-findings.md:38` (F-2/F-3) | **partial** — read tools + `manage_formula` `outputs`/`warmup_period` now exist (`client.py:581,595-612`); the "manage_formula update is full-replace" sub-claim may persist | split the row |
| `xstockstrat-marketdata/…-findings.md:10,11` — `ohlcv_1h` CAGG + compression doc-lies | doc corrected: marketdata `CLAUDE.md` Database now says "Planned, not yet implemented" | mark resolved |
| `xstockstrat-ingest/…-findings.md:11` — 9 `ingest.signals.*` keys documented | doc corrected: ingest `CLAUDE.md` config table now lists only `ingest.backfill.*` (grep `ingest.signals` = 0) | mark resolved |

## Brittle / over-specified (anti-altitude)

| Context line(s) | Why brittle | Heuristic / action |
|---|---|---|
| `plugins/strat-lab/.../reference/output-handling.md:22-46` — `glob`/`getmtime`/`json.load` extract script | brittle *and* obsolete (parses a file feature 072 no longer produces) | collapse to "read the inline summary block; open the attachment only for per-bar detail" |
| `docs/runbooks/CLAUDE.md:17` — "all **twenty-two** agent tools" | a hardcoded count drifts on any tool add/remove (restated again in `mcp-tools.md:3,37`) | "the agent's MCP tools" — drop the integer |
| `plugins/strat-lab/.../reference/aggregation.md:29-34` — per-file-load aggregation snippet | assumes the obsolete file-parse source | rewrite: per-symbol scalars come from each call's inline summary |

## Bloat / low-value prose

| Context line(s) | Why filler | Action |
|---|---|---|
| `docs/roadmap/features/CLAUDE.md:102-149` (48 ln / 2,074 c) — "Automation: Preventing Stale Statuses" | narrates CI/promotion mechanics owned by `/promote` + `ci-validate-feature-status.yml`; the actionable rule is the two lines at `:157` | trim to the invariant + a pointer |
| `plugins/strat-lab/.../reference/{verification,self-grill}.md` overlap (~1 KB) | self-grill items 4-5 restate verification.md's window-artifact + ddof/NaN guidance near-verbatim | de-dup across the two Phase-4 files |

## Context budget (file-level)

Soft budget ~2,000 c per auto-loaded file (deliberately conservative for a monorepo). Biggest, measured:

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

## Keep-but-verify (unconfirmed / still-open — never `apply`-trimmed)

Genuinely-open defects confirmed still live (leave in their findings logs, do **not** mark resolved):

- ⚠ **security** `xstockstrat-ui/…-findings.md:16` — config-ui audit route gates on `getSessionFromRequest` only, **no admin-scope check** (`config-ui/api/audit/route.ts:20-23`). Open.
- ⚠ **security** `xstockstrat-identity/…-findings.md:17` — `revokeToken` decodes the JWT **without signature verify** (`identityServiceImpl.ts:203-209`). Open.
- ⚠ **security** `xstockstrat-analysis/…-findings.md:15` + root findings:37 — fundsignal loop still injects `x-access-scope=4` (`fundsignal_loop.py:346`); agent-half already resolved+annotated, loop-half open.
- ⚠ **security** `xstockstrat-indicators/…-findings.md:17` — sandbox child still inherits full parent `os.environ`. Open.
- `docs/context-constitution-findings.md:20` (Node 20) — `@types/node ^20.12.12` pin still present in all four Node `package.json` (the ◐ PARTIAL annotation is accurate).
- `xstockstrat-trading/…-findings.md:11` (`max_retries` no retry loop) and `xstockstrat-marketdata/…-findings.md:13` (stale `marketdata_handler.go:20-22` Connect-RPC comment) — both still open.
- Root dead-code rows (`getEnvBool`, `middleware/propagation.ts` in all 4 Node services) — zero prod importers reconfirmed; still open.
- `docs/CLAUDE.md:3` "Four subdirectories" — `reports/` is a fifth dir without a CLAUDE.md; verify whether the "four" phrasing intends to exclude it.

## Protected blocks (reported, never trimmed)

| Block | Location | Marker |
|---|---|---|
| behavioral contract | `CLAUDE.md:1-22` | `context-forge:behavioral-contract` |
| constitution pointer | 14× service/package `CLAUDE.md:3-5` | `context-forge:constitution-pointer` |

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins). Low-signal lines to trim / fix,
not rules to keep — nothing grounded is dropped (**CF-N8**). Re-run `/context-scrubber` to re-audit; run
`/context-constitution refresh` to re-ground citations and retire the resolved findings rows._
