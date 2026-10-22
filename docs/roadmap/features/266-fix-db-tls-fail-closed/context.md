# Context Log: fix-db-tls-fail-closed

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-21 (/sdd-triage)

- Bug recorded as defect report `docs/reports/2026-10-21-db-tls-fail-closed-defect.md` (Issues disabled), sidecar
  `triaged` / `ref: feature:266-fix-db-tls-fail-closed`.
- Source: repo-surveyor debt-radar scan (`docs/repo-surveyor/debt-radar-findings.md` @ 4535695), finding D-32
  (flagged security, "Human triage. Fail closed in production.").
- Severity: SEV-2. Impact type: db-tls-unverified. Environment: dev (main-dev) @ a053b0e. Config-only: no.
- Operator decisions (2026-10-21): grouped by service+theme from the debt-radar scan; Track C for all SEV-2
  (precedent #1264); batch launched via /sdd-batch with designGate halt.
- Routed to SDD path (Track C).
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..5), context.md.
- Affected services: xstockstrat-ledger, xstockstrat-config, xstockstrat-identity, xstockstrat-notify, xstockstrat-ui.
- Root cause hypothesis: CA treated as optional hardening; copy-pasted pool setup (D-20) spread the fail-open default;
  UI never wired with the CA.
- D-32 reproduces on a053b0e. Line drift vs the scan: none — `rejectUnauthorized: !!caCert` at ledger `index.ts:37`,
  config `:40`, identity `:39`, notify `:41`, ui `config-ui/api/audit/route.ts:31`.
- **New evidence at triage (escalates the scan's latent framing):** `.do/app.yaml` and `.do/app.dev.yaml` bind
  `DATABASE_CA_CERT` (`${xstockstrat.CA_CERT}`) only for ledger, identity, notify and config; `xstockstrat-ui` gets
  `DATABASE_URL` but no CA, so the audit route's pool is unverified in both deployed environments now. A naive
  fail-closed change without the spec edit would break `/config-ui/api/audit` on deploy — the `.do` change must land
  in the same PR (or first).
- **Overlap check:** no feature 240–253 or open report touches `DATABASE_CA_CERT` / DB TLS. `252-fix-identity-ledger-test-suites`
  (implementation-ready) repairs the identity/ledger unit suites; any new boot-time test there needs 252 or must be
  proven to execute (P-06). Debt-radar D-20 (copy-pasted shared infra) is the adjacent refactor, not included.
- Design forks to settle: fail-closed scope — every non-`sslmode=disable` URL vs only when `APPLICATION_ENV` is
  production/staging (no Node service reads `APPLICATION_ENV` today except telemetry); whether to extract a shared
  pool-ssl helper (DRY guard rail: five identical copies) vs five surgical edits; UI behaviour — fail the route vs
  fail the Next.js boot; local Docker docs (`docker-compose.yml:27` uses `sslmode=disable`, so local is unaffected).
- Recommended design depth: full → `/sdd-design fix-db-tls-fail-closed` (rationale: SEV-2 security, 5 affected
  services plus deploy-spec change — the C-0 full trigger; no proto/migration).
- Development branch: feature/fix-db-tls-fail-closed

## Session 2026-10-21 — sdd-review product-spec

- Product spec approved (PASS WITH WARNINGS). Status: draft → spec-ready. Next: `/sdd-design fix-db-tls-fail-closed`.
- OPERATOR DECISIONS (binding, recorded 2026-10-21):
  - Grouped by service+theme from the 2026-10-20 debt-radar scan; Track C.
  - Scope is D-32.
- Warnings:
  - C-15/criterion 8: FR-2 ("every affected pool") had no UI wrong-CA scenario. **Resolved:** added `@AC-7` (audit
    route rejects a cert not signed by the configured CA). FR-2 not narrowed.
  - Criterion 8: AC-3 (sslmode=disable) covered config only; UI route has its own path (`route.ts:13,29-30`).
    **Resolved:** added `@AC-8` (audit route with sslmode=disable reads without a CA).
  - Criterion 2: sslmode parse left to design; UI uses substring `includes('sslmode=disable')` (`route.ts:13`).
    **Resolved in spec text:** FR-1 now requires one parse shared by the backends and the UI route; the exact parse
    (edge cases such as `sslmode=disabled`, URL-encoded values) is still pinned at design.
  - Fix Scope leftover template line. **Resolved:** removed.
  - Criterion 5/6/7: "No config key changes" checkbox carries rationale prose (minor wording; left as-is).
  - db-migrator job has `DATABASE_URL` without a CA; scoped out only implicitly. **Resolved:** named explicitly in
    Out of Scope.
  - Trading-domain checks skipped (non-trading feature).
- Code-checkable claims verified by the reviewer: `rejectUnauthorized: !!caCert` at ledger `index.ts:37`, config
  `:40`, identity `:39`, notify `:41`, UI `route.ts:31`; `DATABASE_CA_CERT` bound for the four backends at
  `.do/app.yaml:434,481,528,586` and `.do/app.dev.yaml:431,478,525,583`, absent for `xstockstrat-ui`.
- Overlap findings (WARN, no FAIL; no config-key/proto/migration collision):
  - `services/xstockstrat-notify/src/index.ts` — also modified by `242-fix-push-untargeted-broadcast`
    (implementation-ready).
  - `.do/app.yaml` / `.do/app.dev.yaml` — 242 also modifies (notify `LEDGER_ENDPOINT`); different keys, same file.
  - `services/xstockstrat-ledger/src/index.ts` — also modified by `248-fix-ledger-trimmed-notify-payload`
    (implementation-ready).
  - `services/xstockstrat-ui/src/app/config-ui/api/audit/route.ts` — also under change by
    `241-fix-config-audit-author-spoof` (implementation-ready).
  - Non-blocking merge-order recommendation: sequence 266 after 242, 248 and 241, or rebase on whichever merges
    first. No `merge-order.md` row written (no FAIL-level overlap).
  - Low-risk shared context only: 250 (OTEL lines in `.do`), 084 (hand-synced `.do`/compose); draft batch peers
    name none of these files.

## Session 2026-10-22 — sdd-batch design state recovered (round 1)

- The batch run that produced round 1 was cut off by the session usage limit before its gate writer persisted the debate state. This block is the round-1 synthesis restored verbatim from the run journal (`synth:fix-db-tls-fail-closed:r1`), so the next /sdd-batch run resumes from it instead of redoing the debate.

```sdd-batch-design-state
{
  "round": 1,
  "synth": {
    "approach": "Round-1 synthesis. The r1 proposal is the base. The two fixes the adversary asked for are folded in below; the next proposer must confirm them concretely and cite evidence.\n\n1. RESOLVER: one pure function, copied byte-identically to five places: `services/xstockstrat-{ledger,config,identity,notify}/src/dbTls.ts` and `services/xstockstrat-ui/src/lib/dbTls.ts`. This follows the per-service `src/mtls.ts` precedent (`services/xstockstrat-config/src/mtls.ts:11-19`).\n   - Signature: `resolveDbConnection(databaseUrl: string, caCert: string | undefined): { connectionString: string; ssl: false | { rejectUnauthorized: true; ca: string } }`.\n   - (a) An empty or unparseable `DATABASE_URL` (`new URL` throws) raises `db-tls: DATABASE_URL is unset or invalid`. The URL itself is never echoed because it holds credentials. Today's `catch { /* keep original */ }` at `services/xstockstrat-ledger/src/index.ts:33` and `services/xstockstrat-ui/src/app/config-ui/api/audit/route.ts:19-21` is fail-open, and this replaces it.\n   - (b) `searchParams.get('sslmode') === 'disable'` is an exact match. In that case return the URL unchanged with `ssl: false` (FR-3, AC-3, AC-8).\n   - (c) Any other value, including a missing `sslmode` (AC-6) or `disabled`: if `caCert` is empty, throw `db-tls: DATABASE_CA_CERT is required for a TLS database connection (fail-closed); set it or use sslmode=disable`.\n   - (d) Otherwise, delete every TLS-bearing URL parameter that `pg` reads: `sslmode`, `ssl`, `sslcert`, `sslkey`, `sslrootcert`, `uselibpqcompat`. Return `ssl: { rejectUnauthorized: true, ca }`. This closes the adversary's `?ssl=0` / `sslrootcert` override hole (fails.md:601-603, allow-list not deny-one). Stripping is the tentative pick over throwing because it keeps working URLs booting, which matches \"preserve / low rework\". The spec must confirm the `pg` merge precedence by reading `pg/lib/connection-parameters.js` (P-03).\n   - Test table: one row asserting the output `connectionString` has no `ssl*` parameter left, plus rows for `disable` / `disabled` / missing / `require` / `verify-full`.\n\n2. BACKENDS: call the resolver at the top of `main()`, before `waitForSnapshot(90_000)` (ledger `index.ts:23`, identity `:21`, notify `:22`, config equivalent).\n   - A throw reaches the existing `main().catch(... process.exit(1))` (identity `src/index.ts:72`, ledger `:85-88`, config `:79`, notify `:70`). No new exit path is added.\n   - Ledger passes the resolved `ssl` to both `Pool` and the `EventNotifier` `Client` (`index.ts:45,51`). The export cursor keeps inheriting it through `pool.options.ssl` (`grpc/ledgerServiceImpl.ts:338-339`).\n   - Identity and notify each gain a boot `await pool.query('SELECT 1')` before `bindAsync`, mirroring ledger `:47` and config `:44`. It runs inside the existing pool `max` (notify `max` 1 at `src/index.ts:39`), so F-06 holds.\n   - mTLS (`mtls.serverCredentials()`, ledger `index.ts:62`) is untouched.\n\n3. UI AUDIT ROUTE (`route.ts`):\n   - Keep the order 401 \u2192 403 \u2192 `!DATABASE_URL \u2192 { entries: [] }` (`:52-54`).\n   - Then call the resolver before `getPool()`. On a throw: `console.error`, then return 500 with the resolver's operator-safe message, and build no `Pool` (FR-4, AC-4). Cache the pool only after a successful resolve.\n   - The existing `catch` (`:81-85`) logs the full error server-side with `console.error`, including the inbound `x-trace-id` per the standing trace-propagation decision. It returns a generic `database TLS verification failed` / `internal error` body to the client instead of raw `err.message`, because hostname-mismatch text leaks the DB host and SANs.\n   - The existing 500 e2e at `e2e/config-ui/audit.spec.ts:70,75` must still pass (status only).\n\n4. DEPLOY: add `DATABASE_CA_CERT: ${xstockstrat.CA_CERT}` to the `xstockstrat-ui` block of `.do/app.yaml` (after `:658`) and `.do/app.dev.yaml` (after `:660`), copied verbatim from `.do/app.yaml:434-436`. The diff adds those lines only, so `@AC-8 @feature-147` is preserved.\n\n5. GUARD TEST: one repo-level vitest in the UI suite (`vitest.config.ts:20,25`; CI runs from the checkout, `ci.yml:586`). It is explicitly documented as a platform check that lives in the UI suite. It must (a) parse both `.do` specs with a YAML parser, not grep (fails.md:2836), and assert AC-5 for every direct-DB component; (b) hash the five `dbTls.ts` files and fail if they differ (C-18 drift guard). If the `yaml` devDependency is added, update `pnpm-lock`.\n\n6. TESTS for AC-2 and AC-7 on the backends: a fake-Postgres TLS stub answers `'S'` to the SSLRequest and upgrades with a cert from a different throwaway openssl CA (fixture from each `src/__tests__/mtls.test.ts`).\n   - Assert a specific verification error code (`UNABLE_TO_VERIFY_LEAF_SIGNATURE` / `SELF_SIGNED_CERT_IN_CHAIN`).\n   - Add a positive control: the correct CA completes the handshake.\n   - The UI AC-7 uses a mocked `pg` and is recorded in the Deviation Log (fails.md 2026-10-07).\n   - AC-1 and AC-6 boot behaviour: either a cheap child-process test per backend (spawn the entry with `DATABASE_CA_CERT` unset, assert non-zero exit plus stderr text, no config service needed because the check precedes `waitForSnapshot`), or record it as a Deviation. The proposer must pick one.\n\n7. ROLLOUT ORDER (canary):\n   - Before the backend change merges, prove the CA binding, the hostname and the chain on dev. Use `openssl s_client -starttls postgres -CAfile` against the dev host, or ship FR-5 plus the UI route first and confirm `/config-ui/api/audit` returns 200 with verification on.\n   - Then ship the four backends.\n   - Build order: helper and tests \u2192 backends \u2192 UI route and `.do` specs and guard test \u2192 docs.\n\n8. DOCS:\n   - Each of the five services' `CLAUDE.md` env section: the `sslmode=disable` carve-out is DB-only and never touches gRPC mTLS. Identity and notify now need the DB to boot.\n   - `docs/patterns/database.md`.\n   - `services/xstockstrat-identity/docs/operations.md:20`.\n   - `docs/setup/digitalocean.md:555`: add the CA alongside `?sslmode=require`.\n   - Teardown (context-constitution refresh) applies.\n\nTouchpoints: no proto, no migration, no config key (`DATABASE_CA_CERT` stays a boot env var, F-07).",
    "open_objections": [
      {
        "text": "[BLOCKING] The fail-closed rule must cover every TLS-bearing URL parameter, not only sslmode. With only sslmode stripped, a DATABASE_URL carrying ssl=0|false or sslrootcert/sslcert/sslkey/uselibpqcompat could override the explicit {rejectUnauthorized:true, ca} object, so the pool runs fail-open while the resolver reports fail-closed (fails.md:601-603). The synthesis adopts strip-all as tentative. The proposer must (a) commit to strip-all or throw-on-present with a rationale, (b) cite pg's connection-parameters.js merge precedence (P-03, unverified because node_modules is absent in the worktree), and (c) add a test row asserting no ssl* parameter survives in the output connectionString. r1 did not answer this.",
        "blocking": true
      },
      {
        "text": "[BLOCKING][C-18] Nothing enforces that the five dbTls.ts copies (and their test tables) stay byte-identical. A future fix to one copy would leave four fail-open. The synthesis adopts a hash-equality assertion inside the repo-level AC-5 vitest. The proposer must also confirm how jscpd and the .husky pre-commit hook treat the copies: minTokens 100 and test-file ignore are at .jscpd.json:4,23,29, and the strip list likely pushes the resolver past 100 tokens. The 4x mtls.ts copies have no recorded exception, so the precedent is unverified. Record a DRY exception in docs/patterns/dry-guard-rail.md if one is needed.",
        "blocking": true
      },
      {
        "text": "[NON-BLOCKING][C-15/C-08] AC-1, AC-2 and AC-6 are worded as service boot behaviour (exit non-zero before serving gRPC, plus a log line), but the plan tests the resolver and Pool, not main(). Either add one child-process boot test per backend (the check precedes waitForSnapshot, so no config service is needed) or record a Deviation up front (fails.md 2026-10-07).",
        "blocking": false
      },
      {
        "text": "[NON-BLOCKING][C-15] The wrong-CA stub test could pass on any rejection (reset, hostname, stub bug). Assert a specific verification error code and add a positive-control handshake with the correct CA.",
        "blocking": false
      },
      {
        "text": "[NON-BLOCKING] The UI route catch returns raw err.message. After this change, hostname-mismatch errors would leak the DB host and SANs to the browser. Log the full error server-side (with x-trace-id) and return a generic message. Confirm audit.spec.ts:70,75 asserts only status/shape.",
        "blocking": false
      },
      {
        "text": "[NON-BLOCKING] Operational change: identity and notify will crash-loop when the DB is down, where today they boot. State this in the spec and in both services' CLAUDE.md. Today's operator decisions do not explicitly sanction it.",
        "blocking": false
      },
      {
        "text": "[NON-BLOCKING] Rollout canary: 'smoke-test on dev' happens only after all four backends deploy together. Prove the ${xstockstrat.CA_CERT} binding, chain and hostname on dev first (openssl s_client -starttls postgres, or UI route first) so a bad CA cannot take config down and block everything at waitForSnapshot.",
        "blocking": false
      },
      {
        "text": "[NON-BLOCKING] The AC-5 + hash guard lives in the UI vitest suite but checks repo-root files (.do specs, backend dbTls.ts). Document it as a platform check housed there, and add the yaml devDependency with a lockfile update if it is absent from services/xstockstrat-ui/package.json.",
        "blocking": false
      },
      {
        "text": "[NON-BLOCKING] Docs teardown is missing docs/setup/digitalocean.md:555 (?sslmode=require with no CA).",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "AC-1",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "AC-2",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "AC-3",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-4",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "AC-5",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "AC-6",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "AC-7",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "AC-8",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-4 @feature-210 (docs/sdd/business-rules/platform.feature:230,235)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-8 @feature-147",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Shared packages/db-tls workspace package (D-20): it gives one real copy and no drift, but it needs Dockerfile and pnpm-deploy wiring in all five services, D-20 is out of scope, and it contradicts the user's low-rework instruction. Lost to per-service copies plus a hash-equality guard.",
      "Substring/contains match on 'disable': lets sslmode=disabled and similar values opt out (fails.md 2026-08-06). Lost to the exact searchParams.get('sslmode') === 'disable' match.",
      "Keeping today's catch-and-keep-original on an unparseable URL: fail-open (ledger index.ts:33, route.ts:19-21). Lost to throwing with a credential-safe message.",
      "Fail the Next.js boot instead of the audit route: louder, but it takes down all three UI segments for one admin route, and FR-4 asks for route-level failure.",
      "Validate only at pool construction, after waitForSnapshot: smaller diff, but a missing CA would surface only after 90s. Lost to the top-of-main() placement.",
      "Stripping only sslmode (r1 as written): ssl=0 / sslrootcert in the URL could silently override verification. Superseded by strip-all (or throw-on-present, which the next round must decide).",
      "grep-based .do spec check: fails.md:2836. Lost to a YAML-parse vitest.",
      "Leaving identity/notify without a boot probe: a wrong CA (AC-2) would surface only on the first query, not at boot. Lost to SELECT 1 before bindAsync within the existing pool max."
    ],
    "open_risks": [
      "Rollout blast radius: rejectUnauthorized:true now enforces chain and hostname verification against the DO cluster host. A bad, empty or unresolved ${xstockstrat.CA_CERT} binding or a hostname mismatch in an environment takes down ledger, config, identity and notify together. Config's outage then blocks every service at waitForSnapshot. Mitigate with the pre-merge dev canary.",
      "pg merge precedence between URL parameters and the explicit ssl object is assumed, not verified (no node_modules in the worktree). If precedence differs, the strip list may be insufficient or unnecessary.",
      "jscpd and the pre-commit hook may flag five resolver copies once they exceed minTokens 100. Treatment of the existing mtls.ts copies is unconfirmed.",
      "Identity and notify become DB-dependent at boot (crash-loop when the DB is down). This is an operational behaviour change not explicitly sanctioned by the operator decisions.",
      "Strip-all silently discards operator-provided sslrootcert/sslcert in a URL. Throw-on-present would surface that but could break a URL that works today. The choice is still open.",
      "Merge order: notify index.ts and both .do specs overlap with 242, ledger index.ts with 248, route.ts with 241. Sequence 266 after them or rebase.",
      "New identity and ledger tests depend on feature 252 repairing those suites (P-06). They must be shown to actually run in CI, not skip.",
      "The UI AC-7 is asserted via a mocked pg, narrower than the scenario wording. It must go in the Deviation Log.",
      "Trace-id: the UI error log should carry the inbound x-trace-id per the standing operator decision. Boot-time failures have no originating request, so no trace id applies."
    ],
    "constitution_rules_touched": [
      "C-03",
      "C-08",
      "C-11",
      "C-15",
      "C-16",
      "C-18",
      "F-06",
      "F-07",
      "P-02",
      "P-03",
      "P-06"
    ],
    "rationale": "The adversary found no Floor breach. F-06 holds because the boot probe sits inside the existing pool max. F-07 holds because DATABASE_CA_CERT stays a boot env var. The r1 shape fits the user's \"preserve as much as you can while having low rework\" instruction: per-service copies like mtls.ts, reuse of the existing main().catch exit, no change to the UI's unconfigured-URL path, and .do changes that only add lines. Two gaps stay blocking because r1 did not answer them concretely. (1) Stripping only sslmode leaves other pg-parsed ssl* URL parameters able to defeat verification, which repeats the fails.md:601-603 allow-list mistake. (2) Nothing enforces that the five copies stay identical, which C-18 calls drift-prone. The synthesis folds in the adversary's cheapest fixes for both: strip-all with a test row, and a hash guard placed in the AC-5 YAML-parse vitest that is already needed. The next proposer must confirm them with pg-source and jscpd/hook evidence. The remaining items (boot-level test fidelity, error-code assertions, client-safe UI error bodies with x-trace-id logging, a canary rollout, and the digitalocean.md doc) are non-blocking refinements. The feature's own ACs implement the D-32 scope the operator sanctioned. Existing durable rules @AC-4 @feature-210 and @AC-8 @feature-147 are preserved."
  },
  "floor_breaches": []
}
```
