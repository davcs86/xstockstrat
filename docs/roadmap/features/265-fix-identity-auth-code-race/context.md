# Context Log: fix-identity-auth-code-race

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-21 (/sdd-triage)

- Bug recorded as defect report `docs/reports/2026-10-21-identity-auth-code-race-defect.md` (Issues disabled),
  sidecar `triaged` / `ref: feature:265-fix-identity-auth-code-race`.
- Source: repo-surveyor debt-radar scan (`docs/repo-surveyor/debt-radar-findings.md` @ 4535695), findings D-23
  (auth-code single-use half only; flagged security) and D-21 (mint/refresh duplication).
- Severity: SEV-2 (group; D-21 alone was rated lower by the surveyor). Impact type: auth-code-replay.
  Environment: dev (main-dev) @ a053b0e. Config-only: no.
- Operator decisions (2026-10-21): grouped by service+theme from the debt-radar scan; Track C for all SEV-2
  (precedent #1264); batch launched via /sdd-batch with designGate halt.
- Routed to SDD path (Track C).
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..4), context.md.
- Affected services: xstockstrat-identity.
- Root cause hypothesis: `ExchangeAuthCode` is read-validate-write over independent autocommit queries; hotfix
  `5bd271d` fixed the identical refresh race only.
- **Re-verification against a053b0e (scan predates `5bd271d`, which is not an ancestor of 4535695):**
  - D-23 refresh half — **excluded, no longer reproduces**: `refreshToken` (`:230-268`) and `refreshOAuthToken`
    (`:524-543`) both call `rotateRefreshToken` (`:340-370`, conditional claim + same-txn insert). Report
    `2026-10-19-identity-refresh-rotation-not-atomic-defect` is `resolved` (`ref: hotfix:hotfix/fix-refresh-token-rotation`).
  - D-23 auth-code half — **reproduces**: SELECT `:481-488`, JS check `:491`, unconditional UPDATE `:503-506`,
    separate refresh INSERT `:511` (scan cited `:461-482`; drift from `5bd271d` adding `issueRefreshToken`/`rotateRefreshToken`).
  - D-21 — **partially reproduces, narrowed**: the duplicated refresh SELECT (scan `:234-238`, `:505-509`) is gone.
    Residual: inline claim build + `jwt.sign` at `:166-176` and `:243-249` beside `mintOAuthAccessToken` `:295-315`
    (3 sign sites total); inline refresh hash+INSERT at `:178-185` beside `issueRefreshToken` `:321-334` (2 INSERT
    sites, was 3). The scan's "D-23's fix must land in both paths" no longer applies (one auth-code path); D-21 is
    kept so the D-23 fix reuses a single issue helper that first-party login also uses. Operator may drop D-21
    (AC-4) at design if it reads as an unrelated refactor.
- **Overlaps:** `252-fix-identity-ledger-test-suites` (implementation-ready) — the identity unit suite
  (`src/__tests__/identityServiceImpl.test.ts`) currently early-returns on a failed lazy import, so new
  impl-level tests silently pass until 252 lands; sequence 252 first or prove the new tests execute (P-06). AC-1
  needs a real-Postgres harness (the `5bd271d` hotfix used one). `242-fix-push-untargeted-broadcast` mentions
  `identityServiceImpl` (admin directory) — textual merge risk only.
- Design forks to settle: whether to consume the code before or after the redirect/client/PKCE checks (consume-first
  burns a code on a bad verifier — RFC-permitted, but an attacker with only the code could then deny the legit
  client); same-transaction consume + refresh INSERT (AC-3) vs consume-only.
- Recommended design depth: quick → `/sdd-design fix-identity-auth-code-race quick` (rationale: SEV-2, single
  service, no proto/migration/config, clear root cause with a proven sibling fix pattern).
- Development branch: feature/fix-identity-auth-code-race

## Session 2026-10-22 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready. Criteria verdict: PASS WITH WARNINGS (no fails, no floor breaches).
- Warnings:
  - FR-1 vs FR-5 tension (validate-before-consume needs a read of the stored row). **Resolved**: FR-1 now allows a
    validation read before the claim (or the predicates inside the claim); only the claim's row count decides redemption.
  - FR-8 / AC-4 silent on an empty audience. **Resolved**: FR-8 now states an OAuth token with no resource keeps
    today's `aud: ''`, first-party tokens carry no `aud`, so the shared helper's `aud` is optional.
  - FR-6 site set. **Resolved**: FR-6 now names the four sites, including `refreshOAuthToken` (intentionally in the
    shared-helper set; it already calls `mintOAuthAccessToken`).
  - Test harness, fault-injection mechanism and the 252 early-return dependency are deferred to design. Partly
    resolved: the spec now links `252-fix-identity-ledger-test-suites`; harness + mechanism remain for `/sdd-design`.
  - FR-6/FR-7 structural halves are grep/code-review verified, not scenario verified. Open: the impl-spec must carry the grep step.
  - AC-3's Given names a fault-injection detail. Accepted as written (Then steps are observable).
  - The task prompt gave a doubled feature path. Noted; the review ran against `docs/roadmap/features/265-fix-identity-auth-code-race/`.
- Overlap findings (WARN, no FAIL):
  - [file] `services/xstockstrat-identity/src/__tests__/identityServiceImpl.test.ts`: 265's real-Postgres race and
    fault-injection tests vs 252's impl `before()` try/catch (`:28-40`, 252 Step 3) and rotation revoke assertion
    (`:403-417`). 252 `implementation-spec.md:95` says whichever lands second merges the other's changes. Textual only.
  - [file] `services/xstockstrat-identity/src/grpc/identityServiceImpl.ts`: 265 `exchangeAuthCode` `:474-518` and
    helpers `mintOAuthAccessToken` `:295`, `issueRefreshToken` `:321`, `rotateRefreshToken` `:340` vs 252
    `implementation-spec.md:220-254` (transient mutation and restore of the `refreshOAuthToken` revoke `:524-527` and
    the #1262 `AND rt.revoked_at IS NULL` line in `rotateRefreshToken`). Adjacent, disjoint blocks; rebase-level risk.
- OPERATOR DECISIONS (binding, recorded 2026-10-22):
  - Grouped by service+theme from the 2026-10-20 debt-radar scan; Track C (precedent #1264).
  - Scope is D-23 auth-code half and D-21; refresh rotation already fixed by hotfix 5bd271d.
  - Operator 2026-10-21 (standing, all features): x-trace-id must be propagated as much as possible; no C-03 waiver — request-derived emits/writes use context.WithoutCancel(ctx) (Go) / the inbound metadata (Python/Node), never a fresh background context; only work with no originating request (background sweepers/loops) may mint its own context, and it should still carry a trace id when one is available.
- Next: `/sdd-design fix-identity-auth-code-race`.
