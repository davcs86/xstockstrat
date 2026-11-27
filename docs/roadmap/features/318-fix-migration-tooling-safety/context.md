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

## Session 2026-11-13 — sdd-batch design gate (round 3)

`/sdd-design fix-migration-tooling-safety` is running in full mode and has stopped at its approval gate after round 3 (gate policy: halt). design.md has not been written and status.md has not changed. The debate register is in `debate.md`: D-1..D-14, R-1..R-8, O-1..O-7. This entry's `sdd-batch-design-state` block supersedes the round-2 blocks above.

### Open Threads

- **Approach (round-3 synthesis).** It rests on D-1..D-8 and adds D-9..D-14. R-1..R-8 are locked.
  - `scripts/db-migrate.sh:77-82`: the `force 0` call is removed. The dirty arm runs the guard for recovery text and then always exits 1. The stale comments at :66-69 are rewritten (D-1, D-14).
  - `scripts/migration-dirty-guard.sh`: the floor scan is removed. The guard exits 2 with "cannot compute recovery" when the dir is empty, when no file n exists, or when n is above the max. prev is the highest existing version below n, and next is the lowest existing version above n (D-2, D-5).
  - Recovery text is a ratchet (D-10). The primary line is `force <prev>`, or `TRUNCATE public.<schema>_schema_migrations` when n is the lowest file, followed by `up`. The operator escalates to `force <n>` and then `force <next>` only after `up` fails with "already exists" in that file and its effects are verified present. The rule is never to force forward on doubt. The text keeps the "is dirty at version N" prefix, the literal `$DATABASE_URL` and exit 3.
  - Tests are ported to pytest (D-9). `scripts/tests/test_migration_dirty_guard.py` replaces `migration-dirty-guard.test.sh`, and the same PR deletes the old test's `shell-allowlist.txt:18` line and its `ci.yml:841` entry. The tests use the D-5-consistent case table and assert the exact `Recover:` line. A 000-based service dirty at 1 legitimately prints `force 0` (D-13). `scripts/tests/test_db_migrate.py` stubs psql and migrate and asserts exit 1 with no `force` in the argv log.
  - `scripts/check-migration-order.py` is a new Python script. It checks only added files against the per-service max on base, using a 10# comparison. It fails on a duplicate NNN and on a D or M of a base `*.up.sql` (D-3, D-12). `--forbid-new` applies to every base=main PR unless the head is a same-repo `main-dev` (D-7, D-11). It runs in its own new PR-only job, `migration-order-gate`, which stays separate because peer 298 edits `migration-contract-gate`. The stale comment at `ci.yml:896-897` is rewritten.
  - `docs/patterns/database.md` gets the forward-only rule and the ratchet procedure, and its force-0 and Floor-rule text is removed. It also records the gate's verdicts on promotion and hotfix PRs and explains the 000-based `force 0` case (D-4, D-13).
  - `migration-ahead-check.sh:55-62` is reworded only (D-8). `docs/context-constitution-findings.md` gets four entries: the ahead-check n-1 gap, the cross-dir header gap, the stale `migration-rerun.py` prose and the `database.md:32` run-order drift.
- **Strongest open objection (blocking): O-1.** The operator must sign refuse-all in this file. The record must use the corrected trade-off:
  - Up-files are atomic (R-2), so a failed replay fails loudly and only re-dirties.
  - The real hazards of auto-recovery are a silent double-apply when a non-idempotent DML file replays, and a pointless re-dirty in the clean-flag-failed and failed-down states.
  - The accepted cost is that a dirty row blocks every later migrator run, including DO's automated rollback, until an operator acts (fails.md:3687).
  - The record must say it overrides the product-spec's "without manual intervention" outcome.
- **Other blocking objections.**
  - O-3 needs C-16 sign-off for two changes. The @AC-19 replacement spells out the full file set for every example: the 001/002/003/005/006 gap, the first file, no file n, the empty dir, and the 019/020/026/027 contract dir with dirty 20 → force 19. The last clause of @AC-28 is reworded to "refuses dirty 041 with exit 3 naming force 40".
  - O-4: the operator must confirm that hotfix PRs into `main` carry no migration. The record must state the cost: an urgent production schema fix forces promotion of all unpromoted main-dev work.
- **Non-blocking objection.** O-7: confirm that the pytest case table matches D-5 and D-10. Legacy cases (a), (c), (d), (f), (h) and (i) all change outcome.
- **Floor status.** No Floor breaches.
- **Uncovered @AC changes.** None of these are covered by an operator decision yet:
  - @AC-19: CHANGE
  - @AC-28: CHANGE
  - @AC-27: EXTEND
  - @AC-18, @AC-25, @AC-12, @AC-30: PRESERVE
- **Notable risks.**
  - Refuse-all stops PRE_DEPLOY and rollbacks on any dirty state.
  - The DML double-apply is guarded only by the operator.
  - Two golang-migrate 4.17.1 behaviours are unverified: NilVersion after TRUNCATE, and a loud failure on a duplicate version.
  - The `ci.yml` edits may collide with peer 298 at merge time.
  - The M-ban blocks typo fixes to merged files.
  - "Promotion passes by construction" is unverified against historic main-only files.
  - The forward-only rule conflicts with insights.md:900.
  - The branch protection that O-5 relies on has not been set.

```sdd-batch-design-state
{
  "round": 3,
  "synth": {
    "approach": "Round-3 synthesis. It rests on D-1..D-8 with R-1..R-6 locked, and adds D-9..D-15. The adversary's verdict outcomes were re-verified against the working tree.\n\n(1) scripts/db-migrate.sh:77-82 (D-1). The dirty arm becomes `\"$REPO_ROOT/scripts/migration-dirty-guard.sh\" \"$dir\" \"$schema\" \"$ver\" || true; exit 1`. Delete the echo and the `force 0` call at :79-80. Rewrite the stale comments at :66-67 and :69 (\"before force 0 can replay\"). The ahead-check at :70-76 still runs first.\n\n(2) scripts/migration-dirty-guard.sh (D-2, D-5, R-3):\n- Delete the floor scan at :19-43 and keep the parse at :13-17.\n- Build the 10#-decimal list of up-file versions.\n- Exit 2 with 'cannot compute recovery' when the dir is empty, when no file n exists, or when n is above the max.\n- prev = the highest existing version below n; next = the lowest existing version above n.\n\n(3) Recovery text: a ratchet that honors D-6 (D-10). It keeps the 'x is dirty at version N' prefix, the literal $DATABASE_URL (:45-52) and exit 3.\n- PRIMARY line: `Recover: migrate ... force <prev>` then `up`. When file n is the lowest up-file, print `TRUNCATE public.<schema>_schema_migrations` instead.\n- ESCALATION lines:\n  - \"if up then fails with 'already exists' in file K (K = n, then next), first verify K's effects are fully present, then force K and up\".\n  - The state-keyed targets `force <n>`, and `force <next>` when a next exists, with the rule: never force forward on doubt. Forcing forward skips K silently and forever, which is how seed files get lost.\n  - \"Objects exist\" is meaningless for contract or prune files, so for those the operator verifies the effect, not the objects.\n\n(4) Tests: the guard tests are ported to pytest (D-9). Add scripts/tests/test_migration_dirty_guard.py, which shells out to the bash guard. In the same PR, delete scripts/migration-dirty-guard.test.sh, its line 18 in scripts/shell-allowlist.txt, and its entry in the ci.yml:841 chain. Assertions match the exact `Recover:` line, never a substring (fails.md:139). Case table:\n- 027-only, dirty 27 → 3, TRUNCATE.\n- 026+027, dirty 27 → 3, Recover force 26, plus the 'x is dirty at version 27' prefix.\n- 026+027, dirty 26 → 3, TRUNCATE.\n- 026+027, dirty 25 or 20 → 2.\n- garbage version → 2.\n- 001,002,003,005,006:\n  - dirty 5 → 3, Recover force 3, with a force 6 escalation.\n  - dirty 1 → 3, TRUNCATE.\n  - dirty 4 → 2.\n  - dirty 7 → 2.\n  - dirty 6 → 3, no next line.\n- empty dir, dirty 5 → 2.\n- 019,020,026,027 with a 027 contract-of 026 header, dirty 20 → 3, force 19.\n- 000+001, dirty 1 → 3, Recover force 0. This is legitimate for 000-based services. No test asserts that 'force 0' is absent from output text.\n- No postgres:// anywhere, and the literal $DATABASE_URL is present.\n\nThe old cases (f), (h) and (i), which existed only to exercise headers, are dropped.\n\nscripts/tests/test_db_migrate.py runs `bash scripts/db-migrate.sh up` with stub psql and migrate on PATH. Every service except indicators returns 9999 (clean-ahead skip, exit 10); indicators returns '5 (dirty)'. It asserts exit 1, no `force` invocation in the stub's argv log, and the exact 'Recover: ... force 4' line.\n\n(5) scripts/check-migration-order.py, Python per script-tooling.md:7-12 (D-3, D-7, D-11, D-12). It is shaped like check-migration-contract.py:18-19,36-65 and takes `<base_ref> [--forbid-new]`, exiting 0 ok, 1 refused, 2 usage.\n- Added files come from `git diff --name-only --no-renames --diff-filter=A base...HEAD -- 'services/*/migrations/*.up.sql'`, compared as 10# decimals against the per-service max from `git ls-tree`.\n- It fails when NNN is at or below the base max (the message names both numbers), on a duplicate NNN, and on a D or an M of a base-tree *.up.sql (the M check mechanizes F-01, D-12).\n- With --forbid-new it fails on any added up-file.\n\nIts tests (scripts/tests/test_check_migration_order.py) reuse the throwaway-repo fixture from test_check_migration_contract.py:32-46.\n\n(6) CI: a new PR-only job, migration-order-gate, cloned from ci.yml:938-954. It is a separate job because peer 298 edits migration-contract-gate.\n- It passes --forbid-new unless `github.base_ref != 'main' || (github.head_ref == 'main-dev' && github.event.pull_request.head.repo.full_name == github.repository)`. The fork guard is D-11.\n- Register it at needs :1320-1321 and echo :1351-1352, and add the script to the migrations filter at :88-96.\n- Rewrite the stale migration-rerun comment at ci.yml:896-897, which still describes replay from 0 via the db-migrate recovery path.\n\n(7) docs/patterns/database.md (D-4):\n- :41 gets the forward-only rule: the next free NNN is taken at merge, merge-order.md numbers are advisory, and you renumber before merge, never after.\n- :60-63 and :83-95 get the ratchet procedure from (3) and lose the force-0 text. The Floor rule bullet at :85-88 is deleted.\n- Add a paragraph explaining that `force 0` for a 000-based service dirty at 1 is ordinary prev recovery, not the removed path.\n- Add a gate bullet after :78-79 with the verdicts:\n  - Promotion PRs pass by construction.\n  - Hotfix PRs into main carry no migration, and the cost is stated.\n\n(8) migration-ahead-check.sh:55-62: reword only (D-8).\n\n(9) docs/context-constitution-findings.md gets entries for:\n- the ahead-check n-1 gap;\n- the cross-dir contract-header gap;\n- the stale prose at migration-rerun.py:7, :735 and :1067-1068;\n- the run-order drift at database.md:32.\n\n(10) Operator records (P-01): O-1, O-3 and O-4 need the operator's own sign-off in context.md, using the corrected texts in open_objections.",
    "open_objections": [
      {
        "text": "O-1: The operator must sign refuse-all in context.md. Corrected record text: \"Refuse-all. `db-migrate.sh up` never auto-recovers a dirty service. It prints the ratchet recovery (`force <prev>`, or TRUNCATE for the first file, then `up`, escalating to force K only after verifying K's effects) and exits 1. This overrides the product-spec Expected outcome 'without manual intervention'.\" The record must use the corrected trade-off:\n- Up-files are atomic (R-2), so a bare-DDL replay fails loudly and only re-dirties the row.\n- The real hazards of an automatic force <prev> plus up are two. First, a DML file that replays successfully but is not idempotent applies twice and silently mutates data (config 041 per @AC-28; the 046/047 prunes). Second, in the clean-flag-failed and failed-down states it gains nothing and just re-dirties.\n- The accepted cost: a dirty row blocks every later migrator run, including DO's automated rollback deploy, until an operator acts (fails.md:3687).",
        "blocking": true
      },
      {
        "text": "O-3: C-16 sign-off for the @AC-19 CHANGE (platform.feature:386-390) and the @AC-28 last-clause CHANGE. The replacement @AC-19 must spell out the full file set for every example:\n- Up-files 001,002,003,005,006 and no contract file:\n  - '5 (dirty)' exits 3 with Recover 'force 3'.\n  - '1 (dirty)' exits 3 naming 'TRUNCATE public.x_schema_migrations'.\n  - '4 (dirty)' exits 2 naming 'cannot compute recovery'.\n- An empty dir with '5 (dirty)' exits 2 naming 'cannot compute recovery'.\n- Up-files 019,020,026,027, where 027 declares contract-of 026: '20 (dirty)' exits 3 with Recover 'force 19'.\nThe @AC-28 last clause becomes: 'the dirty guard refuses a dirty 041 with exit 3 naming force 40, leaving row counts and audit functions unchanged, after which migrate force 40 and up converge' (matches migration-rerun.py:734-753).",
        "blocking": true
      },
      {
        "text": "O-4: The operator must confirm the rule, and the record must state its cost. The rule: hotfix PRs into main carry no migration, enforced by --forbid-new on any base=main PR unless the head is the same-repo main-dev. A schema fix ships via main-dev and a promotion, and promotion PRs pass the ordinary rule by construction. The cost: an urgent production schema fix forces promotion of all unpromoted main-dev work. database.md must carry the promotion and hotfix verdicts.",
        "blocking": true
      },
      {
        "text": "Confirm that the guard pytest case table in the approach matches D-5 and D-10 as the adversary re-derived them. Under D-5, legacy cases (a), (c), (d), (f), (h) and (i) all change outcome. The table replaces them with fixtures that contain real lower files.",
        "blocking": false
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
      },
      {
        "ac_id": "@AC-30",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "R-1: hotfix numbering at max(main, main-dev)+1, with collisions fixed by renumbering on main-dev.",
      "R-2: rejecting auto-recovery on the premise that a failed up-file is partially applied (up-files are atomic).",
      "R-3: keeping the contract-floor scan in the guard.",
      "R-4: recovery text keyed to the failed operation.",
      "R-5: --forbid-new triggered by a hotfix/ head prefix.",
      "R-6: a push-triggered order check against HEAD~1.",
      "Judgment-first three-branch recovery text (the proposal's equal-weight force prev/n/next). Lost to the ratchet because it leaves the operator a judgment call, and picking force n when n had not applied skips a seed file silently.",
      "Keeping and rewriting the legacy migration-dirty-guard.test.sh. Lost because every case changes, which makes it a rewrite (script-tooling.md:10-11), and it would duplicate the pytest harness already used for db-migrate.",
      "Folding the order check into check-migration-contract.py and its job. Lost because peer 298 edits that job (ci.yml:938-954).",
      "Guard-side DB probing to detect which objects exist. Lost because the guard has no DB access and probing would need SQL parsing, which is out of scope."
    ],
    "open_risks": [
      "Refuse-all stops PRE_DEPLOY, and DO automated rollbacks, on any transient dirty state until an operator runs migrate force (fails.md:3687).",
      "The ratchet's 'already exists' escalation catches only DDL. A non-idempotent DML file that replays successfully after force <prev> double-applies silently. Only the operator's check of the file guards against this, and the text must say so.",
      "Two golang-migrate 4.17.1 behaviours are unverified: NilVersion after TRUNCATE, and a loud failure on a duplicate version.",
      "The new migration-order-gate job and the ci.yml:841 shell-lint chain edit (deleting the legacy .test.sh entry) may collide with peer 298 and other batch peers at merge time.",
      "The M-ban on base *.up.sql blocks even comment or typo fixes to merged files. The escape is a new numbered file.",
      "Promotion 'pass by construction' assumes main has no historic main-only migration. This is not verified for existing files.",
      "The forward-only rule conflicts with the NNN pre-assignment in insights.md:900.",
      "The stale-base duplicate-NNN race is mitigated only by branch protection 'up to date before merge' on main-dev and main, which the operator has not yet set (O-5)."
    ],
    "constitution_rules_touched": [
      "C-16",
      "F-01",
      "C-11",
      "C-15",
      "C-18",
      "P-01",
      "P-03"
    ],
    "rationale": "I re-verified the adversary's blocking points on the working tree.\n\nGuard test cases. Under D-5, the fixtures in migration-dirty-guard.test.sh change outcome:\n- (a) is 027 only (test.sh:39-41). That is the lowest file, so it prints TRUNCATE.\n- (c) dirty 26 sits over 026 as the lowest file, so it prints TRUNCATE.\n- (d) dirty 25 and 20 have no file 25 or 20, so both exit 2.\n- (f) and (i) have 027 as the lowest file, so they print TRUNCATE.\n- (h) has no file 13 or 12, so both exit 2.\nThe proposal's \"flip (a) and (d)\" was therefore wrong. The synthesis fixes it with a full case table and a pytest port. The port also resolves the legacy-shell tension (shell-allowlist.txt:18 marks the .test.sh legacy).\n\n@AC-19. The current Given (platform.feature:388) says \"only contract file\", so it cannot produce force 19. The replacement now lists its files explicitly, and that text is folded into O-3.\n\nO-1 rationale. The draft's \"replay bare DDL\" contradicts R-2. The real hazards are a silent double-apply by a non-idempotent DML replay, and a dirty row blocking rollback deploys (verified at fails.md:3687). The corrected text is folded into O-1, which stays open for the operator.\n\nThe ratchet refines D-6, it does not reopen it. It keeps the literal force <prev> token, the 'is dirty at version N' prefix and the state-keyed force n and force next targets. It only makes force <prev> the safe default and gates forward forces on verifying the file's effects. So it is recorded as an amendment, not a REOPEN.\n\nThe fork guard and the M-ban add to D-7 and D-3 without contradicting them. @AC-18 is preserved: analysis/migrations has 025, so dirty 26 still prints force 25.\n\nO-1, O-3 and O-4 remain blocking because only the operator can close them. No operator decisions are recorded, so no business-rule change is covered_by_operator_decision.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "Port the guard tests to pytest. Add scripts/tests/test_migration_dirty_guard.py, which shells out to the bash guard. In the same PR, delete scripts/migration-dirty-guard.test.sh, its shell-allowlist.txt:18 line and its ci.yml:841 chain entry. Assert the exact 'Recover:' line, not a substring, using the D-5-consistent case table (gap, first-file, no-file-n, above-max, empty-dir, contract-dir 019/020/026/027, and the 000-based dirty 1 → force 0 case).",
          "evidence": "migration-dirty-guard.test.sh:39-83 fixtures re-derived under D-5; shell-allowlist.txt:18 (legacy); script-tooling.md:10-11; fails.md:139; adversary r3 objections 1 and 5"
        },
        {
          "text": "Recovery text is a ratchet within D-6. The primary line is force <prev> (TRUNCATE for the first file) then up. Escalation to force K (K = n, then next) is allowed only after 'already exists' in file K and after the operator verifies K's effects are fully present. Never force forward on doubt. Contract and prune files are verified by their effect, not by objects existing.",
          "evidence": "A wrong force <prev> fails loudly and atomically (R-2); a wrong force <n> silently skips a seed file (config 048, indicators 008, ingest 016, analysis 028/029); adversary r3 objection 4"
        },
        {
          "text": "--forbid-new applies to every base=main PR except a same-repo main-dev head: github.head_ref == 'main-dev' && github.event.pull_request.head.repo.full_name == github.repository.",
          "evidence": "A fork branch named main-dev would otherwise evade the check; promote.yml:233-234 opens the promotion with head main-dev from the same repo"
        },
        {
          "text": "The order gate also rejects an M (modify) of a base-tree *.up.sql, alongside D-3's D ban, mechanizing F-01.",
          "evidence": "F-01; D-3 delete ban; adversary r3 non-blocking objection (one more diff filter in the same script)"
        },
        {
          "text": "database.md states that `force 0` printed for a 000-based service dirty at 1 is ordinary prev recovery, and no test asserts that 'force 0' is absent from output. test_db_migrate.py asserts only that the stub's argv log contains no force invocation.",
          "evidence": "000-based services: config, ingest, identity, ledger, marketdata, notify, portfolio, trading; adversary r3 objection 6"
        },
        {
          "text": "Fix the stale comments in files this change touches: db-migrate.sh:66-69 and ci.yml:896-897. Record migration-rerun.py:7, :735 and :1067-1068 and the database.md:32 run-order drift in findings.",
          "evidence": "db-migrate.sh:66-69 and ci.yml:896-897 verified; CLAUDE.md §How to Act 5"
        }
      ],
      "new_rejected": [
        {
          "text": "Judgment-first three-branch recovery text (force prev/n/next presented as equal options keyed to the operator's reading of schema state)",
          "why": "Picking force <n> when n had not applied skips the file silently and forever (the second defect's failure mode), and 'objects exist' is meaningless for contract or prune files. The ratchet removes that judgment."
        },
        {
          "text": "Rewriting the legacy migration-dirty-guard.test.sh in place",
          "why": "Every case changes, which makes it a rewrite of a legacy .sh (script-tooling.md:10-11), and it duplicates the pytest harness already used for db-migrate."
        }
      ],
      "new_objections": [
        {
          "text": "Confirm that the guard pytest case table matches D-5 and D-10 as the adversary re-derived them. Under D-5, legacy cases (a), (c), (d), (f), (h) and (i) all change outcome.",
          "blocking": false
        }
      ],
      "closed_objections": [],
      "reopen_petitions": [],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```

## Session 2026-11-20 — sdd-design (approved)

- Phase 0 Recon: recon.md was written on 2026-11-11 (services: platform tooling plus the migration dirs of indicators, ingest, identity, config, portfolio, analysis; key reuse patterns: the contract-gate script and job shape, and the guard's own recovery text).
- Phase 1 Grilling: 3 rounds (full). The operator approved at the gate; termination: approved.
  - Chosen approach: refuse-all. `db-migrate.sh up` loses its `force 0` arm and always exits 1 on a dirty service. The guard prints a ratchet recovery (`force <prev>`, or TRUNCATE for the first file, then `up`). A new `scripts/check-migration-order.py` runs in its own PR-only job `migration-order-gate`. `docs/patterns/database.md` gets the forward-only rule.
  - Rejected: R-1..R-8 (debate.md), including hotfix renumbering, operation-keyed recovery text and the judgment-first three-branch text.
- Constitution rules touched: C-16, F-01, C-11, C-15, C-18, P-01, P-03. Floor breaches: none.
- debate.md: State approved. O-1, O-3 and O-4 are closed by the operator decisions below. O-7 (non-blocking) stays open. There were no reopen petitions.
- Status: spec-ready → design-approved.
- No ledger line was added. The debate produced nothing reusable beyond what fails.md and insights.md already hold.

### Operator Decisions (binding, recorded 2026-11-20)

- **O-1 (design gate): refuse-all.** `db-migrate.sh up` never auto-recovers a dirty service. It prints the state-keyed recovery and exits non-zero. This overrides the product-spec's "without manual intervention" outcome.
  - The trade-off it was made on: up-files are atomic (R-2), so a bare-DDL replay fails loudly and only re-dirties the row. The real hazards of an automatic `force <prev>` plus `up` are a silent double-apply by a non-idempotent DML file, and a pointless re-dirty in the clean-flag-failed and failed-down states.
  - Accepted cost: a dirty row blocks every later migrator run, including DO's automated rollback deploy, until an operator acts (fails.md:3687).
- **O-3: C-16 sign-off** for the @AC-19 CHANGE and the @AC-28 last-clause CHANGE.
  - @AC-19 replacement examples: a gap resolves to the previous existing version (up-files 001,002,003,005,006: `5 (dirty)` → exit 3, `force 3`); the first file names TRUNCATE (`1 (dirty)` → exit 3, `TRUNCATE public.x_schema_migrations`); an empty dir exits 2 ("cannot compute recovery"). design.md carries the full example set, including `4 (dirty)` → exit 2 and the 019,020,026,027 contract dir with `20 (dirty)` → `force 19`.
  - @AC-28 last clause becomes: "the dirty guard refuses a dirty 041 with exit 3 naming force 40, leaving row counts and audit functions unchanged, after which migrate force 40 and up converge".
- **O-4: confirmed.** Hotfix PRs into `main` carry no migration. This is enforced by `--forbid-new` on any base=main PR whose head is not the same-repo `main-dev`. A schema fix ships via main-dev and a promotion.
  - Cost: an urgent production schema fix forces promotion of all unpromoted main-dev work.

### Open Threads

Each open risk from design.md, with its target. Step numbers do not exist until `/sdd-spec` runs.

- Refuse-all stops PRE_DEPLOY and DO's automated rollback on any transient dirty state until an operator runs `migrate force` (fails.md:3687). Accepted under O-1. Target: the `database.md` step states it.
- The ratchet's "already exists" escalation catches only DDL. A non-idempotent DML file that replays after `force <prev>` double-applies silently. Target: the guard-text step and the `database.md` step both say so.
- Two golang-migrate 4.17.1 behaviours are unverified: NilVersion after TRUNCATE, and a loud failure on a duplicate version. Target: verify in the guard-text step.
- The new `migration-order-gate` job and the `ci.yml:841` test-chain edit may collide with peer 298 and other batch peers. Target: the CI step and the integration PR.
- The modify ban on base `*.up.sql` blocks even comment or typo fixes to merged files; the escape is a new numbered file. Target: the `database.md` step.
- Promotion "pass by construction" assumes `main` has no historic main-only migration. Not verified. Target: the ordering-gate step.
- The forward-only rule conflicts with the NNN pre-assignment in insights.md:900. Target: the `database.md` step.
- The stale-base duplicate-NNN race is mitigated only by branch protection "up to date before merge" on `main-dev` and `main`, which the operator has not yet set. Target: operator action, outside the PR.
- O-7 (non-blocking, open): confirm the guard pytest case table against D-5 and D-10. Target: the guard-test step.
- For `/sdd-spec`:
  - Pin the feature's own AC-1 `Then` to the refuse branch (O-1) and add `@AC` scenarios for the gap, first-file and empty-dir cases (C-15).
  - Re-grep every target-file line number. recon.md ran on an older tree, design.md cites lines verified on `origin/main-dev` in round 3, and this feature branch predates the `.sh` → `.py` ports (`check-migration-contract.py`, `migration-rerun.py`, `scripts/shell-allowlist.txt` are absent here).

## Session 2026-11-20 — sdd-spec

- Generated implementation-spec.md with 13 steps. Status: design-approved → implementation-ready.
- Evidence tree: `origin/main-dev@fb52065c2`, read without merging. This branch is 168 commits behind it and still
  holds the pre-port `.sh` tooling; `/sdd-execute` BRANCH SYNC brings `scripts/tests/`, `check-migration-contract.py`,
  `migration-rerun.py` and `shell-allowlist.txt` in before Step 1.
- acceptance.feature: AC-1's `Then` is pinned to the refuse branch (O-1). AC-3 (gap), AC-4 (first file) and AC-5
  (cannot compute) were added (design §10, O-3). IDs are append-only.
- Step shape:
  - 1–2 migrator (`db-migrate.sh` loses `force 0`; new `scripts/tests/test_db_migrate.py`).
  - 3+4 one atomic unit: guard rewrite, pytest port, deletion of `migration-dirty-guard.test.sh` with its
    `shell-allowlist.txt:18` line and `ci.yml:841` chain entry.
  - 5–6 ahead-check reword. 7–8 `scripts/check-migration-order.py` and its tests. 9–10 CI job
    `migration-order-gate` and a wiring test.
  - 11 docs, 12 findings, 13 the two operator-signed durable-rule edits.
- Key codebase findings:
  - The migrator goes first because, once the new guard exists, the old `if ! guard; then exit 1` already refuses
    and the migrator test has no red. Run in a scratch copy: the Step 2 test fails on the unmodified script
    (exit 0 after `force 0`) and passes after Step 1; the recovery-line assertion stays red until the Step 3 guard.
  - The Step 3 guard body is in the spec verbatim. It passes `shellcheck` and `shfmt -d -i 2` and produces every
    row of the case table, which closes debate objection O-7 in substance (the register itself is unchanged).
  - golang-migrate 4.17.1, by source read: an empty tracking table reads as NilVersion
    (`database/postgres/postgres.go:391-396`) and a duplicate version fails at source init
    (`source/iofs/iofs.go:70`). The TRUNCATE wording is final.
  - `origin/main` holds no up-file that `origin/main-dev` lacks, so a promotion PR passes the gate by construction.
  - `migration-rerun.py` is unedited; the strings it asserts (`force 40`, `force 43`, `force 42`, `force 12`,
    `force 25`) all name files that exist. Its CI job on the integration PR is the first real run.
  - The `--forbid-new` workflow expression must be the positive form
    `(base == 'main' && !(head == 'main-dev' && same repo)) && '--forbid-new' || ''`. The inverse form always yields
    the flag because `''` is falsy.
- Deviations from design.md, none touching the Chosen Approach:
  - Three findings entries, not four: the `database.md` run-order drift is already fixed on main-dev (`:35`).
  - Step 11 also edits `script-tooling.md:54,62`, `config-rollout.md:248-250` and `context-constitution.md:82`,
    which go stale with this change.
  - The exact `Recover:` assertion of the migrator test lands in Step 4, not Step 2.
  - Exit-2 guard cases assert "no `postgres://`" only; they print no recovery text, so no literal `$DATABASE_URL`.
  - One extra guard case: an up-file name with no numeric prefix exits 2.

### Open Threads

- Operator action outside the PR: set branch protection "up to date before merge" on `main-dev` and `main`.
- The `migration-order-gate` flag expression cannot run locally. Check its outcome on the integration PR (no flag)
  and on the next promotion PR (no flag).
- `ci.yml` may collide with peer 298 and other batch peers at merge; Step 10's wiring test fails if the job is lost.
- Next: `/sdd-review fix-migration-tooling-safety impl-spec`.

## Session 2026-11-20 — sdd-review impl-spec (advisory)

- Result: 0 failures, 9 warnings; overlap WARN (file-level and ordering only; no same-NNN migration, proto field
  or config-key clash). Floor breaches: none. Advisory — did not block; lifecycle unchanged.
- Addressed in implementation-spec.md (each claim re-verified on `origin/main-dev@fb52065c`):
  - [x] Steps 1/5/7/9 red order (C-08/P-06): Step Dependencies gains "Red order for the service-first pairs" —
    write and run the paired test before the service edit, per `sdd-execute/reference/tdd-gate.md`; the TDD
    lines of Steps 1, 5 and 9 point at it. Step 7 already carried its own RED protocol.
  - [x] Unsynced-branch risk: Step Dependencies gains a Step 1 precondition check (`scripts/tests/`,
    `check-migration-contract.py`, `migration-rerun.py`, `shell-allowlist.txt` must exist, else stop).
  - [x] Step 9 anchor: the `migration-contract-gate` job key is `:938` (comment `:936-937`); now stated.
  - [x] Step 7 Verification: `git fetch --no-tags origin main-dev` added before the `origin/main-dev` run.
  - [x] Step 13: instruction 0 added — confirm the O-3 sign-off line in this file before editing either suite.
  - [x] Step 9: a `FORBID_NEW` truth table (four cases) added to check the first CI logs against.
  - [x] Overlap: the open-risks list now names peers 324 and 297 for `ci.yml`, and the 345 config `053` case.
- Unresolved ⚠ carried into execution:
  - Step 9: the `FORBID_NEW` expression still cannot run locally; Step 10 checks it as text only. First real
    runs are the integration PR and the next promotion PR — [ ] unaddressed
  - Steps 1–2: between Step 2 and Step 4 a dirty service with no contract file is refused with no recovery
    text. Do not open the integration PR in that window — [ ] unaddressed
  - Steps 11–12: `scripts/migration-rerun.py` docstring and log lines (`:7`, `:735`, `:1067-1068`) still describe
    a contract floor; deferred as a Step 12 findings row, not fixed — [ ] unaddressed
  - Step 11: refuse-all stops every later PRE_DEPLOY and rollback deploy until an operator acts. Accepted cost
    (O-1), documented, not removed — [ ] unaddressed
- Overlap findings:
  - `.github/workflows/ci.yml` is also edited by 324, 298 and 297 (rebase-level; no merge-order row needed).
  - 330 (`fix-live-enrich-ttl-seed`) reads the `up` path of `scripts/db-migrate.sh` and names 318 as its
    re-check trigger; it does not edit the file.
  - Peers 308–320, 322–325, 327–328 and 331 have no implementation-spec yet, so only their product-specs were
    scanned.

### Open Threads

- Tell the operator: 345 (`authelia-sso`) plans config `053`, but trunk already holds `054` and `055`. Once
  `migration-order-gate` is live that file is refused; 345 must renumber at its merge. Name it in the 318
  integration PR description.
- If 318 merges before 330, 330 must re-read the `up` path of `scripts/db-migrate.sh`.
- The four `[ ] unaddressed` items above must be announced at each `/sdd-execute` checkpoint (P-03).
- Still open from the sdd-spec session: branch protection "up to date before merge" on `main-dev` and `main`
  (operator action).

## Session 2026-11-21 — sdd-execute sequential (sdd-batch-execute)

- Up-front confirmation: the operator approved the plan with this binding record (verbatim):
  `{"mainDev":"8baf3976c17f2f074f834d63ad9a1e8ffd8af22e","dev":"3f556f04c293daf42eac87846234196991d6a0fc","specHash":"42f5c01acc11e02ac618d92d4ee905e9321504b6","directive":"conditional","pending":[1,2,3,4,5,6,7,8,9,10,11,12,13],"mismatches":[{"n":5,"detail":"Minor, non-blocking. The spec says `grep -n \"prev\\|refusing\" scripts/migration-ahead-check.sh` returns :55, :58, :59, :60. It actually returns 17, 46, 55, 58, 59. Line :60 (the `(use '?x-migrations-table=' ...` note) contains neither word, and :17 and :46 also match. The text at :55/:58/:59/:60 is exactly what the spec quotes, so the instructions still apply unchanged."},{"n":11,"detail":"Codebase Evidence points to `docs/patterns/config-governance.md:513` for the precedent wording. Line 513 is a blank line next to the `### feature 184 — opportunity-config-operability` heading, and it is the same on the evidence tree fb52065c2. The renumber precedent (\"**Migration renumbered `024` → `026`:** `merge-order.md` pre-assigned `024`, but feature 166's `025_...` merged ... first\") is at line 634. All other Step 11 anchors match their quoted text: database.md:35, :41, :43, :60-63, :65-79, :81-107; script-tooling.md:54 and :62; config-rollout.md:248-250; context-constitution.md:82; insights.md:900."}]}`
- Merge: origin/main-dev 8baf3976c is already an ancestor of the dev branch. Nothing to merge.
- Re-spec commits (conditional directive; only the Codebase Evidence of steps 5 and 11 changed):
  - `4269ae02` respec(fix-migration-tooling-safety): align steps 5,11 with current codebase
- Tooling detection (steps 1–13): python3 3.13 ✓ · uv ✓ · go ✓ · shellcheck ✗ (documented fallback
  `uv tool install shellcheck-py`, installed per step) · shfmt ✗ (documented fallback
  `go install mvdan.cc/sh/v3/cmd/shfmt@v3.8.0`, installed per step).
- Status: implementation-ready → in-progress.

```sdd-batch-setup
{"mainDev":"8baf3976c17f2f074f834d63ad9a1e8ffd8af22e","date":"2026-11-21"}
```

### Step 1 — service: remove the `force 0` arm from `db-migrate.sh up` [done]
- The `up` dirty arm of `scripts/db-migrate.sh` now runs `migration-dirty-guard.sh ... || true` for its text and then `exit 1`; the `force 0` call, its echo and the stale `:66-67` comment are gone, a one-line refuse comment sits above the dirty `case`, and the ahead-check comment is reworded. The `force` subcommand and header are untouched.
- TDD (Red order): Step 2's test was authored in the working tree first and run on the unmodified script. AC-1 red: `assert proc.returncode == 1` failed with `E       assert 0 == 1` (output showed `[dirty] force-resetting xstockstrat-indicators to version 0`) → green: `1 passed in 0.48s`, ruff `All checks passed!`, `61 files already formatted`. The test file was removed before this commit; it is committed under Step 2.
- Verification: shellcheck 0.11.0 + shfmt v3.8.0 clean, `migration-dirty-guard.test.sh: all assertions passed`, `migration-ahead-check.test.sh: all assertions passed`, no `force 0` in `scripts/db-migrate.sh`; `exit=0`. Tools came from the spec's own documented fallbacks (`uv tool install shellcheck-py`, `go install mvdan.cc/sh/v3/cmd/shfmt@v3.8.0`). No coverage gate applies to `scripts/`.
- Config-key wiring gate: N/A (no config key, no config migration).
- Files modified: `scripts/db-migrate.sh`
- Deviations: none

### Step 2 — test: `db-migrate.sh up` never forces a dirty service [done]
- Created `scripts/tests/test_db_migrate.py`: `run_up` runs `bash scripts/db-migrate.sh up` with stub `psql`/`migrate` (reusing `Stubs` and `SCRIPTS_DIR`, real PATH appended); every schema answers `9999` (ahead skip) except indicators `5 (dirty)`. The test asserts exit 1, no `migrate ... force` call, no `analysis_schema_migrations` call and no `hunter2` in stdout/stderr.
- TDD: AC-1 red, re-run in this session against the pre-Step-1 tree (`git archive HEAD^ scripts services` into a scratch dir, no stash): `E       assert 0 == 1` with `[dirty] force-resetting xstockstrat-indicators to version 0` in stdout, `1 failed in 0.68s`, `exit=1` → green on the dev branch: `1 passed in 0.50s`, ruff `All checks passed!`, `61 files already formatted`, `exit=0`. No coverage gate applies to `scripts/`. Between now and Steps 3+4 the refused indicators run prints no recovery text (expected per Step Dependencies).
- Config-key wiring gate: N/A (no config key, no config migration).
- Files modified: `scripts/tests/test_db_migrate.py`
- Deviations: none

### Step 3 — service: the dirty guard refuses every dirty state and computes the recovery [done] (atomic unit Steps 3+4)
- `scripts/migration-dirty-guard.sh` replaced with the spec body: the contract-floor scan and both exit-0 allow-paths are gone; it exits 3 with the state-keyed ratchet (`force <prev>`, or `TRUNCATE public.<schema>_schema_migrations` for the lowest up-file, then the `force <n>` / `force <next>` escalation lines), 2 when no recovery is computable, 1 on usage. Keeps the "is dirty at version N" prefix and the literal `$DATABASE_URL`; still executable and still `r0` in the allowlist.
- TDD (unit): red = Step 4's modules against the pre-unit guard, `.sdd-logs/v-1.log` `exit=1`: `E       assert 0 == 3` (legacy-a: `returncode=0 ... stderr=''`), `16 failed, 3 passed in 2.36s` (legacy-e, usage and the Step 2 no-force test pass on the old guard) → green `.sdd-logs/v-2.log` `exit=0`: shellcheck + shfmt clean, no `floor`/`contract-of` in the guard, `19 passed in 1.96s`. No coverage gate applies to `scripts/`.
- Verification: operator decision A (2026-11-21) — `envsubst` (gettext-base 0.21) now on the host; both Verification blocks re-run with fresh logs.
- Config-key wiring gate: N/A (no config key, no config migration).
- Files modified: `scripts/migration-dirty-guard.sh`
- Deviations: none

### Step 4 — test: port the guard tests to pytest and delete the legacy shell test [done] (atomic unit Steps 3+4)
- Created `scripts/tests/test_migration_dirty_guard.py` (one parametrized test over the 16-row case table, whole-line `Recover:` matching, no `postgres://`/`hunter2` anywhere, literal `$DATABASE_URL` on exit 3, no `  Recover:` line on exit 2, plus a usage test); added `test_ac1_output_names_the_recovery` to `scripts/tests/test_db_migrate.py`; deleted `scripts/migration-dirty-guard.test.sh`, its `scripts/shell-allowlist.txt` line and its `ci.yml:841` chain entry (the other five stay in order). Legacy (f), (h), (i) not ported (design §4).
- TDD: AC-1/AC-3/AC-4/AC-5 red in `.sdd-logs/v-1.log` (AC-1 recovery line: `assert '  Recover: migrate -path services/xstockstrat-indicators/migrations ... force 4' in []`) → green `.sdd-logs/v-3.log` `exit=0`: `38 passed in 2.20s`, ruff `All checks passed!`, `62 files already formatted`, `check-shell-freeze: clean (23 allowlisted)`, `render-migrations.test.sh: all assertions passed`, `migration-ahead-check.test.sh: all assertions passed`.
- Config-key wiring gate: N/A.
- Files modified: `scripts/tests/test_migration_dirty_guard.py`, `scripts/tests/test_db_migrate.py`, `scripts/migration-dirty-guard.test.sh` (deleted), `scripts/shell-allowlist.txt`, `.github/workflows/ci.yml`
- Deviations: none

### Step 5 — service: reword the ahead-check's dirty-ahead refusal [done]
- `scripts/migration-ahead-check.sh:58` now says "refusing to migrate it" instead of "refusing \`force 0\`"; `:60` names `$prev` as the previous version present in the newer release and states it assumes no gap below `$n`. `:59`, `prev=$((n - 1))` and exit 4 are unchanged.
- TDD (Red order): Step 6's test was authored in the working tree first. Red `.sdd-logs/v-1.log` `exit=1`: `E       assert "  (force the previous version present in the newer release: 9998 assumes it has no gap below 9999; ..." in [... "  (use '?x-migrations-table=' when DATABASE_URL has no query string), then fix forward and redeploy that release."]`, `1 failed, 2 passed in 1.22s` → green `.sdd-logs/v-3.log` `exit=0`: `3 passed in 1.12s`, ruff `All checks passed!`, `62 files already formatted`. The test file was removed before this commit; it is committed under Step 6. No coverage gate applies to `scripts/`.
- Verification `.sdd-logs/v-2.log` `exit=0`: shellcheck + `shfmt -d -i 2` clean, `migration-ahead-check.test.sh: all assertions passed`.
- Config-key wiring gate: N/A (no config key, no config migration).
- Files modified: `scripts/migration-ahead-check.sh`
- Deviations: none

### Step 6 — test: a dirty-ahead service is refused with the reworded recovery [done]
- Added `test_dirty_ahead_service_is_refused_with_the_newer_release_recovery` to `scripts/tests/test_db_migrate.py`: `run_up` with marketdata `9999 (dirty)` asserts exit 1, no `migrate ... force` call, both exact recovery lines (`... force 9998` and the reworded "(force the previous version present in the newer release: 9998 assumes it has no gap below 9999; ...)" line) and no `hunter2`/`postgres://` in stdout or stderr. Regression guard for durable `@AC-25` (279).
- TDD: red re-run in this session against the pre-Step-5 tree (`git archive HEAD^` (32ba2194) `scripts services` into a scratch dir with the new test copied in, no stash), log `scratchpad/red6/.sdd-logs/v-1.log` `exit=1`: `E       assert "  (force the previous version present in the newer release: 9998 assumes it has no gap below 9999; ..." in [... "  (use '?x-migrations-table=' when DATABASE_URL has no query string), then fix forward and redeploy that release."]`, `1 failed, 2 passed in 1.20s` → green on the dev branch `.sdd-logs/v-2.log` `exit=0`: `3 passed in 1.22s`, ruff `All checks passed!`, `62 files already formatted`. No coverage gate applies to `scripts/`.
- Config-key wiring gate: N/A (no config key, no config migration).
- Files modified: `scripts/tests/test_db_migrate.py`
- Deviations: none

### Step 7 — service: add the ordering gate `scripts/check-migration-order.py` [done]
- Created `scripts/check-migration-order.py` (stdlib, executable, shaped like `check-migration-contract.py`): `<base_ref> [--forbid-new]`, one `git diff --name-status --no-renames --diff-filter=ADM base...HEAD -- 'services/*/migrations/*.up.sql'` call, per-service base maximum from `git ls-tree` compared with `int()`, and the five `order-gate: ` refusal lines from the spec (every violation reported, exit 1), success line on stdout, exit 2 for any other argument shape. A base ref beginning with `-` is also treated as usage (exit 2), so a lone unknown flag never reaches `git`.
- TDD (Step 7 RED protocol): Step 8's module was authored in the working tree first and run against an argument-handling-only stub. AC-2 red `.sdd-logs/v-1.log` `exit=1`: `test_ac2_late_lower_number_is_refused` `E       AssertionError: assert 0 == 1`, `11 failed, 14 passed in 1.07s` (every refusal case fails on its exit code) → green `.sdd-logs/v-3.log` `exit=0`: `25 passed in 0.83s`, ruff `All checks passed!`, `64 files already formatted`. The test file was removed before this commit; it is committed under Step 8. No coverage gate applies to `scripts/`.
- Verification `.sdd-logs/v-2.log` `exit=0`: `usage: check-migration-order.py <base_ref> [--forbid-new]` (no-arg run, exit 2), `order-gate: ok — 0 new migration(s), each above the base maximum` against `origin/main-dev`, ruff `All checks passed!`, `64 files already formatted`.
- Config-key wiring gate: N/A (no config key, no config migration).
- Files modified: `scripts/check-migration-order.py`
- Deviations: none

### Step 8 — test: the ordering gate against a throwaway repository [done]
- Created `scripts/tests/test_check_migration_order.py` with its own `git`/`add`/`commit` helpers and `repo` fixture (base `main`: config `023_a`/`025_b` up+down with a gap at 024, plus a second service with `008_a`/`009_b`; then `checkout -q -b work`). 18 cases cover every row of the Step 8 list: usage (3), AC-2 `024`, `025_dup`, `026_next`, stale branch (`026_x` on `main` after branching), renumber as delete, delete, modify, shared `026`, down-files only, new service `000`, decimal `010_c`/`009_c`, `abc.up.sql`, and `--forbid-new` with and without an added file.
- TDD: AC-2 red, re-run in this session in a scratch copy (`git archive HEAD scripts`, `check-migration-order.py` cut to argument handling only, no stash), log `scratchpad/red8/.sdd-logs/v-1.log` `exit=1`: `test_ac2_late_lower_number_is_refused` `E       AssertionError: assert 0 == 1`, `14 failed, 11 passed in 0.79s` (every refusal and ok-line case fails) → green on the dev branch `.sdd-logs/v-2.log` `exit=0`: `25 passed in 0.72s`, ruff `All checks passed!`, `64 files already formatted`. No coverage gate applies to `scripts/`.
- Config-key wiring gate: N/A (no config key, no config migration).
- Files modified: `scripts/tests/test_check_migration_order.py`
- Deviations: none

## Session 2026-11-26 — sdd-execute sequential (sdd-batch-execute)

- Operator decision (binding, 2026-11-26) on the Step 9 blocker: "10 spaces". Step 9 keeps its `ci.yml` convention (the `FORBID_NEW` env line and the `check-migration-order.py` run line at 10 spaces); Step 10's two expected strings become 10 spaces. Logged in the `## Deviation Log`.

### Step 9 — service: CI job `migration-order-gate` [done]
- `.github/workflows/ci.yml`: `scripts/check-migration-order.py` added to the `migrations` path filter; the stale `migration-rerun` comment rewritten (no more "replays the chain from version 0"); new PR-only job `migration-order-gate` after `migration-contract-gate` (checkout `fetch-depth: 0`, `BASE_REF`/`FORBID_NEW` env, positive-form D-11 expression, `head_ref` only inside the expression); registered in `ci-gate` `needs:` and its result echo.
- TDD (Red order): Step 10's wiring test was authored in the working tree first with the operator-corrected 10-space strings. AC-2 red `.sdd-logs/v-1.log` `exit=1`: `E           AssertionError:   migration-order-gate:`, `1 failed, 18 passed in 0.67s` → green `.sdd-logs/v-3.log` `exit=0`: `19 passed in 0.60s`, ruff `All checks passed!`, `64 files already formatted`. The test edit was reverted before this commit; it is committed under Step 10. No coverage gate applies to `scripts/`.
- Verification `.sdd-logs/v-2.log` `exit=0`: `959:  migration-order-gate:`; `migration-order-gate` on 3 lines, `scripts/check-migration-order.py` on 2, no "replays the chain from version 0", PyYAML 6.0.3 `safe_load` parsed the file.
- The `FORBID_NEW` expression still cannot run locally; its first real runs are the integration PR (base `main-dev` → empty) and the next promotion PR (base `main`, head `main-dev` → empty) — note both in the integration PR.
- Config-key wiring gate: N/A (no config key, no config migration).
- Files modified: `.github/workflows/ci.yml`
- Deviations: Step 10's expected indentation for two lines corrected to 10 spaces (operator decision; Deviation Log)

### Step 10 — test: the CI wiring of the ordering gate [done]
- Added `test_ci_runs_the_order_gate_and_the_ci_gate_requires_it` to `scripts/tests/test_check_migration_order.py`: it reads `SCRIPTS_DIR.parent / ".github/workflows/ci.yml"` as text and asserts six whole lines (job key, `ci-gate` needs entry, result echo, path filter, `FORBID_NEW` expression, run line), the last two at 10 spaces per the 2026-11-26 operator decision (Deviation Log).
- TDD: AC-2 red against the pre-Step-9 tree (`git archive HEAD^` (8e88fddb) `scripts .github` into a scratch dir with the final test copied in, no stash), log `scratchpad/red10/.sdd-logs/v-4.log` `exit=1`: `E           AssertionError:   migration-order-gate:`, `1 failed, 18 passed in 0.67s` → green on the dev branch `.sdd-logs/v-3.log` `exit=0`: `19 passed in 0.65s`, ruff `All checks passed!`, `64 files already formatted`. A first green run (`v-2.log`) failed ruff `ISC004` on the test's own implicit concatenation; parenthesised, then re-run. No coverage gate applies to `scripts/`.
- Config-key wiring gate: N/A (no config key, no config migration).
- Files modified: `scripts/tests/test_check_migration_order.py`
- Deviations: none beyond the Step 9/10 indentation entry already logged

## Session 2026-11-27 — operator ruling on the Step 11 markdownlint blocker, recorded by the orchestrator (verbatim)

Question (Step 11 blocker): "Step 11's Verification ends with markdownlint-cli2 on the four docs and exits 1 because of 17 findings that already exist on lines this step did not touch (docs/context-constitution.md 4, docs/runbooks/config-rollout.md 13). A (recommended): fix the 17 existing markdownlint findings in docs/runbooks/config-rollout.md and docs/context-constitution.md (both already in Step 11's Files)... B: accept as a deviation... C: narrow the lint target."
Operator answer (2026-11-27): "B3 fix the lint".

Effect: option A — expand Step 11 scope to fix the 17 pre-existing findings in the two files, re-run Verification for exit=0, log the expansion in the Deviation Log. 318 is no longer suspended: it resumes at Step 11.

## Session 2026-11-27 — sdd-execute sequential (sdd-batch-execute)

### Step 11 — docs: forward-only rule, refuse-all recovery and the gate verdicts [done]
- `docs/patterns/database.md`: forward-only rule and next-free-NNN-at-merge under "Adding a new migration" item 1 (narrows insights.md:900), the modify/delete ban under item 3, the `force 0` sentence replaced (up never recovers, exits 1), "the printed `migrate force <prev>`" in the `migration-rerun` bullet, a new `migration-order-gate` CI bullet with the O-4 verdicts, cost and stale-base race, Guard and Recovery rewritten as the ratchet (Floor rule deleted; `000`-based `force 0` paragraph, D-13; O-1 accepted-cost paragraph), Ahead rule reworded. `script-tooling.md` R0 tests cell and ported list, `config-rollout.md` floor sentence, `context-constitution.md:82` CI list updated.
- TDD: N/A (docs). Pre-edit baseline `.sdd-logs/v-1.log` `exit=1` (`Floor rule` and `contract floor of 40` still present; `Summary: 17 issues in 2 files`) → Verification `.sdd-logs/v-2.log` `exit=0`: all three positive greps match, both `!` greps empty, `Summary: 0 issues in 0 files`.
- Config-key wiring gate: N/A (no config key, no config migration).
- Files modified: `docs/patterns/database.md`, `docs/patterns/script-tooling.md`, `docs/runbooks/config-rollout.md`, `docs/context-constitution.md`
- Deviations: scope expanded to fix 17 pre-existing markdownlint findings in config-rollout.md and context-constitution.md (operator decision 2026-11-27, option A; Deviation Log)

### Step 12 — docs: record the gaps this feature leaves open [done]
- Operator decision (2026-11-27, option A, by extension of the Step 11 ruling "B3 fix the lint"): Step 12 also fixes the 3 pre-existing markdownlint findings in `docs/context-constitution-findings.md`.
- Added three rows dated "found 2026-11-20, feature 318": two Latent bugs (the ahead-check's `force <n-1>` can name a missing version, marketdata 007 / config 024, 035, 036, 053; a cross-service `-- contract-of:` header passes every check) and one Documentation-that-lies row (`migration-rerun.py` `~L7`, `~L735`, `~L1067-1068`, `~L1079` still describe a contract floor and an automatic `force 0`; reword when next edited). Lint fixes: one blank line deleted at `:83-84`, footer `_..._` → `*...*`; no wording changed.
- TDD: N/A (docs). Pre-edit baseline `.sdd-logs/v-1.log` `exit=1` (`Summary: 3 issues in 1 file`: MD012 `:84`, MD049 `:109`, `:110`) → Verification `.sdd-logs/v-2.log` `exit=0`: marker count 3, `Summary: 0 issues in 0 files`.
- Config-key wiring gate: N/A (no config key, no config migration).
- Files modified: `docs/context-constitution-findings.md`
- Deviations: scope expanded to fix 3 pre-existing markdownlint findings in the same file (operator decision 2026-11-27, option A; Deviation Log)

### Step 13 — docs: operator-signed changes to two durable business rules (C-16) [done]
- Instruction 0: `grep -n '^- \*\*O-3: C-16 sign-off\*\*' context.md` matched `:524`. `docs/sdd/business-rules/platform.feature` `@AC-19 @FR-8 @feature-225`: tags kept, scenario replaced by the refuse-all Scenario Outline (five Examples rows) under a two-line `# Changed by @feature-318 ...` comment. `services/xstockstrat-config/acceptance/fix-config-keys-drift.feature` `@AC-28`: change comment added above the tag line and the last clause reworded to "the dirty guard refuses a dirty 041 with exit 3 naming force 40 ... migrate force 40 and up converge"; its other lines unchanged.
- TDD: N/A (docs). Pre-edit baseline `.sdd-logs/v-1.log` `exit=0` but with `390:    Then both evaluations allow the automatic force-0 recovery` and `109:    And an automatic force 0 from a dirty 041 ...` printed (the block's status is its last line only) → Verification `.sdd-logs/v-2.log` `exit=0`: `feature-318` at `platform.feature:386` and `fix-config-keys-drift.feature:102`, both `!` greps print nothing, `@AC-19 @FR-8 @feature-225` count 1.
- Config-key wiring gate (`--final`, last step) `.sdd-logs/v-3.log` `exit=0`: two baseline `REPORTED:` lines (analysis `marketdata/fundamentals.provider`, trading `platform/trading_state`, both `readers-disagree`), neither touched by 318. Status: in-progress → code-completed.
- At integration the scenario-promoter promotes `@AC-1`…`@AC-5` from the branch-tip `acceptance.feature` and dedups `@AC-3`…`@AC-5` against the rewritten `@AC-19` (Step 13 instruction 3).
- Files modified: `docs/sdd/business-rules/platform.feature`, `services/xstockstrat-config/acceptance/fix-config-keys-drift.feature`
- Deviations: none

## Session 2026-11-27 — sdd-execute
**Steps this session**: 11, 12, 13
**Progress**: 13 done / 13 total
**Stopped at**: Step 13 (all complete)
**Next**: integration PR `feature/fix-migration-tooling-safety` → `main-dev` (name 345's config `053` renumber, the `FORBID_NEW` first-run checks and the four `[ ] unaddressed` impl-spec warnings in its description)
