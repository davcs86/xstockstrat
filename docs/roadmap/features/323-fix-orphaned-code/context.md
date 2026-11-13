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
