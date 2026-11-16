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

## Session 2026-11-15 — owner amendment: backwards compatible with DigitalOcean until cutover

- The owner agreed with every derived call (IssueSessionForUser, SAN gates, AGENT_PUBLIC_URL, the namespaces, seed 050,
  session lifetime, the client IDs, the ccr-branch sync), with one exception: the change must stay backwards compatible
  with DigitalOcean until cutover.
- FR-14 is the per-deployment mode, chosen by config alone. DO (`.do/app*.yaml`) and the homelab have separate
  databases and config.
  - Legacy mode (both issuers empty, the seeded default) is exactly today's behaviour.
  - SSO mode (both issuers set) is FR-1/2/7/8/11.
  - Half-configured counts as legacy and logs `sso_mode_misconfigured`.
  - Cutover is config only; clearing the issuers rolls back.
- This supersedes the earlier "MCP rollback = redeploy" decision. Redeploy stays possible. "No dual path" still holds
  per deployment: one mode at a time, and the legacy OAuth routes answer 404 in SSO mode.
- AC-32 changed meaning (half-configured → legacy) before design. Its ID is unchanged; no RED test cites it yet.
- AC-41 to AC-44 were added. Status went back to draft for re-review.
- Re-review pass 1 after FR-14: PASS WITH WARNINGS (4). Fixes:
  - The legacy-mode lockout gets the owner's choice, "seed `true` + guard". The code default stays `false`, `050` seeds
    `true` on every database, and in legacy mode the password form is never hidden: a banner explains the disabled flag
    (AC-45).
  - An unreadable config renders the legacy login (AC-46), and the page reads the mode and flag server-side.
  - `oauth-login` is unchanged (legacy only).
  - FR-9 was retitled.
  - AC-44 is bounded to 60 s.
- Overlap: still no FAIL. The new WARNs are 331 and 323 (`app/main.py`), on top of 319 and 324. All are soft rebase order.
- Pass 2 after FR-14: PASS WITH WARNINGS (2). Fixes: the SSO routes return 404 outside SSO mode (FR-14, AC-47); FR-10 applies in both modes.
- Pass 3 after FR-14: PASS WITH WARNINGS (2). Fixes: the cross-namespace mode read (the UI reads `agent/oidc.issuer` one-shot; the agent adds `ui` to `WATCHED_NAMESPACES` and reads `ui/oidc.issuer` in `app/auth.py:sso_mode`); the Consumer Surface sentence is repaired.
- Pass 4 after FR-14: PASS WITH WARNINGS (2). Fixes: FR-13 now updates AGENT-1/AGENT-9 (AC-36 extended); the keys are registered in `scripts/config-wiring.json`.
- Pass 5 after FR-14: PASS WITH WARNINGS (1). Fix: the `config-wiring.json` wording was wrong. Now: zero findings from `check-config-wiring.mjs --final`, `registry.receivers` only for unresolvable bindings, and no baseline entries.

## Session 2026-11-15 — sdd-review product-spec (re-approval after FR-14)

- Product spec approved. Status: draft → spec-ready (pass 6 after FR-14: PASS, 0 warnings).
- Warnings: none.
- Overlap findings (WARN, soft rebase order, recorded in the product spec): 319, 324, 331, 323. No FAIL-level collision;
  config `050` and identity `007` are unclaimed.
- Recommended design depth: full (4 services, additive proto, two migrations, a two-mode security-critical auth path).

## Session 2026-11-15 — sdd-design (in progress)

- Mode: full debate. The owner authorized more than 5 rounds if necessary (recorded as their override of the cap).
- Phase 0 Recon: wrote recon.md. Tree `ccr-cb8f5383-len5a9@bf7f6a96` ⊇ origin/main-dev@9f885622. Five scouts: identity,
  agent, ui, config/proto/scripts/deploy, scenario-recon.
- Main recon risks:
  - R-1: agent scope is re-derived from roles at two sites.
  - R-2: no direct JWT library in the agent.
  - R-4: `password_hash` is NOT NULL.
  - R-5: email is case-sensitive everywhere.
  - R-8: the UI has no public base URL or server config helper, and the middleware matcher does not exclude the SSO
    routes.
  - R-13: the metadata builder is in `oauth_metadata.py`, not `main.py`.
  - R-14: a local mTLS fault returns 401, while an outage returns 503.

## Session 2026-11-16 — sdd-design round 1 gate

- Round 1: 16 decisions settled, 9 alternatives rejected, 18 objections (6 blocking: O-1..O-6), no Floor breach.
- Owner decisions at gate 1:
  - Run round 2.
  - **Approved deviation from FR-2:** an unfetchable JWKS with an unknown `kid` returns 503 without `WWW-Authenticate`; token defects stay 401. FR-2 is amended.
  - **Approved:** remember-me and the redirect are bound to `state` through the encrypted SSO-transaction cookie. FR-1 is amended.
  - **Chosen:** `openid-client` v6 for the UI OIDC flow (closes O-13).
- Round 2: 13 more decisions settled (D-17..D-29) and 2 more alternatives rejected. 16 objections closed and 8 opened, so 9 remain open (O-3 and O-19..O-26; blocking: O-3, O-19, O-20, O-22, O-23, O-26). No Floor breach.
- The orchestrator verified the `openid-client` v6 API against the published package (D-29). ID-token signatures are NOT validated by default; `enableNonRepudiationChecks` is mandatory for FR-1.
- C-16 note: `@AC-19 @feature-294` (local auth fault → 401) is reclassified PRESERVE (legacy mode). SSO mode returns 503 per D-17. This is not a change to existing behaviour.
- Gate 2 owner decisions: run round 3; drop resolve single-flight in favour of trace fidelity (D-30, closes O-21).
- Round 3: the adversary verdict was SOUND (approvable). It closed every open objection, raised six low/medium ones (O-27..O-32), and the synthesis folded those into D-31..D-37. The orchestrator verified the openid-client 6.8.9 API against 6.9.0 (closes O-30). The register now has 0 open objections, 37 decisions and 14 locked alternatives. No Floor breach.
- Round 4 (consolidation): the proposer wrote the consolidated design and a seam check (N-1..N-14). The adversary found 3 code-verified blockers that earlier rounds missed: O-33 (the UI's copies of the agent discovery documents), O-34 (UI config reads default to the staging environment) and O-35 (the middleware refresh branch can redirect the SSO callback). The orchestrator verified all three.
- Gate 4 owner decisions:
  - **Logout:** use the RP-initiated logout endpoint if Authelia advertises one, else a short Authelia session plus documentation (D-45, FR-15).
  - **Unlink:** add `manage-users unlink-sso` (D-43, FR-12).
  - **Connector card:** shows the URL plus both client IDs from new seeded `ui/oidc.mcp_client_id[_readonly]` keys (D-44, FR-11).
  - **Access denied:** a distinct "no access" message (D-41, FR-15).
- Spec amended: FR-11, FR-12, new FR-15, two new config keys. AC-48..AC-52 added. The amended spec needs a re-run of `/sdd-review product-spec` after design approval.
- C-16 label: identity 043 `@AC-2/3/6` are "CHANGE-by-config, pre-signed" (FR-9; context.md 2026-11-15 "seed true + guard").
- Register: D-1..D-50, R-1..R-17, 0 open objections.
- Owner steer during round 5: SSO logout ALWAYS redirects to Authelia's logout (end_session_endpoint if advertised, else the portal logout). Reopens D-45 → D-51 (P-1, user reopened). FR-15 amended; AC-53 added.
- Round 5 (new surface + logout steer):
  - Adversary O-44 (confirmed against the defect report): an unconditional logout exemption would expose the RevokeToken unverified-decode defect. Fixed in D-52: the route verifies the signature before revoking, the exemption applies only when a session cookie is present, and 319 merges first or alongside.
  - D-52..D-59 settled.
- Gate 5 owner decisions:
  - Accepted the Sign-out button in both modes, and the expired-session logout returning JSON (D-60, O-45).
  - Accepted that `'error'`-mode logout ends only the xstockstrat session, with a WARN (D-60, O-48).
  - Chose to run round 6 on the round-5 additions.
- Spec line 216 and FR-15 amended.
- Round 6: the adversary rated it SOUND. O-55..O-60 were folded into D-61..D-65. The orchestrator verified jose 5.10.0 (JWTExpired.payload; signature checked before claims) and radix checkbox 1.3.11 (native form submission, unchecked by default). Accepted residual risk: a stolen access token that expired less than 14 days ago can force a 'log out everywhere' for its owner (matches the defect report's Expected section). Register: 65 decisions (D-45 superseded), 22 rejected alternatives, 0 open objections.

### 2026-11-16 — /sdd-design round 7 (final consolidated design + holistic review)

- The proposer consolidated D-1..D-65 into the design.md draft and ran seam check v2 (S-1..S-11). The adversary found no Floor breach and no register violation. Its verdict was "approvable without another adversarial round" once 9 gaps (O-61..O-69) are folded in.
- Settled D-66..D-76:
  - validity of the issuers and `APP_URL` is computed once, pinned by a shared vector file, and logout never redirects to an invalid issuer;
  - `APP_URL` is wired into compose and Playwright;
  - `isSameOrigin` is new code;
  - the agent checks `iss`, requires `sub`, and rejects an unverified foreign `iss` before key lookup;
  - the Configuration cache is keyed by secret hash with a 600 s TTL;
  - dropped settled details are restored verbatim;
  - metrics are typed per event, and `sso_login_failed` carries a reason;
  - callback latency is an accepted residual, under the authorization-code lifespan invariant;
  - runbook rollback order and cross-repo back-channel reachability are added;
  - the txn cookie is `secure`, and callback error logging is scrubbed.
- Spec text fixes were applied to product-spec.md and acceptance.feature: the SSO checkbox label, the 23505 re-classify wording, FR-15 in the SSO-mode list, `/start` POST-only (GET → 405), the Affected Services additions, the `unlink-sso` script entry, the reader lists, the secret seed sentinel, MCP-only refresh in Risks, the AC-24 foreign-key row and the AC-47 wording. `/sdd-review product-spec` must re-run (P-03).
- P-2, a petition to reopen D-52 (Origin check on logout against same-site sibling apps), awaits the owner.
- Owner gate (round 7): **run round 8**, and **adopt P-2**. D-52 is reopened and amended by D-77: logout rejects a request with 403 when its Origin header is present and is not the `APP_URL` origin.

### 2026-11-16 — /sdd-design round 8 (D-66..D-77 mechanism)

- The proposer delivered concrete mechanism for D-66..D-77 and proposed new ACs. The adversary found no Floor breach and no register violation. It found two blocking items:
  - the TS and Python issuer validators diverged, so both languages now share one grammar (D-79);
  - D-77 in legacy mode needed an FR-14 exception (D-80).
  O-72..O-78 were folded into D-81..D-87.
- Spec changes:
  - FR-15 gains the both-modes Origin 403 and the "invalid configuration fails closed" behaviour, and the FR-14 legacy-exception list gains the 403;
  - new acceptance scenarios: AC-54 (UI, invalid issuer), AC-55 (agent, invalid issuer), AC-56 (logout with an invalid issuer), AC-57 (cross-origin logout Outline over legacy and SSO).
- The owner still needs to confirm that D-77 applies in both modes. The evidence: DigitalOcean declares no extra domains, and each homelab app has a single hostname.
- Owner gate (round 8): confirmed that D-77 applies in **both modes** (D-80), and chose to **run round 9**.

### 2026-11-16 — /sdd-design round 9 (final text for the round-8 fixes)

- The proposer delivered the final regex grammar and the 82-row vector file, plus the remaining shapes. The orchestrator ran the vectors under Python and Node 22: all rows matched.
- The adversary found no Floor breach and no register violation, and said no further adversarial round is warranted. Its findings:
  - O-80: openid-client 6.8.9 normalises or skips the discovery issuer equality. The orchestrator verified this at `oc689 index.js:264,287`. Fixed by D-89, an exact `assertDiscoveredMetadata`.
  - O-79: `next build` does not type-check test files, so D-83 is unenforced. P-3 petitions to reopen D-83 and move the type assertions into `src/lib/authEvents.typecheck.ts` (D-93, pending owner).
  - O-81..O-84 were folded into D-90..D-92.
- Spec changes: the invalid-configuration rule moved to FR-14, with references from FR-1, FR-2 and FR-15; FR-14's legacy bullet now lists the both-mode changes non-exhaustively; reader paths and `client_secret` text were fixed; AC-56 gained `@FR-14`.

## Session 2026-11-16 — sdd-design (completion)

- Phase 0 Recon: recon.md (services identity, ui, agent, config, plus proto and the script; reuse patterns: the identity mint path `sessionResponse`, the config seed CTE 046/047, and the vector-file precedent `rpc-status-vectors.json`).
- Phase 1 Grilling: 9 rounds (full; the owner authorised more than 5).
  - Chosen approach: Authelia is the OIDC provider. Identity stays the user and role store and mints sessions via `ResolveExternalIdentity` + `IssueSessionForUser`. The agent becomes a JWKS-validating resource server. Each deployment's legacy or SSO mode is chosen by config.
  - Rejected: R-1..R-22 (e.g. PyJWKClient, a unique `lower(email)` index, ID-token storage, unconditional logout exemption).
- Owner gate (round 9):
  - **approved the design**;
  - P-3 → **D-93: add a `tsc --noEmit` typecheck script and CI step** for the UI. The owner accepted fixing any pre-existing type errors in this feature's PR.
- Constitution rules touched: C-01, C-03..C-05, C-07..C-13, C-15..C-18, F-01, F-04, F-06, F-07, F-11. Floor breaches: none.
- Status: spec-ready → design-approved.

## Open Threads

- [ ] Authelia v4.39.28 spike: items (a)–(e), RS256, end_session/portal/`rd`/GET `/logout`, auth-code lifespan, discovery issuer with no trailing slash. Due before /sdd-spec.
- [ ] Re-run `/sdd-review authelia-sso product-spec` on the design-round amendments. Due before /sdd-spec.
- [ ] Feature 319 merges first or alongside. Due at rollout.
- [ ] First `tsc --noEmit` run; fix any pre-existing errors. Due at the first UI step.
- [ ] homelab-edge PR #77 follow-ups (`sso.md` §7/§8 `unlink-sso`, logout / `rd`, post-logout redirect, back-channel reachability, rate-limit exemption). Due in a separate homelab-edge PR.

## Session 2026-11-16 — sdd-review product-spec (re-review after design)

- Product spec re-approved after the design-round amendments: **0 warnings after 3 passes**. Status stays `design-approved`.
- Fixes applied:
  - **Pass 1:** FR-15 logout Origin skip on invalid `APP_URL`; FR-14 unreadable-config and `/start` POST-only bullets; proto field-number text; FR order; AC-58..60.
  - **Pass 2:** AC-61..64; config check before the Origin check on `/start`; AC-35 tagged `@FR-14`.
- Overlap: **FAIL-level collision** on config migration `050`, now owned by feature 341 on trunk. Renumbered to `051` (D-94). No merge-order row was added, since renumbering removes the hard dependency. Re-check `051`/`007` at merge (343 also plans a config seed). WARN-level shared files: `manage-users.py` (324), `ci.yml` (297/298/324), identity service impl (319), agent `main.py` (331/323). All are rebase-only.
- Notes carried into `/sdd-spec`:
  - `debate.md` D-36/D-48/D-57 still say `050`. D-94 governs; the impl-spec uses `051`.
  - AC-64 has no mode column. SSO-mode logout also returns `redirect`; unit tests cover the `verified`/`unverified`/`expired_too_old` reasons.
