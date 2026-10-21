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
