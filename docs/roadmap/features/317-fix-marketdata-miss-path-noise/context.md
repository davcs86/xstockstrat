# Context Log: fix-marketdata-miss-path-noise

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-10 (/sdd-triage)

- Bug reported via defect reports (clustered triage):
  - docs/reports/2026-11-04-cancel-warn-remaining-sites-defect.md (SEV-3, confidence low)
  - docs/reports/2026-11-04-marketdata-getbars-miss-path-refetch-every-call-defect.md (SEV-3, confidence low)
- Cluster rationale: both are repeated WARN noise in marketdata's `GetBars`/ingest paths (and portfolio's matching
  cancel sites) left over by features 290/282, fixed with the same log-once / don't-log-on-cancel pattern.
- Severity: SEV-3 (highest of cluster)
- Routed to SDD path (Track C). Both reports asked for a Loki re-check after 290 / 282 land; both are now launched —
  the re-check is Open Question 1.
- Created: status.md, feature.md, product-spec.md, acceptance.feature (2 regression scenarios), context.md
- Affected services (from reports): xstockstrat-marketdata, xstockstrat-portfolio
- Root cause hypothesis: per-item failures logged without consulting ctx; no negative cache on the GetBars miss path.
  Warm-poller site now logs at Debug (marketdata_service.go:1239,1263) — may already be resolved.
- Recommended design depth: full → `/sdd-design fix-marketdata-miss-path-noise` (rationale: 2 affected services escalate per rubric; low
  confidence / unverified flood per site)
- Development branch: feature/fix-marketdata-miss-path-noise

## Session 2026-11-10 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings: bug-template conventions (no FR-N/@FR tags; no Consumer Surface section); AC-1 covers only the GetBars site (GetLatestQuote, bar-ingest, portfolio consumer sites uncovered); possible negative-cache TTL key needs full contract; Loki recheck (OQ1) decides which sites are live
- Overlap findings: WARN: marketdata shared with 320/322/323/326; portfolio shared with 311/312/315/326
- Recommended design depth: full (marketdata + portfolio)
- Tree: ccr-500a9eb9-nvk45x (origin/main-dev 0fecb24d + triage/docs commits; no feature branch yet)

## Session 2026-11-11 — sdd-batch design gate (round 2)

Full `/sdd-design` debate halted at its approval gate after round 2 (gate policy: halt). design.md is not
written and status.md is unchanged (spec-ready). The register is in `debate.md` (D-1..D-5, R-1..R-2, O-1..O-16).

### Open Threads

- **Approach.** (A) Marketdata cancel-quiet (D-1): a `warnUnlessDone` helper at the GetBars, GetLatestQuote and
  bar-ingest WARN sites, with `ingestRecentBarsForTimeframe` returning early on `ctx.Err()`; the warm poller is untouched.
  (C) Portfolio cancel-quiet (D-2): `processAccountDeregistered` uses the stop closure and returns `ctx.Err()`; the
  bracket and balance handlers log Debug when ctx is done and stay void/ackAlways; order fill is unchanged.
  (B) GetBars miss-path negative cache, shipped only on a KEEP verdict from the gate. It is scoped to
  `startImplicit && pageToken==""`, keyed on raw `req.Symbol|canonicalTf`, and set only on a confirmed empty (D-3).
  The window comes from a new namespace-relative key `marketdata`/`bars.miss_backoff_ms` (int, default 1800000,
  bounds [0, 21600000]), seeded per D-5. `window<=0` restores every-call fetch and WARN (D-4).
  `fetchAndCacheBars` returns a named outcome. The concurrent cold-call herd is accepted and stated.
- **Strongest open objection: O-1, the (B) gate (blocking).** Before `/sdd-spec`, query Loki in staging and
  production from the feature-282 deploy plus 7 days. Count `GetBars: no bars stored and live fetch returned none`
  per symbol and check each symbol's servability. Verdict is KEEP if any symbol that is servable now logs at least
  10 miss-WARNs on any single day; otherwise DROP. The query result and the operator's go/no-go are recorded here.
  Also blocking:
  - O-10: confirm the exact seed row, its test, and the bounds FQN versus the reader key, shipped with the reader
    under `check-config-wiring --final`.
  - O-11: the DROP path cannot retire or rewrite AC-2 without operator sign-off here plus a product-spec revision
    (C-15). Until then, DROP parks (B) and AC-2.
  Non-blocking: O-9 (order-fill ackAlways spec claim stale?), O-12..O-16.
- **Floor status.** No Floor breaches.
- **Uncovered @AC changes.** @AC-2 is a CHANGE (servable-but-empty symbol: three sequential calls in the window make
  one vendor call and log at most one WARN; positive control after the window; disabled control at window=0), and
  no operator decision covers it yet. @AC-1, @AC-4/@AC-9/@AC-12/@AC-14/@AC-23 @feature-282 and @AC-2 @feature-256
  are PRESERVE.

```sdd-batch-design-state
{
  "round": 2,
  "synth": {
    "approach": "Round-2 synthesis. (A) and (C) are unchanged and stay settled (D-1, D-2). (B) keeps the round-2 shape but now depends on a gate with a fixed threshold and an operator go/no-go, and its seed row is stated exactly. Paths are under services/xstockstrat-marketdata/internal/service/ unless another service is named.\n\n(A) Marketdata cancel-quiet (D-1), as proposed:\n- Add warnUnlessDone(ctx,msg,args...) and use it at marketdata_service.go :411, :431, :438, :630, :1409, :1413, :1421, :1429.\n- ingestRecentBarsForTimeframe returns early on ctx.Err().\n- The warm poller is untouched.\n\n(B) GetBars miss-path negative cache. It ships only if the gate below says keep.\n\nGate (O-1), run before /sdd-spec, not during execution:\n- Query: Loki, staging and production, from the feature-282 deploy plus 7 days (or the full span since deploy if shorter). Count 'GetBars: no bars stored and live fetch returned none' grouped by symbol, then check each symbol with GetSymbolServability.\n- Fixed threshold, in place of the undefined \"more than once per window\": KEEP (B) if any symbol that is servable now logs at least 10 miss-WARNs on any single day in the span. Otherwise DROP.\n- The query result and the operator's go/no-go both go into context.md before /sdd-spec.\n- The DROP path does not delete AC-2 by orchestrator decision. Retiring or rewriting AC-2 as \"covered by @AC-4 @feature-282\" is a C-15 acceptance CHANGE. It needs explicit operator sign-off in context.md plus a product-spec revision. Until then, DROP means (B) and AC-2 are parked with the feature at its current status.\n\nIf KEEP, (B) is the round-2 design, adjusted as follows.\n- Placement: new file bars_miss.go. State is missMu plus lastEmptyFetch beside staleMu/lastStaleCheck (:56-59). The constructor initialises the map, and the writer also creates it if nil, for cacheBarsSvc (marketdata_service_test.go:5447).\n- Key: raw req.Symbol+'|'+canonicalTf (:327, :329, :350).\n- Scope: only when startImplicit && pageToken==\"\", on the miss branch, after liveFetchAllowed (:347). The stale branch (:339-346) never reads or writes an entry. Non-empty stored bars delete the entry.\n- liveRefetch extracts :347-356. missFetchDue checks without reserving. noteMissResult sets the entry only on a confirmed empty (D-3), deletes it when bars come back, and leaves it alone on an error or cancel.\n- New: window<=0 skips noteMissResult entirely. Every call then fetches and logs the WARN as before the fix, so 0 is a clean rollback lever. The disabled-control test asserts both every-call fetch and every-call WARN.\n- fetchAndCacheBars returns a small named outcome instead of a third positional bool. For example, a barsFetch struct {bars, token, confirmedEmpty}, or an outcome enum. confirmedEmpty requires err==nil && len(live)==0 && ctx.Err()==nil.\n  - Callers: :350 and the one test helper at marketdata_service_test.go:5456, which is shared by the TestFetchAndCacheBars_* tests.\n  - A grep this round found no origin/feature/* branch modifying fetchAndCacheBars. Re-check at spec time.\n- Concurrency: accept the herd and state it in design.md. N concurrent cold first calls for the same servable-empty symbol may each make one vendor call; once a confirmed empty lands, the window suppresses later calls. AC-2 is sequential. An in-flight reservation with rollback on a non-confirmed outcome is a fallback only if the operator wants a one-call-under-concurrency guarantee.\n- WARN only when firstEmpty. A later empty refetch after the window logs Debug.\n- design.md carries the honest-value statement:\n  - Saved: one unbatched Alpaca GetBars per implicit miss inside the window.\n  - Not saved: markWarmIfServable (asset_servability.go:81-92) still warms the symbol, and the ingester keeps polling it until feature 291's hold applies.\n  - The WARN signal is once per change into the empty state.\n- Accepted residual: lastEmptyFetch is unbounded while the asset set is unloaded (fail-open, asset_servability.go:66-70). Each entry costs one vendor call, so growth is rate-bounded.\n\nConfig key: marketdata / bars.miss_backoff_ms, int, default 1800000, bounds [0, 21600000]. Read live on each miss by resolveBarsMissBackoff(s.budgetCfg); a nil budgetCfg falls back to the default.\n\nSeed migration. It must NOT be modelled on 042, whose key column holds the FQN 'marketdata.stream.bar_ingest_backoff_ms' (042_marketdata_bar_ingest_backoff.up.sql:11), or on 047, which is a latched DELETE and not a seed. The row is:\n- namespace='marketdata', key='bars.miss_backoff_ms' (namespace-relative, which the 044/045 CHECK requires), value_type='int', value_data and default_value '1800000', consuming_service 'xstockstrat-marketdata';\n- one row each for staging and production, user_id NULL;\n- an updated_by sentinel unique to this migration;\n- ON CONFLICT (namespace,key,environment,COALESCE(user_id,'')) DO NOTHING.\nThe down migration deletes only rows carrying that sentinel. The number is max+1 at merge, checked against every origin/feature/* tail.\n\nBounds entry: add one beside configServiceImpl.ts:163, in that registry's FQN form 'marketdata.bars.miss_backoff_ms'. Check it against the reader's GetInt(\"bars.miss_backoff_ms\") resolution so it does not double-prefix.\n\nTests and gate:\n- A new seed test asserts the relative key and value_type 'int'. It does not copy the FQN assertions in barIngestBackoffSeedMigration.test.ts.\n- A bounds test row goes beside setConfigScalarBounds.test.ts:283.\n- The seed lands in the same commit as its reader, gated by check-config-wiring.mjs --keys bars.miss_backoff_ms --final.\n\nresolveOptionalMs refactor (bar_hold.go:35-44): only if resolveBarIngestBackoff keeps its signature and bar_hold_test.go (:118, :424) and the :1395 caller pass unmodified. Otherwise drop it and keep a parallel reader.\n\nStructural test: TestGetBarsWarnsWhenMissAndLiveFetchEmpty (marketdata_service_test.go:1273) is retargeted onto liveRefetch. Pin it by name, not line.\n\nAC-2 is rewritten (CHANGE): a servable-but-empty symbol; three sequential calls inside the window make one vendor call and log at most one WARN; a positive control (a call after the window refetches); a disabled control (window=0: every call fetches and WARNs).\n\nBatchGetBars is untouched.\n\n(C) Portfolio cancel-quiet (D-2), as proposed: processAccountDeregistered (portfolio_service.go:1540) uses the stop closure (:1618) and returns ctx.Err(). processBracketUpdate (:1706) and processBalanceSync (:1765) log Debug when ctx is done, stay void and stay ackAlways. processOrderFill (:373) is unchanged.\n\nBuild order (each step red before green; each helper lands with its production caller):\n1. (A) plus the AC-1 test.\n2. The gate result and the operator go/no-go recorded in context.md, before /sdd-spec.\n3. If KEEP: the seed, bounds and tests; the optional resolveOptionalMs refactor; bars_miss.go and liveRefetch wired at :347; the outcome return; the retargeted structural test.\n4. (C).\n5. The marketdata and portfolio CLAUDE.md files, config-governance.md, and the product-spec order-fill correction once O-9 is confirmed.",
    "open_objections": [
      {
        "text": "O-1 (partially addressed): the (B) gate now has a fixed threshold (KEEP if any symbol servable now logs at least 10 miss-WARNs on any single day over the 7 days after the feature-282 deploy). The query result and the operator's go/no-go must be recorded in context.md before /sdd-spec. The orchestrator has Grafana/Loki access and should run it now.",
        "blocking": true
      },
      {
        "text": "O-9: The orchestrator or operator must still confirm that the product spec's order-fill ackAlways site is stale (processOrderFill :373 is not ackAlways-wrapped) before the docs step corrects it.",
        "blocking": false
      },
      {
        "text": "O-10 [C-05/CONFIG-9; fails.md:2333, :2328, :3841, :3775]: Seed row shape. There is no valid on-tree template: 042 stores the FQN in its key column (:11), 047 is a DELETE, and 044/045 reject a prefixed key. The next proposal must confirm the exact row in design.md:\n- namespace='marketdata', key='bars.miss_backoff_ms', value_type='int', staging and production, user_id NULL;\n- a unique updated_by sentinel, which the down migration filters on;\n- ON CONFLICT DO NOTHING.\nIt must also confirm:\n- a seed test that asserts the relative key and does not copy the FQN assertions in barIngestBackoffSeedMigration.test.ts;\n- that the bounds-registry FQN 'marketdata.bars.miss_backoff_ms' resolves against the reader's GetInt('bars.miss_backoff_ms') with no double prefix;\n- that the seed ships in the same commit as its reader, gated by check-config-wiring.mjs --final.",
        "blocking": true
      },
      {
        "text": "O-11 [C-15/C-11]: Retiring or rewriting AC-2 on the DROP path is an acceptance-contract CHANGE. It needs explicit operator sign-off in context.md and a product-spec revision. An orchestrator decision is not enough. Until then, a DROP verdict parks (B) and AC-2; it does not delete them.",
        "blocking": true
      },
      {
        "text": "O-12 [P-06]: The check-without-reserving design lets N concurrent cold first calls for the same servable-empty symbol each make a vendor call. The synthesis accepts this herd, and design.md must say so and keep AC-2 sequential. A short in-flight reservation, rolled back on any non-confirmed outcome (D-3 still holds), is the fallback if the operator wants a one-call-under-concurrency guarantee.",
        "blocking": false
      },
      {
        "text": "O-13: window<=0 must be a full rollback lever. The synthesis has <=0 skip noteMissResult entirely, so every call fetches AND WARNs as before the fix. The disabled-control test must assert both.",
        "blocking": false
      },
      {
        "text": "O-14: design.md must carry the honest-value statement:\n- saved: one unbatched Alpaca GetBars per implicit miss inside the window;\n- not saved: warming via markWarmIfServable (asset_servability.go:81-92) continues, and ingester polling continues until feature 291's hold applies;\n- the WARN fires once per change into the empty state (later empty refetches log Debug).",
        "blocking": false
      },
      {
        "text": "O-15 [C-18]: The resolveOptionalMs refactor of bar_hold.go:35-44 is allowed only if resolveBarIngestBackoff keeps its signature and every feature-291 reader test (bar_hold_test.go :118, :424) and the :1395 caller pass unmodified. Otherwise drop it and keep a parallel reader.",
        "blocking": false
      },
      {
        "text": "O-16 [C-18]: fetchAndCacheBars should return a named outcome (a struct or enum), not a third positional bool, so that an outcome a peer adds later is additive. A grep this round found no origin/feature/* branch modifying it. Re-grep at spec time.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "@AC-1",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-2",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-4 @feature-282",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-9 @feature-282",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-23 @feature-282",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-12 @feature-282",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-14 @feature-282",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-2 @feature-256",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Using 042 or 047 as the seed template. Lost: 042 stores the FQN in its key column, which the 044/045 CHECK now rejects, and 047 is a latched DELETE, not a seed.",
      "Deleting AC-2 on the DROP path by orchestrator decision. Lost: that is a C-15 acceptance CHANGE and needs operator sign-off and a product-spec revision.",
      "The undefined gate threshold 'more than once per window'. Lost: the window exists only if (B) ships; replaced by a fixed per-day count over a fixed span.",
      "Letting window<=0 still dedupe the WARN through noteMissResult. Lost: 0 would then not be a full rollback to pre-fix behaviour.",
      "A third positional bool on fetchAndCacheBars. Lost: each outcome a peer adds later becomes another signature break; a named outcome is additive.",
      "Count-only WARN dedupe with no cache. Lost: it does not meet AC-2's one-vendor-call requirement and saves no vendor cost."
    ],
    "open_risks": [
      "The gate may return DROP after design approval. With the AC-2 change unsigned, the feature then parks rather than shipping (A) and (C) alone; the operator may choose to split (B) out.",
      "Concurrent cold first calls can each make one vendor call (the accepted herd).",
      "lastEmptyFetch is unbounded while the asset set is unloaded (fail-open). Growth is bounded by vendor-call rate.",
      "A window of up to 30 min can delay the first GetBars live fetch for a symbol that goes from empty to populated outside the ingester's 48h warm lookback.",
      "Migration-number collisions with peers above 047: allocate max+1 at merge and check every origin/feature/* tail.",
      "fetchAndCacheBars may still be edited by peers 320/322/323/326 before merge. No current branch touches it."
    ],
    "constitution_rules_touched": [
      "C-05",
      "C-11",
      "C-13",
      "C-15",
      "C-16",
      "C-18",
      "P-02",
      "P-03",
      "P-06",
      "F-07"
    ],
    "rationale": "The adversary found no Floor breach, and (A) and (C) restate D-1 and D-2, so they stand.\n\nThe proposal concretely answered several register objections, which are closed:\n- O-2: scope is startImplicit && pageToken==\"\".\n- O-3: the key is the raw req.Symbol.\n- O-4: a dedicated key.\n- O-5: the PRESERVE reading is stated.\n- O-6: confirmedEmpty requires ctx.Err()==nil.\n- O-7: a call counter, lazy map init, and the retargeted structural test, now pinned by name.\n- O-8: each helper lands in the same step as its caller.\n\nTwo adversary objections were not answered by the proposal, so they stay blocking:\n- The seed template. Verified this round: 042:11 stores 'marketdata.stream.bar_ingest_backoff_ms' in its key column, and 047 is a latched DELETE. The proposal's 'copy 047' assumption has no basis. The synthesis states the exact row and the test, but the next proposal must confirm it.\n- The AC-2 deletion on the DROP path. It is a C-15 change with no operator decision behind it. The gate threshold is now fixed so the go/no-go can be decided. O-1 stays blocking until the result is recorded.\n\nFor the herd, the synthesis keeps the prior position: accept and state it. Reserve-with-rollback is not a locked R-n, so it stays the fallback. Making window<=0 skip noteMissResult gives a true rollback lever.\n\nFact-checked this round:\n- fetchAndCacheBars has one production caller (:350) and one test helper caller (:5456).\n- No origin/feature/* branch currently modifies fetchAndCacheBars, which lowers but does not remove the conflict risk.\n\nNo settled D-n is contradicted and no R-n is reintroduced.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "D-4: If (B) ships, window<=0 skips noteMissResult entirely, so every call fetches and logs the WARN as before the fix (a full rollback lever). The disabled-control test asserts both.",
          "evidence": "Adversary r2: <=0 otherwise keeps the WARN deduped; the proposer's own feature-291 precedent bar_hold.go:34-44 treats <=0 as off."
        },
        {
          "text": "D-5: The bars.miss_backoff_ms seed is a namespace-relative row (namespace 'marketdata', key 'bars.miss_backoff_ms', value_type 'int', staging and production, user_id NULL, a unique updated_by sentinel, ON CONFLICT DO NOTHING). It is never modelled on 042's FQN key or on 047.",
          "evidence": "042_marketdata_bar_ingest_backoff.up.sql:11 holds the FQN key; 047_config_alias_removal_rows.up.sql is a latched DELETE; 044/045 reject prefixed keys; fails.md:2333, :3841"
        }
      ],
      "new_rejected": [],
      "new_objections": [
        {
          "text": "O-10: The seed row shape and test must be namespace-relative with an updated_by sentinel. The bounds FQN must be verified against the reader key with no double prefix. The seed ships with its reader under check-config-wiring --final.",
          "blocking": true
        },
        {
          "text": "O-11: Retiring or rewriting AC-2 on the gate's DROP path needs operator sign-off in context.md and a product-spec revision (C-15).",
          "blocking": true
        },
        {
          "text": "O-12: State in design.md the accepted concurrent cold-call herd under check-without-reserving, and keep AC-2 sequential. A reservation with rollback is the fallback.",
          "blocking": false
        },
        {
          "text": "O-13: window<=0 must restore every-call fetch AND every-call WARN; the disabled-control test asserts both.",
          "blocking": false
        },
        {
          "text": "O-14: design.md must carry the honest-value statement: vendor calls saved, warming and ingester polling not saved, WARN once per change into the empty state.",
          "blocking": false
        },
        {
          "text": "O-15: The resolveOptionalMs refactor is allowed only if resolveBarIngestBackoff's signature and every feature-291 test and caller stay unmodified; otherwise drop it.",
          "blocking": false
        },
        {
          "text": "O-16: fetchAndCacheBars should return a named outcome, not a third positional bool. Re-grep peer branches at spec time.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-2",
          "how": "The proposal scopes (B) to startImplicit && pageToken==\"\" on the miss branch after liveFetchAllowed; explicit-range and backtest reads keep fetching; the adversary accepted it."
        },
        {
          "id": "O-3",
          "how": "The key is the raw req.Symbol+'|'+canonicalTf, identical to the QueryRecentBars/QueryBars/fetchAndCacheBars arguments (:327, :329, :350); the adversary accepted it."
        },
        {
          "id": "O-4",
          "how": "A dedicated key, bars.miss_backoff_ms, with its own bounds; no coupling to feature 291's stream.bar_ingest_backoff_ms. The seed-shape follow-up is tracked as O-10."
        },
        {
          "id": "O-5",
          "how": "design.md records @AC-9 @feature-282 as PRESERVE: the first call fetches while the asset set is unloaded, and only a confirmed empty suppresses later calls."
        },
        {
          "id": "O-6",
          "how": "confirmedEmpty requires err==nil, len==0 and ctx.Err()==nil, with a red test that combines barsCancelSource{cancel} and empty bars."
        },
        {
          "id": "O-7",
          "how": "A call counter at entry, lazy map init in the writer, and the structural test TestGetBarsWarnsWhenMissAndLiveFetchEmpty retargeted onto liveRefetch, pinned by name, with the C-13 relocation rule."
        },
        {
          "id": "O-8",
          "how": "The build order lands each helper in the same step as its production caller."
        }
      ],
      "reopen_petitions": [],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```

## Session 2026-11-13 — sdd-batch design gate (round 3)

Full `/sdd-design` debate halted at its approval gate after round 3 (gate policy: halt). design.md is not
written and status.md is unchanged. The register is in `debate.md` (D-1..D-7, R-1..R-4, O-1..O-20).

### Open Threads

- **Approach.** (A) Marketdata cancel-quiet (D-1) and (C) Portfolio cancel-quiet (D-2) are unchanged. (C) now
  builds before the gate (D-7): neither (A) nor (C) depends on the gate or AC-2. (B), the GetBars miss-path
  negative cache, ships only on KEEP. It keeps the round-3 seed, bounds and wiring shape with five changes:
  - a volume-only gate (D-6);
  - (C) ordered ahead of the gate;
  - a lock-free hit path, where only `noteMissResult` deletes an entry and sweeps stale ones (O-18);
  - an injected `now` in `missFetchDue`, an explicit `implicitFirstPage` on `liveRefetch`, and window-expiry and
    explicit-range controls (O-19);
  - a seed test built on `migrationSql.ts` `findOne`/`splitStatements` (O-17).
  The key is `marketdata`/`bars.miss_backoff_ms` (int, default 1800000, bounds [0, 21600000]), seeded per D-5;
  `window<=0` restores every-call fetch and WARN (D-4).
- **Strongest open objection: O-1, the (B) gate (blocking).** Volume only, with no servability cross-check: the
  miss WARN (`marketdata_service.go:353`) is reachable only inside `liveFetchAllowed` (:347), and
  `GetSymbolServability` is unreachable from the agent. Before `/sdd-spec`, run the Loki count of
  `GetBars: no bars stored and live fetch returned none` by symbol over 24h windows, staging and production, from
  feature 282 reaching staging to +7d. KEEP if any symbol has at least 10 WARNs in any 24h window (label each sample
  by the window it covers); otherwise DROP. First check that the query returns hits for a known-noisy period, since
  a wrong label reads as a false DROP. Record the result here.
  Also blocking:
  - O-11: the operator chooses (1) KEEP, (2) DROP and retire AC-2 as covered by @AC-4 @feature-282, (3) split (B)
    and AC-2 into a follow-up, or (4) WARN-dedupe only. Options 2-4 are C-15 acceptance changes that need explicit
    sign-off here plus a product-spec revision. Without sign-off, (B) and AC-2 park.
  Non-blocking: O-17..O-20 (O-20: the overlap scan covers config migrations 049 and above plus a sibling-branch grep
  for `bars.miss_backoff_ms`, re-run after every main-dev merge). O-9, O-10 and O-12..O-16 closed this round.
- **Floor status.** No Floor breaches.
- **Uncovered @AC changes.** @AC-2 is a CHANGE (three sequential calls inside the window make one vendor call and log
  at most one WARN; window-expiry positive control; disabled control at window=0), and no operator decision covers
  it yet. @AC-1, @AC-4/@AC-9/@AC-12/@AC-14/@AC-23 @feature-282, @AC-8/@AC-11 @feature-290, @AC-2/@AC-3 @feature-191
  and @AC-2 @feature-256 are PRESERVE.

```sdd-batch-design-state
{
  "round": 3,
  "synth": {
    "approach": "Round-3 synthesis. (A) and (C) are unchanged (D-1, D-2). (B) keeps the round-3 seed, bounds and wiring shape, with five changes: a volume-only gate, (C) moved ahead of the gate, a lock-free hit path, a clock seam with positive and scope controls, and a seed test built on the shared migration helpers. Paths are under services/xstockstrat-marketdata/internal/service/ unless another service is named.\n\n(A) Marketdata cancel-quiet (D-1)\n- Add warnUnlessDone(ctx,msg,args...). It logs WARN, or Debug with ctx_done when ctx is done.\n- Apply it at marketdata_service.go :411, :431, :438, :630, :1409, :1413, :1421 and :1429.\n- ingestRecentBarsForTimeframe returns early on ctx.Err().\n- The warm poller stays as it is: :1239 and :1263 are Debug, and :1286 is a load-bearing aggregate WARN.\n- Leave :422 (cache insert failed) alone (@AC-8 and @AC-11 @feature-290).\n- AC-1 test: a cancel logs no WARN; a non-cancel error on a live ctx still WARNs.\n\n(C) Portfolio cancel-quiet (D-2)\n- processAccountDeregistered (portfolio_service.go:1540) uses the feature-290 stop closure (:1618) and returns ctx.Err().\n- processBracketUpdate (:1706) and processBalanceSync (:1765) log Debug on a done ctx, stay void and stay ackAlways (R-2).\n- processOrderFill (wired at :177 with no ackAlways) is unchanged.\n- Tests reuse the helpers in portfolio_sync_cancel_test.go:16, :52 and :58.\n\nGate (O-1), run before /sdd-spec. It is volume only; the servability cross-check is dropped.\n- Why: the miss-path WARN at marketdata_service.go:353 sits inside `if refetch && liveFetchAllowed(snap, req.Symbol)` (:347). liveFetchAllowed is true only for a servable symbol or a nil snapshot (asset_servability.go:66-71), so every post-282 WARN is already servability-filtered. GetSymbolServability is also unreachable from the agent (no call in services/xstockstrat-agent; fails.md 2026-11-10 fix-ctx-cancel-warn-flood).\n- Query (Loki, staging and production): sum by (symbol) (count_over_time({<marketdata service label>} |= \"GetBars: no bars stored and live fetch returned none\" | json [24h])).\n- Span: from feature 282 reaching staging (merged to main-dev before the 2026-11-06 prod promotion) to +7d, or to now if shorter.\n- Label each sample by the 24h window it covers, not by its timestamp (fails.md 2026-11-10 fix-analysis-admin-formula-refusal).\n- Verdict: KEEP if any symbol has at least 10 WARNs in any 24h window; otherwise DROP.\n- Optionally drop hits within about 2 minutes of a boot or `shutting down` line; those are unloaded-asset-set residue (@AC-9 @feature-282).\n- Adjust the label and `| json` field names to the stack.\n- Record the result in context.md before /sdd-spec.\n\nOperator ask (O-11), in the same prompt as the gate result:\n1. KEEP: ship (B) with the rewritten AC-2.\n2. DROP and retire AC-2 as covered by @AC-4 @feature-282.\n3. Split: ship (A) and (C) here and move (B) and AC-2 to a follow-up feature.\n4. WARN-dedupe only: no fetch suppression, no key, no migration.\n- Options 2, 3 and 4 are C-15 acceptance changes. Each needs explicit sign-off in context.md plus a product-spec revision.\n- Without sign-off, (B) and AC-2 are parked. (A) and (C) are already built by then.\n\n(B) GetBars miss-path negative cache (KEEP only)\n- New file bars_miss.go: missMu and lastEmptyFetch map[string]time.Time, beside staleMu/lastStaleCheck (:58-59). The constructor initialises the map; the writer also creates it if nil (for cacheBarsSvc).\n- Key: raw req.Symbol+\"|\"+canonicalTf, the same form staleCheckDue uses (:368) and the same strings passed at :327, :329 and :350.\n- liveRefetch is extracted from :347-356 and takes an explicit implicitFirstPage bool. Only startImplicit && pageToken==\"\" consults or writes the cache, so O-2's scope is testable at the seam.\n- missFetchDue(key, window, now) takes an injected now, like staleCheckDue(…, now) at :367. It checks the entry without reserving it (the O-12 herd is accepted; reserve-with-rollback is the fallback).\n- fetchAndCacheBars returns barsFetch{bars, token, confirmedEmpty}. confirmedEmpty = err==nil && len==0 && ctx.Err()==nil (D-3). Callers: :350 and the test helper used by the TestFetchAndCacheBars_* tests.\n- noteMissResult is the only writer:\n  - it sets the entry on a confirmed empty;\n  - it deletes the entry when a fetch returns bars;\n  - it does nothing on an error or cancel;\n  - while it holds the lock, it sweeps entries older than the window.\n- The hit path (stored bars, fresh or stale) never takes missMu. This removes round 3's \"a read that finds stored bars deletes the entry\" and its contradiction with \"the stale branch (:339-346) never touches an entry\". The sweep also bounds map growth while the asset set is unloaded.\n- WARN only on a change into the empty state (no prior entry). A refetch after the window logs Debug.\n- Window <=0 (D-4): missFetchDue always returns true, noteMissResult is skipped, and the map is cleared, mirroring bar_hold.go:50-51. Every call then fetches and WARNs as before the fix.\n- BatchGetBars is untouched.\n\nTests:\n- AC-2 is sequential: three calls inside the window make one vendor call and log at most one WARN.\n- Window-expiry positive control: an entry older than the window (via injected now) leads to exactly one more vendor call and a Debug line, not a WARN.\n- Disabled control (window=0): every call fetches and every call WARNs.\n- Scope negative control: an explicit-range miss with a live entry still fetches.\n- Cancel-plus-empty red test using barsCancelSource with a call counter taken at entry.\n- TestGetBarsWarnsWhenMissAndLiveFetchEmpty is retargeted onto liveRefetch and pinned by name.\n\nConfig key: namespace marketdata, key bars.miss_backoff_ms, int, default 1800000, bounds [0, 21600000].\n- Read live on each miss via resolveBarsMissBackoff(s.budgetCfg).\n- resolveBarIngestBackoff (bar_hold.go:35-44) becomes a wrapper over a shared resolveOffMs, but only if its signature, bar_hold_test.go and the :1395 caller stay byte-identical. Otherwise use a parallel reader.\n\nSeed (D-5), modelled on 048_webhook_fanout_callback_keys.up.sql:4-43:\n- Two rows, staging and production: ('marketdata','bars.miss_backoff_ms','int','1800000',<desc>,'1800000','xstockstrat-marketdata','system:config-migration-feature-fix-marketdata-miss-path-noise',env,NULL).\n- ON CONFLICT (namespace,key,environment,COALESCE(user_id,'')) DO NOTHING.\n- The down migration deletes only rows carrying the sentinel.\n- Number: at least 049, taken as max+1 at merge.\n\nOverlap scan, before allocating and re-run after every main-dev merge:\n- git log --all -- 'services/xstockstrat-config/migrations/049*' (and higher);\n- grep sibling origin/feature/* branches for the 'bars.miss_backoff_ms' (namespace, key) string, especially the fix-live-enrich-ttl-seed and fix-trading-config-plumbing peers.\n\nBounds: add 'marketdata.bars.miss_backoff_ms' beside configServiceImpl.ts:163. It resolves via the ${namespace}.${key} lookup at :182. Add a test row beside setConfigScalarBounds.test.ts:283.\n\nSeed test:\n- Write a bespoke test on src/__tests__/migrationSql.ts: findOne('_marketdata_bars_miss_backoff', 'up'|'down') (:8) and splitStatements (:19).\n- Assert the relative key, fail on the FQN, and assert value_type 'int', the sentinel and the sentinel-filtered down migration.\n- Do not clone barIngestBackoffSeedMigration.test.ts (it has its own splitter at :16-34 and a hardcoded filename at :8).\n- Do not reuse globalIntSeedCases.ts unchanged: its INSERT_RE at :19 has no updated_by and its down assertion at :85 has no sentinel. Extending it is allowed only if its two existing suites stay byte-identical.\n- The seed, bounds, reader and tests land in one commit, gated by node scripts/check-config-wiring.mjs --keys marketdata.bars.miss_backoff_ms --final.\n\nBuild order:\n1. (A) with the AC-1 tests.\n2. (C) with its tests. Neither (A) nor (C) depends on the gate or AC-2.\n3. Gate result and operator choice recorded in context.md, before /sdd-spec.\n4. KEEP only, in one commit: seed, bounds, tests, the resolveOffMs wrapper, bars_miss.go, liveRefetch wired at :347, barsFetch, and the retargeted structural test.\n5. Docs:\n   - the marketdata CLAUDE.md key table and GetBars bullet;\n   - the portfolio CLAUDE.md cancel-stop note;\n   - config-governance.md registered keys;\n   - the product-spec order-fill correction (O-9 confirmed).\n\ndesign.md must state:\n- the accepted herd (O-12);\n- the honest value (O-14): one Alpaca GetBars saved per implicit miss inside the window; warming via markWarmIfServable (asset_servability.go:81-92) and ingester polling are not saved; the WARN fires once per change into the empty state.",
    "open_objections": [
      {
        "text": "O-1 (narrowed): The gate is now volume only, with no servability cross-check. KEEP if any symbol logs at least 10 miss-WARNs in any 24h window (labelled by the window it covers) from feature 282 reaching staging to +7d. The orchestrator runs it in Loki and records the result in context.md before /sdd-spec. It stays blocking until the result is recorded.",
        "blocking": true
      },
      {
        "text": "O-11: The operator must choose KEEP, DROP and retire AC-2, split (B) out, or WARN-dedupe only. Every non-KEEP option is a C-15 acceptance change and needs explicit sign-off in context.md plus a product-spec revision. Without sign-off, (B) and AC-2 park.",
        "blocking": true
      },
      {
        "text": "O-17 [C-18]: Build the seed test on the shared migrationSql.ts primitives: findOne(suffix, ext) at :8, so the test does not depend on the migration number, and splitStatements at :19. Do not clone barIngestBackoffSeedMigration.test.ts (it has its own splitter at :16-34 and a hardcoded MIGRATION at :8). globalIntSeedCases.ts may be extended with an optional updatedBy only if its two existing suites stay byte-identical; as it stands, its INSERT_RE (:19) and its sentinel-less down assertion (:85) contradict D-5.",
        "blocking": false
      },
      {
        "text": "O-18 [C-18/perf]: The GetBars hit path (stored bars, fresh or stale) must never take missMu. Only noteMissResult deletes an entry, after a fetch returns bars, and it sweeps entries older than the window while holding the lock. This bounds map growth while the asset set is unloaded and removes round 3's contradiction with 'the stale branch never touches an entry'.",
        "blocking": false
      },
      {
        "text": "O-19 [C-15/P-06]: missFetchDue needs an injected now, as staleCheckDue(…, now) does at :367. liveRefetch takes an explicit implicitFirstPage parameter. Required tests:\n- a window-expiry positive control: an entry older than the window leads to exactly one more vendor call and a Debug line, not a WARN;\n- a scope negative control: an explicit-range miss with a live entry still fetches.",
        "blocking": false
      },
      {
        "text": "O-20 [C-07/ledger]: The overlap scan must cover more than migration numbers:\n- git log --all -- 'services/xstockstrat-config/migrations/049*' and higher (fails.md:3815-3817);\n- a grep of sibling origin/feature/* branches for the 'bars.miss_backoff_ms' (namespace, key) string (fails.md:3840-3842), especially config-seeding peers fix-live-enrich-ttl-seed and fix-trading-config-plumbing;\n- a re-run after every main-dev merge.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "@AC-1",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-2",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-4 @feature-282",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-9 @feature-282",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-12 @feature-282",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-14 @feature-282",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-23 @feature-282",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-8 @feature-290",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-11 @feature-290",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-2 @feature-191",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-3 @feature-191",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-2 @feature-256",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Cross-checking the O-1 gate's symbols with GetSymbolServability. It lost because the miss-path WARN (:353) is reachable only inside liveFetchAllowed (:347; asset_servability.go:66-71), so every logged symbol was already servable. The RPC is also not reachable from the agent (fails.md 2026-11-10 fix-ctx-cancel-warn-flood).",
      "Deleting the negative-cache entry on every first-page implicit read that finds stored bars. It lost because it adds a lock and a map delete to the today lock-free hit path and contradicts the stale-branch no-touch rule. Deleting in noteMissResult plus a sweep inside the writer gives the same cleanup.",
      "Cloning barIngestBackoffSeedMigration.test.ts for the seed test. It lost because it duplicates splitStatements and hardcodes the migration filename, while the shared migrationSql.ts findOne/splitStatements already exist (C-18).",
      "Running (C) after the gate. It lost because (C) depends only on D-2, and ordering it after the gate needlessly parks no-decision work behind the operator.",
      "A split forced before the gate result. It lost because it still needs the same C-15 sign-off to move AC-2. It stays as operator option 3, offered together with the gate result."
    ],
    "open_risks": [
      "The operator may not answer the O-11 choice. (A) and (C) are then built but the feature cannot close with AC-2 unsigned. The reorder limits the parked work to (B).",
      "The Loki label and json field names in the gate query are unverified. A wrong label returns zero hits, which reads as a false DROP. The orchestrator must check that the query returns some hits for a known-noisy period before trusting a zero result.",
      "Concurrent cold first calls can each make one vendor call (the accepted herd). It is bounded by N concurrent callers.",
      "A window of up to 30 min can delay the first live fetch for a symbol that becomes populated outside the ingester's warm lookback.",
      "Peer features may claim config migration numbers at 049 or above, or the same key; the overlap scan must be re-run after each main-dev merge.",
      "Peers may edit fetchAndCacheBars before merge; re-grep at spec time."
    ],
    "constitution_rules_touched": [
      "C-05",
      "C-07",
      "C-11",
      "C-13",
      "C-15",
      "C-16",
      "C-18",
      "P-02",
      "P-03",
      "P-06",
      "F-07"
    ],
    "rationale": "The adversary found no Floor breach and no register violation. I checked its key claims:\n- The miss WARN at marketdata_service.go:353 sits inside `refetch && liveFetchAllowed(snap, req.Symbol)` (:347).\n- liveFetchAllowed returns true only for a servable symbol or a nil snapshot (asset_servability.go:66-71).\n- services/xstockstrat-agent has no GetSymbolServability call site.\n- migrationSql.ts exports findOne(suffix, ext) and splitStatements.\n- Config migrations end at 048.\n\nThese facts make the round-3 gate's servability step both redundant and unrunnable. The synthesis therefore replaces it with a volume-only gate. O-1 stays blocking only until the result is recorded.\n\nThe proposal concretely answered the following objections, which close:\n- O-9: processOrderFill is wired at :177 without ackAlways.\n- O-10: the 048 template, the :182 lookup and the --keys FQN form were verified by the adversary.\n- O-12 and O-14: both statements are carried into design.md.\n- O-13: covered by D-4.\n- O-15: the wrapper keeps its signature, otherwise a parallel reader.\n- O-16: the barsFetch struct.\n\nO-11 stays blocking. It needs an operator decision and none is recorded. The adversary's WARN-dedupe-only idea is added as a fourth operator option, not as an approach change, because it also alters AC-2.\n\nThe adversary's non-blocking points are adopted into the approach and tracked as new objections (O-17 to O-20) for the next proposer to confirm:\n- a lock-free hit path with sweep-on-write;\n- a clock seam plus expiry and scope controls;\n- a DRY seed test;\n- an overlap scan covering the (namespace, key) string.\n\nMoving (C) ahead of the gate addresses the proposal's own strongest risk, so it is recorded as a decision.\n\nRegister check:\n- D-1 to D-5 are honored.\n- R-1 is honored (the window is a config key), and R-2 is honored (bracket and balance stay void).\n- No closed objection is re-raised.\n- No petitions were filed and the operator reopened nothing.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "D-6: The O-1 gate is volume only. KEEP if any symbol logs at least 10 'GetBars: no bars stored and live fetch returned none' WARNs in any 24h window (labelled by the window it covers) from feature 282 reaching staging to +7d; otherwise DROP. There is no GetSymbolServability cross-check.",
          "evidence": "marketdata_service.go:347,:353 (the WARN is inside liveFetchAllowed); asset_servability.go:66-71; no GetSymbolServability call in services/xstockstrat-agent; fails.md 2026-11-10 fix-ctx-cancel-warn-flood and fix-analysis-admin-formula-refusal"
        },
        {
          "text": "D-7: The build order lands (C), portfolio cancel-quiet, before the O-1 gate and the operator decision, because (C) depends only on D-2 and not on AC-2.",
          "evidence": "Adversary r3 scheduling objection; the proposal r3 names parked (A)/(C) as its strongest risk; (C) rests only on D-2 (portfolio_service.go:1540, :1706, :1765)"
        }
      ],
      "new_rejected": [
        {
          "text": "Cross-checking the O-1 gate's symbols with GetSymbolServability.",
          "why": "Every post-282 miss WARN is already servability-filtered by :347, and the RPC is unreachable from the agent."
        },
        {
          "text": "Deleting the negative-cache entry on every first-page implicit read that finds stored bars.",
          "why": "It adds a lock to the lock-free hit path and contradicts the stale-branch no-touch rule. noteMissResult deletion plus a writer sweep covers the same cleanup."
        }
      ],
      "new_objections": [
        {
          "text": "O-17: The seed test is built on migrationSql.ts findOne(suffix, ext) and splitStatements, with no copy of barIngestBackoffSeedMigration.test.ts's splitter or hardcoded filename. Extending globalIntSeedCases is allowed only if its existing suites stay byte-identical.",
          "blocking": false
        },
        {
          "text": "O-18: The GetBars hit path never takes missMu. Only noteMissResult deletes an entry (when a fetch returns bars), and it sweeps entries older than the window while holding the lock.",
          "blocking": false
        },
        {
          "text": "O-19: missFetchDue takes an injected now, and liveRefetch takes an implicitFirstPage parameter. Tests add a window-expiry positive control (one more vendor call, a Debug line, no WARN) and an explicit-range negative control (it still fetches with a live entry).",
          "blocking": false
        },
        {
          "text": "O-20: The overlap scan includes git log --all for config migrations 049 and above, plus a sibling origin/feature/* grep for the 'bars.miss_backoff_ms' (namespace, key) string, re-run after every main-dev merge.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-9",
          "how": "Confirmed by both sides: processOrderFill is wired as s.observed(\"order fill\",\"ok\", s.processOrderFill) at portfolio_service.go:177 with no ackAlways; ackAlways appears only at :1693 and :1741. The docs step corrects the product spec."
        },
        {
          "id": "O-10",
          "how": "Seed modelled on 048 (relative key, sentinel updated_by, ON CONFLICT DO NOTHING, sentinel-filtered down). Bounds 'marketdata.bars.miss_backoff_ms' resolves via ${namespace}.${key} (configServiceImpl.ts:182). --keys takes the ns.key form (check-config-wiring.mjs:4). It lands in one commit with its reader. The adversary verified each point."
        },
        {
          "id": "O-12",
          "how": "The proposal states the accepted concurrent cold-call herd for design.md and keeps AC-2 sequential, with reserve-with-rollback as the fallback."
        },
        {
          "id": "O-13",
          "how": "Covered by D-4: window<=0 skips noteMissResult and clears the map, and the disabled control asserts every-call fetch and every-call WARN."
        },
        {
          "id": "O-14",
          "how": "The proposal carries the honest-value statement (vendor call saved; warming and ingester polling not saved; WARN once per change into the empty state) for design.md."
        },
        {
          "id": "O-15",
          "how": "resolveBarIngestBackoff becomes a wrapper over resolveOffMs only if its signature, bar_hold_test.go and the :1395 caller stay byte-identical; otherwise a parallel reader."
        },
        {
          "id": "O-16",
          "how": "fetchAndCacheBars returns a named barsFetch{bars, token, confirmedEmpty}; the peer re-grep is kept for spec time."
        }
      ],
      "reopen_petitions": [],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```
