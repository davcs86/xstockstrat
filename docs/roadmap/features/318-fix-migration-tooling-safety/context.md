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
