# Design: private-by-default-templates

**Created**: 2026-10-06
**Rounds**: 5 (full; termination: approved — round 5 APPROVE-WITH-AMENDMENTS, amendments A–H folded in below)
**Approved by**: user @ 2026-10-06
**Grounded in**: recon.md

---

## Chosen Approach

Owner-privacy for formulas, strategies, signal sources and signals; an admin-curated, per-service template
catalog whose instantiation yields independent private snapshot copies. Delivered as **two releases**:
release **N = feature 224** (expand-only schema, header-honoring but header-tolerant RPCs, all identity
threading) and the named follow-up **"224 enforce + contract"** (fail-closed, bypass removal, NOT NULL,
trigger/old-table drops). Every operator decision in `context.md` (rounds 1–5 gates) is binding.

### 1. Data — expand-only migrations in N (C-07, F-01)

| Service | File | Content |
|---|---|---|
| indicators | `007` | `is_public=false` everywhere; drop the public partial index; origin columns (`template_id`, `template_version`); `formula_templates` table. |
| ingest | `013` | `user_id` on `signal_sources`/`newsletter_signals` via fast-default `ADD COLUMN` → `UPDATE` system slugs → `DROP DEFAULT` (record prod row count); `(user_id, ingested_at DESC)` index; `signal_sources` PK → `(user_id, slug)`; new `signal_dedup_claims` (owner seeded via `signal_id → newsletter_signals.user_id`); N-1 BEFORE INSERT owner-fill trigger = **unique slug holder, else RAISE** (N-1 fails closed, never files into the seed user); `credential_scope=LEGACY_GLOBAL` column **only if prod has `mcp_client` rows** (staging has none), reset by trigger on any `config_json`/`credentials_ref` change; `source_templates` table. |
| analysis | `026` | `user_id` on `backtest_run_symbols` and `backtest_details`; `strategy_scores_v2` keyed `(user_id, strategy_id)`, SQL-seeded for unambiguous ids, ambiguous pairs recomputed at boot under a fixed cap of 50 pairs per pass; D-1 backfill of `backtest_runs.user_id` (unique owner, else `SEED_USER_ID`; NOT NULL deferred); strategy origin columns; `strategy_templates`; saga intent table. |

- Every up-file is idempotent on **both** the expanded and the contracted schema (`db-migrate.sh` dirty
  recovery re-runs from 001); triggers are created only in the one-shot branch, never re-created after
  the contract has dropped them. Files that embed `SEED_USER_ID` carry an **unconditional** unrendered
  guard. The hardcoded analysis-013 envsubst branch in `db-migrate.sh` stays (editing an applied file would
  breach F-01); new files declare `-- requires-env: SEED_USER_ID` and the script scans the header.
- N reads/writes only owner-keyed structures: `fetch_eligible` is owner-scoped
  (`backtest_run_symbols.py:70-76`); in-memory `_strategies` (`servicer.py:417`), `_recompute_locks`
  (`:504`) and `hydrate_scores` are re-keyed to `(user_id, strategy_id)` (`:2272-2278,2489,2498`);
  `backtest_runs.list_by_strategy` (`backtest_runs.py:80-84`, bare `WHERE strategy_id = $1`) gains the
  owner predicate for **both** `ListBacktests` (`servicer.py:2558`, AC-21 — two users can each own a
  `mean_reversion`) and `GetStrategyAnalytics` (`:5292`).
- **D-4 system-slug rule (AC-27):** ingest 013 assigns `user_id='system'` to sources whose type is
  `derived` (the fundamentals producers; staging has exactly one, `fundamentals`) and `SEED_USER_ID` to
  every other pre-feature source and its signals.

### 2. Access & identity

- **No public concept (FR-1, AC-2/AC-3):** `ListFormulas` returns own + system formulas and ignores
  `author_filter`/`include_public`; Register/Update ignore `is_public` and persist `false`. Fields are
  deprecated, never deleted.
- **Formula read** = owner or `SYSTEM_AUTHOR`; author is taken from the `x-user-id` header only (the body
  author branch in indicators `servicer.py:288-289` is deleted); the admin mutation override
  (`:405,:510`) is deleted. Update/Delete keep the body `user_id` fallback in N only.
- **ExecuteFormula branch order:** missing → `NOT_FOUND`; readable (owner, system, or the N-only analysis
  bypass) → run; caller is ADMIN → `PERMISSION_DENIED`; else → `NOT_FOUND` (AC-28). Admin `GetFormula`
  of a foreign formula returns it and audits.
- **Reserved `system` identity:** `x-user-id: system` without a SAN-bound grant → `PERMISSION_DENIED` in
  ingest, indicators and analysis (identity ids are UUIDs, so no collision).
  *Deliberate divergence (impl-spec Step 7, 2026-10-07):* in analysis an un-granted `x-user-id: system`
  resolves to owner `""` instead (owns nothing → reads empty, writes `PERMISSION_DENIED` via the
  existing empty-caller servicer guard).
- **Peer-SAN verification (A):** one shared helper per Python service using grpc.aio
  `context.peer_identity_key() == "x509_subject_alternative_name"` and an **exact** match against
  `context.peer_identities()`; fail closed on non-SSL transport or a non-iterable (mock) result. Step 1
  ships a spike test on the real mTLS harness (`services/xstockstrat-ingest/tests/test_mtls.py:122-160`,
  grpcio 1.80.0) proving the API before anything depends on it. Config's
  `hasSecretCallerAuthority` (`authz.ts:129-142`) is given the call object so `getAuthContext()` can bind
  the ingest grant (`authz.ts:121`) to SAN `xstockstrat-ingest`.
- **N-only indicators bypass (C):** `_INTERNAL_FORMULA_READERS` stays for N-1 analysis but is bound to SAN
  `xstockstrat-analysis` — no longer header-only. Removed in the follow-up.
- **Reserved slugs (H):** "reserved" = slug already held by `system` in `ingest.signal_sources` (no literal
  list). User REGISTER of such a slug → `ALREADY_EXISTS`; `system` REGISTER of a user-held slug →
  `FAILED_PRECONDITION`.
- **Headerless `IngestSignal` in N (E):** resolve the unique slug holder; **0 holders →
  `INVALID_ARGUMENT`** (today's behavior, `ingest servicer.py:824-825 → :792-793`; this reverses round-4
  amendment 5's FAILED_PRECONDITION and is recorded deliberately); >1 holder → `FAILED_PRECONDITION`. A
  *headered* call on a slug the caller doesn't hold changes `INVALID_ARGUMENT → NOT_FOUND` (AC-10), so
  missing and foreign slugs are indistinguishable; agent `client.py:240-244` passes codes through.
- **Signal-source writes (FR-4, AC-7/AC-26):** the `ManageSignalSource` admin gate is removed — any
  owner creates/updates/deletes their own sources; Update/Delete of a `system`-owned source →
  `PERMISSION_DENIED` for every non-`system` caller (C-10(c) protection of a shared resource).
- `ListSignalSources`/`QuerySignals` return own + `system` rows (system flagged read-only), with a
  `SignalScope` enum on `QuerySignalsRequest`.

### 3. Identity threading (analysis/agent/UI) — ships in N

Every analysis→ingest and analysis→indicators call carries a non-empty owner `x-user-id` (or the
SAN-bound `system` identity). Enumerated sites (each gets a test in /sdd-spec):

- ingest: `live_loop.py:157` (SYSTEM scope + `analysis-system-read`), `live_loop.py:457` (per-owner drain +
  one system drain per cycle), `entry_backfill.py:96` (owner memo `:102-105`), `pnl_pattern_consumer.py:378`
  (owner threaded from `:188`), `servicer.py:3458` (`_resolve_source_names`), `:5188`, `:5212`, `:5306`,
  `screener.py:320`, `fundsignal_loop.py:450`, `:479`.
- indicators (D): `GetFormula`/`ExecuteFormula` at `servicer.py:552,578,1562,2100`,
  `evaluator.py:549,576`, `screener.py:342`, `fundamentals_scoring.py:52`; `ComputeIndicator` at
  `pnl_pattern_consumer.py:96,372`, `servicer.py:1259,1269`, `evaluator.py:410`, `screener.py:293,359`; the live-loop evaluator (`main.py:148`, passes `()` today) becomes
  per-owner. analysis's `InternalCallerInterceptor` (`main.py:22,77`) is removed once threading lands.
- **CI guard (D):** a runtime client-interceptor test asserting every ingest **and** indicators stub call
  carries a non-empty `x-user-id` — not an AST `metadata=` check (that accepts `metadata=()`).
- **Fundsignal (amendments 1, F):** at the top of `run_once`, `sys_meta = trace-only(metadata) +
  x-user-id: system + x-internal-caller: analysis-fundsignal`, used for `_score`, `_ensure_source_registered`
  and `_emit_signal` on **both** the loop and the manual `RunFundamentalsScan` path
  (`servicer.py:2979-3004`); the admin-bit injection (`fundsignal_loop.py:446-448`) is deleted; marketdata
  and portfolio calls keep the caller metadata. `_source_registered` is keyed on the slug (`:83,444` vs the
  per-cycle re-read at `:161`). A register `FAILED_PRECONDITION`, or a headered `NOT_FOUND` from
  `IngestSignal` as `system`, aborts the cycle with an ERROR alert (`_emit_warning` gains a severity param).
- **Scoring fail-closed (AC-6/AC-37):** a non-empty `scoring_formula_id` is pre-flighted via `GetFormula`
  `author == SYSTEM_AUTHOR`; otherwise the cycle emits nothing and raises ERROR + notify. The per-symbol
  built-in fallback (`fundsignal_loop.py:417-419`) is deleted (deliberate C-18 removal); an empty id keeps
  the built-in scorer.

### 4. Unreadable-formula seam (@feature-185, @feature-065)

The evaluator catches `StatusCode.NOT_FOUND` at `evaluator.py:425/:498` and records `unreadable_formulas`.
**Backtest mode raises `FormulaExecutionError(formula_id, "not readable by owner")` (B)** so the symbol
takes the existing FORMULA_ERROR path (`servicer.py:912-926`), is excluded from `backtest_run_symbols`
evidence and feeds the INSUFFICIENT_DATA gate — never a buffered zero-trade cell (`:873-877`,
`:1059-1061`). The other five surfaces (live loop, EvaluateReadiness, readiness materializer,
ListOpportunities, GetIndicatorSeries) map it to "component skipped + warning", never the
`"unavailable"` marker.

### 5. Template catalog (FR-7/FR-8, OQ-4 resolved: per-service)

- **Placement:** each owning service hosts the catalog for its kind — indicators (FORMULA), ingest
  (SIGNAL_SOURCE), analysis (STRATEGY) — each exposing `ListTemplates` / `ManageTemplate` /
  `InstantiateTemplate`. Shared `common.v1` `TemplateKind` (`_UNSPECIFIED = 0`), `TemplateMeta`,
  `TemplateOrigin`. A single catalog service was rejected (see below); cross-service atomicity is only
  needed for the strategy kind and is handled by the §6 saga.
- **Authoring (AC-13/AC-14/AC-31):** create/update/retire require the ADMIN scope bit, else
  `PERMISSION_DENIED`; update bumps `version` by 1 in the same row update; retire sets `retired_at`, hides
  the template from `ListTemplates` and refuses new instantiation, and never touches instances.
- **Empty catalog (AC-15):** migrations seed no templates; existing public formulas are not converted.
- **Snapshot + update-available (AC-16/AC-17):** instances copy the payload and record
  `origin_template_id`/`origin_template_version`; every Get/List path for the kind (`GetFormula`,
  `ListFormulas`, `GetStrategy`, `ListStrategies`, `ListSignalSources`) returns `TemplateOrigin` with
  `latest_version` and `update_available`, resolved by a single batched lookup per response against the
  service's own template table (retired templates report no update).
- **Caller-chosen id (AC-34):** an `InstantiateTemplate` `strategy_id` the caller already owns →
  `ALREADY_EXISTS`, checked before the saga writes anything.

### 6. FR-9 saga (strategy-template deep copy)

Analysis orchestrates: intent row → batched single-transaction copy of formula templates into indicators as
pending-hidden rows (never cached) → CAS `PENDING→COMMITTED` inside the strategy transaction with an
owner check → on failure CAS `PENDING→ABORTING`, hard-delete copies, evict indicators cache. A
`DurableSchedule` reconcile sweep resolves stranded intents; a retired template can't start new intents.

### 7. Blend guard (@feature-186 EXTEND, G)

One helper `_require_admin_for_blend_id(context, strategy_id)` beside `_has_admin_scope`
(`servicer.py:510`), and one accessor for `analysis.engine.fundamentals_blend_strategy_id` replacing all
**five** reads: `servicer.py:2754,2882,4343`, `live_loop.py:337`, `entry_backfill.py:87`. REGISTER and
`InstantiateTemplate` call the helper on the **final** id (after `_N` suffixing); non-admins get
`FAILED_PRECONDITION`.

### 8. Config per-user secrets (FR-14)

`GetSecretRequest.user_id = 4` (additive; `config.proto:110-114`); exact-scope resolution (empty → global
`IS NULL`, so marketdata is unaffected); `SetConfig` accepts `is_secret` rows with a `user_id`
(feature-147 invariant comment `config.proto:133-135` updated per operator override); opaque UUID
credential keys; redaction on every edge holds per user. The ingest poller resolves the bearer as the
source owner with exact scope, treats `''` as missing, and passes `owner=src["user_id"]` explicitly.

### 9. Audit (FR-13)

Admin foreign reads emit `audit.admin_read`: a foreign `Get` → 2 events; a list page → 1 event on the
admin's stream (all foreign ids) + K events (one per distinct foreign owner, that owner's ids only); a page
of only the admin's own objects → 0. Appends are concurrent under a **fixed invariant cap of 4** with a
per-page K ceiling equal to the max page size (named constants with rationale, like `MAX_PARAMETERS`; no
config keys — operator decision). Any append failure fails the read closed with `UNAVAILABLE`.

### 10. Consumer surfaces (C-14)

- **Agent:** template list/instantiate tools (43 → 45 across all six inventory surfaces); `strat-lab`
  `backtest` skill updated in the same PR.
- **UI:** `/insights/signal-sources` owns create + inline weight editing (CHANGE of `@feature-161
  @AC-4/@AC-5`, signed off); `/config-ui/sources` becomes the FR-13 admin read-only view; template catalog
  pages registered in `NAV_GROUPS` (and `PLATFORM_SUBNAV`, inert, for C-10(a) wording); public toggles
  removed.

### 11. CI / tooling

`db-migrate.sh` `-- requires-env` header scan; `migration-rerun` job (renders, runs the chain twice, asserts
no trigger re-creation after contract); `migration-contract-gate` job (`-- contract-of:` header; the expand
file must already be on `origin/main`, never in the same PR); the runtime header-interceptor test (D).

### 12. Build order (release N)

0. Proto, additive → `buf-gen`. Next free field per message (trunk): indicators `FormulaDefinition` 15,
   `RegisterFormulaRequest` 11, `UpdateFormulaRequest` 12; ingest `SignalSource` 13, `QuerySignalsRequest`
   6 (`SignalScope`); analysis `StrategyDefinition` 16 (217 owns 15); config `GetSecretRequest` 4;
   `common.v1` Template* types; template RPCs on indicators, ingest and analysis.
1. Tooling + CI jobs + **SAN spike tests** (A): grpc.aio `peer_identities()` on the ingest mTLS harness
   **and** grpc-js `getAuthContext()` SAN on the config server.
2. Analysis identity threading (§3), fundsignal sys_meta + pre-flight, `GetBacktest` ownership,
   `_persist_backtest_run` writes `user_id`, owner-scoped `backtest_details` retention.
3. analysis 026 + repos + re-keyed maps + owner-scoped `fetch_eligible`/analytics.
4. Evaluator unreadable-formula seam (§4).
5. indicators 007 + visibility + ExecuteFormula order + admin read/audit (new indicators ledger client) +
   SAN-bound N bypass; remove analysis interceptor.
6. ingest 013 + owner-scoped RPCs + reserved slugs + headerless resolution + system grants.
7. Config per-user secrets.
8. Ingest poller exact-scope `GetSecret` as source owner.
9. Blend-guard helper + single accessor + REGISTER guard.
10. Templates + `InstantiateTemplate` saga (calls step-9 helper).
11. Agent tools + docs + strat-lab skill.
12. UI.
13. Teardown docs (incl. stale root `CLAUDE.md` line `xstockstrat-indicators → xstockstrat-ingest`, and the
    ingest `CLAUDE.md` "consumption by indicators" claim).

## Rejected Alternatives

- **Big-bang enforcement in one release** — rejected: a rolling deploy or analysis-only rollback sends
  headerless calls that darken the blend and reject fundsignal (`@feature-160/168/190`); two-phase cutover chosen.
- **Keep old PKs and expand around them** — rejected: AC-8/9/35 impossible in N; PK swap + new owner-keyed
  tables (`signal_dedup_claims`, `strategy_scores_v2`) instead.
- **Headerless reads return system rows only in N** — rejected: silent data loss for headerless pnl/live-loop
  paths (`@feature-042/029/176`).
- **N-1 trigger assigns "system, else SEED_USER_ID"** — rejected: files other users' private signals under
  the seed user on rollback; unique holder else RAISE instead.
- **Legacy NULL-owner runs stay NULL/unreadable (D-1 alt)** — rejected by operator: ambiguous runs go to
  `SEED_USER_ID`.
- **Template-only blend guard** — rejected: no parity with REGISTER; guard both.
- **Global per-slug MCP credentials / a config secret-write grant** — rejected by operator for per-user
  secrets in config.
- **AST `metadata=` CI check** — rejected: accepts `metadata=()`; runtime interceptor test instead.
- **Evaluator returns all-None for unreadable formulas in backtest** — rejected: becomes zero-trade
  evidence (fails.md:616-619); raise `FormulaExecutionError` instead.
- **Post-evaluation `unreadable_formulas` filter in backtest** — rejected: needs per-symbol reset on a
  shared evaluator (`servicer.py:1720`).
- **One central template-catalog service** (OQ-4) — rejected: a new service + DB schema, and
  formula/source instantiation would need the same cross-service copy the strategy saga already pays for;
  per-service catalogs keep each copy local.
- **Single server interceptor stamping verified identity** — rejected: grpc.aio interceptors can't
  reliably reach the auth context pre-handler; shared helper per service instead.
- **Literal reserved-slug list in ingest** — rejected: ingest can't read `analysis.fundsignal.source_slug`;
  DB-held `system` ownership is the reservation.
- **Config keys for audit/recompute bounds** — rejected by operator: fixed invariant caps.
- **Shared Python package for the audit/peer-SAN helpers** — rejected: no shared Python lib exists
  (`packages/` holds only `otel` and `proto`) and the services are separate deployables; per-service
  `admin_audit.py`/`peer_identity.py` copies mirror the existing per-service `mtls.py`/`telemetry.py`,
  and the jscpd duplication is accepted (impl-spec Step 14).
- **Per-object audit events** — rejected by operator: 1 + K per page.

## Open Risks

- [ ] **Prod `analysis.fundsignal.scoring_formula_id`** unverified (staging = `d1ff…` system formula). With
  AC-37 a non-system value darkens fundsignal. Pre-merge operator check — before the 224 integration PR.
- [ ] **Prod `mcp_client` row count** decides whether ingest 013 ships `credential_scope` — check at
  /sdd-spec step 6.
- [ ] **grpc.aio SAN API** (`peer_identities`) has no repo precedent — step 1 spike test must pass before
  steps 5–7 depend on it; fallback is cert parsing from `auth_context()`.
- [ ] **Ledger `DB_POOL_MAX=1`** serializes 1+K audit appends; admin list latency grows with K and fails
  closed `UNAVAILABLE` — bounded by the per-page K ceiling (step 5).
- [ ] **N-only bypass window:** SAN-bound `analysis` reader can still read any formula until the
  follow-up removes `_INTERNAL_FORMULA_READERS` — accepted for N-1 compatibility; closed in "224 enforce +
  contract".
- [ ] **Steps 2–5 test ordering:** fundsignal indicators calls still pass the interceptor until step 5;
  AC-37 tests must assert the pre-flight decision, not an indicators denial (step 2). Not deployable
  (feature-step PRs merge to `feature/<slug>` only).
- [ ] **`_formula_outputs` swallows NOT_FOUND** (`servicer.py:557-558`): AC-30's warning must be emitted
  before the "unknown series" rejection — verify at step 5.
- [ ] **Follow-up "224 enforce + contract"** must be created (number at its /sdd-story) with a
  `merge-order.md` row: fail-closed headerless, bypass removal, `backtest_runs.user_id` NOT NULL, drop
  N-1 triggers/old tables/`strategy_scores`, refuse downs, delete `LEGACY_GLOBAL`.
- [ ] **Merge-order:** feature 217 owns `StrategyDefinition` field 15 and also edits `common.proto`,
  `ManageStrategy` and `evaluator.py`; 224 uses 16+ and rebases on 217 before its integration PR
  (`merge-order.md` row 72). Agent tool count reconciles to 45 on all six surfaces.
- [ ] **Feature 084 (droplet deploy):** its `db-migrator` env must carry `SEED_USER_ID` for 224's
  `-- requires-env` files — flag at 084's /sdd-spec.

## Constitution Rules Touched

- `F-01` — honored: new numbers indicators 007 / ingest 013 / analysis 026 are free; no applied migration
  edited (analysis-013 envsubst branch kept).
- `F-03` — honored: step PRs target `feature/private-by-default-templates`; only the integration PR
  targets `main-dev`. (The bypass-removal gate is a design-time verification + operator pre-merge check,
  not an in-pipeline runtime gate.)
- `F-06` — honored: no pool size changes.
- `F-07` — honored: bounds are named invariant caps; reserved slugs derived from DB state, not literals.
- `F-11` — honored: no Floor breach in any of 5 rounds.
- `C-03` — honored with a recorded exception: fundsignal replaces `x-user-id` with the SAN-bound `system`
  identity and keeps `x-trace-id`; every other outbound call propagates the trio.
- `C-04` — honored: `SignalScope`, `TemplateKind` are enums with `_UNSPECIFIED = 0`.
- `C-07` — honored: indicators 007 / ingest 013 / analysis 026 are each service's last + 1. Expand/contract
  safety is by design §1 (idempotent up-files, rerun + contract-gate CI).
- `C-09` — honored: step 0 runs `buf lint`/`buf breaking` + `buf-gen`; all proto changes are additive.
- `C-10` — honored: (a) `NAV_GROUPS` registration (+ inert `PLATFORM_SUBNAV`, rationale recorded);
  (c) `system`-owned sources are RPC-guarded and read-only in UI, and `user_id='system'` is recorded as
  an ingest ownership convention in ingest `CLAUDE.md` (step 13).
- `C-11` — honored: every design fork escalated; operator decisions recorded per gate.
- `C-14` — honored: consumer surfaces (agent tools, UI routes) named in §10; contract deferral is a named
  follow-up feature.
- `C-15` — honored: AC-6/AC-36 amended, AC-37 added in `acceptance.feature`.
- `C-16` — honored: see Business Rules Touched; CHANGE signed off.
- `C-17` — honored: template catalog and `/insights/signal-sources` pages use tokens and the canonical
  `DataTable`/`EmptyState`/`FormDialog` primitives (step 12).
- `C-18` — honored: single blend-id accessor; `_builtin_score` fallback removal recorded as deliberate.
- `P-02` / `P-03` — honored: mediated debate; assumptions surfaced, not guessed.

## Business Rules Touched (C-16)

- CHANGE `@AC-4` / `@AC-5` `@feature-161` (`services/xstockstrat-ui/acceptance/surface-signal-weight-decay-config.feature`)
  — re-homed to `/insights/signal-sources`; signed off by user @ 2026-10-06 (context.md, round-1 gate).
- CHANGE `@AC-1` `@feature-214` "advertised tool count" (`services/xstockstrat-agent/acceptance/remove-agent-postgres-mcp.feature`)
  — 43 → 45 (`list_templates`, `instantiate_template`); signed off by user @ 2026-10-07 (context.md).
- EXTEND `@feature-186 @AC-4/@AC-6/@AC-8` — new admin-only guard on REGISTER and `InstantiateTemplate` of the
  configured blend id (round-3 gate).
- EXTEND `@feature-166 @AC-1/@AC-4`, `@feature-161 @AC-9`, `@feature-029 @AC-7/@AC-9`, `@feature-176 @AC-6` —
  owner scoping added (recon).
- PRESERVE `@feature-160 @AC-1`, `@feature-168 @AC-1/@AC-6`, `@feature-190 @AC-11` — system signals stay
  visible via own + system scope and the SAN-bound `analysis-system-read` path.
- PRESERVE `@feature-042 @AC-1` — pnl consumer queries as the order owner.
- PRESERVE `@feature-185 @AC-1` — NOT_FOUND → skipped + warning, never `"unavailable"`.
- PRESERVE runtime invariants ANALYSIS-2/3 (`services/xstockstrat-analysis/docs/context-constitution.md`,
  feature 065; not an `@AC-*`) — unreadable formula in backtest → FORMULA_ERROR, excluded from evidence.
- PRESERVE `@feature-176 @AC-3`, indicators `@AC-5` — owner checks don't serialize execution.
- PRESERVE `@feature-166 @AC-2/@AC-3` — bearer never returned, incl. admin view and template payloads.
- PRESERVE `@feature-127 @AC-1/@AC-3`, `@feature-021 @AC-11` (audit events on owner + admin streams), and
  the remaining list in recon.md § Existing Business Rules.
