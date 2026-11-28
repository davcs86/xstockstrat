# Authelia SSO Cutover — Mode Lifecycle, Rollback & Break-Glass

Feature 345 (`authelia-sso`) adds OIDC single sign-on for the web UI and the MCP agent, switched per deployment by
one config key, `identity` / `auth.mode`. Every database seeds it `local`; DigitalOcean stays `local`, and the homelab
moves to `oidc` through this runbook. Connector setup for MCP clients → `docs/runbooks/mcp-tools.md`. The Authelia
side (clients, claims, rate-limit zones) lives in homelab-edge `docs/runbooks/sso.md`.

---

## 1. Modes

| Surface | `local` (default) | `both` (linking window, break-glass) | `oidc` (homelab steady state) |
|---|---|---|---|
| Login page | password form | "Sign in with SSO" and the password form | "Sign in with SSO" only |
| Password login (`AuthenticateUser`) | works | works | `PERMISSION_DENIED` "password login disabled" |
| `/api/auth/sso/start`, `/callback` | 404 | SSO sign-in | SSO sign-in |
| Link SSO (`/accounts/sso`) | absent | available | absent |
| MCP (agent) | built-in OAuth server (DCR) | built-in OAuth server (DCR) | issuer tokens only; `/oauth/*` and AS metadata 404 |
| `/accounts/authorized-apps` | lists and revokes grants | lists and revokes grants | pointer to the issuer and the client IDs |

SSO sign-in finds a user only through a link made with Link SSO; there is no auto-provisioning. An unreadable mode
reads as `local` for the login page and the discovery documents; any value other than `local`/`both`/`oidc` reads
as `local` and logs WARN `auth_mode_invalid` once per value.

## 2. Configuration

Set per environment (`production`, `staging`), global rows, through config-ui:

| Key | Value |
|---|---|
| `ui` / `oidc.issuer` | the issuer URL, e.g. `https://auth.example.com` |
| `ui` / `oidc.client_id` | the web client, `xstockstrat-web` (production) or `xstockstrat-staging-web` |
| `ui` / `oidc.client_secret` | that client's secret (`is_secret`; decrypted only for the UI through `GetSecret`) |
| `ui` / `oidc.mcp_client_id`, `oidc.mcp_client_id_readonly` | the Claude.ai client IDs shown on `/accounts/authorized-apps` |
| `ui` / `oidc.mcp_client_id_claude_code`, `oidc.mcp_client_id_claude_code_readonly` | the Claude Code client IDs; **leave both empty on the homelab** |
| `agent` / `oidc.issuer` | the issuer the agent accepts MCP tokens from |

On the homelab, leave `oidc.mcp_client_id_claude_code` and `oidc.mcp_client_id_claude_code_readonly` empty in both
environments: homelab-edge registers no Claude Code client (SSO spec § 4.6 and decision 21 as amended 2026-11-27),
and an empty value hides that line on the authorized-apps card.

Set `auth.mode` with `set-auth-mode` (§ 5), which needs no login.

## 3. Pre-checks

1. **Config listener up.** The config service is healthy and delivers `WatchConfig` updates: identity and the agent
   apply `auth.mode` only from that stream. `set-auth-mode` always sends the change notify, so rerunning it re-kicks
   a missed delivery.
2. **Grammar.** Each issuer is `https://` (or `http://` only on `localhost`, `127.0.0.1` or `[::1]`), with a
   lowercase host name, no IP literal other than loopback, no IDN or `xn--` label, no default port, no userinfo,
   query, fragment or `%`, and **no trailing slash** or empty path segment. The UI's `APP_URL` env var is exactly the
   browser origin, `scheme://host[:port]`, with no path and no trailing slash. An invalid value logs ERROR
   `sso_issuer_invalid` or `app_url_invalid`; SSO sign-in then answers `?error=not_configured`.
3. **`ui` / `oidc.client_secret` is set** for the environment (unset → `?error=not_configured`).
4. **The app VM reaches the issuer.** The UI and the agent fetch discovery and JWKS server-side:
   `curl -fsS https://auth.example.com/.well-known/openid-configuration` from the app host returns JSON whose
   `issuer` equals the configured value byte for byte.

Local docker-compose SSO is unsupported: a loopback issuer is unreachable from inside the containers.

## 4. Cutover gates (before `both`)

The Authelia prerequisites; all four must hold before the first `set-auth-mode both`:

1. A homelab-edge path-scoped rate-limit zone over `POST /accounts/api/sso/confirm` (the Link SSO password step).
2. S17: Authelia re-authenticates on `prompt=login` + `max_age=1` and returns a fresh `auth_time` in the ID token.
   Proven on the edge droplet 2026-11-27 (Authelia v4.39.28). Link SSO sends `max_age=1`; with `max_age=0` Authelia
   v4.39.28 never issues a code.
3. The web client `xstockstrat[-staging]-web` is registered with scopes `openid profile email`, and its
   `claims_policy.id_token` includes `email` and `preferred_username`; the ID token carries `auth_time`, by default
   or through the policy, as S17 shows. Keep the authorization-code lifespan at Authelia's default (about 60 s) or
   longer: the callback's steps before the code exchange can take up to 30 s.
4. `uv run scripts/manage-users.py reset-password <seed admin email>` of the seed admin row, so the seeded account has
   a password the operator knows before it is linked.

## 5. Lifecycle: `local` → `both` → link → `oidc`

Each switch runs from a host that reaches the deployment's database (tailnet), with `DATABASE_URL` set (no `.env`
fallback):

```bash
uv run scripts/manage-users.py set-auth-mode both --environment staging --reason "SSO linking window"
```

The command prints the database host and name and both environments' rows before and after. **Then check that the
changed row's environment is the deployment's `APPLICATION_ENV`** (`production` → `production`, anything else →
`staging`): every database holds both environments' rows and the services read only their own, so a wrong
`--environment` changes nothing that runs.

1. `set-auth-mode both`. The login page shows "Sign in with SSO" beside the password form.
2. **Each person links.** Signed in with their password, they open Settings → Single sign-on (`/accounts/sso`), choose
   **Link SSO**, sign in at the issuer (Authelia asks for the login again), and confirm with their xstockstrat
   password. The dialog names the issuer account being linked. A failed link is retried with Link SSO.
3. **Every admin is linked** before `oidc` (check `/accounts/sso` for each, or that each can sign in with SSO).
   An unlinked admin in `oidc` can only get back in through § 6.
4. `set-auth-mode oidc`. Password login stops; MCP connectors move to the pre-registered clients
   (`docs/runbooks/mcp-tools.md`); old connector grants stop working.

### Verification

Sign in with SSO, sign out, and connect one MCP client, then check:

| Signal | Where | Meaning |
|---|---|---|
| `mcp.auth.rejected{reason=wrong_audience}` | agent | token `aud` is not `AGENT_PUBLIC_URL` (issuer audience setting) |
| `mcp.auth.rejected{reason=jwks_unavailable}` | agent | issuer discovery or JWKS unreachable |
| `mcp.auth.rejected{reason=account_refused}` | agent | `not linked` / `account inactive` / `sso disabled` (403; the last only while identity still reads `local`) |
| `ui.auth.events{event=sso_login_failed}`, `{event=sso_login_error}` | UI | SSO sign-in refused / faulted |
| `ui.auth.events{event=sso_link_failed}` | UI | a Link SSO confirm refused |
| `ui.auth.events{event=logout,reason=cross_origin}` | UI | a logout POST from another origin (403) |
| `identity.link.failures{reason}` | identity | link refusals |
| WARN `sso_link_refused` | UI | link callback with a missing or stale `auth_time`; reason `access_ttl_too_short` at link start: `identity/jwt.access_ttl_seconds` is below 660 s, which Link SSO needs (feature 370) |
| ERROR `sso_issuer_invalid`, `app_url_invalid`; WARN `auth_mode_invalid` | UI, agent, identity | bad configuration (§ 3) |

Sign out goes to the issuer's portal logout (`<issuer>/logout?rd=<APP_URL>/auth/login`); Authelia redirects back only
when that URL is inside its session cookie domain.

### Signing keys

The agent uses keys only from a JWKS fetched within the last 3600 s (`_JWKS_MAX_AGE_S`), with no stale-key grace
(SSO spec § 3; owner 2026-11-27). A JWKS outage that outlasts 3600 s from the last good fetch makes every `oidc` MCP
call answer 503 `jwks_unavailable` until the JWKS is reachable again. Accepted signing algorithms are RS256/384/512,
PS256/384/512 and ES256/384/512; EdDSA and `none` are excluded, so the issuer must sign with an RSA or EC key (the web
ID token uses RS256).

## 6. Rollback and break-glass

Both are `set-auth-mode` with the earlier value; no login, image or env change is needed:

```bash
uv run scripts/manage-users.py set-auth-mode local --environment production --reason "break-glass: issuer down"
```

`local` restores password login and the built-in MCP OAuth server at once. `both` keeps SSO and adds the password form
back (a locked-out admin signs in with the password, resetting it first with `reset-password` if needed). Check the
environment against `APPLICATION_ENV` as in § 5.

## 7. Unlinking and offboarding

- **Unlink** (a wrong link, or to relink):
  `uv run scripts/manage-users.py unlink-sso user@example.com [--issuer https://auth.example.com] [--force]`. It
  deletes the user's links (every issuer unless `--issuer`); the person can link again with Link SSO while the mode is
  `both`.
- **Offboard**: deactivate the xstockstrat user (`SetUserActive false`, e.g. the `manage_user` tool `set_active`):
  web sessions end at the next refresh and MCP is refused within the 60 s role cache; then `unlink-sso`. Disabling
  the person in Authelia also stops their refreshes. Removing them from the issuer's group blocks **new** logins only:
  Authelia does not re-check the group on refresh, so an existing MCP connection keeps working until one of the two
  steps above.
