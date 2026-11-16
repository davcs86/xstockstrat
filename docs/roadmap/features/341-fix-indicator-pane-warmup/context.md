> Distilled 2026-11-15 by /sdd-distill. Full pre-distill session prose is in git history (before this commit).

# Context Log: fix-indicator-pane-warmup

Append-only below the header. Each session appends a new ## Session entry. Never delete or edit prior entries.

## Decisions

### Operator rulings (verbatim; all dated 2026-11-15; binding)

- **Root-cause gate** (sdd-review product-spec, recorded as "OPERATOR DECISIONS (binding, recorded
  2026-11-15)"): "Root cause is not traced; recon must determine whether the missing warm-up prefix is
  in the UI request or the analysis series builder before any fix is designed." The review accepted
  the untraced root cause (report confidence low) "for a bug spec by operator decision". Discharged:
  recon and round 2 found the root cause is the **UI request** — the page sends only the 200 drawn
  closes, so analysis has no warm-up prefix.
- **Round 3 (relayed):** "Expand the fetches. Add a metric to monitor lock budget breaches." — kept
  D = 1000 at that point and added the marketdata counter. A homelab-headroom remark made about a
  different feature was not applied here. Relayed answers Q2/Q3 seen at round 2 concerned other
  features and the batch flow and changed nothing here.
- **Round 4 (relayed):** "DO staging and production share a common managed DB. The staging homelab
  instance is associated with a homelab DB." "200 bars for DO is fine. I insist in 1000bars for
  homelab." "Use the mcp to read the values." — effects: history depth becomes per-deployment (200 on
  DigitalOcean, 1000 on the homelab); D-5, D-15 and R-9 reopened (the steer names only D-5; D-15's
  `HISTORY_BARS = 1000` half and R-9 rest on the same ruling). At round 4 it was "not certain, and
  none is assumed" which numbered item of the relayed request sanctions the config-key mechanism
  (O-23); the round-5 item 3 below settled it.
- **Round 5 (relayed):** "1. Approved", "2. Confirmed", "3. Sign-off the change, amend it", "4. There
  are no production instances. Staging is enough." — item 3 is the product-spec amendment sanction
  (see the kept amendment session); item 4 means only the homelab `staging` row is set and no
  homelab-production procedure is written (D-28, R-19). The log does not record which questions
  items 1 and 2 answered; the round-4 gate had pending: the D-15 / R-9 reopen confirmation and the
  feature 153 `@AC-1` sign-off.
- **Feature 153 `@AC-1` sign-off:** marketdata `fix-ohlcv-chunk-lock-oom @AC-1`
  (`services/xstockstrat-marketdata/acceptance/fix-ohlcv-chunk-lock-oom.feature:11-15`) is PRESERVE on
  DigitalOcean and PRESERVE-at-risk wherever the 1000-bar depth runs — operator sign-off 2026-11-15
  (the sdd-design session dates it to round 3; no verbatim quote is recorded beyond the amendment
  session's line).
- **Reopens (P-1..P-3, verdict "user reopened"):** D-5, D-15, R-9 — 200 bars stays on DigitalOcean,
  1000 on the homelab.
- **Design gate, round 5:** "Agreed" — in answer to: approve the 341 design, with the config key
  `ui.chart.indicator_history_bars` (default 200, range 200-1000) set to 1000 on the homelab only.
- **/sdd-spec and impl-spec review runs (relayed):** "I plan to do psql over ssh if possible." —
  recorded in Step 17's runbook preconditions. Narrowed by the later rulings below.
- **Execute directives (kept verbatim in the "operator directive for execute" session):** "Use MCP
  tools if possible in 341 and 343."; "max_locks_per_transaction assume what homelab-edge has" (1024,
  no live `SHOW`; Step 17's read-only `SHOW max_locks_per_transaction` precondition is dropped at
  execute); "max_connections are now love." (read by the orchestrator as "live": homelab-edge PR #79
  applied, `max_connections` = 70, PgBouncer pool 10 per database; not verified against the host).
  `max_prepared_transactions` keeps its specified read unless the operator extends the ruling.

### Settled design (register `debate.md` D-1..D-30, R-1..R-19, O-1..O-32, P-1..P-3; text `design.md`)

- **Approach (Option B).** Analysis declares each component's `first_value_bars` — one additive proto
  field `first_value_bars = 5` on `ComponentSeries`, filled by a new helper beside
  `builtin_lookback_bars`, computed directly (STOCH = period; first-value P, so EMA/MACD = 1,
  VWAP = 0), with a pytest drift pin. No compute change.
- **UI seam.** The page requests one newest-page `GetBars` of D bars and draws only the last
  `CHART_WINDOW_BARS = 200` (W). One pure `windowIndicatorSeries`, called from `IndicatorSection`,
  slices series, times and the insufficient set together and takes times, H and exhaustion from the
  one series response (not the page's `times` prop); the last bar's time joins the query key as a
  string — otherwise a stale cached series shifts one bar per new bar (O-1).
- **"Not enough history" pane.** `Eyebrow` + `EmptyState`, per component, only when there is no
  error, P > H and the bars page came back short.
- **D is a config key (D-18..D-21, D-29, D-30).** Global `ui`-namespace key
  `chart.indicator_history_bars` (int, default 200), seeded for staging and production by one config
  seed migration `NNN_ui_chart_history_bars` (050 as of round 5; number resolved at execute time),
  write-bounded to [200, 1000] (`maxValue: 1000`, not the proposal's 5000 — R-12). The UI reads it
  one-shot through `traderConfigClient.getConfig({ namespace: 'ui' })` and a pure `readHistoryBars`
  that falls back to 200 on absence, wrong type, error or timeout and clamps to
  [`CHART_WINDOW_BARS`, `MAX_HISTORY_BARS` = 1000]; short timeout, `staleTime: Infinity`, the clamped
  D is passed on (O-28). DigitalOcean stays at 200; only the homelab `staging` row is raised to 1000
  by `set_config`.
- **Why a key, not `HOST_PROVIDER`.** Branching on the existing `HOST_PROVIDER` env
  (`homelab ? 1000 : 200`) needs no migration, no config read and no manual `set_config`, and
  DigitalOcean could never be raised by accident. Not adopted: it turns an OTel resource attribute
  into behaviour and keeps a per-deployment value in source. Earlier alternatives for the O-12 lock
  problem — a smaller D (e.g. W + 300), server-guided escalation, a timeframe-aware slack in
  `defaultBarLookback` (its 3× slack is the real lock multiplier, O-22) — were dropped once D became
  per-deployment.
- **Marketdata counter (D-16, D-22).** One OTel counter `marketdata.ohlcv.out_of_memory_errors` for
  ohlcv SQLSTATE 53200 at the repository error seam, wrapping every returned error in the three reads
  (including `rows.Err()`) and `InsertBars` (O-19). 53200 is `out_of_memory`, hence the name (O-20).
  It detects a breach after the fact; it does not prevent one, and it also counts a 53200 from other
  causes.
- **Affected services** now: xstockstrat-ui, xstockstrat-analysis, xstockstrat-marketdata,
  xstockstrat-config (D-23). Product-spec amended accordingly (commit 60a38d20a; closes O-23).
- **What each deployment gets (D-20, operator-accepted residual).** On DigitalOcean at D = 200 a full
  page never shows "Not enough history", so SMA200 is still a single dot, with no notice. AC-2 and
  AC-4 hold on both deployments; AC-1 and AC-3 hold only where D ≥ W + P − 1, today the homelab at
  1000.
- **Lock budget of record (D-24, D-25; closes O-12, O-18).**
  - Why D = 1000 was not kept everywhere: at D = 1000 the implicit `GetBars` window widens from 600
    to 3000 calendar days on each page load and 300 s poll. One scan takes 8,050–11,680 locks against
    a DigitalOcean budget of 25,600; two scans in one environment pass narrowly (16,100–23,360); four
    scans (2 environments × marketdata pool 2 on the shared cluster) take 32,200–46,720 and fail. The
    staleness/DB-miss refetch also upserts about 2,000 rows in one transaction (about 8k locks). The
    2,010–2,920 chunk figure behind this was an estimate.
  - DigitalOcean at 200: unchanged from today — at most 2,400 locks per scan, 9,600 at 4 scans,
    against 25,600. If an admin set 1000 on DigitalOcean, 4 scans would need 32,200–46,720; the
    bound allows that edit and only the key description, the runbook and the counter guard it.
  - Homelab at 1000: `max_locks_per_transaction` 1024 and `max_connections` 70 (homelab-edge
    `roles/db_host/defaults/main.yml:12-13`), `max_prepared_transactions` stock 0 → budget
    1024 × (70 + 0) = 71,680 slots. On 30-day chunks a scan needs at most 404 locks, 28,280 at
    c = 70: passes. On stock mlpt 64 the budget would be 4,480. 1-day chunks (only after a restore
    from a DigitalOcean dump) fail and escalate to the operator. The "raise mlpt to 512" fallback is
    dropped.
- **Homelab launch (D-21, D-26..D-28).** Migration seeds 200 on the homelab too, where the defect was
  reported, so a deploy alone ships no fix. Runbook section "Homelab deep indicator history" in
  `docs/runbooks/ohlcv-lock-budget-tuning.md`: read-only preconditions (homelab-edge `verify` green —
  it asserts `max_locks_per_transaction` only; one `psql` read of `max_connections`,
  `max_prepared_transactions` and chunk width; `list_config_keys ui` shows the key), then
  `set_config` to 1000 through the homelab MCP with `create_key` false and an admin session, then
  `get_config`; reload the LYFT symbol page and confirm an SMA200 line; after several deep-history
  loads `marketdata.ohlcv.out_of_memory_errors{op="recent_bars"}` shows no increase, with `GetBars`
  spans as the positive control. A failed gate, or 1-day chunks, escalates to the operator. The
  operator directives above change which of these reads are live.
- **No connected MCP tool reads homelab DB settings (O-26).** The homelab MCP has config tools only;
  Grafana Cloud has no SQL datasource and no `pg_settings_*` metrics. The MCP did confirm the homelab
  `ui` namespace held only the two `performance.*` keys.
- **Business rules (C-16).** AC-1..AC-4 are EXTEND (AC-1 and AC-3 covered by the 200/1000 ruling;
  their preconditions name "the configured history depth of 1000 bars"). PRESERVE:
  `opportunity-live-market-enrichment @AC-4`, the `platform.feature` GetBars warm-set rule, and
  feature 153 `@AC-1` as above. No CHANGE lines.
- **Constitution rules touched (design):** P-02, P-03, P-04, C-01, C-03, C-05, C-07, C-08, C-12, C-13,
  C-15, C-16, C-17, C-18, F-06, F-07, PLAT-N1. Floor breaches: none in any round. Ledger: no line
  added (design, spec).

### Spec-time decisions (`implementation-spec.md`, 17 steps; deviate from or add to `design.md`)

- **Pin formula.** design.md's `first_value_bars + _CROSSOVER_LOOKBACK == builtin_lookback_bars` is
  off by one against its own values (SMA 200: 201 ≠ 200). The spec pins
  `(first_value_bars - 1) + _CROSSOVER_LOOKBACK == builtin_lookback_bars` (D-7's definition);
  re-checked at impl-spec review against `warmup.py:80-89` (SMA 200 → 200; RSI 14 → 15). It stays a
  deviation from the design.md text, shown to the operator at the Step 4 gate.
- **Config-read timeout.** design.md gives no number; the spec proposes
  `HISTORY_CONFIG_TIMEOUT_MS = 3_000`, to confirm at the Step 13 gate.
- **Seed columns.** The seed adds the `updated_by` sentinel (048 pattern; ledger 2026-11-10, 293) on
  top of the 023 shape design.md names, so the down never deletes an operator-set row.
- **Homelab launch is a post-deploy operator checkpoint, not a numbered step:** it needs the deployed
  seed, so it cannot pass a step Verification on the feature branch (F-05). Step 17 writes the runbook
  section; O-31 and O-32 are carried there.
- **Step map.** 1-2 proto + stubs · 3-4 analysis `first_value_bars` · 5-6 marketdata counter · 7-8
  config seed · 9-10 write bound · 11-12 UI helpers + vitest · 13-14 page data flow + e2e · 15-16 "Not
  enough history" pane + e2e · 17 docs. Atomic units: 1+2, 3+4, 5+6, 7+8, 11+12.
- **Config wiring (O-29, closed by the spec).** A seed needs `scripts/config-wiring-stored.json`
  regenerated on a scratch Postgres (`STALE-STORED` otherwise; never hand-written); the reader is
  registered by a `registry.receivers` entry (`indicatorChart.ts:values` → `ui`), never a `findings`
  entry for the read key; one temporary `seeded-unread` finding bridges Steps 7-11 (338 precedent).
  O-29 also asked for the UI `CLAUDE.md` note (in the spec's docs step, Step 17) and the AC-1/AC-3
  rewording (landed in `acceptance.feature`).

## Open Threads

The impl-spec review session kept verbatim below carries the `[ ] unaddressed` list `/sdd-execute`
announces at each checkpoint; it is repeated here with the threads from earlier sessions that are
still live.

- [ ] `merge-order.md` has no note for this feature: the soft rebase note for peer
  `342-chart-series-palette` (`IndicatorPanels.tsx`, `indicatorChart.ts`, the symbol `page.tsx`) and
  the config-seed `050` claim shared with `330-fix-live-enrich-ttl-seed` — before `/sdd-execute`.
- [ ] Step 7 needs a reachable Postgres 16 with `psql` and `migrate` to regenerate
  `scripts/config-wiring-stored.json`; blocked otherwise (P-03) — Step 7.
- [ ] Owner + config-team approval for the new key is outstanding (`docs/runbooks/approval-flow.md`);
  the product-spec was amended without re-review — merge blocker for the Step 7 unit.
- [ ] Re-derive the config migration number (trunk tip `049`; 330 holds
  `050_analysis_live_enrich_ttl_reseed` on its branch, O-30); a renumber regenerates the stored set;
  re-run the `(ui, chart.indicator_history_bars)` overlap scan after each main-dev merge — Step 7 and
  the integration PR.
- [ ] Step 7 alone must pass `node scripts/check-config-wiring.mjs --final` with the temporary
  `seeded-unread` finding — confirm from the command output at execute.
- [ ] Confirm `HISTORY_CONFIG_TIMEOUT_MS = 3_000` (spec author's number; a wrong value falls back to
  200, PLAT-N1) — Step 13 gate. Landed at 3 000 in Step 13 (sequential mode, no Phase-2 prompt);
  still awaits the operator's confirmation at the checkpoint.
- [ ] Steps 14 and 16 (e2e): in a batch worktree the linked `node_modules` resolves
  `@xstockstrat/proto` to the main checkout's stubs, which have no `firstValueBars`. Both the
  browser bundle and the mock backend then lack the field until the main checkout carries Steps 1+2.
  Plan a CI-equivalent run (`scripts/run-e2e.py` in Docker, or the main checkout updated).
  Step 14: its tests do not depend on the field (the `*Wire` bodies are encoded with whichever stubs
  resolve, so the main checkout's drop `firstValueBars`). They passed host-native with `--no-deps`.
  `scripts/run-e2e.py` cannot run from a batch worktree, because the repo has no `.dockerignore` and
  the build would copy the `node_modules` symlink. Step 16 needs the field: still open for it.
  Step 15 also hit it: its RED/GREEN came from an uncommitted vitest render probe, not the e2e.
  Step 16: resolved for the step run by a temporary `tsconfig.json` `paths` entry to this
  worktree's stubs (restored before commit; Deviation Log). CI resolves the branch stubs itself.
- [ ] Show the pin-formula deviation to the operator — Step 4 gate.
- [x] pgxmock row-error injection has no in-repo use; fallback is `WillReturnError` plus a Deviation
  Log entry — Step 6. Resolved: pgxmock v4.9.0 `CloseError` covers the `rows.Err()` path.
- [ ] The chunk-width SQL is new text, checked by the operator on first use; runbook launch-step-1
  preconditions (O-31) and the homelab-edge playbook path the runbook cites (O-32) — Step 17.
  Step 17: O-31 and O-32 are written into the runbook section; the chunk-width SQL is still
  unchecked until its first run (homelab launch checkpoint).
- [x] Step 12 touches four files and many cases (one unit with Step 11); split only with a Deviation
  Log entry — Step 12. Resolved: landed unsplit with Step 11 as one commit.
- [ ] Peer 342 has no implementation spec yet; re-run the overlap scan when it reaches
  `implementation-ready`.
- [ ] The product spec has no `## Config Key Changes` heading (the key sits under Fix Scope); not
  edited — no step.
- [ ] Homelab launch checkpoint after the first homelab staging deploy (runbook section from
  Step 17): `psql` read of `max_prepared_transactions` (0) and chunk width (30-day, unconfirmed until
  the chunk query runs), `set_config` 1000, LYFT SMA200 line, counter observation. The homelab keeps
  the single dot until it is done. Per the operator directives, `max_locks_per_transaction` (1024)
  and `max_connections` (70) are taken from homelab-edge, and MCP tools are used wherever one can do
  the read or write.
- [ ] Regenerating `scripts/config-wiring-stored.json` cannot go through an MCP tool (needs a scratch
  Postgres); stays as specified unless the operator rules otherwise — execute checkpoint.
- [ ] Other homelab Postgres workloads share the lock table, unmeasured; the config read adds a round
  trip, and analysis compute, polled payload and marketdata pool hold time grow with D on the
  homelab — launch step 3 observation.
- [ ] The 1000 bound does not stop an admin setting 1000 on DigitalOcean — key description (Step 7)
  and runbook (Step 17).
- [ ] DigitalOcean still shows SMA200 as a single dot on a full page (operator-accepted) — no step.
- [ ] AC-2 and AC-4 (EXTEND) were listed through round 5 as not covered by an operator decision and
  needing sign-off at the gate; the log records the design approval ("Agreed") but no sign-off naming
  them — raise at the first `/sdd-execute` checkpoint.
- [ ] Never recorded as checked in this log: whether the catalog holds a first-value P above 801;
  feature 125's context.md was not re-read; whether a blanket re-grep of the round 2–4 `path:line`
  citations was done by `/sdd-spec` (the design session assigned it; the spec session lists findings
  but no blanket confirmation). The read-only `timescaledb_information.chunks` count of
  `marketdata.ohlcv` chunks older than the 004 cutover, asked of the operator at round 3, was never
  supplied (moot while DigitalOcean stays at 200).

## Files Modified

- Steps 1+2: `packages/proto/analysis/v1/analysis.proto` and its eight generated
  `packages/proto/gen/{go,python,ts,ts/dist}/analysis/v1/` stubs.
- Steps 3+4: `services/xstockstrat-analysis/app/services/warmup.py`,
  `services/xstockstrat-analysis/app/handlers/servicer.py`,
  `services/xstockstrat-analysis/tests/test_warmup.py`,
  `services/xstockstrat-analysis/tests/test_analysis_servicer.py`.
- Steps 5+6: `services/xstockstrat-marketdata/internal/telemetry/otel.go`,
  `services/xstockstrat-marketdata/internal/repository/marketdata_repo.go`,
  `services/xstockstrat-marketdata/internal/repository/marketdata_repo_test.go`,
  `services/xstockstrat-marketdata/internal/service/telemetry_allowlist_test.go`.
- Steps 7+8: `services/xstockstrat-config/migrations/050_ui_chart_history_bars.{up,down}.sql`,
  `scripts/config-wiring.json`, `scripts/config-wiring-stored.json`,
  `services/xstockstrat-config/src/__tests__/uiChartHistoryBarsSeedMigration.test.ts`.
- Step 9: `services/xstockstrat-config/src/grpc/configServiceImpl.ts`.
- Step 10: `services/xstockstrat-config/src/__tests__/setConfigScalarBounds.test.ts`.
- Steps 11+12: `services/xstockstrat-ui/src/lib/indicatorChart.ts`, `scripts/config-wiring.json`,
  `services/xstockstrat-ui/src/lib/indicatorChart.test.ts`,
  `services/xstockstrat-ui/e2e/fixtures/indicatorHistory.ts`,
  `services/xstockstrat-ui/e2e/fixtures/configKeys.ts`, `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md`.
- Step 13: `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx`,
  `services/xstockstrat-ui/src/hooks/useIndicatorSeries.ts`, `services/xstockstrat-ui/src/lib/deadlines.ts`.
- Step 14: `services/xstockstrat-ui/e2e/trader/position-detail.spec.ts`,
  `services/xstockstrat-ui/e2e/fixtures/indicatorHistory.ts`, `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md`.
- Step 15: `services/xstockstrat-ui/src/components/trader/IndicatorPanels.tsx`,
  `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx`.
- Step 16: `services/xstockstrat-ui/e2e/trader/position-detail.spec.ts`.
- Step 17: `docs/runbooks/ohlcv-lock-budget-tuning.md`, `services/xstockstrat-ui/CLAUDE.md`,
  `services/xstockstrat-marketdata/CLAUDE.md`, `docs/patterns/config-governance.md`.

Feature-directory artifacts (`docs/roadmap/features/341-fix-indicator-pane-warmup/`):

- `feature.md`, `product-spec.md`, `acceptance.feature`, `context.md` — created by /sdd-triage.
- `product-spec.md` — FR-1 definition-of-P and coverage notes recorded at product-spec review; Fix
  Scope (Database, Config), Out of Scope and Affected Services amended under operator sanction
  (commit 60a38d20a).
- `feature.md` — Status History rows (incl. the amendment row).
- `recon.md`, `debate.md`, `design.md` — written by /sdd-design (5 rounds, full).
- `implementation-spec.md` — 17 steps by /sdd-spec; edited at impl-spec review (commit `ecb52c229`:
  Steps 2, 12, 14, 16 and Step Dependencies).
- `acceptance.feature` — AC-1 and AC-3 gained "And the configured history depth is 1000 bars"
  (design.md § 9; IDs unchanged) at /sdd-spec.
- `status.md` — `implementation-ready`.

---

## Superseded Sessions

### 2026-11-15 — /sdd-triage
- Defect report `docs/reports/2026-11-15-indicator-panel-sma200-single-point-defect.md` (operator report from homelab staging with screenshots; long-lookback indicator pane renders a single point). SEV-3, Track C; branch `feature/fix-indicator-pane-warmup`.
- Recommended design depth full: two candidate services (`xstockstrat-ui` consumer surface, `xstockstrat-analysis` series builder) and root cause under investigation.

### 2026-11-15 — sdd-review product-spec
- PASS WITH WARNINGS (0 fails, 4 warnings); draft → spec-ready. Warnings: which P applies (first value is 1 bar for EMA/MACD/VWAP per `services/xstockstrat-analysis/docs/warmup.md`, platform convergence is 3× period, custom formulas declare `warmup_period`; scenarios use SMA only); root cause untraced (operator decision in header); no multi-output / custom-formula / non-daily scenario; whether "Not enough history" is per indicator inside a combined pane.
- Overlap CLEAN. Peer 342-chart-series-palette shares `src/lib/indicatorChart.ts` / `src/components/trader/IndicatorPanels.tsx` (soft rebase row); if FR-1 lands in the analysis `GetIndicatorSeries` builder, `app/handlers/servicer.py` is shared with 308-fix-analysis-per-symbol-isolation and 330-fix-live-enrich-ttl-seed (disjoint ranges, rebase only); peers 339, 340, 343, 344 share the route family at most.

### 2026-11-15 — sdd-batch design gate (round 2)
- Halted at the gate (policy: halt); register D-1..D-13, R-1..R-8, O-1..O-17. Option B with fixed `HISTORY_BARS` (D) and W = 200; "No compute change, no migration, no config key" at this point.
- Blocking: O-12 (D = 1000 widens every implicit `GetBars` window 600 → 3000 calendar days and the Alpaca refetch/upsert; the ohlcv AC-1 chunk-lock inequality in `docs/runbooks/ohlcv-lock-budget-tuning.md` uncomputed; alternatives a smaller D e.g. W + 300 or server-guided escalation) and O-1 (stale-cache shift; how `historyExhausted` pairs with the same request). Non-blocking O-4, O-7, O-8, O-13, O-14, O-15..O-17.
- AC-1..AC-4 EXTEND, none operator-covered. Not verified: `path:line` citations; feature 125's context.md.

_(Superseded `sdd-batch-design-state` block for this round dropped by /sdd-distill under operator sanction, 2026-11-15; it is in git history before the distill commit.)_

### 2026-11-15 — sdd-batch design gate (round 3)
- Halted; register D-1..D-17, R-1..R-11, O-1..O-22. UI seam and analysis side agreed; operator ruling keeps D = 1000 and adds the 53200 counter, making marketdata an affected service. Closed: O-1, O-4, O-7, O-8, O-13, O-14, O-15, O-16, O-17.
- Blocking: O-12 (lock inequality fails at cross-environment saturation — numbers in header; the gate verdict had to read "exceeds the budget at saturation; accepted with the counter as monitor", only on operator confirmation) and O-18 (C-16: marketdata `@AC-1`, feature 153, at risk; recon never scanned the marketdata suite; the D = 1000 ruling did not name the rule). Asked of the operator: the chunk count older than the 004 cutover, and whether staging shares the DO cluster. Non-blocking O-19..O-22.
- Not verified: citations; catalog first-value P above 801; whether marketdata's pgx errors reach the repo unwrapped enough for `errors.As`; `mapBars` on a sliced array; feature 125's context.md.

_(Superseded `sdd-batch-design-state` block for this round dropped by /sdd-distill under operator sanction, 2026-11-15; it is in git history before the distill commit.)_

### 2026-11-15 — sdd-batch design gate (round 4)
- Halted; register D-1..D-24, R-1..R-15, O-1..O-29, P-1..P-3. D-1..D-4, D-6..D-14, D-16, D-17 stand; D-18..D-24 new: D moves to the seeded config key (migration `050_ui_chart_history_bars`), counter renamed `marketdata.ohlcv.out_of_memory_errors`; config joins Affected Services. Closed: O-12, O-18, O-19, O-20, O-21, O-22.
- Blocking: O-23 (P-04/P-03 — product-spec said "no new or changed config key" and "no migration"; amend + record sanction + approval note, or re-review). Reopen petitions P-1..P-3 (D-5, D-15, R-9) pending user. O-26 put to the operator (no MCP tool reads DB settings; accept `psql` or name the tool). The adversary asked that the operator see the `HOST_PROVIDER` trade-off (header). Non-blocking O-24, O-25, O-27, O-28, O-29.
- Not verified: citations; the homelab's `max_locks_per_transaction`, `max_connections`, `max_prepared_transactions` and chunk widths; whether the `scripts/config-wiring.json` checker accepts the new UI reader site.

_(Superseded `sdd-batch-design-state` block for this round dropped by /sdd-distill under operator sanction, 2026-11-15; it is in git history before the distill commit.)_

### 2026-11-15 — sdd-batch design gate (round 5)
- Halted; register D-1..D-30, R-1..R-19, O-1..O-32, P-1..P-3. Round 4 stands; D-25 (homelab inequality computed from homelab-edge values), D-26..D-28 (runbook section), D-29 (amendment text agreed), D-30 (migration number at execute time). Closed: O-24, O-25, O-26, O-27, O-28. The adversary found the proposal sound.
- Blocking: O-23 — sanctioned and text agreed but not yet written; design approval held until the product-spec, context.md and `feature.md` edits land (done in the kept amendment session). Non-blocking O-29 (config-wiring checker unread; `scripts/config-wiring-stored.json` row an assumption), O-30, O-31, O-32. P-1..P-3 still read "pending user" in `debate.md` at this point.
- Main risks: homelab pass rests on homelab-edge PR #79 being applied (merged, not applied then); 30-day chunk width unconfirmed; fix reaches the homelab only after manual `set_config`; DO keeps the single dot; most citations carried from round 4 not re-verified.

```sdd-batch-design-state
{
  "round": 5,
  "synth": {
    "approach": "Round 5 synthesis. The round-4 synthesis stands whole (sections 1-4 and 7-10: additive `first_value_bars = 5`, the analysis helper, the `windowIndicatorSeries` seam, the `EmptyState` pane, the breach counter, config key `chart.indicator_history_bars` default 200 bounded [200, 1000], `MAX_HISTORY_BARS = 1000`, short-timeout one-shot config read with fallback to 200). Three things change, plus adversary corrections the mediator adopts.\n\n**Mediator checks this round (read-only, in the trees).**\n- `/home/user/homelab-edge/roles/db_host/defaults/main.yml:12-13`: `max_connections: 70`, `max_locks_per_transaction: 1024`. `max_prepared_transactions` is not set there (stock 0).\n- `/home/user/homelab-edge/roles/db_host/tasks/verify.yml:20-30` reads live `current_setting('max_locks_per_transaction')` and fails on mismatch. It does not read `max_connections`.\n- `/home/user/homelab-edge/inventories/prod/group_vars/all/main.yml:156`: `db_pgbouncer_pool_size: 10` per database.\n- `/home/user/xstockstrat/docs/runbooks/ohlcv-lock-budget-tuning.md:17`, `:48`: the formula is `mlpt x (max_connections + max_prepared_transactions)`; `:27` readiness uses a fixed 400-day window.\n- Last config migration in the tree is `049_notify_commsgun_channel_keys`.\n- `/home/user/xstockstrat/scripts/config-wiring-stored.json` exists and `/home/user/xstockstrat/scripts/config-wiring.test.mjs:15` reads it; the exact entry shape is still unread (spec task).\n- `/home/user/xstockstrat/services/xstockstrat-agent/app/tools.py:1895-1902`: `set_config` refuses an unregistered key with NOT_FOUND unless `create_key=true`.\n- Other path:line citations are carried from the proposal and adversary, not re-verified.\n\n**1. Homelab lock inequality of record (computed, replaces D-21's \"SHOW then compute\").**\n- Budget = 1024 x (70 + 0) = 71,680 lock slots.\n- D = 1000 gives a 3000-day implicit window (`marketdata_service.go:467-477`). With 30-day chunks: at most 101 chunks x 4 relations = 404 locks per scan; the write term is the same 404.\n- At the worst-case concurrency c = max_connections = 70: 28,280 of 71,680. Passes, with at least 43,400 slots left. 404 is also below mlpt, so no scan borrows from the shared table.\n- The runbook states one failure path for chunk width, not a three-bound table: 1-day chunks appear only if the homelab DB was restored from a DigitalOcean dump (fresh deploy with migration 004 before first insert gives 30-day chunks, including for backfilled old data). 1-day chunks need 8,280-12,000 locks per scan, fail at c = 70, and escalate to the operator.\n- The \"raise mlpt to 512\" fallback is dropped. 1024 is the asserted value; if a live value differs, recompute with it, do not tune.\n\n**2. Runbook section \"Homelab deep indicator history\" in `docs/runbooks/ohlcv-lock-budget-tuning.md`.**\nValues of record cite the homelab-edge paths above, not \"the operator's reading of PR #79\".\nPreconditions (read-only; needed because homelab-edge PR #79 is merged but not yet applied):\n- homelab-edge `verify` green after PR #79 is applied (covers `max_locks_per_transaction` = 1024, `roles/db_host/tasks/verify.yml:20-30`).\n- One `psql` read per `docs/runbooks/operator-db-access.md`: `SHOW max_connections;`, `SHOW max_prepared_transactions;` and the existing chunk-width query. Expected 70 / 0 / 30-day chunks.\n- Migration 050 is applied on the homelab staging DB: `list_config_keys ui` shows `chart.indicator_history_bars`.\n- Any differing value: recompute. Any failure: escalate to the operator; do not silently ship 200.\nLaunch steps, in order:\n1. `set_config` namespace `ui`, key `chart.indicator_history_bars`, value 1000 through the homelab MCP, with `create_key` left false and an admin session (the write is global); then `get_config` to confirm. A NOT_FOUND means migration 050 is missing; do not create the key by hand.\n2. Smoke test: reload the LYFT symbol page (the config read is `staleTime: Infinity`, so an open tab keeps 200) and confirm an SMA200 line draws.\n3. Observation, not a pass/fail load test: load LYFT plus a few deep-history symbol pages at D = 1000, ideally in parallel tabs. Then check `increase(marketdata.ohlcv.out_of_memory_errors{op=\"recent_bars\"})` over that window is zero or the series is absent (the counter is lazily bound). Positive control: marketdata `GetBars` spans or `marketdata.db.pool.empty_acquire_wait` show the reads happened. A readiness cycle is not the check, because readiness uses the fixed 400-day window and never runs the 3000-day scan.\nOne line on scope: only the homelab `staging` row is set. The homelab-production prose is dropped (operator: \"There are no production instances. Staging is enough.\"). Migration 050 still seeds both environment rows at 200, matching `migrations/023_ui_performance_keys.up.sql:17-32`.\n\n**3. Product-spec amendment (operator sanction, verbatim: \"Sign-off the change, amend it\").**\n- Fix Scope, Config: \"exactly one new key, `ui.chart.indicator_history_bars` (int, default 200, bounds [200, 1000])\".\n- Fix Scope, Database: \"exactly one config seed migration in `services/xstockstrat-config/migrations/` (`NNN_ui_chart_history_bars`, 050 as of this round); no service-schema migration\".\n- Out of Scope: \"any database migration or config key beyond the one key and its seed migration in Fix Scope\".\n- Affected Services gain xstockstrat-marketdata and xstockstrat-config.\n- `context.md` records: the verbatim sanction and date; the operator reopen of D-5, D-15 and R-9 (P-1..P-3 verdict \"user reopened\"); the feature 153 `@AC-1` PRESERVE-at-risk sign-off; the approval-flow note that a new config key needs owner + config team (`docs/runbooks/approval-flow.md`).\n- `feature.md` gains a `## Status History` row for the amendment (P-04 phase-gate event). Re-review only if the operator asks.\n\n**4. Spec-level corrections adopted.**\n- Migration number: the spec step re-checks the last config migration at execute time and renumbers if a peer feature in this batch took 050; the number is not fixed in the spec.\n- Config wiring: the spec reads `scripts/config-wiring.test.mjs` and adds the reader entry to `scripts/config-wiring.json` and, if the checker requires it, the seeded row to `scripts/config-wiring-stored.json`.\n- UI `CLAUDE.md` notes `traderBff.ts:166-170` as a `ui`-namespace forward and that `/trader` now reads `ui`. `acceptance.feature` AC-1 and AC-3 preconditions read \"with the configured history depth of 1000 bars\".\n- The gate statement: the homelab DB values now come from the homelab-edge repo; `psql` is used only for the single live read above; the MCP is used for `set_config`, `get_config` and `list_config_keys`.\n\n**Build order** is unchanged from round 4 (proto, analysis, marketdata counter, config migration and bounds, UI reader and seam, pane, e2e, runbook and docs, homelab launch).\n\n**Touchpoints.** One additive proto field; one config seed migration; one new config key; one new marketdata counter.",
    "open_objections": [
      {
        "text": "O-23 (P-04/P-03): the operator sanctioned the amendment ('Sign-off the change, amend it') and the amendment text is agreed. It closes when the orchestrator writes it: the product-spec Fix Scope and Out of Scope edits, the `context.md` entry with the verbatim sanction and the approval-flow note (owner + config team), and a `feature.md` Status History row. Until those are written, design approval is held.",
        "blocking": true
      },
      {
        "text": "O-29 (spec task): the proposer has still not read `scripts/config-wiring.test.mjs`. `scripts/config-wiring-stored.json` exists and the checker reads it, but whether the seeded key needs a row there, and its shape, is unconfirmed. The spec must read the checker before writing either entry; it must also carry the UI `CLAUDE.md` note and the AC-1/AC-3 rewording.",
        "blocking": false
      },
      {
        "text": "Migration number: 050 is free in the tree today, but three peer features in this batch could add a config seed and golang-migrate fails on a duplicate version. The spec step must re-check the last config migration at execute time and renumber, and the product-spec amendment should name the migration by slug with 050 as the current number.",
        "blocking": false
      },
      {
        "text": "Launch step 1 preconditions must be in the runbook: migration 050 applied on the homelab staging DB (`list_config_keys ui` shows the key), `create_key` stays false, the write needs an admin session, and the smoke test reloads the page because the config read is `staleTime: Infinity`. Adopted in the synthesis; the proposer has not confirmed.",
        "blocking": false
      },
      {
        "text": "homelab-edge `verify` asserts `max_locks_per_transaction` only. `max_connections` = 70 and `max_prepared_transactions` = 0 are set or defaulted in source but not asserted live, so the one `psql` read stays in the runbook. The runbook now cites a second repo's playbook; it must name the path so the coupling is visible.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "AC-1",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "AC-2",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-3",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "AC-4",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "opportunity-live-market-enrichment @AC-4",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "platform.feature GetBars warm-set rule",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "marketdata fix-ohlcv-chunk-lock-oom @AC-1 (feature 153) — PRESERVE on DigitalOcean at 200; PRESERVE-at-risk wherever 1000 runs (operator signed off 2026-11-15)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": true
      }
    ],
    "rejected_alternatives": [
      "R-1 to R-8 and R-10 to R-15 stand unchanged. R-9 is operator-reopened: the default is 200 and 1000 is the ceiling.",
      "Branching on `HOST_PROVIDER` (`homelab ? 1000 : 200`), the proposer's runner-up. It needs no migration and no manual `set_config`, but it puts a per-deployment value in source against config governance, the same reasoning that locked R-13. The adversary agreed; it is now rejected, not held for the gate.",
      "A readiness cycle as the launch check for the breach counter. Readiness uses the fixed 400-day window and never runs the 3000-day scan, and an absent lazily-bound series cannot be told from a flat one.",
      "A three-`SHOW` `psql` discovery step as the homelab gate. The values are set in homelab-edge source and `verify` already asserts `max_locks_per_transaction` live; one `psql` read covers the rest.",
      "The 'raise `max_locks_per_transaction` to 512' fallback. 1024 is already the asserted homelab value; a lower live value means recompute and escalate, not tune.",
      "Runbook prose for a later homelab production deployment. The operator stated there are no production instances and staging is enough.",
      "A three-bound concurrency table (c = 4, 20, 70) for 1-day chunks in the runbook. The gate certifies only at c = max_connections, and 1-day chunks escalate whatever the bound.",
      "A fixed migration number 050 in the spec. Peer features in this batch may take it; the number is resolved at execute time."
    ],
    "open_risks": [
      "The homelab pass rests on homelab-edge PR #79 being applied. It is merged but not applied; on stock mlpt 64 with 70 connections the budget is 4,480 and 30-day chunks pass only at c of 11 or fewer.",
      "The 30-day chunk width on the homelab rests on the fresh-deploy statement until the chunk query runs. A DB restored from a DigitalOcean dump would have 1-day chunks and block the raise.",
      "The fix reaches the homelab only after a manual `set_config`. If the launch steps are skipped, the homelab keeps the single dot.",
      "DigitalOcean users still see SMA200 as a single dot on a full 200-bar page, with no notice (operator-accepted).",
      "The bound of 1000 cannot tell deployments apart. An admin could set 1000 on DigitalOcean; only the key description, the runbook and the counter guard against it.",
      "Other workloads on the homelab Postgres share the lock table. They are bounded by max_connections but their per-backend lock use was not measured.",
      "`max_connections` and `max_prepared_transactions` are not asserted by homelab-edge `verify`; only the runbook's `psql` read observes them.",
      "The runbook depends on a playbook in a second repo (homelab-edge `verify`); a rename there silently breaks the precondition.",
      "A 53200 from a cause other than lock-table exhaustion also increments the counter. The counter detects a breach; it does not prevent one.",
      "The config-wiring checker's requirements for the new reader and the seeded row are unread.",
      "The migration number may collide with a peer feature in this batch.",
      "The product-spec is amended after approval without re-review; the operator sanctioned this, but the config-team approval for the new key is still to be obtained.",
      "The config read adds a round trip before the first bars request; analysis compute and polled payload grow with D on the homelab.",
      "Most path:line citations in sections carried from round 4 were not re-verified by the mediator."
    ],
    "constitution_rules_touched": [
      "P-02",
      "P-03",
      "P-04",
      "C-01",
      "C-03",
      "C-05",
      "C-07",
      "C-08",
      "C-12",
      "C-13",
      "C-15",
      "C-16",
      "C-17",
      "C-18",
      "F-06",
      "F-07",
      "PLAT-N1"
    ],
    "rationale": "**Verdict.** The adversary found the proposal SOUND with no Floor breach and no register violation. I checked the homelab values in the homelab-edge tree and the arithmetic holds: 1024 x 70 = 71,680 slots against 28,280 at the worst-case bound.\n\n**Register.**\n- The approach rests on D-1 to D-4, D-6 to D-14, D-16 to D-20 and D-22 to D-24.\n- D-21 is refined, not contradicted: the gate is still a runbook step before `set_config`, but the inequality is now computed from operator-supplied values and the live read is a precondition. The operator steer directs this.\n- D-5, D-15 and R-9 are reopened by the operator steer by name. The register already marks them \"reopened @ round 4 (operator steer)\", and the relayed request (\"Approved\", \"Confirmed\") is consistent. P-1 to P-3 resolve as \"user reopened\" when the orchestrator writes `context.md`. No new petition from either side.\n- The `HOST_PROVIDER` runner-up is close to the locked R-13 and loses on the same reasoning, so it is recorded as rejected.\n\n**Closed this round.**\n- O-24: the proposer confirmed 1000.\n- O-25: the three ordered steps and the escalation rule are carried, with step 3 corrected to exercise the symbol-page path.\n- O-26: the values come from the homelab-edge repo; `psql` is one live read.\n- O-27: reduced to one line, per the operator's \"no production instances\".\n- O-28: the proposer confirmed.\n\n**Still open.**\n- O-23 stays blocking until the amendment and its record are written. The sanction itself is given: item 3 of the relayed request is the operator's own words.\n- O-29 stays open, non-blocking: the checker is unread, so the stored-JSON entry is still an assumption.\n\n**Corrections to the proposal.**\n- Launch step 3 checked a path D does not touch. It is now an observation after symbol-page loads, with a positive control.\n- The precondition reuses homelab-edge `verify` for mlpt. I found `verify` does not assert `max_connections`, so the `psql` read keeps it.\n- Step 1 states that migration 050 must be applied and `create_key` stays false.\n- The homelab-production prose and the 512 fallback are dropped.\n- The migration number is resolved at execute time.\n\n**Operator decisions honoured.** Root cause located first (D-1); breach metric added; 200 by default and 1000 on the homelab; feature 153 `@AC-1` PRESERVE-at-risk where 1000 runs; one new key and its seed migration sanctioned.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "Homelab lock budget of record, refining D-21 and D-24: 1024 x (70 + 0) = 71,680 slots. At D = 1000 on 30-day chunks a scan needs at most 404 locks, 28,280 at c = max_connections = 70. The gate certifies only at c = max_connections. 1-day chunks (possible only after a restore from a DigitalOcean dump) fail and escalate to the operator. The 'raise mlpt to 512' fallback is dropped; a differing live value means recompute, not tune.",
          "evidence": "Operator steer for round 5; `/home/user/homelab-edge/roles/db_host/defaults/main.yml:12-13`; `/home/user/homelab-edge/inventories/prod/group_vars/all/main.yml:156`; `docs/runbooks/ohlcv-lock-budget-tuning.md:17`, `:48`; `marketdata_service.go:467-477`. The adversary checked the numbers and concurred."
        },
        {
          "text": "The runbook gate is a read-only precondition, not a discovery step: homelab-edge `verify` green after PR #79 is applied (covers `max_locks_per_transaction`), one `psql` read of `max_connections`, `max_prepared_transactions` and chunk width, and `list_config_keys ui` showing the key (migration applied). The runbook cites the homelab-edge paths as the values of record.",
          "evidence": "Operator steer for round 5 (keep a read-only verification, PR merged but not applied); `/home/user/homelab-edge/roles/db_host/tasks/verify.yml:20-30` asserts mlpt only (mediator check); `docs/runbooks/operator-db-access.md`. Adversary proposal, adopted."
        },
        {
          "text": "Homelab launch steps, in order: (1) `set_config ui chart.indicator_history_bars 1000` through the homelab MCP with `create_key` false and an admin session, then `get_config`; (2) reload the LYFT symbol page and confirm an SMA200 line; (3) an observation after several deep-history symbol-page loads that `marketdata.ohlcv.out_of_memory_errors{op=\"recent_bars\"}` shows zero increase or is absent, with `GetBars` spans or `marketdata.db.pool.empty_acquire_wait` as the positive control. Step 3 is not a pass/fail load test and not a readiness cycle.",
          "evidence": "`services/xstockstrat-agent/app/tools.py:1895-1902` (NOT_FOUND on an unregistered key); `ohlcv-lock-budget-tuning.md:26-27`, `:43-44`; D-16 (lazy binding); `deploy/homelab/compose.yml:7`. Adversary objection, adopted."
        },
        {
          "text": "Only the homelab `staging` row is set to 1000, stated in one runbook line. No homelab-production procedure is written. The seed migration still seeds both environment rows at 200.",
          "evidence": "Operator, relayed request 2026-11-15: 'There are no production instances. Staging is enough.'; `migrations/023_ui_performance_keys.up.sql:17-32`."
        },
        {
          "text": "The product-spec is amended under the operator sanction: Fix Scope allows exactly one new key `ui.chart.indicator_history_bars` (int, default 200, bounds [200, 1000]) and exactly one config seed migration `NNN_ui_chart_history_bars`; Out of Scope excludes any other migration or key. `context.md` records the verbatim sanction, the reopens, the feature 153 sign-off and the owner + config team approval note; `feature.md` gains a Status History row. No re-review unless the operator asks.",
          "evidence": "Operator, design gate round 4 and relayed request 2026-11-15, verbatim: 'Sign-off the change, amend it'; `docs/runbooks/approval-flow.md`. The adversary judged the text correct and in scope."
        },
        {
          "text": "The config seed migration number is resolved at execute time: the spec step re-checks the last config migration and renumbers if 050 is taken. 050 is the number as of round 5.",
          "evidence": "Last migration in the tree is `049_notify_commsgun_channel_keys` (mediator check); three peer features in this batch may add config seeds; golang-migrate fails on a duplicate version."
        }
      ],
      "new_rejected": [
        {
          "text": "Branching on the `HOST_PROVIDER` env (`homelab ? 1000 : 200`) to carry D.",
          "why": "It puts a per-deployment value in source against root config governance and turns an OTel resource attribute into behaviour; same reasoning as the locked R-13. Both sides agreed."
        },
        {
          "text": "A readiness cycle as the launch check for the breach counter.",
          "why": "Readiness uses the fixed 400-day window, so it never runs the 3000-day scan D changes, and an absent lazily-bound series cannot be told from a flat one."
        },
        {
          "text": "A 'raise `max_locks_per_transaction` to 512' fallback in the homelab gate.",
          "why": "1024 is already the value asserted by homelab-edge; a lower live value means the host is not in the expected state, so recompute and escalate."
        },
        {
          "text": "A runbook procedure for a later homelab production deployment.",
          "why": "The operator stated there are no production instances and staging is enough (YAGNI, C-18)."
        }
      ],
      "new_objections": [
        {
          "text": "The spec must resolve the config seed migration number at execute time and renumber if a peer feature took 050; the product-spec amendment names the migration by slug.",
          "blocking": false
        },
        {
          "text": "The runbook must state launch step 1's preconditions: migration applied (`list_config_keys ui`), `create_key` false, admin session, and a page reload before the smoke test. Adopted in the synthesis; the proposer has not confirmed.",
          "blocking": false
        },
        {
          "text": "homelab-edge `verify` asserts only `max_locks_per_transaction`; the runbook keeps one `psql` read for `max_connections` and `max_prepared_transactions` and must cite the homelab-edge playbook path it depends on.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-24",
          "how": "The proposer confirmed `maxValue: 1000` and one exported `MAX_HISTORY_BARS = 1000`."
        },
        {
          "id": "O-25",
          "how": "The runbook carries the precondition and three ordered launch steps with escalation on a failed gate; step 3 is corrected to observe the symbol-page path with a positive control."
        },
        {
          "id": "O-26",
          "how": "The operator supplied the values from the homelab-edge repo; homelab-edge `verify` covers mlpt and `psql` is one read-only check, stated at the gate. The MCP is used for the config calls."
        },
        {
          "id": "O-27",
          "how": "Reduced to one runbook line that only the homelab `staging` row is set; the production prose is dropped per the operator ('There are no production instances. Staging is enough.')."
        },
        {
          "id": "O-28",
          "how": "The proposer confirmed the short timeout, `staleTime: Infinity`, fallback to 200 on timeout or error, and the clamped D passed as `requestedBars`."
        }
      ],
      "reopen_petitions": [],
      "reopened": [
        "D-5",
        "D-15",
        "R-9"
      ]
    }
  },
  "floor_breaches": []
}
```

### 2026-11-15 — sdd-design (approved)
- Recon wrote recon.md (ui, analysis; marketdata and config joined during the debate); reuse: `toLineData` gap rendering unchanged, newest-page `GetBars` read with only `pageSize` changed. 5 rounds (full); rejected R-1..R-8 and R-10..R-19 (design.md), R-9 operator-reopened. Operator approval "Agreed" (header). spec-ready → design-approved.
- Register close-out in `debate.md`: State approved; O-23 closed (amendment commit 60a38d20a); P-1..P-3 "user reopened"; O-29..O-32 left open, non-blocking, for `/sdd-spec`. Feature 153 `@AC-1` sign-off dated round 3. No CHANGE lines; no Floor breach; no Ledger line.
- Its 14 open threads are carried in the header Open Threads (PR #79 applied — since answered by the operator directive; chunk width; manual `set_config`; DO single dot; DO-admin 1000; shared lock table; `psql` read / `verify` path O-32; counter limits; O-29, O-30, O-31; key approval; perf growth with D; citation re-grep).

### 2026-11-15 — sdd-spec
- implementation-spec.md with 17 steps; design-approved → implementation-ready; tree `origin/feature/fix-indicator-pane-warmup@ae6541d7e`. Decisions (pin formula, 3 s timeout, `updated_by` seed column, launch as post-deploy checkpoint), step map and config-wiring rule are in the header. Relayed operator input: "I plan to do psql over ssh if possible."
- Findings where the tree differs from design.md or adds to it: `ComponentSeries` is `analysis.proto:819-827`, next free field 5, request comment to rewrite `:805-807`, no descriptor-parity guard covers it; `traderConfigClient` lives at `ui/src/lib/browserClients/traderConfigClient.ts:8` (not `src/lib/traderConfigClient.ts` as design.md cites), BFF forward `traderBff.ts:165-170`; last config migration `049`, 330 holds `050` on its branch.
- More findings: `QueryRecentBars` is the only bar path on the mockable `r.db` (the other three use `r.pool`), so `observeLockBreach` is also tested directly, and the metric allow-list test `marketdata/internal/service/telemetry_allowlist_test.go` gains the counter; `globalIntSeedCases` cannot test this seed (it pins the column list without `updated_by`); `docs/runbooks/operator-db-access.md` has no homelab section — the SSH-then-`psql` path is in `homelab-edge` `docs/runbooks/db-host.md`; O-29 was resolved by reading `scripts/check-config-wiring.mjs` and the 338 precedent.

---

## Session 2026-11-15 — product-spec amendment (orchestrator, closes O-23)

- **Operator sanction, verbatim (2026-11-15):** "Sign-off the change, amend it" — in answer to: the
  per-deployment history depth needs one new config key and a seed migration, while the product
  spec said "no new or changed config key" and "no migration".
- **Amended in `product-spec.md`:** Fix Scope (Database, Config), Out of Scope, Affected Services
  (adds xstockstrat-marketdata and xstockstrat-config). `feature.md` Status History has the row.
- **Operator reopens (P-1..P-3, verdict "user reopened"):** D-5, D-15, R-9 — 200 bars stays on
  DigitalOcean, 1000 on the homelab.
- **Operator sign-off:** marketdata feature 153 `@AC-1` is PRESERVE-at-risk where the 1000-bar
  depth runs.
- **Approval flow:** a new config key needs owner + config team (`docs/runbooks/approval-flow.md`).

---

## Session 2026-11-15 — sdd-review impl-spec (advisory)

- Result: PASS WITH WARNINGS — 0 failures, 9 warnings, 0 floor breaches (advisory — did not block).
  Lifecycle unchanged (`implementation-ready`). Overlap: WARN, no FAIL-level collision.
- Tree: `origin/feature/fix-indicator-pane-warmup@9aa3a02d0` (detached). `implementation-spec.md`
  was edited in this session (commit `ecb52c229`); every edit was re-checked against the tree.
- Operator input relayed this run (2026-11-15), relevant item: "I plan to do psql over ssh if
  possible." — already in Step 17's runbook preconditions; nothing new to apply.

### Addressed in implementation-spec.md

- [x] Steps 12, 14, 16 — coverage threshold not stated. Step 12 Verification now runs
  `pnpm run test:coverage` (`ui/package.json:19`; the command CI runs, `ci.yml:796`) and names the
  gate: `src/lib/**` lines, functions and statements ≥ 40% (`ui/vitest.config.ts:25-34`). Steps 14
  and 16 state that Playwright has no threshold and point at Step 12's gate.
- [x] Step 2 — **Files** listed directories. It now lists the eight tracked stubs that carry
  `ComponentSeries` (`git grep -l ComponentSeries -- packages/proto/gen`: one Go, one Python, two TS
  sources, four `gen/ts/dist` files). A different generator output is committed as generated and
  logged in the Deviation Log.
- [x] Config key wiring (C-05) — no test fed the seeded value through the real reader. Step 12 gains
  instruction 7: read the seed migration from disk (number-free suffix lookup; `node:fs` precedent
  `ui/src/lib/dbTlsPlatformGuard.test.ts:4`), take `value_type` / `value_data` from the file text,
  and assert `readHistoryBars` returns the seeded number and that it equals `DEFAULT_HISTORY_BARS`
  (F-07). Step 12's file list is unchanged.
- [x] `050` collision with feature 330 — the overlap pass could not read 330's branch. Re-checked here:
  `git ls-tree origin/feature/fix-live-enrich-ttl-seed` shows `050_analysis_live_enrich_ttl_reseed`
  (`.up.sql` and `.down.sql`). The collision is real; Step Dependencies now says so. Trunk tip is
  still `049`. The Step 7 re-derive instruction stands.
- [x] Peer 342 overlap — Step Dependencies now also names
  `ui/src/app/trader/positions/[symbol]/page.tsx` (342's product spec puts the symbol page in scope)
  and no longer says this review adds the `merge-order.md` row (see Open Threads).
- [x] Assumption 1 (pin formula) — arithmetic re-checked against `warmup.py:80-89`: SMA 200 →
  (200 − 1) + 1 = 200; RSI 14 → (15 − 1) + 1 = 15. The reviewer raised no finding. It stays a
  deviation from the `design.md` text, shown to the operator at the Step 4 gate.

### Open Threads

Carried into execution. `/sdd-execute` announces every `[ ] unaddressed` item at each checkpoint.

- [ ] unaddressed — **`merge-order.md` has no note for this feature.** Two are needed before
  `/sdd-execute`: the soft rebase note for peer `342-chart-series-palette` (`IndicatorPanels.tsx`,
  `indicatorChart.ts`, the symbol `page.tsx`) and the config-seed `050` claim shared with
  `330-fix-live-enrich-ttl-seed`. This session's writes were limited to the feature directory, so
  the file was not edited.
- [ ] unaddressed — Step 7: needs a reachable Postgres 16 with `psql` and `migrate` to regenerate
  `scripts/config-wiring-stored.json`; blocked otherwise (P-03). Never hand-written.
- [ ] unaddressed — Step 7: owner + config-team approval for the new key is still outstanding
  (`docs/runbooks/approval-flow.md`). Merge blocker for the Step 7 unit.
- [ ] unaddressed — Step 7: re-derive the migration number (330 holds `050` on its branch); a
  renumber regenerates `scripts/config-wiring-stored.json`.
- [ ] unaddressed — Step 7 alone must pass `node scripts/check-config-wiring.mjs --final` with the
  temporary `seeded-unread` finding (the reader lands in Step 11, a different consumer surface;
  338 precedent). Confirm from the command output at execute.
- [ ] unaddressed — Assumption 2: `HISTORY_CONFIG_TIMEOUT_MS = 3_000` is the spec author's number.
  Confirm at the Step 13 gate. A wrong value falls back to 200 (PLAT-N1), so the risk is low.
- [ ] unaddressed — Step 6: pgxmock row-error injection has no in-repo use; the fallback is
  `WillReturnError` plus a Deviation Log entry.
- [ ] unaddressed — Step 17: the chunk-width SQL is new text, checked by the operator on first use.
- [ ] unaddressed — Step 12 touches four files and many cases (one unit with Step 11). Watch the
  size at execute; split only with a Deviation Log entry.
- [ ] unaddressed — Peer 342 has no implementation spec yet, so its file list is unconfirmed.
  Re-run the overlap scan when 342 reaches `implementation-ready`.
- [ ] unaddressed — The product spec has no `## Config Key Changes` heading (the key sits under Fix
  Scope). Not edited here; the wiring test above covers the C-05 intent.

---

## Session 2026-11-15 — operator directive for execute (orchestrator)

- **Operator, verbatim (2026-11-15): "Use MCP tools if possible in 341 and 343."** Given after the
  orchestrator reported that one step regenerates `scripts/config-wiring-stored.json` against a
  reachable Postgres and that the rollout reads Postgres parameters.
- **Binding for `/sdd-execute` and the rollout runbook:** every live read or write that an MCP tool
  can do goes through the MCP (`get_config`, `set_config`, `list_config_keys`, `get_backfill_status`,
  `trigger_backfill` on `xstockstrat_homelab_staging` / `xstockstrat_staging`), not `psql`.
- **What no connected MCP tool can do (orchestrator finding, not operator words):** (a) read
  Postgres server parameters (`SHOW max_locks_per_transaction` etc.) — the agent MCP has no SQL
  tool; the homelab values are in `homelab-edge` `roles/db_host/defaults/main.yml` and its `verify`
  task asserts the lock setting; (b) regenerate `scripts/config-wiring-stored.json`, which needs a
  scratch Postgres with the migration set applied, not a live database. Those two stay as specified
  unless the operator rules otherwise at the execute checkpoint.

- **Operator, verbatim (2026-11-15): "max_locks_per_transaction assume what homelab-edge has".**
  Supersedes item (a) above for that parameter: the rollout takes `max_locks_per_transaction` = 1024
  from `homelab-edge` `roles/db_host/defaults/main.yml` (asserted by its `verify` task) and does
  not read it live with `psql`. Step 17's read-only `SHOW max_locks_per_transaction` precondition
  is dropped at execute; the lock inequality is computed with 1024.
- **Orchestrator assumption (not operator words):** the ruling names only
  `max_locks_per_transaction`. `max_connections` (70 after homelab-edge PR #79 is applied to the
  host, 60 before) and `max_prepared_transactions` keep their specified read unless the operator
  extends the ruling.
- **Operator, verbatim (2026-11-15): "max_connections are now love."** Orchestrator reading (the
  operator's word is taken as a typo for "live"): homelab-edge PR #79 is applied to the DB host, so
  `max_connections` = 70 and the PgBouncer pool = 10 per database are the running values. The
  rollout takes `max_connections` = 70 from `homelab-edge` as well; the "PR merged but not yet
  applied" precondition is dropped. Not verified by the orchestrator against the live host.

---

## Session 2026-11-15 — /sdd-distill
- Distilled 11 sessions → header + Superseded Sessions (8 compressed); kept 2 verbatim, plus 1 marked keep-verbatim (product-spec amendment, an operator ruling).
- context.md 1410 → 601 lines. Original prose preserved in git history.
- **Operator sanction (2026-11-15), deviation from the skill's preserve-every-`sdd-batch-*`-block rule:** asked
  "How should I write them?" with the option "Keep only the last state block", the operator chose it. The 3
  superseded per-round `sdd-batch-design-state` block(s) are dropped; the last one is kept byte-for-byte (the only one
  any workflow reads, `.claude/workflows/sdd-batch.js:191`). Other `sdd-batch-*` blocks are untouched.
- The loss check was a self-check by the planning agent (no separate `context-distiller` verifier was available).

---

## Session 2026-11-15 — sdd-execute sequential (sdd-batch-execute)

- **Up-front confirmation.** The operator approved the up-front plan (directive `conditional`, pending
  steps 1-17) with this record, binding and verbatim:

```json
{"mainDev":"9f88562296464b43465d0376b40cefafe93f0743","dev":"44191fa204e6939ab79a91e03e0a92ad38399656","specHash":"f321b8568ee85f281008da74743329b56d1e91e5","directive":"conditional","pending":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17],"mismatches":[{"n":1,"detail":"Files OK (packages/proto/analysis/v1/analysis.proto exists; ComponentSeries at :819-827, fields 1-4, next free is 5, confirmed). Two line cites are wrong, and the proto has not changed since spec base ae6541d7e. (a) The request comment 'the page passes the exact bars it drew…' is at analysis.proto:806-808, not :805-807. design.md's :806-808 was right and the spec's 'correction' is the error, so Instruction 2 should target :806-808. (b) The response comment 'Echoes the request times…' is at :814, not :813."},{"n":2,"detail":"No mismatch. All 8 gen paths exist and `git grep -l ComponentSeries -- packages/proto/gen` returns exactly those 8. scripts/buf-gen.sh:1-4, the ci.yml:255 proto-freshness job and docs/runbooks/codegen-toolchain-host-setup.md are all present."},{"n":3,"detail":"Files OK (app/services/warmup.py, app/handlers/servicer.py). Small cite errors: (a) indicators.proto `int32 warmup_period = 12` is at :174, not :176 (design.md's :174 was right). (b) `_is_custom_formula` is at warmup.py:159, not :160. (c) The call-site census misses a second test caller: tests/test_fundamentals_pit_pager.py:307 calls `svc._formula_fundamentals(_formula_definition(), (), failures=failures)`. A new keyword-only `warmups=None` still breaks no caller. Everything else confirmed: builtin_lookback_bars :70, _CROSSOVER_LOOKBACK :59, _int_param :62, defaults :52-53, STOCH comment :93, _formula_fundamentals :1914 with `*, cache=None, failures=None`, GetFormula call at :1934-1937, GetIndicatorSeries :4516, the call at :4548, branches at :4576/:4586/:4590, ComponentSeries success :4622 and error :4630, guard test at :8029-8034, `from app.services import scoring, sector_params, warmup` at :65."},{"n":4,"detail":"No mismatch. tests/test_warmup.py:17 import and TestBuiltinLookback :50 confirmed. TestGetIndicatorSeries :7057, _definition :7061, the setup pattern, test_per_component_fault_isolation :7070 confirmed. No conftest reference in test_warmup.py."},{"n":5,"detail":"Files OK. Trivial cite error: `\"errors\"` is imported at marketdata_repo.go:6, not :7. All other evidence confirmed: otel.go var block :367-372 with backfillSymbols :371, RecordBackfillSymbol :403, KeyOp :312, NewCounter/Add :191-195. The 9 wrap sites are confirmed at :69, :92, :95, :121, :127, :192, :197, :489, :494. scanBars :142 with rows.Err() :171-172; QueryRecentBars uses r.db (:190); 5000 cap :181; `53200`/pgerrcode are absent; ci.yml:374 COVERPKGS excludes repository and telemetry."},{"n":6,"detail":"Files OK. The C-13 claim 'No `internal/testdata/` home exists and none is created' is false. services/xstockstrat-marketdata/internal/testdata/ exists (assets.go, marks.go, package testdata, feature 282) and was already there at ae6541d7e. Re-check the C-13 placement decision at execute (inline single-consumer literals are probably still compliant, but the stated basis is wrong). Other evidence confirmed: TestQueryRecentBars_BoundedWindowShape :868, WillReturnError :258/:511, pgxmock v4.9.0 at go.mod:10, installMetricReader :55, allowedLabelKeys :28 (includes KeyOp), minInstruments :38, driveAllInstruments :45. pgxmock RowError has no in-repo use, as the spec says; still to confirm at execute."},{"n":7,"detail":"Create paths 050_ui_chart_history_bars.{up,down}.sql are absent as expected. scripts/config-wiring-stored.json and scripts/config-wiring.json exist. The last config migration on the merged tree and on origin/main-dev (=9f88562) is 049, so 050 is still free on trunk. The only other 050 claim is 050_analysis_live_enrich_ttl_reseed on origin/feature/fix-live-enrich-ttl-seed (commit ce1878107). Evidence confirmed: 023 seed shape, the 048 column list with updated_by plus sentinel, the 048 down template, config-wiring.json:5-12 entry shape, 338 impl-spec:183 precedent, key count in stored json = 0. Cite drift: check-config-wiring.mjs storedInputsSha256 is at :224-230 and freshness/STALE-STORED at :714-717 (spec says :226-231 and :713-717). Step Dependencies is stale: merge-order.md now has the 343→341 row (:127) and a paragraph (:405-411) covering the 342 overlap and the 050 claim. The spec says no such note exists, so that Open Thread looks resolved."},{"n":8,"detail":"Create path src/__tests__/uiChartHistoryBarsSeedMigration.test.ts is absent as expected. notifyCommsgunSeedMigration.test.ts, barIngestBackoffSeedMigration.test.ts and migrationSql.ts are present (findOne :8, splitStatements :19). globalIntSeedCases.ts INSERT_RE has no updated_by and its down DELETE has no sentinel, so it is not reusable, as the spec says. config tsconfig.json:14 and package.json:12 confirmed. No mismatch."},{"n":9,"detail":"No mismatch. SCALAR_BOUNDS_REGISTRY :114-179, lookupScalarBounds :181-183, precedent comment plus entry at :123-126, and no `'ui.` entry, all confirmed."},{"n":10,"detail":"File OK. Minor line drift in setConfigScalarBounds.test.ts: setConfig is at :72 (confirmed). The out-of-bounds rejection block runs :213-235 with /\\[1, 5\\]/ at :217 (spec says :212-232 and :216). The accept-without-create_key case is :237-244 (spec says :234-244). Patterns confirmed."},{"n":11,"detail":"Files OK. indicatorChart.ts ProtoTime :7, IndicatorValueLike :12, toLineData :27 with values[i] at :33, normalizeAscendingUnique :44 confirmed. readRiskFreeRate is at performanceMetrics.ts:192. config-wiring.json :80 (toLineData dynamic) and :141 (performanceMetrics receiver) confirmed. CHART_WINDOW_BARS, readHistoryBars and the other new symbols are absent. Risk to confirm at execute: config.proto `int64 int_val = 2`, and the TS is generated by protoc-gen-es 2.12.0 with no jstype option, so the oneof init value is likely a bigint. readHistoryBars must convert it (Number()) before clamping. No UI code reads an intVal today, so there is no precedent."},{"n":12,"detail":"Files OK: indicatorChart.test.ts, configKeys.ts and INVENTORY.md exist; e2e/fixtures/indicatorHistory.ts is absent as expected (create). Evidence confirmed: vitest import header, test:unit :17 and test:coverage :19, vitest.config include and thresholds, PLATFORM_TRADING_STATE_VALUES :252-257, INVENTORY rows :52/:57, indicatorSeries.ts T/GAP/V, dbTlsPlatformGuard.test.ts node:fs :4 and :63, ci.yml:796. Same int64 risk as Step 11: `UI_CHART_HISTORY_VALUES.init(bars)` with `value: bars` (a number) likely needs a BigInt for the protobuf-es intVal init shape. The spec flags only the wire encoding."},{"n":13,"detail":"Files OK (page.tsx, useIndicatorSeries.ts, deadlines.ts). Confirmed: loadBars :248, `pageSize: 200` :256, setBarSeries :262, mapBars :269, loadBarsRef :328-332, 300_000 poll :340, barSeries state :134, <IndicatorSection :529, IndicatorSection :1303, useIndicatorSeries :1324, <IndicatorPanels :1348, the hook queryKey :16, traderConfigClient at browserClients/traderConfigClient.ts:8 (src/lib/traderConfigClient.ts does not exist, as the spec notes), traderBff ConfigService forward :166-170, PerformanceDashboard :75, positions/page.tsx:126, useFormulas staleTime :19, deadlines.ts REFRESH_TIMEOUT_MS 10_000 at :3, mapBars chart.ts:38, marketdata_service :301-303/:466-477. Note: page.tsx:3 imports only useQueryClient, not useQuery, so the new useQuery import must be added."},{"n":14,"detail":"Files OK (position-detail.spec.ts, mock-backend.ts, helpers/auth.ts; indicatorHistory.ts is created by Step 12). Minor drift: the indicator-panel test starts at :473 (spec :478-515) and the hydration scoping note is at :522-525 (spec :524-528). Confirmed: watchlist :864, postDataJSON :705, page.route :226/:417, getBars returns mockDailyBars at mock-backend :711-712, getIndicatorSeries :1417, getConfig ui block :1541-1552 with only the two performance.* keys."},{"n":15,"detail":"No mismatch. isChartable :19-20, used at :62, effect deps :153, error pane :172, indicator-panel / data-series-count / data-series :182-184, Eyebrow import :5, EmptyState with data-testid=empty-state confirmed. 'Not enough history' count in src = 0. IndicatorPanels is referenced only by the component and the symbol page."},{"n":16,"detail":"No mismatch. It depends on Step 14 fixtures that do not exist yet (expected). data-series-count seam and getByRole('main') scoping confirmed."},{"n":17,"detail":"No mismatch. All 4 files exist. Confirmed: runbook sections at :41, :64, :100, :116; 004 migration set_chunk_time_interval at :25; operator-db-access.md :44-53 with no homelab mention; mcp-tools list_config_keys :1232, set_config :1252, create_key :1265; ui/CLAUDE.md Config Keys table ~:192-202; marketdata/CLAUDE.md § Observability :138; config-governance.md § Per-Feature Registered Keys :145 with the 338 entry at :151; check-config-wiring.mjs --doc-check flag present. homelab-edge cites (read-only) confirmed: defaults/main.yml:12-13 (70 / 1024), verify.yml assert 'on|1024|UTF8|0', db-host.md:21 and :36 SSH-then-psql."}]}
```

- **User request relayed by the workflow harness, verbatim:** "1. Yes / 2. No, add it to the scope /
  3. Yes". It names no question, so this setup did not act on it; the step loop must map it to the
  gate questions it answers before relying on it.
- **Merge:** `origin/main-dev@9f8856229` merged into the dev branch as `77b83402b` (no conflicts;
  `merge-train-resolve` and `ledger-guard` clean).
- **Tooling detection (steps 1-17):** go1.27 ✓ · golangci-lint ✗ v2.5.0 present (install v2.14.0
  with `GOTOOLCHAIN=go1.27.0` at Step 5) · python 3.13 ✓ · uv ✓ · node 24 ✓ · pnpm ✓ 9.15.9 ·
  buf ✗ (Docker codegen image via `scripts/localenv-setup.py` at Step 2; dockerd present) ·
  Chromium ✓ `/opt/pw-browsers` · vitest/playwright ✓ (linked main-checkout `node_modules`).
- **Re-spec (conditional):** step bodies edited where the evidence drifted — 1, 3, 5, 6, 7, 10, 11,
  12, 13, 14 and the Step 16 hydration cite; 2, 4, 8, 9, 15, 17 unchanged. Outside step bodies (not
  edited, the re-spec may touch only step bodies): Step Dependencies still says `merge-order.md` has
  no 341/342 or `050` note (it now has `:127` and `:405-411`, so that Open Thread is resolved), and
  Assumption 4 still cites `check-config-wiring.mjs:713-717` (now `:714-717`).
- **respec commits** (`git log --first-parent origin/main-dev..HEAD`):
  - `f73e38a39` respec(fix-indicator-pane-warmup): align steps 1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17 with current codebase
- Status `implementation-ready` → `in-progress` (`965128bb2` feature.md, `ff2ae538b` status.md).

```sdd-batch-setup
{"mainDev":"9f88562296464b43465d0376b40cefafe93f0743","date":"2026-11-15"}
```

---

## Session 2026-11-15 — sdd-execute sequential, steps 1+2 (atomic unit)

### Step 1 — proto: `first_value_bars` on `ComponentSeries` [done]
- Part of the Steps 1+2 unit. Added `int32 first_value_bars = 5;` to `ComponentSeries` with its constraint comment, and rewrote the `GetIndicatorSeriesRequest` closes/times comment (drawn window plus history prefix; the server never re-fetches). `buf lint` and `buf breaking` against the dev-branch tip are clean. TDD: N/A (proto).
- Files modified: `packages/proto/analysis/v1/analysis.proto`
- Deviations: verification ran in the codegen container, and `buf breaking` used `ref=<origin tip sha>` instead of `branch=` (full detail in the Deviation Log).

### Step 2 — proto-gen: regenerate stubs [done]
- Part of the Steps 1+2 unit. `./scripts/buf-gen.sh` (run in `Dockerfile.codegen`) changed exactly the eight expected `analysis/v1` stubs. A second run left the same eight-file diff, and `git grep` found `first_value_bars|firstValueBars|FirstValueBars` in 6 gen files (at least 3 required). TDD: N/A (proto-gen).
- Files modified: `packages/proto/gen/go/analysis/v1/analysis.pb.go`, `packages/proto/gen/python/analysis/v1/analysis_pb2.py`, `packages/proto/gen/ts/analysis/v1/analysis.ts`, `packages/proto/gen/ts/analysis/v1/analysis_pb.ts`, `packages/proto/gen/ts/dist/analysis/v1/{analysis.d.ts,analysis.js,analysis_pb.d.ts,analysis_pb.js}`
- Deviations: CI-equivalent container fallback (Deviation Log).

---

## Session 2026-11-15 — sdd-execute sequential, steps 3+4 (atomic unit)

Tooling setup (steps 3+4): python 3.12 ✓ (service `.python-version`) · uv ✓ 0.11.32 · ruff ✓ 0.16.9 (uv) · pytest ✓ 9.0.3 (uv; `uv sync --extra dev` in the worktree's own `.venv`).

### Step 3 — service: analysis declares each component's first-value bars [done]
- Part of the Steps 3+4 unit. Added pure `warmup.first_value_bars(comp, formula_warmups, formula_fund_map)` below `builtin_lookback_bars` (SMA/BB/STOCH = period, RSI/ATR = period + 1, EMA/MACD = 1, VWAP/unknown = 0; 0 for `source_symbol`, fundamental and fundamentals-only formula components; declared `warmup_period` + 1 for other formulas). `_formula_fundamentals` gained keyword-only `warmups=None`, filled from the existing `GetFormula` call, and `GetIndicatorSeries` sets `first_value_bars` on the success `ComponentSeries` only (error stays 0). No compute change, no new outbound call. TDD: red → green with Step 4 (below).
- Files modified: `services/xstockstrat-analysis/app/services/warmup.py`, `services/xstockstrat-analysis/app/handlers/servicer.py`
- Deviations: the Verification grep's "three lines" comment is off by one (the write is `warmups[fid] =`); see the Deviation Log.

### Step 4 — test: first-value bars per family and on the RPC [done]
- Part of the Steps 3+4 unit. New `TestFirstValueBars` (per-family table, zero cases, formula 30 → 31, and the drift pin `(first_value_bars - 1) + _CROSSOVER_LOOKBACK == builtin_lookback_bars` for SMA/BB/RSI/ATR at periods 2/14/50/200) and two `TestGetIndicatorSeries` tests.
- AC-2/AC-4 red: with `first_value_bars` a signature returning 0, `assert by_ref == {"sma200": 200, "sma20": 20, "custom": 31}` failed (`{'sma200': 0} != {'sma200': 200}`); 26 failed / 6 passed in the targeted run → green: full suite `1724 passed, 12 skipped` (real_pg, no local Postgres), `Total coverage: 91.37%` (≥ 40); targeted `32 passed` and `2 passed`.
- Files modified: `services/xstockstrat-analysis/tests/test_warmup.py`, `services/xstockstrat-analysis/tests/test_analysis_servicer.py`
- Deviations: the block exits 1 on its last line, the no-match `grep conftest` (expected); see the Deviation Log.
- Pin formula: the test pins the spec's `(first_value_bars - 1) + _CROSSOVER_LOOKBACK`, not `design.md`'s `first_value_bars + _CROSSOVER_LOOKBACK` (Assumption 1). Sequential mode has no Step 4 gate prompt, so it goes to the operator in the checkpoint report.

---

## Session 2026-11-15 — sdd-execute sequential, steps 5+6 (atomic unit)

Tooling setup (steps 5+6): go1.27.0 ✓ · golangci-lint ✓ v2.14.0 built with go1.27.0 (`/root/go/bin`, put first on `PATH`; `/usr/local/bin` holds v2.5.0) · pgxmock v4.9.0 ✓ (module cache).

### Step 5 — service: marketdata lock-budget breach counter [done]
- Part of the Steps 5+6 unit. Added counter `marketdata.ohlcv.out_of_memory_errors`, the `OhlcvOp*` labels and `RecordOhlcvOutOfMemory(ctx, op)` in `otel.go`; added `observeLockBreach(ctx, op, err)` and the constant `sqlstateOutOfMemory = "53200"` in the repository, and wrapped the 9 returned errors of `InsertBars`, `QueryBars`, `QueryRecentBars` and `QueryBarsBatch` (including `tx.Commit` and the `scanBars` returns). The error is returned unchanged. TDD: red → green with Step 6 (below).
- Files modified: `services/xstockstrat-marketdata/internal/telemetry/otel.go`, `services/xstockstrat-marketdata/internal/repository/marketdata_repo.go`
- Deviations: the Verification grep prints 10, because it also matches the definition line; the call sites are the specified 9 (Deviation Log).

### Step 6 — test: 53200 counts, another error does not [done]
- Part of the Steps 5+6 unit. New `TestObserveLockBreach` (wrapped 53200 counts 1; 57014, a plain error and nil count 0; the input is returned unchanged) and `TestQueryRecentBars_CountsLockBreachFromRows` (pgxmock `CloseError` 53200 on the `rows.Err()` path → `errors.As` finds 53200 and `{op="recent_bars"}` = 1). A test-local `installMetricReader` and `ohlcvOOMCount` read the counter. The allow-list test gains the instrument and one `RecordOhlcvOutOfMemory` drive. Bar rows and `PgError` values stay inline: each has one consumer (C-13).
- Red, with `observeLockBreach` as a bare passthrough (`.sdd-logs/v-1.log`): `out_of_memory_errors{op=bars} = 0, want 1` and `out_of_memory_errors{op=recent_bars} = 0, want 1`. Green (`.sdd-logs/v-2.log`, `v-3.log`): lint `0 issues.`; the 4 subtests and both new tests PASS; all 16 packages `ok`; `total: (statements) 83.2%` (≥ 40).
- Files modified: `services/xstockstrat-marketdata/internal/repository/marketdata_repo_test.go`, `services/xstockstrat-marketdata/internal/service/telemetry_allowlist_test.go`
- Deviations: none for the pgxmock fallback (`CloseError` exists in v4.9.0, so `WillReturnError` was not needed); the Open Thread for it is resolved.

## Session 2026-11-15 — operator standing authorization and checkpoint answers (orchestrator)

- **Standing authorization for checkpoints — operator, verbatim (2026-11-15): "Proceed, do not stop at
  checkpoints unless it's necessary".** Given in answer to "Proceed past the checkpoints?". The run uses
  `checkpoints: 'report'` from here on; this entry is its `authorizationRef`. It does not waive blockers,
  failed verifications, Floor breaches, uncovered `@AC` CHANGE lines or any decision that is the
  operator's — those still halt.
- **Scratch Postgres for stored-set generation (orchestrator tooling, not an operator ruling):** a
  Postgres 16 the main session controls listens on 127.0.0.1:5432. `DATABASE_URL` is not exported into
  agent shells; prefix the generator: `DATABASE_URL='postgres://postgres@127.0.0.1:5432/postgres?sslmode=disable'
  python3 scripts/config-wiring-stored.py`. Do not start, stop or delete the server; if it is
  unreachable, stop and report.
- **Pin-formula correction — "Agreed".** Asked: the design's check was off by one against its own
  numbers (201 for a 200-period average); the spec and code use the corrected form (SMA 200 → 200,
  RSI 14 → 15) — accept? Accepted; the Step 4 gate item is closed.
- **`@AC-2` and `@AC-4` EXTEND sign-off — operator, verbatim: "Expand that."** Asked: these two "not
  enough history" scenarios extend an existing rule and were never explicitly signed off — sign off?
  **Orchestrator reading (not operator words): "expand" is taken as "extend", i.e. the EXTEND is
  approved.** The reading was stated back to the operator with a fuller explanation; if the operator
  corrects it, this line is superseded.

---

## Session 2026-11-15 — sdd-execute sequential, steps 7+8 (atomic unit)

Tooling setup (steps 7+8): node 24 ✓ · pnpm ✓ (linked main-checkout `node_modules`) · psql ✓ · migrate ✓ · scratch Postgres 16 ✓ 127.0.0.1:5432 (orchestrator's; not started or stopped here).

### Step 7 — migration: seed `ui` / `chart.indicator_history_bars` and regenerate the stored set [done]
- Part of the Steps 7+8 unit. `050` re-derived (free here and on `origin/main-dev`; 330 still holds `050` on its branch). Added `050_ui_chart_history_bars.{up,down}.sql` (two global int rows at 200, sentinel actor, insert-if-absent; the down deletes only the sentinel row still at 200), the temporary `seeded-unread` finding in `scripts/config-wiring.json`, and regenerated `scripts/config-wiring-stored.json` on the scratch Postgres (committed unedited). TDD: N/A (migration). Offline up/down parity checked by reading both and by Step 8.
- Wiring gate: `check-config-wiring.mjs --declared-from … --declared-migration …` exit 0 with one `PENDING: …:ui/chart.indicator_history_bars:seeded-unread`; `--keys` exit 0 (same PENDING line); `--final` exit 0, no STALE-STORED / STALE (only the two pre-existing `REPORTED: … readers-disagree`); `config-wiring.test.mjs` 75 pass.
- Files modified: `services/xstockstrat-config/migrations/050_ui_chart_history_bars.up.sql`, `services/xstockstrat-config/migrations/050_ui_chart_history_bars.down.sql`, `scripts/config-wiring.json`, `scripts/config-wiring-stored.json`
- Deviations: Verification read as specified (Deviation Log).

### Step 8 — test: seed migration shape [done]
- Part of the Steps 7+8 unit. New `uiChartHistoryBarsSeedMigration.test.ts` on the shared `findOne` / `splitStatements` helper; one row regex instead of a copy of the 049 test's tuple parser (DRY).
- AC-1/AC-3 red (`.sdd-logs/v-1.log`, migrations absent): `expected exactly one *_ui_chart_history_bars.up.sql, got []`, 5 fail / 365 pass → green (`.sdd-logs/v-6.log`): lint 0 errors, `tests 370 / pass 370 / fail 0`, `All files 92.24` lines (≥ 40).
- Files modified: `services/xstockstrat-config/src/__tests__/uiChartHistoryBarsSeedMigration.test.ts`
- Deviations: the block exits 1 on its last line, the no-match fixtures grep (expected); see the Deviation Log.
- Open Threads update: the scratch-Postgres thread and the "Step 7 alone passes `--final`" thread are resolved; the `050` claim shared with 330 stays open for the integration PR; owner + config-team approval for the key is still outstanding.

---

## Session 2026-11-15 — sdd-execute sequential, step 9

Tooling setup (step 9): node ✓ · pnpm ✓ (linked main-checkout `node_modules`); no install.

### Step 9 — service: write bound [200, 1000] for the history depth [done]
- Added `'ui.chart.indicator_history_bars': { minValue: 200, maxValue: 1000 }` to `SCALAR_BOUNDS_REGISTRY` with a two-line constraint comment (floor = the 200-bar drawn window; ceiling = the operator-signed lock budget, raising it needs a new design pass). Write-side only; no new outbound call.
- AC-1/AC-3 red (`.sdd-logs/v-1.log`, Step 10's `it` block written uncommitted before the edit, per Step Dependencies): `AssertionError [ERR_ASSERTION]: history depth 199 is out of [200, 1000]` (`undefined !== 3`), `tests 371 / pass 370 / fail 1` → green (`.sdd-logs/v-2.log`, `exit=0`): lint `0 errors`, `tests 371 / pass 371 / fail 0`, `✔ bounds the indicator history depth to [200, 1000] — AC-1, AC-3`, grep `181:  'ui.chart.indicator_history_bars': { minValue: 200, maxValue: 1000 },`. Step 9's block has no coverage gate; Step 10's runs `c8 check-coverage --lines 40`. The test edit was reverted after green; Step 10 writes and commits it (its RED is this run).
- Config-key wiring gate: not applicable (a `service` step, no migration in **Files**, no `## Config Key Changes` heading; `check-config-wiring.mjs` does not read the bounds registry).
- Files modified: `services/xstockstrat-config/src/grpc/configServiceImpl.ts`
- Deviations: none

---

## Session 2026-11-15 — sdd-execute sequential, step 10

Tooling setup (step 10): node ✓ · pnpm ✓ (linked main-checkout `node_modules`); no install.

### Step 10 — test: bounds on the history depth [done]
- Added one `it` block to `setConfigScalarBounds.test.ts` for `ui` / `chart.indicator_history_bars`: `intVal` 199 and 1001 → `INVALID_ARGUMENT`, `/\[200, 1000\]/`, no INSERT; 200 and 1000 → accepted, INSERT runs, no `create_key`. The key literal stays inline (one consumer, C-13).
- AC-1/AC-3 red (`.sdd-logs/v-1.log`, Step 9's registry line removed uncommitted in this worktree): `AssertionError [ERR_ASSERTION]: history depth 199 is out of [200, 1000]`, `tests 371 / pass 370 / fail 1` → green (`.sdd-logs/v-2.log`, line restored): lint `0 errors`, `✔ bounds the indicator history depth to [200, 1000] — AC-1, AC-3`, `tests 371 / pass 371 / fail 0`, `All files | 92.25` lines, `c8 check-coverage --lines 40` passed.
- Config-key wiring gate: not applicable (a `test` step, no migration in **Files**, no `## Config Key Changes` heading).
- Files modified: `services/xstockstrat-config/src/__tests__/setConfigScalarBounds.test.ts`
- Deviations: RED against a temporarily reverted Step 9 line; the block exits 1 on its last no-match grep (Deviation Log).

---

## Session 2026-11-15 — sdd-execute sequential, steps 11+12 (atomic unit)

Tooling setup (steps 11+12): node ✓ · pnpm ✓ (linked main-checkout `node_modules`) · vitest ✓; no install.

### Step 11 — service: UI pure helpers — read D, window the series [done]
- Part of the Steps 11+12 unit. Added `CHART_WINDOW_BARS` / `DEFAULT_HISTORY_BARS` (200) / `MAX_HISTORY_BARS` (1000), `readHistoryBars(values)` (oneof `intVal` only; the `bigint` goes through `Number(...)`, clamped to [200, 1000]; anything else → 200) and `windowIndicatorSeries(series, requestedBars, windowBars)` (tail-slices times and every point list with `.slice`, builds `insufficient` from no error + H < requested + `firstValueBars > H`; 0 never qualifies; input not mutated) in `indicatorChart.ts`. `scripts/config-wiring.json`: receiver `indicatorChart.ts:values` → `ui` added, the Step 7 temporary `seeded-unread` finding removed. No new outbound call.
- Wiring: `--keys ui.chart.indicator_history_bars` exit 0, silent (`.sdd-logs/v-4.log`); `--final` exit 0, only the two pre-existing `REPORTED: … readers-disagree` lines (`v-5.log`); `config-wiring.test.mjs` 75 pass (`v-6.log`).
- Files modified: `services/xstockstrat-ui/src/lib/indicatorChart.ts`, `scripts/config-wiring.json`
- Deviations: the block's `exit=` reflects only its last line; the checker lines were re-run alone (Deviation Log).

### Step 12 — test: vitest for D, the window and the insufficient set [done]
- Part of the Steps 11+12 unit. New fixture module `e2e/fixtures/indicatorHistory.ts` (`historyTimes`, `smaComponent`, `indicatorSeriesResponse`), `UI_CHART_HISTORY_VALUES` in `configKeys.ts` (`init` = `BigInt`, `wire` = decimal string; int64), two `INVENTORY.md` rows. New `describe('readHistoryBars')` (absent, `stringVal`/`floatVal`, 50 → 200, 5000 → 1000, 1000, 600, and the seed-to-reader case reading `*_ui_chart_history_bars.up.sql` from disk: `value_type` `int`, value 200 = `DEFAULT_HISTORY_BARS`) and `describe('windowIndicatorSeries')` (AC-1..AC-4, full page at the default, `firstValueBars` 0 and error never insufficient, tail-of-response times, no mutation, `toLineData` gap contract).
- AC-1..AC-4 red (`.sdd-logs/v-1.log`, helpers as signatures returning the default / the input unchanged): `Tests 9 failed | 554 passed | 2 skipped`, e.g. `AC-1 … expected [ …(400) ] to have a length of 190 but got 400`, `AC-4 … expected [] to deeply equal [ 'sma200' ]` → green (`.sdd-logs/v-2.log`): lint no errors (pre-existing warnings only, none in these files), `tsc` clean, `Tests 563 passed | 2 skipped (565)`, coverage `All files | 78.56` statements, `80.97` functions, `79.75` lines (≥ 40).
- Files modified: `services/xstockstrat-ui/src/lib/indicatorChart.test.ts`, `services/xstockstrat-ui/e2e/fixtures/indicatorHistory.ts`, `services/xstockstrat-ui/e2e/fixtures/configKeys.ts`, `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md`
- Deviations: the block's `exit=` reflects only its last grep (Deviation Log). INVENTORY rows list the one current consumer; Step 14 adds the e2e consumers.
- Commit trailer: this agent's `Co-Authored-By` line follows the session's attribution reminder (`Claude Opus 5.5`), not the workflow text's `Claude Fable 5.2`.

---

## Session 2026-11-15 — sdd-execute sequential, step 13

Tooling setup (step 13): node ✓ · pnpm ✓ (linked main-checkout `node_modules`) · vitest ✓ · Playwright + Chromium ✓ (`/opt/pw-browsers`, host-native single spec); no install.

### Step 13 — service: symbol page fetches D bars, draws W, windows the panes [done]
- Added `HISTORY_CONFIG_TIMEOUT_MS = 3_000` to `deadlines.ts`. The symbol page reads `ui` config once through `traderConfigClient` (`staleTime: Infinity`, `retry: false`, per-call `timeoutMs`) and derives `historyBars = readHistoryBars(data ?? {})`. `loadBars` waits for that query to settle, then requests `pageSize: historyBars` with no `range`. It keeps every timestamped bar in `barSeries` and draws `mapBars(res.bars).slice(-CHART_WINDOW_BARS)`. `IndicatorSection` takes `requestedBars` and passes the memoised `windowIndicatorSeries(series, requestedBars)` components and times to `IndicatorPanels`; `insufficient` is not read yet (Step 15). The `useIndicatorSeries` query key gains the last bar's time as a string. No new backend edge.
- AC-1 red (`.sdd-logs/v-2.log`; an uncommitted probe spec routed `GetConfig(ui)` to `UI_CHART_HISTORY_VALUES.wire(1000)`): `Expected: 1000` / `Received: 200`, with GetBars sent `"page":{"pageSize":200}` → green (`v-6.log`): GetBars sent `"page":{"pageSize":1000}`, no `range`, `1 passed`. The probe was then deleted; Step 14 writes the real e2e.
- Verification (`v-5.log`, `exit=0`): lint clean for the touched files, `tsc` clean against the branch stubs, `Tests 563 passed | 2 skipped (565)`. The `pageSize: 200` grep found nothing. The helper grep matched `:16` (import), `:262`, `:288` and `:1353`, and `namespace: 'ui'` matched once (`:253`). The wiring check was not required (no migration, no `## Config Key Changes`) and was run anyway (`v-7.log`): `--keys` exit 0, silent; `--final` exit 0, printing only the two pre-existing `REPORTED: … readers-disagree` lines.
- Files modified: `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx`, `services/xstockstrat-ui/src/hooks/useIndicatorSeries.ts`, `services/xstockstrat-ui/src/lib/deadlines.ts`
- Deviations: `tsc` ran against the branch's own `@xstockstrat/proto` stubs, because the linked `node_modules` resolves to the main checkout's `main-dev` stubs. The probe ran with `--no-deps` (Deviation Log).
- Commit trailer: `Co-Authored-By` follows the session attribution reminder (`Claude Opus 5.5`).

---

## Session 2026-11-15 — sdd-execute sequential, step 14

Tooling setup (step 14): node ✓ · pnpm ✓ (linked main-checkout `node_modules`) · vitest ✓ · Playwright + Chromium ✓ (`/opt/pw-browsers`, host-native single spec) · Docker e2e runner ✗ (no `.dockerignore`, so the build would copy the worktree's `node_modules` symlink; not used); no install.

### Step 14 — test: e2e — the page requests the configured depth [done]
- `indicatorHistory.ts` gained `historyBarsWire(symbol, n)` and `indicatorSeriesWire(n, periods)`, the Connect-JSON bodies built with protobuf-es `toJson(create(...))`. `position-detail.spec.ts` gained three tests beside the FR-6 block and one module-level `routeIndicatorHistory` helper (request capture, plus the `GetConfig` guard that answers only `namespace === 'ui'`). The tests: default depth (no override; `GetBars` `page.pageSize` 200, no `range`), `@AC-1` (depth 1000 and 400 bars → `pageSize` 1000, no `range`, 400 closes and 400 times sent to `GetIndicatorSeries`, one `sma200` `indicator-panel`, no error panel) and `@AC-3` (200 bars → the `sma200` pane draws; "Not enough history" absent). The two `INVENTORY.md` rows list the new consumer. The existing FR-6 test is unchanged and still passes.
- AC-1 red (`.sdd-logs/v-3.log`; Step 13's `page.tsx` temporarily reverted to `HEAD~1`, uncommitted): `@AC-1 …` failed on `expect.poll(() => requests.getBars).toMatchObject({ page: { pageSize: 1000 } })` with `- "pageSize": 1000, + "pageSize": 200`. The default-depth and `@AC-3` tests passed there, as expected before Step 13. → green (`v-10.log`, `exit=0`): the default-depth, `@AC-1`, `@AC-3` and FR-6 tests passed, `4 passed`. Full spec `v-8.log`: `44 passed`, plus `2 failed` in the two pre-existing first-run tests. Those two report `2 flaky` on the clean branch tip (`v-9.log`) and with this step's changes (`v-10.log`). `tsc` against the branch stubs: clean (`v-6.log`). `test:coverage`: `Tests 563 passed | 2 skipped (565)`, `All files | 78.58` statements (≥ 40) (`v-11.log`). Prettier is clean on both changed `.ts` files (`v-12.log`).
- Config-key wiring gate: not applicable (a `test` step, no migration in **Files**, no `## Config Key Changes` heading).
- Files modified: `services/xstockstrat-ui/e2e/trader/position-detail.spec.ts`, `services/xstockstrat-ui/e2e/fixtures/indicatorHistory.ts`, `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md`
- Deviations: Playwright ran host-native with `--no-deps --timeout=30000` (and `--retries=1`), because the verbatim block's `warmup.setup.ts` times out at 10 s on a cold dev server. `tsc` ran against the branch stubs. `INVENTORY.md` already failed `prettier --check` at `HEAD` and was not reformatted (Deviation Log).
- Commit trailer: `Co-Authored-By` follows the session attribution reminder (`Claude Opus 5.5`).

---

## Session 2026-11-15 — sdd-execute sequential, step 15

Tooling setup (step 15): node ✓ · pnpm ✓ (linked main-checkout `node_modules`) · vitest ✓; no install.

### Step 15 — service: "Not enough history" pane [done]
- `IndicatorPanels` takes a required `insufficient: ReadonlySet<string>`. `isChartable(c, insufficient)` drops those components from the drawn panes, so the pane count, the `total` height and the crosshair labels agree, and `insufficient` joins the effect dependencies. A component with no `error` that is in the set renders `data-testid="indicator-panel-insufficient"` with `<Eyebrow>{refName}</Eyebrow>` and `<EmptyState title="Not enough history" />`. The error branch keeps precedence, and `indicator-panel-error` and `ComponentSeries.error` are not reused. `IndicatorSection` passes `windowed.insufficient`. No new primitive and no new outbound call.
- AC-4 red (`.sdd-logs/v-3.log`): with an uncommitted vitest render probe (`renderToStaticMarkup`, explicit set `{sma200}` over `sma200` + `sma20`), `AssertionError: expected [] to have a length of 1 but got +0` on the `indicator-panel-insufficient` count, `Tests 1 failed | 1 passed (2)`. Green (`v-4.log`): `Tests 2 passed (2)`. The probe was deleted before verification. Verbatim block (`v-5.log`, `exit=0`): lint clean (pre-existing warnings in other files only). The grep found `:5` (EmptyState import), `:183` (`indicator-panel-insufficient`) and `:185` (`Not enough history`), and the copy count in `src` was `1`. `tsc` against the branch stubs was clean, and `test:unit` gave `Tests 563 passed | 2 skipped (565)` (`v-6.log`, `exit=0`). Prettier was clean on both files. This step has no coverage gate: the component sits outside `src/lib/**`, and the gate is Step 12's.
- Config-key wiring gate: not applicable (a `service` step, no migration in **Files**, no `## Config Key Changes` heading).
- Files modified: `services/xstockstrat-ui/src/components/trader/IndicatorPanels.tsx`, `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx`
- Deviations: RED/GREEN came from a temporary vitest probe, not an e2e, and `tsc` ran against the branch stubs (Deviation Log). The spec's caller cite `page.tsx:1348-1353` now reads `:1374-1380` (line drift only).
- Commit trailer: `Co-Authored-By` follows the session attribution reminder (`Claude Opus 5.5`).

---

## Session 2026-11-15 — sdd-execute sequential, step 16

Tooling setup (step 16): node ✓ · pnpm ✓ (linked main-checkout `node_modules`) · Playwright + Chromium ✓ (`/opt/pw-browsers`, host-native single spec) · Docker e2e runner ✗ (no `.dockerignore`, as in Step 14); no install.

### Step 16 — test: e2e — only the indicator lacking history reports it [done]
- Three tests in the Step 14 block of `position-detail.spec.ts`, all scoped to `getByRole('main')`. `@AC-2`: depth 1000, 150 bars, `[200]` → one `indicator-panel-insufficient` with `sma200` and "Not enough history", zero `indicator-panel` and zero `indicator-panel-error`. `@AC-4`: depth 1000, 150 bars, `[200, 20]` → one insufficient pane (`sma200`) and one `indicator-panel` (`sma20`, `data-series-count` 1); the crosshair readout lists `sma20.value` and not `sma200.value`. Full page: no override (depth 200), 200 bars, `[250]` → one `indicator-panel`, no notice. `INVENTORY.md` is unchanged, because its consumer lists already name this spec.
- AC-2/AC-4 red (`.sdd-logs/v-3.log`; Step 15's two files temporarily at `HEAD~1`): `expect(notice).toHaveCount(1)` gave `Expected: 1` / `Received: 0` for both, and the full-page test passed → green (`v-5.log`, `exit=0`): `3 passed`. Full spec (`v-6.log`, `exit=0`): `47 passed`, `2 flaky`, the flaky ones being Step 14's two pre-existing first-run tests. Verbatim block (`v-4.log`, `exit=0`): lint and `tsc` passed, and `warmup.setup.ts` timed out at 10 s (`49 did not run`), as in Step 14. Prettier is clean on the spec. Playwright has no coverage gate; the gate is Step 12's.
- Config-key wiring gate: not applicable (a `test` step, no migration in **Files**, no `## Config Key Changes` heading).
- Files modified: `services/xstockstrat-ui/e2e/trader/position-detail.spec.ts`
- Deviations: every run used a temporary `tsconfig.json` `paths` entry to this worktree's proto stubs, restored before commit, and Playwright ran host-native targeted with `--no-deps` (Deviation Log).
- Commit trailer: `Co-Authored-By` follows the session attribution reminder (`Claude Opus 5.5`).

---

## Session 2026-11-15 — sdd-execute sequential, step 17

Tooling setup (step 17): node ✓ (for `check-config-wiring.mjs`); docs step, no install.

### Step 17 — docs: runbook section, service docs, registered-keys log [done]
- New runbook section "Homelab deep indicator history" after "Relationship to Piece B": what the key does, the budget-of-record table (DigitalOcean 200 → 600 days, unchanged; homelab 1000 → 3000 days, at most 404 locks per scan, 28,280 at c = 70 of 71,680), the feature 153 `@AC-1` PRESERVE-at-risk rule, three read-only preconditions (homelab-edge `verify` via `roles/db_host/tasks/verify.yml`; one `sudo -u postgres psql -d xstockstrat-staging` read of `max_connections`, `max_prepared_transactions` and the new chunk-width query, SSH path by reference to homelab-edge `docs/runbooks/db-host.md`; `list_config_keys ui`), recompute/escalate rule, three launch steps through the homelab MCP, and the DigitalOcean-admin line. UI `CLAUDE.md`: lead sentence names the `/trader` one-shot read through `traderConfigClient` (`traderBff.ts`), plus the key row (seed `050_ui_chart_history_bars`). Marketdata `CLAUDE.md` § Observability: the counter line. `config-governance.md`: feature 341 entry above 338. Each claim re-read against the code (`050_*.up/down.sql`, `configServiceImpl.ts:181`, `otel.go:372-380`, `marketdata_repo.go` wrap sites, `defaultBarLookback` slack 3, `traderConfigClient.ts`, page `staleTime: Infinity`).
- TDD: N/A (docs). Verification (`.sdd-logs/v-1.log`, `exit=0`): the heading at runbook `:129`; the key in UI `CLAUDE.md:202`, `config-governance.md:158`, `:167` and runbook `:133`, `:188`, `:196`; the counter in marketdata `CLAUDE.md:142` and runbook `:202`; `--doc-check` silent.
- All steps done: `node scripts/check-config-wiring.mjs --final` (`v-2.log`, `exit=0`) printed only the two pre-existing `REPORTED: … readers-disagree` lines (`fundsignal_loop.py:marketdata/fundamentals.provider`, `trading.go:platform/trading_state`). Status `in-progress` → `code-completed`.
- Operator directives mapped: `max_locks_per_transaction` 1024 and `max_connections` 70 are the values of record from homelab-edge `roles/db_host/defaults/main.yml`; no `SHOW max_locks_per_transaction`. The specified `psql` read keeps `SHOW max_connections` (Step 17 Instruction 1(b)) as a cross-check of the value of record; the operator's "max_connections are now love" reading is the orchestrator's, so the read was not dropped. The config read/write goes through the MCP.
- Files modified: `docs/runbooks/ohlcv-lock-budget-tuning.md`, `services/xstockstrat-ui/CLAUDE.md`, `services/xstockstrat-marketdata/CLAUDE.md`, `docs/patterns/config-governance.md`
- Deviations: none.
- Ledger: no insights line (nothing generalizes beyond this feature).
- Commit trailer: `Co-Authored-By` follows the session attribution reminder (`Claude Opus 5.5`).

---

## Session 2026-11-15 — sdd-batch-execute promotion plan (awaiting operator confirm)

```sdd-batch-promotion-plan
## Promotion plan — fix-indicator-pane-warmup (feature 341)

### Verdicts
| @AC | target suite (path) | CREATE/APPEND | verdict | note |
|---|---|---|---|---|
| AC-1 | /home/user/xstockstrat/services/xstockstrat-ui/acceptance/fix-indicator-pane-warmup.feature | CREATE | NEW | Then asserts on the rendered SMA200 pane series across the charted window (UI indicator pane). |
| AC-2 | /home/user/xstockstrat/services/xstockstrat-ui/acceptance/fix-indicator-pane-warmup.feature | CREATE | NEW | Then asserts on the pane's "Not enough history" text and the absence of a series (UI). |

### Ready-to-write blocks
--- /home/user/xstockstrat/services/xstockstrat-ui/acceptance/fix-indicator-pane-warmup.feature (CREATE) ---
Feature: Indicator pane renders long-lookback indicators across the charted window (feature 341)
  Regression guard promoted from feature 341's acceptance scenarios
  (docs/reports/2026-11-15-indicator-panel-sma200-single-point-defect.md).

  @AC-1 @regression @feature-341
  Scenario: A 200-period average renders across the whole charted window
    Given "LYFT" has 400 ingested daily bars
    And the indicator chart window covers the latest 190 bars
    When the indicator set containing SMA with period 200 is shown
    Then the SMA200 series has a value on each of the 190 charted bars

  @AC-2 @regression @feature-341
  Scenario: An indicator without enough history says so instead of drawing a dot
    Given "LYFT" has 150 ingested daily bars
    When the indicator set containing SMA with period 200 is shown
    Then the SMA200 pane shows "Not enough history" and draws no series

### Notes / ambiguities / conflicts
- Source scenarios carry no @FR-n tags (bug fix, C-15 regression scenarios), so none are added. The only existing tag besides @AC-n is @regression, which is kept. Only @feature-341 is added.
- Service attribution: both Then clauses assert on what the UI indicator pane renders, so both go to xstockstrat-ui. The product-spec lists xstockstrat-analysis as a "candidate" because its series builder has not been traced. If /sdd-design or the fix puts the warm-up computation in analysis, AC-1 could also be argued to belong in services/xstockstrat-analysis/acceptance/. I did not split it. The observable outcome is the rendered pane, so a human can move it if the final design says otherwise.
- Dedup: grep of every services/*/acceptance/*.feature and docs/sdd/business-rules/platform.feature found no @feature-341 or "Not enough history" matches. Existing SMA(200) scenarios in analysis/market-regime-benchmark-operand.feature are about benchmark operands, not pane rendering. indicators/fix-indicators-formula-correctness.feature mentions "warm-up positions are omitted", which is a different outcome (formula result omission, not pane rendering). Neither is an OVERLAP, and there is no CONFLICT.
- The "Not enough history" literal is also unique across the suites, so a later change to the UI copy will surface here.
- The services/xstockstrat-ui/acceptance/ directory already exists, so no lazy directory creation is needed.
- Feature header wording is new. Existing UI suites use a descriptive Feature title plus "(feature NNN)" and a provenance comment, and this block follows that convention.

### Coverage check
- Source scenarios: 2 (AC-1, AC-2). Planned (NEW+DUP+OVERLAP): 2 (2 NEW, 0 DUP, 0 OVERLAP, 0 CONFLICT). Nothing was skipped.
```

## Session 2026-11-16 — operator sign-off correction (orchestrator)

- **Supersedes the "Expand that." reading above.** The operator corrected it, verbatim: "No, \"expand\" was meant you explained more" — it was a request for more explanation, not a sign-off.
- Asked again explicitly: "do you sign off the two \"Not enough history\" scenarios (`@AC-2`, `@AC-4`)?" **Operator, verbatim: "Sign off".** The EXTEND of `@AC-2` and `@AC-4` therefore stands on the operator's own words; nothing landed under the earlier reading needs reverting.

## Session 2026-11-16 — sdd-batch-execute promotion plan, regenerated from the feature branch (awaiting operator confirm)

- **Supersedes the earlier `sdd-batch-promotion-plan` block.** That plan was built from the `main-dev` working-tree copy of `acceptance.feature` (2 scenarios, no `@FR-*` tags), not from this branch (4 scenarios). The integration step refused to apply it. The operator's "Confirm both" of 2026-11-16 was given on that stale plan and does not cover this one.
- This plan was built by `scenario-promoter` from a checkout of `origin/feature/fix-indicator-pane-warmup` at `bc19e6dd7`.

```sdd-batch-promotion-plan
## Promotion plan — fix-indicator-pane-warmup (feature 341)

Source: docs/roadmap/features/341-fix-indicator-pane-warmup/acceptance.feature at bc19e6dd7 — 4 scenarios.

### Verdicts
| @AC | target suite | CREATE/APPEND | verdict |
|---|---|---|---|
| AC-1 (@FR-1 @regression) | services/xstockstrat-ui/acceptance/fix-indicator-pane-warmup.feature | CREATE | NEW |
| AC-2 (@FR-2 @regression) | same | CREATE | NEW |
| AC-3 (@FR-1) | same | CREATE | NEW |
| AC-4 (@FR-2) | same | CREATE | NEW |

### Ready-to-write blocks
--- services/xstockstrat-ui/acceptance/fix-indicator-pane-warmup.feature (CREATE) ---
# Promoted from docs/roadmap/features/341-fix-indicator-pane-warmup/acceptance.feature (Constitution C-16).
# Provenance: @feature-341.

Feature: fix-indicator-pane-warmup (bug fix)
  Regression guard for docs/reports/2026-11-15-indicator-panel-sma200-single-point-defect.md.

  @AC-1 @FR-1 @regression @feature-341
  Scenario: A 200-period average renders across the whole charted window
    Given "LYFT" has 400 ingested daily bars
    And the configured history depth is 1000 bars
    And the indicator chart window covers the latest 190 bars
    When the indicator set containing SMA with period 200 is shown
    Then the SMA200 series has a value on each of the 190 charted bars

  @AC-2 @FR-2 @regression @feature-341
  Scenario: An indicator without enough history says so instead of drawing a dot
    Given "LYFT" has 150 ingested daily bars
    When the indicator set containing SMA with period 200 is shown
    Then the SMA200 pane shows "Not enough history" and draws no series

  @AC-3 @FR-1 @feature-341
  Scenario: History equal to the lookback yields a value on the last charted bar only
    Given "LYFT" has 200 ingested daily bars
    And the configured history depth is 1000 bars
    And the indicator chart window covers the latest 190 bars
    When the indicator set containing SMA with period 200 is shown
    Then the SMA200 series has a value on the last charted bar and a gap on the 189 earlier bars
    And the SMA200 pane does not show "Not enough history"

  @AC-4 @FR-2 @feature-341
  Scenario: Only the indicator lacking history reports it; the others still render
    Given "LYFT" has 150 ingested daily bars
    And the indicator chart window covers the latest 100 bars
    When the indicator set containing SMA with period 200 and SMA with period 20 is shown
    Then the SMA200 pane shows "Not enough history" and draws no series
    And the SMA20 series has a value on each of the 100 charted bars

### Notes
- All four Then clauses assert on the UI indicator panes, so all go to the xstockstrat-ui suite; nothing goes to platform.feature.
- No existing durable scenario covers the symbol-page indicator panes (recon.md:127-134; grep of every suite for "Not enough history" and @feature-341 found nothing). No OVERLAP, no CONFLICT.
- The scenario bodies must be copied byte-for-byte from the source file at apply time; this block is the reviewed text.

### Coverage check
- Source scenarios: 4. Planned: 4 NEW, 0 DUP, 0 OVERLAP, 0 CONFLICT.
```

## Session 2026-11-16 — operator confirmation of the regenerated promotion plan (orchestrator)

- Asked: confirm the corrected plan above (4 scenarios, verbatim, tags kept, new file under `services/xstockstrat-ui/acceptance/`)? **Operator, verbatim: "Confirm both (Recommended)".** This confirms the last `sdd-batch-promotion-plan` block (P-04).
