# Context: ui-auth-improvements  (archived 2026-08-26)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-26 — /sdd-archiver

**What**: A `xstockstrat-ui`-only change (no proto/identity/config/DB touched) that shipped two auth-UX behaviors: an opt-in "Remember me" persistent-cookie session, and a client-side "refresh-first, then redirect" handler for `Unauthorized` responses that now covers *every* browser data-call surface — connect-web unary, connect-web streaming, and `/accounts` REST. The 14 previously-inline browser transports were consolidated onto one `makeBrowserTransport` factory carrying the 401 interceptor once, with a parity guard test asserting no client bypasses it.

**Why (irrecoverable rationale)**:
- The reported symptom "not staying signed in" was **misdiagnosed-then-corrected during recon**: the real cause was cookies set with **no `maxAge`** (session cookies dropped on browser close), *not* a short token TTL. The server-side refresh token already lived 30 days, so no identity/proto/config change was needed — the entire feature stayed UI-side because of this diagnosis.
- The 14-day session length is a **hardcoded constant, deliberately not a config key**, because the UI has no runtime config-read path; the constant carries a *documented, non-runtime-enforced* coupling that it must stay ≤ `identity.jwt.refresh_ttl_seconds` (30d default). A future reader will see the bare `1_209_600` and cannot recover that this ceiling is an operational invariant.

**Rejected alternatives**:
- Redirect-only on 401 (no refresh) — lost: would bounce a still-refreshable session to full re-login every ~15 min (access TTL 900s) and lose unsaved form state; the middleware already refreshes navigations.
- Config key for the session duration — lost: the UI has no config-read path.
- FR-4 as a unit test (`604800 ≤ 2592000`) — lost: compares two source literals, enforces nothing at runtime; downgraded to a documented coupling comment.
- Adding the interceptor inline to each of the 14 client files — lost: repeats the "shipped producer, forgot the shared consumer" trap; one factory instead.
- connect-web-only coverage — lost (user gate): leaves `/accounts` REST and the two swallowing streams unguarded.

**Scars & gotchas**:
- `/accounts` is **REST, not connect-web** — the transport factory alone leaves it unguarded; needed a separate shared `apiFetch` path. Found by the design-adversary, not CI.
- **Streaming RPCs swallow errors** (trader alert stream, order-updates) and a unary interceptor won't observe a mid-stream `Unauthenticated` — the interceptor had to wrap the streaming `message` async-iterable to run the same handler.
- `CredentialsForm` is **shared with the OAuth authorize page** — the checkbox had to be opt-in via a `showRememberMe` prop or it would appear on OAuth login.
- Edge-runtime trap: `authRedirect.ts`/`transport.ts` are browser-only and must **never** be imported by `middleware.ts`/`auth.ts` or they break the Edge bundle.
- `attemptRefresh()` must be a true single-in-flight singleton (shared promise) or a page firing many RPCs spawns many refresh POSTs.

**Permanent deviations**:
- Design scoped `/api/auth/me` and `/accounts/api/agent-health` **out** of the 401 redirect on purpose (`me` is a session-probe used to *detect* login state; `agent-health` is a tolerant health probe — redirecting risks loops) → shipped leaves them ungated. Once design.md is deleted this deliberate carve-out reads as a coverage bug.
- Design's FR-4 "tested ≤ TTL" → shipped as a documented comment only (the test was a tautology).
- The client 401-interceptor e2e was **not** added → covered only by unit tests on the pure core (the mock harness can't orchestrate mid-session token expiry + a failing refresh). Documented deliberately.
- Streaming is **not replayed** on a mid-stream 401 that refreshes successfully — only unary calls retry; the panel recovers on next navigation. Accepted, documented.

**Cross-feature signal**: This is the C-10 "shipped the producer, forgot the shared consumer" pattern (fails.md 056/060/067) applied **preemptively and correctly**: 14 inline `createConnectTransport` sites → one factory + a parity guard test. The design-adversary catching the REST/streaming *divergence within* a surface (not just missing a consumer) is a sharper variant worth reusing.

**Deferred follow-ons**: If a stale `/api/auth/me` should also trigger the redirect, that is an explicit follow-up (currently scoped out). In-place streaming replay on refresh-success (today recovers only on next navigation).

**Ledger entries written**: insights.md (2), fails.md (2) — see the 2026-08-26 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: (1) UI-* — browser-only auth modules (`src/lib/authRedirect.ts`, `src/lib/browserClients/transport.ts`) must **never** be imported by `src/middleware.ts` or `src/lib/auth.ts` (Edge-bundled; a Node-only/browser import breaks the build). (2) UI-* — `/api/auth/me` and `/accounts/api/agent-health` are **intentionally excluded** from the client 401→login redirect (session-probe and tolerant health-probe; wrapping them causes redirect loops). (3) UI-* — browser `attemptRefresh()` must remain a single-in-flight singleton.
**Scenario promotion (C-16)**: 7 `@AC-*` → `services/xstockstrat-ui/acceptance/ui-auth-improvements.feature` (new suite).
**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 996210e4.
