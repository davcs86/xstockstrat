# Context: fix-marketdata-fundamentals-cache  (archived 2026-11-04)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-11-04 — /sdd-archiver

> Cite convention: `old context.md@1ed63958:N` is the pre-archive context.md (this file replaces it);
> `<file>@1ed63958:N` is a deleted spec (`git show 1ed63958:docs/roadmap/features/255-fix-marketdata-fundamentals-cache/<file>`).
> `path:N` without a SHA is the current tree (archive-time tree, origin/main-dev lineage); anchors that drifted are marked.

**What**: SEV-3 Track-C bundle of five marketdata defects from a debt-radar scan (D-19, D-50..D-53), shipped as 17 steps in
PR #1394 (promoted via #1406, launched 2026-11-04). Cap `<= 0` is documented as a zero budget (comments/docs only, no behaviour
change); the FMP boot seed and Finnhub window count only their own `source` rows; the vendor path refuses an edgar-axis cache
row as fresh; an undecodable `extra` column is WARN-logged; a failed FMP ratios/profile enrichment is classified, WARN-logged
(class only) and stored already-expired (`fetched_at='epoch'`) rather than cached fresh; the Alpaca stream manager counts
consecutive failures, has a cancellable backoff and closes subscribers on give-up. Acceptance promoted to
`services/xstockstrat-marketdata/acceptance/fix-marketdata-fundamentals-cache.feature` (AC-1..AC-10, verbatim + `@feature-255`).

**Why (irrecoverable rationale)**:
- Expire-on-write instead of skip-the-upsert: an enrichment failure that is cap-exceeded means the FMP budget is spent, so the
  fetched core (quote) row cannot be fetched again. Skipping the write makes the next at-cap call return `ResourceExhausted`
  (`marketdata_service.go` `count >= cap` gate) or serve an older row, a regression against @feature-215 @AC-7. The row is
  therefore stored but pre-expired via an `'epoch'` sentinel selected by `CASE WHEN $17::boolean`; a stale serve at cap still
  works and the next call with budget re-fetches (design.md@1ed63958:137-140, :209-211; old context.md@1ed63958:108-112).
- An epoch sentinel rather than a computed backdate: `UpsertFundamentals` hardcodes `now()`, so `now()-ttl-1s` or
  `now()-ttl+retry_window` needs a repo/interface signature change plus (for the window) a tunable (F-07); a fixed epoch needs
  neither (old context.md@1ed63958:247-249, :517-518).
- Class-only WARN (never `err.Error()`): the transport wrap is an `*url.Error` whose text carries `apikey=`. Logging only the
  class label removed 255's dependency on 254's D-39 fix, demoting 254 from hard predecessor to a soft rebase row
  (old context.md@1ed63958:313-316; 254 is now `launched`).
- Same-source COALESCE merge on a flagged overwrite (operator r3 (1)): without it an expired complete row re-fetched with a
  failed enrichment loses prior values (the conflict branch overwrote every enrichment column with `EXCLUDED`), and a later
  at-cap stale serve returns NULLs. The `fundamentals.source = EXCLUDED.source` guard stops edgar values being relabelled fmp
  (old context.md@1ed63958:325-330, :368-371, :515).
- Parenthesised seed predicate `source = $1 AND (fetched_at >= d OR as_of >= d)`: needed because an epoch-stamped fmp row would
  otherwise drop out of the "today" seed count (a deterministic enrichment failure would zero the boot seed). Unparenthesised,
  edgar rows (whose `as_of` defaults to the write instant) would be counted and D-51 would return
  (old context.md@1ed63958:372-375, :514). Depends on `AsOf: now` at the FMP write site (constraint comment + test).
- `stageError{stage, err}` (implementation-spec decision, not in design.md): `io.ReadAll` and `json.Unmarshal` errors share no
  type, so transport/read/decode stages cannot be told apart for the WARN class without a wrapper; `Error()` delegates so the
  text stays byte-identical and `Unwrap` keeps the ctx chain (old context.md@1ed63958:937-939).
- The D-53 fix applies to the snapshot path only, not `BackfillFundamentals` (@feature-198 @AC-5 preserved)
  (recon.md@1ed63958:133-136).

**Operator decisions (binding, only recorded in the old context.md)**:
- 2026-10-21/22 standing: "x-trace-id must be propagated as much as possible; no C-03 waiver — request-derived emits/writes use
  context.WithoutCancel(ctx) (Go) / the inbound metadata (Python/Node), never a fresh background context; only work with no
  originating request (background sweepers/loops) may mint its own context, and it should still carry a trace id when one is
  available." (old context.md@1ed63958:53)
- 2026-10-22 OQ-1: "marketdata.fmp.daily_request_cap <= 0 means ZERO BUDGET (FMP disabled), matching reserve(),
  enrichmentUnderCap(), TestBackfillFundamentals_CapDegrade_AC5, marketdata CLAUDE.md and feature 215. D-50 is fixed by
  correcting the misleading 'cap <= 0 = uncapped' comments ... and any doc saying otherwise — no behaviour change; a large cap
  means effectively uncapped." (old context.md@1ed63958:54)
- 2026-10-22 design gate r2: expire-instead-of-fresh applies to enrichment failures; no residual accepted for transient failures.
- 2026-10-22 design gate r3: (1) ADOPT the same-source COALESCE merge (row still stored expired); (2) EXEMPT deterministic FMP
  402/403/404 from expiry (cached fresh, honest `missing_metrics`; only cap-exceeded, cancel/deadline, 5xx, transport and decode
  expire); (3) ADOPT the parenthesised seed predicate with `fmp.SourceName` and the 30-edgar-rows test; (4) SIGN-OFF on the
  FR-4(b) rewrite, AC-5's first Then listing "beta" only, and the new @AC-10.
- 2026-10-22 design gate r4: "APPROVED as synthesized", including S (introduce `fmp.SourceName`/`finnhub.SourceName`, alias
  `classification.SourceFMP`, repo methods take source as a parameter) and the @AC-10 trigger pinned to an FMP HTTP 503 on profile.
- C-11 acknowledgement with r4: HTTP 400/401/429 and read-body failures are in neither the operator's expire list nor its exempt
  list; the design expires them; changing that is a one-line `switch` edit in `enrichmentExpires` (`fmp_client.go:306-326`).
- Accepted cost (operator r2): under a persistent 5xx/transport failure every request and every feature-224 fundsignal cycle
  re-spends the counted quote/ratios calls (only non-200 responses refund), reaching the cap earlier and starving the 215 ETF
  filler and 217 classification refresh; the hard cap bounds it. Remedy: `marketdata.fmp.metrics=core`. A bounded retry window
  stays open to the operator only as a future decision.
- 2026-10-22 post impl-spec review: enrichment errors with no stage (build-request error, non-ctx limiter error) get WARN class
  `other`; they still expire the row (old context.md@1ed63958:963-966).
- 2026-11-01 execute: "Do not hold" -> the merge-order 215 gate was waived by operator override (see Scars).
- Provenance note for feature-246 consumers: after a flagged merge a stale-served row carries today's `as_of`, prior-day
  enrichment values and an EMPTY `missing_metrics`; acceptable only because it is served `stale=true`
  (old context.md@1ed63958:847-848; FR-4(b) in product-spec.md@1ed63958:64-67).

**Rejected alternatives**:
- Source-id constant homes (design.md@1ed63958:193-198; old context.md@1ed63958:751-753): the repo importing `fmp` for the seed id lost because it inverts the dependency direction, so repo count methods take `src string`; two named constants (`fmp.SourceName` beside `classification.SourceFMP`) lost on DRY (one vendor id, two names), so one aliases the other; the fmp client importing `classification.SourceFMP` directly lost as the primary option because classification is an odd home for a snapshot-source id, and was kept only as the fallback if the alias created an import cycle. A later DRY pass must not make the repo import `fmp` again.
- Skip the upsert on enrichment failure (r1/r2, `edgarFinish` precedent) — lost: drops an unrefetchable core row; never-seen
  symbols get `ResourceExhausted` at cap (design.md@1ed63958:209-211). `edgarFinish` is not a matching precedent: an edgar
  snapshot is re-derivable for free; ledger fails.md:2290 ("memoize only successful reads") was over-applied.
- Narrow retryable class (cap/ctx only; 5xx/transport/decode cached fresh) — lost to operator r2 (no residual).
- Expire on every failure incl. 402/403/404 — lost to operator r3 (2): burns quota, starves 215 filler and 217.
- Exempt all 4xx except 429 — lost: beyond the operator's 402/403/404 list; a 401 (bad key) would stay cached fresh a TTL after the key is fixed.
- Exported HTTP-status error type from `getJSON` — first lost at r2 on the operator's "preserve as much as possible with low rework" instruction (it edits `fmp_client.go:243/:254`, which 254 also changes; old context.md@1ed63958:251, :284), then lost at r3 as "no consumer", then the unexported `*statusError` won once the 4xx exemption gave it a consumer.
- Bounded retry window `now()-ttl+N` — lost: needs a TTL-aware repo write or a tunable (F-07); operator mandated "already expired". A short fixed horizon for ANY failure would also cost about 3 reservations per symbol per hour on a deterministic 402 against the shared 250/day budget (old context.md@1ed63958:248).
- Backdate computed in the service — lost: repo hardcodes `now()`; needs a signature change.
- A marker in `extra_metrics` — lost: `ExtraMetrics` goes to the wire (`marketdata_service.go` `toProtoFundamentals`), leaks to agent/BFFs.
- Per-symbol error set from `GetFundamentalsMulti` / `FailedEnrichments []string` — lost: changes the `FundamentalsSource` interface and the Finnhub client; no consumer.
- Log raw `rErr`/`pErr`; one WARN per symbol per enrichment — lost: apikey leak; floods once the cap is hit mid-chunk (aggregated WARN follows the warm-quote-poller precedent).
- Detach only the upsert ctx — lost: `seedFromProfile`/`maybeAlertQuota` in the same block would still die on a cancelled ctx.
- Make 254 a hard predecessor — lost: gates a SEV-3 on a draft feature; class-only logging removes the need.
- Unconditional cross-source COALESCE; unparenthesised seed OR; accept the seed under-count — lost (see Why).
- Seed the FMP budget with the *active provider's* rows — lost: under the finnhub boot default it would seed FMP with Finnhub rows (AC-3 requires FMP-source rows).
- Skip edgar rows in the stale serve (D-52) — lost: visible @feature-215 @AC-7 regression; stale serves are unchanged.
- `(source, fetched_at)` index (migration 010) — lost: one row per symbol; `idx_fundamentals_fetched_at` suffices (F-01).
- Add `sector` to `missing_metrics` — lost: `sector` is a string, not a metric pointer; changes documented canonical names (`marketdata.proto:213-218`). AC-5 lists `beta` only.
- Pass `s.fundProvider` for the Finnhub window count — lost to `finnhub.SourceName`.
- D-19: reset counter on reaching the connected log — lost: an auth failure arrives as an `error` frame after subscribe, so healthy is keyed on the `subscription` ack; dialer interface — lost to a `streamURL` field; classification-spend count in the seed — lost (YAGNI; "floor" wording in CLAUDE.md instead).

**Scars & gotchas**:
- Phantom symbol survived design rounds r1-r3: `fmp.SourceName`/`finnhub.SourceName` were cited as existing in every synthesis
  until the r4 adversary grepped and found only bare literals (`Source: "fmp"`, `Source: "finnhub"`) and
  `classification.SourceFMP`. S was added so the spec would not carry a phantom symbol (F-04)
  (old context.md@1ed63958:586-590). Shipped: `fmp.SourceName` (`fmp_client.go:24`), `finnhub.SourceName`
  (`finnhub_client.go:20`), `classification.SourceFMP = fmp.SourceName` (`classification/sector.go:19`).
- The `ctx` WARN class is nearly dead by construction: a cancelled ctx fails `fetchQuotes` first, which becomes a whole-call error
  (design-time `marketdata_service.go:1703-1704`/`:1759-1760`), so the cancel/deadline members are rarely reached. They were kept
  because they cost nothing, but the predicate must stay one `errors.Is` set (C-18); do not "simplify" the ctx branch away
  (old context.md@1ed63958:156, r2).
- Recorded C-18 literal waivers, not misses: the fallback `"fmp"` (`marketdata_repo.go:587` at design time, `:599` at HEAD) and the
  `"finnhub"` literals in the service provider switch (`:1931/:1951` at design time, `:1966/:1986` per the impl-spec, `:1970/:1990` at HEAD)
  were judged "not on this fix's path" (design.md@1ed63958:40-41; old context.md@1ed63958:571), so a later DRY pass should not read them as an omission.
- Build scar (Step 15 RED probe): before the `streamURL` seam existed, the probe pointed the hardcoded `wss://` URL at an `httptest`
  websocket server by swapping `http.DefaultClient.Transport` (coder/websocket dials through it when `DialOptions` is nil), so the same
  probe compiled against old and new code. Reusable trick (implementation-spec.md@1ed63958:1243-1246).
- sloglint flags `slog.Warn` inside any function holding a `ctx`, which forced the moved boot-seed WARN to `slog.WarnContext`
  (implementation-spec.md@1ed63958:1107-1109).
- In-code claim vs reality: `marketdata_repo_test.go:186` says the seed predicate's "semantics are live-DB tested", but the live-DB test skips in CI (see Permanent deviations).
- Test-only import cycle: once `classification` imports `fmp`, an in-package `fmp` test cannot import `classification`; the alias
  assertion lives in `internal/classification/sector_test.go` (old context.md@1ed63958:934-936).
- Repo reads went through `r.pool`, not the pgxmock-able `r.db`; Steps 5/9 switched `GetFundamentals` and both count methods to
  `r.db` (same pool in production) (old context.md@1ed63958:896-897).
- RED could not be shown against committed code for most test steps because the paired production step landed first
  (service-then-test pairs: 3/4, 5/6, 7/8, 9/10, 11/12, 13/14, 15/16). RED was captured by temporarily restoring the prior
  commit's production file or by a throwaway mutation, never committed. The Step 14 AC-5/AC-10/merge/4xx service tests were
  GREEN even under that revert because the store contract lives in `fakeFundRepo` (now models the epoch stamp and the COALESCE
  merge); only the pgxmock SQL pins and cancel-survival subtests went red (implementation-spec.md@1ed63958:1217-1222).
- The un-wrapped transport return in `getJSON` is unreachable through `http.Client` (`Do` always returns `*url.Error`); it is
  pinned at the classifier in `TestEnrichmentClassifier_StagesAndOther` (implementation-spec.md@1ed63958:1185-1196).
- `GetFundamentals`-path context fix: one `wctx := context.WithoutCancel(ctx)` per write/emit block (`marketdata_service.go:1743`,
  `:1800` at HEAD); upsert, WARN, `seedFromProfile`, `maybeAlertQuota`, `quotaCountAfterFetch` all use it. `classification_service.go` deliberately untouched (C-18).
- The pre-existing seed SQL compares `timestamp` (`now() AT TIME ZONE 'UTC'`) with `timestamptz` columns; the new `as_of` arm
  inherits the session-TZ dependence (`marketdata_repo.go:673-682`). Left alone on purpose (design 5.8); never made explicit.
- Worktree/tooling (execute): husky could not fire (main worktree has no `node_modules`; `core.hooksPath` pointed at a missing
  `.husky/_`), so `pnpm install --frozen-lockfile --ignore-scripts` ran per worktree and `.husky/pre-commit` was run by hand on
  each staged set. Every step used the operator-approved CI-equivalent `/usr/local/bin/golangci-lint` v2.14.0 fallback and an
  inline-expanded `COVERPKGS` (the session sandbox refuses a runtime-computed variable, implementation-spec.md@1ed63958:1116-1117) and a widened `go vet ./internal/...` instead of a literal `./internal/source/` argument (sandbox refuses it, :1175-1176); host Node was v22 vs the pinned 24. The Step 1 context-forge teardown was done by hand (the
  plugin skill was unavailable); the integration PR body was required to say both (implementation-spec.md@1ed63958:1060-1069).
  Whether PR #1394's body actually carried that note is NOT verified here.
- The /sdd-spec session deleted a pre-existing `cp.sh` from the shared workflow scratchpad, mistaking it for its own helper
  (old context.md@1ed63958:911-912). Transient; noted only for the record.
- The marketdata `CLAUDE.md:82` boot-seed wording (`source='fmp'`) was written in Step 1, four steps ahead of the code (Step 5).

**Permanent deviations (shipped contradicts design.md)**:
- design said six WARN classes `cap/ctx/http_<code>/transport/read/decode` (design.md@1ed63958:116) -> shipped a seventh,
  `other`, for stage-less errors (`enrichmentClass` default, `fmp_client.go:329-345`) -> because the build-request error and a
  non-ctx limiter error ("would exceed context deadline") fit none of the six; operator chose `other` after the impl-spec
  review (old context.md@1ed63958:949-952, :963-966). They still expire the row.
- design said a seed test with 30 edgar rows whose `as_of` is today expects 0, plus epoch-stamped fmp rows counted, and "one
  real-Postgres `DB_PGBOUNCER=true` epoch-branch upsert test" (design.md@1ed63958:154-156) -> shipped: the only CI-visible pin of
  the parenthesised predicate is a pgxmock regex on the SQL TEXT (`marketdata_repo_test.go:187-209`, regex at `:195`, which fails if the parentheses are dropped but proves no runtime semantics: not the `$17::boolean` wire bind under `QueryExecModeExec`, not the COALESCE merge result, not the epoch read-back, not the timestamp/timestamptz comparison); the semantic proofs (30
  edgar rows -> baseline count, epoch row counted, `$17::boolean` bind under `QueryExecModeExec`) live only in
  `internal/repository/fundamentals_livedb_test.go`, which `t.Skip`s when `DATABASE_URL` is unset and has no build tag ->
  because no Postgres was available in the execute environment, and CI's Go job (`ci.yml:287-301`) never sets `DATABASE_URL`,
  so the test SKIPs there too. The live-DB seed assertion is also a delta from a baseline rather than the spec's absolute
  `== 0`/`== 1` (shared DB may hold today's fmp rows) (implementation-spec.md@1ed63958:1213-1233).
- design said extract the boot seed into `SeedFMPBudget` (design.md@1ed63958:65-69) -> impl-spec and shipped unexported `seedFMPBudget`
  in package `main` (`cmd/server/main.go:262`; implementation-spec.md@1ed63958:295, :343, :379; `main_test.go` is package main) -> no reason for the rename
  was recorded; later docs (merge-order.md:96, and 230's context/design/recon/impl-spec) still say `SeedFMPBudget`.
- Addition, not a contradiction (implementation-spec.md@1ed63958:1241-1242): design Step 6 said `closeAllLocked` plus the `add()` goroutine closing only subs it still owns;
  shipped adds a shared unexported `closeSubLocked` helper (`stream.go:154`) so the two close paths are not two copies (C-18); no behaviour beyond design.

**Cross-feature signal**:
- 230-fix-etf-flag-fill (launched) was narrowed to land after 255 (255's D-51 fixes its root cause) and now depends on 255's
  classifier: `fmp.ErrorClass` (`fmp_client.go:347-348`) was added by 230 (not 255; merge-order.md:96 says 230 exports 255's `enrichmentClass`) and wraps it, consumed at `internal/service/etf_flags.go:162`.
  Any change to `enrichmentClass` labels is a change to 230's bounded log-class set (`etf_flags.go:219`).
- 246-fix-fundsignal-neutral-score (launched) benefits from honest `missing_metrics`; see the provenance note above.
- 254-fix-marketdata-secret-exposure (launched) rewrote `getJSON` before 255 executed (re-spec 2026-11-01: transport now wraps only the
  inner cause at two return sites; `stageError{"transport"}` wraps both).
- 215-block-fundamentals-strategy-on-etf: 255's cap-0 reading agrees with 215; the 215 merge-order gate was waived (see Scars).
  215's `status.md` still reads `in-progress` at HEAD (only post-deploy Step 26 was pending per old context.md@1ed63958:1433-1435).
- Pattern: a debt-radar scan grouped by service+theme and routed Track C (precedent #1264) produced a 17-step bundle mixing an
  unrelated stream-manager fix (D-19, FR-5) with the fundamentals cache; sequenced as an isolated last step to limit rebase risk.

**Deferred follow-ons**:
- StreamBars/StreamQuotes RPC clients still hang after a manager give-up (`marketdata_handler.go:37-54`); AC-8 holds at the manager
  level only. No defect report or feature found for it at 1ed63958 or HEAD.
- D-19 reconnects forever at a fixed delay when the server acks then drops; accepted. Runner-up if disputed: a minimum session duration.
- D-19 healthy-session detection assumes Alpaca sends `subscription` only after a successful auth+subscribe (unverified against the live feed; no in-repo consumer starts a stream).
- Live-DB proof of `$17::boolean` under `DB_PGBOUNCER=true`, the epoch read-back and the source-filtered seed count was never run in CI;
  old context.md@1ed63958:1230-1231 said "run it against a migrated staging DB before launch" and no record of that run was found.
- 403 classed as deterministic may be transient at FMP (suspended key, per-minute limit): pinned fresh with missing metrics for one TTL;
  visible as `http_403` in the WARN (test comment marks it the operator-sanctioned Open Risk).
- Finnhub `GetFundamentalsMulti` dropping per-symbol errors (debt-radar NC-F, unconfirmed) was put out of scope; product-spec.md@1ed63958:149 is the only place the pointer lives.
- Class-only WARNs lose detail (HTTP status text, decode cause) — a later feature could log `urlErr.Err` now that 254 has landed.
- Under the finnhub provider the FMP boot seed reads ~0 (mid-day restart re-grants the full cap); classification spend and `edgar+fmp`
  rows write no counted row; documented as a "floor" in marketdata `CLAUDE.md:82`.
- The `timestamp` vs `timestamptz` seed-query comparison (session-TZ dependence) remains.
- Defect report `docs/reports/2026-10-21-marketdata-fundamentals-cache-defect.md` (pruned 2026-11-04; git show 9892b610:docs/reports/2026-10-21-marketdata-fundamentals-cache-defect.md) has sidecar `triaged`, `ref: feature:255-...`;
  the fix is launched, so it is prunable by /sdd-archiver reports mode.
- Stale-state: old context.md@1ed63958:909-910, :953, :983-984 said the merge-order rows were "still pending an operator yes"; they exist now
  (`docs/roadmap/features/merge-order.md:90` 255 after 215, with the soft 254 note, Resolved `No`; `:96` 230 hard-blocked on 255, Resolved `No`).
  Both rows' Resolved column still reads `No` although both features are launched (and the 215 gate was waived). Row :90 also says
  "(operator yes, 2026-10-22)", contradicting the old context.md's "still pending an operator yes".

**Ledger entries written**: insights.md (1), fails.md (1) — see the 2026-11-04 entries.
**Runtime-invariant recommendations (→ /context-constitution)**:
- MARKETDATA-*: `fundamentals.fetched_at = 'epoch'` is a sentinel meaning "stored but already expired because an enrichment failed"
  (`UpsertFundamentals`, `marketdata_repo.go:~606`); the column is repo-only and not on the wire, so no consumer may display it; the
  "today" quota count therefore ORs `as_of` (which must equal the fetch instant, `fmp_client.go` `toFundamentals`) so expired rows stay counted.
- MARKETDATA-*: enrichment WARNs log a class label only, never the error text (`*url.Error` carries `apikey=`); the label set is bounded and
  shared with 230 via `fmp.ErrorClass`.
- MARKETDATA-*: the FMP day budget is shared by snapshot fundamentals, ratio enrichment and classification; `daily_request_cap <= 0` is a zero budget on every path.
**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 1ed63958.
