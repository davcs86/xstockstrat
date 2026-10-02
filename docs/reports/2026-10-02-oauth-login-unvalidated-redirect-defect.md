# Defect: OAuth login unvalidated redirect to client-supplied agent_cb

**Recorded**: 2026-10-02
**Severity**: SEV-1
**Impact type**: auth-bypass-xss
**Environment**: production (main)
**Affected service(s)**: xstockstrat-ui
**Config-only fix possible**: no

## Observed

`/auth/oauth-login` reads `agent_cb` from the query string and, after a successful credential
submit, assigns it verbatim to `window.location.href`. No scheme, origin or path validation exists
anywhere in the repo (whole-tree grep for `agent_cb`). Any URL is followed — an attacker-controlled
origin (open redirect after credential entry) or a `javascript:` URL, which executes on the UI
origin that holds the httpOnly session cookie and same-origin BFF access (including `placeOrder`).

## Expected

The post-login redirect targets only the agent's own OAuth callback,
`${AGENT_PUBLIC_URL}/oauth/callback`, resolved server-side from the runtime `AGENT_PUBLIC_URL` env
(already read server-side by `src/app/api/oauth/*/route.ts` and passed to the client by
`src/app/accounts/AgentUrlContext.tsx`). A mismatching `agent_cb` is rejected, never followed.

## Reproduction

1. Sign out; open `/auth/oauth-login?agent_cb=javascript:alert(document.domain)//&txn=x&state=y`.
2. Submit valid credentials.
3. Script executes on the UI origin (or, with `agent_cb=https://attacker.example/cb`, the browser
   is sent to the attacker with `txn`/`state`).

## Evidence

`services/xstockstrat-ui/src/app/auth/oauth-login/page.tsx:10`
> const agentCb = searchParams.get('agent_cb');

`services/xstockstrat-ui/src/app/auth/oauth-login/page.tsx:30`
> window.location.href = `${agentCb}?txn=${encodeURIComponent(txn)}&state=${encodeURIComponent(state)}`;

`services/xstockstrat-agent/app/oauth_server.py:186` — the legitimate value is always
`f"{AGENT_PUBLIC_URL}/oauth/callback"`; the UI never checks it. Sibling
`src/app/auth/login/page.tsx:8` already has a `safeRedirect` guard.

## Root cause hypothesis

The page trusts a client-controlled redirect target that only the agent should define. Fix: ignore
the query value (or require exact equality) and redirect to the server-resolved
`${AGENT_PUBLIC_URL}/oauth/callback`.

## Confidence

high
