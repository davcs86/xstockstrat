# Context Scrub — Findings

Low-signal context surfaced by `/context-scrubber` on 2026-09-03 from branch
`claude/loaded-plugins-list-d120nl` at commit `3881294` — the repo state this audit reflects.
Scope: the 27 context files changed by the 2026-09-02 `/context-constitution refresh` (14
`context-constitution.md` + 13 `context-constitution-findings.md`); audited by four parallel
`context-auditor` subagents, every grounded verdict re-confirmed against code by the orchestrator.
This is a report for triage; trimming is **gated** (`/context-scrubber apply`), never automatic.

> **Headline:** the refresh is high-quality — **every newly-added rule (PLAT-11/12, PROTO-7/8,
> ANALYSIS-9, CONFIG-9/10, IDENTITY-5..9, INGEST-6/7/8, LEDGER-5/6/7, MARKETDATA-9/10/11/N2,
> NOTIFY-5/6, PORTFOLIO-11, TRADING-6/N2/N3, UI-7) resolves exactly against code.** The findings below
> are almost entirely **pre-existing citation drift on rules that were NOT in the 2026-09-02 re-ground
> set**, plus two near-verbatim restatements. No security-boundary contradictions.

## Summary

Measured directly from the files. No tokenizer ran this session → token column is `—`; any token figure
elsewhere would be an explicit `≈ chars ÷ 4` approximation.

| Category | Failing lines | Lines | Characters | Tokens (only if measured) |
|---|---|---|---|---|
| Stale citations | 8 | 8 | ~1,050 | — |
| Restated (agent reads for free) | 1 | 1 | ~470 | — |
| Cross-file duplication | 1 | 1 | ~620 | — |
| Contradicted by code | 0 | 0 | 0 | — |
| Should be just-in-time | 0 | 0 | 0 | — |
| Brittle / over-specified | 1 | 1 | ~640 | — |
| Bloat / low-value prose | 0 (see keep-but-verify) | 0 | 0 | — |
| **Removable total** (excludes keep-but-verify + contradicted) | 2 | 2 | ~1,090 | — |
| Keep-but-verify (unconfirmed) | 6 | — | — | — |

> The 8 stale-citation rows are **re-grounds, not removals** (0 net lines subtracted — a citation is
> corrected in place); they are a `/context-constitution` refresh job, excluded from the removable
> total per the apply-protocol. The removable total is only the restatement + duplication trims.

## Stale citations

All 8 confirmed by the orchestrator against code (grep/Read at the cited path). Action is **re-ground**
in every case — the referenced knowledge exists, the line anchor drifted.

| Context line | Citation it makes | Reality | Suggested action |
|---|---|---|---|
| `docs/context-constitution.md:33` (PLAT-6) | `portfolio_service.go:688` | `GetInt("portfolio.snapshot.interval_minutes", 5)` is at `:720`; `:688` is `GetPnL`'s closing brace. Pre-existing drift (PLAT-6 not in the 2026-09-02 re-ground set) | re-ground `:688`→`:720` |
| `services/xstockstrat-indicators/docs/context-constitution.md:25` (seed-formula gotcha) | `servicer.py:311,410` | `if row["author"] == SYSTEM_AUTHOR` is at `:322,:422`; only INDICATORS-3/-5 were re-grounded, this gotcha was missed | re-ground `:311,410`→`:322,422` |
| `docs/context-constitution-findings.md:17` (OTLP-port doc-lie row) | `docker-compose.yml:...,484` | the 5th Node/4318 line is `:489` (grep: 127,158,190,223,489); the sibling PLAT-3 rule already cites `:489` | re-ground `:484`→`:489` |
| `services/xstockstrat-ledger/docs/context-constitution-findings.md:18` (Invalid-Date latent bug) | `ledgerServiceImpl.ts:304-316` | `rowToEvent` moved: `payload: row.payload` `:416`, `occurredAt: new Date(...)` `:418` (the sibling constitution gotcha already cites `:418`) | re-ground `:304-316`→`:416,418` |
| `services/xstockstrat-ledger/docs/context-constitution-findings.md:33` (Open question) | `ledgerServiceImpl.ts:304-316` | same drift as `:18` | re-ground `:304-316`→`:416,418` |
| `services/xstockstrat-identity/docs/context-constitution.md:38` (Pointers) | `identityServiceImpl.ts:18-20` (`secondsToDate`) | `:18-20` is `rolesToStrings`/etc.; `secondsToDate` is defined at `:44-46` | re-ground `:18-20`→`:44-46` |
| `services/xstockstrat-identity/docs/context-constitution.md:19` (IDENTITY-3) | in-handler raw codes `:49,80,115,119,269`, example `:52` | mis-grounded (`:115` blank, `:269` is OAuth-sign / IDENTITY-4 territory); real `callback({code:N})` sites are `:81`(3) `:89,95,158`(16) `:137,223,245`(13). The `:669` shared-denial + `authz.ts:13,45-48` cites are correct | re-ground the raw-code anchors to `:81,89,95,137,158,223,245` |
| `services/xstockstrat-trading/docs/context-constitution.md:37` (AdminScope contract gotcha) | Python `ADMIN_SCOPE = 0x04` at `scopes.py:6`; agent pre-check `tools.py:1638` | `:6` is a docstring mention; the real constant is `_ADMIN = 0x04` at `scopes.py:37`. `tools.py:1638` is a docstring; the real `scope & 0x04` gate is `:1691` (already also cited) | re-ground Python cite `:6`→`_ADMIN scopes.py:37`; drop docstring `tools.py:1638`, keep `:1691` |

## Restated facts (agent reads for free) — fails CF-N4

| Context line | What restates it (free to read) | Why it fails | Suggested action |
|---|---|---|---|
| `services/xstockstrat-config/docs/context-constitution.md:33` (x-internal-caller gotcha) | config `CLAUDE.md § Critical Invariants #7` (the same internal-caller channel + direction-restriction + `caller_identity` persistence) — self-acknowledged in the line ("Already documented in this service's own CLAUDE.md item 7") | the auto-loaded module CLAUDE.md already carries the prose | **trim the duplicated prose to a pointer, KEEP the code anchors** (`authz.ts:93,103,117`; `migrations/014_…:1-9` are additive over CLAUDE.md #7) — medium-low confidence |

## Cross-file duplication — CF-N3

| Context line | Duplicate location(s) | Which copy to keep | Suggested action |
|---|---|---|---|
| `packages/proto/docs/context-constitution.md:32` (body `user_id` gotcha) | root `docs/context-constitution.md` **PLAT-11** | root (higher in tree) | the proto gotcha re-enumerates the identical deprecated-field list + the same live-read exceptions PLAT-11 already carries, and even cross-refs "root PLAT-11" → **trim to a one-line pointer to PLAT-11** — medium confidence (defensible as a module-local restatement; the value is having the field inventory where a `.proto` editor sees it) |

## Contradicted by code

_None._ Every audited rule matched its implementing site. The service-CLAUDE.md doc-lies the refresh
surfaced (identity real ledger dep / method count / migration 006; analysis P&L section; config
pg_notify diagram; marketdata secret-env comments; trading missing ledger events; ui retired page) are
already correctly recorded in the per-service `context-constitution-findings.md` logs and routed to
`/context-constitution` triage — they are defects, not scrub targets (CF-N9).

## Should be just-in-time (pre-loaded → pointer)

_None._ Each constitution/findings file is already the correctly-scoped, load-on-demand module home
(pulled per-task via the root CLAUDE.md context-guide row, not on every load).

## Brittle / over-specified (anti-altitude)

| Context line(s) | Why it's brittle | Heuristic it should become | Suggested action |
|---|---|---|---|
| `services/xstockstrat-trading/docs/context-constitution.md:29` (TRADING-N1) | a full multi-clause Norm row (rule + why + 6 evidence anchors) retained only as a **SUPERSEDED** marker whose sole live purpose is "so the ID is not reused" — the header-identity contract it restates now lives in root PLAT-11 + the service CLAUDE.md | "**TRADING-N1 — SUPERSEDED 2026-09-02**: header-identity folded into root PLAT-11 (+ service CLAUDE.md); ID retired, do not reuse." | trim to the one-line heuristic (keep the marker, drop the restated contract) — **not** a removal (the SUPERSEDED label is deliberate) |

## Bloat / low-value prose

_None asserted._ See Keep-but-verify for the resolved-history-row accumulation question (findings docs
intentionally retain resolved rows as anti-rediscovery memory, so it is not asserted removable).

## Context budget (file-level)

Advisory only. **Important caveat:** these are **not** always-loaded files — each module constitution
is pulled on-demand via its CLAUDE.md pointer (root CLAUDE.md context-guide), so the ~2,000-char soft
budget (calibrated for an always-loaded file) over-flags here. Listed biggest-first for review, not as
a removal signal.

| File | Measured lines | Measured characters | Over soft budget (advisory) |
|---|---|---|---|
| `docs/context-constitution.md` (root) | 77 | 20,512 | yes — the largest; root is loaded most often, worth watching |
| `services/xstockstrat-marketdata/docs/context-constitution.md` | 61 | 13,587 | yes (on-demand) |
| `services/xstockstrat-portfolio/docs/context-constitution.md` | 50 | 12,696 | yes (on-demand) |
| `services/xstockstrat-analysis/docs/context-constitution.md` | 50 | 12,631 | yes (on-demand) |
| `services/xstockstrat-config/docs/context-constitution.md` | 54 | 12,249 | yes (on-demand) |
| _(remaining 22 files 1.4K–11.6K chars — all on-demand, none individually alarming)_ | | | |

## Silent skills (weak trigger surface)

**Out of scope this run.** This scan was scoped to the context files the session touched (the
constitution/findings docs), per the CLAUDE.md teardown rule — the repo-skill enumeration was not
performed. Run `/context-scrubber scan` at the repo root (no path scope) to include the silent-skill
advisory.

## Keep-but-verify (unconfirmed — CF-1)

- `services/xstockstrat-notify/docs/context-constitution.md:5` — the refresh header prose says "added
  NOTIFY-5/6/7/8" but the rules table defines only NOTIFY-5/6 (7/8 landed as gotcha bullets, not
  numbered rules); minor self-inconsistency in my own header — what would confirm: reconcile the header
  list to "NOTIFY-5/6 + push gotchas" — status: **fixable (author inaccuracy)**
- `services/xstockstrat-marketdata/docs/context-constitution.md:18` (MARKETDATA-2) — the top-line facts
  (streamed `1m` not persisted; `1d` REST-ingested; `15m`/`1h` stored-not-fetchable) are also in the
  auto-loaded marketdata `CLAUDE.md`; the rule's unique value is the `stream.go`/`marketdata_service.go`
  anchors + the "does not `InsertBars`" failure mode — what would confirm: whether to trim the restated
  prose and keep the anchors — status: **unverified (likely keep)**
- `services/xstockstrat-identity/docs/context-constitution.md:25` (IDENTITY-9) — "used `toUserView:31`":
  `toUserView` is defined at `:27`; `:31` is a `stringsToRoles(...)` line inside it — imprecise use-site
  cite — status: **unverified (cosmetic)**
- `services/xstockstrat-config/docs/context-constitution.md:41` (Candidate rule) — `waitForSnapshot` 10s
  vs the root 90s config-startup timeout, already self-flagged unverified — what would confirm: read
  `docs/patterns/config-startup.md` to distinguish snapshot-wait from healthcheck-wait — status:
  **unverified (pre-existing candidate)**
- Resolved-history rows grown into multi-line essays across several findings docs
  (`ingest-findings:12,14`; `ledger-findings:12,24-25`; `marketdata-findings:30-33`; `config-findings:12,20,21,24`;
  `agent-findings:12,18`; `notify-findings:11`) — is a struck-through **RESOLVED** row older than the last
  two refreshes prunable, or durable anti-rediscovery memory? — status: **unverified (policy question — do
  NOT auto-remove)**
- Several older, un-re-grounded anchors on rules outside the 2026-09-02 change set (root PLAT-8
  `config.go:105,136-142`; PLAT-9 `authz.ts:89-135`; proto PROTO-2 `trading.proto:254`/`marketdata.proto:58,89,102,120`;
  indicators INDICATORS-1/2/4 `sandbox.py`; marketdata MARKETDATA-1/3/5/6/N1) — sampled clean but not
  each independently opened this pass — what would confirm: a Read of each remaining cited `path:line` — status:
  **unverified (low drift risk — same-file neighbors of anchors that did resolve)**

## Protected blocks (reported, never trimmed)

_None._ No `context-forge:*` / `constitution-forge:*` sentinel spans exist in any audited file — the
behavioral-contract and constitution-pointer blocks live in the `CLAUDE.md` files, which were **not** in
this scoped run's target set.

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins). These are low-signal lines to trim, not
rules to keep — nothing grounded is dropped (**CF-N8**). Re-run `/context-scrubber` to re-audit._
