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
