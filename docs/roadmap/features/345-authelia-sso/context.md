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
