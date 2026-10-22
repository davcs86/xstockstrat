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

## Session 2026-10-22 — sdd-batch design gate (round 2)

- `/sdd-design fix-db-tls-fail-closed` (full debate) is halted at its approval gate after round 2 (gate policy: halt).
  Per the grilling protocol, `design.md` is not written and `status.md` stays `spec-ready`. The debate state below
  lets the next /sdd-batch run resume from round 2.

## Open Threads

- **Approach (round-2 synthesis):** five byte-identical, zero-import, erasable-TS `dbTls.ts` resolvers (four backends
  under `src/`, UI under `src/lib/`), following the per-service `mtls.ts` precedent.
  - `resolveDbConnection` throws on an empty or unparseable `DATABASE_URL` without echoing it. An exact
    `sslmode=disable` returns `ssl: false`. Any other `ssl*` key, or `uselibpqcompat`, throws (throw-on-present
    allow-list). A missing CA throws. Otherwise `sslmode` is stripped and `{ rejectUnauthorized: true, ca }` is returned.
  - The resolver is the first statement of each backend's `main()`, before `waitForSnapshot`, so a throw reaches the
    existing `main().catch → exit(1)`. Identity and notify gain a boot `SELECT 1` inside the existing pool `max` (F-06).
  - The UI audit route resolves after 401 → 403 → `!DATABASE_URL`. On failure it logs the trace id (via
    `HEADER_TRACE_ID`) with `err.code`/`err.message` only, and returns a generic 500 body.
  - `DATABASE_CA_CERT: ${xstockstrat.CA_CERT}` is added to the UI block of both `.do` specs. The change only adds lines.
  - One UI vitest acts as a platform guard: an AC-5 YAML parse, a SHA-256 equality check across the five copies, and a
    static wiring assertion. It needs a `yaml` devDependency and a lockfile update.
  - A child-process boot test per backend covers AC-1/AC-6. Config gets an end-to-end AC-2 test through `main()`
    against a wrong-CA TLS stub. Ledger, identity and notify get Pool-level stub tests plus the wiring assertion.
  - A scoped DRY exception goes in `dry-guard-rail.md`, and the canary is re-aimed at the UI route.
  - No proto, no migration, no config key (F-07).
  - r1's two blocking objections (the ssl* override hole and the C-18 drift) are closed.
- **Strongest open objection (BLOCKING, C-15):**
  - `.github/workflows/ci.yml:39-66` has no `.do/**` paths-filter entry, so the AC-5 guard never runs on a `.do`-only
    PR, which is exactly the kind of PR most likely to break it.
  - Adopted fix: add `'.do/**'` to the `xstockstrat-ui` filter (`ci.yml:62`), plus a negative fixture row.
  - Second BLOCKING objection (C-15/P-03): AC-2 does not prove per-service wiring. The config `main()` AC-2 test and
    the static wiring assertion are adopted.
  - Both stay open until the next proposer confirms them with path:line evidence.
  - Non-blocking: the mTLS/DB check order (record the reorder or throw one combined error), the erasable-syntax
    constraint, safe log fields, the canary target, and the boot-probe sign-off scope.
- **Floor status:** no Floor breaches. F-06 holds because the probe stays inside the pool `max`. F-07 holds because
  `DATABASE_CA_CERT` stays a boot env var.
- **Uncovered @AC changes:** none. AC-1, AC-2, AC-4, AC-6 and AC-7 are CHANGE, and AC-5 is EXTEND, all covered by the
  operator's D-32 scope decision. AC-3 and AC-8 are PRESERVE, as are `@AC-4 @feature-210` and `@AC-8 @feature-147`.
- **Operator items for the spec gate:**
  - Sign-off on the new identity/notify crash-loop when the DB is down.
  - Deviation Log entries for the narrowed AC-2 (ledger/identity/notify) and the mocked-pg UI AC-7.
  - Confirming pg merge precedence (P-03).
  - The pre-merge dev canary for the `${xstockstrat.CA_CERT}` and `DATABASE_URL` formats.
  - Rebase after 242/248/241.

```sdd-batch-design-state
{
  "round": 2,
  "synth": {
    "approach": "Round-2 synthesis. The r2 proposal is the base. It concretely closes both r1 blocking objections. The adversary's two new blocking fixes are folded in below as the adopted shape, but they stay open until the next proposer confirms them with evidence.\n\n1. RESOLVER (r2 as written, adopted).\n   - Signature: `resolveDbConnection(databaseUrl, caCert) → { connectionString, ssl: false | { rejectUnauthorized: true, ca } }`.\n   - Five byte-identical copies: `services/xstockstrat-{ledger,config,identity,notify}/src/dbTls.ts` and `services/xstockstrat-ui/src/lib/dbTls.ts`. This follows the per-service `src/mtls.ts` precedent (`services/xstockstrat-config/src/mtls.ts:16`).\n   - Rules, in order:\n     - (a) An empty `DATABASE_URL`, or one where `new URL` throws, raises `db-tls: DATABASE_URL is unset or invalid`. The URL is never echoed.\n     - (b) An exact `searchParams.get('sslmode') === 'disable'` returns the URL unchanged with `ssl: false`.\n     - (c) **Throw-on-present allow-list.** Any URL key starting with `ssl` other than `sslmode`, or `uselibpqcompat`, throws. The error names the key, never its value.\n     - (d) An empty `caCert` throws `db-tls: DATABASE_CA_CERT is required for a TLS database connection (fail-closed); set it or use sslmode=disable`.\n     - (e) Otherwise, delete `sslmode` and return `{ rejectUnauthorized: true, ca }`.\n   - Pinned file constraints (from the adversary, non-blocking):\n     - Erasable TypeScript only (no enums, no parameter properties), because ledger and identity run under `--experimental-strip-types` (`services/xstockstrat-ledger/package.json:13`).\n     - Zero imports.\n     - Valid under both CJS `tsc` and the Next bundler.\n   - **P-03 gate.** `/sdd-spec` reads `node_modules/pg/lib/connection-parameters.js` and `pg-connection-string` after `pnpm install` and records the merge precedence in `context.md`. The design is safe under either precedence, because no `ssl*` key survives in the URL.\n   - Test-table rows, identical in every `src/__tests__/dbTls.test.ts`:\n     - `require`, missing `sslmode` and `verify-full`, each with a CA: the output has no `ssl*` or `uselibpqcompat` key.\n     - `?ssl=0`, `?sslrootcert=/x` and `?uselibpqcompat=true`: each throws.\n     - `disabled` without a CA: throws.\n     - `disable`: returns `ssl: false`.\n     - A malformed URL: throws, and the message does not contain the password.\n\n2. BACKEND WIRING. The resolver is the first statement of `main()`, before `waitForSnapshot` (ledger `index.ts:23`).\n   - A throw reaches the existing `main().catch → exit(1)` (ledger `:85-88`, config `:79`, identity `:72`, notify `:70`).\n   - Ledger passes the resolved `ssl` to both `Pool` and the `EventNotifier` client (`index.ts:40-46,51`). The export cursor inherits it (`ledgerServiceImpl.ts:338-339`).\n   - Config replaces its inline `databaseUrl.includes('sslmode=disable')` (`services/xstockstrat-config/src/index.ts:25`) and `rejectUnauthorized: !!caCert` (`:40`).\n   - Identity and notify add a boot `SELECT 1` before `bindAsync`, inside the existing pool `max` (F-06).\n   - **The mTLS/DB check order must be decided.** Today ledger, identity and notify hit the `MTLS_*` throw first, in the `ConfigWatcher` constructor (`services/xstockstrat-ledger/src/services/configWatcher.ts:33`, constructed at ledger `index.ts:22`). Either record the reorder in `context.md` as deliberate, or check both env sets up front and throw one combined error. Both stay fail-closed, so `@AC-4 @feature-210` holds either way.\n\n3. AC-2 COVERAGE (adopted from the adversary, still to be confirmed):\n   - **Config:** AC-2 is tested end to end through `main()`, because config has no `waitForSnapshot` (verified: no match in `services/xstockstrat-config/src/index.ts`). Spawn it with `CONFIG_SECRETS_ENCRYPTION_KEY` set, `DATABASE_CA_CERT` set to a wrong CA, and the fake-Postgres TLS stub as the DB. Assert a non-zero exit plus a specific verification error, with a positive control using the correct CA. Drop the config Deviation.\n   - **Ledger, identity and notify:** keep the Pool-level stub test, which asserts `UNABLE_TO_VERIFY_LEAF_SIGNATURE` or `SELF_SIGNED_CERT_IN_CHAIN` and has a positive control. Add a static wiring assertion beside the hash guard:\n     - No `rejectUnauthorized` and no `includes('sslmode` anywhere outside `dbTls.ts` in the five services' `src/`.\n     - Every backend `index.ts` and the UI `route.ts` import `resolveDbConnection`.\n   - The narrowed AC-2 for these three services goes in the Deviation Log.\n\n4. BOOT TESTS for AC-1 and AC-6, one child-process test per backend.\n   - Ledger and identity spawn via `--experimental-strip-types src/index.ts`. Config and notify spawn via `dist/index.js` after `tsc`.\n   - Each runs with `DATABASE_CA_CERT` unset and a `sslmode=require` URL, and asserts a non-zero exit **and** stderr containing `DATABASE_CA_CERT`.\n   - If the combined-check option in item 2 is chosen, `MTLS_*` must be set in the env so the stderr assertion stays specific.\n\n5. CI AND GUARDS (C-15/C-18). There is one UI vitest file, documented as a platform check housed in the UI suite. It does three things:\n   - (a) Parses both `.do` specs with a YAML parser and asserts AC-5 for every direct-DB component. `yaml` is not in `services/xstockstrat-ui/package.json` today, so add it as a devDependency and update `pnpm-lock.yaml`.\n   - (b) SHA-256-compares the five `dbTls.ts` files.\n   - (c) Runs the static wiring assertion from item 3.\n   - **Path-filter fix (blocking).** Add `'.do/**'` to the `xstockstrat-ui` paths filter (`.github/workflows/ci.yml:62`). Verified: the filter block at `ci.yml:39-66` has no `.do` entry.\n     - The `node-test` matrix runs all five Node services whenever any of their filters matches (`ci.yml:537-564`).\n     - So a backend-only `dbTls.ts` edit already triggers the UI vitest. A `.do`-only PR is the only gap.\n   - Add a test row (fixture YAML) proving the AC-5 check fails when the UI `DATABASE_CA_CERT` binding is removed.\n   - DRY: add one exception entry to `docs/patterns/dry-guard-rail.md`. It names exactly the five `dbTls.ts` files and the four `mtls.ts` copies, and names the hash guard as the enforcement. It must not read as general permission to copy security code.\n   - jscpd blocks only within `services/xstockstrat-ui/src` (`.husky/pre-commit:10-13`). The backend copies fall under the report-only scan (`.husky/pre-commit:18`).\n\n6. UI ROUTE (`services/xstockstrat-ui/src/app/config-ui/api/audit/route.ts`).\n   - The order stays 401 → 403 → `!DATABASE_URL → { entries: [] }` → resolver → pool. The pool is cached only after a successful resolve.\n   - On failure, `console.error` logs the inbound trace id, read via `HEADER_TRACE_ID` (`services/xstockstrat-ui/src/lib/headers.ts:7`, not a raw literal), plus `err.code` and `err.message` only, never the whole pg error object.\n   - The client gets a generic 500 body. `e2e/config-ui/audit.spec.ts:70,75` still passes.\n   - The UI AC-7 is tested with a mocked `pg` and goes in the Deviation Log.\n\n7. DEPLOY. Add `DATABASE_CA_CERT: ${xstockstrat.CA_CERT}`, copied verbatim from `.do/app.yaml:434-436`, to the UI block of `.do/app.yaml` (after `:658`) and `.do/app.dev.yaml` (after `:660`). The change only adds lines.\n\n8. CANARY (re-aimed, from the adversary).\n   - The UI route is the only component whose deployed behaviour changes. The four backends already evaluate `rejectUnauthorized: !!caCert` to true, unless the `${xstockstrat.CA_CERT}` binding expands to an empty string.\n   - Ship a value-free `log.info('db-tls: verifying server cert against DATABASE_CA_CERT')`.\n   - Before the backend change merges, confirm on running dev backends (or with `openssl s_client -starttls postgres -CAfile`) that the CA binding is non-empty and verifies.\n   - Then ship the UI route and the `.do` change, then the backends.\n\n9. DOCS and teardown:\n   - The five services' `CLAUDE.md` env sections: the `sslmode=disable` carve-out is DB-only, and identity and notify now need the DB to boot.\n   - `docs/patterns/database.md`.\n   - `services/xstockstrat-identity/docs/operations.md:20`.\n   - `docs/setup/digitalocean.md:555`.\n   - The context-constitution refresh (fails.md:670).\n\nTouchpoints: no proto, no migration, no config key (`DATABASE_CA_CERT` stays a boot env var, F-07). In addition: `.github/workflows/ci.yml` (one filter line) and the UI `package.json` plus `pnpm-lock.yaml` (the `yaml` devDependency).",
    "open_objections": [
      {
        "text": "[BLOCKING][C-15] The AC-5 YAML-parse guard (and hash/wiring guard) never runs on a PR that changes only .do/** — verified: ci.yml:39-66 paths filters have no .do entry, and node-test is gated on service/proto/node-shared/ci filters (ci.yml:537-548). Synthesis adopts adding '.do/**' to the xstockstrat-ui filter in the same PR plus a test row showing the AC-5 check fails when the UI DATABASE_CA_CERT binding is removed. The r2 proposal does not address this; proposer must commit to the filter edit with path:line.",
        "blocking": true
      },
      {
        "text": "[BLOCKING][C-15/P-03] AC-2 is only proven for pg's behaviour given {rejectUnauthorized:true, ca}, not that each service passes the resolver's output to every consumer (ledger Pool index.ts:40-46 and EventNotifier :51). An inline `rejectUnauthorized: !!caCert` left in or reintroduced would pass every proposed test. The config Deviation is unjustified: config has no waitForSnapshot (verified), so AC-2 can be tested through main() with the wrong-CA TLS stub. Synthesis adopts: (a) config AC-2 via main() spawn, Deviation dropped; (b) a static wiring assertion (no `rejectUnauthorized` and no `includes('sslmode` outside dbTls.ts in the five services' src/; every index.ts and route.ts imports resolveDbConnection). Proposer must confirm both concretely.",
        "blocking": true
      },
      {
        "text": "[NON-BLOCKING][C-16 @AC-4 @feature-210] Putting the resolver first in main() means the DB-TLS error is now reported before the MTLS_* throw in the ConfigWatcher constructor (configWatcher.ts:33, ledger index.ts:22). With both vars missing, the operator sees only the DB error on that boot. Either record the reorder as deliberate in context.md, or check both up front and throw one combined error. Proposer must pick.",
        "blocking": false
      },
      {
        "text": "[NON-BLOCKING][C-18] The byte-identical dbTls.ts must use only erasable syntax (ledger/identity run under --experimental-strip-types, package.json:13), have zero imports, and work under both CJS tsc and the Next bundler. The dry-guard-rail.md exception must name these specific files and the hash guard, not grant a general copy licence.",
        "blocking": false
      },
      {
        "text": "[NON-BLOCKING] UI route log: read the trace id via HEADER_TRACE_ID (headers.ts:7), not a raw 'x-trace-id' literal (DRY guard rail). Log only err.code and err.message, never the whole pg error object.",
        "blocking": false
      },
      {
        "text": "[NON-BLOCKING] Canary is aimed at the wrong component. The deployed backends already verify unless ${xstockstrat.CA_CERT} expands to an empty string, and the UI route is the real behaviour change. Add a value-free 'db-tls: verifying server cert' log line and check it on dev backends before the merge.",
        "blocking": false
      },
      {
        "text": "[NON-BLOCKING] At the spec gate, present the identity/notify boot-probe sign-off as covering only runtime behaviour (FR-2 exit-at-boot). If it is refused, the Deviation covers only FR-2's exit-at-boot clause for those two services, not AC-2 as a whole.",
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
      "Shared workspace package (packages/node-db-tls): one source and no hash guard, but the UI Dockerfile copies only proto gen and the UI tree (Dockerfile:11-19), the backends use pnpm deploy, and the change would touch five Dockerfiles plus docker-build.md for a ~20-line function. D-20 is out of scope. Lost to five copies plus a hash guard.",
      "Strip every ssl* URL key instead of throwing: it silently discards operator intent such as sslrootcert while reporting that verification is on (fails.md:600-603). Lost to throw-on-present. No live URL carries such keys (.do/app.yaml:433,480,527,585,658; docker-compose.yml:27).",
      "Strip only sslmode (r1): ssl=0, sslrootcert and similar could override verification. Superseded.",
      "Substring match on 'disable': lets sslmode=disabled opt out. Lost to an exact searchParams match.",
      "Keep catch-and-keep-original on an unparseable URL: fail-open (ledger index.ts:33, route.ts:19-21). Lost to a throw with a credential-safe message.",
      "Put the AC-5 and hash checks in scripts/workflow-tests/*.test.mjs (node --test): context-map is gated on its own filter (ci.yml:713-715), so it needs the same .do fix, and it has no YAML parser. No better than the UI suite.",
      "Run the DB probe before waitForSnapshot in ledger/identity/notify so AC-2 can be tested via main(): changes boot order and holds a DB connection through the 90s config wait. Lost to the static wiring assertion. Config gets a real main() test because it has no snapshot wait.",
      "Keep the config AC-2 Deviation: unjustified, because config's main() has no waitForSnapshot and can be spawned against the TLS stub.",
      "grep-based .do spec check: fails.md:2836. Lost to a YAML-parse vitest.",
      "Fail the Next.js boot instead of the audit route: takes down all three UI segments for one admin route. FR-4 asks for route-level failure.",
      "Validate after waitForSnapshot: a missing CA would surface only after 90s.",
      "Leave identity/notify without a boot probe: a wrong CA would surface only on the first query."
    ],
    "open_risks": [
      "If the ${xstockstrat.CA_CERT} binding expands to an empty string in any environment, the backends are silently unverified today, and 266 takes ledger, config, identity and notify down together. Config down then blocks everything at waitForSnapshot. Mitigation is the pre-merge dev canary (value-free verification log plus openssl s_client).",
      "The UI route is the only deployed component whose behaviour definitely changes (it is newly verifying). A hostname or SAN mismatch there breaks /config-ui/api/audit.",
      "pg URL-versus-ssl merge precedence is unverified (no node_modules). The design is safe under either order, but the spec must cite the source.",
      "The DO ${xstockstrat.DATABASE_URL} expansion is assumed to carry only sslmode=require. If it carries another ssl* key, throw-on-present crash-loops the backends. The dev canary must confirm the format.",
      "Identity and notify crash-loop when the DB is down (new operational behaviour). This needs explicit operator sign-off at the spec gate.",
      "Byte-identical copies under three module and runtime regimes (strip-types, CJS tsc, Next bundler) may force awkward syntax. The hash guard catches drift but not a copy that fails to build in one service.",
      "Merge-order overlap: notify index.ts and both .do specs with 242, ledger index.ts with 248, route.ts with 241. Rebase after them. ci.yml filter edits may also conflict with peer features.",
      "New identity and ledger tests depend on feature 252 making those suites run (P-06).",
      "The narrowed AC-2 (ledger/identity/notify at Pool level plus static wiring) and the UI AC-7 (mocked pg) must go in the Deviation Log."
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
    "rationale": "Both r1 blocking objections are closed.\n\n- The allow-list objection is answered with throw-on-present, an explicit P-03 spec gate, and test rows proving no ssl* key survives. This follows fails.md:600-603.\n- The C-18 drift objection is answered with the hash guard, a jscpd and hook analysis that cites `.husky/pre-commit:10-18` and `.jscpd.json`, and a scoped dry-guard-rail exception.\n- I checked that the hash guard actually runs. The node-test matrix runs all five Node services whenever any Node service filter matches (`ci.yml:537-564`), so a backend-only `dbTls.ts` edit still runs the UI vitest.\n\nThe adversary raised two new blocking gaps. I verified both against the code, and the r2 proposal does not answer either.\n\n1. **The `.do` changes are unguarded.** The CI paths filter (`ci.yml:39-66`) has no `.do/**` entry, so the AC-5 guard skips exactly the PRs most likely to break it.\n2. **AC-2 does not prove per-service wiring.** No test catches a service that keeps an inline `!!caCert`. The config Deviation is also unnecessary, since config's `main()` has no `waitForSnapshot`.\n\nThe cheapest fixes for both are folded into the approach: a one-line filter addition with a negative test row, a config `main()` AC-2 test, and a static wiring assertion. Both stay open until the next proposer confirms them concretely.\n\nThere are no Floor breaches:\n- F-06 holds because the boot probe runs inside the existing pool `max`.\n- F-07 holds because `DATABASE_CA_CERT` stays a boot env var.\n\nThe remaining items are non-blocking refinements: the mTLS/DB error-order decision, erasable-syntax and zero-import constraints, the trace-id header constant, safe log fields, and a re-aimed canary. The feature's ACs implement the D-32 scope the operator sanctioned. `@AC-4 @feature-210` and `@AC-8 @feature-147` are preserved. Per the standing decision, the UI failure log carries the inbound trace id. Boot failures have no originating request, so they carry none."
  },
  "floor_breaches": []
}
```

## Session 2026-10-22 — sdd-design

- Phase 0 Recon: recon.md was written in an earlier session and reused as-is. Services: ledger, config, identity,
  notify, ui. Key reuse patterns: the per-service `mtls.ts` fail-closed throw, and the existing `main().catch → exit(1)`.
- Phase 1 Grilling: 2 rounds (full). The operator approved at the design gate on 2026-10-22 ("APPROVED as synthesized,
  including both folded-in fixes").
  - Chosen approach: five byte-identical `dbTls.ts` resolvers.
    - Throw-on-present `ssl*` allow-list; an exact `sslmode=disable` is the only opt-out; a missing CA throws.
    - The resolver runs first in `main()`. Identity and notify get a boot probe.
    - The UI audit route fails at the route level with a generic 500.
    - `.do` adds a UI `DATABASE_CA_CERT`.
    - One UI vitest guard covers the AC-5 YAML parse, the hash check and the static wiring check, with `.do/**` added
      to the UI CI filter.
  - Rejected: a shared workspace package, strip-instead-of-throw, a substring parse, failing the Next.js boot, and
    workflow-tests or grep guards.
- Both round-2 blocking objections are resolved by the operator's approval of the folded-in fixes:
  - the `'.do/**'` UI filter plus a negative AC-5 fixture row;
  - the config AC-2 test through `main()` plus the static wiring assertion, covering the ledger Pool and the
    EventNotifier.
- Constitution rules touched: C-03, C-08, C-11, C-15, C-16, C-18, F-06, F-07, P-02, P-03, P-06. Floor breaches: none
  (F-06 and F-07 honored).
- C-16: AC-1, 2, 4, 6 and 7 are CHANGE and AC-5 is EXTEND, all covered by the D-32 scope decision and the 2026-10-22
  gate approval. AC-3, AC-8, `@AC-4 @feature-210` and `@AC-8 @feature-147` are PRESERVE.
- Ledger: no new line. The traps applied here (parse not grep, allow-list fail-closed, Deviation Log for a narrowed
  assertion) are already recorded in `fails.md`.
- Status: spec-ready → design-approved.

### Decisions

- The design in `design.md` § Chosen Approach (items 1–9) is binding for `/sdd-spec`.
- The adversary's non-blocking refinements are adopted:
  - erasable TypeScript only, with zero imports;
  - the trace id is read via `HEADER_TRACE_ID`, and only `err.code`/`err.message` are logged;
  - the canary is re-aimed at the UI route, with a value-free verification log line.

### Open Threads

- [ ] P-03: read the pg / `pg-connection-string` URL-versus-`ssl` merge precedence after `pnpm install` and record it
  here. Target: `/sdd-spec` (resolver step).
- [ ] mTLS/DB check order: record the reorder as deliberate, or throw one combined error. Target: `/sdd-spec`
  (backend wiring step).
- [ ] Operator sign-off on the identity/notify crash-loop when the DB is down. It covers only FR-2's exit-at-boot
  clause. Target: the `/sdd-spec` gate.
- [ ] Pre-merge dev canary: confirm `${xstockstrat.CA_CERT}` is non-empty and verifies, and that
  `${xstockstrat.DATABASE_URL}` carries only `sslmode=require`. Target: the rollout step, before the backend PR merges.
- [ ] UI route SAN/hostname verification against the managed DB. Target: the UI route step and canary.
- [ ] Byte-identical copy must build under strip-types, CJS `tsc` and the Next bundler. Target: the resolver step
  (build all five).
- [ ] Deviation Log: the narrowed AC-2 (ledger, identity and notify at Pool level plus the wiring check) and the
  mocked-pg UI AC-7. Target: the test steps.
- [ ] P-06: the new identity and ledger tests depend on 252. Prove that they execute. Target: the test steps.
- [ ] Merge order: rebase after 242, 248 and 241, and watch for `ci.yml` filter conflicts with peers. Target: the
  integration PR.
