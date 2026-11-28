# Context Log: fix-sso-review-hardening

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-28 (/sdd-triage)

- Bug reported via defect report `docs/reports/2026-11-28-sso-review-hardening-nits-defect.md` (Issues disabled): SSO review hardening nits on shipped feature 345.
- Source: the independent security review of PR #1637 (345). Owner request 2026-11-28: "fix all nits" (items 4–8), relayed by the coordinating session.
- Severity: SEV-3 (environment dev: 345 is `code-completed`, not promoted). Config-only: no.
- Routed to SDD path (Track C): `docs/runbooks/bug-triage.md` § Quick-Start, "found via code review".
- Created: feature.md, product-spec.md, acceptance.feature (AC-1..AC-10), context.md, status.md (`draft`).
- Affected services: xstockstrat-ui, xstockstrat-identity, xstockstrat-agent.
- Root cause hypothesis: defense-in-depth checks omitted in 345; each is local. Every item was re-verified against `origin/main-dev@df9532c` before triage.
- Recommended design depth: **full** → `/sdd-design fix-sso-review-hardening` (rubric: ≥2 affected services). The runbook makes the design step optional (Track C step 3). It was not run: the coordinator specified each fix, and item 6's design fork was decided by the coordinator (below).
- Development branch: `claude/345-sso-security-nits`, not `feature/<slug>` — the brief requires one harness branch and one PR to `main-dev`.

### Decisions
- **Item 6 binding (coordinator decision 2026-11-28 under the owner's standing authority)**: the link txn seals SHA-256 of the session's `refresh_token` (identity's `token_hash`). At `/accounts/api/sso/link`, a session with fewer than 600 + 60 s left on its access token is rotated first and the rotated cookies are set on the response; confirm compares the hash in constant time against the live `refresh_token`. Guard: if the access-token TTL (`expires_at − issued_at`, i.e. `identity/jwt.access_ttl_seconds`) is under 660 s, link start fails closed (`503 {"error":"failed"}`, log `sso_link_refused` reason `access_ttl_too_short`); no weaker fallback.
  - Rejected: plain hash with no pre-rotation (a middleware rotation inside the 600 s window refuses the link: 10–20 % false refusals); a stable session id (`sid` claim + `refresh_tokens` column carried across rotation: identity migration, disproportionate for a nit).
  - **TTL coupling**: the guarantee needs access TTL ≥ `TXN_TTL_S` + `ACCESS_TOKEN_REFRESH_THRESHOLD_SECONDS` (660 s; default 900 s).
- **Middleware rotation forwards the new cookies (own call, needed by item 6)**: when the middleware rotates a session, the forwarded request's `cookie` header carries the rotated `access_token`/`refresh_token`. Otherwise the handler sees the revoked refresh token and the link start's pre-rotation fails for a request in the last 60 s of the token.
- **Item 4 scope**: identity headers are stripped on every middleware path that forwards, including the public early returns (SSO, logout, health, login page). Matcher-excluded paths are out of scope (middleware does not run there).
- **Item 7 path**: `sso_link` → `Path=/accounts/api/sso`. Cookies set with `Path=/` before deploy expire within 600 s.

## Session 2026-11-28 — sdd-spec

- Generated implementation-spec.md with 6 steps. Status draft → implementation-ready (product-spec review and design not run: neither is a Track C gate in `docs/runbooks/bug-triage.md`; recorded here).
- Key codebase findings:
  - The three header-copy sites are `middleware.ts:72,113,129`; four early returns forward the request untouched.
  - Only `GET /accounts/api/sso` and `POST /accounts/api/sso/confirm` read `sso_link`.
  - No session id survives `RefreshToken` rotation (both tokens rotate; the JWT carries no `sid`), hence the pre-rotation design.
