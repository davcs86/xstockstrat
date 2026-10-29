# Context Log: fix-marketdata-secret-exposure

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-21 (/sdd-triage)

- Bug recorded as defect report `docs/reports/2026-10-21-marketdata-secret-exposure-defect.md` (Issues disabled).
- Source: repo-surveyor debt-radar scan `docs/repo-surveyor/debt-radar-findings.md` @ 4535695, findings **D-39**, **D-40**.
  Both re-verified on main-dev @ a053b0e and both reproduce. None excluded.
- Severity: SEV-2. Impact type: secret-disclosure. Environment: dev (main-dev) @ a053b0e. Config-only: no.
- Operator decisions (2026-10-21): grouped by service+theme from the debt-radar scan; Track C for all SEV-2 (precedent #1264); batch launched via /sdd-batch with designGate halt.
- Routed to SDD path (Track C).
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..4), context.md; report sidecar `.status` (`triaged`).
- Affected services: xstockstrat-marketdata (D-39), xstockstrat-config (D-40).
- Root cause hypothesis:
  - D-39: the `%w` wrap of the `*url.Error` on the transport path. Redaction exists only on the status branch.
  - D-40: feature 224 deliberately left the marketdata grant without `peerSan`
    (`224-private-by-default-templates/implementation-spec.md:1615`, `context.md:741`).
- Line drift (scan @ 4535695 → a053b0e): none. `fmp_client.go:243`, `finnhub_client.go:118`, `:110`, `:126`,
  `fmp_client.go:254`, `marketdata_service.go:1704`, `authz.ts:110`, `:115-119` all match. Additional sites:
  - the FMP key is set at `fmp_client.go:222`;
  - a second `CodeUnavailable` `%w` wrap is at `marketdata_service.go:1760`;
  - the gap is pinned by test `services/xstockstrat-config/src/__tests__/perUserSecrets.test.ts:236` ("no SAN required"). The fix must flip it.
- Feasibility of the D-40 binding: `scripts/gen-dev-certs.sh:28`, `:50` mint the marketdata leaf with
  `DNS:xstockstrat-marketdata`, and marketdata dials config over mTLS (`internal/config/config.go:70`). Design should
  confirm that the prod leaves from `scripts/mtls-provision.sh` carry the same SAN. A mismatch would stop marketdata
  resolving credentials at boot (warn-and-start, `config.go:111-112`).
- Overlaps:
  - **241-fix-config-audit-author-spoof** (implementation-ready) edits `services/xstockstrat-config/src/grpc/authz.ts`
    (SetConfig/author paths). It scopes the SetConfig-grant `peerSan` gap out as a follow-up defect
    (`241/design.md:20`, `:167`). This feature fixes the analogous GetSecret gap. Same file, so rebase onto whichever
    lands first. Design may also choose to absorb the SetConfig follow-up.
  - **242-fix-push-untargeted-broadcast** copies `peerDnsSans` from `authz.ts` into identity. No conflict expected.
  - **263-fix-edge-owner-scope** (same 2026-10-21 batch) also names config `authz.ts` as a textual merge risk.
    Check merge-order.
  - **246-fix-fundsignal-neutral-score** cites `fmp_client.go`/`finnhub_client.go` read-only (analysis-only fix). No conflict.
- Recommended design depth: full → `/sdd-design fix-marketdata-secret-exposure` (rationale: 2 affected services,
  which is the C-0 full trigger, plus a security-sensitive authz change that needs a cert-SAN deploy check).
- Development branch: feature/fix-marketdata-secret-exposure

## Session 2026-10-21 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready. Criteria verdict PASS WITH WARNINGS (no fails, no floor breaches); overlap WARN (no FAIL).
- OPERATOR DECISIONS (binding, recorded 2026-10-21):
  - Grouped by service+theme from the 2026-10-20 debt-radar scan; Track C (precedent #1264).
  - Scope is D-39 and D-40 only.
- Warnings, and how each was handled:
  1. C-15: AC-1/AC-2 did not pin the request path. **Resolved.** AC-1 now pins `/stable/quote` (first FMP call in
     `GetFundamentalsMulti`, `fmp_client.go:267`). AC-2 pins `/stock/metric` and now calls Finnhub `GetFundamentals`,
     because Finnhub `GetFundamentalsMulti` skips per-symbol errors (`finnhub_client.go:64-69`) and would return no
     error at all. FR-1/FR-2 updated to match.
  2. AC-5 failure inducement and the two call sites. **Resolved.** AC-5 now uses base URL `http://127.0.0.1:1` and an
     empty cache and covers `marketdata_service.go:1760` (single RPC). New AC-7 covers `:1704` (batch RPC).
  3. FR-3 depends on the client fix. **Resolved.** FR-3 now says redaction happens at the client and the service
     layer's `%w` wrap needs no change.
  4. C-3 paper/live. **Resolved.** Product spec now notes the SAN binding behaves identically in staging (paper) and
     production (live).
  5. D-40 deploy risk. **Resolved.** Fix Scope now has a dev smoke-test and rollback note (revert the `authz.ts`
     grant alone; the D-39 fix is independent).
- Overlap findings (all WARN, textual merge risk only; no config-key, proto or migration collision):
  - `services/xstockstrat-config/src/grpc/authz.ts` vs 241-fix-config-audit-author-spoof (implementation-ready;
    edits `authz.ts:46-50`, `:82-97`) and vs 263-fix-edge-owner-scope (draft). Different hunks.
  - `services/xstockstrat-config/src/__tests__/perUserSecrets.test.ts` vs 241 (`:237-243`, adjacent to the `:236`
    assertion AC-6 flips). Adjacent-hunk conflict risk.
  - `internal/fmp/fmp_client.go`, `internal/finnhub/finnhub_client.go`, `internal/service/marketdata_service.go` vs
    255-fix-marketdata-fundamentals-cache (draft). Different hunks.
  - No merge-order row needed. Non-blocking coordination: whichever of 254/241 and 254/255 merges second rebases onto
    the other. Do not touch the ingest grant (`authz.ts:124`); 261 defers D-40 here.

## Session 2026-10-21 — sdd-batch design gate (round 2)

Full debate halted at the approval gate after round 2 (gate policy: halt). design.md is not written and status.md is
unchanged (spec-ready), per the grilling protocol. The resume state is in the `sdd-batch-design-state` block below.

## Open Threads

- **Approach (round 2, low-rework shape).** Two independent, surgical Track C fixes with tests that fail first (P-06).
  No proto change, migration, config key or DB-pool change.
  - Step 1, D-39 redaction: in the shared `getJSON` transport-error sites (`fmp_client.go:241-243`,
    `finnhub_client.go:116-118`), unwrap `*url.Error` and wrap only its inner cause; the else-branch carries no cause.
    `reserve()` and the refund defer stay untouched, so feature-217 @AC-4 is preserved. Real-dial tests use
    `http://127.0.0.1:1` with the key `k-secret`. A ctx-timeout case per client proves `errors.Is(DeadlineExceeded)`.
  - Step 2: service-edge tests only (AC-5, AC-7) against a real `*fmp.Client`.
  - Step 3, D-40: add `peerSan: 'xstockstrat-marketdata'` to the marketdata GetSecret grant (`authz.ts:115-119`);
    enforcement already exists at `:149-162`. A shared `mtlsTestPki.ts` helper holds only sh/mintLeaf/setEnv, and the
    existing test files change only by import. The GetSecret describe of `secretsAndScope.test.ts` moves to an mTLS
    wire harness. Commit order: harness green under the header-only grant, then red wire AC-3 (evidence recorded),
    then the grant. The unit deny matrix lives only in `perUserSecrets.test.ts`, and AC-6 is tested at the unit layer
    only.
  - Step 4: docs, and a residuals defect report covering the build-request `%w` sites and the redirect Location residual.
  - Step 5: a mechanical dev smoke check. Grep a post-config-healthy marketdata boot for the substring
    `resolving vendor credential from config failed`; it passes with zero matches. Rollback is the `authz.ts` line alone.
- **Strongest open objection (BLOCKING, C-16/P-03).** Narrowing the promoted config @AC-4 (GetSecret allow-listed
  caller) from header-only to header plus SAN is a CHANGE, and no operator decision covers it. The user must sign off
  explicitly, and the sign-off must be recorded here before /sdd-spec. The promotion form is already settled: promote
  alongside @AC-4, never rewrite it.
- **Non-blocking gate question (P-03).** Should the `build request: %w` sites (`fmp_client.go:226`,
  `finnhub_client.go:114`) fold into Step 1, or stay in the defect report? The default is the report, per the binding
  D-39/D-40-only scope.
- **Floor status.** No Floor breaches.
- **@AC changes not covered by an operator decision.**
  - config:@AC-4 is a CHANGE and blocks the gate.
  - These are PRESERVE and need no sign-off: 254:@AC-4, config:@AC-5, config:@AC-16, 217:@AC-4.
  - The feature's own AC-1/2/3/5/6/7 are EXTEND and covered.

```sdd-batch-design-state
{
  "round": 2,
  "synth": {
    "approach": "Two independent, surgical Track C fixes, each in its own step with tests written to fail first (P-06). No proto change, migration, config key or DB-pool change. Round 2 keeps the round-1 shape and adopts the adversary's non-blocking refinements, which lowers rework.\n\nSTEP 1: D-39 client redaction (marketdata)\n- Sites: the two transport-error sites in the shared getJSON, services/xstockstrat-marketdata/internal/fmp/fmp_client.go:241-243 and internal/finnhub/finnhub_client.go:116-118.\n- Shape, stated in full including the else-branch:\n  `var ue *url.Error; if errors.As(err, &ue) { return fmt.Errorf(\"fmp: %s request failed: %w\", path, ue.Err) }; return fmt.Errorf(\"fmp: %s request failed\", path)`\n  - The fallback carries no cause, so a future non-*url.Error path cannot reintroduce the URL.\n  - Finnhub gets the same shape.\n- reserve() and the refund defer (fmp_client.go:231-240) stay untouched, so feature-217 @AC-4 holds.\n- getJSON is the single chokepoint. It covers classification refresh (classification_service.go:205) and the fetchProfile filler.\n- Tests (AC-1, AC-2) are real-dial: fmp.NewClient / finnhub.NewClient (fmp_client.go:60, finnhub_client.go:35) with BaseURL http://127.0.0.1:1 and APIKey k-secret, calling FMP GetFundamentalsMulti, FMP fetchProfile and Finnhub GetFundamentals. Each test asserts:\n  - the vendor and path are present;\n  - `k-secret`, `apikey=` and `token=` are absent;\n  - `errors.As(err, new(*url.Error))` is false.\n- One added ctx-timeout case per client (an httptest server that blocks, plus a short ctx deadline) asserts `errors.Is(err, context.DeadlineExceeded)`. This proves the inner cause is preserved rather than just claiming it.\n\nSTEP 2: D-39 service-edge tests (AC-5, AC-7; tests only)\n- A real *fmp.Client goes into newFundSvc(enabledCfg(\"fmp\"), newFakeFundRepo(), client, …) (marketdata_service_test.go:309/290/188).\n- Assert CodeUnavailable plus a key-free message on the single and batch RPCs, using the pattern at :2930.\n- The service wraps (marketdata_service.go:1704, :1760) stay unchanged.\n\nSTEP 3: D-40 SAN-bound grant (config). Commits within the step follow the order below.\n- (3a) Shared PKI helper:\n  - New file services/xstockstrat-config/src/__tests__/mtlsTestPki.ts exports only sh, mintLeaf and setEnv, moved verbatim from peerSanSpike.test.ts:17-33 and mtls.test.ts:21-23,35-41,57-60. Both are verified identical this round.\n  - No mintCa: mtls.test.ts mintPki (:43-55) mints two CAs inline with distinct CNs (test-ca, foreign-ca).\n  - peerSanSpike.test.ts and mtls.test.ts change only by deleting their local copies and adding an import. mintPki keeps its inline CA lines.\n  - tsconfig.json:14 (src/**/*) compiles the helper. package.json:12-13 only runs *.test.js, so the helper never runs as a test. c8 excludes __tests__/**.\n- (3b) Wire harness, GetSecret describe of secretsAndScope.test.ts only (:63-136):\n  - The test CA is minted inline with one sh('req','-x509',…) line, below the jscpd floor.\n  - Three leaves via mintLeaf: xstockstrat-config (server), xstockstrat-marketdata and xstockstrat-ingest.\n  - The server binds with mtls.serverCredentials() (mtls.ts:22) in place of createInsecure() at :75.\n  - Two ConfigServiceClients use mtls.clientCredentials() (mtls.ts:28) plus mtls.targetOverride('xstockstrat-config') (mtls.ts:35), with setEnv called before each one. The adversary verified that load() runs per call (mtls.ts:11-31) and that createSsl copies the buffers.\n  - Existing AC-4 (:88), AC-5 (:98, :108) and AC-16 (:117, :127) run on the wire via the marketdata client.\n  - Commit 1: the harness switch, shown green with the grant still header-only.\n  - Commit 2: add wire AC-3 (x-internal-caller: marketdata over the ingest leaf, expecting PERMISSION_DENIED) and record the red run as evidence (fails.md:2404-2406).\n  - The SetConfig encrypt describe (:139+) stays insecure.\n  - openssl is already used by the same pnpm test:coverage job (ci.yml:587, ubuntu-latest).\n- (3c) Grant, commit 3: add peerSan: 'xstockstrat-marketdata' to the marketdata entry at src/grpc/authz.ts:115-119. Enforcement already exists at authz.ts:149-162. The ingest grant (:124) and the SetConfig grant (:66-76, owned by feature 241) are untouched. Wire AC-3 turns green, and only it changes.\n- (3d) Unit layer, in the same commit:\n  - perUserSecrets.test.ts:236-248 is replaced:\n    - AC-4: DNS:xstockstrat-marketdata gives found=true.\n    - AC-3: DNS:xstockstrat-ingest gives deny.\n    - AC-6: `() => ({})` and undefined give deny, reusing the trio at :188-196.\n    - This is the single home of the unit deny matrix.\n  - secretCallerAuthz.test.ts:57-60 only changes to callWith('marketdata','DNS:xstockstrat-marketdata'), with no added deny cases.\n  - AC-6 lives at the unit layer only, because an mTLS server rejects a peer with no certificate before the handler runs.\n\nSTEP 4: Docs and tracking\n- Config CLAUDE.md invariant #6: the marketdata grant also requires DNS SAN xstockstrat-marketdata.\n- File docs/reports/<date>-marketdata-vendor-key-url-residuals-defect.md with a .status sidecar. It covers:\n  - (a) the `build request: %w` sites (fmp_client.go:226, finnhub_client.go:114);\n  - (b) the redirect residual, where Go's \"failed to parse Location header %q\" error can embed a vendor-sent Location URL.\n  - It names key-in-header (FMP apikey header, Finnhub X-Finnhub-Token) as the fix that closes the class, and a shared redactURLError helper as the consolidation point.\n- context.md records (b) as an accepted residual with no test, pointing to the report.\n- Teardown audit (fails.md:670) also checks for drift in:\n  - root CLAUDE.md, Config Governance paragraph;\n  - services/xstockstrat-marketdata/CLAUDE.md, where the GetSecret grant is described as header-only.\n\nSTEP 5: Mechanical dev smoke check\n- Choose a marketdata boot whose timestamp is after the new config instance became healthy. Force a marketdata restart after config is up if needed.\n- Grep its boot logs for the ASCII substring `resolving vendor credential from config failed` (main.go:70).\n- Pass: zero matches. Any match fails the check.\n- Rollback: revert the Step 3c authz.ts line only.\n\nPROMOTION (P-03/C-16)\n- Narrowing config @AC-4 is a CHANGE that needs the user's explicit sign-off, recorded in context.md before /sdd-spec.\n- At launch, feature AC-3, AC-4 and AC-6 are promoted alongside config @AC-4, never rewriting it. Each new scenario names @AC-4 and states the tightening: \"allow-listed\" means header plus SAN for grants that set peerSan.\n\nDESIGN-GATE QUESTION (P-03)\n- Ask the user whether to fold the build-request sites into Step 1, since it is the same rule in the same two functions, or keep them in the defect report.\n- Default is the defect report, per the binding D-39/D-40-only scope decision.",
    "open_objections": [
      {
        "text": "[C-16 / P-03] Narrowing the promoted config @AC-4 (services/xstockstrat-config/acceptance/config-secrets-and-scoping.feature, 'An allow-listed internal caller resolves a secret via GetSecret') from header-only to header plus SAN is a CHANGE. No operator decision covers it. The orchestrator must get the user's explicit sign-off at the design gate and record it in context.md before /sdd-spec. The promotion form is settled (promote alongside, each new scenario naming @AC-4 and stating the tightening); the sign-off is the only thing missing.",
        "blocking": true
      },
      {
        "text": "[P-03, operator call] Decide whether the build-request: %w sites (fmp_client.go:226, finnhub_client.go:114) fold into Step 1, which is the same rule in the same functions and fits 'low rework', or stay in the defect report. The default is the report, per the binding D-39/D-40 scope. The user must be asked; the orchestrator should not decide silently.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "254:@AC-1",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "254:@AC-2",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "254:@AC-3",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "254:@AC-4",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "254:@AC-5",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "254:@AC-6",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "254:@AC-7",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "config:@AC-4 (config-secrets-and-scoping.feature: allow-listed internal caller resolves a secret via GetSecret; header-only -> header+SAN for marketdata)",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "config:@AC-5 (GetSecret deny cases)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "config:@AC-16 (found=false vs INTERNAL)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "feature-217:@AC-4 (FMP budget refund on failure)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "mintCa(dir) in the shared PKI helper (proposal r2): it cannot serve mtls.test.ts mintPki's second CA with a different CN (:43-55), and adopting it would break the import-only promise. Lost to extracting only sh/mintLeaf/setEnv and minting the CA inline in secretsAndScope.test.ts.",
      "Deny cases in secretCallerAuthz.test.ts (proposal r2): they repeat the perUserSecrets.test.ts deny matrix and the wire AC-3, leaving three places to keep in sync (C-18). Lost to adding only the SAN to the existing marketdata allow case.",
      "Step 1 fallback that %w-wraps the raw err when errors.As fails: any future non-*url.Error path would leak the URL again. Lost to an explicit cause-free else-branch.",
      "Direct-handler-only config tests with a stubbed getAuthContext: faster, but it drops the wire-level guarantee in secretsAndScope.test.ts:8-10 (fails.md:668), and there would be no real valid-CA, wrong-SAN handshake for AC-3.",
      "Inline a third copy of the PKI helpers: zero edits to the existing tests, but it trips jscpd (mintLeaf is above the 100-token floor, .jscpd.json:4).",
      "Drop %w entirely: simplest, but it loses errors.Is(ctx.DeadlineExceeded/Canceled) and the dial/TLS cause.",
      "Shared redactURLError Go helper now: about 4 lines at 2 sites in 2 packages, below the jscpd floor, and it would need a new package (YAGNI). Named in the residual defect report as the consolidation point.",
      "String-scrubbing apikey=/token= from error text: fragile and only treats the symptom.",
      "Key in a request header (class-closing fix): outside D-39/D-40 scope, and vendor header support (FMP apikey header, Finnhub X-Finnhub-Token) is unverified. Deferred to the defect report as the recommended fix.",
      "Redirect-server test for the Location-header residual: the input must come from the vendor, and the fix that closes it is out of scope. Accepted residual, recorded in context.md and the report.",
      "Smoke grep on the em-dash string or on any boot: log encoding could give a false zero, and a pre-config-deploy boot passes vacuously. Lost to the ASCII substring on a post-config-healthy boot."
    ],
    "open_risks": [
      "A SAN mis-bind fails soft. If a marketdata leaf lacks DNS:xstockstrat-marketdata, GetSecret returns PERMISSION_DENIED, main.go:70 WARNs, marketdata boots with empty vendor credentials, and health checks stay green. Mitigations: deploy.yml:102 mints all leaves via gen-dev-certs.sh (which lists marketdata), and the Step 5 smoke check. Prod gets no separate check.",
      "Switching the GetSecret describe to an mTLS harness could fail for harness reasons (targetOverride/SAN pairing for the xstockstrat-config server leaf, or env sequencing). Mitigation: commit order (harness green under the header-only grant first, then red AC-3, then the grant).",
      "Accepted redirect residual: a malformed vendor Location header can still embed a key-bearing URL in the inner cause. Tracked in the defect report.",
      "The build-request sites (fmp_client.go:226, finnhub_client.go:114) leak the key-bearing URL when base_url is malformed, and query-string keys reach proxy and vendor access logs. Both stay live until the defect report's fix lands, unless the user folds the build-request sites into Step 1.",
      "Textual merge overlap in authz.ts with features 241, 263 and 255. Whichever lands second rebases. The ingest grant and the SetConfig grant (:66-76) are untouched.",
      "The mTLS harness adds RSA key generation time (one CA, three leaves) to the config test suite."
    ],
    "constitution_rules_touched": [
      "C-01",
      "C-08",
      "C-11",
      "C-15",
      "C-16",
      "C-18",
      "P-02",
      "P-03",
      "P-05",
      "P-06"
    ],
    "rationale": "Round 2 answers all four prior open objections concretely:\n- The mTLS wire harness is confirmed. The helper location, the openssl CI dependency and the per-call env read (mtls.ts:11-31) were all verified.\n- The redirect residual is explicitly accepted and tracked in a defect report.\n- The smoke check is now a mechanical grep on the exact WARN text.\n- The config @AC-4 CHANGE is escalated correctly.\n\nThe adversary found no Floor breaches. I checked their mintCa objection against the code: mtls.test.ts:43-55 mints test-ca and foreign-ca inline, and sh/mintLeaf/setEnv are verbatim duplicates. So the helper is narrowed to those three functions, which keeps the existing-file edits import-only. The adversary's other refinements are adopted as-is because each lowers rework or closes a real gap, which matches the user's 'preserve as much as you can while having low rework':\n- the cause-free else-branch plus a DeadlineExceeded proof;\n- one home for the deny matrix;\n- the post-config-healthy, ASCII-substring smoke check;\n- harness-green, red AC-3, then grant, then green commit ordering with recorded red evidence;\n- the teardown drift targets.\n\nThe only blocking item is the user's explicit sign-off on narrowing the promoted config @AC-4, which no operator decision covers. Folding the build-request sites into Step 1 is a non-blocking question for the user at the gate. The default stays the defect report, per the binding scope decision.\n\nThe trace-id operator decision is not engaged, because neither fix adds an emit or write path."
  },
  "floor_breaches": []
}
```

## Session 2026-10-22 — sdd-design (approved, COMPLETION)

- Phase 0 Recon: recon.md (services: xstockstrat-marketdata, xstockstrat-config; reuse: the non-2xx "never include
  the URL" rule at `fmp_client.go:254-255`/`finnhub_client.go:126-127`; the ingest `peerSan` grant at `authz.ts:124`).
- Phase 1 Grilling: 2 rounds (full), approved at the design gate. Floor clear.
- OPERATOR DECISIONS (binding, recorded 2026-10-22, design gate r2):
  - APPROVED as synthesized.
  - **C-16 sign-off:** the user explicitly SIGNS OFF the CHANGE to config `@AC-4`
    (`services/xstockstrat-config/acceptance/config-secrets-and-scoping.feature`). GetSecret allow-listing goes from
    header-only to header plus DNS SAN for grants that set `peerSan`. Feature AC-3/AC-4/AC-6 are promoted at launch
    alongside `@AC-4`, which is never rewritten. This closes the round-2 blocking objection.
  - **Scope addition:** the `build request: %w` sites (`fmp_client.go:226`, `finnhub_client.go:114`) fold into Step 1
    under the same no-URL rule, each with a test. The redirect (Location header) residual stays in the new defect
    report. This answers the non-blocking P-03 gate question and overrides the round-2 default.
  - Standing (2026-10-21): x-trace-id propagation / no C-03 waiver. Not engaged here, because neither fix adds an emit
    or write path.
- Chosen approach:
  - D-39: unwrap `*url.Error` and wrap only `ue.Err`, with a cause-free else-branch. This applies at both transport
    sites and both build-request sites. Real-dial plus ctx-deadline plus parse-failure tests.
  - Service-edge tests for AC-5/AC-7.
  - D-40: `peerSan: 'xstockstrat-marketdata'` on the marketdata GetSecret grant. Shared `mtlsTestPki.ts`
    (sh/mintLeaf/setEnv), and the GetSecret describe moves to an mTLS wire harness. Commit order is green harness,
    then red AC-3, then the grant.
  - Docs plus a residuals defect report, then a mechanical dev smoke grep.
- Rejected: mintCa helper; deny cases in secretCallerAuthz.test.ts; a raw-err fallback; direct-handler-only tests;
  dropping %w; a redactURLError helper now; string-scrubbing; key-in-header (deferred to the report). See design.md.
- Constitution rules touched: C-01, C-08, C-11, C-15, C-16, C-18, P-02, P-03, P-05, P-06. Floor breaches: none.
- Status: spec-ready → design-approved.
- The `## Open Threads` block above (round-2 gate) is superseded for the two gate questions, which are now answered.
  The live threads are below.

### Open Threads (design-approved)

- [ ] SAN mis-bind fails soft. A leaf without `DNS:xstockstrat-marketdata` means marketdata WARNs at `main.go:70` and
  boots with empty vendor credentials while health checks stay green. Target: Step 5 dev smoke grep, plus the Step 3
  pre-merge re-check of `gen-dev-certs.sh:28`/`:50` and `deploy.yml:102`. Prod gets no separate check.
- [ ] The mTLS harness switch could fail for harness reasons (targetOverride/SAN pairing, env sequencing). Target: Step 3
  (3b) commit order, with the harness green under the header-only grant first.
- [ ] Accepted residual: a malformed vendor `Location` redirect header can embed a key-bearing URL in the inner cause.
  There is no test for it. Target: Step 4 defect report.
- [ ] Query-string keys still reach proxy and vendor access logs until key-in-header lands. Target: Step 4 defect report.
- [ ] Body-read wrap `fmp_client.go:251` (`read %s body: %w`): confirm whether it can embed the URL (recon.md:108).
  Target: /sdd-spec and Step 1.
- [ ] Textual merge overlap with 241 and 263 (`authz.ts`; 241 also touches `perUserSecrets.test.ts`) and with 255
  (the three marketdata files). Whichever lands second rebases. Target: Steps 1 and 3.
- [ ] The mTLS harness adds RSA keygen time (1 CA + 3 leaves) to the config suite. Target: Step 3 (watch only).

## Session 2026-10-22 — sdd-spec

- Generated implementation-spec.md with 9 steps. Status: design-approved → implementation-ready.
- Steps:
  - 1 service: D-39 client redaction, covering both the transport and build-request sites in both vendors.
  - 2 test: client tests (AC-1, AC-2).
  - 3 test: service-edge tests (AC-5, AC-7).
  - 4 test: `mtlsTestPki.ts` extraction.
  - 5 test: mTLS wire harness for the GetSecret describe (AC-4).
  - 6 test: wire wrong-SAN negative, the red evidence (AC-3).
  - 7 service: `peerSan: 'xstockstrat-marketdata'` plus the unit deny matrix (AC-3, AC-4, AC-6).
  - 8 docs: invariants, the root config-governance line and the residuals defect report.
  - 9 dev smoke grep.
- Design-step numbering maps to spec steps as follows: design Step 3 (3a-3d) is spec Steps 4-7, design Step 4 is
  spec Step 8, and design Step 5 is spec Step 9. The Open Threads "Target" step numbers above refer to the
  design-step numbering.
- No proto, migration, config-key, env-var or port step. marketdata's last migration is `009` and config's is `030`;
  both are untouched.
- Key codebase findings:
  - **Body-read open thread resolved: no change and no test.** A `*url.Error` is built only by `Client.do`'s `uerr`
    (`$GOROOT/src/net/http/client.go:665`, go1.27.0). `cancelTimerBody.Read` (`client.go:997-1009`) returns the raw
    read error, or a `timeoutError` built from that error's text, with no URL. So `fmp_client.go:249-251` and
    `finnhub_client.go:121-123` carry no key.
  - `finnhub_client.go` does not import `"errors"` (`:5-16`); Step 1 adds it. `fmp_client.go` already imports it.
  - Package `service` tests already import `internal/fmp` (`classification_service_test.go`), so Step 3 can pass a real
    `*fmp.Client` into `newFundSvc` with no import cycle.
  - The Steps 1-3 red-green cycle: Steps 2 and 3 are authored and run RED before Step 1's code. Two of the new tests
    are characterization tests with "red N/A", recorded as such:
    - the deadline-cause test, because raw `%w` already satisfies `errors.Is`;
    - the transport-failure budget-refund test, which preserves feature-217 @AC-4.
  - Step 7 must flip `perUserSecrets.test.ts:236-248` in the same commit as the grant, or the suite goes red between
    steps (F-05). Step 6 [test] is the paired RED for Step 7 [service].
  - The pre-merge SAN-material gate (`gen-dev-certs.sh:28`/`:50`, `deploy.yml:102`) is in Step 7's Verification.
  - Docs drift targets confirmed by grep:
    - `services/xstockstrat-config/CLAUDE.md:41`;
    - `services/xstockstrat-config/docs/context-constitution.md:35` and `:51`;
    - `services/xstockstrat-marketdata/CLAUDE.md:218`;
    - root `CLAUDE.md` § Config Governance Rules.

## Session 2026-10-22 — sdd-review impl-spec (advisory)

- Criteria verdict: PASS WITH WARNINGS (0 FAIL, 6 WARN, no Floor breach). Overlap verdict: WARN (file-level only;
  no migration, proto-field or config-key collision). Lifecycle unchanged (`implementation-ready`).
- Addressed (implementation-spec.md edited):
  - Step 2: the coverage line now runs `export GOWORK=off && COVERPKGS=…`, so `go list` and `go test` really run with
    `GOWORK=off`. Before, the prefix only set an unexported shell variable.
  - Step 3: states the explicit `total >= 40%` threshold and runs Step 2's coverage command in place of the bare
    `go test ./...`.
  - Step 5: the Verification comment now states `c8 lines >= 40` (`package.json:13` `--lines 40`).
  - Step 6: states there is no coverage threshold at this step. It is an expected-red run, used only in the Step 6-7
    pair; the `c8 lines >= 40` gate is at Step 7 (F-05, P-06).
  - Step 8: the `**Service**` field now names services (`xstockstrat-config`, `xstockstrat-marketdata`, docs only).
- Still open / accepted:
  - Step 8 touches 7 files, over the 5-file guideline. All are docs, so it is kept as one step (accepted, low cost).
  - Step 5 builds `ingestClient` for Step 6 without using it. This is deliberate and documented in Step Dependencies,
    so no change (C-18 note).

### Open Threads (impl-spec review)

- [ ] Merge order is unrecorded. `docs/roadmap/features/merge-order.md` has no row for 254 against 215, 241, 255 or
  263. Overlaps:
  - `fmp_client.go` / `finnhub_client.go` and their tests vs 215 (in-progress) and 255 (draft);
  - config `src/grpc/authz.ts`, `perUserSecrets.test.ts` and `secretsAndScope.test.ts` vs 241 (implementation-ready)
    and 263 (draft);
  - `services/xstockstrat-config/CLAUDE.md` vs 241 and 248, `services/xstockstrat-config/docs/context-constitution.md`
    vs 244, `services/xstockstrat-marketdata/CLAUDE.md` vs 215, and root `CLAUDE.md` vs 242 and 252.
  The router decides the order and owns the write. Whichever feature lands second rebases. Target: the /sdd-execute
  checkpoint before Step 1 (marketdata) and before Step 7 (authz.ts).
- [ ] Re-run the overlap scan once 256-260 get implementation specs (no concrete clash today). Target: /sdd-execute start.

## Session 2026-10-28 — sdd-execute re-spec (sdd-batch-execute)

- Branch setup: merged `origin/main-dev` into `feature/fix-marketdata-secret-exposure` (`-X ours`).
- Re-spec, line drift only (no Instruction change): Step 7 pre-merge gate grep now targets `deploy.yml:101`
  (the `:102` grep failed after the merge and would have blocked P-03 falsely), and its Instruction 4 WARN cite moves
  to `main.go:77-78`. Step 9 WARN moves to `main.go:77-78`, Step 1 FMP `fetchQuotes`/`fetchRatios`/`FetchSector`/
  `FetchIsEtf` to `:263`/`:273`/`:364`/`:374`, Step 5 `ci.yml:594`, Step 8 `fails.md:671` (rule `:673`).
  The Step 7 SAN-material grep passes against the current tree.

## Session 2026-10-28 — sdd-execute sequential (sdd-batch-execute)

- Status `implementation-ready` → `in-progress`.
- Up-front confirmation (sequential mode entry): given by operator standing authorization, operator chat 2026-10-28
  (session_01NpS3HShZK6pSnogA7CFo2f): "Start executing features 241-276" via batch-execute, then "start batch 2 in
  parallel too". Answers: unattended checkpoints (checkpoints = report); C-16 promotion auto-confirmed unless it
  changes an existing @AC rule; merge-train authorized; 255 and 275 deferred; operator-only DB/prod steps — open the
  integration PR and hold the merge.
- Branch base: `origin/main-dev` merged in (`-X ours`); Steps 1, 5, 7, 8, 9 re-spec'd for line drift (entry above).

## Session 2026-10-28 — sdd-execute sequential, Step 1

- Step 1 done (D-39). Both vendor `getJSON` functions now unwrap `*url.Error` and `%w`-wrap only `ue.Err`, with a
  cause-free fallback, at the build-request and transport sites (`fmp_client.go`, `finnhub_client.go`; `"errors"`
  import added to finnhub). `reserve()`, `counted` and the refund `defer` are untouched (217 @AC-4).
- TDD: AC-1/AC-2 red: throwaway probes failed with
  `fmp: /stable/quote request failed: Get "http://127.0.0.1:1/stable/quote?apikey=k-secret&symbol=AAPL": dial tcp ...`
  and `finnhub: build request: parse "http://127.0.0.1:1\x7f/stock/metric?...&token=k-secret": ...` → green:
  `fmp: /stable/quote request failed: dial tcp 127.0.0.1:1: connect: connection refused`,
  `finnhub: /stock/metric build request: net/url: invalid control character in URL`. Probes were not committed;
  Steps 2-3 add the committed tests (Deviation Log).
- Verification: `go build ./...`, `go vet` (fmp, finnhub) OK; the leak grep returns nothing; `golangci-lint run` 0 issues;
  `go test -race` on fmp/finnhub/service green.
- Tooling note: the provisioned `~/go/bin/golangci-lint` v2.14.0 was built with go1.26 and refuses the go1.27 module.
  It was rebuilt at the same pin with `GOTOOLCHAIN=go1.27.0 go install .../golangci-lint@v2.14.0` into the session
  scratchpad. No repo change.

## Session 2026-10-28 — sdd-execute sequential, Step 2

- Step 2 done (D-39 client tests, AC-1/AC-2). Added `assertNoKeyLeak` and `newLeakClient` (file-local) plus
  `TestTransportError_DoesNotLeakAPIKey_AC1`/`_AC2`, `TestBuildRequestError_DoesNotLeakAPIKey` and
  `TestTransportError_PreservesDeadlineCause` to `fmp_client_test.go` and `finnhub_client_test.go`, and
  `TestGateway_BudgetRefundOnTransportError_AC4` to `fmp_gateway_test.go`.
- TDD, RED (pre-Step-1 client files from `ba303400^`, restored afterwards):
  - FMP AC-1: `error leaked api key: "fmp: /stable/quote request failed: Get \"http://127.0.0.1:1/stable/quote?apikey=k-secret&symbol=AAPL\": dial tcp 127.0.0.1:1: connect: connection refused"`.
  - FMP build request: `error leaked api key: "fmp: build request: parse \"http://127.0.0.1:1\\x7f/stable/quote?apikey=k-secret&symbol=AAPL\": net/url: invalid control character in URL"`.
  - Finnhub AC-2 and build request failed the same way with `token=k-secret`.
  - Both deadline tests failed on `error chain still holds a *url.Error` (not "N/A — characterization" as the
    spec predicted; Deviation Log).
  - `TestGateway_BudgetRefundOnTransportError_AC4` passed (characterization guard for 217 @AC-4, as specified).
- GREEN after restoring Step 1: all 7 new tests (plus the existing 403 and 503 tests) pass with `-race`.
- Verification: full `go test ./... -race` green; coverage total 71.4% (>= 40%); `golangci-lint` v2.14.0 (go1.27
  build in the session scratchpad) 0 issues.

## Session 2026-10-28 — sdd-execute sequential, Step 3

- Step 3 done (D-39 service edge, AC-5/AC-7). Added `TestFundamentals_TransportErrorStatusIsKeyFree_feature254` to
  `marketdata_service_test.go` (plus the `internal/fmp` import): a real `fmp.Client` on `http://127.0.0.1:1` with
  key `k-secret` behind `newFundSvc(enabledCfg("fmp"), ...)`; subtests `single (AC-5)` and `batch (AC-7)` assert
  `CodeUnavailable`, `"fmp"` present, and no `k-secret` / `apikey=`. `marketdata_service.go` unchanged (FR-3).
- TDD, RED (pre-Step-1 `fmp_client.go` from `ba303400^`, restored afterwards): both subtests failed with
  `status leaked api key: "unavailable: fmp fetch: fmp: /stable/quote request failed: Get \"http://127.0.0.1:1/stable/quote?apikey=k-secret&symbol=AAPL\": dial tcp 127.0.0.1:1: connect: connection refused"`.
  GREEN on `HEAD`: both subtests and `VendorNoFundamentalsIsNotFound_feature215` pass with `-race`.
- Verification: full `go test ./... -race` green; coverage total 71.5% (>= 40%); `golangci-lint` v2.14.0 (go1.27
  build in the session scratchpad) 0 issues.


## Session 2026-10-29 — sdd-execute re-spec (sdd-batch-execute)

- Branch setup: merged `origin/main-dev` into `feature/fix-marketdata-secret-exposure` (`-X ours`, merge `12dc255b`).
- Operator approval: standing authorization, operator chat 2026-10-28/29 (session_01NpS3HShZK6pSnogA7CFo2f):
  "Start executing features 241-276" via batch-execute. Answers: unattended checkpoints (checkpoints = report); C-16
  promotion auto-confirmed unless it changes an existing @AC rule; merge-train authorized; 255 and 275 deferred;
  operator-only DB/prod steps — open the integration PR and hold the merge; blocker decisions 2026-10-29 recorded per
  feature.
- Status already `in-progress` (flipped 2026-10-28); no status change this session.
- Re-spec of Steps 4-9 against the merged tree: every path, symbol and line cite still resolves (config `authz.ts`
  grant `:114-126`, `secretsAndScope.test.ts` GetSecret describe `:63`, `perUserSecrets.test.ts:236-248`,
  `secretCallerAuthz.test.ts:57-62`, marketdata `config.go:70/:109/:115`, `main.go:77-78`). Changes: Step 5
  Instructions 2-3 spell out `setEnv(...leaf, caPem)` (3-arg `setEnv`, `mintLeaf` returns `[certPem, keyPem]`, CA PEM
  read with `readFileSync` since openssl writes it to a path); Step 9 Verification names the DO apps MCP
  `apps-get-logs` tool because `doctl` is not installed in the sandbox. Steps 4, 6, 7, 8 unchanged.

## Session 2026-10-29 — sdd-execute sequential, Step 4

- Tooling setup (step 4): node ✓ v24.20.0 · pnpm ✓ 9.15.9 · openssl ✓ · config deps ⬇ (`pnpm install --frozen-lockfile --filter "xstockstrat-config..."`).
- Step 4 done (D-40 prep). Created `services/xstockstrat-config/src/__tests__/mtlsTestPki.ts`, which exports `sh`,
  `mintLeaf` and `setEnv` moved verbatim from `peerSanSpike.test.ts`. Both `peerSanSpike.test.ts` and `mtls.test.ts`
  now import them and drop their local copies and the unused `execFileSync` / `writeFileSync` imports. `mintPki` and
  the spike's inline CA lines are unchanged.
- TDD: N/A (refactor with no behavior change). The characterization suites ran before and after the move: 182/182
  pass both times, and `inter-service mTLS` and `peer SAN spike` stay green. c8 all-files lines are 86.77% both
  times (>= 40).
- Verification: `pnpm run lint` exit 0 (warnings only, none in the touched files). The grep finds `function sh|mintLeaf|setEnv`
  only in `mtlsTestPki.ts`. jscpd was run directly instead of through the script (Deviation Log): 0 clones in config.
  The 46 repo-wide clones are all in files this step does not touch.

## Session 2026-10-29 — sdd-execute sequential, Step 5

- Tooling setup (step 5): node ✓ v24.20.0 · pnpm ✓ 9.15.9 · openssl ✓ · config deps ⬇ (`pnpm install --frozen-lockfile --filter "xstockstrat-config..."`).
- Step 5 done (D-40 prep). The `GetSecret allow-list + failure modes` describe in `secretsAndScope.test.ts` now mints a
  test CA plus `xstockstrat-config` / `xstockstrat-marketdata` / `xstockstrat-ingest` leaves (`mtlsTestPki.ts`), binds
  with `mtls.serverCredentials()`, and dials `client` (marketdata leaf) and `ingestClient` (ingest leaf) with
  `mtls.clientCredentials()` + `mtls.targetOverride('xstockstrat-config')`. `ingestClient` is unused until Step 6
  (accepted impl-spec review note). The five `it` blocks and the SetConfig describe are unchanged. The header comment
  now says "GetSecret (over mTLS)".
- TDD: N/A (transport change, no behavior change). Characterization before and after: 182/182 pass, and the five
  GetSecret tests (AC-4, AC-5 x2, AC-16 x2) stay green under the still header-only marketdata grant. c8 all-files
  lines are 86.77% both times (>= 40).
- Verification: `pnpm run test:coverage` exit 0; `pnpm run lint` 0 errors (warnings only; the new `ingestClient: any`
  mirrors the existing `client: any`); `git diff --quiet -- src/grpc/authz.ts` → untouched.

## Session 2026-10-29 — sdd-execute sequential, Step 6

- Tooling setup (step 6): node ✓ v24.20.0 · pnpm ✓ 9.15.9 · openssl ✓ · config deps ⬇ (`pnpm install --frozen-lockfile --filter . --filter "xstockstrat-config..."`).
- Step 6 done (D-40 red evidence). Added `it('AC-3 (254): marketdata secret is denied to an mTLS peer whose SAN is
  xstockstrat-ingest')` to the GetSecret describe of `secretsAndScope.test.ts`. It seeds `encryptSecret('alpaca-xyz')`,
  calls GetSecret through `ingestClient` (ingest leaf, valid CA, wrong SAN) with `x-internal-caller: marketdata`, and
  asserts `PERMISSION_DENIED` with no `res`. The local `getSecret` helper now delegates to a new `getSecretAs(c, …)`.
- TDD: AC-3 red: under the current header-only `marketdata` grant (no `peerSan`), `assert.ok(err, 'a wrong-SAN peer
  must be refused')` failed with `actual: null`. GetSecret succeeded for the ingest-SAN peer, which is the D-40 gap.
  Suite: `ℹ tests 183`, `ℹ pass 182`, `ℹ fail 1`, and the only `✖` is `AC-3 (254)`. AC-4 / AC-5 x2 / AC-16 x2 stay
  green. → green: pending Step 7 (the `peerSan: 'xstockstrat-marketdata'` grant). This is the RED evidence for Step 7
  (C-08 pair); copy it into the integration PR body.
- Verification: the expected-red run above. The spec-reporter grep replaces the TAP grep (Deviation Log).
  `pnpm run lint` exits 0, with 0 errors and only warnings. `authz.ts` is untouched. There is no coverage gate at
  this step (F-05: it moves to Step 7).

## Session 2026-10-29 — sdd-execute sequential, Step 7

- Tooling setup (step 7): node ✓ v24.20.0 · pnpm ✓ 9.15.9 · openssl ✓ · config deps ⬇ (`pnpm install --frozen-lockfile --filter . --filter "xstockstrat-config..."`).
- Step 7 done (D-40 fix). `SECRET_CALLER_ALLOWLIST`'s `marketdata` entry in `src/grpc/authz.ts` now carries
  `peerSan: 'xstockstrat-marketdata'`, mirroring the ingest grant. No other `authz.ts` edit (ingest and SetConfig
  grants and the matcher are untouched). In `perUserSecrets.test.ts`, the old "no SAN required" test became
  `marketdata GetSecret requires the xstockstrat-marketdata peer SAN (254: AC-3/AC-4/AC-6)`, with a new
  `MARKETDATA_SAN` const: the marketdata SAN resolves `alpaca-xyz` (AC-4); the ingest SAN, `() => ({})` and no auth
  context each give `PERMISSION_DENIED` with no `res` (AC-3/AC-6). `secretCallerAuthz.test.ts:59` now passes
  `callWith('marketdata', 'DNS:xstockstrat-marketdata')`.
- TDD: red: unit tests authored first, run before the `authz.ts` edit. `ℹ tests 183`, `ℹ pass 181`, `ℹ fail 2`: the
  new unit test failed on the wrong-SAN assert (`undefined !== 7`, i.e. GetSecret succeeded for an ingest-SAN peer),
  and Step 6's wire `AC-3 (254)` still failed. → green: after the grant edit, `ℹ tests 183`, `ℹ pass 183`, `ℹ fail 0`;
  in the wire suite only AC-3 (254) changed state (AC-4 / AC-5 x2 / AC-16 x2 stayed green).
- Verification: `pnpm run test:coverage` exit 0, c8 all-files lines 86.79% (>= 40). `pnpm run lint` exit 0 (0 errors,
  warnings only). `grep peerSan: 'xstockstrat-marketdata'` → `authz.ts:119`. Pre-merge gate (P-03): the three SAN
  material lines (`gen-dev-certs.sh:28`, `:50`, `deploy.yml:101`) are unchanged.
- Rollback for D-40 is reverting the `authz.ts:119` line alone (D-39 stays).

## Session 2026-10-29 — sdd-execute sequential, Step 8

- Tooling setup (step 8): none needed (docs only).
- Step 8 done (docs). The `marketdata` GetSecret grant's DNS SAN `xstockstrat-marketdata` is now stated in config
  `CLAUDE.md` invariant #6, config `docs/context-constitution.md` (Gotcha at `:35` and invariant row at `:51`: both
  grants carry `peerSan`), marketdata `CLAUDE.md:218` (header plus leaf SAN; a SAN-less leaf gets
  `PERMISSION_DENIED`, which surfaces as the boot WARN `resolving vendor credential from config failed`), and the
  root `CLAUDE.md` § Config Governance Rules parenthetical.
- Residual (a), the redirect `Location`-parse error whose inner cause can quote a vendor-sent URL, is **accepted with
  no test** (design.md). It is tracked with residual (b), query-string keys in proxy/vendor access logs, in
  `docs/reports/2026-10-29-marketdata-vendor-key-url-residuals-defect.md` (sidecar `open`), which recommends
  key-in-header (vendor support unverified) plus a shared `redactURLError` helper.
- Teardown: `/context-forge:context-constitution` is unavailable in this session, so it was done by hand (see the
  Deviation Log). That includes the out-of-Files fix of `docs/patterns/config-governance.md:25`. The integration PR
  body must record both.
- TDD: N/A (docs).
- Verification: the three spec greps pass (config SAN lines at `CLAUDE.md:41` and `context-constitution.md:35`/`:51`;
  `DNS SAN` at marketdata `CLAUDE.md:218` and root `CLAUDE.md:176`; sidecar `head -1` → `open`). The report has
  exactly one severity token.

## Session 2026-10-29 — sdd-execute sequential, Step 9

- Step 9 (post-merge dev smoke) **deferred to operator**; Status stays `pending`. Precondition unmet: Step 7
  (`d3f6780b`) is only on `origin/feature/fix-marketdata-secret-exposure`, not on `origin/main-dev`, so the dev app
  still runs pre-fix code and no smoke evidence exists yet. The exact operator checks are in the implementation-spec
  Deviation Log (2026-10-29, Step 9): after merge + dev deploy, grep a post-config-healthy marketdata boot for the
  ASCII prefix `resolving vendor credential from config failed` and expect 0; any match → revert `authz.ts:119`
  alone. Record boot timestamp + match count here when done.
- Line drift noted: the WARN is at `services/xstockstrat-marketdata/cmd/server/main.go:77-78` (Step 9 Codebase
  Evidence already cites this; older planning notes cite `:70-71`).
- Update (operator decision 2026-10-29): Step 9 **Status** set to `done`. The smoke is post-merge verification and no
  longer holds the integration PR. It is **not yet performed**: after the merge deploys to dev, the operator's session
  checks marketdata `GetSecret` at startup (Grafana logs/traces, or the Verification grep expecting 0) and records the
  boot timestamp and match count here. A match still means reverting the Step 7 `authz.ts` `peerSan` line alone.

## Session 2026-10-29 — sdd-batch-execute promotion plan (awaiting operator confirm)

```sdd-batch-promotion-plan
## Promotion plan - fix-marketdata-secret-exposure (feature 254)

Source: /home/user/xstockstrat/docs/roadmap/features/254-fix-marketdata-secret-exposure/acceptance.feature (7 scenarios, AC-1..AC-7). Affected services (feature.md Reviewers): xstockstrat-marketdata, xstockstrat-config.

### Verdicts
| @AC | target suite (path) | CREATE/APPEND | verdict | note |
|---|---|---|---|---|
| AC-1 (FR-1) | services/xstockstrat-marketdata/acceptance/fix-marketdata-secret-exposure.feature | CREATE | NEW | FMP client error text; no existing suite asserts it |
| AC-2 (FR-2) | same marketdata file | CREATE (same file) | NEW | Finnhub client error text |
| AC-5 (FR-3) | same marketdata file | CREATE (same file) | NEW | GetFundamentals UNAVAILABLE status message |
| AC-7 (FR-3) | same marketdata file | CREATE (same file) | NEW | GetFundamentalsMulti UNAVAILABLE status message |
| AC-3 (FR-4) | services/xstockstrat-config/acceptance/fix-marketdata-secret-exposure.feature | CREATE | NEW | GetSecret refused without marketdata SAN. Tightens the config @feature-147 @AC-4/@AC-5 allow-list rule; see Notes |
| AC-4 (FR-5) | same config file | CREATE (same file) | NEW | marketdata still resolves with SAN xstockstrat-marketdata. Adds the SAN precondition that @feature-147 @AC-4 did not state |
| AC-6 (FR-4) | same config file | CREATE (same file) | NEW | No peer SAN is refused. Replaces the "no SAN required" assertion in perUserSecrets.test.ts:236 |

### Ready-to-write blocks
--- /home/user/xstockstrat/services/xstockstrat-marketdata/acceptance/fix-marketdata-secret-exposure.feature (CREATE) ---
# Promoted from docs/roadmap/features/254-fix-marketdata-secret-exposure/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-254` tag.
# Durable business rules xstockstrat-marketdata already guarantees - a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring.

Feature: xstockstrat-marketdata - vendor API keys never leak through errors
  Vendor API keys must not appear in transport errors (D-39) or in gRPC status messages returned to callers.

  @AC-1 @FR-1 @regression @feature-254
  Scenario: An FMP transport failure never reveals the API key
    Given an FMP client configured with api key "k-secret" and base URL "http://127.0.0.1:1"
    When GetFundamentalsMulti is called for "AAPL" and the HTTP transport fails
    Then an error is returned that names "fmp" and the request path "/stable/quote"
    And the error text does not contain "k-secret"
    And the error text does not contain "apikey="

  @AC-2 @FR-2 @regression @feature-254
  Scenario: A Finnhub transport failure never reveals the token
    Given a Finnhub client configured with api key "k-secret" and base URL "http://127.0.0.1:1"
    When GetFundamentals is called for "AAPL" and the HTTP transport fails
    Then an error is returned that names "finnhub" and the request path "/stock/metric"
    And the error text does not contain "k-secret"
    And the error text does not contain "token="

  @AC-5 @FR-3 @regression @feature-254
  Scenario: The marketdata gRPC Unavailable status never carries the vendor key
    Given marketdata uses fundamentals provider "fmp" with api key "k-secret" and base URL "http://127.0.0.1:1"
    And the fundamentals cache holds no row for "AAPL"
    When the GetFundamentals RPC is called for "AAPL"
    Then the call fails with UNAVAILABLE
    And the status message names "fmp"
    And the status message does not contain "k-secret"
    And the status message does not contain "apikey="

  @AC-7 @FR-3 @regression @feature-254
  Scenario: The marketdata batch Unavailable status never carries the vendor key
    Given marketdata uses fundamentals provider "fmp" with api key "k-secret" and base URL "http://127.0.0.1:1"
    And the fundamentals cache holds no row for "AAPL"
    When the GetFundamentalsMulti RPC is called for "AAPL"
    Then the call fails with UNAVAILABLE
    And the status message names "fmp"
    And the status message does not contain "k-secret"
    And the status message does not contain "apikey="
    # AC-5 covers marketdata_service.go:1760 (single); AC-7 covers :1704 (batch).

--- /home/user/xstockstrat/services/xstockstrat-config/acceptance/fix-marketdata-secret-exposure.feature (CREATE) ---
# Promoted from docs/roadmap/features/254-fix-marketdata-secret-exposure/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-254` tag.
# Durable business rules xstockstrat-config already guarantees - a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring.

Feature: xstockstrat-config - the marketdata vendor secret grant is bound to the marketdata mTLS SAN
  GetSecret for the marketdata vendor keys requires both the x-internal-caller grant and the marketdata peer SAN (D-40).

  @AC-3 @FR-4 @regression @feature-254
  Scenario: The marketdata vendor secret is refused to a peer without the marketdata SAN
    Given config holds secret "marketdata/alpaca.api_key" = "alpaca-xyz"
    When GetSecret is called for namespace "marketdata" key "alpaca.api_key" with header x-internal-caller "marketdata" from an mTLS peer whose DNS SAN is "xstockstrat-ingest"
    Then the call fails with PERMISSION_DENIED
    And no plaintext value is returned

  @AC-4 @FR-5 @regression @feature-254
  Scenario: The marketdata service still resolves its vendor secret
    Given config holds secret "marketdata/alpaca.api_key" = "alpaca-xyz"
    When GetSecret is called for namespace "marketdata" key "alpaca.api_key" with header x-internal-caller "marketdata" from an mTLS peer whose DNS SAN is "xstockstrat-marketdata"
    Then the response has found true and value "alpaca-xyz"

  @AC-6 @FR-4 @regression @feature-254
  Scenario: The marketdata vendor secret is refused to a caller with no mTLS SAN
    Given config holds secret "marketdata/alpaca.api_key" = "alpaca-xyz"
    When GetSecret is called for namespace "marketdata" key "alpaca.api_key" with header x-internal-caller "marketdata" and no peer SAN
    Then the call fails with PERMISSION_DENIED
    And no plaintext value is returned
    # Replaces the "no SAN required" assertion at services/xstockstrat-config/src/__tests__/perUserSecrets.test.ts:236.

### Notes / ambiguities / conflicts
- Attribution: AC-1/2/5/7 assert on marketdata vendor clients and the marketdata RPC status -> marketdata. AC-3/4/6 assert on config's GetSecret outcome (the allow-list lives in services/xstockstrat-config/src/grpc/authz.ts) -> config, even though the Given names marketdata. No scenario spans services, so nothing goes to docs/sdd/business-rules/platform.feature (grep of it found no overlapping secret/SAN rule).
- Tag collision is intentional: the marketdata dir already has @feature-147 @AC-6/@AC-7 and the config dir has @feature-147 @AC-4/@AC-5. Provenance is the @AC+@feature pair, so there is no DUP. Dedup grep found no existing marketdata scenario on error-text redaction.
- CHANGES EXISTING RULE (tightening, not a literal contradiction): /home/user/xstockstrat/services/xstockstrat-config/acceptance/config-secrets-and-scoping.feature @feature-147 @AC-4 (lines 42-47) says an allow-listed "marketdata" caller with x-internal-caller="marketdata" gets plaintext, and it states no SAN condition. The 254 AC-3/AC-6 make the header alone insufficient, and AC-6 explicitly replaces the "no SAN required" test. AC-4 (254) restates the happy path with the SAN. I did not mark CONFLICT, because 147 @AC-4 is silent on SAN and 254 is a reviewed, intentional hardening that narrows the grant. I did not edit or delete the 147 scenario; promotion is additive. A human may want to annotate or consolidate 147 @AC-4 with 254 @AC-4 (OVERLAP-style candidate). The 147 @AC-5 fail-closed rule is unaffected.
- The existing config suite's header comment for ingest-style SAN binding (Constitution invariant #6 in services/xstockstrat-config/CLAUDE.md) already describes the SAN mechanism for `ingest`; 254 extends the same mechanism to `marketdata`.

### Coverage check
- Source scenarios: 7. Planned: 7 NEW (4 marketdata, 3 config), 0 DUP, 0 OVERLAP, 0 CONFLICT. All of AC-1..AC-7 are accounted for and none were skipped. Scenario text is verbatim; only the `@feature-254` tag was added.
```

## Session 2026-10-29 — sdd-execute sequential, C-16 promotion applied

- Promotion plan above applied as written: `services/xstockstrat-marketdata/acceptance/fix-marketdata-secret-exposure.feature` (AC-1, AC-2, AC-5, AC-7) and `services/xstockstrat-config/acceptance/fix-marketdata-secret-exposure.feature` (AC-3, AC-4, AC-6) created. Scenario text is verbatim, with `@feature-254` added.
- **Amendment to an existing rule (operator decision 2026-10-29):** `services/xstockstrat-config/acceptance/config-secrets-and-scoping.feature` feature-147 `@AC-4 @FR-3` now has the precondition "the caller presents an mTLS peer certificate whose DNS SAN is `xstockstrat-marketdata`" (per 254 AC-6) and is tagged `@feature-254` as well. 147's other assertions are unchanged, and 147 `@AC-5` is untouched.
- Status stays `code-completed`, so there is no history row. The husky pre-commit hook did not run: `core.hooksPath` points to `/home/user/xstockstrat/.husky/_`, which does not exist, and the main worktree has no `node_modules` to symlink. These were docs-only commits, and `--no-verify` was not used.

## Session 2026-10-29 — sdd-batch-execute promotion plan (awaiting operator confirm)

```sdd-batch-promotion-plan
## Promotion plan - fix-marketdata-secret-exposure (feature 254)

### Verdicts
| @AC | target suite (path) | CREATE/APPEND | verdict | note |
|---|---|---|---|---|
| AC-1 (FR-1) | /home/user/xstockstrat/services/xstockstrat-marketdata/acceptance/fix-marketdata-secret-exposure.feature | none | DUP | Present verbatim with @feature-254. FMP transport error never leaks the key. |
| AC-2 (FR-2) | same marketdata suite | none | DUP | Present verbatim with @feature-254. Finnhub transport error never leaks the token. |
| AC-3 (FR-4) | /home/user/xstockstrat/services/xstockstrat-config/acceptance/fix-marketdata-secret-exposure.feature | none | DUP | Present verbatim with @feature-254. Wrong peer SAN gets PERMISSION_DENIED. |
| AC-4 (FR-5) | same config suite | none | DUP | Present verbatim with @feature-254. The marketdata SAN still resolves the secret. |
| AC-5 (FR-3) | same marketdata suite | none | DUP | Present verbatim with @feature-254. Single GetFundamentals UNAVAILABLE status has no key. |
| AC-6 (FR-4) | same config suite | none | DUP | Present verbatim with @feature-254. No peer SAN gets PERMISSION_DENIED. |
| AC-7 (FR-3) | same marketdata suite | none | DUP | Present verbatim with @feature-254. Batch GetFundamentalsMulti UNAVAILABLE status has no key. |

### Ready-to-write blocks
None. Both target suites already exist in the working tree with all seven scenarios. Each has the `Feature:` header, the promotion provenance comment, and the `@AC-n @FR-n @regression @feature-254` tags. Re-running the promotion would write nothing, so it is idempotent.

### Notes / ambiguities / conflicts
- Routing is by the subject of each `Then`.
  - AC-1, AC-2, AC-5 and AC-7 assert on marketdata clients and RPC status, so they go to the marketdata suite.
  - AC-3, AC-4 and AC-6 assert on the config service's `GetSecret` grant check, so they go to the config suite. Their `Given` mentions the marketdata namespace, but the code under test is in config (`authz.ts`).
  - No scenario spans services, so nothing goes to `/home/user/xstockstrat/docs/sdd/business-rules/platform.feature`. A grep of it for SAN and GetSecret found only the analysis SAN contract and ingest per-user secrets, which are unrelated.
- No CONFLICT and no OVERLAP.
  - `/home/user/xstockstrat/services/xstockstrat-config/acceptance/config-secrets-and-scoping.feature` (about lines 46-53) already requires the marketdata SAN `xstockstrat-marketdata` for `GetSecret` and refuses a caller without the grant. AC-3, AC-4 and AC-6 tighten that rule and do not contradict it.
  - `/home/user/xstockstrat/services/xstockstrat-marketdata/acceptance/config-secrets-and-scoping.feature` (feature 147 AC-6 and AC-7) covers resolving credentials from config, not error redaction.
- AC-6's trailing comment says it replaces the "no SAN required" assertion at `services/xstockstrat-config/src/__tests__/perUserSecrets.test.ts:236`. That is a unit-test assertion and not a promoted `@AC-*` rule, so no promoted rule is changed. I did not open that test.
- I read the feature's `acceptance.feature` from the working-tree copy and not from `origin/feature/fix-marketdata-secret-exposure`. The suite files are in the working tree and match it verbatim.

### Coverage check
- Source scenarios: 7 (AC-1 through AC-7). Planned: 7 (0 NEW, 7 DUP, 0 OVERLAP, 0 CONFLICT).
- The marketdata suite holds 4 (AC-1, AC-2, AC-5, AC-7) and the config suite holds 3 (AC-3, AC-4, AC-6). Counts match and nothing was skipped.
```
