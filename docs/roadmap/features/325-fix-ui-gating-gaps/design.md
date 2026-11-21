# Design: fix-ui-gating-gaps

**Created**: 2026-11-20
**Rounds**: 5 (full; termination: approved)
**Approved by**: operator @ 2026-11-20. Approved on the operator's behalf under the standing authorisation recorded the same day (adversary verdict SOUND, no Floor breach, no blocking objection, every C-16 CHANGE covered by an operator ruling).
**Grounded in**: recon.md
**Debate register**: debate.md

---

## Chosen Approach

One UI-only PR in `services/xstockstrat-ui`, with no proto, migration or config change (recon.md:76-80).
It has two independent units and rests on D-1 to D-10 in debate.md.
The consumer surfaces are the config-ui namespace editor (`/config-ui/<namespace>`) and the insights
watchlist detail (C-14). No Agent tool is touched.

Cites to `xstockstrat-marketdata` and `xstockstrat-analysis` code below are outside recon.md. They are
the debate's evidence (D-7 to D-10) and the spec must re-cite each one at the step SHA.

### Unit 1: namespace-editor gate (D-1)

- `src/app/config-ui/[namespace]/NamespaceEditor.tsx` derives `editGate` (`'loading' | 'edit' | 'readonly'`)
  from `useIsAdmin()` and the `['auth-me']` userId (`src/hooks/useLiveStrategies.ts:42-70`; reuse pattern
  at recon.md:46-47).
- The gate is threaded through `EditState` the same way `isNativeEnv` is (`NamespaceEditor.tsx:38-60`,
  `:293-316`; uses at `:48`, `:144`, `:174`, `:303`; recon.md:25-28, 48).
  `COLUMNS` stays at module scope (`:193-195`; recon.md:27).
- `loading` disables the Actions trigger.
- `readonly` (identity settled, not an admin) hides the trigger and shows one `CardNotice` reading
  "Admin only: read-only view" (recon.md:49).
- `edit` applies to an admin, and also when `/me` fails (fail-open). `requireAdminScope`
  (`src/lib/configUiBff.ts:39`; recon.md:31) stays the authority.
- The Edit item at `NamespaceEditor.tsx:164` is the only SetConfig entry point (recon.md:22).

### Unit 2: membership drain (D-2 to D-6)

- `useQueueMembership()` goes in `src/hooks/useOpportunities.ts` (recon.md:37) as a plain `useQuery`
  under the key `['opportunities','membership']`. The empty-symbol page-1 key shared with CopilotRail is
  untouched (recon.md:38, 85).
- It reads its request params from `QUEUE_DEFAULT_FILTERS`, hoisted and exported from
  `useOpportunities.ts:26-29` (D-4). The Opportunities page's UI-token state is deliberately not coupled.
- It sends `pageSize` 1000 and follows `nextPageToken` up to `MAX_MEMBERSHIP_PAGES = 3` (D-3).
- It returns a sorted, unique, upper-cased `string[]` (R-5).
- It throws on `computing`/`computeFailed` with `retry: false`, so the previous data is kept.
- It is enabled only when the watchlist has at least one bound row.
- The cadence stays at 15 s (D-2; P-1 declined).
- `WatchlistReadiness` consumes it (`src/components/insights/WatchlistReadiness.tsx:299`; recon.md:35).
  `src/components/insights/WatchlistDetail.tsx` drops `useOpportunities()` (`:74`), the Set (`:93-95`)
  and the `inQueue` prop (`:369`) (recon.md:33-34).
- RPC delta (D-6): the watchlist page goes from 1 to 2 `ListOpportunities` per poll only when the
  Copilot rail is toggled on. Otherwise it stays at 1.

### Tests

- AC-1 RED: a non-admin opens the namespace editor and no Edit action is offered. A second case covers
  an admin whose `/me` returns 5xx (fail-open). Auth helpers and regression models are at recon.md:51-52.
- AC-2 RED follows D-5. A per-test `page.route` honours `pageSize` and an integer-offset `pageToken`.
  - Case A: a 70-row queue with the target symbol at index 60. The request count includes only requests
    whose JSON body has `page.pageSize == 1000` (`src/lib/browserClients/transport.ts:57`), in a window
    that ends before the first 15 s refetch.
  - Case B: a queue beyond 1000 rows, to cover following the token and the page cap.
  - Recompute-dependent assertions drive an in-place refetch, never `reload()` (recon.md:92).
- Re-run `e2e/insights/watchlists.spec.ts` in-queue cases (recon.md:87). New fixtures are registered in
  `e2e/fixtures/INVENTORY.md` (C-12/C-13).

### Build order

1. Unit 1 plus its RED e2e tests.
2. Hoist `QUEUE_DEFAULT_FILTERS` and add the hook.
3. Swap the consumer, plus the AC-2 RED tests.
4. Re-run the sibling watchlist specs and record fixtures.

### O-5 cost text the spec carries

This text is operator-accepted (D-9, D-10). It replaces the earlier "780 per market day" text everywhere.

**(a) Baseline (D-8).** Enrichment covers only the returned window
(`services/xstockstrat-analysis/app/handlers/servicer.py:4744-4749`). The page-1 read at
`WatchlistDetail.tsx:74` already warms ranks 1 to 50, and the drain replaces that read. New warm entries
are therefore at most the rows ranked 51 and lower. This is a row count. New distinct symbols are at most
that many, minus symbols already warm under D-7.

**(b) Per-recompute snapshot.** Per viewer u the term is max(0, Q_u − 50), where
Q_u ≤ max(max_universe_size, |curated_u| + |muted_only_u|). The cut is at `servicer.py:5627-5639` and the
speculative tail is sorted by `signal_axis` at `:5637`. At the default the term is
max_universe_size − 50 = 50.

**(c) Bound over time, as accepted.** |W_new| is a union since the last marketdata restart over every
tail any viewer has drained. V means distinct viewers since boot.

- `markWarm` only adds (`services/xstockstrat-marketdata/internal/service/marketdata_service.go:1171-1177`).
- Removals are the first-load unservable prune, the feature-352 flagged-delisting removal, or a restart.
- The ceiling is the servable symbols that, since boot, carried an active signal for, or were curated or
  muted by, any watchlist viewer. There is no structural bound below that universe until restart.

**(d) Cost per newly warm symbol per calendar day.** Both pollers run 24/7
(`marketdata_service.go:1194-1231`, `:1306-1332`). The accepted total is |W_new| × (2,880 + 288), on
marketdata's 2-connection PgBouncer client pool.

1. Quote upserts: 2,880 statements per day, one sequential `cacheQuote` per 30 s cycle (`:1246-1252`).
   `InsertQuote` is `ON CONFLICT (symbol, time) DO UPDATE`
   (`internal/repository/marketdata_repo.go:299-304`). Retained rows are at most 2,880 × 90 per symbol,
   and in practice the distinct vendor quote timestamps.
2. Bar cycles: 288 per day. Each 5-min cycle adds one symbol to `GetBarsMulti` and, when bars come back,
   one `InsertBars` call (`:1382-1383`, `:1425-1432`). `InsertBars` is one transaction with one INSERT per
   bar (`marketdata_repo.go:77-111`), about 2 to 3 daily bars per cycle. The 288 therefore counts
   transactions, about 576 to 864 row upserts into `marketdata.ohlcv`. Feature 291's dead-symbol hold
   (`internal/service/bar_hold.go:47-77`) drops symbols that keep returning nothing.
3. FMP classification: 0 while `marketdata.classification.enabled=false`. When true, one `FetchSector`
   per symbol per 24 h against the shared 250/day cap (`classification_service.go:82`, `:199-200`), which
   is |W_new|/250 of the budget.

The figures scale linearly with `stream.warm_interval_ms` and `stream.bar_ingest_interval_ms`. Each extra
bar-ingest timeframe adds another 288.

**(e) Caveats, as listed in the ruling.**

- `GetBarsMulti` paginates once the warm set passes about 330 symbols in total (limit 1000 bars at about
  3 per symbol; `internal/alpaca/client.go:672-674`, `:708-711`).
- The FMP 250/day cap is a tripwire.
- `GetSymbolServability` fails open before the first asset load, so unservable symbols can warm in that
  window.
- O-9 residual: if the multi-quote call fails, the fallback makes one vendor call per warm symbol every
  30 s. Re-cite at the step SHA.

**(f) Tripwires.** Re-check the bound before changing either key:

- `marketdata.classification.enabled = true`;
- `opportunity.max_universe_size` (namespace `analysis`) > 100. It is SetConfig-bounded to [1,1000], and
  at 1000 the per-viewer term is about 950. The spec uses this one key name everywhere (O-20).

**(g) Watch signals, checked on dev after deploy.** `marketdata.db.pool.{acquired,empty_acquire_wait}` and
`marketdata.ohlcv.out_of_memory_errors{op=insert_bars}` (`docs/runbooks/ohlcv-lock-budget-tuning.md`).

**(h) Records and follow-up.**

- Add a row to `services/xstockstrat-marketdata/docs/context-constitution-findings.md` covering warm-set
  growth and the classification-flag exposure.
- Reference a follow-up feature for a marketdata warm-set TTL prune, numbered by
  `scripts/sdd-allocate-feature-number.py` at spec time. It is out of scope here.

### Payload (O-11, still open)

Bytes per poll are rows × B_row, with rows ≤ max(max_universe_size, |curated| + |muted_only|) against 50
or fewer today. B_row must be measured at spec time from a dev BFF JSON `ListOpportunities` body.
`/sdd-review impl-spec` checks that the spec carries the measured figure.

### Spec-text items carried from round 5 (non-blocking, binding on the spec)

- O-18: keep "2,880 upsert statements per day". Replace "about 259k rows per symbol" with "at most
  2,880 × 90 rows; in practice the distinct vendor quote timestamps".
- O-19: keep the accepted 2,880 + 288 figures and label the 288 as transactions, each about 2 to 3 row
  upserts.
- O-20: one tripwire key name, the namespace-relative `opportunity.max_universe_size` (namespace
  `analysis`).

## Rejected Alternatives

- `R-1` Per-symbol `ListOpportunities{symbol}` fan-out (`useQueries` over the visible page) — rejected
  because empty per-symbol reads reach `kick_full` (`servicer.py:4762-4764`), so every poll starts a full
  per-user recompute for dismissed or snoozed symbols. It also reintroduces the client fan-out that
  feature 181 removed.
- `R-2` Admin gate `canEdit = isAdmin && !adminLoading` (fail-closed on `/me` failure) — rejected because
  a transient `/me` non-ok maps to `isAdmin=false` for 5 min and blocks real admins (regresses
  `@AC-10/11/12 @feature-219`; fails.md 2026-08-21).
- `R-3` Proto/analysis-side fixes for in-queue (`in_queue` on `WatchlistReadinessRow`, a multi-symbol
  filter, suppressing the kick on symbol reads) — rejected because they escalate scope and design depth,
  or change Signal-detail behaviour (`@AC-15 @feature-215`), when a UI-only bounded drain fixes the defect.
- `R-4` Draining membership in pages of 50 with a page cap of about 20 — rejected because each call
  re-reads every row server-side (`servicer.py:4715-4717`), so it costs N full DB reads per poll and
  widens the window for a multi-page race.
- `R-5` Storing `Opportunity` objects as the membership query data — rejected because the normy
  normalizer rewrites objects that carry a `strategyId` (`queryClient.ts:5-11`). A `string[]` avoids that
  and keeps a stable reference.

Considered in round 5 and not taken. These have no `R-n` row, because the round added none:

- P-1, lowering the membership cadence to 60 s or to refocus plus invalidation only — declined by the
  operator, who accepted the O-5 bound instead. By D-7 cadence moves none of the warm-set, quote, bar or
  FMP figures.
- A marketdata-side warm-set TTL prune inside this PR — it is the structural fix, but it puts a
  cross-service change into a SEV-3 UI-only fix. The spec references it as a follow-up feature.
- Restating the accepted bar cost in rows instead of cycles — it would change the figures the operator
  accepted. The spec keeps 288 and adds the rows-per-transaction multiplier.
- Suppressing read-time enrichment for membership reads — it needs a proto/analysis request flag, which
  `R-3` rules out.

## Open Risks

- [ ] The accepted bound has no ceiling below the servable signal-symbol universe until marketdata
  restarts. Each extra warm symbol adds 2,880 quote upserts and 288 bar transactions per day on a
  2-connection pool — spec carries the cost text; structural fix is the follow-up TTL-prune feature.
- [ ] The accepted total was worded as "write statements", but the 288 bar cycles are transactions of
  about 2 to 3 INSERTs each. Real statement volume is about 3,456 to 3,744 per symbol per day, 9 to 18%
  above the 3,168 headline. This is a label fix, not a changed bound — the operator should see the
  relabel in the spec (O-19), checked at `/sdd-review impl-spec`.
- [ ] The bar upserts land on `marketdata.ohlcv`, which has a recorded lock-table exhaustion risk. The
  pool gauges and `out_of_memory_errors{op=insert_bars}` detect saturation after the fact and do not
  prevent it — checked on dev at the post-deploy verification step.
- [ ] Two live-tunable keys can break the bound: `marketdata.classification.enabled = true` spends the
  shared FMP 250/day budget, and `opportunity.max_universe_size` toward 1000 lifts the per-viewer term to
  about 950. The UI has no guard for either — recorded in the marketdata findings row at the docs step.
- [ ] The about-330 `GetBarsMulti` pagination threshold and the O-9 fallback lines were not re-derived in
  round 5 — re-cite both at the step SHA in `/sdd-spec`.
- [ ] The C-16 sign-off for `@AC-1` and `@AC-2` rests on the recorded operator ruling of 2026-11-20
  (context.md:507, 730). The operator's relayed words cover only the O-5 bound — confirm at the
  `/sdd-spec` gate if the operator wants it restated.
- [ ] B_row for the payload figure is unmeasured, so the per-poll byte cost is unknown (O-11) — measured
  in `/sdd-spec`, checked at `/sdd-review impl-spec`.
- [ ] If the queue exceeds 3,000 rows, badges past the cap are silently dropped. The badge is a cue, not
  an authority — stated in the hook step.
- [ ] Fail-open shows an enabled Edit trigger to a non-admin when `/me` fails. The BFF rejects the write,
  so its error must be legible — covered by the Unit 1 e2e step.

## Constitution Rules Touched

- `C-01` — honored by: every claim cites recon.md or a `path:line` from the debate evidence. The spec
  re-cites the marketdata and analysis lines at the step SHA.
- `C-11` — honored by: Track C bug through recon, a five-round full debate and this design before any code.
- `C-12` / `C-13` — honored by: AC-2 fixtures come from `e2e/fixtures/` and are registered in
  `INVENTORY.md`; the per-test `page.route` serves inventory data.
- `C-15` — honored by: `@AC-1` and `@AC-2` each get a RED e2e test (AC-1 non-admin; AC-2 Case A and B).
- `C-16` — honored by: the section below. Both CHANGE lines carry the operator ruling.
- `C-17` — honored by: the read-only state uses the `CardNotice` primitive and the existing in-queue
  `EnumBadge`. No new color or component.
- `C-18` — honored by: one hook and one context flag. No proto, no new abstraction, one hoisted const
  instead of repeated literals (D-4).
- `P-02` — honored by: proposer and adversary saw only the synthesized state each round.
- `P-03` — honored by: unmeasured or un-re-derived items (B_row, the 330 threshold, the O-9 lines) are
  listed as Open Risks and not guessed.
- `F-06` — honored: no pool size changes and no new DB-backed service. The added write load runs on
  marketdata's existing 2-connection PgBouncer client pool and is the operator-accepted O-5 cost.
- `F-07` — honored: no config value is hardcoded and no key is added. The drain's page size and page cap
  are request-shape constants in the hook, not operator-tunable settings.

## Business Rules Touched (C-16)

recon.md:71-72 classed this feature's own scenarios as EXTEND with no CHANGE. The debate reclassified
them as CHANGE, because each alters what the user is guaranteed to see on an existing surface.

- CHANGE `@AC-1` "A non-admin sees no working Edit affordance in the config-ui namespace editor"
  (feature 325 `acceptance.feature`; promotes into `services/xstockstrat-ui/acceptance/config-ui-usability.feature`)
  — altered guarantee; signed off by the operator @ 2026-11-20 (C-16 ruling for `@AC-1` and `@AC-2`,
  context.md:507, 730 and the 2026-11-20 sdd-design approval session).
- CHANGE `@AC-2` "A watchlisted symbol ranked below the first opportunity page shows as in queue"
  (feature 325 `acceptance.feature`; promotes into `services/xstockstrat-ui/acceptance/watchlist-opportunity-signal-cues.feature`)
  — altered guarantee; signed off by the operator @ 2026-11-20 (same ruling).
- PRESERVE `@AC-10`, `@AC-11`, `@AC-12` `@feature-219` (`services/xstockstrat-ui/acceptance/config-ui-usability.feature`)
  — not regressed by: the gate is fail-open for admins and `COLUMNS` stays module-scoped, so the admin
  edit form keeps focus and Save still refreshes the row (`R-2`).
- PRESERVE `@AC-2`, `@AC-3` `@feature-181` (`services/xstockstrat-ui/acceptance/watchlist-readiness-list-ux.feature`)
  — not regressed by: one bounded query, no per-row client fan-out (`R-1`); a failed drain keeps the
  previous data and never blanks the list.
- PRESERVE `@AC-2`, `@AC-3`, `@AC-5`, `@AC-7` `@feature-187` (`services/xstockstrat-ui/acceptance/opportunities-pagination-drain.feature`)
  — not regressed by: `useOpportunities` defaults and the page-1 cache key are unchanged; membership
  uses its own key.
- PRESERVE `@AC-1` `@feature-213` (`services/xstockstrat-ui/acceptance/fix-copilotrail-duplicate-rpc.feature`)
  — not regressed by: the Opportunities page is untouched and still issues one page-1 RPC.
- PRESERVE `@AC-15` `@feature-215` (`services/xstockstrat-ui/acceptance/block-fundamentals-strategy-on-etf.feature`)
  — not regressed by: the symbol-filtered read and its server behaviour are untouched (`R-3`).
- PRESERVE the remaining recon rules (recon.md:57, 64, 65-70: `@AC-3 @feature-155`, `@AC-14/15 @feature-190`,
  the other `@feature-181`/`@feature-289` readiness rules, `@AC-9 @feature-156`, the read-only
  `@feature-219` rules and `@AC-6 @feature-161`) — not regressed by: the badge render, the server filter
  path, the BFF admin gate and read-only key display are all unchanged.
