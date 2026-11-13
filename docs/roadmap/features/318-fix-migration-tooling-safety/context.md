# Context Log: fix-migration-tooling-safety

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-10 (/sdd-triage)

- Bug reported via defect reports (clustered triage):
  - docs/reports/2026-10-07-db-migrate-dirty-recovery-replay-unsafe-defect.md (SEV-2)
  - docs/reports/2026-10-19-config-seed-migration-late-lower-nnn-defect.md (SEV-3)
- Cluster rationale: both are golang-migrate version-tracking hazards in the shared migrator tooling
  (`scripts/db-migrate.sh` + CI) where a persistent DB's stored version diverges from what a fresh DB proves.
- Severity: SEV-2 (highest of cluster)
- Routed to SDD path (Track C); prod-impacting SEV-2 routed to C by operator decision 2026-11-10
- Created: status.md, feature.md, product-spec.md, acceptance.feature (2 regression scenarios), context.md
- Affected services (from reports): platform tooling; migration dirs of indicators, ingest, identity, config,
  portfolio, analysis (and all `services/*/migrations` for ordering)
- Root cause hypothesis: `force 0` recovery assumes idempotent up-files (partially guarded by feature 225's contract
  floor); forward-only migrator + pre-reserved numbers + no CI ordering gate.
- Recommended design depth: full → `/sdd-design fix-migration-tooling-safety` (rationale: SEV-2, migration-tooling / schema-adjacent, spans
  every service's migration dir)
- Development branch: feature/fix-migration-tooling-safety

## Session 2026-11-10 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings: bug-template conventions (no FR-N/@FR tags; no Consumer Surface section); AC-1 Then is a disjunction (pin after OQ1); no below-contract-floor scenario; AC-2 assumes CI gate (OQ2)
- Overlap findings: WARN: .github/workflows/ci.yml with 298 (migration-contract-gate job — highest-risk pair), 297, 324; all migration dirs
- Recommended design depth: full (migration tooling across all services; ci.yml overlap with 298)
- Tree: ccr-500a9eb9-nvk45x (origin/main-dev 0fecb24d + triage/docs commits; no feature branch yet)

## Session 2026-11-11 — sdd-batch design gate (round 2)

`/sdd-design fix-migration-tooling-safety` is running in full mode and has stopped at its approval gate after round 2 (gate policy: halt). design.md has not been written and status.md has not changed. The debate register is in `debate.md`: D-1..D-8, R-1..R-6, O-1..O-6.

### Open Threads

- **Approach (round-2 synthesis).** It builds on D-1..D-4 and adds D-5..D-8.
  - The migrator's `force 0` arm is removed. The dirty arm calls `scripts/migration-dirty-guard.sh` to print recovery text, then always exits 1.
  - The guard drops the floor scan and fails closed with exit 2 in three cases: an empty dir, no file n, or n above the local max.
  - Recovery text is keyed to the observed schema state. Depending on that state it prints `force <prev>` (or `TRUNCATE public.<schema>_schema_migrations` when file n is the lowest up-file), `force <n>`, or `force <next>`. `prev` is the highest existing NNN below n.
  - A new `scripts/check-migration-order.sh` runs in `migration-contract-gate`. It checks additions only (no renames) against the tip of base, bans deletes and duplicate NNNs, and passes `--forbid-new` on PRs into `main` from any head other than `main-dev`.
  - Tests: the guard fixtures are fixed. Two new tests are added, `db-migrate.test.sh` and `check-migration-order.test.sh`.
  - Docs: `docs/patterns/database.md` gets the forward-only rule and the state-keyed recovery procedure.
  - `migration-ahead-check.sh` keeps n-1, with reworded text and a findings entry.
- **Strongest open objection (blocking): O-1.** The operator must choose between two recovery policies: refuse-all, which is recommended, or auto `force <prev>` + `up`. The choice must be recorded here. If refuse-all is chosen, the record must say it overrides the product-spec's "without manual intervention" outcome. Choosing auto-recovery would need a REOPEN of D-1.
- **Other blocking objections.**
  - O-3: C-16 sign-off for reversing @AC-19 and rewording the last clause of @AC-28. The @AC-19 replacement must include concrete examples: a gap (previous existing version), the first file (TRUNCATE), and an empty dir (exit 2).
  - O-4: confirm that hotfix PRs into `main` carry no migration (enforced by CI via `--forbid-new`), rather than renumbering unpromoted main-dev migrations.
- **Closed this round.**
  - O-2: no NilVersion form is printed.
  - O-6: no durable @AC pins the header exit-2 paths.
  - O-5: recommend branch protection "up to date before merge" on `main-dev` and `main`.
- **Floor status.** No Floor breaches.
- **Uncovered @AC changes.** None of these are covered by an operator decision yet:
  - @AC-19: CHANGE
  - @AC-28: CHANGE
  - @AC-27: EXTEND
  - @AC-18, @AC-25, @AC-12: PRESERVE
- **Notable risks.**
  - Refuse-all wedges PRE_DEPLOY on any transient dirty state.
  - Two golang-migrate 4.17.1 behaviours are unverified: NilVersion after TRUNCATE, and a loud failure on a duplicate version.
  - The `migration-contract-gate` job in ci.yml may collide with peer 298 at merge time.
  - The forward-only rule conflicts with the insights.md:900 NNN pre-assignment.

```sdd-batch-design-state
{
  "round": 2,
  "synth": {
    "approach": "The round-1 synthesis stands: Steps 1–4 resting on D-1..D-8. This round adds only what is needed to close O-2 and to correct the O-1 fallback.\n\nSTEP 1: CONFIG. Unchanged (D-1, D-2, D-3).\n- Pre-merge cert precondition, now mostly closed by evidence:\n  - Deployed leaves are not hand-minted. scripts/do-render-app-spec.py:39-70 (`mint`) decodes the env CA through mtls-provision.sh (:44) and runs scripts/gen-dev-certs.sh (:53-62) on every render.\n  - gen-dev-certs.sh:50 emits `subjectAltName = DNS:${svc}`, so DO staging and prod trading leaves carry DNS SAN xstockstrat-trading.\n  - Live corroboration: the GetSecret grant `peerSan: 'xstockstrat-marketdata'` (authz.ts:141) already passes in production at marketdata startup.\n  - The one residual pre-merge check is homelab only, and only if its leaf render path differs (inter-service-mtls-rollout.md:33-34 says the CA is shared; the leaf path is unconfirmed). Step 1 lists it as a check, not a code change.\n\nSTEP 2: IDENTITY. D-4 as before, plus one OTel counter.\n(a) Counter definition. In services/xstockstrat-identity/src/telemetry.ts, next to the existing failure counters (:340-374), add:\n- `const revokeUnverifiable = new BoundCounter('identity.revoke.unverifiable', { description: 'RevokeToken calls ignored because the token failed signature verification (forged, malformed, or pre-rotation)' })`\n- `export function recordRevokeUnverifiable(): void { revokeUnverifiable.add(1); }`\n- The counter has no labels.\n(b) Where it increments. revokeToken's inner verify-catch calls recordRevokeUnverifiable() next to the WARN.\n- The missing-JWT_SECRET path does not increment it. That path stays code 13 through the outer catch, with the existing validateFailures{secret_missing} as its signal.\n(c) The WARN. It is the fixed message 'RevokeToken: unverifiable token ignored', optionally with the verify error class name.\n- No token, decoded payload or user_id goes into it (identity CLAUDE.md Observability rule).\n- A test asserts the WARN fields.\n(d) Allowlist test, services/xstockstrat-identity/src/__tests__/telemetryAllowlist.test.ts. Both edits are now concrete (verified this round: MIN_INSTRUMENTS at :31-38, drive() at :41-49):\n- add 'identity.revoke.unverifiable' to MIN_INSTRUMENTS;\n- add telemetry.recordRevokeUnverifiable() to drive().\nThis puts the new instrument under the closed-label/forbidden-key gate.\n(e) Counter test, using src/__tests__/fixtures/collectingReader.ts:\n- the counter rises by 1 for AC-2's unsigned-token call;\n- it rises by 0 for the expired-but-signed call.\n(f) Identity CLAUDE.md:\n- add the instrument to the Observability instruments line;\n- add one constraint: it is not a forgery signal on its own, because a JWT_SECRET rotation makes legitimate logouts of pre-rotation tokens increment it.\n(g) Acceptance (C-15). 319 acceptance.feature @AC-2 gains: `And the identity.revoke.unverifiable counter increases by 1 for the unsigned call and by 0 for the expired-signed call`. C-16 launch promotion then carries this into services/xstockstrat-identity/acceptance/signal-map-instrumentation.feature, alongside the sibling instruments pinned at @AC-52.\n\nSTEP 3: AGENT. Unchanged (D-5, D-6, D-7).\n\nSTEP 4: DOCS AND C-16 AMENDMENTS. Unchanged (D-8).\n- The config @AC-2/241, @AC-5/296 and @AC-25/295 Given amendments (\"from an mTLS peer with DNS SAN `xstockstrat-trading`\"; the Thens are unchanged) stay BLOCKED on the operator.\n\nOPERATOR GATE. One prompt from the orchestrator, recorded in context.md before design concludes. It covers:\n(a) the exact in-place @feature-319 Given amendment text for the three config scenarios;\n(b) the OQ3 resolution: ignore, success:true, no UPDATE, WARN plus identity.revoke.unverifiable.\n\nCorrected fallback (C-16, fails.md 2026-11-04):\n- Rejecting (a) means rejecting the SAN-bound success path. The only coherent outcomes are: sign off the amendment, or defer Step 1 out of this feature (Steps 2–4 proceed).\n- There is no third path in which the code changes but the durable scenarios stay unamended or are marked superseded.\n- Rejecting (b) leaves only a rejecting-error design, which is R-5. Only the operator can reopen R-5.\n\nStep order: unchanged. Step 1 goes harness-green, then RED AC-1, then the grant flip. Steps 2 and 3 are independent.",
    "open_objections": [
      {
        "text": "C-16 (O-1): the operator must explicitly sign off the in-place @feature-319 Given amendments to config @AC-2/241, @AC-5/296 and @AC-25/295 (the SAN-bound poller success path), and the sign-off must be recorded in context.md before design concludes. If the operator rejects, Step 1 is deferred. No variant changes the code while leaving the scenarios unamended.",
        "blocking": true
      },
      {
        "text": "O-3: the operator confirms the OQ3 resolution (ignore an unverifiable token, success:true, no UPDATE, WARN plus the identity.revoke.unverifiable counter). It goes in the same prompt as O-1.",
        "blocking": false
      },
      {
        "text": "Homelab leaf SAN: the DO staging and prod leaves are proven to carry DNS:xstockstrat-trading (do-render-app-spec.py mint -> gen-dev-certs.sh:50). Whether homelab leaves come from the same render path is unconfirmed. Spec/execute must check this before Step 1 merges, or record that homelab uses gen-dev-certs.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "319:@AC-1 (config SetConfig poller grant requires peer SAN)",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "319:@AC-2 (identity RevokeToken verifies signature; + identity.revoke.unverifiable counter assertion)",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "319:@AC-3 (agent DCR fail-closed 503)",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "config:@AC-2 (@feature-241 fix-config-audit-author-spoof)",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "config:@AC-5 (@feature-296 fix-config-keys-contract)",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "config:@AC-25 (@feature-295 fix-config-keys-drift)",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "agent:@AC-4 (@feature-247 DCR 201 on config stall)",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "identity:@AC-52 (signal-map-instrumentation sibling instruments)",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-54 (signal-map-instrumentation: no config values logged)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "identity:@AC-41 (telemetry closed-label/forbidden-key allowlist)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-47 (agent record_degraded closed label set)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Reusing identity.token.validate_failures{reason=invalid} (telemetry.ts:364) for unverifiable revokes. It would mix RevokeToken traffic into ValidateToken dashboards and make their existing semantics wrong.",
      "Waiving O-2 and treating the WARN as the only signal. A log line gives no rate or trend, while a BoundCounter costs about four lines of an existing pattern.",
      "A reason label (malformed | bad_signature) on the revoke counter. Nothing consumes it yet (YAGNI). Revisit only if rotation noise proves to matter.",
      "Incrementing the revoke counter on the missing-JWT_SECRET path. Secret misconfiguration must stay a loud code 13 under the existing secret_missing signal.",
      "O-1 rejection fallback that lands Step 1 while the three durable config scenarios stay unamended or are marked superseded. The code would then contradict a durable rule, which is the silent rule change C-16 forbids and the 'alongside' promotion mistake recorded in fails.md 2026-11-04.",
      "Leaving the deployed-cert SAN as an unverified pre-merge assumption. It is provable from code now: do-render-app-spec.py mint plus gen-dev-certs.sh:50, and the live marketdata GetSecret peerSan grant."
    ],
    "open_risks": [
      "Deploy ordering is now low-residual. DO leaves are proven SAN-correct, and only homelab's leaf path is unconfirmed. A leaf without the SAN would silently disable the poller's HALTED/REDUCE_ONLY escalation (ADMIN_SCOPE_ERROR).",
      "identity.revoke.unverifiable spikes after every JWT_SECRET rotation, from legitimate logouts of pre-rotation tokens. A raw alert on it would page on rotations, so the documentation says it is not a forgery signal on its own.",
      "A stale agent snapshot after a WatchConfig disconnect keeps serving the last-known DCR policy. This is accepted (D-6).",
      "The agent 503 path is unreachable in a correctly booted process. A future dead-code pass could remove it unless design.md and a constraint comment say why it exists (D-7).",
      "Overlap: configServiceImpl.ts is shared with feature 314, and agent files are shared with 314/322/328/331. Merge-order conflicts are likely.",
      "With ignoreExpiration:true, a years-old leaked but validly signed token can still trigger a revoke. HS256 pinning does not bound the age.",
      "docs/oauth.md has not been checked for a fail-open description. Verify at spec time."
    ],
    "constitution_rules_touched": [
      "C-01",
      "C-08",
      "C-10",
      "C-11",
      "C-15",
      "C-16",
      "C-18",
      "F-05",
      "P-02",
      "P-03",
      "P-06",
      "IDENTITY-4",
      "PLAT-N1"
    ],
    "rationale": "O-2 closes this round.\n- The proposal answers it concretely with a label-free identity.revoke.unverifiable counter that follows the existing BoundCounter/record* pattern and increments only in the verify-catch.\n- I adopted every non-blocking correction from the adversary:\n  - I checked the identity allowlist test: it does enumerate MIN_INSTRUMENTS (:31-38) and drive() (:41-49), so both edits become mandatory steps rather than conditional ones;\n  - the description says plainly that pre-rotation tokens also increment the counter;\n  - the WARN is fixed and carries no token or user id;\n  - the counter gains an acceptance home on 319 @AC-2 (C-15), which also carries it to the identity signal-map suite at launch.\n\nThe deployed-SAN precondition is mostly closed:\n- I verified that do-render-app-spec.py `mint` runs gen-dev-certs.sh, whose SAN is DNS:${svc}, and the marketdata peerSan grant already works live. Only homelab stays as a non-blocking check.\n\nThe proposal's O-1 rejection fallback contradicted C-16 and fails.md 2026-11-04:\n- I corrected it to the two coherent outcomes, sign off or defer Step 1. This applies the register and creates no new decision.\n\nO-1 stays blocking and O-3 stays open. Both need the operator, and no operator decision is recorded.\n\nThere are no Floor breaches, no register violations and no REOPEN petitions.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "Add a label-free OTel counter identity.revoke.unverifiable via recordRevokeUnverifiable(), incremented only in RevokeToken's verify-catch and never on missing JWT_SECRET. Its description reads 'forged, malformed, or pre-rotation'. It is registered in telemetryAllowlist.test.ts MIN_INSTRUMENTS and drive(), and asserted as an And on 319 @AC-2.",
          "evidence": "services/xstockstrat-identity/src/telemetry.ts:340-374; src/__tests__/telemetryAllowlist.test.ts:31-38,41-49 (verified r2); identity acceptance signal-map-instrumentation.feature @AC-52"
        },
        {
          "text": "The RevokeToken unverifiable WARN is a fixed message carrying at most the verify error class name, never the token, payload or user_id. A test asserts its fields.",
          "evidence": "services/xstockstrat-identity/CLAUDE.md Observability ('No token, email or hash is ever logged or labelled')"
        },
        {
          "text": "Deployed DO leaf certificates carry DNS SAN = service name, because do-render-app-spec.py mint runs gen-dev-certs.sh on every render. The Step 1 precondition reduces to a homelab-only check.",
          "evidence": "scripts/do-render-app-spec.py:39-70 (mint -> mtls-provision.sh :44, gen-dev-certs.sh :53-62); scripts/gen-dev-certs.sh:50; authz.ts:141 live marketdata peerSan grant"
        },
        {
          "text": "If the operator rejects the O-1 amendments, Step 1 is deferred out of 319. The code never lands with the three config durable scenarios unamended or marked superseded.",
          "evidence": "C-16; fails.md 2026-11-04 fix-marketdata-secret-exposure"
        }
      ],
      "new_rejected": [
        {
          "text": "Reusing identity.token.validate_failures{reason=invalid} for unverifiable RevokeToken calls",
          "why": "It mixes RevokeToken traffic into ValidateToken dashboards and corrupts their semantics."
        },
        {
          "text": "Waiving the revoke counter (WARN-only signal)",
          "why": "A log gives no rate or trend, and the counter costs about four lines of an existing pattern."
        },
        {
          "text": "A reason label (malformed | bad_signature) on identity.revoke.unverifiable",
          "why": "No consumer exists (YAGNI). Revisit only if rotation noise matters."
        },
        {
          "text": "Landing Step 1 while the config @AC-2/241, @AC-5/296 and @AC-25/295 scenarios stay unamended or are marked superseded",
          "why": "The code would contradict a durable rule (C-16), the 'alongside' promotion mistake in fails.md 2026-11-04."
        }
      ],
      "new_objections": [
        {
          "text": "Confirm that homelab mTLS leaves are minted by the same gen-dev-certs render path (DNS:${svc}) before Step 1 merges, or check them directly.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-2",
          "how": "Answered by the label-free identity.revoke.unverifiable counter (verify-catch only), with concrete MIN_INSTRUMENTS and drive() allowlist edits, a rotation-aware description, a fixed WARN, and an acceptance And on 319 @AC-2."
        }
      ],
      "reopen_petitions": [],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```

## Session 2026-11-13 — sdd-batch design-state repair

- The `sdd-batch-design-state` block in the round-2 gate entry (commit 02919eb8) holds feature 319's (fix-auth-trust-hardening) state, not 318's. The narrative above it and debate.md are correct. sdd-batch preflight refused to resume on that mismatch.
- The block below supersedes it (the parser reads the last block). It is rebuilt only from this feature's round-2 gate entry and debate.md D-1..D-8 / R-1..R-6 / O-1..O-6; it adds no decision, closes no objection and sanctions no @AC change. The earlier block is left in place as the audit trail.

```sdd-batch-design-state
{
  "round": 2,
  "synth": {
    "approach": "Round-2 synthesis (rebuilt verbatim from this feature's 2026-11-11 round-2 gate entry and debate.md D-1..D-8; see repair note). Builds on D-1..D-4 and adds D-5..D-8. (1) scripts/db-migrate.sh:77-82: remove the `force 0` arm; the dirty arm calls scripts/migration-dirty-guard.sh for recovery text, then always exits 1 (D-1). (2) The guard drops the floor scan and fails closed with exit 2 on an empty dir, no file n, or n above the local max (D-5). (3) Recovery text is keyed to observed schema state: `force <prev>` (or `TRUNCATE public.<schema>_schema_migrations` when file n is the lowest up-file), `force <n>`, or `force <next>`; prev = highest existing NNN below n; keeps the 'is dirty at version N' prefix and exit code 3 (D-2, D-6). (4) New scripts/check-migration-order.sh in `migration-contract-gate`: additions only (--no-renames --diff-filter=A) against the tip of base, 10# comparison, bans deletes of base *.up.sql and duplicate NNNs, passes --forbid-new when base_ref == main && head_ref != main-dev (D-3, D-7). (5) Tests: fix the guard fixtures; add db-migrate.test.sh and check-migration-order.test.sh. (6) docs/patterns/database.md:38 gets the forward-only rule and the state-keyed recovery procedure (D-4). (7) migration-ahead-check.sh:55-62 keeps n-1 with reworded text and a findings entry (D-8).",
    "open_objections": [
      {
        "text": "O-1: OQ1 (refuse-all vs auto force<prev>+up) needs an operator decision recorded in context.md, made on the corrected trade-off (up-files are atomic; the real issue is direction ambiguity). Refuse-all is recommended; if chosen, the record must say it overrides the product-spec's 'without manual intervention' outcome. Auto-recovery would need a REOPEN of D-1.",
        "blocking": true
      },
      {
        "text": "O-3: C-16 sign-off required for the @AC-19 reversal and the @AC-28 last-clause rewording. The @AC-19 replacement must include concrete examples: a gap (previous existing version), the first file (TRUNCATE), and an empty dir (exit 2).",
        "blocking": true
      },
      {
        "text": "O-4: the operator must confirm that hotfix PRs into main carry no migration (enforced by CI via --forbid-new), rather than renumbering unpromoted main-dev migrations, and database.md must state the gate's verdict on promotion PRs.",
        "blocking": true
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "@AC-19",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-28",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-27",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-18",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-25",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-12",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "R-1 hotfix numbering at max(main, main-dev)+1 with renumbering",
      "R-2 rejecting auto-recovery on a partially-applied premise",
      "R-3 keeping the contract-floor scan in the guard",
      "R-4 recovery text keyed to the failed operation",
      "R-5 --forbid-new triggered by a hotfix/ head prefix",
      "R-6 push-triggered order check against HEAD~1"
    ],
    "open_risks": [
      "Refuse-all wedges PRE_DEPLOY on any transient dirty state.",
      "Two golang-migrate 4.17.1 behaviours are unverified: NilVersion after TRUNCATE, and a loud failure on a duplicate version.",
      "The migration-contract-gate job in ci.yml may collide with peer 298 at merge time.",
      "The forward-only rule conflicts with the insights.md:900 NNN pre-assignment.",
      "Residual stale-base duplicate-NNN race: mitigated only by the recommended branch protection 'up to date before merge' on main-dev and main (O-5)."
    ],
    "constitution_rules_touched": [
      "C-16",
      "F-01"
    ],
    "rationale": "Rebuilt state. The round-2 gate commit 02919eb8 persisted feature 319's design-state JSON into this file by mistake; this block restores 318's round-2 state from its own gate narrative and debate.md, adding no new decisions. register_delta is empty because round 2's rows are already rendered in debate.md.",
    "register_delta": {
      "new_decisions": [],
      "new_rejected": [],
      "new_objections": [],
      "closed_objections": [],
      "reopen_petitions": [],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```
