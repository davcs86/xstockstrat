# Context Log: fix-orphaned-code

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-10 (/sdd-triage)

- Bug reported via defect report (Issues disabled): docs/reports/2026-10-19-orphaned-code-defect.md — "Orphaned modules, scripts and dependencies across services"
- Cluster rationale: single report; all ten items are dead-code removals of the same kind.
- Severity: SEV-3
- Routed to SDD path (Track C)
- Created: feature.md, product-spec.md, acceptance.feature (regression scenarios @AC-1..2), context.md
- Affected services (from report): config, ledger, notify, marketdata, analysis, ingest, agent, ui, portfolio
- Root cause hypothesis: template copy-paste, unwired features, incomplete refactors; spot-check shows item 5 likely resolved and item 7 changed at 0fecb24d
- Recommended design depth: full → `/sdd-design fix-orphaned-code` (rationale: ≥2 affected services incl. consumer surfaces xstockstrat-ui / xstockstrat-agent; otherwise SEV-3 with clear root cause)
- Development branch: feature/fix-orphaned-code

## Session 2026-11-10 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings: bug-template conventions (no FR-N/@FR tags); items 5 and 9 have no scenario (5 likely resolved; 9 open); first review had item 7 wrongly marked orphaned (fixed + AC-3)
- Overlap findings: WARN: configWatcher.ts and alpaca/client.go with 322; portfolio_repo.go with 311; ledger/notify package.json with 324
- Recommended design depth: full (9 services incl. ui and agent)
- Tree: ccr-500a9eb9-nvk45x (origin/main-dev 0fecb24d + triage/docs commits; no feature branch yet)

## Session 2026-11-11 — sdd-batch design gate (round 2)

/sdd-design full debate halted at the approval gate after round 2 (gate policy: halt). design.md is not written and status.md is unchanged. The register is in debate.md (D-1..D-9, R-1..R-5, O-1..O-3).

## Open Threads

- **Approach**: Round-1 steps 1-7 (portfolio r.db swap, configWatcher deletion, Node package hygiene, marketdata, ingest, agent, ui comment) and the final AC-2 verification stand per D-1..D-5. Round 2 adds: a step-0 gate on the operator's identity choice (D-8); the config CLAUDE.md:131 reword and closure of config findings :14 move into the configWatcher deletion step (D-6); the lock-diff boundary is the touched importers plus the orphaned transitive closure that `pnpm why` confirms (D-7); and merge order against peer 324 is recorded in merge-order.md, with the later-merged feature regenerating the lock (D-9). Re-grep every anchor at spec time, because peers 322, 311 and 324 may shift lines.
- **Strongest open objection (blocking)**: O-1. The operator must choose identity scope for the node-pg-migrate removal: (a) ledger, config and notify, narrowing root findings :57 to identity-only; or (b) those three plus identity, closing :57 and adding xstockstrat-identity to product-spec Affected Services. Proposer and adversary both recommend (b), with (a) as the fallback, but no operator decision is recorded. /sdd-spec stays gated until the choice is recorded here and the matching @AC-2 Given-clause amendment (plus the product-spec amendment under (b)) is on the feature branch.
- **Non-blocking**: O-3. Under (b), add a C-16 identity sweep: services/xstockstrat-identity/acceptance/fix-identity-ledger-test-suites.feature @AC-1 @feature-252 is PRESERVE, discharged by identity's `pnpm run test:coverage`, and the six other identity suites are grepped for build and dependency terms. O-2 is closed (anchors re-verified at main-dev).
- **Floor status**: no Floor breaches.
- **Uncovered @AC changes**: @AC-1 EXTEND and @AC-2 EXTEND, neither covered by an operator decision yet. PRESERVE: @AC-3, @AC-30, @AC-14, @AC-12, @AC-4, @AC-1@feature-252.

```sdd-batch-design-state
{
  "round": 2,
  "synth": {
    "approach": "Round-1 steps 1-7 and the final AC-2 verification still stand, as settled in D-1..D-5. Round 2 adds these refinements.\n\n0. GATE before /sdd-spec (this is O-1, still open). The orchestrator gets the operator's identity choice and records it in docs/roadmap/features/323-fix-orphaned-code/context.md. Proposer and adversary both recommend (b). The fallback is (a). Whichever is chosen, @AC-2's Given clause in acceptance.feature is amended to list exactly the leaves covered:\n- (b): \"ledger, config, identity and notify node-pg-migrate migrate script and devDependency, notify jsonwebtoken and bcrypt\".\n- (a): \"ledger, config and notify ...\".\nUnder (b), product-spec.md Affected Services also gains xstockstrat-identity. /sdd-spec must not list services/xstockstrat-identity/package.json, and must not list the narrowed or closed root docs/context-constitution-findings.md:57, until both amendments are on the feature branch (F-08/P-03).\n\n2. config. Delete src/services/configWatcher.ts and src/__tests__/configWatcher.test.ts. Drop scripts/config-wiring.json:52-55, the four configWatcher.ts:{getBool,getFloat,getInt,getString} entries. Keep :56, :59 and :73 (the identity, ledger and notify lookup entries). In this same step:\n- Reword services/xstockstrat-config/CLAUDE.md:131 (APPLICATION_ENV) to \"telemetry resource attribute only\". After the deletion its only src reader is src/telemetry.ts:32, with the test at telemetry.export.test.ts:69.\n- Close services/xstockstrat-config/docs/context-constitution-findings.md:14.\n- Review the other configWatcher/APPLICATION_ENV hits: findings :4 and :33, and docs/context-constitution.md :7, :18, :19 and :50. Leave findings :22, which is about migration numbering and unrelated.\nGate: run `rm -rf dist`, then `pnpm build && pnpm test:coverage`, and re-check c8 --lines 40.\n\n3. Node package hygiene. Remove notify's jsonwebtoken, bcrypt, @types/jsonwebtoken and @types/bcrypt. Remove the `migrate` script and the node-pg-migrate devDependency from these leaves:\n- ledger package.json:11,54\n- config :11,50\n- notify :11,57\n- identity :11,55, only under (b)\nUnder (b), close root findings :57. Under (a), narrow it to identity-only.\nRegenerate the lock with `pnpm install --lockfile-only`, then verify with `pnpm install --frozen-lockfile`.\nExpected root pnpm-lock.yaml diff: the touched importer entries, plus the transitive closure that `pnpm why` confirms has no other dependent. Under (b) this includes node-pg-migrate's own packages:/snapshots: entries. Anything outside that set is drift and fails the step.\nGates:\n- every touched leaf: `pnpm build && pnpm test:coverage`\n- `docker compose build xstockstrat-ledger xstockstrat-notify xstockstrat-config`\n- under (b) also `docker compose build xstockstrat-identity`, if a compose build target exists. Otherwise identity's pnpm gate alone discharges it.\n\nSteps 1 (portfolio), 4 (marketdata, findings :33), 5 (ingest, per D-3), 6 (agent, findings :34) and 7 (ui, D-2) are unchanged.\n\nFinal AC-2 verification is unchanged. Add `pnpm why node-pg-migrate`: under (b) it must show no dependents; under (a) only identity.\n\nSpec-time note: re-grep every anchor when writing implementation-spec.md. Peers 322, 311 and 324 may shift lines.\n\nMerge sequencing with peer 324. 324 edits the coverage scripts in all four leaf package.json files: config, identity and notify :13, ledger :14. It also rewrites the root lock. Record the 323/324 order in docs/roadmap/features/merge-order.md. Whichever of the two merges later rebases and regenerates the lock under the D-4 protocol. Nobody resolves pnpm-lock.yaml by hand.",
    "open_objections": [
      {
        "text": "O-1 (still open): the operator must choose identity scope, (a) three leaves or (b) four leaves plus an amendment to product-spec Affected Services. Both sides recommend (b), but a recommendation is not a decision. /sdd-spec stays gated until the choice is recorded in context.md and the matching @AC-2 Given-clause amendment, plus the product-spec amendment under (b), is on the feature branch.",
        "blocking": true
      },
      {
        "text": "Under (b), recon/design must add a C-16 Existing Business Rules sweep for xstockstrat-identity. It must record services/xstockstrat-identity/acceptance/fix-identity-ledger-test-suites.feature @AC-1 @feature-252 as PRESERVE, discharged by identity's `pnpm run test:coverage` gate. It must also grep the six other identity suites (fix-identity-auth-code-race, signal-map-instrumentation, fix-push-untargeted-broadcast, otel-metrics-logs-export, user-management-ui, mcp-user-profile-roles) for build and dependency terms.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "AC-1",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-2",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-3",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-30",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-14",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-12",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-4",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-1@feature-252",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Delete the PortfolioPanel combined branch (R-1). It is locked.",
      "Migrate WatchlistRepo and signal_expiry_repo to a mockable handle (R-2). It is locked.",
      "Change the extractor_module value at fundsignal_loop.py:623 (R-3). It is locked.",
      "Rename RawInput while narrowing it. That is churn across mcp_client.py, BaseExtractor and INGEST-6.",
      "Regenerate the lock with a plain `pnpm install`. It pulls in unrelated resolution drift.",
      "Remove only from ledger, the literal AC-2. It leaves identical dead scripts behind even though the lock is regenerated anyway.",
      "Update ingest findings :24 as the dead-code closure. That is the wrong row; :23 names the orphans.",
      "Spin identity's node-pg-migrate removal off into a follow-up bug. It costs a second lock regen and a second PR for a one-line deletion (C-18).",
      "Reword config CLAUDE.md:131 in a separate docs-only step. The doc would claim a reader that no longer exists in between, so it moves into the configWatcher deletion step.",
      "Resolve the pnpm-lock.yaml conflict with peer 324 by hand. Hand resolution can silently corrupt the lock; the later-merged feature regenerates it instead."
    ],
    "open_risks": [
      "Under (b), scope widens into identity during the debate. If the product-spec and @AC-2 amendments do not both land before /sdd-spec, the identity package.json edit becomes an off-spec change (F-08/P-03).",
      "The lock regen may drop a transitive package that something else still needs, or bring in drift. Mitigation: `pnpm why`, then an expected-diff check (importers plus the confirmed orphaned closure), then `pnpm install --frozen-lockfile`.",
      "Collision with peer 324: its coverage-script edits sit 2-3 lines from the :11 deletion in all four leaf package.json files, and both features rewrite the root lock. Merge order plus regenerate-after-rebase handles it.",
      "Config c8 line coverage can move when a tested file and its test are deleted together. Re-run --lines 40.",
      "Stale dist/ can mask a broken deletion. Clean it before the gate.",
      "pgxmock proves the handle and the SQL shape, not live SQL semantics (insights.md:1963).",
      "Peer overlap: 322 touches configWatcher.ts and client.go, 311 touches portfolio_repo.go. Line anchors may shift, so re-grep at spec time.",
      "The dangling extractor_module labels stay visible until the separate defect is fixed."
    ],
    "constitution_rules_touched": [
      "C-01",
      "C-08",
      "C-11",
      "C-15",
      "C-16",
      "C-18",
      "F-08",
      "P-03",
      "P-06"
    ],
    "rationale": "The adversary returned NEEDS WORK with no Floor breach. It verified the proposer's O-1 and O-2 anchors against the tree:\n- root findings :57 names all four leaves;\n- node-pg-migrate sits at config :11,50, identity :11,55, ledger :11,54 and notify :11,57;\n- config-wiring.json :52-55 are the configWatcher entries.\n\nO-2 closes on that evidence, with the spec-time re-grep kept as a step note.\n\nO-1 stays blocking. Both sides prefer (b), but the scope fork belongs to the operator (C-11/P-03), and no operator decision is recorded. The synthesis therefore gates /sdd-spec on the recorded choice. It also turns the adversary's point that the @AC-2 amendment applies under either option into part of that gate. This restates O-1's existing text and does not open a new objection.\n\nThe adversary's other refinements are adopted as decisions:\n- The CLAUDE.md:131 rewording and the closure of :14 move into the configWatcher deletion step, because telemetry.ts:32 becomes the only remaining reader.\n- D-4's expected-diff boundary now explicitly includes the orphaned transitive closure confirmed by `pnpm why`. This clarifies D-4 and does not contradict it.\n- The 323/324 lock and package.json collision is settled by recording a merge order and regenerating after rebase.\n\nThe identity C-16 sweep, PRESERVE of @AC-1 @feature-252, is a new non-blocking objection that applies only under (b). The register was honored: no D-n was contradicted, no R-n was reintroduced, and neither side filed a REOPEN petition.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "Reword config CLAUDE.md:131 (APPLICATION_ENV) to 'telemetry resource attribute only' and close config findings :14 in the same step as the configWatcher.ts deletion, not in a separate docs step. Review config findings :4 and :33 and context-constitution.md :7,18,19,50 in that step too, and leave findings :22 alone.",
          "evidence": "services/xstockstrat-config/CLAUDE.md:131; services/xstockstrat-config/docs/context-constitution-findings.md:14; services/xstockstrat-config/src/telemetry.ts:32 (sole remaining reader after the deletion)"
        },
        {
          "text": "Refines D-4: the expected root pnpm-lock.yaml diff is the touched importer entries plus the transitive packages:/snapshots: closure that `pnpm why` confirms has no remaining dependent. Anything else is drift and fails the step.",
          "evidence": "D-4; fails.md:2388-2390; adversary r2 objection 4"
        },
        {
          "text": "Gate /sdd-spec on the operator's recorded O-1 choice. Whichever option is chosen, amend the @AC-2 Given clause to list exactly the leaves covered (under (b), also add identity to product-spec Affected Services) before any package.json edit appears in a step's Files list.",
          "evidence": "acceptance.feature @AC-2; F-08/P-03; services/xstockstrat-{ledger,config,notify}/package.json:11 and identity:11,55"
        },
        {
          "text": "Sequence 323 against peer 324 in docs/roadmap/features/merge-order.md. The later-merged feature rebases and regenerates the root lock under the D-4 protocol, and nobody resolves the lock by hand.",
          "evidence": "docs/roadmap/features/324-fix-ci-enforcement-gaps/product-spec.md:45,52 (coverage-script edits at config/identity/notify package.json:13, ledger:14)"
        }
      ],
      "new_rejected": [
        {
          "text": "Spin identity's node-pg-migrate removal off into a follow-up bug",
          "why": "It needs a second lock regen and a second PR for a one-line deletion (C-18)"
        },
        {
          "text": "Resolve the pnpm-lock.yaml conflict with peer 324 by hand",
          "why": "Risks a corrupted or drifted lock; the later-merged feature regenerates it instead"
        }
      ],
      "new_objections": [
        {
          "text": "Under (b), run a C-16 identity sweep: record services/xstockstrat-identity/acceptance/fix-identity-ledger-test-suites.feature @AC-1 @feature-252 as PRESERVE, discharged by `pnpm run test:coverage`, and grep the six other identity suites for build and dependency terms.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-2",
          "how": "The proposer re-verified every named anchor at main-dev (config-wiring.json:52-55, config findings :14, marketdata :33, agent :34, plus extra config-doc hits), and the adversary confirmed them. A spec-time re-grep stays as a step note."
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

/sdd-design full debate halted at the approval gate after round 3 (gate policy: halt). design.md is not written and status.md is unchanged. The register is in debate.md (D-1..D-13, R-1..R-8, O-1..O-3).

## Open Threads

- **Approach**: Unchanged structure; D-1..D-9 stand. Step 0 is the O-1 operator gate; then step 1 portfolio (D-1), step 2 config (D-5/D-6), step 3 Node package hygiene (D-4/D-7/D-9), steps 4-7 marketdata (findings :33), ingest (D-3), agent (findings :34) and ui (D-2), then the final AC-2 verification. Round 3 tightens the AC-2 contract and settles the facts the gate depends on:
  - The @AC-2 amendment rewrites When/Then as well as Given, in the same edit before /sdd-spec (D-10). When becomes "each touched leaf's package.json and the root pnpm-lock.yaml importers are inspected, and git ls-files is searched for the deleted paths"; Then keeps "every affected service still builds and passes its tests". The AC-2 check is scoped: manifests, root-workspace `pnpm why` against written-down expected output, deleted paths absent from `git ls-files`, empty `grep AlpacaAsset`. Never a repo-wide `grep node-pg-migrate`.
  - The four per-service pnpm-lock.yaml files (config, identity, ledger, notify) are not build input; they are neither regenerated nor deleted, and step 3 adds one root docs/context-constitution-findings.md row naming them vestigial and stale (D-11).
  - Because CI installs the Node leaves with --no-frozen-lockfile (ci.yml:564,789,995), the local `pnpm install --frozen-lockfile` and `docker compose build` outputs are required evidence recorded in context.md. No CI guard is added; peer 324 owns CI gaps (D-12).
  - Under (b), identity is a 2-line package.json deletion (:11,55), shares the root lock, has an unconditional compose build gate (docker-compose.yml:181,185), and needs no doc edit (identity CLAUDE.md:118). Expected `pnpm why node-pg-migrate` is zero dependents under (b) and identity-only under (a); `pnpm why bcrypt jsonwebtoken` is identity-only (D-13).
  - Re-grep every anchor at spec time, because peers 322, 311 and 324 may shift lines.
- **Strongest open objection (blocking)**: O-1. The operator must choose identity scope: (a) ledger, config and notify, narrowing root findings :57 to identity-only; or (b) those three plus identity, closing :57 and adding xstockstrat-identity to product-spec Affected Services. Both sides recommend (b), and round 3 removed its remaining cost uncertainty, but a recommendation is not a decision. /sdd-spec stays gated until the choice is recorded here and the @AC-2 Given/When/Then amendment (plus the product-spec amendment under (b)) is on the feature branch.
- **Closed this round**: O-3. The identity C-16 sweep covered all seven suites. The one hit, fix-identity-ledger-test-suites.feature @AC-1 @feature-252, is PRESERVE: its Then clause (:8) is discharged by `pnpm build && pnpm test:coverage`, and its mutation clause (:9) is recorded as unaffected (no src/ change). It applies under (b) and is N/A under (a).
- **Floor status**: no Floor breaches.
- **Uncovered @AC changes**: @AC-1 EXTEND and @AC-2 EXTEND, neither covered by an operator decision yet. PRESERVE: @AC-3, @AC-30, @AC-14, @AC-12, @AC-4, @AC-1@feature-252.

```sdd-batch-design-state
{
  "round": 3,
  "synth": {
    "approach": "The structure is unchanged. D-1..D-9 stand. Step 0 is the O-1 operator gate. Then: step 1 portfolio (D-1), step 2 config (D-5/D-6), step 3 Node package hygiene (D-4/D-7/D-9), steps 4-7 marketdata (findings :33), ingest (D-3), agent (findings :34) and ui (D-2), then the final AC-2 verification. Round 3 settles the facts the gate depends on and tightens the AC-2 contract.\n\n0. GATE (O-1, still blocking, operator only). The operator records (a) or (b) in docs/roadmap/features/323-fix-orphaned-code/context.md before /sdd-spec. Both sides recommend (b); the runner-up is (a).\n- Per D-8, the acceptance.feature @AC-2 amendment lands on the feature branch before any package.json edit appears in a step's Files list. It now rewrites three clauses:\n  - Given (acceptance.feature:14) lists exactly the leaves covered. Under (b): ledger, config, identity and notify node-pg-migrate migrate script and devDependency, plus notify jsonwebtoken and bcrypt. Under (a): drop identity.\n  - When (:15) becomes: \"each touched leaf's package.json and the root pnpm-lock.yaml importers are inspected, and git ls-files is searched for the deleted paths\".\n  - Then (:16) keeps \"every affected service still builds and passes its tests\".\n- Under (b), product-spec Affected Services also gains xstockstrat-identity.\n\n3. Node package hygiene, refined for this round.\n- Under (b), identity is a 2-line deletion: services/xstockstrat-identity/package.json:11 (the \"migrate\" script) and :55 (the node-pg-migrate devDependency).\n- Identity builds from the same root lock (services/xstockstrat-identity/Dockerfile:13,17), so one root-lock regeneration under D-4/D-7 covers all four leaves.\n- The compose gate is unconditional because the target exists (docker-compose.yml:181,185): `docker compose build xstockstrat-ledger xstockstrat-notify xstockstrat-config xstockstrat-identity`. Drop identity from it under (a).\n- No identity doc edit. services/xstockstrat-identity/CLAUDE.md:118 (\"golang-migrate, not node-pg-migrate\") stays true.\n- Root docs/context-constitution-findings.md:57 is closed under (b) and narrowed to identity-only under (a).\n- Expected `pnpm why node-pg-migrate` output, written into the step so drift is mechanically detectable (D-7): under (b), zero dependents across all workspace importers (the root lock today lists it only in the four leaf importers, pnpm-lock.yaml:136,251,360,481); under (a), identity only.\n- Expected `pnpm why bcrypt jsonwebtoken`: identity only. Their packages: entries stay in the root lock because identity uses them (identity package.json:34-35,48-49). Only notify's importer lines go.\n- Per-service locks: services/xstockstrat-{config,identity,ledger,notify}/pnpm-lock.yaml are not build input (Dockerfiles copy only the root lock at :13; no CI, script, hook or pattern-doc consumer). They are neither regenerated nor deleted. Step 3 adds one root findings row in docs/context-constitution-findings.md naming the four files as vestigial and now stale against their manifests. This is doc-only and stays within D-4/D-7.\n- Required evidence: CI installs these leaves with `pnpm install --no-frozen-lockfile` (.github/workflows/ci.yml:564,789,995; the only --frozen-lockfile install is :305), so CI cannot catch a drifted root lock. The step's spec must therefore require the local `pnpm install --frozen-lockfile` output and the docker compose build output as evidence recorded in context.md, not as optional smoke checks. No CI guard is added (Out of Scope; peer 324 owns CI gaps).\n\nC-16 identity sweep under (b): the one hit is services/xstockstrat-identity/acceptance/fix-identity-ledger-test-suites.feature @AC-1 @feature-252 (:4-9), recorded as PRESERVE.\n- Its Then clause (:8) is discharged by identity's `pnpm build && pnpm test:coverage`.\n- Its mutation clause (:9) is recorded as \"unaffected: no src/ change (identityServiceImpl.ts untouched)\", not claimed as discharged.\n- The other six identity suites (fix-identity-auth-code-race, signal-map-instrumentation, fix-push-untargeted-broadcast, otel-metrics-logs-export, user-management-ui, mcp-user-profile-roles) have zero build/dependency hits.\n- This is copied into the spec's Existing Business Rules under (b) and is N/A under (a).\n\nFinal AC-2 verification (presence check, scoped):\n- each touched leaf's package.json has no node-pg-migrate and no \"migrate\" script, and notify's has no jsonwebtoken, bcrypt or @types/ entries for them;\n- root-workspace `pnpm why` matches the expected output above;\n- the deleted paths are absent from `git ls-files`;\n- `grep AlpacaAsset` is empty;\n- the build and test gates pass per service.\n\nThe check must not use a repo-wide `grep node-pg-migrate`, which would report RED because of the stale per-service locks.\n\nSpec-time note: re-grep every anchor, because peers 322, 311 and 324 may shift lines.",
    "open_objections": [
      {
        "text": "O-1 (still open): the operator must choose identity scope, either (a) three leaves or (b) four leaves plus the product-spec Affected Services amendment. Both sides recommend (b), and round 3 removed the remaining cost uncertainty in (b): a shared root lock (identity/Dockerfile:13,17), an existing compose target (docker-compose.yml:181,185) and no doc churn (identity CLAUDE.md:118). A recommendation is still not a decision. /sdd-spec stays gated until the choice is recorded in context.md and the @AC-2 Given/When/Then amendment (plus the product-spec amendment under (b)) is on the feature branch.",
        "blocking": true
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "AC-1",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-2",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-3",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-30",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-14",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-12",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-4",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-1@feature-252",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Delete the PortfolioPanel combined branch (R-1, locked).",
      "Migrate WatchlistRepo and signal_expiry_repo to a mockable handle (R-2, locked).",
      "Change the extractor_module value at fundsignal_loop.py:623 (R-3, locked).",
      "Spin identity's node-pg-migrate removal off into a follow-up bug (R-4, locked).",
      "Resolve the pnpm-lock.yaml conflict with peer 324 by hand (R-5, locked).",
      "Delete the four vestigial per-service pnpm-lock.yaml files in step 3. Lost because it is outside the defect report's ten items, feature 175 deliberately deferred it (175 context.md:14,20), and it adds files to F-08 Files lists. A findings row records it instead.",
      "Regenerate the per-service pnpm-lock.yaml files. Lost because it is unscoped lock churn on files nothing reads, which violates D-7's 'anything else is drift'.",
      "Use a repo-wide `grep node-pg-migrate` as the AC-2 check. Lost because it reports RED after a correct fix, due to the stale per-service locks (e.g. identity lock :90,1112,2595, notify lock :41,47,90).",
      "Narrow the AC-2 check while leaving the scenario's 'repository is searched' When/Then text unchanged. Lost because that is a silent deviation from the acceptance contract (C-15/P-03); the amendment rewrites the When/Then instead.",
      "Add a CI --frozen-lockfile guard for the Node leaves in this feature. Lost because it is out of scope (product-spec Out of Scope) and peer 324 owns CI enforcement gaps; local frozen-install and compose-build evidence is required instead."
    ],
    "open_risks": [
      "The per-service pnpm-lock.yaml files stay stale and now list deps the manifests no longer declare (notify bcrypt/jsonwebtoken/node-pg-migrate; identity node-pg-migrate under (b)). The 'not build input' premise rests on a negative grep plus the four Dockerfiles. The new findings row makes the gap durable, but an unfound consumer would invalidate the premise.",
      "CI installs the Node leaves with --no-frozen-lockfile (ci.yml:564,789,995), so a drifted root lock passes CI and fails only at image build (Dockerfile:17). The mitigation depends on the step recording local frozen-install and compose-build evidence.",
      "Under (b), scope widens into identity. If the product-spec and @AC-2 Given/When/Then amendments do not land before /sdd-spec, the identity package.json edit is off-spec (F-08/P-03).",
      "The lock regen may drop a still-needed transitive package or bring in drift. Mitigation: `pnpm why` expected output (zero dependents under (b)), the expected-diff check, then `pnpm install --frozen-lockfile`.",
      "Collision with peer 324: coverage-script edits sit 2-3 lines from the :11 deletion in all four leaf package.json files, and both features rewrite the root lock. This is handled by merge order plus regenerating after rebase (D-9).",
      "The identity C-16 sweep was keyword-based, so a suite asserting through other terms could be missed. All seven suites were covered.",
      "Config c8 line coverage can shift when configWatcher.ts and its test are deleted together. Re-run --lines 40 after rm -rf dist (D-5).",
      "pgxmock proves the handle and the SQL shape, not live SQL semantics (insights.md:1963).",
      "Peers 322, 311 and 324 may shift line anchors. Re-grep at spec time.",
      "The dangling extractor_module labels stay visible until the separate defect is fixed."
    ],
    "constitution_rules_touched": [
      "C-01",
      "C-08",
      "C-11",
      "C-15",
      "C-16",
      "C-18",
      "F-08",
      "P-03",
      "P-06"
    ],
    "rationale": "The adversary returned SOUND, with no Floor breach and no register violation.\n\nI spot-checked the key facts at main-dev:\n- @AC-2 at acceptance.feature:12-16 still says \"When the repository is searched ... Then none of them exists\", with a Given that names only the ledger migrate script.\n- All four per-service pnpm-lock.yaml files exist.\n- ci.yml has --frozen-lockfile only at :305 and --no-frozen-lockfile at :564,789,995.\n- No context-constitution-findings.md row mentions pnpm-lock.\n- The identity @feature-252 Then and mutation clauses sit at :8-9.\n\nO-3 closes on the proposer's completed sweep, with the adversary's precision note: the mutation clause is recorded as unaffected rather than discharged.\n\nThe adversary's non-blocking points are adopted as decisions:\n- The When/Then extension of the AC-2 amendment refines D-8's scope rather than contradicting it, so no reopen is needed.\n- The vestigial per-service locks get a durable findings row; three prior features (175, 226, 274) stepped around them.\n- Frozen-install and compose-build output are mandatory recorded evidence, given that CI does not check lock freshness.\n- The expected `pnpm why` output is spelled out so D-7 drift is mechanical.\n\nDeleting or regenerating the per-service locks loses on scope (C-18), on the 175 precedent and on D-7. O-1 remains the sole blocker, and only the operator can close it.\n\nRegister honored: D-1..D-9 kept, R-1..R-5 not reintroduced (R-4 explicitly untouched), and no REOPEN petitions from either side.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "Refines D-8: the @AC-2 amendment rewrites the When/Then as well as the Given, in the same edit before /sdd-spec. The When becomes 'each touched leaf's package.json and the root pnpm-lock.yaml importers are inspected, and git ls-files is searched for the deleted paths'. The Then keeps 'every affected service still builds and passes its tests'. The AC-2 presence check is exactly: manifests free of node-pg-migrate/\"migrate\" (and notify jsonwebtoken/bcrypt/@types), root-workspace `pnpm why` matching the expected output, deleted paths absent from git ls-files, and empty `grep AlpacaAsset`. A repo-wide grep is never used.",
          "evidence": "docs/roadmap/features/323-fix-orphaned-code/acceptance.feature:12-16; stale per-service locks services/xstockstrat-notify/pnpm-lock.yaml:41,47,90 and services/xstockstrat-identity/pnpm-lock.yaml:90,1112,2595; C-15/P-03"
        },
        {
          "text": "The four per-service pnpm-lock.yaml files (services/xstockstrat-{config,identity,ledger,notify}/pnpm-lock.yaml) are neither regenerated nor deleted. Step 3 adds one root docs/context-constitution-findings.md row naming them as vestigial and stale against their manifests.",
          "evidence": "Dockerfiles copy only the root lock (:13); no consumer in .github/, scripts/, .husky/ or docs/patterns/; .jscpd.json:32 only ignores them; deferred by 175 (context.md:14,20) and stepped around by 226 (context.md:67) and 274 (context.md:49,91); no existing findings row"
        },
        {
          "text": "Step 3's spec makes the local `pnpm install --frozen-lockfile` output and the `docker compose build` output for the touched leaves required evidence recorded in context.md. No CI guard is added in this feature.",
          "evidence": ".github/workflows/ci.yml:564,789,995 (--no-frozen-lockfile for Node leaves) vs :305; services/xstockstrat-*/Dockerfile:17 (--frozen-lockfile); product-spec Out of Scope; peer 324 owns CI gaps"
        },
        {
          "text": "Under (b): the identity edit is package.json:11,55 only; the identity compose build gate is unconditional; no identity doc edit; expected `pnpm why node-pg-migrate` is zero dependents across all importers (identity only under (a)); expected `pnpm why bcrypt jsonwebtoken` is identity only. The identity C-16 sweep records fix-identity-ledger-test-suites.feature @AC-1 @feature-252 as PRESERVE, with the Then clause discharged by `pnpm build && pnpm test:coverage` and the mutation clause recorded as unaffected (no src/ change).",
          "evidence": "services/xstockstrat-identity/Dockerfile:13,17; docker-compose.yml:181,185; services/xstockstrat-identity/CLAUDE.md:118; root pnpm-lock.yaml:136,251,360,481; identity package.json:34-35,48-49; fix-identity-ledger-test-suites.feature:4-9"
        }
      ],
      "new_rejected": [
        {
          "text": "Delete or regenerate the four vestigial per-service pnpm-lock.yaml files in this feature",
          "why": "Deleting is outside the report's ten items and against the 175 deferral precedent. Regenerating is unscoped churn on files nothing reads (D-7, C-18). A findings row records the gap instead."
        },
        {
          "text": "Use a repo-wide `grep node-pg-migrate`, or the unamended 'repository is searched' wording, as the AC-2 check",
          "why": "It reports RED after a correct fix because of the stale per-service locks; narrowing the check without rewording the scenario is a silent C-15/P-03 deviation"
        },
        {
          "text": "Add a CI --frozen-lockfile guard for the Node leaves in this feature",
          "why": "Out of scope per product-spec; peer 324 owns CI enforcement gaps"
        }
      ],
      "new_objections": [],
      "closed_objections": [
        {
          "id": "O-3",
          "how": "The proposer grepped all seven identity suites. The one hit, fix-identity-ledger-test-suites.feature @AC-1 @feature-252, is PRESERVE: its Then clause (:8) is discharged by `pnpm build && pnpm test:coverage`, and its mutation clause (:9) is recorded as unaffected (no src/ change). The adversary confirmed. It applies under (b) and is N/A under (a)."
        }
      ],
      "reopen_petitions": [],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```

## Session 2026-11-20 — sdd-design

- Operator decision (2026-11-20, design gate): identity scope is option (b) — four leaves (ledger, config, identity, notify) — with the product-spec Affected Services amendment and the @AC-2 Given/When/Then amendment applied on the feature branch. O-1 is closed by this record.
- Amendments applied this session, per D-8/D-10: `acceptance.feature` @AC-2 (Given lists the four leaves' node-pg-migrate migrate script and devDependency; When is now the scoped inspection; Then unchanged) and `product-spec.md` Affected Services (adds xstockstrat-identity, `package.json` only).
- Phase 0 Recon: wrote recon.md (services: config, ledger, notify, marketdata, analysis, ingest, agent, ui, portfolio; key reuse patterns: the pgxmock `NewPortfolioRepoWithDB` test shape, and the feature-175 pure-deletion presence check plus real compile gate).
- Phase 1 Grilling: 3 rounds (full). Chosen approach: seven service-scoped cleanup steps (portfolio r.db swap, config configWatcher deletion, Node package hygiene over four leaves with one root-lock regeneration, marketdata, ingest, agent, ui comment) plus a scoped final AC-2 verification. Rejected: R-1..R-8 (see design.md), notably deleting the PortfolioPanel combined branch and touching the per-service locks.
- Operator approved at the gate after round 3. debate.md State is approved; no reopen petitions were filed, so none needed a verdict.
- Constitution rules touched: C-01, C-08, C-11, C-15, C-16, C-18, F-08, P-03, P-06. Floor breaches: none.
- Business rules (C-16): no CHANGE. EXTEND @AC-1 and @AC-2 (the @AC-2 extension is covered by the operator decision above). PRESERVE @AC-3, @AC-30, @AC-14, @AC-12, @AC-4, @AC-1@feature-252.
- No ledger line: the lock and findings traps are recorded by D-11/D-12 and land as a findings row in step 3.
- Status: spec-ready → design-approved.

## Open Threads

- [ ] Per-service `pnpm-lock.yaml` files stay stale against their manifests; "not build input" rests on a negative grep plus the four Dockerfiles — step 3 (root findings row).
- [ ] CI installs the Node leaves with `--no-frozen-lockfile`, so a drifted root lock fails only at image build — step 3 (record local `pnpm install --frozen-lockfile` and `docker compose build` output here).
- [ ] Identity scope is `package.json:11,55` only; anything more is off-spec (F-08/P-03) — /sdd-spec (step 3 Files list).
- [ ] Lock regeneration may drop a needed transitive package or bring in drift — step 3 (`pnpm why` expected output, expected-diff check, frozen install).
- [ ] Peer 324 edits the same four leaf `package.json` files and the root lock — step 3 and merge (merge-order.md entry; the later-merged feature regenerates after rebase).
- [ ] The identity C-16 sweep was keyword-based — step 3 (identity `pnpm build && pnpm test:coverage`).
- [ ] Config c8 line coverage can shift when `configWatcher.ts` and its test go together — step 2 (re-run `--lines 40` after `rm -rf dist`).
- [ ] pgxmock proves the handle and SQL shape, not live SQL semantics — step 1 (accepted limit; dev smoke test).
- [ ] Peers 322, 311 and 324 may shift line anchors — /sdd-spec (re-grep every anchor).
- [ ] Dangling `extractor_module` labels stay visible until a separate defect fixes them — step 5 (ingest findings `:24` annotation; accepted).

## Session 2026-11-20 — sdd-spec

- Generated implementation-spec.md with 9 steps. Status: design-approved → implementation-ready.
- Tree: `origin/feature/fix-orphaned-code` @ `d97bb9c4` (detached). Every recon anchor was re-grepped at this stamp; all still resolve (peers 322, 311 and 324 have not shifted them).
- Operator decision carried in (2026-11-20, design gate): identity scope is option (b), four leaves; O-1 closed. Step 4's Files list holds `services/xstockstrat-identity/package.json` and nothing else from identity.
- Step numbering differs from design.md: design steps 1–7 map to spec Steps 1+2, 3, 4, 5, 6, 7, 8, and the design's final AC-2 verification is Step 9. The step references in the Open Threads above use design numbering.
- Step shape: Steps 1+2 (portfolio swap + pgxmock tests) are one atomic unit (`**Lands with**`), because the service step's Verification runs the tests the test step adds and they are RED without the swap. Steps 3–7 are pure deletions that each pass their own gate alone; their paired `test` step is Step 9 (declared in `## Step Dependencies`), with the presence-check RED captured pre-edit inside each step. Step 8 (ui) is comment-only and relies on the existing `offline-pnl.spec.ts`.
- Scenario coverage (C-15): @AC-1 → Step 2; @AC-2 → Step 9; @AC-3 → Step 9 (gate also runs in Step 7).
- Key codebase findings:
  - Portfolio: `r.pool` call sites are still `portfolio_repo.go:217,241,341`; `Pool()` at `:55-57` keeps `r.pool`. `CountPositions` has zero non-test callers (portfolio findings `:37`); D-1 settles a swap, so the method is swapped, not deleted.
  - Existing repository tests construct `&PortfolioRepo{db: mock}` (`portfolio_repo_test.go:56`); the new tests use `NewPortfolioRepoWithDB(mock)` because @AC-1's Given names it.
  - Root lock anchors: importers config `:46`, identity `:149`, ledger `:264`, notify `:373`; `node-pg-migrate@7.9.1` at `packages:` `:5209` and `snapshots:` `:11194`. `pnpm why -r node-pg-migrate` (run at the stamp, pnpm 9.15.9) lists exactly the four leaves; `pnpm why -r bcrypt jsonwebtoken` lists identity and notify.
  - CI installs the Node leaves with `--no-frozen-lockfile` at `.github/workflows/ci.yml:522,653,806` (recon cited older lines), so Step 4's local frozen install and compose build stay required evidence (D-12).
  - `fundsignal_loop.py:623` is in `services/xstockstrat-analysis/app/engine/`, not ingest. Unchanged either way (R-3).
  - `scripts/check-watcher-copies.sh:24-26` lists only the ledger, identity and notify watchers, so deleting config's copy does not affect it.
- Spec-time additions beyond recon.md (surfaced here, not silently folded in — P-03): three findings rows that recon did not list are in scope under recon's own teardown rule (recon.md:154) — portfolio findings `:36` (resolve) and `:37` (narrow) in Step 1, and ui findings `:30` in Step 8, which calls the combined branch "effectively unreachable" and is disproved by `AccountContext.tsx:43-48` and `offline-pnl.spec.ts`.
- merge-order.md: Step 4 adds a non-blocking prose note for 323 ↔ 324 in the `:355-363` form (300 ↔ 304 precedent), not a table row, because there is no hard ordering — the later-merged feature regenerates the root lock (D-9, R-5).
- No ledger line: no new cross-feature pattern or trap surfaced; the spec applies insights.md:2935-2957 and fails.md:2386-2390 as written.

## Open Threads

- [ ] Step 4 needs Docker for `docker compose build` of the four leaves; if it is unavailable where /sdd-execute runs, the step blocks rather than skipping the gate (D-12).
- [ ] Step 4's lock diff is expected to be removal-only; any added line or removal outside the `pnpm why`-confirmed closure is drift and stops the step (D-7).
- [ ] Step 4 lists eleven files (above the five-file advisory) because design.md fixes one lock regeneration and same-step doc teardown; expect an advisory warning at `/sdd-review impl-spec`.
- [ ] The three spec-time findings-row additions (portfolio `:36,37`, ui `:30`) go beyond design.md's per-step doc list; confirm or strike them at `/sdd-review impl-spec`.
- [ ] `CountPositions` stays as dead code with an open findings row (`:37`, narrowed) — not in the report's ten items; a separate defect owns its deletion.
- [ ] Peers 322, 311 and 324 may still shift anchors before execution — /sdd-execute re-greps in Phase 1.
- [ ] Post-merge: affected services smoke-tested on dev (product-spec Acceptance Criteria); not a step.

## Session 2026-11-20 — sdd-review impl-spec (advisory)

- Result: 0 failures, 7 criteria warnings, overlap WARN (4 file-level collisions, no FAIL) — advisory, did not block. No Floor breaches. Lifecycle unchanged (implementation-ready).
- Tree: `origin/feature/fix-orphaned-code` @ `1a416f7c` (detached); peer 322 read at `origin/feature/fix-retired-surface-proto-cleanup` @ `e1c1f040`.
- Addressed in implementation-spec.md:
  - [x] Steps 2, 5 and 9: `GOWORK=off COVERPKGS=$(go list …) && go test …` did not pass `GOWORK=off` to `go list` or `go test` (a bare prefix before an assignment sets an unexported shell variable). Each Go command now carries its own prefix: `COVERPKGS=$(GOWORK=off go list …) && GOWORK=off go test …`. A `## Step Dependencies` bullet states the rule.
  - [x] Spec-time findings rows confirmed by re-reading the files: portfolio findings `:36` (the `r.pool` → `r.db` half-migration) and `:37` (`CountPositions` has zero non-test callers), ui findings `:30` (the `PortfolioPanel.tsx` combined fall-through). `AccountContext.tsx:43-48` (`firstActive?.id ?? null`) supports the Step 8 "reachable" claim. The spec records the confirmation; this closes the "confirm or strike" thread from the sdd-spec session.
  - [x] Overlap with peer 322 on config's `configWatcher.ts`: 322's impl spec modifies `src/services/configWatcher.ts` (its Step 29) and `src/__tests__/configWatcher.test.ts` (its Step 30), which Step 3 deletes. `## Step Dependencies` now states that the deletion wins in either merge order, and that 322's Step 27 (`alpaca/client.go:50,94-98,113`) is disjoint from Step 5 (`:653-661`).
- Accepted as written (no spec change; recorded decisions):
  - Step 4 lists 11 files, above the 5-file advisory — design.md fixes one lock regeneration with same-step doc teardown.
  - Steps 1+2 are one red-to-green commit (`**Lands with**`); Step 1's "write Step 2's tests first" instruction is the RED capture.
  - Steps 3–7 are pure deletions paired with the trailing Step 9, which re-runs checks and adds no source (declared in `## Step Dependencies`).
  - Step 8 has no Playwright step of its own; existing `e2e/trader/offline-pnl.spec.ts:109-119,195-205` runs in its Verification.
  - `CountPositions` is swapped, not deleted (D-1; C-18 trade-off recorded).
- Overlap findings (all WARN): `portfolio_repo.go` with 311 (`:217,241,341` here vs `:66` there, distinct lines); config `configWatcher.ts` with 322 (delete vs modify); `alpaca/client.go` with 322 (distinct lines); the four leaf `package.json` files and root `pnpm-lock.yaml` with 324. No migration NNN, proto field or config key collision.

## Open Threads

- [ ] Peer 322 Steps 29–30 modify the config `configWatcher.ts` and its test that Step 3 deletes; 322's spec does not yet know about the deletion. If 322 merges first, resolve the modify/delete conflict as delete at rebase; if 323 merges first, 322 must re-spec those two steps — Step 3 and merge. The 322 edit belongs to the 322 writer (this feature may not edit 322's files).
- [ ] Peer 311 edits `portfolio_repo.go:66`; same file as Step 1, distinct lines, merge-conflict risk only — Step 1 (re-grep `r.pool` in Phase 1).
- [ ] Peer 324 edits the same four leaf `package.json` files and the root lock — Step 4 (merge-order.md prose note; the later-merged feature regenerates the lock).
- [ ] Step 4 has 11 files and needs Docker for `docker compose build`; if Docker is unavailable the step blocks, it is not skipped (D-12) — Step 4.
- [ ] Step 9 is a verification-only `test` step (no new source); the per-step presence checks in Steps 3–7 are the RED evidence it re-runs — Step 9.
- [ ] `CountPositions` stays as dead code with findings row `:37` narrowed and open; a separate defect owns its deletion — Step 1.
- [ ] Peer impl specs other than 322's were not read at file level (311 and 324 overlap is from their product specs and context.md) — /sdd-execute Phase 1 re-grep.

## Session 2026-11-26 — sdd-spec re-spec (operator ruling: split Step 9 by surface)

- Trigger: an `/sdd-execute` preflight blocker. Step 9's `**Service**` listed backend services and `xstockstrat-agent` together, and the surface rule (`.claude/skills/sdd-execute/reference/sequential-mode.md` §5.5b: `xstockstrat-ui` → `ui`, `xstockstrat-agent` → `agent`, everything else → `backend`) maps one step to one surface. Operator ruling (2026-11-26): split the step. `implementation-spec.md` now has 10 steps; `feature.md` (Artifacts line, Reviewers step refs, Last Updated) is updated. Status stays `implementation-ready`.
- Tree: `origin/feature/fix-orphaned-code` @ `42776a1f`. `main-dev` had moved far past the 2026-11-20 stamp (`d97bb9c4`), so every anchor in every step was re-grepped, not only the split step's. Nearly all line numbers shifted (portfolio repo, ci.yml, findings rows, root lock `packages:`/`snapshots:`); the step bodies carry the new ones. Other drift fixed: `scripts/check-watcher-copies.sh` is now `.py`; the four service `CLAUDE.md` "not node-pg-migrate" lines are gone; `scripts/run-e2e.sh` is `scripts/run-e2e.py`; ui `build` now chains `checkThemeBundle.cjs`; `merge-order.md` now mentions 323 at `:129` and `:420-426`, so Step 4's "absent" grep is scoped to `Textual overlap: 323`.
- New step map (surface in brackets): 1 portfolio service [backend] + 2 portfolio test [backend] (the only atomic unit, `**Lands with**`); 3 config delete [backend]; 4 Node leaves + root lock [backend]; 5 marketdata [backend]; 6 ingest [backend]; **7 backend verification [backend]**, `**Covers**: AC-2`; 8 agent delete [agent] (old Step 7); **9 agent verification [agent]**, `**Covers**: AC-2, AC-3`; 10 ui comment [ui] (old Step 8). Renumbering: old 1–6 unchanged, old 7 → 8, old 8 → 10, old 9 → 7 (config, ledger, identity, notify, marketdata, ingest, item-5 evidence in analysis) plus 9 (agent). Surfaces are contiguous (`backend` 1–7, `agent` 8–9, `ui` 10), so `/sdd-execute sequential` checkpoints fall at: step cap after Step 5 (Steps 1+2 count as two), surface boundaries after 7 and 9, feature end after 10.
- Scenario coverage (C-15): @AC-1 → Step 2; @AC-2 → Step 7 (backend items) and Step 9 (agent item); @AC-3 → Step 9 (gate also runs in Step 8). Step Dependencies and the Execution Summary were rewritten; no step now exceeds the 4-step unit cap and none crosses a surface.
- Earlier session entries and their Open Threads above keep the old numbering (append-only): read their "Step 7" as 8, "Step 8" as 10, and "Step 9" as 7 plus 9.
- Self-review (no subagent tool available in this session, so this was a hand review against `impl-spec-criteria.md` §B2, §B3 and §B3b, not a `spec-reviewer` run): evidence populated and re-grepped for all 10 steps; every `**Verification**` is a runnable command with the threshold stated (c8 `--lines 40`, Go ≥ 40%, `--cov-fail-under=40`); every non-frontend `service` step has a paired `test` step (2 for 1, 7 for 3–6, 9 for 8); `**Lands with**` is symmetric, adjacent, single-surface, 2 members. One FAIL remains and is not fixable by this re-spec: Step 8 matches the §C trigger "deletes a referenced resource" without a step that repoints the references (O-1 below). Everything else passes; the earlier advisory warnings (Step 4 has 11 files; Steps 3 and 6 have 6) stand as accepted.
- New findings (both caused by feature 355, now `launched`, which `merge-order.md:129` made 323 wait for):
  - O-1: `services/xstockstrat-agent/app/prompts/signal_extraction.md` is read by three assertions in `services/xstockstrat-agent/tests/test_extraction_instructions.py` (`:298`, `:305`, `:319`) and asserted by durable `@AC-15 @feature-355` in `services/xstockstrat-agent/acceptance/mediated-source-extraction-instructions.feature:54-59`. 355's recorded decision (its `context.md:23`) and `merge-order.md:129` say the edit-vs-delete conflict "resolves as a delete" but do not cover those assertions. Step 8 carries a blocking precondition and was not otherwise changed.
  - O-2: `merge-order.md:129` says 323 "re-decides `noop.py` against what 355 shipped". 355 added `_MEDIATED_EXTRACTOR_MODULE = "app.extractors.noop"` (`services/xstockstrat-ingest/app/handlers/servicer.py:78`), stored on every mediated source and never imported. Step 6 keeps the delete (D-3, R-3); the re-decision is unrecorded.

## Open Threads

- [ ] O-1: operator to rule on `signal_extraction.md` — delete it and retarget or remove the three agent test assertions plus durable `@AC-15` (explicit sign-off, C-15/C-16), or keep the file and drop Step 8. After the ruling, re-spec Step 8 (list the test and acceptance edits in `**Files**`, add `**Lands with**` to the repointing step) and re-run `/sdd-review fix-orphaned-code impl-spec` — Step 8, Step 9.
- [ ] O-2: operator to confirm that `noop.py` is still deleted now that 355 stores its dotted name on every mediated source — Step 6.
- [ ] Peer 322's impl spec (`origin/feature/fix-retired-surface-proto-cleanup` @ `e1c1f040`) was not re-read at this re-spec; its Step 27 (`alpaca/client.go`) still needs a re-grep against Step 5's `:817-825` at execute time — Step 5.
- [ ] Step 4 still needs Docker for `docker compose build` and still lists 11 files (accepted earlier) — Step 4.

## Session 2026-11-26 — operator rulings O-1 and O-2, recorded by the orchestrator (verbatim)

Two rulings on the open items the previous re-spec raised, relayed by the orchestrator.

**O-1.**

- Question (verbatim): "323 (fix-orphaned-code), Step 8 blocker (found by the re-spec): the step deletes services/xstockstrat-agent/app/prompts/signal_extraction.md as an orphan, but feature 355 (now launched) made agent tests read that file (tests/test_extraction_instructions.py :298, :305, :319) and the durable scenario @AC-15 @feature-355 asserts its content. Deleting it as specced turns three agent tests red. What should 323 do?"
- Answer (verbatim): "Keep the file, drop that step (Recommended)" — option text: "The file is no longer orphaned (355 tests and @AC-15 depend on it): remove the deletion from 323's scope, record why, no durable-suite change."

**O-2.**

- Question (verbatim): "323, Step 6 (ingest orphan extractors): merge-order.md:129 says 323 must re-decide noop.py against what 355 shipped. 355 added _MEDIATED_EXTRACTOR_MODULE = "app.extractors.noop" at services/xstockstrat-ingest/app/handlers/servicer.py:78, stored on every mediated source but never imported. Step 6 currently deletes noop.py with the other orphan extractors. What should 323 do with noop.py?"
- Answer (verbatim): "Keep noop.py (Recommended)" — option text: "It is the module name every mediated source stores (the string is a data reference even though it's never imported); deleting the file leaves a dangling module path. Drop it from Step 6's deletions and record why."

### Changes applied to `implementation-spec.md` and `feature.md` (now 9 steps)

- The agent deletion step (the previous Step 8) is removed. The agent surface keeps one step: the former agent verification, now **Step 8**, a regression check with `**Covers**: AC-3` (`green` run of `tests/test_config_watcher.py` and the agent gate; the `red N/A — no behavior change` escape is stated, since no agent file changes). The ui comment step is now **Step 9**. New map: 1+2 portfolio (backend, one unit), 3 config, 4 Node leaves, 5 marketdata, 6 ingest, 7 backend verification (all backend), 8 agent regression check (agent), 9 ui comment (ui). One surface per step; the only unit is still 1+2, under the 4-step cap. `/sdd-execute sequential` checkpoints: step cap after Step 5, surface boundaries after 7 and 8, feature end after 9.
- Step 6 no longer deletes or lists `noop.py`; it still deletes `example_simple_email.py` and `tests/test_extractor.py` and trims the five non-MCP dataclasses (`RawInput = McpClientInput`; `noop.py` keeps importing `BaseExtractor` and the `RawInput` name, both left in place). Its Verification now asserts `noop.py` is still tracked, drops `NoopExtractor` from the "no output" grep, and its findings instruction resolves `:22` for the example extractor and dataclasses while narrowing the row to `noop.py` as kept (O-2). `tests/test_extractor.py` still goes whole: its noop tests (`:82`, `:132`) build the five dataclasses the step removes, so they cannot be kept without rewriting them, which the ruling did not ask for.
- Step 7's file-presence check drops `noop.py` (and asserts it is kept); its `**Covers**` line records the exclusion.
- Execution Summary, Scenario Coverage, Step Dependencies and the C-14 text were rewritten for the new numbering; the findings-row references to the ui step now say Step 9. All affected greps were re-run on the 2026-11-26 tree; no anchor changed (this re-spec only removes scope).
- Self-review (no subagent tool in this session, so a hand review against `impl-spec-criteria.md` §B2, §B3, §B3b, not a `spec-reviewer` run): evidence present and re-grepped for the changed steps; every `**Verification**` is a runnable command with its threshold stated; non-frontend `service` steps 1, 3–6 each have a paired `test` step (2, 7); Step 8 is a test step with no service step by design (stated in Step Dependencies); `**Lands with**` is symmetric, adjacent, one surface, two members. The earlier B3b FAIL on the agent deletion is gone with the step. No FAIL remains; the earlier advisory warnings stand (Step 4 lists 11 files; Steps 3 and 6 list 6).

### Still open (not edited by this session)

- `acceptance.feature` `@AC-2` still names `noop.py` and `signal_extraction.md` in its Given and says "none of them exists", which can no longer be true. Step 7 covers `@AC-2` for every other listed item. Scenarios were not edited; the operator needs to approve an amendment (drop those two names from the Given), or accept the scenario as partially covered. `@AC-3` is covered by Step 8 and `@AC-1` by Step 2 as before.
- `merge-order.md:129` (the 323 ↔ 355 row) describes a delete-vs-edit conflict that the rulings dissolved, and 355 is `launched`; the row likely needs updating or removal by whoever owns that file. Not edited here.
- `product-spec.md`, `design.md` (D-3) and `feature.md`'s Summary ("Ten orphaned modules…") still count the two kept files among the deletions; `docs/reports/2026-10-19-orphaned-code-defect.md` items 6 (the `noop.py` half) and 8 therefore stay unresolved when 323 merges.
- `services/xstockstrat-agent/docs/context-constitution-findings.md:36` still says `signal_extraction.md` is "still unreferenced"; 355's tests now read it. No step edits agent docs.
- `noop.py` is left without a dedicated test once `tests/test_extractor.py` is deleted; the operator may want a minimal replacement test or accept that.
- Peer 322's impl spec was not re-read; its Step 27 (`alpaca/client.go`) needs a re-grep against Step 5's `:817-825` at execute time. Step 4 still needs Docker for `docker compose build`.

## Session 2026-11-26 — operator ruling on AC-2 and noop.py test, recorded by the orchestrator (verbatim)

- Question (verbatim): "323 follow-up from the re-spec: @AC-2 in 323's own acceptance.feature still says the files noop.py and signal_extraction.md (among the orphans) no longer exist, which can't be true now that you chose to keep both. Also the spec still deletes tests/test_extractor.py whole, which leaves noop.py with no test. How should I handle these?"
- Answer (verbatim): "Amend @AC-2, add a noop test (Recommended)" — option text: "Reword @AC-2 (same ID, Given/When unchanged) to list only the files actually deleted, and add a minimal replacement test for noop.py in Step 6 so it is not left untested. Recorded with your answer; 323 then needs a small re-spec and re-review."

### Changes applied (the spec stays at 9 steps; no renumbering)

- `acceptance.feature` `@AC-2`: ID, tags, title, Given and When unchanged (C-15 append-only IDs holds). The Then is split in three lines: the deleted items (configWatcher.ts and its test, the four migrate scripts and `node-pg-migrate` devDependencies, notify `jsonwebtoken`/`bcrypt`, `AlpacaAsset`, `example_simple_email.py`, `tests/test_extractor.py`), "ingest noop.py and agent signal_extraction.md still exist", and the build-and-test line. A comment above the tag records the amendment. The title still reads "are gone"; only the Then was reworded, as ruled.
- Step 6: new file `services/xstockstrat-ingest/tests/test_noop_extractor.py` (confirmed absent; created from scratch). Three tests replace the noop assertions in the deleted `test_extractor.py` (`:83-84`, `:86-111`, `:124-128`, `:132-143`) without any of the five removed dataclasses: `issubclass(NoopExtractor, BaseExtractor)`; `import_module(servicer_mod._MEDIATED_EXTRACTOR_MODULE).NoopExtractor is NoopExtractor` (pins the label 355 stores to the kept module); `await NoopExtractor().extract(McpClientInput(result_items=[...])) == []`. Pattern: `tests/test_mcp_client_extractor.py:9-12,48`, `asyncio_mode = "auto"` (`pyproject.toml:34`), `from app.handlers import servicer as servicer_mod` (`tests/test_seed_source_templates.py:17`). TDD note in the step: a characterization test of kept code has no RED; GREEN pre-edit, and it must stay GREEN after the `base.py` trim (it guards `noop.py`'s `BaseExtractor`/`RawInput` imports). Verification adds the test run and a `grep -c` of 3. The pairing is unchanged (service Step 6, paired test Step 7, whose ingest pytest run now includes it); no unit grows.
- Scenario Coverage: `@AC-2` → Step 7 (deleted items, `noop.py` kept) and Step 8 (`signal_extraction.md` kept); `@AC-3` → Step 8; `@AC-1` → Step 2. Step 8 now has `**Covers**: AC-2, AC-3` with a `git ls-files` check that the prompt remains; Step 7's `**Covers**` says "backend part".
- Counting text: the Execution Summary, the re-spec findings list (the `@AC-2` open item is removed) and `feature.md`'s Summary ("Ten orphaned…" now says two were later kept, eight removed) are updated.
- Self-review (no subagent tool in this session, so a hand review against `impl-spec-criteria.md` §B2, §B3, §B3b, not a `spec-reviewer` run): every new anchor was grepped; the new test's two non-servicer tests were run locally (the async one needs `pytest-asyncio`, and the servicer import needs `asyncpg` and generated stubs, neither installed in this sandbox, so the full file was not run here and is first run by `/sdd-execute`); `ruff check` and `ruff format --check` on the file passed; every `**Covers**` ID exists in `acceptance.feature`; every scenario is covered; no FAIL.

### Stale text not edited (this ruling did not authorize it)

- `product-spec.md` and `design.md` (D-3 and its `noop.py` rationale) still list the `noop.py` and `signal_extraction.md` deletions and the "ten items" scope.
- `docs/reports/2026-10-19-orphaned-code-defect.md` items 6 (the `noop.py` half) and 8 stay open when 323 merges.
- `merge-order.md:129` (the 323 ↔ 355 row) describes a conflict that no longer exists.
- `services/xstockstrat-agent/docs/context-constitution-findings.md:36` still says the prompt is "unreferenced".

## Open Threads

- [ ] Run `/sdd-review fix-orphaned-code impl-spec` again on the amended spec (operator ruling asks for a re-review) — all steps.
- [ ] Stale text above (`product-spec.md`, `design.md`, defect report, `merge-order.md:129`, agent findings `:36`) needs a decision on who edits it — Step 6, Step 8.
- [ ] `tests/test_noop_extractor.py` was not run end to end in the spec session; confirm GREEN pre-edit and post-trim at execute — Step 6.

## Session 2026-11-26 — independent impl-spec review (spec-reviewer), recorded by the orchestrator

- Verdict: **PASS WITH WARNINGS**, no blockers (independent spec-review of the 9-step spec at `f3ac2b05`).
- Changes in `implementation-spec.md`:
  - Step 8 `**TDD**` now reads `N/A (verification-only: no agent file or test changes; commands are green before and after)`; the "characterization test added" escape never applied to it.
  - Step 6 `**TDD**` now uses the tdd-gate escape wording `red N/A — no behavior change; characterization test added` (`.claude/skills/sdd-execute/reference/tdd-gate.md:55-58`); the deletions' RED stays the presence check. Its Verification gained an optional mutation proof (drop the `RawInput = McpClientInput` line, expect `tests/test_noop_extractor.py` RED, re-insert it).
  - Steps 7 and 8 `**Covers**` are bare ID lists (`AC-2`; `AC-2, AC-3`); the "backend part / agent part" split moved into their Instructions.
  - Step 6 now states why it lists six files (the dataclass trim breaks `tests/test_extractor.py` and the example extractor, so trim, both deletions and the replacement test land in one green commit; the findings and constitution edits are same-step teardown).
- Stale siblings were not rewritten. Supersession notes (`Superseded 2026-11-26 by operator rulings O-1/O-2: signal_extraction.md and noop.py are kept; see context.md`) were added as HTML comments at `product-spec.md:22`, `:24` and `:45`, above the two affected step paragraphs in `design.md` (D-3's ingest step and the agent step), and as an appended ruling note after the Settled Decisions table in `debate.md` (the settled D-3 row is untouched). `feature.md`'s Summary was already corrected in the previous session and is not stale.
- Still open: the other warnings from the review beyond these five items were not relayed to this session; `merge-order.md:129`, defect report items 6 and 8, and agent findings `:36` remain as listed in the previous section.

## Session 2026-11-26 — sdd-execute sequential (sdd-batch-execute)

- Up-front confirmation: the operator approved the plan with this record (binding, verbatim):
  `{"mainDev":"f802b184b13bd899d858c4b0349a616e9981b9d9","dev":"22f1e38c35c98c129af7918575089d0008b95228","specHash":"04a3135e53af15a167e50e30b9358a1c61303f5b","directive":"conditional","pending":[1,2,3,4,5,6,7,8,9],"mismatches":[{"n":1,"detail":"The UpdatePositionBracket call site is now services/xstockstrat-portfolio/internal/service/portfolio_service.go:1755, not :1747. Everything else matches: r.pool at :57/:247/:271/:379, queryRower :23-27, struct :30-35, constructors :46/:50-52, Pool() :56-58, Ge"},{"n":3,"detail":"services/xstockstrat-config/CLAUDE.md anchors have shifted on the merged tree. The WaitForSnapshot line is now :72 (spec says :68) and the APPLICATION_ENV line that Instruction 4 rewords is now :119 (spec says :114). All other Step 3 anchors match: configWatch"},{"n":4,"detail":"docs/roadmap/features/merge-order.md anchors are off by one. The 300↔304 precedent section is :363-373, not :362-371, and the 347/322/323 Alpaca overlap is :421-426, not :420-426. The claim that 324 is not mentioned is false: line :390 names fix-ci-enforcement"},{"n":5,"detail":"The git grep for AlpacaAsset (excluding docs/roadmap/features and docs/reports) also hits services/xstockstrat-trading/docs/context-constitution-findings.md:37, an old resolved note. The spec says there are only three hits. It is docs-only, and Step 5's Verifi"},{"n":6,"detail":"servicer.py anchors have shifted. The _MEDIATED_EXTRACTOR_MODULE constant is still at :78 with its comment at :77, but it is used at :1807 and :1903, not :1698/:1794. The extractor_module store sites are :1810-1812, :1862 and :1902-1905, not :1701-1703, :1753 "},{"n":8,"detail":"register_prompts is now at services/xstockstrat-agent/app/tools.py:2752, not :2749. Everything else matches: app/config contents, the importers (main.py:94,226, client.py:1145, tools.py:79, oauth_server.py:28), watcher.py:13, tools.py:89, main.py:87, test_extr"}]}`
- Merged `origin/main-dev` @ `f802b184` into `feature/fix-orphaned-code` (`f08066ed`; no conflicts, ledger-guard clean).
- Re-spec (directive conditional), only the drifted anchors in steps 1, 3, 4, 5, 6 and 8, each re-grepped on the merged tree:
  - `e7af7f66` respec(fix-orphaned-code): align steps 1,3,4,5,6,8 with current codebase
- Not re-spec'd (outside the step bodies): `## Step Dependencies` still cites `merge-order.md:420-426`; the live section is `:421-426`.
- Tooling setup (steps 1-9): go1.27 ✓ · golangci-lint ✗ v2.5.0 present (the per-step install `GOTOOLCHAIN=go1.27.0 go install …@v2.14.0` is documented) · python 3.13 ✓ · uv ✓ · pnpm ✓ 9.15.9 · node v22 (Node 24 pinned; no `engines` constraint) · docker ✓ CLI.
- Step 4 changes four `package.json` dependency sets and regenerates the root `pnpm-lock.yaml`. Under the sdd-batch-execute rule it must run through `/sdd-execute` outside `/sdd-batch-execute`.

```sdd-batch-setup
{"mainDev":"f802b184b13bd899d858c4b0349a616e9981b9d9","date":"2026-11-26"}
```

## Session 2026-11-27 — sdd-execute sequential (sdd-batch-execute), steps 1+2

- Tooling setup (steps 1+2): go1.27 ✓ · golangci-lint ⬇ v2.14.0 (`GOTOOLCHAIN=go1.27.0 go install`, built with go1.27.0, at `/root/go/bin`; `/usr/local/bin` still holds v2.5.0, so the verification runs put `/root/go/bin` first on `PATH`).
- Discovery re-verified at `origin/feature/fix-orphaned-code` @ `b0ee4e61`: `r.pool` at `portfolio_repo.go:57,247,271,379`; callers `portfolio_service.go:1212` (`GetSnapshot`), `:1755` (`UpdatePositionBracket`); `CountPositions` has none; findings rows `:37`, `:38`; the three tests absent.

### Step 1 — service: portfolio — move the three `r.pool` stragglers to `r.db` [done]
- Atomic unit steps 1+2. `GetSnapshot`, `CountPositions` and `UpdatePositionBracket` now use `r.db`; `Pool()` still returns `r.pool`. Portfolio findings `:37` marked `**RESOLVED (feature 323)**`; `:38` narrowed to "zero non-test callers" (kept open).
- Files modified: `services/xstockstrat-portfolio/internal/repository/portfolio_repo.go`, `services/xstockstrat-portfolio/docs/context-constitution-findings.md`
- Verification: `grep r\.pool` → only `57:	return r.pool`; build, vet, the three tests and `golangci-lint` (v2.14.0, `0 issues.`) pass.
- Deviations: none

### Step 2 — test: portfolio — pgxmock tests for `GetSnapshot`, `CountPositions`, `UpdatePositionBracket` [done]
- Atomic unit steps 1+2. Added `TestGetSnapshot_UsesMockableDB` (subtests `row_returned`, `mock_error`), `TestCountPositions_UsesMockableDB` and `TestUpdatePositionBracket_UsesMockableDB`, each on `NewPortfolioRepoWithDB(mock)`.
- TDD: AC-1 red: each test panicked with `invalid memory address or nil pointer dereference` in `pgxpool.(*Pool).Acquire(0x0, …)` from `portfolio_repo.go:247`, `:271`, `:379` → green: all three pass with both subtests listed; full race suite ok, coverage `total: (statements) 79.1%` (≥ 40%), `golangci-lint` `0 issues.`
- Files modified: `services/xstockstrat-portfolio/internal/repository/portfolio_repo_test.go`
- Deviations: none
