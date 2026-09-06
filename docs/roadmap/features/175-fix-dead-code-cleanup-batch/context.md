# Context Log: fix-dead-code-cleanup-batch

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-09-04 (/sdd-triage --from-report)

- Consolidated Cleanup batch from `docs/reports/2026-09-04-comment-audit-triage.md` items 5, 6, 7
  (comment-audit pass). No GitHub issue — Issues disabled on this repo; the dated report is the
  routable artifact. Batched per operator instruction ("one consolidated Cleanup feature/PR").
- Severity: SEV-3 (dead code / stale type pin; no financial or behavioral path).
- Routed to SDD path (Track C) — the report's "Cleanup" class is a real code change, so it takes the
  SEV-3 → Track C SDD route rather than riding an unrelated PR.
- Created: feature.md, product-spec.md, acceptance.feature (regression scenarios), context.md, status.md.

### Triage verification (grep evidence)

- **Item 5 — `getEnvBool` dead (Go):** confirmed defined at trading `config.go:60`, portfolio
  `config.go:233` (+ `var _ = getEnvBool` suppressor `:245`), marketdata `config.go:247`. Only
  non-suppressor references are each service's `config_test.go` (a test that exists solely to cover the
  dead function). Removal takes the function + suppressor + that test. Already in the root findings log.
- **Item 6 — `propagation.ts` dead (Node):** confirmed **no importers** for ledger, notify, AND config
  (config's only `propagation` mention is a *comment* in `grpc/authz.ts`, not an import).
  **Report correction:** the report says the dead copies are ledger/notify/config and identity's is
  "live via `ledgerAudit`". Evidence contradicts the identity claim — identity's `propagationStore` /
  `extractFromHttpRequest` have **zero importers**, and `ledgerAudit.ts` reads `x-trace-id` from gRPC
  call metadata via its own `PROPAGATED_HEADERS` const (it does NOT import `propagation.ts`). Root
  `CLAUDE.md` (Header Propagation Convention) independently says the leaf services *including identity*
  have an unused `propagation.ts`. So all four are unused. Decision deferred to the design gate: delete
  identity's too (evidence-consistent) or document intentional retention — NOT silently expanded here.
- **Item 7 — `@types/node ^20` vs Node 24:** confirmed all four Node services pin
  `"@types/node": "^20.12.12"`; runtime is Node 24. Bump to `^24` + regenerate lockfiles.

### Routing

- Recommended design depth: **quick** → `/sdd-design fix-dead-code-cleanup-batch quick`.
  Rationale: base case (SEV-3, multi-service, no proto/migration/config, clear root cause) would be a
  `skip`, BUT triage surfaced a source-report inaccuracy on item 6 (identity) and a test-coupling on
  item 5 (removing the function removes its test). One adversarial round locks the deletion set
  (3 vs 4 propagation.ts files) and the getEnvBool test removal before `/sdd-spec`, avoiding rework.
  `/sdd-spec` must re-run the import/symbol greps to re-confirm before any deletion.
- Teardown note: `getEnvBool` / `propagation.ts` are referenced in several
  `docs/context-constitution-findings.md` files (root + per-module). Removing the code obliges a
  context-constitution refresh in the SAME PR (root `CLAUDE.md` Teardown rule).
- Development branch: `feature/fix-dead-code-cleanup-batch`.

---

## Session 2026-09-04 — sdd-review product-spec

- Product spec approved (PASS, 0 blockers/0 warnings). Status: draft → spec-ready.
- Added FR-1 (remove getEnvBool ×3 Go) / FR-2 (delete propagation.ts ×3 Node + identity decision) /
  FR-3 (@types/node ^24 ×4 Node); `## Consumer Surface(s)` None — internal/platform-only; tagged
  @AC-1 @FR-1 @item-5 / @AC-2 @FR-2 @item-6 / @AC-3 @FR-3 @item-7.
- Reviewer confirmed the report correction: all FOUR propagation.ts copies (incl. identity) are
  unused; ledgerAudit.ts uses its own PROPAGATED_HEADERS, does not import propagation.ts. Batching
  the three cleanups is acceptable (independent, per-item testable). Identity delete-vs-document fork
  is a genuine binary decision to settle before /sdd-spec.
- NOTE for execute: reconcile the getEnvBool-dead references in
  services/xstockstrat-{trading,marketdata,portfolio}/docs/context-constitution-findings.md in the
  same PR (teardown).
- Overlap: CLEAN (all 175 files disjoint from 172/173/174/084).

---

## Session 2026-09-04 — sdd-design (in progress)

- Phase 0 Recon: wrote recon.md. All facts freshly re-verified. Key: all FOUR propagation.ts dead
  incl. identity (ledgerAudit.ts:13 uses its own PROPAGATED_HEADERS over gRPC metadata, never imports
  the module) — confirms the item-6 report correction. Only portfolio orphans a strconv import on
  getEnvBool removal. config_test.go is a SHARED file in all three Go services (not dedicated) — must
  delete the TestGetEnvBool FUNCTION, never the file. Zero @AC-* impacted (C-16 clear).
- Phase 1 Grilling (quick mode mandated 1 round; operator opted into more):
  - R1: proposer delete-all-four + toolchain-as-RED. Adversary NEEDS WORK (no Floor breach): the
    green build proves "still compiles" but NOT the absence clause (C-15/P-06) — needs a scoped
    RED→GREEN deletion assertion; ledger/identity strip-types run is a fails-021 vacuous-green risk;
    teardown missed header-propagation.md:123 (ledger propagation.ts = the doc's "Reference store");
    config_test.go shared-file hazard (CONFIRMED by grep); ui also pins @types/node ^20 (out of the
    then-scope). All 6 objections accepted.
  - **Operator decision (R1 gate): run another round; and BUMP ui too (whole-workspace @types/node).**
  - R2: refined ordering = bump-and-verify-BEFORE-delete (bump 5 pkg → pnpm install → pnpm why →
    pre-deletion tsc/next build → delete → re-verify). ui's only type gate is `next build`
    (next.config.js has no ignoreBuildErrors); ui tsconfig include covers e2e Playwright specs.
    Adversary NEEDS WORK: AC-3 "typechecks" has NO CI gate for ledger/identity (their only Node CI
    step is strip-types, which type-checks nothing — fails-021 live) → need an explicit `pnpm build`
    (tsc) gate for those two; C-15 locus correction — the covering RED assertion must live as a NAMED
    STEP in implementation-spec.md (`**Covers**: AC-N`, re-run at execute), NOT merely in context.md;
    ui widened but acceptance/FR not updated (C-15 uncovered-FR + P-03 divergence) → reconcile BEFORE
    approval; ui blast radius is e2e-inclusive; construct-scope the absence greps (fails-110); record
    the C-16 non-promotion in design.md.
  - **Operator decision (R2 gate): keep ui IN (hardened); run another round.**
  - Scope reconciliation applied NOW (operator-authorized, pre-approval, per the C-15/P-03 objection):
    acceptance.feature gains @AC-4 (ui, `next build` gate across the full tsconfig include incl e2e);
    product-spec FR-3 → five services with the leaf-tsc-vs-ui-next-build split + the sibling-dep
    BOUNCE rule (an in-file mechanical type fix is in scope; needing @types/react/next/@types/pg or a
    refactor bounces to the operator); Affected Services + Out of Scope updated (incl. explicit
    no-permanent-CI-guard line). Identity propagation.ts delete recorded as resolved (mechanism
    mismatch: HTTP IncomingMessage scaffolding vs ledgerAudit's gRPC Metadata + own const; C-03 intact).
  - R3: locked the exact verification mechanics (C-15 `**Covers**` blocks with construct-scoped greps;
    ledger/identity `pnpm build` gate; ui `next build`; fails-082 landed-diff gate). Adversary NEEDS
    WORK on wording only (drop the redundant ui `tsc --noEmit` gate — fails-155; scope `pnpm why` to the
    five DIRECT deps; Node-only pre-delete pass; explicit Go `-cover` ≥40; honest RED-locus for the
    version-bump ACs). **Operator (R3 gate): run another round.**
  - R4 (terminal): APPROVE-READY — adversary found no vacuous-green, no false-RED, no Floor breach; sole
    residual = recon Teardown Targets omitted `docs/patterns/header-propagation.md:123` (the Node
    "Reference store" cite + snippet :126-151) → **fixed in recon.md** (now 6 teardown docs; 23-path gate
    intact). Independent verification this round OVERTURNED the per-service-lockfile concern: all four
    leaf Dockerfiles copy the **root** `pnpm-lock.yaml` + `--frozen-lockfile` (`Dockerfile:13,17`), so
    `services/{config,identity,ledger,notify}/pnpm-lock.yaml` are **vestigial**, deliberately untouched,
    excluded from the gate (do NOT run a per-service install). **Operator (R4 gate): approve.**
- Wrote design.md (chosen approach + locked A→E execution + 23-path landed-diff gate + rejected
  alternatives + open risks + C-16 non-promotion). Status: spec-ready → **design-approved**.
- Reconciled during design (operator-authorized, pre-approval): acceptance.feature (@AC-4), product-spec
  (FR-3 five services + bounce rule), recon.md (header-propagation.md teardown target). Two duplicate
  commits (e1906a7 + b117fe9) were this session's own interrupted-then-resumed executions — no competing
  session (verified via list_sessions); context.md de-duplicated (commit f2efd4f).
- Open threads (→ /sdd-spec): FR-3 sibling-dep bounce; vestigial per-service locks untouched; re-grep all
  deletion targets + confirm the exact @types/node line / root lockfile path / config-only eslint override
  at spec; narrow teardown (leave the LIVE Go `header-propagation.md:50` reference).

---

## Session 2026-09-04 — sdd-spec

- Generated implementation-spec.md with 7 steps. Status: design-approved → implementation-ready.
- Structure preserves the design's A→E order via 3 service+test pairs plus a docs teardown step:
  Step 1 (bump 5 pkg + root lock) → Step 2 (pre-delete Node/ui build gate, Covers AC-3/AC-4) →
  Step 3 (Go delete) → Step 4 (Go re-verify, Covers AC-1) → Step 5 (Node delete + eslint prune) →
  Step 6 (Node re-verify tsc build, Covers AC-2) → Step 7 (6 teardown docs + 23-path landed-diff gate).
- All four @AC-* covered (C-15): AC-3/AC-4 → Step 2; AC-1 → Step 4; AC-2 → Step 6. RED-locus honored:
  version-string RED for AC-3/AC-4, construct-presence RED (grep/git ls-files) for AC-1/AC-2; build is
  a green-before-and-after guard, never a manufactured build-RED.
- Key codebase findings (all fresh-grepped this session):
  - getEnvBool defs at trading config.go:60, portfolio :233 (+ suppressor :245 + strconv import :9,
    used only at :238), marketdata :247. Zero production callers. config_test.go is SHARED in all three
    (trading 7 / portfolio 9 / marketdata 15 test funcs) — delete only the TestGetEnvBool function
    (:53 / :133 / :130), never the file. strconv orphan is portfolio-only.
  - All four propagation.ts DEAD — importer grep returns only the export sites inside each file; no
    import anywhere incl. identity (ledgerAudit.ts uses its own PROPAGATED_HEADERS over gRPC Metadata).
    config/.eslintrc.json:31 is the only leaf eslintrc referencing propagation.ts (keep authz.ts).
  - @types/node: ledger pkg:37 / notify:38 / config:35 / identity:37 all "^20.12.12"; ui:63 "^20"
    (note the differing pin). Root pnpm-lock.yaml is the workspace lock; the four services/*/pnpm-lock.yaml
    are vestigial and deliberately excluded from the 23-path gate (root install only).
  - Node type gate = each leaf's `build` script ("tsc", pkg:8), NOT its strip-types `test` runner
    (ledger/identity type-check nothing — fails-021/074). ui gate = `next build` only (fails-155).
  - Six teardown docs confirmed: root findings :18/:33/:34, root CLAUDE.md:335, header-propagation.md:123
    (Node "Reference store" cite + snippet :125-145; LIVE Go ref at :50 left untouched), and the three
    per-service Go findings pointers (trading:5 / portfolio:7 / marketdata:5).
- Consumer surface None (C-14, internal/platform-only) and C-16 non-promotion both restated in the spec
  Execution Summary as recorded decisions.

---

## Session 2026-09-04T18:52:00Z — sdd-review impl-spec (advisory)

- Result: **PASS WITH WARNINGS** — 0 failures, 4 warnings (advisory — did not block). Every code citation verified exact (getEnvBool ×3, propagation.ts ×4, @types/node ×5, config_test.go function loci, eslintrc:31, identity ledgerAudit, stale findings rows); no Floor risk.
- Carried into execution:
  - Steps 1/3/7 touch >5 files — [x] no action (inherent to a workspace-wide bump / 3-service parallel deletion / 6-doc teardown; not splittable).
  - Step 2: no coverage threshold stated — [x] no action (a devDep type-pin changes no runtime source; discharge is compile-green via tsc/next build, not coverage; Node-leaf coverage discharge is in Step 6).
  - Step 7: header-propagation.md:123 "Reference store" line re-home — [ ] unaddressed refinement: also NEUTRALIZE the snippet BODY at :125-145 (it shows the gRPC extractFromMetadata form; a pre-existing doc/code drift), not only the "Reference store:" pointer line. Leave the LIVE Go reference at :50 untouched.
- Overlap findings: CLEAN — no proto/migration/config possible; all source files disjoint. Soft, disjoint-region findings-doc overlaps only: with 172 on portfolio findings, with 174 on root findings — rebase-only, non-blocking.

---

## Session 2026-09-04 — sdd-execute (sequential; stacked PR #5 of 5, base feature/fix-agent-trading-mode-otel-attr)

Dead-code cleanup batch + @types/node type-pin. Stacked on 171 (final of the sequence). The 23-path landed-diff gate is run against the PR base (171's branch), NOT main-dev, because the stacked branch contains all prior features' commits — the diff vs 171 is exactly 175's change. Auto-proceed.

### Step 1 — bump @types/node ^20 → ^24 across 5 Node workspaces + root lock [done]
- ledger/notify/config/identity/ui package.json `@types/node` → `^24` (resolves 24.13.3); root `pnpm install` regenerated ONLY the root `pnpm-lock.yaml` (vestigial per-service locks untouched — verified via git status).
- No FR-3 bounce: `@types/node ^24` needed no sibling dep bump.

### Step 2 — @types/node ^24 resolution + pre-delete build gate (AC-3, AC-4) [done]
- AC-3: 4 leaves resolve @types/node 24.x; `pnpm --filter {ledger,notify,config,identity} build` (tsc) all green. AC-4: ui resolves 24.x; `pnpm --filter ui build` (next build) green.
- NOTE: surfaced a pre-existing tsc-build break from feature 171 (ledger/identity telemetry.test.ts `.ts` import rejected by tsc build) — fixed on the 171 branch (PR #1095) by excluding `src/**/*.test.ts` from those two tsconfigs; 175 inherits the fix via the stack. Not a 175 diff-gate path.

### Step 3 — delete dead getEnvBool from 3 Go config packages [done]
- Removed `func getEnvBool` from trading (config.go:60), portfolio (:233 + `var _ = getEnvBool` suppressor + orphaned `strconv` import :9), marketdata (:247); removed the dedicated `TestGetEnvBool` function from each config_test.go (never the file). Zero production callers.
### Step 4 — Go config still builds/lints/tests (AC-1) [done]
- getEnvBool absent (grep 0). All 3: `go build ./...` clean, `golangci-lint` 0 issues (incl. no orphan-strconv failure), `go test ./internal/config/...` pass. Coverage ≥40: trading 69.0%, portfolio 49.0%, marketdata 62.6%.

### Step 5 — delete dead propagation.ts from 4 Node leaves + prune config eslintrc [done]
- Fresh re-grep: zero external importers. `git rm` the 4 `src/middleware/propagation.ts` (ledger/notify/config/identity); struck `src/middleware/propagation.ts` from config `.eslintrc.json` override (kept `src/grpc/authz.ts`). identity's live `ledgerAudit.ts`/`PROPAGATED_HEADERS` untouched.
### Step 6 — Node leaves still build (tsc) + pass (AC-2) [done]
- Absence: `git ls-files` 0, eslintrc grep 0. All 4 `pnpm build` (tsc type gate) green; lint 0; test:coverage pass ≥40 (ledger 46, notify 88.57, config 80.16, identity 46).

### Step 7 — teardown (6 docs) + landed-diff gate [done]
- Reconciled 6 docs (NARROW): removed root findings getEnvBool row; marked both propagation.ts findings RESOLVED (all four deleted); reworded root CLAUDE.md §Header Propagation; neutralised header-propagation.md Node "Reference store" pointer to a template (LIVE Go propagation.go ref at :50 untouched); dropped the getEnvBool clause from the 3 per-service Go findings. Left the unrelated 173-era zero-trap finding row out of scope.
- Teardown: context-forge refresh not invocable; manual reconciliation performed (Deviation Log + PR body).

## Session 2026-09-04 — sdd-execute summary (feature 175)
**Steps this session**: 1–7 (all)
**Progress**: 7 done / 7 total
**Stopped at**: all complete → code-completed
**Accountability**: out-of-scope changes: none in 175's own diff. Open questions: none. **Surfaced (fixed on 171/PR #1095)**: a latent tsc-build break from feature 171's ledger/identity telemetry test `.ts` import — fixed there, inherited via the stack, not a 175 diff-gate path. C-16: deliberate NON-promotion (one-time removal guards).
**Next**: stacked integration PR #5 (base `feature/fix-agent-trading-mode-otel-attr`) — end of sequence.
