# Context Log: fix-auth-trust-hardening

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-10 (/sdd-triage)

- Bug reported via defect reports (clustered triage):
  - docs/reports/2026-10-20-config-setconfig-internal-caller-no-peersan-defect.md (SEV-2)
  - docs/reports/2026-10-19-identity-revoketoken-unverified-decode-defect.md (SEV-3)
  - docs/reports/2026-10-29-agent-dcr-fail-closed-defect.md (SEV-2, security posture)
- Cluster rationale: all three are auth edges that trust unverified input (header without peer SAN, unsigned JWT,
  unknown policy treated as permissive) — one security-hardening review.
- Severity: SEV-2 (highest of cluster)
- Routed to SDD path (Track C); prod-impacting SEV-2 routed to C by operator decision 2026-11-10
- Created: status.md, feature.md, product-spec.md, acceptance.feature (3 regression scenarios), context.md
- Affected services (from reports): xstockstrat-config, xstockstrat-trading, xstockstrat-identity, xstockstrat-agent
- Root cause hypothesis: feature-102 grant lacks peerSan; identity uses jwt.decode; agent DCR reads are best-effort
  fail-open (feature 247 FR-2/AC-4).
- **Open decision carried forward:** the operator earlier kept agent-dcr-fail-closed open pending a fail-closed
  security-posture decision. Recorded as product-spec Open Question 1; it overrides feature 247 FR-2/AC-4 and needs
  explicit operator sign-off recorded here before design concludes. AC-3 assumes fail-closed.
- Recommended design depth: full → `/sdd-design fix-auth-trust-hardening` (rationale: SEV-2, security posture, 4 affected services)
- Development branch: feature/fix-auth-trust-hardening

## Session 2026-11-10 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings: bug-template conventions (no FR-N/@FR tags; no Consumer Surface section); OQ1 (fail-closed DCR) needs operator sign-off before design concludes — AC-3 provisional and supersedes feature 247 FR-2/AC-4; trading poller SAN needs an acceptance line
- Overlap findings: WARN: configServiceImpl.ts shared with 314; agent shared with 314/322/328/331
- Recommended design depth: full (security posture; config/trading/identity/agent)
- Tree: ccr-500a9eb9-nvk45x (origin/main-dev 0fecb24d + triage/docs commits; no feature branch yet)

## Session 2026-11-10 (operator decisions before /sdd-design)

- Operator signed off **fail-closed DCR**: `/oauth/register` returns 503 and issues no client_id when `oauth.registration_enabled` or `oauth.allowed_redirect_uris` cannot be read. Supersedes feature 247 FR-2/AC-4 (201 on a stall) — `/sdd-design` marks that promoted scenario superseded (C-16). Identity-side allowlist enforcement is not in scope.
- AC-3 precondition reworded: since feature 295 the policy is read from the WatchConfig snapshot, so a GetConfig stall no longer causes a read failure; the failing case is a missing/unreadable snapshot.

## Session 2026-11-11 — sdd-batch design gate (round 2)

`/sdd-design fix-auth-trust-hardening` (full) is halted at its approval gate after round 2 (gate policy: halt).
design.md is not written and status.md is unchanged. Register: `debate.md` (D-1..D-12, R-1..R-10, O-1..O-4).

## Open Threads

- **Approach:** the round-1 Steps 1–4 stand (D-1..D-8).
  - Step 1, config: the SetConfig poller grant is bound to peerSan `xstockstrat-trading`, and caller_identity is persisted only when the grant authorizes the call.
  - Step 2, identity: RevokeToken calls `jwt.verify` with ignoreExpiration and HS256 pinned. An unverifiable token is ignored with success:true.
  - Step 3, agent: DCR fails closed with 503 when no snapshot is readable.
  - Step 4: docs and the C-16 amendments.
  - Round 2 adds the label-free counter `identity.revoke.unverifiable` (D-9). It increments only in the verify-catch, is registered in telemetryAllowlist MIN_INSTRUMENTS and drive(), and is asserted as an And on 319 @AC-2. Round 2 also adds a fixed, PII-free WARN (D-10).
  - Evidence shows that DO leaf certs carry DNS SAN = service name: do-render-app-spec.py `mint` runs gen-dev-certs.sh:50 (D-11).
  - The O-1 rejection fallback is corrected: if the operator rejects the amendments, Step 1 is deferred out of 319 (D-12).
- **Strongest open objection (O-1, blocking, C-16):** the operator must explicitly sign off the in-place @feature-319 Given amendments to config @AC-2/241, @AC-5/296 and @AC-25/295 (the SAN-bound poller success path). The sign-off goes in this file before design concludes. Rejecting means Step 1 is deferred, and no variant lands the code while the scenarios stay unamended.
- **Also open:**
  - O-3 (non-blocking, same operator prompt): confirm the OQ3 resolution (ignore, success:true, no UPDATE, WARN plus the counter).
  - O-4 (non-blocking): confirm the homelab leaf SAN render path before Step 1 merges.
  - O-2 closed in round 2.
- **Floor status:** no breaches.
- **Uncovered @AC changes (no operator decision yet):**
  - EXTEND 319:@AC-1 and 319:@AC-2;
  - CHANGE config:@AC-2/241, @AC-5/296 and @AC-25/295;
  - EXTEND identity:@AC-52;
  - PRESERVE @AC-54, identity:@AC-41 and @AC-47.
  - Covered by the 2026-11-10 operator decision: 319:@AC-3 and agent:@AC-4/247.

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

## Session 2026-11-13 — sdd-batch design gate (round 3)

`/sdd-design fix-auth-trust-hardening` (full) is halted at its approval gate after round 3 (gate policy: halt).
design.md is not written and status.md is unchanged. Register: `debate.md` (D-1..D-16, R-1..R-12, O-1..O-6).

## Open Threads

- **Approach:** the round-2 Steps 1–4 stand (D-1..D-12); the design does not change. Round 3 closes O-4 and the docs/oauth.md risk with verified evidence, and adds three documentation targets.
  - Step 1 has no deploy precondition left. DO, homelab and local leaves are all minted by gen-dev-certs.sh:50 `DNS:${svc}`; homelab goes through homelab-release-env.sh:37-39, whose owned regex drops operator overrides (D-13). Step 1's only gate is O-1 (D-12).
  - Step 1 Files add docs/context-constitution.md. The PLAT-9 row (:47) write-direction clause ("has **no** `peerSan`") is rewritten to the SAN-bound poller grant, the authz.ts anchors are refreshed, and the row records the contract that the grant peerSan equals the gen-dev-certs.sh:50 leaf SAN (D-14).
  - Step 1 Files add one findings row in services/xstockstrat-trading/docs/context-constitution-findings.md: escalateSystemic only WARNs when SetConfig fails (trading.go:2278-2280) yet still alerts "trading reduced to REDUCE_ONLY" (:2285). No trading code changes in 319 (D-15).
  - Step 3 must edit the services/xstockstrat-agent/CLAUDE.md:208 `oauth.registration_enabled` row to "(disabled ⇒ 403; policy snapshot absent ⇒ 503)". The docs/oauth.md:21 note is optional; that file makes no fail-open claim (D-16).
- **Strongest open objection (O-1, blocking, C-16):** the operator must explicitly sign off the in-place @feature-319 Given amendments to config @AC-2/241, @AC-5/296 and @AC-25/295 (the SAN-bound poller success path), recorded in this file before design concludes. If rejected, Step 1 (with the PLAT-9 and trading-findings doc edits) is deferred under D-12, and Steps 2–4 proceed.
- **Also open:**
  - O-3 (non-blocking, same operator prompt): confirm the OQ3 resolution (ignore, success:true, no UPDATE, WARN plus identity.revoke.unverifiable).
  - O-5 (non-blocking, F-08): the next proposer must carry docs/context-constitution.md into Step 1 Files.
  - O-6 (non-blocking, P-03): the next proposer must adopt the PLAT-9 SAN contract note and the trading findings row.
  - O-4 closed in round 3.
- **Floor status:** no breaches.
- **Uncovered @AC changes (no operator decision yet):**
  - EXTEND 319:@AC-1 and 319:@AC-2;
  - CHANGE config:@AC-2/241, @AC-5/296 and @AC-25/295;
  - EXTEND identity:@AC-52;
  - PRESERVE @AC-54, identity:@AC-41 and @AC-47.
  - Covered by the 2026-11-10 operator decision: 319:@AC-3 and agent:@AC-4/247.

```sdd-batch-design-state
{
  "round": 3,
  "synth": {
    "approach": "The round-2 synthesis stands: Steps 1–4 rest on D-1..D-12, and the design does not change. Round 3 closes O-4 and the docs/oauth.md risk with new, verified evidence. It also adds three documentation targets that the adversary found missing and I verified this round.\n\nSTEP 1: CONFIG (D-1, D-2, D-3). Code is unchanged.\n- In services/xstockstrat-config/src/grpc/authz.ts, the poller grant gains peerSan:'xstockstrat-trading'.\n- hasInternalCallerAuthority(call, …) reuses the :185 predicate and peerDnsSans.\n- The call site moves in configServiceImpl.ts (~:681).\n- caller_identity is persisted only when internalCallerAuthorized is true (:724).\n- The deny log keeps reason 'no_admin_or_internal_grant' and adds hadPeerSan and peerSan.\n- Order (F-05): harness green, then RED for @AC-1, then the grant flip together with its test files.\n- There is no deploy precondition. DO, homelab and local leaves all come from gen-dev-certs.sh:50 `DNS:${svc}`:\n  - DO: D-11;\n  - homelab: homelab-release-env.sh:37-38 → gen-dev-certs.sh, with the owned regex at :39 dropping any operator override, and homelab-mtls-env.py:30-37 → compose.yml:216-217;\n  - local: mtls-provision.sh / mtls-dev-env.sh.\n- Step 1's only gate is O-1 (D-12).\n\nStep 1 Files gain two docs (F-08: the executor may stage only listed files).\n(a) docs/context-constitution.md, the PLAT-9 row (:47).\n- Rewrite the write-direction clause. Today it says the allowlist \"has **no** `peerSan`\". After the edit it says the trading-reconciliation-poller grant also binds peerSan 'xstockstrat-trading', so the header alone no longer grants SetConfig authority.\n- Refresh the authz.ts anchors (`#INTERNAL_CALLER_ALLOWLIST`, the `.some(` check) to their post-change lines.\n- Record the cross-module contract in the row, naming both ends: the grant's peerSan literal must equal the leaf DNS SAN emitted by scripts/gen-dev-certs.sh:50 (`DNS:${svc}`). A change of SAN form in the generator silently denies the systemic halt.\n- Also update config CLAUDE.md invariant 7, as already planned.\n(b) services/xstockstrat-trading/docs/context-constitution-findings.md, one findings row for a defect that predates 319:\n- escalateSystemic (services/xstockstrat-trading/internal/service/trading.go:2278-2280) only WARNs when SetConfig fails.\n- It still emits a CRITICAL alert titled \"trading reduced to REDUCE_ONLY\" (:2285), so the operator is told the halt succeeded when it was denied.\n- 319 adds a new way for SetConfig to be denied (a SAN mismatch), so it logs the finding. It does not change trading code.\n\nSTEP 2: IDENTITY. Unchanged (D-4, D-9, D-10).\n- RevokeToken: jwt.verify(token, this.jwtSecret, {ignoreExpiration:true, algorithms:['HS256']}), with HS256 also pinned in validateToken.\n- An unverifiable token gets the fixed WARN, recordRevokeUnverifiable(), success:true and no UPDATE.\n- A missing JWT_SECRET stays code 13.\n- telemetryAllowlist.test.ts: add the counter to MIN_INSTRUMENTS and drive().\n- Add the counter And to 319 @AC-2.\n- Clear the identity findings row.\n\nSTEP 3: AGENT (D-5, D-6, D-7).\n- Add WatchCore.has_snapshot() and watcher.has_snapshot('agent').\n- Check it once after the JSON parse and before the redirect_uris 400. On failure return 503 {error:server_error}, and make the except branches return the same.\n- Invert test_register_survives_config_read_failure.\n- Add a test that a readable false still returns 403.\n- Drive AC-3 by popping _WATCHERS['agent'].\n- Mandatory doc edit: in services/xstockstrat-agent/CLAUDE.md (Config Keys Consumed, :208), the `oauth.registration_enabled` row changes from \"(disabled ⇒ 403)\" to \"(disabled ⇒ 403; policy snapshot absent ⇒ 503)\".\n- Optional: a one-line 503 note on services/xstockstrat-agent/docs/oauth.md:21. That file makes no fail-open claim to correct.\n\nSTEP 4: DOCS AND C-16 (D-8, D-12).\n- Amend agent @AC-4/247 in place with @feature-319 to the 503 outcome.\n- The config @AC-2/241, @AC-5/296 and @AC-25/295 Given amendments (\"from an mTLS peer with DNS SAN `xstockstrat-trading`\"; the Thens are unchanged) stay BLOCKED on the operator.\n\nOPERATOR GATE. One prompt from the orchestrator, recorded in context.md before design concludes:\n(a) the exact Given text of the three config amendments (O-1, blocking);\n(b) the OQ3 resolution: ignore, success:true, no UPDATE, WARN plus identity.revoke.unverifiable (O-3).\n- If (a) is rejected, Step 1 (including the PLAT-9 and trading-findings doc edits) is deferred out of 319 under D-12, and Steps 2–4 proceed.\n- If (b) is rejected, that implies R-5, which only the operator can reopen.",
    "open_objections": [
      {
        "text": "O-1 (C-16): the operator must explicitly sign off the in-place @feature-319 Given amendments to config @AC-2/241, @AC-5/296 and @AC-25/295 (the SAN-bound poller success path), and the sign-off must be recorded in context.md before design concludes. If the operator rejects, Step 1 is deferred (D-12).",
        "blocking": true
      },
      {
        "text": "O-3: the operator confirms the OQ3 resolution: ignore an unverifiable token, success:true, no UPDATE, WARN plus the identity.revoke.unverifiable counter. It goes in the same prompt as O-1.",
        "blocking": false
      },
      {
        "text": "F-08 doc drift: Step 1 Files must list docs/context-constitution.md. In the PLAT-9 row (:47), the write-direction clause 'has **no** `peerSan`' is rewritten to the SAN-bound poller grant and the authz.ts anchors are refreshed. Otherwise the executor cannot stage it, and the root constitution goes on teaching that SetConfig authority comes from the header alone. The synthesis approach adopts this; the next proposer must carry it into Step 1 Files.",
        "blocking": false
      },
      {
        "text": "P-03 safety-path observability: D-1 adds a new denial cause (peer-SAN mismatch) to the systemic halt, which fails silently (trading.go:2278-2280 WARN only; :2285 still alerts 'reduced to REDUCE_ONLY'). The synthesis answers it in two ways: (a) the amended PLAT-9 records the contract that the grant peerSan equals the gen-dev-certs.sh:50 DNS:${svc} SAN, naming both ends; (b) a findings row in services/xstockstrat-trading/docs/context-constitution-findings.md records the misleading alert. No trading code changes. The next proposer must adopt both.",
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
      "A cross-module contract test pinning the grant's peerSan literal to gen-dev-certs.sh's SAN form. It couples a TS test to a bash script's text across languages, which is brittle. The live marketdata peerSan grant (authz.ts:141) already depends on the same contract without one. Recording the contract in PLAT-9 is the right size.",
      "Widening Step 1 into trading code so escalateSystemic stops alerting 'reduced to REDUCE_ONLY' when SetConfig fails. The defect predates 319 and is outside its scope (minimal diff). It is captured as a trading findings row instead.",
      "Leaving the PLAT-9 row unchanged and updating only config CLAUDE.md invariant 7. The root constitution would then state a false trust model ('no peerSan' on the write direction), the very gap 319 closes."
    ],
    "open_risks": [
      "O-1 rejection: if the operator declines the three config Given amendments, Step 1 (the headline SEV-2 SetConfig spoof) is deferred under D-12. 319 then ships only the identity and agent fixes, and the poller-header escalation stays open until a follow-up feature.",
      "Grant and generator SAN drift: if gen-dev-certs.sh ever moves to FQDN SANs, or a leaf is hand-minted, the poller's HALTED/REDUCE_ONLY escalation is denied. The failure is silent, and trading still alerts that the halt succeeded. It is mitigated only by the PLAT-9 contract note and the findings row; there is no CI guard.",
      "identity.revoke.unverifiable spikes after every JWT_SECRET rotation, from legitimate logouts of pre-rotation tokens. It is documented as not a forgery signal on its own.",
      "A stale agent snapshot after a WatchConfig disconnect keeps serving the last-known DCR policy. Accepted under D-6.",
      "The agent 503 path is unreachable in a correctly booted process. A future dead-code pass could remove it unless design.md and a constraint comment record why it exists (D-7).",
      "With ignoreExpiration:true, a years-old leaked but validly signed token can still trigger a revoke. HS256 pinning does not bound the age.",
      "Merge-order overlap: configServiceImpl.ts is shared with feature 314, and agent files with 314/322/328/331. docs/context-constitution.md is a widely edited file, which adds a rebase-conflict surface."
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
      "F-08",
      "P-02",
      "P-03",
      "P-06",
      "IDENTITY-4",
      "PLAT-9",
      "PLAT-N1"
    ],
    "rationale": "O-4 closes this round.\n- The proposer's homelab evidence is new: D-11 cited only do-render-app-spec.py.\n- The adversary verified it independently: homelab-release-env.sh:37-39 → gen-dev-certs.sh:50 DNS:${svc}, with the owned regex dropping overrides; homelab-mtls-env.py:30-37 → compose.yml:216-217.\n- Local dev uses the same generator.\n- So Step 1 has no deploy precondition left.\n\nThe docs/oauth.md risk also closes: its only DCR line is :21, and it makes no fail-open claim.\n\nI verified each adversary objection against the code this round:\n- docs/context-constitution.md:47 does say the write-direction allowlist 'has **no** `peerSan`'. That becomes false after D-1, and no step listed the file, so F-08 would have kept it out of the executor's staging.\n- trading.go:2278-2280 only WARNs on SetConfig failure, while :2285 still titles the CRITICAL alert 'trading reduced to REDUCE_ONLY'.\n- The agent CLAUDE.md :208 row reads '(disabled ⇒ 403)' with no 503 case.\n\nI folded all three into the approach as concrete file targets:\n- PLAT-9 rewrite plus the SAN-contract note (the adversary's option a);\n- a trading findings row (option b), because a defect we discovered should be logged, not lost, and it does not widen scope into trading code;\n- the agent CLAUDE.md row as mandatory.\n\nThe PLAT-9 and P-03 items stay open, non-blocking, until the next proposer carries them into Step 1 Files, since a proposal has not yet answered them.\n\nO-1 stays blocking and O-3 stays open: both need the operator, and no operator decision is recorded.\n\nThe approach honours D-1..D-12 and reintroduces no R-n. There are no Floor breaches and no REOPEN petitions.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "Homelab and local mTLS leaves are minted by the same gen-dev-certs.sh generator as DO leaves (DNS SAN = service name), and operator overrides are dropped. Step 1 has no deploy-ordering precondition.",
          "evidence": "scripts/homelab-release-env.sh:37-39 (decode-ca then gen-dev-certs.sh; owned regex [A-Z]+_MTLS_(CERT|KEY)); scripts/gen-dev-certs.sh:28,50; scripts/homelab-mtls-env.py:30-37; deploy/homelab/compose.yml:216-217; deploy-homelab.yml:160; mtls-dev-env.sh:37-42"
        },
        {
          "text": "Step 1 Files include docs/context-constitution.md. The PLAT-9 row's write-direction clause is rewritten to the SAN-bound trading-reconciliation-poller grant, its authz.ts anchors are refreshed, and the row records the contract that the grant peerSan equals the gen-dev-certs.sh:50 DNS:${svc} leaf SAN, naming both ends.",
          "evidence": "docs/context-constitution.md:47 ('it has **no** `peerSan`', verified r3); F-08; trading.go:2278-2285"
        },
        {
          "text": "Step 1 adds one row to services/xstockstrat-trading/docs/context-constitution-findings.md for the pre-existing defect that escalateSystemic emits a 'reduced to REDUCE_ONLY' CRITICAL alert even when SetConfig fails. No trading code changes in 319.",
          "evidence": "services/xstockstrat-trading/internal/service/trading.go:2278-2280 (WARN only), :2285 (alert title) (verified r3)"
        },
        {
          "text": "Step 3 must edit the services/xstockstrat-agent/CLAUDE.md Config Keys row for oauth.registration_enabled to add 'policy snapshot absent ⇒ 503'. The docs/oauth.md:21 note stays optional, because that file makes no fail-open claim.",
          "evidence": "services/xstockstrat-agent/CLAUDE.md:208 ('(disabled ⇒ 403)', verified r3); services/xstockstrat-agent/docs/oauth.md:15,21"
        }
      ],
      "new_rejected": [
        {
          "text": "A cross-module CI contract test pinning the authz.ts grant peerSan literal to gen-dev-certs.sh's SAN form",
          "why": "It is brittle cross-language coupling of a TS test to bash script text. The live marketdata peerSan grant (authz.ts:141) already depends on the same contract without one. Recording it in PLAT-9 is proportionate."
        },
        {
          "text": "Changing trading escalateSystemic code within 319 so its alert reflects a SetConfig failure",
          "why": "The defect predates 319 and is out of scope (minimal diff). It is captured as a trading findings row instead."
        }
      ],
      "new_objections": [
        {
          "text": "F-08: Step 1 Files must list docs/context-constitution.md, where the PLAT-9 write-direction 'no peerSan' clause is rewritten and the anchors refreshed. Otherwise the root constitution goes on misstating the SetConfig trust model.",
          "blocking": false
        },
        {
          "text": "P-03: the new SAN-mismatch denial of the systemic halt fails silently, and trading still alerts that the halt succeeded. Record the grant SAN ↔ gen-dev-certs DNS:${svc} contract in PLAT-9 and log a trading findings row. Do not widen into trading code.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-4",
          "how": "Closed by new, verified evidence: homelab leaves are minted by homelab-release-env.sh:37-38 → gen-dev-certs.sh:50 (DNS:${svc}), the owned regex at :39 drops overrides, homelab-mtls-env.py:30-37 maps them to TRADING_MTLS_*, and compose.yml:216-217 injects them. Local dev uses the same generator. D-11 had cited only do-render-app-spec.py."
        }
      ],
      "reopen_petitions": [],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```
