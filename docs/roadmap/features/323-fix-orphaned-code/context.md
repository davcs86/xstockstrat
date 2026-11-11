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
