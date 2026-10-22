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
