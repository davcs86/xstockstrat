# Design: backtest-inline-backfill

**Created**: 2026-11-15
**Rounds**: 5 (full; termination: approved)
**Approved by**: user @ 2026-11-15 (design gate, round 5, verbatim "Agreed")
**Grounded in**: recon.md
**Debate register**: debate.md

---

## Chosen Approach

FR-6 is built. A signed-in user without the admin scope can trigger a bounded backfill from the symbol-page Backtests card and from the insights strategy page. The FR-7 scores-only fallback is not taken (R-6).

Line references are the ones recorded in recon.md, except where marked "debate", which were verified in rounds 4 and 5 and are recorded in debate.md.

### Ingest: self-serve envelope on `TriggerBackfill` (D-1, D-9, D-11, D-18, D-19, D-25)

- The admin gate at `services/xstockstrat-ingest/app/handlers/servicer.py:423-425` keeps its position and becomes "admin OR self-serve envelope". `_has_admin_scope` (`servicer.py:357`) is unchanged, and so are its other call sites.
- The envelope (tier T1) has eight conditions. The predicate returns the first one that fails as a fixed token:

| Condition | Token |
|---|---|
| Exactly one symbol | `multi_symbol` |
| Data kind UNSPECIFIED or BARS | `data_kind` |
| `FILL_MODE_GAPS_ONLY` | `fill_mode` |
| `overwrite` false | `overwrite` |
| Explicit range with `start < end` | `range_unset` |
| Span ≤ `backfill.self_serve_max_range_days` | `range_too_long` |
| Empty `callback_url` | `callback_url` |
| Non-empty `x-user-id` that is not `system` | `no_user` |

- A miss aborts PERMISSION_DENIED with the detail `self-serve backfill denied: <token>`. `range_too_long` adds ` (max <N> days)`.
- The tokens are one frozen tuple next to `_has_admin_scope`, with one formatter `_self_serve_denial_detail(token, max_days=None)`.
- Self-serve requests are de-duplicated per symbol. One connection and one transaction hold `pg_advisory_xact_lock`, `has_active_job` (QUEUED and RUNNING) and `insert_job` (`servicer.py:453`).
  - A hit returns ALREADY_EXISTS without the other job's id (R-4).
  - `insert_job` keeps its signature.
  - The ledger event `ingest.backfill.queued` (`servicer.py:464`) and the `_run_backfill` spawn (`servicer.py:472`) run after commit.
- The admin path is unchanged: no lock, no de-dup, FULL and multi-symbol still allowed.
- No `user_id` is added to the queued payload. Ledger stamps the owner from the `x-user-id` metadata that ingest already sends (D-11).
- No proto change (`packages/proto/ingest/v1/ingest.proto:78-89` already carries every field) and no ingest schema migration (the last one stays `016_seed_source_templates`).

### Config (D-4, D-14, D-17, D-28)

- New key: namespace `ingest`, key `backfill.self_serve_max_range_days`, int, code default and seed 730, `int_positive` reader, live through `WatchConfig`.
- Seeded by config migration `051_ingest_backfill_self_serve_keys`. The number is re-checked at /sdd-spec.
- The 730 default covers the span a 200-bar warmup needs: `prefix_calendar_days(200)` = 300 days plus the 366-day card window (`page.tsx:1190`) = 666 days.
- A 1000-bar warmup needs 1,825 days. The homelab is set to 1830 through `set_config`.
- `backfill.max_concurrent_jobs` (`servicer.py:348`) keeps default and seed 3. Only the homelab is set to 8 (option B). DigitalOcean is unchanged.
- Analysis `backtest.max_range_days` is checked against `request.range` only (debate, D-28), so it does not cap the warmup prefix.

### UI: symbol-page Backtests card (D-2, D-7, D-8, D-12, D-20, D-27)

- Change target: `BacktestsSection` at `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx:1133`, insufficient-data callout at `:1226-1240`.
- The callout gains a "Backfill missing data" action, open to every signed-in user.
- The request is one symbol, daily bars, GAPS_ONLY, no overwrite, from `gap.start` through the end of the backtest window (D-8). FR-2 and @AC-2 are amended to match.
- The card keeps the returned `jobId` in local state and follows it with `useBackfillStatus(jobId)` (`src/hooks/useBackfills.ts:30`). It never infers its job from `useBackfillJobs`.
- On COMPLETED it shows "Data ready" with "Re-run backtest", which calls the existing `handleRun` (`page.tsx:1178`). There is no automatic re-run (R-3).
- If that re-run is still insufficient for the same symbol and gap, the card shows "No vendor data for {range}" and hides the action for that gap (D-7).
- PARTIAL has two branches: chunk counts when chunks failed, otherwise "{symbol} returned no data for part of the range" (D-12).
- On ALREADY_EXISTS the card shows "A backfill for {symbol} is already queued or running. Try again when it finishes." and keeps the action enabled.
- On PERMISSION_DENIED, `range_too_long` maps to the span copy: "This backtest needs {span} days of history, more than the self-serve limit of {max} days. Ask an admin to backfill {symbol}." Any other or unknown token maps to one generic sentence. A raw token is never shown.
- Pure logic lives in `src/lib/backtestBackfill.ts` (`gapToBackfillRequest`, `backfillJobMessage`, `triggerErrorMessage`) and is covered by vitest.
- No BFF change: `triggerBackfill` and `getBackfillStatus` are already session-only forwards (`src/lib/insightsBff.ts:86`, `:89`).

### UI: insights strategy page button (D-10, D-15)

- The "Backfill this range" button at `insights/strategies/[id]/page.tsx:541-547` uses the same `gapToBackfillRequest` helper.
- Non-admins send GAPS_ONLY over the exact gap. Admins keep FULL (R-5). `useIsAdmin` is at `src/hooks/useLiveStrategies.ts:61`.
- The surface gets its own @AC.
- The create form on `insights/backfills/page.tsx` stays admin-only and unchanged (R-9).

### Consumer surfaces (C-14)

- **UI**: `/trader` symbol page, Analysis → Backtests card, and the `/insights` strategy page button.
- **Agent**: the `trigger_backfill` tool (`services/xstockstrat-agent/app/tools.py:1546`) now succeeds for non-admins inside the envelope. The product-spec Agent box is ticked at /sdd-spec.
- These change in the same PR as the ingest gate:
  - Agent wording at `app/tools.py:21`, `:1557` and `:1578-1580`.
  - `services/xstockstrat-agent/CLAUDE.md`.
  - `docs/runbooks/mcp-tools.md:964-968`.
  - The `strat-lab` `backtest` skill and `reference/backfill.md`.
  - The parity test at `tests/test_tools_endpoint.py:104`.

### Tests (D-6, D-25, D-27)

- One table-driven ingest test with a real `ingest_pb2.TriggerBackfillRequest` at scope "0":
  - Eight envelope rows, each asserting its token, no `insert_job` and no notify call.
  - An at-cap row and an admin row, both QUEUED.
  - A duplicate row and a race row, both between two self-serve requests only.
  - An insert-raises row with no emit and no spawn.
  - A row asserting the queued event carries `x-user-id` metadata.
- The MagicMock gate tests at `tests/test_ingest_servicer.py:362` and `:594` are rewritten with real requests.
- Token drift guard: one checked-in JSON fixture of the eight tokens and the detail format, loaded by both the ingest table test and the UI vitest. Its path is chosen at /sdd-spec under the C-13 fixture homes.
- e2e: fixtures from `e2e/fixtures/backtests.ts:69`, `:39` and `e2e/fixtures/backfillJobs.ts:18`, with:
  - a gap distinct from the window;
  - a new `getBackfillStatus` mock handler;
  - an INVENTORY row;
  - the copy update at `e2e/trader/position-detail.spec.ts:337`.

### Homelab rollout (D-22, D-23, D-24, D-26)

No lock-parameter raise is part of this feature (R-12). This feature edits nothing in homelab-edge.

**Lock bound**

- Capacity is cluster-wide: `max_locks_per_transaction × (max_connections + max_prepared_transactions)`. With the operator's values (1024, 70, 0) that is 71,680.
- The binding bound is `marketdata connections × replicas × L_stmt_max × databases`. Only marketdata queries `marketdata.ohlcv`, and its pool is capped at 2 connections (debate, D-23).
- L per statement is `(⌈span ÷ 30⌉ + 1) × 4`:

| Largest statement | L | Bound (2 conns × 2 databases) |
|---|---|---|
| Analysis bar fetch, 2,555 days | 348 | 1,392 |
| Admin coverage scan at L = 1,000 | 1,000 | 4,000 |

- PgBouncer `pool_size` (10 per database) is a backstop only.
- GAPS_ONLY gap planning scans the full requested span once per job, before the chunk writes.

**Runbook**: a new homelab subsection in `docs/runbooks/config-rollout.md`, staging environment only.

1. Over the homelab staging MCP, `get_config` for the three ingest backfill keys and the six analysis concurrency keys.
2. Read-only `SHOW max_locks_per_transaction`, `SHOW max_connections`, `SHOW max_prepared_transactions` on the live host. Expected: 1024, 70, 0. Confirm marketdata runs one replica with `DB_POOL_MAX` unset.
3. Compute the lock inequality from the values read. A failed inequality is the stop. Values that differ from the expected ones are reported as "PR #79 not applied" and do not stop the rollout while the inequality holds (operator, round 5).
4. `set_config ingest backfill.max_concurrent_jobs=8` and `set_config ingest backfill.self_serve_max_range_days=1830`, then read both back.
5. For one readiness cycle, watch feature 341's 53200 counter and marketdata's pool-wait metrics.

**Checklist lines in the same subsection**

- Re-run step 4 after a database rebuild.
- Apply the same two values per environment when a homelab production app is first deployed.
- Reverted symptom: the "limit of 730 days" denial on a 1000-bar warmup, and at most 3 jobs running.

### Dependencies and docs

- Feature 341 (`fix-indicator-pane-warmup`) owns the lock-budget breach counter. This feature adds none (R-8) and gets a `docs/roadmap/features/merge-order.md` row that waits for 341.
- Docs in the same PR: ingest key table (`services/xstockstrat-ingest/CLAUDE.md:120-126`) and gate wording (`:17-20`), the registered-keys log, the `platform.feature` `@AC-6 @feature-244` row, and the open finding at `services/xstockstrat-ingest/docs/context-constitution-findings.md:39`.
- Acceptance edits due at /sdd-spec:
  - Amend @AC-2.
  - Rewrite the @AC-9 examples.
  - New scenarios: insights strategy button, ALREADY_EXISTS, over-cap denial, "No vendor data", zero-denominator progress.
  - Strike @AC-8.

## Rejected Alternatives

- `R-1` Delete the `TriggerBackfill` admin gate outright — rejected because it opens multi-symbol, FULL, overwrite and callback fan-out jobs to all users, and ingest has no server-side symbol or range bound.
- `R-2` A coded numeric span or range cap in ingest — rejected because it breaches F-07; a numeric cap must be a WatchConfig key with the C-05 contract.
- `R-3` Automatic backtest re-run when the backfill completes — rejected because a binding operator decision forbids it.
- `R-4` On a de-dup hit, return the existing job's id so the card follows it — rejected because that job may cover a different range, which would falsely trigger the "No vendor data" state.
- `R-5` Send GAPS_ONLY for admins on the insights strategy button — rejected because admins would lose the ability to re-fetch a range where bars already exist.
- `R-6` The FR-7 scores-only fallback — rejected because the operator accepted tier T1 as an acceptable cost and risk.
- `R-7` Option A for the concurrency cap, a new seeded default on every deployment — rejected because the operator chose option B; DigitalOcean stays at 3.
- `R-8` A second lock-breach counter designed in this feature — rejected because the operator assigned the counter to feature 341.
- `R-9` Opening the create form on the insights Backfills page to non-admins — rejected because the operator confirmed it stays admin-only and unchanged.
- `R-10` A structured denial through `google.rpc.ErrorInfo` status details — rejected because it adds decoding plumbing for one UI consumer; string tokens with a pinned contract test are enough.
- `R-11` Gating the homelab raise to 8 on the stock `max_locks_per_transaction` value — rejected in round 4 because the per-class upper bound exceeded the stock budget. It stays rejected under D-22, where the stop is the computed inequality on live values.
- `R-12` Raising the homelab `max_locks_per_transaction` as a step of this feature — rejected because homelab-edge PR #79 already sets 1024 and the corrected bound fits without it.
- `R-13` Two independently pinned token literal sets as the drift guard — rejected because each test checks only its own side, so a rename on one side passes CI.
- `R-14` A PgBouncer `SHOW DATABASES` read in the runbook — rejected because no access route is named and `pool_size` is not the binding bound.
- `R-15` A hard stop on `max_locks_per_transaction` below 1024 — rejected because the computed inequality passes without it and the gate would wait on another repo's apply.

## Open Risks

- [ ] Homelab-edge PR #79 is merged but not applied; the live Postgres values are unread — to be addressed at runbook step 2.
- [ ] The 2-connection bound fails if marketdata gets `DB_POOL_MAX` or more replicas — runbook step 2 re-checks both.
- [ ] Admin GAPS_ONLY ranges are uncapped, so `L_stmt_max` is whatever admin range the operator accepts — runbook step 3.
- [ ] Pre-004 one-day ohlcv chunks would raise L for old ranges; the homelab is asserted to be a fresh deploy, not verified — runbook step 2.
- [ ] Eight jobs move contention onto marketdata's 2 connections and can slow interactive `GetBars` — runbook step 5.
- [ ] The marketdata pool metric names were not checked against the marketdata `CLAUDE.md` — /sdd-spec.
- [ ] Feature 341's 53200 counter lives on its branch; this feature's merge waits on it — merge-order row at /sdd-spec.
- [ ] A rebuilt homelab database reverts to 3 and 730 until the checklist is re-run — runbook checklist step.
- [ ] The shared token fixture is read across two service trees; its home and loading path are not chosen — /sdd-spec.
- [ ] Config migration number 050 may collide with a peer feature — /sdd-spec.
- [ ] Peer features 339 (same `page.tsx`), 341 and 344 (ingest) can conflict at merge — re-run the C-16 scan at /sdd-spec.
- [ ] One user can queue one in-envelope job per symbol and fill every slot — accepted by the operator; no step.
- [ ] An admin multi-symbol job blocks self-serve for its symbols for its whole duration — accepted (D-20); no step.
- [ ] Whether `bars_total` is set during a run is unverified; "Backfilling…" without a denominator is the fallback copy — UI card step.
- [ ] The `GetBackfillStatus` e2e mock does not exist yet — UI e2e step.
- [ ] `jobId`, "Data ready" and the last-filled gap are local state and are lost on reload — accepted under D-2; no step.
- [ ] The amended and new @AC scenarios exist only as design intent; `acceptance.feature` is unchanged — /sdd-spec.
- [ ] O-33 is still `open` in debate.md: no operator decision names the `343@AC-9` rewrite on its own. The round-5 approval covers the design that contains it — confirm at /sdd-spec before the scenario is edited.
- [ ] The access route for runbook step 2 is not fixed. The design names the DB-owner DSN (`docs/runbooks/operator-db-access.md`); a relayed operator note of 2026-11-15 says "I plan to do psql over ssh if possible", and the question it answers was not in this step's input — /sdd-spec runbook step.

## Constitution Rules Touched

- `C-05` — honored by: the new key is namespace-relative (`backfill.self_serve_max_range_days` under `ingest`), seeded by a config migration, with the full key contract.
- `C-08` — honored by: the ingest gate change is paired with the table-driven test.
- `C-10` — honored by: every trigger surface is decided (symbol card, insights strategy button, insights Backfills form, agent tool) and each changed one has a test.
- `C-11` — honored by: story, review and a full five-round design ran before any code; every operator answer is recorded.
- `C-12` — honored by: e2e mocks come from the canonical builders with an INVENTORY row.
- `C-13` — honored by: the shared token fixture lives in a canonical fixture home chosen at /sdd-spec.
- `C-14` — honored by: UI and Agent surfaces are named above and change in the same PR as the gate.
- `C-15` — honored by: every new behaviour gets an @AC scenario at /sdd-spec, traced to a test.
- `C-16` — honored by: the Business Rules list below; each CHANGE names its sign-off.
- `C-18` — honored by: one shared request helper, one token constant, no `ErrorInfo` plumbing, no codegen.
- `F-07` — honored: the span cap is a WatchConfig key, never a coded number (R-2).
- `P-02` — honored by: proposer and adversary exchanged only through the synthesized state.
- `P-03` — honored by: unverified items are listed under Open Risks, not guessed.
- `P-06` — honored by: the table test and the vitest cases are written red first at /sdd-execute.
- `PLAT-4` — honored by: ingest keeps forwarding `x-user-id`; the envelope requires it and a test asserts it on the queued event.
- `PLAT-N1` — honored by: the ledger emit stays best-effort and runs after commit.

No Floor breach was raised in any round.

## Business Rules Touched (C-16)

Feature-local scenarios are in `docs/roadmap/features/343-backtest-inline-backfill/acceptance.feature`.

- PRESERVE `343@AC-1` "The insufficient-data message offers a backfill action" — not regressed by: the action is added to the existing callout.
- CHANGE `343@AC-2` "The backfill covers exactly the missing range" — the range becomes `gap.start` through the backtest window end under GAPS_ONLY; signed off by user @ 2026-11-15 (design gate, context.md OPERATOR DECISIONS, D-8).
- EXTEND `343@AC-3` "Progress is shown inline while the backfill runs" — new case added: progress copy with a zero denominator.
- PRESERVE `343@AC-4` "A completed backfill offers a re-run and does not run it" — not regressed by: manual re-run only (operator decision, R-3).
- PRESERVE `343@AC-5` "Re-running after the backfill produces a result" — not regressed by: the re-run goes through the existing `handleRun`.
- EXTEND `343@AC-6` "A failed backfill reports its error and can be retried" — new case added: failure copy from chunk counts when `error` is empty.
- EXTEND `343@AC-7` "A non-admin user can run the inline backfill" — new cases added: the envelope denials, de-dup, and the insights strategy button (operator decisions, 2026-11-15).
- PRESERVE `343@AC-8` "Fallback — the section shows scores only" — no behaviour is built for it; FR-7 is not taken (operator decision, R-6) and the scenario is struck at /sdd-spec as the product spec directs.
- CHANGE `343@AC-9` "A partial or canceled backfill says so and can be retried" — example strings rewritten to server-true copy, one per PARTIAL branch (D-12); signed off by user @ 2026-11-15 as part of the round-5 design approval (context.md). No decision names this scenario on its own; see Open Risks (O-33).
- PRESERVE `270@AC-4` "A symbol-page backtest earns evidence and appears in the strategy's history" (`services/xstockstrat-ui/acceptance/fix-ui-trader-feedback.feature`) — not regressed by: the re-run sends `strategyId` and `strategyIdRef` through `handleRun`.
- EXTEND `244@AC-6` "A trap-dependent site keeps the coded default for a stored zero" (`docs/sdd/business-rules/platform.feature`) — new case added: a row for `backfill.self_serve_max_range_days`.
- PRESERVE `244@AC-5` "Ingest's backfill job concurrency keeps its zero clamp" (`services/xstockstrat-ingest/acceptance/fix-python-config-stored-zero.feature`) — not regressed by: option B leaves the default and the clamp unchanged (operator decision).
- EXTEND `198@AC-7` "Operator triggers a fundamentals backfill from the insights UI" (`services/xstockstrat-ui/acceptance/historical-fundamentals-backtest.feature`) — new case added: non-admins trigger a GAPS_ONLY bars backfill from the insights strategy button; admin behaviour is unchanged (operator decision, D-10).
- PRESERVE `198@AC-6` "Fundamentals backfill is a distinct data kind, not a timeframe" (`services/xstockstrat-ingest/acceptance/historical-fundamentals-backtest.feature`) — not regressed by: the envelope admits only UNSPECIFIED or BARS, and routing is untouched.
- PRESERVE `334@AC-1` "trigger_backfill without callback_url behaves as before" (`services/xstockstrat-ingest/acceptance/webhook-fanout-callback.feature`) — not regressed by: self-serve requests carry no `callback_url` and are QUEUED with no fan-out.
- PRESERVE `334@AC-26` "trigger_backfill with a callback_url fails closed when notify cannot validate it" (same file) — not regressed by: the admin path is unchanged, and a non-admin request with a `callback_url` is denied before validation.
