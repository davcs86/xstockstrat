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

## Session 2026-11-20 (operator decisions at the design gate)

- Operator (2026-11-20, design gate, option A): **C-16 sign-off** for the in-place `@feature-319` Given amendments to config `@AC-2` (`@feature-241`), `@AC-5` (`@feature-296`) and `@AC-25` (`@feature-295`) — the SAN-bound poller success path ("from an mTLS peer with DNS SAN `xstockstrat-trading`"; Thens unchanged). **O-1 is closed by this record.**
- The operator approved the design instead of reopening anything. No REOPEN petition was on file.
- No decision names the OQ3 resolution (O-3). It stands as settled D-4 and is carried as an open thread below.

## Session 2026-11-20 — sdd-design

- Phase 0 Recon: wrote recon.md (services: xstockstrat-config, xstockstrat-trading, xstockstrat-identity, xstockstrat-agent; key reuse patterns: the `GetSecret` `peerSan` predicate in `authz.ts`, the `validateToken` `jwt.verify` idiom).
- Phase 1 Grilling: 3 rounds (full); termination: approved. Chosen approach: bind the SetConfig poller grant to peer SAN `xstockstrat-trading` and persist caller_identity only when authorized; RevokeToken verifies the signature (HS256, ignoreExpiration) and ignores an unverifiable token with a WARN plus `identity.revoke.unverifiable`; agent DCR returns 503 when no `agent` snapshot is readable; the four durable scenarios are amended in place (D-1..D-16). Rejected: R-1..R-12 (a second denial-reason gate, a stream-liveness signal, an error on unverifiable revoke, a cross-language SAN contract test, trading code changes).
- Constitution rules touched: C-01, C-08, C-10, C-11, C-15, C-16, C-18, F-05, F-08, P-02, P-03, P-06, IDENTITY-4, PLAT-9, PLAT-N1. Floor breaches: none.
- Register: debate.md State approved; O-1 closed (operator sign-off above). O-3, O-5 and O-6 stay open, non-blocking.
- No ledger line: the debate surfaced no pattern or trap that the ledger does not already hold (fails.md 2026-11-04 covers the in-place amendment rule).
- Status: spec-ready → design-approved.

## Open Threads

- [ ] O-3: the OQ3 resolution (ignore an unverifiable token, success:true, no UPDATE, WARN plus the counter) has no explicit operator confirmation. A rejection implies R-5, which only the operator can reopen. Target: /sdd-spec, before Step 2 is written.
- [ ] O-5 / O-6: the spec must list `docs/context-constitution.md` (PLAT-9 row) and `services/xstockstrat-trading/docs/context-constitution-findings.md` in Step 1 Files (D-14, D-15). Target: /sdd-spec, Step 1 Files.
- [ ] Grant and generator SAN drift: an FQDN SAN or a hand-minted leaf silently denies the poller's HALTED/REDUCE_ONLY escalation while trading still alerts that the halt succeeded. No CI guard (R-11). Target: Step 1 docs; follow-up on the trading finding.
- [ ] `identity.revoke.unverifiable` spikes after every JWT_SECRET rotation and is not a forgery signal on its own. Target: Step 2 (counter description).
- [ ] With ignoreExpiration, a years-old leaked but validly signed token can still trigger a revoke. Accepted. Target: Step 2 (note).
- [ ] A stale agent snapshot after a WatchConfig disconnect keeps serving the last-known DCR policy. Accepted under D-6. Target: Step 3 (note).
- [ ] The agent 503 path is unreachable in a correctly booted process; a dead-code pass could remove it. Target: Step 3 (constraint comment, D-7).
- [ ] Merge-order overlap: `configServiceImpl.ts` with feature 314; agent files with 314/322/328/331; `docs/context-constitution.md` is widely edited. Target: /sdd-spec (merge-order.md) and the integration PR.

## Session 2026-11-20 — sdd-spec

- Generated implementation-spec.md with 8 steps. Status → implementation-ready.
- Tree: detached at `origin/feature/fix-auth-trust-hardening@307a0c2c` (merge-base with `origin/main-dev`: `c4fd48b0`, the recon tree); every cited `path:line` was re-grepped there.
- Operator decision in force (2026-11-20, design gate, option A): C-16 sign-off for the in-place `@feature-319` Given amendments to config `@AC-2` (241), `@AC-5` (296) and `@AC-25` (295). O-1 closed. Realised as Step 4, in the same atomic unit as the grant (D-12).
- Step shape: config = Step 1 (harness only, green under the old grant) then the Steps 2+3+4 unit; identity = Steps 5+6 unit; agent = Steps 7+8 unit. No proto, migration, config key, env var or port.
- `acceptance.feature` `@AC-2` gained the `identity.revoke.unverifiable` counter `And` (design.md Step 2 / D-9, EXTEND). No ID was renumbered.
- Key codebase findings:
  - **`watch_core.py` is a byte-identical four-copy group** (`scripts/check-watcher-copies.sh:17-20`, root constitution `docs/context-constitution.md:99`, CI `config-wiring`). D-5's public `WatchCore.has_snapshot()` therefore edits the indicators, ingest and analysis copies too, in Step 7. The design did not record this; it widens the diff past the four affected services at file level only (an additive, unused-there method).
  - `peerDnsSans` (`authz.ts:158`) is module-private; Step 2 exports it so the deny log can carry `peerSan` without a second parser (D-1, D-3). The two new log fields go only on the internal-caller ERROR branch.
  - Config `tsc` compiles tests (`tsconfig.json` `include: ["src/**/*"]`), so the `hasInternalCallerAuthority` signature change is atomic with `internalCallerAuthz.test.ts`; `setConfigAuthz.test.ts:193-199` pins the deny-log field set and flips with it. `setConfigSpelling.test.ts` moves in Step 1 (harness) and needs no edit at the flip.
  - No shared mTLS loopback helper exists; Step 1 adds `startMtlsLoopback` to `src/__tests__/mtlsTestPki.ts` (C-18; jscpd ignores tests).
  - Identity `tsc` also compiles tests, and `telemetryAllowlist.test.ts` `drive()` must call `recordRevokeUnverifiable`, so Steps 5+6 are one unit. No RevokeToken behaviour test existed (`identityServiceImpl.test.ts:263-277` only checks no-crash); `revokeToken.test.ts` is new.
  - Agent `@AC-3` must remove the `agent` watcher **inside** the `TestClient` block: the lifespan (`watcher.py:93-97`) re-creates a missing watcher and waits up to 90 s for its snapshot.
  - `fix-config-keys-contract.feature:5-8` already marks 296 `@AC-5` retired by feature 306 ("left unedited"); the operator-signed Given amendment is applied anyway and the header is left alone.
  - Dedup for the trading findings row (D-15): no existing report or findings row covers `escalateSystemic` alerting after a failed `SetConfig`; re-run the grep at execute time.
- No ledger line: nothing recurred that the ledger does not hold (the copy-group rule is already PLAT/`fails.md` 2026-11-10 material).

## Open Threads

- [ ] O-3: the OQ3 resolution (ignore an unverifiable token, `success:true`, no UPDATE, WARN plus the counter) still has no explicit operator confirmation. Steps 5-6 implement settled D-4. Target: the `/sdd-execute` Phase-2 confirmation of the Steps 5+6 unit; a rejection means R-5 (operator-only reopen) and a re-spec of Steps 5-6.
- [ ] F-A: Step 7 touches `watch_core.py` in indicators, ingest and analysis. If the operator does not want that, D-5 must be reopened (the alternative is `has_snapshot` on the agent's `ConfigWatcher` subclass). Target: `/sdd-review impl-spec`.
- [x] O-5 / O-6: `docs/context-constitution.md` (PLAT-9) and `services/xstockstrat-trading/docs/context-constitution-findings.md` are in Step 4 Files, in the Steps 2+3+4 unit (D-14, D-15).
- [ ] Grant ↔ generator SAN drift has no CI guard (R-11). Mitigation is Step 4's PLAT-9 contract note and the trading findings row. Target: follow-up on the trading finding.
- [ ] Merge-order: `docs/roadmap/features/merge-order.md` has no row for 319 and is outside this feature's writable files. Overlaps: `configServiceImpl.ts` with 314; agent files with 314/322/328/331; `docs/context-constitution.md`; and the four `watch_core.py` copies. Target: `/sdd-review impl-spec` overlap scan and the integration PR (re-run `scripts/check-watcher-copies.sh` after merging `origin/main-dev`).
- [ ] Post-deploy smoke on dev needs positive evidence; a systemic escalation is rare, so a trading `SetConfig` success may not occur in the window. Target: integration PR.
- [ ] Accepted, carried: `identity.revoke.unverifiable` spikes after a `JWT_SECRET` rotation (Step 5 docs); `ignoreExpiration` lets an old signed token revoke; a stale agent snapshot keeps the last-known DCR policy (D-6); the agent 503 guard is unreachable after a correct boot (constraint comment, D-7).

## Session 2026-11-20 — sdd-review impl-spec (advisory)

- Result: 0 failures, 8 warnings; overlap WARN, file-level only (no migration, proto field or config-key collision). Advisory — did not block; lifecycle unchanged (implementation-ready). No floor breach.
- Addressed in implementation-spec.md (each claim re-verified at `@24b8aa72`):
  - [x] Step 7: the indicators, ingest and analysis owners had only ruff checks. Verification now also runs each service's `tests/test_config_watcher.py` (the file exists in all three and builds that service's `ConfigWatcher`), and states that `has_snapshot` behaviour is tested only in the agent, with the copies held equal by `scripts/check-watcher-copies.sh`.
  - [x] Step 7: Verification mixed `cd` and repo-root commands. Every line now runs from the repo root through subshells.
  - [x] Step 2: anchor wording. The `internalCallerAuthorized` statement spans `configServiceImpl.ts:679-686`; the call expression is at `:681`, `call.metadata` at `:682`. The Tree note now says `/sdd-execute` re-greps anchors.
  - [x] Steps 2+3+4 fold: Step Dependencies now says only Step 3 is a build trigger; Step 4 is folded by D-12 / C-16 alone.
  - [x] Step 5: the `validateToken` HS256 pin is now marked as a validate-path behaviour change that product-spec.md does not name, sourced to design.md (`:57-59`, `:163`, C-10) and pinned by Step 6's HS384 case.
  - [x] Merge-order note: the trunk peers from the overlap scan (345, 330, 321, 329, 337) and the scan's limitation are listed in Step Dependencies.
- Not changed: Step 7's `WatchCore.has_snapshot` on the shared core (D-5, C-18 compliant; the alternative needs an operator reopen).
- Overlap findings: `authz.ts`, `identityServiceImpl.ts` and agent `watcher.py` with 345-authelia-sso; `configServiceImpl.ts` with 330-fix-live-enrich-ttl-seed (in-progress) and 321-fix-trading-config-plumbing; identity `telemetry.ts` with 329-fix-telemetry-startup-log and 337-metrics-host-provider-label; the four `watch_core.py` copies (no peer edit found); `/oauth/register` and `tests/test_oauth.py` with 345 (behavioural, below).

## Open Threads

- [ ] unaddressed — O-3: ignoring an unverifiable RevokeToken with `success:true` (D-4) still has no explicit operator decision. Steps 5-6 depend on it; a rejection means R-5 and a re-spec of both. Target: the `/sdd-execute` Phase-2 confirmation of the Steps 5+6 unit.
- [ ] unaddressed — `/oauth/register` contract with 345-authelia-sso (implementation-ready on `origin/main-dev`). 345 `@AC-43` expects 404 for the route once SSO is configured and keeps `tests/test_oauth.py` green as its legacy net (its spec `:1191-1193`); 319 Steps 7-8 rename a test in that file and return 503 in legacy mode when no `agent` snapshot is readable. The two may be compatible (404 when SSO is configured, 503 only on the legacy route), but that reading is not confirmed. Needs an operator decision on the status under SSO and on which feature merges first. Target: the `/sdd-execute` checkpoint before the Steps 7+8 unit.
- [ ] unaddressed — merge-order: `docs/roadmap/features/merge-order.md` has no row for 319 and is outside this feature's writable files. Add a row before the integration PR, covering the overlap findings above plus this spec's own unverified note (`configServiceImpl.ts` with 314; agent files with 314/322/328/331; `docs/context-constitution.md`).
- [ ] unaddressed — overlap scan limitation: specs of batch peers that live only on `origin/feature/<slug>` branches were not read. Re-run the scan against those branches before sequencing.
- [ ] unaddressed — F-A / D-5: Step 7 edits `watch_core.py` in indicators, ingest and analysis for a single consumer (the agent). Accepted by design; moving `has_snapshot` to the agent's `ConfigWatcher` subclass needs an operator reopen of D-5. Target: the `/sdd-execute` Phase-2 confirmation of the Steps 7+8 unit.
- [ ] unaddressed — Step 5 scope: the `validateToken` HS256 pin is on a hot path and is not named in product-spec.md. Confirm with the Steps 5+6 unit.
- [ ] Carried unchanged from the sdd-spec session: grant ↔ generator SAN drift has no CI guard (R-11); the post-deploy smoke needs positive evidence; the accepted risks (counter spike after a `JWT_SECRET` rotation, `ignoreExpiration`, stale agent snapshot under D-6, the unreachable 503 guard under D-7).

## Session 2026-11-21 — sdd-execute sequential (sdd-batch-execute)

- Up-front confirmation: the operator approved the plan with this record (binding, verbatim):
  ```json
  {"mainDev":"8baf3976c17f2f074f834d63ad9a1e8ffd8af22e","dev":"9f7093a46fbe76d007a514ef4f4cabc186336bcb","specHash":"91e2e4a4e824be4c08ee9120d0aa9eb92bd66642","directive":"conditional","pending":[1,2,3,4,5,6,7,8],"mismatches":[{"n":1,"detail":"No mismatch. All 3 Files paths exist. Every evidence anchor matched on HEAD 9f7093a4 (8baf3976 is already an ancestor, so the merge was 'Already up to date'): mtlsTestPki.ts:5,9,17 exports and the DNS:${name} SAN at :11; secretsAndScope.test.ts:76-96; mtls.ts:22,28,35; createInsecure at internalCallerSetConfig.test.ts:54,60 and setConfigSpelling.test.ts:120,125; poller cases at :81/:114 and :222/:256; startMtlsLoopback not found (to be created); .jscpd.json ignores __tests__. Note: the first-found `node` on PATH is v22.23.5 (/opt/node22) and the repo .nvmrc says 22. The pinned Node 24 (v24.22.3) is at /opt/node24/bin and must be put on PATH for the pnpm verifications."},{"n":2,"detail":"Line drift in authz.ts. SecretCallerCall is at :158 (spec :152). module-private peerDnsSans is at :164 (spec :158; F-B also cites :158). The SAN predicate is at :191 (spec :185). hasPeerDnsSan is at :234 (spec :228). Matches: InternalCallerGrant :76, ALLOWLIST :84, grant :86, hasInternalCallerAuthority :104-119, peerSan doc :132-133. Line drift in configServiceImpl.ts. hasInternalCallerAuthority( is at :686 with call.metadata at :687 (spec :681/:682). The statement is :684-691 (spec :679-686). The deny path is ~:692-716 with fields at :695-699 and the internal-caller ERROR branch ~:703-711 (spec :690-694, :697-706). callback(ADMIN_SCOPE_ERROR) is at :714 (spec :709). LOG_ID_MAX/truncateForLog are at :222-224 (spec :217-220). callerIdentity is at :729 (spec :724). author is at :734 (spec :729). The INSERT params array is at :844 (spec :839). Imports :14-15 match, and so does the single non-test caller. In services/xstockstrat-config/CLAUDE.md, invariant 7 starts at :41 (spec :44) and the GetSecret denial-log Observability line is at :105 (spec :122). setConfigDenialReason has no match (as expected). gen-dev-certs.sh :28/:50 and trading config.go:70 match."},{"n":3,"detail":"No mismatch. All 3 Files paths exist. Matches: the mdWith fake at internalCallerAuthz.test.ts:16-20 with calls at :25,37,49,61,68,79,84,96; secretCallerAuthz.test.ts:21-28 callWith, with the DNS: SAN consts at :30-31; configServiceImpl.test.ts ~:676-681 SAN fake; internalCallerSetConfig.test.ts:97-100 params and :152 admin case; setConfigAuthz.test.ts @AC-54 at :174 with the field set at :193-199, WARN test :202-212 and insecure loopback :126,132; fixtures/ holds only collectingReader.ts."},{"n":4,"detail":"Line drift. In docs/context-constitution.md the PLAT-9 row is at :33 (spec :47); its 'has **no** `peerSan`' text is present there. The watcher copy-group Pointers row is at :88 (spec/F-A :99). In services/xstockstrat-trading/docs/context-constitution-findings.md, '## Latent bugs' is at :19 with its header row at :21 (spec :16-18). In trading.go, configSetter.SetConfig(ctx, \"trading-reconciliation-poller\" is at :2365 (spec :2270), the WARN-on-error is at :2373-2375 (spec :2278-2280) and the CRITICAL alert title is at :2380 (spec :2285); escalateSystemic is at :2359. Matches: the three .feature anchors (audit-author-spoof :25-27, keys-contract :36-38 with retirement header :5-8, keys-drift :88-90), with no @feature-319 present yet. The dedup grep still returns only docs/reports/2026-10-21-trading-untargeted-per-account-alerts-defect.md. context.md has the 2026-11-20 option-A C-16 sign-off (:427-429). All 5 Files paths exist."},{"n":5,"detail":"Line drift in telemetry.ts. The BoundCounter declarations are at ~:390-405 (spec :340-354): refreshRejections is at :399 (spec :349). The record* exports start at :410 (spec :360-380): recordRefreshRejection is at :422 (spec :372). In services/xstockstrat-identity/CLAUDE.md, the Instruments line is at :71 (spec :92) and 'No token, email or hash is ever logged' is at :72 (spec :93); :4 still has 'defects (⚠ unsigned-token revoke)'. Matches: identityServiceImpl.ts validateFailureReason :24-29, import block :11-17, jwtSecret getter :130, verify :218, revokeToken :279-298 with decode at :284, comment :283, sign :320; jsonwebtoken ^9.0.2 at package.json:34; findings rows :58/:60. All 4 Files paths exist."},{"n":6,"detail":"No mismatch. revokeToken.test.ts is absent, as expected for a create; telemetryAllowlist.test.ts exists, with MIN_INSTRUMENTS at :31 and drive() at :41-49. Patterns match: identityServiceImpl.test.ts revokeToken describe ~:263 and makePool :47; identityTelemetry.test.ts install/getInt stub :10-13, captureStdout ~:22, expired token :42-45; collectingReader.ts exports install :14, points :28, values :36, counterValue :43; package.json:12 runs node --test per file. Same Node-on-PATH note as Step 1: use /opt/node24."},{"n":7,"detail":"BLOCKING verification mismatch: scripts/check-watcher-copies.sh does NOT exist. It was ported to scripts/check-watcher-copies.py, which CI runs as `python3 scripts/check-watcher-copies.py` (ci.yml:1319) and which lists the four watch_core.py copies at :20-23 (spec cites the .sh at :17-20). The Verification line `bash scripts/check-watcher-copies.sh`, the F-A finding and the Dependencies note all cite the dead path; use the .py. The watch_core.py md5 is now 13dc1f2497c20f17b34b349d9c8ee4cb for all four copies (spec says 17d555e01c1cdbfeb4aa57fb2590033e). They are still byte-identical, but the content changed since spec time, so re-read before editing. In docs/context-constitution.md the copy-group rule is at :88 (spec :99). In services/xstockstrat-agent/CLAUDE.md the oauth.registration_enabled row '(disabled ⇒ 403)' is at :122 (spec :208). In agent docs/context-constitution-findings.md the dcr-fail-closed row is at :94 (spec :91). Matches: WatchCore :55, _snapshot set :99, wait_for_snapshot :153, _lookup :189/:194, no has_snapshot yet; watcher.py :13,16,19,64,68,93-97; oauth_server.py :28,76,79-83,85,87-93,96-101,105-107,138; feature @AC-4 :37-43; oauth.md :21 with no fail-open text. All 9 Files paths exist."},{"n":8,"detail":"Line drift in tests/conftest.py. The autouse config_snapshots fixture is at :145-163 (spec :112-130): ConfigWatcher.__new__ is at :158 and setitem(_WATCHERS) at :163. hung_config_server is at :167 (spec :134). In app/main.py, start_watchers runs at :228 inside lifespan (:224), and also at :98 on the stdio path (spec :92). In tests/test_tools.py, the install_watcher import is at :30 (spec :24) and the read_config_value patch is at :451 (spec :445). Matches: test_oauth.py :139/:150 (201), :154, :160-165 with the _snapshot line :162, :168 test_register_survives_config_read_failure with 201 at :181; test_config_watcher.py install_watcher :46. The file path tests/test_oauth.py exists."}]}
  ```
- Stale check passed (`origin/main-dev` = `8baf3976`, dev = `9f7093a4`); `8baf3976` is already an ancestor, so no merge.
- Tooling setup (steps 1-8): node ✓ v24.22.3 (`/opt/node24/bin`, must lead PATH; first-found `node` is v22) · pnpm ✓ 9.15.9 · uv ✓ · ruff ✓ · python ✓ 3.13 · hook check hook=0.
- Re-spec (directive conditional): steps 2, 4, 5, 7 and 8 had their step-body line anchors refreshed; Step 7 Verification
  now runs `python3 scripts/check-watcher-copies.py` (the `.sh` was ported) and records md5 `13dc1f2497c20f17b34b349d9c8ee4cb`.
  Steps 1, 3 and 6 reported no mismatch and are unchanged. Outside step bodies (not edited): finding F-A and the Step
  Dependencies merge-order note still cite `scripts/check-watcher-copies.sh`; read them as the `.py`.
- respec(fix-auth-trust-hardening) commits on the branch (`git log --first-parent origin/main-dev..HEAD`):
  - `1605aede` respec(fix-auth-trust-hardening): align steps 1,2,3,4,5,6,7,8 with current codebase
  - `5cc9269e` respec(fix-auth-trust-hardening): align steps 1,2,3,4,5,6,7,8 with current codebase — feature.md
  - `941f1671` respec(fix-auth-trust-hardening): align steps 1,2,3,4,5,6,7,8 with current codebase — status.md
- Status: `implementation-ready` → `in-progress`.

```sdd-batch-setup
{"mainDev":"8baf3976c17f2f074f834d63ad9a1e8ffd8af22e","date":"2026-11-21"}
```

### Step 1 — test: move the internal-caller wire suites onto an mTLS loopback (harness only) [done]
- Added `startMtlsLoopback(server, clientNames)` to `mtlsTestPki.ts` (the `secretsAndScope.test.ts` CA → leaves → mTLS bind → per-leaf client credentials sequence). `internalCallerSetConfig.test.ts` now runs on the `xstockstrat-trading` leaf with a second `notifyClient` (`xstockstrat-notify` leaf, unused until Step 3), and `setConfig` takes an optional client. `setConfigSpelling.test.ts` runs on the `xstockstrat-trading` leaf. No assertion changed and no production file changed.
- TDD: red N/A — no behaviour change (harness only, per the step's TDD line). Baseline before the edit: `ℹ tests 394` / `ℹ pass 394`. Green after: `ℹ tests 394` / `ℹ pass 394` / `ℹ fail 0`, `All files | 92.26` lines (c8 `--lines 40` and `check-coverage --lines 40` pass), exit=0; same test count as before. No `createInsecure` is left in the two files, and `git diff --stat -- src/grpc` is empty.
- Verification ran with `/opt/node24/bin` leading PATH (tooling-setup note above). Lint: 0 errors; warnings 310 → 312, from the two new `any` annotations (`notifyClient`, the `setConfig` client parameter), which follow the file's existing `let client: any` pattern.
- Config-key wiring gate: not applicable (test step; no config key).
- Spec anchor drift, no effect: the poller-success cases are at `internalCallerSetConfig.test.ts:81` and `:114` (spec `:84`, `:115`).
- Files modified: `services/xstockstrat-config/src/__tests__/mtlsTestPki.ts`, `services/xstockstrat-config/src/__tests__/internalCallerSetConfig.test.ts`, `services/xstockstrat-config/src/__tests__/setConfigSpelling.test.ts`
- Deviations: none

### Step 2 — service: bind the poller grant to the mTLS peer SAN; attribute only authorized callers [done]
- Atomic unit Steps 2+3+4 (one commit). `InternalCallerGrant` gains `peerSan`; the `trading-reconciliation-poller` grant sets `peerSan: 'xstockstrat-trading'` (constraint comment ties it to `gen-dev-certs.sh` `DNS:${svc}`). `hasInternalCallerAuthority(call: PeerCall, …)` reuses the `GetSecret` SAN predicate; `peerDnsSans` is exported (no second parser, no `setConfigDenialReason`). `setConfig` passes `call`, persists `caller_identity` only when `internalCallerAuthorized`, and the internal-caller ERROR deny log adds `hadPeerSan` and a truncated `peerSan`. Config `CLAUDE.md` invariant 7 and Observability updated.
- TDD: red/green captured with Step 3 (below). Green (Step 2 Verification, `.sdd-logs/v-3.log`): `ℹ tests 400` / `ℹ pass 400` / `ℹ fail 0`, `All files | 92.31` lines, lint `0 errors, 313 warnings` (+1: the inline `captureLogs` `info: any`, same as `setConfigAuthz.test.ts`); greps found `peerSan: 'xstockstrat-trading'` (authz.ts:95), `hasInternalCallerAuthority(` → `call,` (configServiceImpl.ts:687-688), the gated `callerIdentity` (:735); `setConfigDenialReason` no match. The block's `exit=1` comes from that final expect-no-match grep.
- Config-key wiring gate: not applicable (no config key).
- Files modified: `services/xstockstrat-config/src/grpc/authz.ts`, `services/xstockstrat-config/src/grpc/configServiceImpl.ts`, `services/xstockstrat-config/CLAUDE.md`
- Deviations: none

### Step 3 — test: 319 @AC-1, the forged-attribution case and the unit flip [done]
- Atomic unit Steps 2+3+4. `internalCallerAuthz.test.ts` uses a `callWith(callerID, subjectaltname?)` fake with `TRADING_SAN`, plus four new cases (notify SAN denied, no `getAuthContext`, no SAN, SAN inside a comma list). `internalCallerSetConfig.test.ts` adds `@AC-1 (319)` (notify leaf denied, `queries.length === 0`, ERROR log with `hadPeerSan: true`/`peerSan: 'xstockstrat-notify'` and a pinned field set; the trading leaf then succeeds with params `[6]`/`[10]` = poller) and the forged-attribution case (admin + forged header via the notify leaf → `[6] === 'admin-7'`, `[10] === null`). `setConfigAuthz.test.ts` `@AC-54` field set gains `hadPeerSan`/`peerSan` (`false`/`''` on the insecure loopback); the WARN test asserts both `undefined`. Log capture is an inline copy of `setConfigAuthz.test.ts`'s `captureLogs` (single consumer, C-13; no fixture module).
- AC-1 red (Step 1 tree + wire/authz test edits, `.sdd-logs/v-1.log`): `ℹ tests 396` / `ℹ fail 3` — `@AC-1 (319)` `undefined !== 7` (notify-leaf poller call authorized), forged attribution `+ 'trading-reconciliation-poller' - null`, `@AC-54` `+ undefined - false`. Second red after the unit-file edit (`.sdd-logs/v-2.log`): `internalCallerAuthz.test.ts(31,9): error TS2345 … not assignable to parameter of type 'Metadata'`. → green (`.sdd-logs/v-4.log`, Step 3 Verification): `ℹ tests 400` / `ℹ pass 400` / `ℹ fail 0`, `All files | 92.31`, no ELIFECYCLE (so `c8 check-coverage --lines 40` passed); the `AC-1 (319)`/`xstockstrat-notify` grep matched both files; the `__tests__/fixtures` grep found nothing (its `exit=1`).
- Files modified: `services/xstockstrat-config/src/__tests__/internalCallerAuthz.test.ts`, `services/xstockstrat-config/src/__tests__/internalCallerSetConfig.test.ts`, `services/xstockstrat-config/src/__tests__/setConfigAuthz.test.ts`
- Deviations: none

### Step 4 — docs: C-16 durable-scenario amendments, PLAT-9 contract, trading finding [done]
- Atomic unit Steps 2+3+4. TDD: N/A (docs and Gherkin). The three config scenarios (`@AC-2`/241, `@AC-5`/296, `@AC-25`/295) gained `@feature-319` and the operator-signed Given suffix `from an mTLS peer with DNS SAN "xstockstrat-trading"`; no When/Then changed; the 306 retirement header untouched. PLAT-9 (`docs/context-constitution.md:33`) write direction now lists `peerSan`, records the grant ↔ `gen-dev-certs.sh` `DNS:${svc}` contract (no CI guard), and its `authz.ts` anchors were re-grepped (`InternalCallerGrant ~L76-84`, `INTERNAL_CALLER_ALLOWLIST ~L86`, `.some( ~L118`, `hasInternalCallerAuthority ~L110-126`). Trading findings `## Latent bugs` gained the `escalateSystemic` row (dedup grep re-run: only the unrelated 2026-10-21 alert-targeting report).
- Verification (`.sdd-logs/v-5.log`, `exit=0`): `@feature-319` count 1 per file; the SAN Given matched at `:27`, `:38`, `:90`; `has **no** peerSan` no match; the PLAT-9 line carries `gen-dev-certs.sh`; `escalateSystemic` at findings `:30`; `git diff --stat -- services/xstockstrat-trading/internal` empty.
- Steps 2-3 Verification ran with `/opt/node24/bin` leading PATH, as in Step 1. The unit's union of Verifications ran as three runs, one per member block, each unchanged.
- Files modified: `services/xstockstrat-config/acceptance/fix-config-audit-author-spoof.feature`, `services/xstockstrat-config/acceptance/fix-config-keys-contract.feature`, `services/xstockstrat-config/acceptance/fix-config-keys-drift.feature`, `docs/context-constitution.md`, `services/xstockstrat-trading/docs/context-constitution-findings.md`
- Deviations: none
- Open items (outside this unit's Files): `docs/patterns/inter-service-mtls.md` "SAN-gated grants" list does not name config `SetConfig` ← `xstockstrat-trading`; the defect sidecar `docs/reports/2026-10-20-config-setconfig-internal-caller-no-peersan-defect.status` (`triaged`) is for integration/launch.

### Step 5 — service: RevokeToken verifies the signature; HS256 pinned; unverifiable counter [done]
- Atomic unit Steps 5+6 (one commit). `revokeToken` reads `this.jwtSecret` first (unset → outer catch, `code: 13`, no count), then `jwt.verify(token, secret, { ignoreExpiration: true, algorithms: ['HS256'] })` in an inner `try`; a verify failure calls `recordRevokeUnverifiable()`, logs the fixed WARN `RevokeToken: unverifiable token ignored` with only `errorName` (the verify error class), and returns `{ success: true }` with no UPDATE (D-4, D-10). `validateToken` passes `{ algorithms: ['HS256'] }`. `telemetry.ts` adds the label-free `identity.revoke.unverifiable` counter and `recordRevokeUnverifiable()`. Identity `CLAUDE.md` Instruments line names the counter with the rotation caveat; the `:4` pointer drops `(⚠ unsigned-token revoke)`; the findings row for `2026-10-19-identity-revoketoken-unverified-decode-defect` is marked resolved.
- O-3 / the `validateToken` HS256 pin: implemented as specced under the 2026-11-21 operator up-front confirmation of the plan (pending steps 1-8); no separate operator answer was given for O-3.
- TDD: red/green captured with Step 6 (below). Green (Step 5 Verification, `.sdd-logs/v-3.log`): `ℹ tests 169` / `ℹ pass 169` / `ℹ fail 0`, `All files | 85.5` lines, no ELIFECYCLE (so `c8 check-coverage --lines 40` passed), lint `0 errors, 271 warnings` (+1 vs the pre-impl 270: the `any` on the inner `verifyErr`/`decoded`, the file's existing untyped style); `decode(token)` no match; `algorithms: ['HS256']` at `identityServiceImpl.ts:219` and `:288`; the counter at `telemetry.ts:402`/`:430` and the impl at `:15`/`:290`. The block's `exit=1` comes from the final expect-no-match `unsigned-token revoke` grep.
- Config-key wiring gate: not applicable (no config key).
- Files modified: `services/xstockstrat-identity/src/grpc/identityServiceImpl.ts`, `services/xstockstrat-identity/src/telemetry.ts`, `services/xstockstrat-identity/CLAUDE.md`, `services/xstockstrat-identity/docs/context-constitution-findings.md`
- Deviations: none

### Step 6 — test: 319 @AC-2 and the counter allowlist [done]
- Atomic unit Steps 5+6. New `revokeToken.test.ts` (recording pool + `collectingReader` `values` delta on the label-free counter): `@AC-2 (319)` unsigned `alg:none` token for `victim-1` → `{ success: true }`, zero queries, counter +1; `@AC-2 (319)` expired HS256-signed → exactly the `UPDATE identity.refresh_tokens …` with `['victim-1']`, counter +0; other-secret, HS384 (also `validateToken` → code 16) and garbage → ignored, zero queries, +1; `JWT_SECRET` unset → `code: 13`, zero queries, +0 (env restored in `finally`); the WARN contains the fixed message and neither the token nor `victim-1`; empty token → success, zero queries, +0. `telemetryAllowlist.test.ts` adds `identity.revoke.unverifiable` to `MIN_INSTRUMENTS` and `recordRevokeUnverifiable()` to `drive()`. Literals inline (C-13, single consumer); only `collectingReader` imported.
- AC-2 red (pre-Step-5 tree + `revokeToken.test.ts`, `.sdd-logs/v-1.log`): `ℹ tests 169` / `ℹ fail 6` — unsigned, other-secret and HS384 `an unverifiable token must not revoke anything` (`actual: 1, expected: 0`), garbage counter `actual: 0, expected: 1`, missing secret `actual: undefined, expected: 13`, WARN absent (stdout had only `Tokens revoked … victim-1`). Second red after the allowlist edit (`.sdd-logs/v-2.log`): `telemetryAllowlist.test.ts(47,13): error TS2339: Property 'recordRevokeUnverifiable' does not exist`. → green (`.sdd-logs/v-4.log`, Step 6 Verification, `exit=0`): `ℹ tests 169` / `ℹ pass 169` / `ℹ fail 0`, `All files | 85.5`, no ELIFECYCLE; all eight new cases and both `AC-41` allowlist tests passed; preserved 265 `@AC-2`/`@AC-4` and the `validateToken` suites passed; `AC-2 (319)` grep at `:78`/`:82`; allowlist grep at `:36`/`:47`; the fixtures grep shows only `./fixtures/collectingReader`.
- Steps 5-6 Verification ran with `/opt/node24/bin` leading PATH, as in Step 1. The unit's union of Verifications ran as two runs, one per member block, each unchanged.
- Files modified: `services/xstockstrat-identity/src/__tests__/revokeToken.test.ts`, `services/xstockstrat-identity/src/__tests__/telemetryAllowlist.test.ts`
- Deviations: none

## Session 2026-11-26 — sdd-execute sequential (sdd-batch-execute), Steps 7+8

- Tooling setup (steps 7-8): python ✓ 3.13.18 · uv ✓ 0.11.32 (`uv sync --extra dev` in agent, indicators, ingest, analysis) · ruff ✓ 0.16.9 · node ✓ (only for `check-config-wiring.mjs`) · hook check hook=0.
- Discovery re-verified at `origin/feature/fix-auth-trust-hardening@f82506d5`: the four `watch_core.py` copies had md5 `13dc1f2497c20f17b34b349d9c8ee4cb` before the edit and `88c92764df6cd31c51214f18ef8247f8` after it. The other Step 7 and Step 8 anchors match the re-spec'd lines.

### Step 7 — service: agent DCR fails closed when no policy snapshot is readable [done]
- Atomic unit Steps 7+8 (one commit). `WatchCore.has_snapshot()` was added after `wait_for_snapshot`, identically in all four copies. `watcher.has_snapshot(namespace)` returns False when no watcher is registered. `register` returns 503 `{"error": "server_error"}` with one WARN when `has_config_snapshot("agent")` is false; the check runs after the JSON parse and before the `registration_enabled` read. Both read `except` branches also return 503 now; neither defaults any more. The 2-line D-7 constraint comment replaces the "Best-effort" comment. A readable unset key still uses the defaults, a readable `false` still returns 403, and the identity-failure 500 is unchanged. No metric label was added.
- Docs: in agent `CLAUDE.md:122`, the row now reads "(disabled ⇒ 403; policy snapshot absent ⇒ 503)". The findings row `2026-10-29-agent-dcr-fail-closed-defect` is marked resolved (feature 319). 247 `@AC-4` was amended in place: it gains `@feature-319`, its Given is now no readable `agent` snapshot, its Then is HTTP 503 (the no-hang bound is kept), and its last line is now "no client_id is issued". The title and lines `:40-41` are unchanged.
- TDD: red/green captured with Step 8 (below). Green, Step 7 Verification (`.sdd-logs/v-2.log`, `exit=0`):
  - `check-watcher-copies: all groups byte-identical`
  - agent: `All checks passed!` / `79 files already formatted` / `829 passed`, with `Total coverage: 88.47%`
  - indicators, ingest and analysis `test_config_watcher.py`: `30 passed` / `33 passed` / `14 passed`
  - `def has_snapshot` at `watch_core.py:162` and `watcher.py:68`
  - `defaulting to`: no match
  - The R-3 `_snapshot` grep matches `:28` and `:88`. Both lines are the mandated `has_config_snapshot` name, not attribute access. See the Deviation Log.
- Config-key wiring gate: step-time is not applicable (no key declared). Feature-final `node scripts/check-config-wiring.mjs --final` (`.sdd-logs/v-4.log`) gave `exit=0`. It REPORTED two unrelated findings, both `readers-disagree`: `fundsignal_loop.py:marketdata/fundamentals.provider` and `trading.go:platform/trading_state`. Neither is a blocking finding.
- Files modified: `services/xstockstrat-{agent,indicators,ingest,analysis}/app/config/watch_core.py`, `services/xstockstrat-agent/app/config/watcher.py`, `services/xstockstrat-agent/app/oauth_server.py`, `services/xstockstrat-agent/CLAUDE.md`, `services/xstockstrat-agent/docs/context-constitution-findings.md`, `services/xstockstrat-agent/acceptance/fix-agent-getconfig-deadline.feature`
- Deviations: the R-3 grep expectation cannot be met with the mandated import name (Deviation Log).

### Step 8 — test: 319 @AC-3, the inverted fail-open test and the readable-false 403 [done]
- Atomic unit Steps 7+8. `test_register_survives_config_read_failure` became `test_register_fails_closed_on_config_read_failure`, which expects 503, `server_error`, no `client_id` and `register_oauth_client` not awaited. New tests:
  - `@AC-3 (319)` `test_register_refused_without_policy_snapshot`: the `agent` watcher is deleted inside the `TestClient` block, then a POST with `attacker.example`.
  - `test_register_refused_when_watcher_has_no_snapshot`: a bare `__new__` watcher.
  - `test_register_readable_false_returns_403`.
  - `test_register_snapshot_check_precedes_redirect_validation`: an empty `redirect_uris` gets 503, and invalid JSON gets 400 `invalid_request`.
  - The shared assertions use an inline `_assert_refused_503` helper. There is no fixture, and the literals are inline (C-13). `test_register_returns_client_id` and `test_register_disabled_returns_403` are unchanged.
- AC-3 red (pre-Step-7 tree with the new tests, `.sdd-logs/v-1.log`): `4 failed, 825 passed`.
  - The two no-snapshot tests and the inverted test failed with `assert 201 == 503`.
  - The ordering test failed with `assert 400 == 503`.
  - The readable-false 403 test passed, as expected. Red was correct.
- Green (Step 8 Verification, `.sdd-logs/v-3.log`, `exit=0`):
  - `All checks passed!` / `79 files already formatted` / `829 passed`, with `Total coverage: 88.47%`.
  - `-k register`: `8 passed, 18 deselected`.
  - The `survives` grep: no match. `AC-3 (319)` is at `:190` and `attacker.example` at `:197`.
  - The `_snapshot\b` grep matches the existing `:164` attribute line, the `:163` comment and two mandated test names (Deviation Log).
  - The fixture/conftest grep matches only the existing `:163` comment.
  - Preserved in the same run: 247 `@AC-1/@AC-5` and the agent `@AC-47` suites (all in the 829).
- Files modified: `services/xstockstrat-agent/tests/test_oauth.py`
- Deviations: `install_watcher` is called inside the `TestClient` block, because its watcher has no `_snapshot_event` and the lifespan would wait on it (Deviation Log).

## Open Threads

- [ ] unaddressed — `/oauth/register` vs 345-authelia-sso (carried from the impl-spec review): the status under SSO (404 per 345 `@AC-43`) and which feature merges first still need an operator decision. The legacy route now returns 503 with no snapshot. Target: the integration PR / merge-order.
- [ ] unaddressed — merge-order row for 319 (outside this feature's Files); re-run `python3 scripts/check-watcher-copies.py` after merging `origin/main-dev` at the integration PR.
- [ ] C-16 launch promotion: 319 `@AC-3` → agent suite; defect sidecar `docs/reports/2026-10-29-agent-dcr-fail-closed-defect.status` is for integration/launch.

## Session 2026-11-26 — sdd-batch-execute promotion plan (awaiting operator confirm)

```sdd-batch-promotion-plan
## Promotion plan - fix-auth-trust-hardening (feature 319)

Source: docs/roadmap/features/319-fix-auth-trust-hardening/acceptance.feature. I read the working-tree copy, not `git show origin/feature/fix-auth-trust-hardening:...`, because this session has no Bash tool. It has 3 scenarios, @AC-1..@AC-3. Before writing, the orchestrator should confirm that the origin copy has no extra scenarios and that the three below match it verbatim. Affected services come from the Reviewers table and implementation-spec.md line 102: config, identity, agent.

### Verdicts
| @AC | target suite (path) | CREATE/APPEND | verdict | note |
|---|---|---|---|---|
| @AC-1 | /home/user/xstockstrat/services/xstockstrat-config/acceptance/fix-auth-trust-hardening.feature | CREATE | NEW | The observable subject is config SetConfig authz, so it goes to config. Closest existing scenarios are config 241 @AC-2 (positive poller write) and 254 @AC-3 (GetSecret SAN denial). Neither asserts the SetConfig denial from a non-trading SAN. |
| @AC-2 | /home/user/xstockstrat/services/xstockstrat-identity/acceptance/fix-auth-trust-hardening.feature | CREATE | NEW | The observable subject is identity RevokeToken and refresh_tokens. No existing identity scenario covers RevokeToken or `identity.revoke.unverifiable`. |
| @AC-3 | /home/user/xstockstrat/services/xstockstrat-agent/acceptance/fix-auth-trust-hardening.feature | CREATE | NEW (gated, see Notes 1) | The observable subject is the agent POST /oauth/register. It supersedes agent 247 @AC-4, which still reads "201" in the working tree. |

No `fix-auth-trust-hardening.feature` exists in any of the three services, and `@feature-319` appears only in the feature's own docs. No platform.feature scenario is planned, because each guarantee has a single service owner.

### Ready-to-write blocks

--- /home/user/xstockstrat/services/xstockstrat-config/acceptance/fix-auth-trust-hardening.feature (CREATE) ---
# Promoted from docs/roadmap/features/319-fix-auth-trust-hardening/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-319` tag.
# Durable business rules xstockstrat-config already guarantees - a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring.

Feature: xstockstrat-config - an internal-caller SetConfig grant is bound to the mTLS peer SAN
  Internal-caller config writes are authorized only from the mTLS peer the grant names, not from the x-internal-caller header alone.

  # guards: docs/reports/2026-10-20-config-setconfig-internal-caller-no-peersan-defect.md
  @AC-1 @regression @feature-319
  Scenario: an internal-caller SetConfig from a peer without the trading SAN is denied
    Given an mTLS client whose platform-CA leaf DNS SAN is "xstockstrat-notify"
    When it calls SetConfig namespace "platform" key "trading_state" value "HALTED" with metadata x-internal-caller "trading-reconciliation-poller" and no admin x-access-scope
    Then the call fails with PERMISSION_DENIED
    And no config.config_audit row is written with changed_by "trading-reconciliation-poller"
    And the same call from a peer with DNS SAN "xstockstrat-trading" is authorized

--- /home/user/xstockstrat/services/xstockstrat-identity/acceptance/fix-auth-trust-hardening.feature (CREATE) ---
# Promoted from docs/roadmap/features/319-fix-auth-trust-hardening/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-319` tag.
# Durable business rules xstockstrat-identity already guarantees - a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring.

Feature: xstockstrat-identity - RevokeToken acts only on a genuinely signed token
  Token revocation verifies the JWT signature; an unsigned token revokes nothing.

  # guards: docs/reports/2026-10-19-identity-revoketoken-unverified-decode-defect.md
  @AC-2 @regression @feature-319
  Scenario: RevokeToken with an unsigned token revokes nothing
    Given user "victim-1" has two active identity.refresh_tokens rows
    When IdentityService.RevokeToken is called with an unsigned JWT whose payload is {"user_id":"victim-1"}
    Then both refresh_tokens rows for "victim-1" still have revoked_at NULL
    And RevokeToken with an expired but correctly signed token for "victim-1" sets revoked_at on both rows
    And the "identity.revoke.unverifiable" counter increases by 1 for the unsigned call and by 0 for the expired-signed call

--- /home/user/xstockstrat/services/xstockstrat-agent/acceptance/fix-auth-trust-hardening.feature (CREATE) ---
# Promoted from docs/roadmap/features/319-fix-auth-trust-hardening/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-319` tag.
# Durable business rules xstockstrat-agent already guarantees - a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring.

Feature: xstockstrat-agent - OAuth dynamic client registration fails closed
  /oauth/register does not widen registration while the registration policy cannot be read.
  Operator-signed (context.md, 2026-11-10): supersedes 247 @AC-4 (201 on a config stall).

  # guards: docs/reports/2026-10-29-agent-dcr-fail-closed-defect.md
  @AC-3 @regression @feature-319
  Scenario: DCR is refused while the registration policy cannot be read
    Given agent.oauth.registration_enabled is "false"
    And the agent's read of the registration policy fails (no config snapshot for namespace "agent")
    When POST /oauth/register is sent with {"redirect_uris": ["https://attacker.example/cb"]}
    Then the response status is 503
    And no client_id is issued

### Notes / ambiguities / conflicts
1. **Agent @AC-3 conflicts with an unamended promoted scenario (hard precondition).**
   - /home/user/xstockstrat/services/xstockstrat-agent/acceptance/fix-agent-getconfig-deadline.feature:37-43 (@AC-4 @feature-247) says that when config never answers, POST /oauth/register returns 201 with a client_id. That contradicts 319 @AC-3 (503, no client_id).
   - It is a known supersession, not a surprise. The operator signed off fail-closed DCR (context.md line 37, "Session 2026-11-10"). Design decision D-8 and implementation-spec Step 8 amend 247 @AC-4 in place to 503 and add `@feature-319` to its tag line.
   - The working tree here still shows 201, so that amendment is not on this tree.
   - Before writing the agent block, the orchestrator must confirm that amendment is on the launching branch: `grep -n "@feature-319\|HTTP 503" services/xstockstrat-agent/acceptance/fix-agent-getconfig-deadline.feature`.
   - If it is absent, treat @AC-3 as CONFLICT, do not write the agent block, and escalate. Do not edit 247 @AC-4 from this promotion.
   - Once amended, 247 @AC-4 and 319 @AC-3 assert the same 503 outcome. Record that as an OVERLAP consolidation candidate for a human. Nothing is deleted.
2. **Config amendments are not part of this plan.** Step 4 amends three existing config scenarios in place: 241 @AC-2, 296 @AC-5 and 295 @AC-25. Each gains `@feature-319` and `from an mTLS peer with DNS SAN "xstockstrat-trading"` in its Given. That is operator-signed (option A) and sits outside promotion.
   - 319 @AC-1's last `And` (authorized from the trading SAN) overlaps the amended 241 @AC-2 on the positive path only. The denial that makes @AC-1 new is not covered elsewhere, so the verdict stays NEW.
   - 241 @AC-2 and 296 @AC-5 are plain scenarios, not retired. 296 @AC-5 carries a retirement header at lines 5-8 of fix-config-keys-contract.feature, which this plan does not touch.
3. **Target file choice for identity @AC-2.** implementation-spec.md line 102 suggests extending the sibling instruments of identity @AC-52 in `signal-map-instrumentation.feature`. That file's header says "Verbatim; do not edit by hand". This plan therefore creates a slug-named file, `fix-auth-trust-hardening.feature`, per policy and additive-only. The orchestrator may append there instead only if the human owner prefers.
4. **Tags.** The source scenarios carry only `@AC-n @regression` and no `@FR-*`. Context.md notes the bug template omits FR tags. I did not invent FR tags, so promoted tag lines are `@AC-n @regression @feature-319`. @AC numbers are unchanged.
5. **Dropped lines.** I dropped the source comment "Pending Open Question 1 (operator security-posture decision); written for fail-closed." because the operator resolved it (context.md line 37). I replaced it with the sign-off line in the agent Feature description. The `# guards:` comments are kept. The step text is verbatim.
6. **Cross-cutting.** I checked /home/user/xstockstrat/docs/sdd/business-rules/platform.feature for x-internal-caller, RevokeToken, registration_enabled and oauth/register. It has no matching scenario, so there is no overlap and no cross-cutting target is needed.
7. **Lazy directories.** `acceptance/` already exists in config, identity and agent, so no directory creation is needed.

### Coverage check
- Source scenarios: 3 (@AC-1, @AC-2, @AC-3).
- Planned: 3 NEW (@AC-3 gated on the 247 @AC-4 amendment), 0 DUP, 0 OVERLAP, 0 CONFLICT.
- Every @AC is accounted for and none was skipped. Counts match.
```
