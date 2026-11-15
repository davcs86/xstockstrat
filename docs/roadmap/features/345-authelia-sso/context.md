# Context: authelia-sso

**Feature**: `docs/roadmap/features/345-authelia-sso/feature.md`
**Product Spec**: `docs/roadmap/features/345-authelia-sso/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/345-authelia-sso/implementation-spec.md`

---

## Session 2026-11-15T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Decisions taken with the owner before this story. The authoritative record is `davcs86/homelab-edge`
  `docs/decisions.md` "SSO is Authelia" and `docs/runbooks/sso.md` (PR davcs86/homelab-edge#77):
  - D1: Authelia v4.39.28 is the only token issuer; clients are pre-registered (no RFC 7591 in a released Authelia; Claude.ai
    connectors accept a pre-registered public client, redirect `https://claude.ai/api/mcp/auth_callback`). Fallback option F:
    keep the agent's OAuth server and delegate only its login to Authelia, if the spike fails.
  - D5/D11: link by `sub`, else by exactly one active unlinked case-insensitive email match (ledger audit), else create; refuse otherwise.
  - D6: password login stays behind a config flag as the rollback path.
  - D7: Authelia knows nothing of environments; `xstockstrat` and `xstockstrat-staging` are separate Authelia apps (web + MCP
    clients each), gated by one Authelia group per app.
  - D8: roles stay in `identity.users.roles` per environment; the scope bitmask is unchanged. The owner rejected moving roles
    into Authelia groups (ListAdminUserIds, the SetUserRoles last-admin guard and per-environment roles depend on the DB).
  - D10: the starting role is `trader`, written explicitly. Owner's reasoning: trading needs the user's own broker account;
    there are no shared or system accounts. Residual risk recorded as an Open Question (WRITE on shared resources).
  - D12: MCP narrowing via OAuth scopes (read-only connectors against prompt injection through
    `extract_website_content`/`extract_email_content`).
  - D13: ~60 s fail-closed role cache in the agent.
  - Email is copied from Authelia at each login; emails are edited by admins in SOPS only; usernames are immutable.
  - Cutover option B: admins align existing rows' emails (e.g. seeded `admin@localhost`) with the person's Authelia email
    before their first login, hence `manage-users.py update-email` (added to scope by the owner).
  - `SEED_USER_ID` is untouched; the owner knows a new value only affects future, not-yet-applied migrations.
- First gate before `/sdd-spec`: the Authelia 4.39.28 spike (product-spec § Feature Workflow Notes).

## Session 2026-11-15 — sdd-review product-spec, pass 1 (FAIL → fixed)

- Tree: `ccr-cb8f5383-len5a9` with `origin/main-dev` @ `9f88562` merged in (the feature branch does not exist yet).
- Pass 1: FAIL. Blockers: C-05 (config keys lacked the full contract) and 8 open questions. 11 warnings. Overlap: no FAIL;
  WARN file overlaps with 319 (`identityServiceImpl.ts`, `oauth_server.py`) and 324 (`manage-users.py`); trunk behaviour
  change on launched 019 (login page) and 051 (authorized apps).
- Owner decisions:
  - The password-flag code default is `false` (fail closed).
  - MCP rollback is a redeploy of the previous release. The agent accepts only Authelia tokens; there is no dual path.
  - New users stay `trader`; the BackfillBars WRITE risk is **accepted** (no prerequisite fix).
  - `/accounts/authorized-apps` links to Authelia.
  - MCP tokens carry the `email` claim, so the first MCP use links and creates like the web.
  - A "Remember me" checkbox stays next to "Sign in with SSO".
  - Analysis 029 / IDENTITY-15 is accepted and documented (new migrations resolve the owner by `SEED_USER_ID`).
- Derived without a new decision, flagged to the owner:
  - UI session tokens come from a new `IssueSessionForUser` RPC, SAN-gated to `xstockstrat-ui`.
  - `ResolveExternalIdentity` is SAN-gated to the UI and the agent.
  - `agent.oidc.resource` is dropped in favour of `AGENT_PUBLIC_URL`.
  - The password flag lives in namespace `identity`, and the UI reads it one-shot.
  - The `GetSecret` grant for `ui.oidc.client_secret`.
  - Seed migration `050`.
  - Session lifetime is bounded by the refresh TTL plus `SetUserActive false`.
  - Connector client IDs `xstockstrat[-staging]-mcp-claude[-ro]`.
- The spec was rewritten (FR-1 to FR-13; Risks section; no open questions). Acceptance has AC-1 to AC-36; existing IDs were
  kept, AC-7 now covers the UI only, and MCP moved to AC-21.

## Session 2026-11-15 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready (pass 4 of 4: PASS, 0 warnings).
- Passes 2 and 3 closed:
  - the C-05 contract (`path:symbol` readers, the `ui.oidc.client_secret` contract);
  - the MCP 403 for FR-3 refusals;
  - the `IssueSessionForUser` SAN gate (FR-4, AC-38);
  - `Max-Age=1209600` (AC-29);
  - `email required` (AC-39/40);
  - the identity-outage 503 (FR-8, AC-15; today's `_send_identity_unavailable` contract).
- Warnings: none.
- Overlap findings (WARN, soft rebase order only, recorded in the product spec): 319-fix-auth-trust-hardening
  (`identityServiceImpl.ts`, `oauth_server.py`), 324-fix-ci-enforcement-gaps (`manage-users.py`). Trunk behaviour changes on
  launched 019 (login page) and 051 (authorized apps).
- Cross-repo follow-ups for davcs86/homelab-edge#77:
  - Authelia must put `email` into access tokens (spike item b);
  - register the client IDs named in FR-13.
- Recommended design depth: full (4 services, additive proto, two migrations, a security-critical auth path).
