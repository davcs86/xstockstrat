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

- [x] Authelia v4.39.28 spike: items (a)–(e), RS256, end_session/portal/`rd`/GET `/logout`, auth-code lifespan, discovery issuer with no trailing slash. Done 2026-11-16 (D-95..D-98).
- [x] Re-run `/sdd-review authelia-sso product-spec` on the design-round amendments. Done 2026-11-16 (0 warnings).
- [ ] Step 4 needs a scratch Postgres 16 (psql + migrate) to regenerate `scripts/config-wiring-stored.json`, or the CI artifact. Due at Step 4.
- [ ] Step 12's DB tier needs two migrated databases locally, or the CI `identity-db-test` job. Due at Step 12.
- [ ] `/sdd-review impl-spec` to rule on the spec-level choices listed in the sdd-spec session (JWKS fresh window, alg allow-list, `chromium-sso` project). Due before /sdd-execute.
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

## Session 2026-11-16 — Authelia v4.39.28 spike (gate for /sdd-spec)

**Setup.**
- Authelia release `authelia-v4.39.28-linux-amd64.tar.gz`, sha256 `e8ad9ff965cbf3b93138945e13cb4b7874c999c254772b2bb77952863177699c`, matching the release `checksums.sha256`. It ran locally inside the session sandbox; the owner granted permission.
- Throwaway config:
  - file user store with SQLite, self-signed TLS, issuer `https://auth.example.test:9091`;
  - an RS256 JWK;
  - group policy `group:xstockstrat-staging` with one_factor;
  - clients `xstockstrat-staging-web` (confidential, `client_secret_basic`, PKCE), `xstockstrat-staging-mcp-claude` and `-ro` (public, PKCE, audience `https://xstockstrat-staging.example.test/agent`);
  - scopes `xstockstrat.{read,write,admin,trade}`.
- The flows were driven by a script against the real endpoints. The scripts and config were scratchpad-only and are not committed.

**Results.**
- **Discovery.** `issuer` has no trailing slash. `jwks_uri` is same-origin. There is **no `end_session_endpoint`**. The custom scopes are not listed in `scopes_supported`, but they are honoured.
- **ID token (web).**
  - Header `RS256`, `kid=k-rs256`, `typ=JWT`; the signature verifies against the JWKS.
  - `aud=[client]` and `azp=client`. The authorization response carries `iss` (RFC 9207).
  - **`email` is absent by default.** It is present (with `email_verified`) only with a claims policy `id_token: [email, email_verified]`. The email keeps its case (`Alice@Family.Example.Test`); identity lowercases it in SQL, as designed.
- **(a) PASS.** The pre-registered public MCP clients complete code+PKCE with RFC 8707 `resource` on both the authorize and token requests, and also on authorize only. A foreign `resource` gets `invalid_target`. The client side of Claude.ai and Claude Code cannot be exercised locally, so it stays a cutover check.
- **(b) PASS, with deviations.** Access-token header: `RS256`, `kid`, `typ=at+jwt`. Claims:
  - `aud=["…/agent"]` and `email` (with an access-token claims policy);
  - `sub`, `client_id`, `iss`, `exp`, `iat`, `nbf`, `jti`;
  - **the scopes arrive as `scp` (array), not `scope` (string)**, which gives D-95;
  - **with no `resource`, the token has no `aud`** unless `requested_audience_mode: implicit` is set, which gives D-96.
  
  The signature verifies against the JWKS, and a refresh keeps `aud`.
- **(c) PASS.** The custom scopes are granted. The read-only client asking for `xstockstrat.write` gets `invalid_scope`.
- **(d) Not re-checked.** Removing the user from the group: refresh still succeeds, twice in a row. Disabling the user: refresh fails (HTTP 500 `error`). This gives D-98.
- **(e) PASS.** `sub` is the same UUID across two MCP sessions and the web ID token.
- **Group refusal.** A user outside the group gets `error=access_denied`, which drives the D-58 `no_access` message.
- **Consent.** MCP clients requesting `offline_access` hit the explicit consent page even with `consent_mode: implicit`. They were accepted through `/api/oidc/consent` in the test. This is UX only.
- **Auth-code lifespan.** Exchanged at 25 s it works; at 70 s it gets `invalid_grant`. The lifespan is about 60 s, above D-73's 30 s pre-exchange budget.
- **Portal logout.** The `portal.SignOut` bundle reads `rd`. `GET /logout?rd=…` needs no confirmation: the view calls `POST /api/logout {targetURL}` and redirects about 2 s later only if `safeTargetURL` is true. The test found `true` for the in-domain `https://xstockstrat-staging.example.test/auth/login` and `false` for `https://evil.other.test/x`. The session is cleared (`authentication_level` 1 → 0). This gives D-97. A bare `GET /logout` without JS does not log out; it is a SPA route.
- **Verdict.** Option F is not needed. Design deltas D-95..D-98 are recorded, and FR-7 and the spike section of the spec are updated.

## Session 2026-11-16 — sdd-spec

- Generated implementation-spec.md with 40 steps. Status → implementation-ready.
- Tree: `ccr-cb8f5383-len5a9@1ea8fe5` ≡ `origin/ccr-cb8f5383-len5a9`, containing `origin/main-dev@4aa55e9`. The tree-freshness
  procedure resolved TARGET to `main-dev` (`feature/authelia-sso` does not exist on the remote). It did **not** switch,
  because `main-dev` has no `345-authelia-sso` directory and all SDD artifacts live on this harness branch. This is a
  deviation from `docs/sdd/tree-freshness.md`, raised to the owner.
- Discovery was inline: no subagent tool was available in this session. Recon line numbers were re-verified for
  identity, agent, proto and config. None of those changed between recon `bf7f6a96` and HEAD. UI line numbers were
  re-read.
- Key codebase findings:
  - Next free migrations are config `051` (`050_ui_chart_history_bars` is 341's) and identity `007`.
  - A config seed needs `scripts/config-wiring-stored.json` regenerated on a scratch Postgres 16. The CI
    `config-wiring-stored` job diffs it (`ci.yml:1250-1292`). Step 4 is blocked without a DB (P-03), with the CI
    artifact as the fallback (341 precedent).
  - The wiring checker attributes a read by `file:receiver` only (`check-config-wiring.mjs:546-551`), and a Python
    attribute call's receiver is `ast.unparse(func.value)` (`config-wiring-py-reads.py:143-147`).
    - So `app/sso_mode.py` reads its two namespaces through two module aliases (`agent_config`, `ui_config`).
    - `oidcConfig.ts` reads through three snapshot bindings (`ui.values`, `agent.values`, `identity.values`).
    - Each binding gets a `registry.receivers` entry.
  - The `bffMetrics` typed map breaks the bare `recordAuthEvent('logout')` at `logout/route.ts:11`, so the metric
    change, `ssoErrors.ts`, the auth verify split and the logout rewrite are one step (30).
  - The e2e mock `getConfig` answers unknown namespaces with `platform` (`mock-backend.ts:1552-1578`). The Playwright
    suite is `fullyParallel` with 2 CI workers, so a global SSO-mode switch would race other specs.
  - Identity test config mocks lack `getBool` at 7 sites. Steps 8 and 9 therefore land together.
  - There is no identity `test:db` script or CI job yet. Step 12 clones `ledger-db-test` (`ci.yml:957-1014`) and adds
    a second DB for AC-6.
- **Spec-level choices not settled by the design (flag at `/sdd-review impl-spec` and at the step gate):**
  - Step 17: `_JWKS_FRESH_S = 300` (D-13 names a "fresh window" with no value).
  - Step 17: the asymmetric allow-list `{RS,PS,ES}{256,384,512}`, with EdDSA excluded (D-2 names no members).
  - Step 38: SSO e2e specs run in a separate `chromium-sso` project with `dependencies: ['chromium']`, driven by a
    stub-IdP control endpoint that shares state with the mock backend. Cost: a hard `chromium` failure skips the SSO
    project.
  - Step 38: the stub-IdP port is to be picked at execute.
  - Step 23: per insights.md:2948, a bare `tsc --noEmit` may false-RED on `.next/types`. The execute gate decides
    between `next build` first or excluding `.next/types`.
  - Step 4: the down guards the secret row on `value_encrypted IS NULL`; confirm the column name from `045`/`049`.
  - Step 5: a migration-rerun assertion file `scripts/migration-assertions/config-authelia-sso-keys.sql` asserts the
    re-apply notify count of 0. A fresh-DB notify count of 6 is asserted structurally (DISTINCT namespace, environment).
- Referrer-Policy constraint (D-54): a future `no-referrer` policy would break `/api/auth/sso/start`. Step 34
  re-records it at execute.

## Session 2026-11-16 — sdd-review impl-spec (advisory; looped to clean)

- **Result:** 0 failures, 0 open warnings after **8 passes**.
  - Pass 1: 3 failures, 15 warned steps.
  - Pass 2: 0 failures, 3 warnings.
  - Pass 3: 2 warnings. Pass 4: 3 warnings. Pass 5: 4 warnings.
  - Pass 6: 2 warnings. Pass 7: 1 warning. Pass 8: clean.
- **Major changes:**
  - **Config seed renumbered to `052`** (D-99): feature 343 landed `051` on trunk.
  - **The spec was split from 40 to 52 steps,** each touching at most 5 files.
  - **The `chromium-sso` Playwright project** runs with `workers: 1` and `fullyParallel: false`. AC-32/44/45/46 moved into `e2e/sso/legacy-global-state.spec.ts`.
  - **The typecheck step lists exact files.** The orchestrator measured `tsc --noEmit` at 0 errors twice, on the clean tree and at `45be5749`.
  - **One `traceId` per request** is threaded through every config loader and identity call (C-03). The loaders require it, and `oidcConfig.ts` never generates one.
  - **Shared test fixtures:** identity `fixtures/sanCall.ts` and agent `conftest.py` `sso_keys` (C-13).
  - **Real-reader tests** for the seeded password flag and the client IDs (config wiring b).
  - **`APP_URL` moves into local compose** with its first reader (Step 25).
- **Accepted residuals** (not open; each is documented in its step):
  - [x] Step 4: the seed lands before its readers (Steps 8/16/29, three surfaces). It is bridged by `check-config-wiring` PENDING and the `--final` gate at the integration PR.
  - [x] Steps 14, 44, 45, 46: no coverage threshold exists for `scripts/` pytest or the Playwright harness.
  - [x] Step 2: the generated proto paths are brace-grouped. Extra paths are logged per F-08.
  - [x] Steps 39, 40, 42: UI service steps whose RED/GREEN is the Step 47 e2e (the UI has no jsdom unit layer).
  - [x] Step 52: verification only, with no files (D-48). If the executor requires a commit, it folds into Step 51.
- **Execute-time checks carried forward:**
  - [ ] Step 12: `psql` must be present in the `xstockstrat-migrate-ci` image.
  - [ ] Step 24: paste the fresh `pnpm run typecheck` output.
  - [ ] Step 37: `pnpm run build` must tolerate the extra middleware exports, or they move to `src/lib/authPaths.ts`.
  - [ ] Step 46: the per-shard `--list` must show every `chromium-sso` test.
  - [ ] Merge time: re-check that config `052` and identity `007` are still free.
- **Overlap:**
  - Config `051` collided with 343 and was fixed by renumbering. No merge-order row is needed.
  - Identity `007` is free.
  - Shared file: `services/xstockstrat-identity/src/telemetry.ts` with 337 (in progress). Rebase only.

## Session 2026-11-16 — pre-merge renumber

- Merging the latest `main-dev` brought in feature 347's `052_alpaca_adaptive_rate_limit_keys`. The config seed is now `053_authelia_sso_keys` (D-100). This was applied in implementation-spec.md, design.md, product-spec.md and feature.md. Step 4 now takes the next free number at execute time, because trunk keeps consuming config numbers.
- The `fails.md` merge conflict came from two end-of-file appends (347's two entries and ours). It was resolved by keeping both in date order, the same resolution the owner approved earlier.

## Session 2026-11-24 — owner re-spec against the homelab-edge SSO design (amendment before re-review)

- Source of truth: davcs86/homelab-edge `docs/superpowers/specs/2026-11-23-authelia-sso-respec.md` (merged in PR #114),
  owner-approved 2026-11-23 after two adversarial reviews; its § 1 decisions are final (owner confirmed 2026-11-24).
  Branch `ccr-589817f0-cyg7gy` ⊇ `origin/main-dev@0dbc26b`.
- Superseded by the respec (decisions 5–10, § 3, § 5): email linking and SSO-created users (D-6, FR-3 steps 2–3, outcomes
  `LINKED_BY_EMAIL`/`CREATED`), the issuer-presence mode switch and `identity/auth.password_login_enabled` (FR-9, FR-14), the
  access-token `email` claim (D-96), the issuer `auth.<domain>` (now `https://auth.public.<domain>`), D-74's rate-limit
  exemption (now path-scoped Caddy zones, respec § 4.3).
- Owner decisions 2026-11-24 (this session):
  - Process: full SDD re-run — amend product-spec/acceptance → `/sdd-review product-spec` → `/sdd-design` full re-run with
    respec § 1 locked → `/sdd-spec` → `/sdd-review impl-spec`.
  - Mode is one config key `auth.mode` (`local` default | `oidc` | `both`). Web: `local` password only, `both` SSO and
    password, `oidc` SSO only. **MCP: built-in OAuth server in `local` and `both`; Authelia tokens only in `oidc`.**
  - Linking is explicit ("Link SSO"); **no auto-provisioning at all** (decision 8: no passwordless xstockstrat accounts).
  - **Drop FR-5 (email sync) and `manage-users.py update-email`**; `unlink-sso` stays. The IdP email is displayed on the link
    confirmation only, never stored. Link uniqueness is xstockstrat's: PK `(issuer, subject)` + `UNIQUE (issuer, user_id)`.
  - No-login mode switch: a tested `scripts/` command sets `auth.mode` in the config store from the tailnet (respec § 3);
    design picks the write path.
- Derived (no new decision): bootstrap/break-glass is the existing `manage-users.py create-user`/`reset-password` (identity's
  admin is a migration seed, not env); config seed renumbered to the next free `056` (055 is on trunk); identity `007`
  still free; Claude Code clients `xstockstrat[-staging]-mcp-claude-code[-ro]` (loopback redirect, spike S9); both Claude.ai
  callback hosts.

## Session 2026-11-24 — sdd-review product-spec (re-spec)

- Tree: `ccr-589817f0-cyg7gy@a2e3350 ≡ origin/ccr-589817f0-cyg7gy` (⊇ `origin/main-dev@0dbc26b`). Same recorded deviation as
  2026-11-16: `feature/authelia-sso` does not exist, so TARGET would be `main-dev`, which lacks this re-spec; not switched.
- Product spec approved. Status: draft → spec-ready (pass 3: PASS; pass 1 and 2 PASS WITH WARNINGS, all fixed).
- Fixes from the passes: AC-54/AC-55 split by which issuer drives each 503 (FR-14); FR-1/FR-16 define every UI message and
  `error` query value; FR-17 bound to 60 s; FR-15 states the expired-session JSON logout; AC-49 concrete (verified against
  `app/oauth_metadata.py:24,33`); AC-20/AC-36 cover FR-13's docs; `/accounts/sso` page and nav (`navGroups.tsx:104`,
  `PlatformHeader.tsx:96`, C-10a); FR-4 states the `GetSecret` grant (AC-35 → @FR-4); config migration number taken at
  execute time.
- Warnings: one accepted — AC-28 asserts a log line (same observable as the approved 2026-11-16 AC-28).
- Overlap: no FAIL. WARN (soft rebase only): 319 (`identityServiceImpl.ts`, `telemetry.ts`, agent `watcher.py`), 331 (agent
  `main.py`), 324 (`manage-users.py`, unverified from 324's side). Config `056` is free on trunk and also planned by 314, 317
  and 321 (all implementation-ready): first to merge keeps it. Identity `007`, proto, keys: clean. Note: draft feature
  `280-third-party-sso-oidc` proposes `identity.sso.*` for the same problem (no key collision; needs an owner decision).
  Feature 314's `context.md:759` still says 345 claims `053` (stale; outside this feature).
- Recommended design depth: full (owner-chosen 2026-11-24).

## Session 2026-11-24 — sdd-design re-run (full), Phase 0

- Tree: `ccr-589817f0-cyg7gy@b3055c0 ≡ origin/ccr-589817f0-cyg7gy` (⊇ `origin/main-dev@0dbc26b`); same branch deviation.
- Recon rewritten (`recon.md`, five scouts: identity, agent, ui, config/proto/scripts/deploy, scenario-recon). Main new
  risks: R-1 per-user `auth.mode` overlay; R-2 no operator config write path (plain UPDATE not notified; 055 CTE shape);
  R-3 `oidc` recovery via FR-17; R-4 middleware refresh hides new cookies from the handler; R-5 legacy `/oauth/*` needs an
  explicit 404; R-6 identity test mocks lack `getString`; R-7 two agent scope sites.
- C-16: identity 043 `@AC-2/3/6`, ui 153 `@AC-1/2/3`, ui 294 `@AC-33`, agent 294 `@AC-20/47`, agent 147 `@AC-9` are
  CHANGE-by-config in `oidc` only (PRESERVE in `local`/`both`); sign-off to be re-recorded at the design gate.
- Phase 1 starts at round 10 (register continues; superseded 2026-11-16 decisions to be petitioned and confirmed).

## Session 2026-11-24 — sdd-design round 10 gate (paused)

- Round 10 ran (proposer + adversary; register D-101..D-110, R-23..R-27, O-85..O-95, P-4..P-5). Verdict NEEDS WORK; the one
  blocker (O-85, stale cookie in the Link flow) is closed by D-107. No Floor breach.
- Owner at the gate:
  - P-4 approved: the ~34 listed 2026-11-16 decisions are superseded by D-101..D-109 (register Status edits pending).
  - O-86: enforce `auth_time` for Link on the RP side (fail closed), not only `prompt=login`.
  - Spec amendments approved for round 11: `GetExternalIdentityLinks` RPC; Link starts from `/accounts/api/sso`; P-5 (edge
    rate-limit zone over the Link confirm POST is a required cutover gate).
  - C-16 sign-off **not given**. Owner, verbatim: "Preserve the password and built-in OAuth routes for self-hosted or VPS
    deployments. External OIDC support is just a different authentication method. I'll explore making the identity
    service Authentik-based."
- Design paused before round 11 pending clarification of that steer (scope of "preserve", and whether the Authentik
  exploration changes the issuer or the identity architecture). debate.md State stays `in-debate`.

## Session 2026-11-24 — round-10 gate resolved

- Owner clarifications after the pause:
  - `oidc` stays as designed; `local` (default, DigitalOcean, any self-hosted/VPS deployment) keeps password login and the
    built-in OAuth server unchanged. **C-16 sign-off given** for the CHANGE-by-config items, `oidc` only: identity 043
    `@AC-2/3/6`, ui 153 `@AC-1/2/3`, agent 294 `@AC-20/47`, agent 147 `@AC-9`; ui 294 `@AC-33` unchanged (`oidc` adds a
    separate 403).
  - "Don't start identity in `oidc`" is not possible within 345 (identity holds users, roles, links, sessions; serves
    notify and `manage_user`; FR-17 rollback needs it). Owner chose: identity always on (D-112). Identity-less `oidc` is an
    idea for the owner's **xstockstrat-only** Authentik exploration; homelab-edge (Authelia + lldap) is unaffected.
- Register: P-4 applied (35 decisions marked superseded), P-5 reopened O-43, D-111 (`auth_time` check) and D-112 added.
- Spec amended (no re-review yet; per the 2026-11-16 precedent `/sdd-review product-spec` re-runs after design approval,
  O-94 open until then): `GetExternalIdentityLinks` (FR-4, Proto, Affected Services, AC-73), Link start from
  `/accounts/api/sso`, the `auth_time` requirement (AC-74), the edge rate-limit zone as a cutover gate.

## Session 2026-11-24 — round-11 gate

- Round 11: consolidated design + seam check; adversary "approvable with listed fixes", Floor clear. Folded as D-113..D-127
  (link error destinations, header forwarding, identity mode parse on update, `@feature-350` verbatim move, nav, honest
  AC-6/AC-25 coverage, cutover gates incl. `max_age=0`, serial e2e file, parse clarification, pure `sessionResponse`,
  closed refusal details, no password replay, validity definition, identity refuses Link outside `both`, A1 verified
  against openid-client 6.8.9 / oauth4webapi 3.8.9). R-28..R-30 locked; O-96..O-110 and O-43 closed.
- Owner: C-16 sign-off extended to ui `@feature-350` `@AC-4/6/9` (vacuous in `oidc`; PRESERVE in `local`/`both`).
- Owner: run another round (round 12) before approving.

## Session 2026-11-24 — round-12 gate

- Round 12 (confirmation): adversary SOUND, Floor clear; D-128..D-131 fold its precision fixes (AC-28/AC-72 seams,
  `watchAuthMode`, spec-edit wording, `HEADER_INTERNAL_CALLER`, vector-file partitions, AC-75 adopted, register hygiene).
- Owner: Link IdP errors return to `/accounts/sso` via a local advisory txn decrypt (D-132, amends D-58's order); UI
  discovery documents fall back to today's documents on unreadable config (D-133). Owner asked for another round (13).

## Session 2026-11-24 — sdd-design (completion, re-run)

- Phase 0 Recon: recon.md rewritten (services identity, agent, ui, config/proto/scripts/deploy + scenario-recon; reuse:
  the `authenticateUser` password sequence → `verifyPassword`, `adminDirectory.ts` SAN helpers, the 055 CTE + notify,
  `apiFetch` refresh-and-retry, `manage-users.py`).
- Phase 1 Grilling: rounds 10–13 (full; 4 rounds this run). Chosen approach: one global mode key `identity/auth.mode`;
  identity always on with four SAN-gated RPCs and `007_external_identities`; agent per-request branch (issuer JWTs only in
  `oidc`); UI RP with login via `/api/auth/sso/*` and Link via session-gated `/accounts/api/sso*` + `auth_time` check;
  `manage-users.py set-auth-mode`. Rejected (this run): R-23..R-30 (stale-cookie binding, in-handler refresh,
  metadata-field links, per-issuer bool, SetConfig per-user refusal, two-fake-pool test, flag-arg builder, verbatim detail
  echo).
- Owner at the final gate: D-136 (UI PRM 503 when the agent issuer is unreadable in `oidc`), D-137 (link `no_access` copy),
  approve. O-94 spec edits applied to product-spec.md and acceptance.feature (AC-75, AC-76 added; 67 scenarios).
- Constitution rules touched: C-01, C-03..C-05, C-07..C-10, C-12..C-18, P-01..P-05, F-01, F-04, F-06, F-07. Floor
  breaches: none.
- Status: spec-ready → design-approved. Next: `/sdd-review product-spec` (O-94), then `/sdd-spec`.

## Open Threads (2026-11-24 re-run)

- [x] `/sdd-review authelia-sso product-spec` on the design-round amendments (O-94). Done 2026-11-24 (post-design re-review).
- [ ] Cutover gates (homelab-edge): rate-limit zone over `POST /accounts/api/sso/confirm`; S17 fresh `auth_time` with
      `prompt=login` + `max_age=0`; Authelia web client ID-token claims `email`, `preferred_username`, `auth_time`; seed-row
      `reset-password`. Due before `set-auth-mode both` on a homelab deployment. S17 part done 2026-11-27, with
      `max_age=1` instead (D-139; session "S17: max_age=1" below).
- [ ] Config migration number: next free at execute (`056` contested by 314/317/321). Due at the seed step.
- [x] Draft feature 280-third-party-sso-oidc overlaps (owner decision). Done 2026-11-24: 280 `demoted/canceled`, superseded by 345.
- [ ] Identity-less `oidc`: idea for the owner's xstockstrat-only Authentik exploration (out of scope, D-112).

## Session 2026-11-24 — sdd-review product-spec (post-design re-review)

- Product spec re-approved after the design-round amendments: pass 1 PASS WITH WARNINGS (5), pass 2 PASS WITH WARNINGS (1,
  AC-77 preconditions; fixed). Status stays `design-approved`. O-94 closed.
- Fixes: FR-15 exceptions consolidated (incl. unset/unreadable secret → portal logout, D-134); FR-14 UI PRM 503 when the agent
  namespace is unreadable (D-136); FR-16 `linked` fallback; FR-1 full `oidc` message; new AC-77 (link-route statuses) and
  AC-78 (unreadable agent issuer → PRM 503). 69 scenarios.
- Overlap: FAIL on config `056` (also planned by 314, 317, 321). Owner chose a conditional renumber row in
  `merge-order.md` (whoever merges first keeps `056`; others renumber at their own merge), replacing the stale 345 vs 352
  row; plus a rebase-only row vs 319. Identity `007`, keys, proto: clean.
- Next: `/sdd-spec authelia-sso` (the existing implementation-spec.md predates the re-spec).

## Session 2026-11-24 — sdd-spec (re-spec)

- Generated implementation-spec.md with 58 steps (supersedes the 2026-11-16 52-step spec, kept in git at `f0ed7dc`).
  Status: design-approved → implementation-ready.
- Tree: `ccr-589817f0-cyg7gy@f0ed7dc ≡ origin/ccr-589817f0-cyg7gy` (⊇ `origin/main-dev@0dbc26b`). Same recorded deviation:
  `feature/authelia-sso` does not exist, so TARGET resolves to `main-dev`, which lacks this re-spec; not switched. The 14
  commits over `main-dev` are docs-only, so every code citation is `main-dev@0dbc26b`. Discovery was inline (recon.md
  plus targeted greps); recon and design line numbers re-verified for identity, agent, config, UI and scripts.
- Key codebase findings:
  - Next free migrations: identity `007`; config `056` (highest on trunk is `055`; `053` is a gap never to fill).
  - Seed has 18 rows in two statements (plain `054` shape + secret `049:57-67` shape) and no notify (D-109).
  - The approved issuer/app_url grammar and its 66/16 vector rows are verbatim in `git show 7eeab3d:…/design.md`
    lines 769–870; Step 6 copies them and replaces the `mode` rows with the D-121 `auth.mode` parse rows.
  - The agent's `read_config_value` forwarder is matched by name, so `sso_mode.py` reads through two module aliases
    (`identity_config`, `agent_config`) and `watcher.py` gains `read_config_value = read_value`.
  - Only `logout/route.ts:11` breaks under the typed `recordAuthEvent` map, and it is rewritten in the same step (36).
  - The e2e mock answers unknown config namespaces with `platform` (`mock-backend.ts:1560-1586`); Step 51 adds `identity`
    and `agent`, with the mode row absent by default.
- Spec-level choices not settled by the design (flag at `/sdd-review impl-spec`): `OIDC_SCOPE = 'openid email profile'`
  (FR-16.2's `preferred_username` fallback is a `profile` claim); `_JWKS_FRESH_S = 300` and the RS/PS/ES allow-list
  (carried); the `chromium-sso` project around D-120's one serial file; the identity `src/authMode.ts:config` and agent
  `sso_mode.py:agent_config` wiring receivers; `ssoErrorRedirect` event per destination (`sso_login_error` on a login
  fault, `sso_link_failed` always for link); `prm.expected` includes `scopes_supported` (D-10); no migration-assertion
  file for the notify-less seed.
- Product-spec finding to raise at `/sdd-review impl-spec`: AC-77 row 1 ("no session cookie → GET /accounts/api/sso →
  401") holds at the handler only. Over HTTP the middleware redirects a request with no session cookie before the
  handler runs (`middleware.ts:80-83`), as for today's `/accounts/api/authorized-apps`; Step 43 asserts it at the handler.

## Open Threads (2026-11-24 sdd-spec)

- [ ] `/sdd-review authelia-sso impl-spec`: rule on the spec-level choices above and AC-77 row 1. Due before /sdd-execute.
- [ ] Step 4 needs a scratch Postgres 16 to regenerate `scripts/config-wiring-stored.json`, or the CI artifact. Due at Step 4.
- [ ] Step 25: paste the first `pnpm run typecheck` output. Due at Step 25.
- [ ] Config migration number re-checked at Step 4 and at merge (`056` vs 314/317/321). Due at Step 4 and merge.
- [ ] Cutover gates (homelab-edge), draft feature 280 overlap, feature 319 merge order: unchanged from the design run.
- Post-spec fix (orchestrator, 2026-11-24): AC-77 row 1 now expects the middleware redirect to `/auth/login` for a request
  with no session cookie (`middleware.ts:80-83`); the route's own 401 (stale token seen by the handler) stays a handler-level
  test in Step 43, as /sdd-spec flagged.

## Session 2026-11-24 — sdd-review impl-spec (advisory)

- Tree: `ccr-589817f0-cyg7gy@82ff78a ≡ origin/ccr-589817f0-cyg7gy` (⊇ `origin/main-dev@0dbc26b`).
- Result: 0 blocking failures, 7 warnings (advisory — did not block). Spec-level choices: OIDC scope, JWKS 300 s fresh +
  RS/PS/ES allow-list, extra config-wiring receivers, `sso_login_error`/`sso_link_failed`, `scopes_supported`, no seed
  assertion file — accepted; the `chromium-sso` project and the AC-77 handler-level 401 — accepted with fixes below.
- Unresolved ⚠ carried into execution:
  - Step 41 / Step 43: AC-77 row 1 now expects the middleware redirect (`acceptance.feature`); add a no-cookie
    `/accounts/api/sso` → `/auth/login` case to Step 41's `middleware.test.ts`, add AC-77 to its Covers and the coverage
    table, keep Step 43's 401 as a handler-level (stale-token) case, and update spec-level choice 5 (C-15) — [x] fixed 2026-11-24
    (final pre-merge review fixes, finding 4)
  - Step 52: add `testIgnore: /e2e\/sso\//` to the conditional `firefox` project (`playwright.config.ts:113-126`) or state
    firefox is excluded — [ ] unaddressed
  - Step 54 / Step 58: the cutover runbook and its grep must list the Authelia client prerequisites (ID-token `email`,
    `preferred_username`, `auth_time` via claims policy; fresh `auth_time` with `prompt=login` + `max_age=0`) and note the
    24 h stale-JWKS availability vs key-revocation trade-off — [x] fixed 2026-11-24 (final pre-merge review fixes,
    findings 1, 7, 10)
  - Step 37: drive `sso_login_error` and `login_disabled` in the `bffAllowlist` closed-set test — [ ] unaddressed
  - Step 1 / Step 2: `buf breaking --against …#branch=feature/authelia-sso` needs that branch; fall back to `main-dev` if it
    is absent — [ ] unaddressed
  - Step 4 / Step 3 / merge: re-check config `056` (314, 317, 321) and identity `007` at execute and merge — [ ] unaddressed
  - Step 6: the Node regex-mismatch check prints without asserting (Step 27 asserts) — [ ] unaddressed
- Overlap: config `056` and the 319 file overlap already recorded in `merge-order.md` (2026-11-24). New rebase-only overlaps,
  not yet in merge-order: `services/xstockstrat-config/src/grpc/authz.ts` (319), the `telemetry.ts` `:380/:381` seam (319),
  `telemetry.ts` (337), agent `main.py` (331), agent `tools.py`/`client.py` (309, 310, 314, 322, 327, 328), config-wiring
  files (314, 317, 321). Feature 317's spec still cites 345 as `053` (stale, 317's doc).

## Session 2026-11-24 — final pre-merge review fixes

- Source: the independent final review of PR #1602 (`ccr-589817f0-cyg7gy` → `main-dev`), 11 findings (1 blocking, 2–8
  should-fix, 9–11 nits). Tree `ccr-589817f0-cyg7gy@9baef57` (⊇ `origin/main-dev@0dbc26b`). Docs only; status stays
  `implementation-ready` (execution has not started, so spec-body edits are allowed and listed here).
- Owner decisions (2026-11-24):
  - **Finding 1 (scope).** Keep `OIDC_SCOPE = 'openid email profile'`. homelab-edge's SSO spec § 4.6 listed the web
    client `xstockstrat[-staging]-web` with `openid email`, which Authelia would refuse with `invalid_scope` (spike item
    (c)); the owner is amending § 4.6 to `openid profile email` in homelab-edge.
  - **Finding 8.** Feature 280-third-party-sso-oidc is `demoted/canceled`, superseded by 345 (its status.md,
    feature.md Status History and context.md updated).
  - **Finding 2.** The SSO spec gains the rate-limit zones over the password-accepting Link/re-auth POSTs (including
    `POST /accounts/api/sso/confirm`), S17 is extended to `max_age=0` + a fresh `auth_time` in the ID token, and
    `sso.md` § 6 lists the gates. All are homelab-edge changes, not merged at this commit.
- Fixes, per finding:
  1. Scope: design.md § 6 gate 3 now requires the web client registered with `openid profile email` (SSO spec § 4.6
     as amended) beside the claims policy (**D-119 gate 3 text amended**). design Open Risks "Edge cutover gates" names
     the scope. implementation-spec spec-level choice 1 and Step 32 cite the amendment; Step 54's runbook content and
     grep include it. product-spec Feature Workflow Notes lists it among the edge items to prove.
  2. Edge gates: product-spec Risks "Linking window" no longer says "tracked in homelab-edge"; it says homelab-edge is
     adding the zone (§ 4.3) and the gate list (`sso.md` § 6), tracked only here until that lands. design § 6 gates 1–2
     and Open Risks point at the § 4.3 zone and the S17 extension (D-119 gates 1–2: wording only).
  3. 319 ordering: the `merge-order.md` 345 vs 319 row is now a hard constraint (319 first or in the same train, D-52,
     the RevokeToken defect); the stale `telemetry.ts :380/:381` prose (BoundCounters are at `:390-404` on
     `main-dev@0dbc26b`) and the 337/331 rebase-only notes are dropped. product-spec Feature Workflow Notes says
     "first or alongside" (hard), with 324/331/323 rebase only.
  4. AC-77: FR-16.6 says a cookie-less request gets the middleware redirect (`middleware.ts:80-83`) and the routes'
     401 is the stale-token case. Step 41 adds the no-cookie `GET /accounts/api/sso` → `/auth/login` case and AC-77
     (row 1) to Covers; the coverage table maps AC-77 to 41, 43; Step 43 covers rows 2–8 plus the handler-level 401;
     spec-level choice 5 rewritten. design seam table gains rows 77 and 78 (mechanisms D-107/D-124 and D-136; no
     decision text changed).
  5. "both-mode" → "every-mode" (Origin 403, JSON on an expired session, the Sign-out button) in product-spec FR-14's
     table and Consumer Surface, design.md Build order (D-60/D-80 wording only) and the impl-spec Execution Summary.
  6. product-spec Config Key Changes, the impl-spec Execution Summary and Step 4's evidence cite the `merge-order.md` 345 vs
     314/317/321 row instead of the deleted 352 row; the 355 row's "same rule as the 345 row" now names the
     config-renumber row.
  7. The 24 h stale-key window (`_JWKS_STALE_MAX_S = 86400`, D-37; D-31's state machine): spec-level choice 2 names it;
     product-spec Risks and design Open Risks record it as pending owner sign-off before Step 19; Step 54's runbook
     content and grep include it. No decision text changed.
  8. See owner decision above.
  9. feature.md Summary no longer says SSO replaces password login and the OAuth server; Next Action is
     `/sdd-execute authelia-sso` after the open ⚠ items. The O-94 `/sdd-review product-spec` item is ticked in
     design.md Open Risks and the 2026-11-24 Open Threads.
  10. Step 54's runbook has the operator check the changed row's environment against the deployment's
      `APPLICATION_ENV` after `set-auth-mode` (both environments' rows exist in every database). The `--expect-database`
      flag was not added (would change D-108; propose separately if wanted).
  11. FR-10 records that the access JWT and its roles stay valid until `jwt.access_ttl_seconds` (default 900 s) as a
      bounded deviation from SSO spec § 3 "Sessions".
- Not changed: the `merge-order.md` row `third-party-sso-oidc` (280) vs 296 (`Resolved: No`) and the 306 row's
  "`047` owner is whichever of 306/280 merges first" still name 280; both are moot now that 280 is canceled, left for
  the owner or `/sdd-archiver`.

## Open Threads (2026-11-24 final pre-merge review)

- [ ] homelab-edge amendments (owner): SSO spec § 4.6 web client scopes `openid profile email`; § 4.3 rate-limit zone
      over `POST /accounts/api/sso/confirm` (and the other password-accepting Link/re-auth POSTs); S17 extended to
      `prompt=login` + `max_age=0` returning a fresh `auth_time`; `sso.md` § 6 listing design § 6 gates 1–4; `sso.md` § 4
      "Change an xstockstrat role" noting the web delay up to `jwt.access_ttl_seconds` (finding 11). Due before
      `set-auth-mode both` on a homelab deployment. S17 part done 2026-11-27: the SSO spec's S17 and § 3 "Linking"
      read `max_age=1` @ `0bbe7ca` and `sso.md` § 6 lists the gate (D-139; session "S17: max_age=1" below).
- [x] Owner sign-off on the 24 h stale-key window (`_JWKS_STALE_MAX_S`). Due before Step 19. Superseded 2026-11-27: the
      owner removed the window (D-138; session below).
- [ ] Remaining impl-review ⚠ items (Step 52 firefox `testIgnore`, Step 37 `bffAllowlist`, Step 1/2 `buf breaking`
      fallback, Step 4/3 migration re-check, Step 6 Node assert). Due at those steps.

## Session 2026-11-24 — second pre-merge review fixes

- Step 27: `serverLog.test.ts` already exists on `main-dev`; the step now modifies it and appends the `logOnce` cases after
  the existing tests (the OTel logger provider can be set only once).
- Gate 3 (D-119, design § 6): `auth_time` must be present in the ID token by default or via the claims policy, as spike S17
  shows; the claims policy lists `email` and `preferred_username`. This matches homelab-edge SSO spec § 4.6 at `3b4e7a5`.
- Step 23's cited range `test_auth_deadline.py:51-99` (the file has 99 lines).

## Session 2026-11-27 — owner decisions: no stale keys; no Claude Code clients

- Source: davcs86/homelab-edge `docs/superpowers/specs/2026-11-23-authelia-sso-respec.md` @ `1d12328` (branch
  `ccr-589817f0-cyg7gy`). Tree: `ccr-589817f0-cyg7gy` restarted from `origin/main-dev@f3a506d` (PR #1602 merged). Docs
  only; execution has not started (every step `pending`), so the step-body edits below are allowed (F-09 binds only
  during execution) and are listed here.
- **Decision 1 — no tokens on stale keys, no exceptions (owner).** SSO spec § 3 "Signing keys": a token or ID token is
  accepted only on a key from an issuer key set fetched within the last 3600 s; past that, a failed refresh refuses every
  token; no stale-key grace window anywhere.
  - debate.md: **P-6** (target D-2's stale-on-error, D-31's STALE_MAX branches, D-37's `_JWKS_STALE_MAX_S`, D-110's carry
    of them; user reopened) and **D-138** (`_JWKS_MAX_AGE_S = 3600` in the D-13/D-37 constant list; a token needing a key
    from an older set, known `kid` or not, waits for a refetch under D-31's single-flight task and 30 s cooldown; a failed,
    timed-out or cooled-down refetch → 503 `jwks_unavailable`, text/plain, no `WWW-Authenticate`; never a verify with the
    old keys). Status cells of D-2, D-31, D-37 and D-110 point at D-138; their decision text is unchanged. D-71 (which
    restated D-31's cooldown branch) was already superseded by P-4; nothing else to change there.
  - design.md: header register line; new "Amendment after approval (owner, 2026-11-27)" section (D-138); § 2 MCP status
    map step 4 gains the key-set-age branch; § 3 "Other UI pieces" gains one line on the UI's keys; § 7 seam row 79 and
    its footnote; Open Risks "Stale signing keys" ticked as superseded, with the availability residual.
  - UI relying party verified, no change: openid-client 6.8.9 with `enableNonRepudiationChecks` (D-29/D-34, Step 32);
    oauth4webapi 3.8.9 `getPublicSigKeyFromIssuerJwksUri` (`build/index.js:1026-1046`, tarball fetched 2026-11-27)
    clears and refetches the JWKS once the cached set is 300 s old and throws if that fetch fails.
  - acceptance.feature: **AC-79** (`@FR-2`): a known `kid` on a set 3601 s past its last successful fetch with the
    JWKS unreachable → HTTP 503, no `WWW-Authenticate`, `jwks_unavailable`, no verify with the cached key. AC-61 is
    unchanged (unknown `kid`); no existing scenario pinned the known-`kid` case.
  - product-spec.md: **Amended** line; Risks "Stale signing keys … pending owner sign-off" replaced by "Signing keys at
    most 3600 s old, no stale-key grace" (availability cost accepted by the owner). FR-2 unchanged (its "keys cannot be
    fetched → 503" sentence covers AC-79).
  - implementation-spec.md: spec-level choice 2 (`_JWKS_MAX_AGE_S`, sign-off superseded); coverage table AC-79 → 20, 24;
    Step 19 Instructions 1 (constant) and 4 (`key_for` per D-138); Step 20 Covers AC-61, AC-79 and the `test_jwks.py`
    cases (the "stale serve" and "beyond STALE_MAX → unknown" cases replaced); Step 24 Covers + AC-79 case in
    `test_sso_auth.py`; Step 54 cutover-runbook content (the signing-key rule replaces the 24 h trade-off; cites D-138)
    and its grep (`_JWKS_MAX_AGE_S` replaces `_JWKS_STALE_MAX_S`).
  - feature.md: Last Updated, an `(unchanged)` Status History row, the Artifacts register range, Next Action.
  - Open Threads: the stale-key sign-off item is ticked as superseded.
- **Decision 2 — no Claude Code clients on the homelab (owner).** SSO spec § 4.6 and decision 21 as amended: Claude.ai
  clients only; S9 retired (§ 11). FRs and config keys unchanged: the two `ui/oidc.mcp_client_id_claude_code*` keys (four
  rows) stay, and an empty value hides the line on the card (FR-11).
  - implementation-spec.md Step 54: the cutover runbook tells the operator to leave `oidc.mcp_client_id_claude_code` and
    `oidc.mcp_client_id_claude_code_readonly` empty in both environments on the homelab; its grep checks
    `mcp_client_id_claude_code`.
  - product-spec.md Feature Workflow Notes: the edge proofs before cutover are Claude.ai only (S1, S5); S9 is no longer
    cited as a gate.
  - Not changed (FR-level, owner call): FR-13 and AC-20 still require `docs/runbooks/mcp-tools.md` to list the four
    Claude Code client IDs and a loopback redirect, and FR-13 still cites "SSO spec S9" for that redirect; Step 54 item 2
    and Step 58's grep follow them. The Consumer Surface line "pre-registered … clients for Claude.ai and Claude Code" is
    a capability statement, not a homelab claim.
- Status stays `implementation-ready`: no FR changed and the new scenario is covered (C-15), so no SDD rule forces a
  re-review; an advisory `/sdd-review authelia-sso impl-spec` pass over Steps 19/20/24/54 is optional.

## Session 2026-11-27 — S17: max_age=1

- Source: spike S17 on the edge droplet (Authelia v4.39.28, 2026-11-27) and the owner's decision on it; davcs86/homelab-edge
  `docs/superpowers/specs/2026-11-23-authelia-sso-respec.md` § 3 "Linking" and § 11 S17 @ `0bbe7ca` (branch
  `ccr-589817f0-cyg7gy`) now read `max_age=1`. Tree: `ccr-589817f0-cyg7gy` @ `2d1316a` (PR #1631). Docs only; execution
  has not started (every step `pending`), so the step-body edits below are allowed (F-09 binds only during execution).
- **Spike evidence.**
  - `prompt=login` + `max_age=0` on a live portal session: the consent API reports `require_login: true` and issues no
    code until the person re-authenticates (re-authentication is forced).
  - After a correct re-authentication (`POST /api/firstfactor/reauthenticate`), with `max_age=0` the consent is still
    refused: `require_login` stays true and `POST /api/oidc/consent` → `{"status":"KO"}`; no code, ever. Authelia's
    `internal/oidc/util.go` `RequestFormRequiresLogin` returns true whenever `max_age == 0`.
  - `prompt=login` + `max_age=1`: the same re-authentication completes; code issued; the ID token's `auth_time` is fresh
    (≥ the request's start) and `email` and `preferred_username` are present.
- **Decision (owner).** Every Link SSO authorization request sends `prompt=login` and `max_age=1` instead of
  `max_age=0`. Unchanged: D-111's check (`auth_time` present and `≥ txn.created_at − OIDC_CLOCK_SKEW_S`) is the
  enforcement line, and `checks.maxAge` is still not passed to openid-client.
  - debate.md: **P-7** (target: D-119's `max_age=0` sentence; user reopened) and **D-139** (`max_age=1`, with the spike
    evidence). D-119's Status cell points at D-139; its decision text is unchanged. D-111 is not touched: its text never
    named `max_age` and its check stands.
  - design.md: header register line; the post-approval amendment section (now "Amendments") gains D-139; § 3 link-route
    row (`max_age=1`; D-119, D-139); § 6 heading cites D-139 and gate 2 reads `max_age=1`, proven 2026-11-27 on the spike
    (it stays a listed gate, as homelab-edge `sso.md` § 6 lists it); Open Risks "S17 unproven" ticked as resolved by the
    spike (re-authentication forced, fresh `auth_time` with `max_age=1`).
  - product-spec.md: **Amended** line; FR-16.1 link request `max_age=1` (with why not `0`); Feature Workflow Notes: S17
    removed from "still to be proven" and recorded as proven with `max_age=1`.
  - acceptance.feature: **AC-65** (same ID) names `max_age=1`; header comment records the change.
  - implementation-spec.md: Step 32 `buildSsoAuthorizationUrl` (`max_age: '1'`; D-119, D-139); Step 33 `oidcClient.test.ts`
    link URL case; Step 43 `/link` happy path; Step 53 e2e @AC-65 (the stub sees `prompt=login&max_age=1`); Step 54
    cutover-runbook S17 gate text, cite list (+D-139) and its grep (`"max_age=1"` replaces `"max_age=0"`). Step 50's stub
    IdP only records `prompt`/`max_age` (no value asserted there), so it is unchanged.
  - feature.md: an `(unchanged)` Status History row and the Artifacts register range.
  - Open Threads (2026-11-24 re-run; 2026-11-24 final pre-merge review): the S17 part of each gate item is noted done.
- Not changed: design § 6 gate 3 still says `auth_time` is present "by default or through the policy, as S17 shows"; the
  spike observed `auth_time`, `email` and `preferred_username` in the ID token but this record does not say whether the
  claims policy lists `auth_time`.
- Status stays `implementation-ready`: FR-16.1's parameter value changed with the owner's decision and AC-65 is still
  covered by Steps 33/43/53 (C-15); an advisory `/sdd-review authelia-sso impl-spec` pass over Steps 32/33/43/53/54 is
  optional.

## Session 2026-11-27 — re-ground on main-dev@187e9f8

- Source: a read-only check of PR #1631 against the latest `main-dev`. Tree: `ccr-589817f0-cyg7gy@2c1d154`
  (⊇ `origin/main-dev@187e9f8`; 31 commits since the spec's `0dbc26b`). Docs only; execution has not started (every
  step `pending`), so the step-body edits below are allowed (F-09 binds only during execution). No decision, FR, scenario
  or step design changed.
- **Config seed `056` → `060`.** `main-dev` has `056_analysis_live_only_cycle_max_days` (366, #1608),
  `057_mcp_deadline_budget` (314, #1622), `058_marketdata_bars_miss_backoff` (317, #1626) and
  `059_trading_broker_paper_per_environment` (321, #1630); `053` stays a gap. Identity `007` is still free (`006` is the
  highest). The new CI `migration-order-gate` (`ci.yml:1004-1024`, `scripts/check-migration-order.py`, feature 318 #1619)
  refuses an added up-file not above the base branch's maximum, which is Step 4's rule.
  - implementation-spec.md: Execution Summary seed sentence; Step Dependencies merge-order bullet (`060`; 319 satisfied);
    Step 4 title, Files, Codebase Evidence (`tail -6` → `057`–`059`; cites the gate), Instruction 1 and Verification
    (`060_*`, `grep -c '^060_'`); Step 5 title.
  - product-spec.md: **Amended** line; Config Key Changes `NNN` sentence (`060` on 2026-11-27; the gate).
  - design.md Open Risks: "Config migration number contested" ticked as settled.
  - feature.md: Reviewers DBA row (`060`); an `(unchanged)` Status History row.
  - merge-order.md: row 345 vs 314/317/321 **Resolved** (Yes); row 345 vs 319 **Resolved** (Yes: 319 merged first,
    #1610, 2026-11-26; `revokeToken` verifies at `identityServiceImpl.ts:284-293`).
- **Tree header** now `ccr-589817f0-cyg7gy@2c1d154 ≡ origin/ccr-589817f0-cyg7gy (⊇ origin/main-dev@187e9f8)`.
- **Line citations re-verified** at `187e9f8` (old → new; content unchanged unless noted below):
  - identity `identityServiceImpl.ts`: `authenticateUser` 150-206 → 151-207 and its sub-ranges +1; reply literals
    189-200 / 258-269 → 190-201 / 259-270; `rotateRefreshToken` 364 → 373; `listAdminUserIds` 988 → 997. `telemetry.ts`
    `recordAuditFailure` 426-429 → 434-437 (357-362, 380-388, 390 unchanged).
  - config `authz.ts` `SECRET_CALLER_ALLOWLIST` 136-155 → 143-162, notify grant 150-153 → 157-160 (`:74` unchanged).
  - agent: `watcher.py` `read_value` 68-77 → 73-82, `start_watchers` wait 92-97 → 97-102; `oauth_server.py` 28 → 29;
    `tools.py` 79/80 → 80/81, 139 → 140, 148 → 149, 178 → 179, 195 → 196, 218 → 219; `main.py` every cited range +2
    (`_authorized` 142-165, `handle_mcp` 197-223, routes 238-253); `client.py` `validate_token` 1595 → 1596.
  - `ci.yml`: `frontend-e2e` 609 → 611, coverage step 794 → 818, `scripts-python` 861-894 → 907-940, `migration-rerun`
    898 → 944, `config-wiring-stored` 1323 → 1444 (filters 59/62/64 unchanged). `config-wiring.json` receivers 105 → 94,
    141 → 131, forwarder 42 → 35. `deploy/homelab/compose.yml` `APP_URL` 285 → 307.
  - UI: `vitest.config.ts` include 20 → 24, coverage include 25 → 29, exclude 28 → 32, thresholds 29-33 → 33-37 (env `:19`
    and `:16` unchanged); `playwright.config.ts` `globalSetup`/`globalTeardown` 91-92 → 98-99, `baseURL` 94 → 101, projects
    98-125 → 105-132, `webServer` 128 → 135, `AGENT_PUBLIC_URL` 168 → 175.
  - Ledger `fails.md` 4236-4244 → 4251-4259; agent `CLAUDE.md` Config Keys Consumed 112 → 114.
- **Beyond line shifts** (flagged, not redesigned):
  - `migration-rerun` no longer replays every up-file: since 318 (#1619) it applies every migration once and replays only
    the feature-224/225 up-files ("Older up-files are not replayed.", `ci.yml:942-943`). Step 3's evidence now says so;
    its instruction (idempotent DDL) is unchanged. Spec-level choice 8 ("idempotence comes from `ON CONFLICT DO NOTHING`
    replayed by `migration-rerun`") no longer holds as written: the seed is applied once and no CI job replays it. Left
    for the owner or the next `/sdd-review authelia-sso impl-spec`.
  - `authz.ts` internal-caller grants gained an optional `peerSan` (319); Step 13's `SECRET_CALLER_ALLOWLIST` append is
    unaffected.
  - recon.md (the dated Phase-0 dossier) and design.md body citations still carry `0dbc26b` line numbers (e.g. design
    `main.py:195-221`, `tools.py:148,218`, `telemetry.ts:426-429`, `authz.ts:136-155`, `identityServiceImpl.ts:364`) and
    recon's `056`; not edited. product-spec Feature Workflow Notes "until 319 lands" is unchanged (319 has landed).
- Not changed: FR-13, AC-20 and Steps 54/58's Claude Code client documentation (open owner question, session "owner
  decisions: no stale keys; no Claude Code clients" above).
- Status stays `implementation-ready`.

## Session 2026-11-27 — owner answers (plans review)

- FR-13 / AC-20 / Steps 54 and 58 (Claude Code client documentation): **owner decided to keep them** (2026-11-27). The
  capability stays documented for other self-hosted deployments that register Claude Code clients; the homelab registers
  none and leaves the two `ui/oidc.mcp_client_id_claude_code*` keys empty (Step 54's cutover runbook already says so).
  The open thread at the 2026-11-27 entries above (FR-level owner call) is closed. FR-13's citation of the retired
  homelab-edge spike item S9 stays as the redirect's design reference for those deployments; no spec text changes.

## Session 2026-11-27 — sdd-execute (sequential), re-spec gate

- Tree: `feature/authelia-sso@4edfa94 ≡ origin/feature/authelia-sso` (created from `main-dev@4edfa94`).
- Mode: `sequential`, owner-confirmed in this session (mode entry, targeted re-spec, proceed). Owner chose **no
  checkpoints**: the run stops only for blockers or owner decisions; checkpoint reports are logged here instead.
- Re-spec gate (read-only validation of all 58 steps; every CREATE target absent; identity `007` and config `060` free):
  - **Step 10** (real mismatch): feature 319 (#1610) added an 8th inline `{ getInt }` config mock at
    `src/__tests__/revokeToken.test.ts:12`; Step 10's own `! grep "{ getInt:"` check would fail. Files, evidence,
    instruction 2 and the Step Dependencies bullet now list it (eight sites).
  - Citation-only: Step 11 `auditSafe` `:782-791`; Step 13 `hasSecretCallerAuthority` `:182-202`; Step 27
    `serverLog.test.ts` last changed `d758013`; Step 31 `src/lib/insightsBff.test.ts:11`; Step 32 `insights.md:2946-2954`;
    Step 46 `PlatformHeader.tsx:248-251`; Step 47 field `:208-228`, list `Card` `:245-267`; Step 52 `projects`
    `:105-134` (conditional `firefox` `:120-133`); Step 4/55 config-governance "Baseline" is a bold bullet at `:90`.
- Still open, flagged to the owner at mode entry: spec-level choice 8 (seed idempotence "replayed by
  `migration-rerun`") no longer holds since 318; the seed stays idempotent via `ON CONFLICT DO NOTHING` (Step 3/4 rule).

- Tooling setup (steps 1–58): node ⬇ 24.22.3 (`/opt/node24`; host default is 22) · pnpm ✓ 9.15.9 · uv ✓ · agent deps ⬇ (`uv sync --extra dev`) · docker ✓ 29.9.3 but the `Dockerfile.codegen` base-image pull got Docker Hub 429 → host-native codegen: buf ⬇ 1.72.0, protoc-gen-go ⬇ v1.36.11, protoc-gen-go-grpc ⬇ v1.6.2, protoc-gen-connect-go ⬇ v1.19.2, grpcio-tools ⬇ 1.80.0 (CI `proto-freshness` pins) · no database.

### Steps 1+2 — proto + proto-gen: four external-identity RPCs [done]
- Added `ResolveExternalIdentity`, `IssueSessionForUser`, `LinkExternalIdentity`, `GetExternalIdentityLinks` (each with a SAN comment) and their seven messages to `identity.proto`; regenerated the TS/Python/Go identity stubs.
- Verification: `pnpm --filter @xstockstrat/proto run build` exit=0; second `buf-gen.sh` run leaves `git diff --exit-code packages/proto/gen/` clean (exit=0, after reverting the two reflow files below); `buf lint` + `buf breaking --against …#branch=feature/authelia-sso` exit=0 (the branch exists, so the impl-review `buf breaking` fallback ⚠ is cleared without a fallback). TDD: N/A.
- Files modified: `packages/proto/identity/v1/identity.proto`, `packages/proto/gen/{go,python,ts}/identity/v1/*`, `packages/proto/gen/ts/dist/identity/v1/*`.
- Deviations: host-native codegen fallback; incidental `analysis.pb.go`/`trading.pb.go` doc-comment reflow not committed (Deviation Log).

### Step 3 — migration: identity 007_external_identities [done]
- Created `007_external_identities.{up,down}.sql` (`006` was the highest; `007` free — impl-review ⚠ "re-check identity `007`" cleared at execute). Offline check: both files exist, the constraint/IF NOT EXISTS grep counts 3, the down's `DROP TABLE IF EXISTS` inverts the up's single `CREATE TABLE IF NOT EXISTS`. TDD: N/A. Live apply deferred to CI.
- Files modified: `services/xstockstrat-identity/migrations/007_external_identities.up.sql`, `.down.sql`
- Deviations: none

### Step 4 — migration: config 060_authelia_sso_keys and the regenerated stored set [done]
- `060` re-checked at execute (highest `059`; impl-review ⚠ "re-check config `056`/`060`" cleared). Up: two `ON CONFLICT … DO NOTHING` statements, 16 plain rows (8 keys × 2 envs) + 2 secret rows, sentinel `system:config-migration-feature-authelia-sso`, no notify. Down: one sentinel- and seed-value-guarded `DELETE`; the secret row only while `value_encrypted IS NULL`.
- **Blocker resolved by the owner (2026-11-27): "Allow scratch Postgres"** — one throwaway local Postgres 16 (host binaries `/usr/lib/postgresql/16`, port 55432, data dir `/var/tmp/pg345`, stopped and removed after) to run `scripts/config-wiring-stored.py` (`migrate` v4.17.1, the `Dockerfile.migrate` pin). The diff adds the 18 new rows and changes only `inputs_sha256` (existing rows reproduced byte-for-byte).
- Verification: 2 `060_*` files; no `pg_notify`; `check-config-wiring.mjs --declared-migration …060…` exit=0 with 8 `PENDING` seeded-unread (readers land in Steps 7, 17, 30); `--final` shows 0 `STALE-STORED`. TDD: N/A.
- Files modified: `services/xstockstrat-config/migrations/060_authelia_sso_keys.{up,down}.sql`, `scripts/config-wiring-stored.json`
- Deviations: scratch Postgres used with owner sign-off (Deviation Log).

### Step 5 — test: Static seed test for 060 [done]
- `autheliaSsoSeedMigration.test.ts` (7 cases): two insert-if-absent INSERTs, no notify; 18 global sentinel rows; relative keys (`@AC-1 @feature-296`); **@AC-41** `auth.mode` = `local`/`local`; empty plain rows; the value-less secret rows; the guarded down.
- TDD: AC-41 red: with the `060` files moved aside, `findOne` → "expected exactly one *authelia_sso_keys.up.sql, got []" (exit 1) → green: `pnpm run lint` 0, `pnpm run test:coverage` 445/445 pass (exit 0), `c8 check-coverage --lines 40` 0 (94.33 % lines). C-13: single consumer, inline.
- Files modified: `services/xstockstrat-config/src/__tests__/autheliaSsoSeedMigration.test.ts`
- Deviations: none. Note: the `splitTopLevel`/`unquote`/`parseInsert` helpers are cloned from `notifyCommsgunSeedMigration.test.ts` as the step instructs ("clone the shape"); hoisting them into `migrationSql.ts` would touch files outside the step — a DRY follow-up candidate, not done here.

### Step 6 — config: Shared vector file, CI change filters and the config-wiring receivers [done]
- `scripts/testdata/oidc-issuer-vectors.json`: `issuer_pattern`, `app_url_pattern`, `issuer` (66) and `app_url` (16) copied verbatim from `git show 7eeab3d:…/design.md` 769–870 (value-equality asserted against the source while building); the old `mode` array dropped; new `mode` (10 rows, D-101/D-121), `refusals`, `prm`. Six `registry.receivers` added (identity `authMode.ts:config`; agent `sso_mode.py:{identity,agent}_config`; UI `oidcConfig.ts:{identity,ui,agent}.values`). The vector file added to the agent, identity and UI CI filters.
- Verification: counts `66 16 10 ['link','resolve','session'] ['agent_public_url','expected','issuer']`; python mismatches `[]`; node regex-only mismatches `[]` (so the impl-review ⚠ "Node check prints without asserting" has nothing to assert here; Step 27 still asserts); `receivers registered` exit=0; ci.yml count 3; `check-config-wiring.mjs --declared-from product-spec.md` exit=0. TDD: N/A.
- Files modified: `scripts/testdata/oidc-issuer-vectors.json`, `scripts/config-wiring.json`, `.github/workflows/ci.yml`
- Deviations: none

### Step 7 — service: Identity mode reader (src/authMode.ts) and the watcher hook [done]
- `src/authMode.ts`: `AUTH_MODES`, `parseAuthMode` (exact `local`/`both`/`oidc`, else `local` + invalid; absent → `local`, valid), `readAuthMode(config)` (the only read, `getString('auth.mode','local')`, `auth_mode_invalid` WARN once per distinct value), `watchAuthMode` (once, then on every `'update'`), `__resetAuthModeLogOnce`. `index.ts` calls `watchAuthMode(configWatcher)` after the snapshot.
- Verification: `pnpm run lint` exit 0 (0 errors, pre-existing warnings only); `pnpm run build` exit 0; hook grep → `src/index.ts:28`; `check-config-wiring.mjs --keys identity.auth.mode` exit 0. TDD: red/green recorded under Step 8 (one cycle).
- Files modified: `services/xstockstrat-identity/src/authMode.ts`, `services/xstockstrat-identity/src/index.ts`
- Deviations: none

### Step 8 — test: authMode parsing, log-once, watcher re-parse and the seeded row [done]
- `authMode.test.ts` (5 cases: the 10 shared `mode` vectors; **@AC-72** log-once per distinct value; **@AC-31** absent → `local`, no log; the key/default read; **@AC-71/@AC-44** identity leg, re-parse on `'update'`) and one `configWatcher.test.ts` case (seeded `both` → `both`; `''` → `local` + one WARN; no key → `local`). The `index.ts` hook is the labelled grep guard (D-129).
- TDD: red: `tsc` → "TS2307: Cannot find module '../authMode'" (exit 2; behaviour absent) → green: lint 0, `test:coverage` 175/175 pass (exit 0), `c8 check-coverage --lines 40` exit 0 (85.7 % lines); guard `src/index.ts:28`.
- Files modified: `services/xstockstrat-identity/src/__tests__/authMode.test.ts`, `services/xstockstrat-identity/src/__tests__/configWatcher.test.ts`
- Deviations: none. Note: the existing `seeded()` helper always feeds `opens[0]`, so the new case clears `opens` before each fresh watcher (helper itself unchanged).

### Steps 9+10 — verifyPassword, sessionResponse and the oidc password gate; fakeConfig and the gate tests [done]
- Step 9: private `verifyPassword({email}|{userId}, password)` (one `SELECT … is_active` with no active filter; unknown → inactive → blocked_default_admin → bad_password; no metric, no log); exported pure `sessionResponse(minted, refreshToken, claims)` replaces both reply literals; `authenticateUser` refuses `oidc` with code 7 `password login disabled` before any query; `LoginFailureReason` gains `password_login_disabled`.
- Step 10: `fixtures/fakeConfig.ts`; all **eight** inline config mocks replaced (incl. `revokeToken.test.ts`, re-spec 2026-11-27); new cases **@AC-16** (code 7, zero queries, counter +1), **@AC-17** both and **@AC-31** absent → token pair, inactive-by-email → 16 `unknown_or_inactive` with no bcrypt, frozen-clock D-122 shape parity for login and refresh (no `aud`); `telemetryAllowlist` drives `password_login_disabled`.
- TDD: AC-16 red (Step 9 reverted): `tsc` TS2345 `"password_login_disabled"` not a `LoginFailureReason`; with only the union added, 4 fail incl. "@AC-16 oidc refuses password login with code 7 before any query" and the inactive/no-bcrypt case (exit 1) → green: lint 0 errors, build 0, `sessionResponse(` ×3, `test:coverage` 180/180 (exit 0), c8 ≥ 40 (85.77 %), fakeConfig imported by the three named files, no `{ getInt:` left.
- Files modified: `src/grpc/identityServiceImpl.ts`, `src/telemetry.ts`, `src/__tests__/fixtures/fakeConfig.ts`, `src/__tests__/{identityServiceImpl,identityServiceImpl.otlp,identityTelemetry,revokeToken,telemetryAllowlist}.test.ts` (under `services/xstockstrat-identity/`)
- Deviations: existing authenticate stubs needed `is_active: true` on their user rows and the otlp stub's SQL matcher updated (`SELECT user_id, email, password_hash`), because the query now selects `is_active` instead of filtering on it — within Step 10's Files; no assertion was weakened.

### Step 11 — service: The four SAN-gated external-identity RPCs [done]
- `adminDirectory.ts` exports `AdminDirectoryCall`, `peerDnsSans` and the new exact-match `hasPeerSan`; new header-blind `grpc/externalIdentity.ts` (refusal sets, the two constraint names, per-RPC SAN lists, `peerDenied`); `identityServiceImpl.ts` gains `resolveExternalIdentity`, `issueSessionForUser`, `linkExternalIdentity` (mode `both` gate before pool/bcrypt; `verifyPassword({userId})`; constraint-name 23505 mapping with one owner re-read and one retry; best-effort `identity.external.linked` audit) and `getExternalIdentityLinks`, each SAN-gated first; `telemetry.ts` adds `identity.external.linked` to `AUDIT_EVENT_TYPES` (doc "The audited event types") and `identity.link.failures{reason}` / `recordLinkFailure`.
- Verification: lint 0 errors; build 0; `externalIdentity.ts` "header-blind OK"; `hasPeerSan` at `adminDirectory.ts:22` and `identityServiceImpl.ts:10,1034`. TDD: recorded under Step 12.
- Files modified: `services/xstockstrat-identity/src/grpc/{adminDirectory,externalIdentity,identityServiceImpl}.ts`, `services/xstockstrat-identity/src/telemetry.ts`
- Deviations: none

### Step 12 — test: SAN gates, resolve, link, sessions, refusal contract and the audit seam [done]
- `fixtures/sanCall.ts` (`callWith` moved verbatim from `adminDirectory.test.ts`, which now imports it); `externalIdentity.test.ts` (33 cases): SAN gates with zero pool access (@AC-27/38/70/73, prefix SAN, no auth context + spoofed headers); Resolve @AC-1/2/3/6/7; IssueSession 5/9/@AC-4 (stored email, no `aud`, `client_id` NULL); Link @AC-75 (local/oidc/absent: zero pool calls, `bcrypt.compare` spy untouched, counter), @AC-65 (one INSERT, audit keys `{issuer,outcome,user_id}`, caller `x-user-id`), @AC-66, blocked seed admin, inactive, @AC-67, @AC-4/@AC-25 PKEY + other owner, same owner, vanished-owner retry, second-failure 13; GetLinks order + `[]`, @AC-50 identity leg; contract (refusals = vector file; both `CONSTRAINT <name>` in `007`). `identityTelemetry.test.ts` **@AC-28** (real ledger audit to `localhost:1` → OK reply, `identity.audit.failures{identity.external.linked}` = 1, ERROR logged); `telemetryAllowlist.test.ts` (audited type not `other`; `identity.link.failures` keys `['reason']`).
- TDD: red (Step 11 reverted): `tsc` TS2307 `Cannot find module '../grpc/externalIdentity'`, TS2339 `linkExternalIdentity` missing, TS2551 `recordLinkFailure` missing (exit 2) → green: lint 0 errors, `test:coverage` 211/211 (exit 0), c8 ≥ 40 (85.68 %); guards AC-25 (`007:8`), AC-33 (`identityServiceImpl.ts:404`, test `:1303`, UI `middleware.test.ts:250`), AC-6 (`.do/app.yaml:87`, `.do/app.dev.yaml:87` — the `25061/<db>` comment lines; the URL itself is on `:88`).
- Files modified: `services/xstockstrat-identity/src/__tests__/{externalIdentity,adminDirectory,identityTelemetry,telemetryAllowlist}.test.ts`, `services/xstockstrat-identity/src/__tests__/fixtures/sanCall.ts`
- Deviations: none

### Step 13 — service: GetSecret grant for ui/oidc.client_secret [done]
- Appended `{ callerID: 'ui', namespace: 'ui', keys: ['oidc.client_secret'], peerSan: 'xstockstrat-ui' }` to `SECRET_CALLER_ALLOWLIST`; no other grant changed.
- Verification: lint exit 0; `callerID: 'ui'` at `authz.ts:163`. TDD: recorded under Step 14.
- Files modified: `services/xstockstrat-config/src/grpc/authz.ts`
- Deviations: none

### Step 14 — test: The ui secret grant is header- and SAN-bound [done]
- `secretCallerAuthz.test.ts` "ui grant (feature 345)": `ui` + SAN `xstockstrat-ui` → true; agent SAN, `xstockstrat-uix`, no SAN, callerID `agent`, key `oidc.client_id`, no header → false. `secretsAndScope.test.ts`: real-mTLS `xstockstrat-ui`/`xstockstrat-agent` leaves; **@AC-35** UI peer gets the decrypted value, the agent peer with the same `x-internal-caller: ui` header → `PERMISSION_DENIED`.
- TDD: AC-35 red (no grant): "@AC-35 authorizes ui…" and "@AC-35 the UI peer reads…" fail (exit 1) → green: lint 0, `test:coverage` 449/449 (exit 0), c8 ≥ 40 (94.35 %).
- Files modified: `services/xstockstrat-config/src/__tests__/secretCallerAuthz.test.ts`, `services/xstockstrat-config/src/__tests__/secretsAndScope.test.ts`
- Deviations: none

### Step 15 — service: manage-users.py set-auth-mode and unlink-sso [done]
- `set-auth-mode <value> --environment --reason`: value checked before any connection (exit 2), `DATABASE_URL` required (exit 1, no `.env` fallback), prints redacted host + database and both environments' rows before/after, one always-notifying CTE (D-108), 0 rows → `local` ok / `both`/`oidc` "seed migration not applied" exit 1; help names break-glass and rollback. `unlink-sso <email> [--issuer] [--force]`: exact email lookup, confirm unless `--force`, `DELETE … RETURNING issuer`, 0 rows → exit 1, prints the relink sentence; never prints a subject. Usage docstring lists both.
- Verification: `ruff check` and `ruff format --check` clean; `--help` lists `set-auth-mode` and `unlink-sso`. TDD: recorded under Step 16.
- Files modified: `scripts/manage-users.py`
- Deviations: none (the commands sit above the existing `if __name__ == "__main__"` guard so Typer registers them).

### Step 16 — test: set-auth-mode and unlink-sso [done]
- `_mock_conn` gains optional `fetchall_returns`; `TestSetAuthModeCmd` (**@AC-71** row 2 exit 2 + no connect; row 1/**@AC-44** `both`/`local` parameters, sentinel, `pg_notify` identity/auth.mode; 0 rows local ok / oidc exit 1; no `DATABASE_URL` exit 1), `TestUnlinkSsoCmd` (**@AC-50** `--force` delete + relink sentence; declined confirm deletes nothing; unknown email 1; nothing deleted 1; `--issuer` narrows), two `TestSqlParameterization` cases.
- TDD: red (Step 15 reverted): 13 failed, 44 passed → green: ruff clean, `pytest tests/test_manage_users.py` 57 passed; full `scripts/` suite 543 passed.
- Files modified: `scripts/tests/test_manage_users.py`
- Deviations: none

### Checkpoint (logged, not paused — owner chose no checkpoints) — backend Steps 1–16 done
- Next surface: agent (Steps 17–24). Out-of-scope changes: none. Open items: spec-level choice 8 (seed idempotence no longer replayed by `migration-rerun`). Unaddressed review warnings: Step 52 firefox `testIgnore`, Step 37 `bffAllowlist` (Steps 1/2 `buf breaking`, 3/4 migration numbers and Step 6 Node assert cleared). Deviations: Steps 1+2 host codegen; Step 4 scratch Postgres (owner).

### Step 17 — Agent mode foundation (PyJWT, sso_mode.py, the identity watcher) [done]
- `pyjwt[crypto]>=2.15.0` is now a direct dependency (`uv lock`); `watcher.py` watches `identity` too and exports the `read_config_value` alias; new `app/sso_mode.py` (`ISSUER_PATTERN` = the vector literal, `is_valid_issuer`, `AUTH_MODES`, `parse_auth_mode`, `_log_once`/`_reset_log_once`, `current_auth_mode` via receiver `identity_config`, `agent_issuer` via receiver `agent_config`).
- Verification: `uv lock --check` ok; ruff check + format clean; `pytest --cov=app --cov-fail-under=40` 941 passed (88.77 %); `check-config-wiring.mjs --keys identity.auth.mode,agent.oidc.issuer` exit 0. TDD: recorded under Step 18.
- Files modified: `services/xstockstrat-agent/{pyproject.toml,uv.lock,app/sso_mode.py,app/config/watcher.py}`
- Deviations: none. Note: the host uv (0.11.32) rewrote the lock header `revision = 5` → `3`; restored to `5` by hand (`uv lock --check` passes), so the lock diff is only the two `pyjwt` lines.

### Step 18 — Agent vectors and mode resolution [done]
- `test_oidc_vectors.py` (pattern literal, 66 issuer rows, 10 mode rows → `(expected, logs)`); `test_sso_mode.py` (**@AC-72** `sso` → `local`, one `auth_mode_invalid` over two calls; **@AC-31** absent → `local`, no log; `oidc` returned; **@AC-55** `http://auth.example.test` → `(…, False)`, one ERROR `sso_issuer_invalid` `reason=agent_issuer`, a second distinct value logs again; valid issuer silent; `identity` watched); `conftest.py` autouse `sso_mode_log_once`.
- TDD: red (before Step 17): collection `ImportError: cannot import name 'sso_mode' from 'app'` (2 errors) → green: `pytest --cov=app --cov-fail-under=40` 941 passed (88.77 %), the two new files 83 passed; ruff check + format clean; `install_watcher` used in `test_sso_mode.py:7,20,35`.
- Files modified: `services/xstockstrat-agent/tests/{test_oidc_vectors,test_sso_mode,conftest}.py`
- Deviations: none

### Step 19 — Async JWKS and discovery cache (app/jwks.py) [done]
- New `app/jwks.py`: the seven F-07 constants (`_JWKS_MAX_AGE_S = 3600`, D-138), `JwksError`, `discovery(issuer)` (600 s cache, no redirects, `Accept-Encoding: identity`, Content-Length + streamed 64 KiB cap, byte-exact `issuer`, same-origin `jwks_uri` on every refetch), per-issuer `_IssuerKeys` with a single-flight task under `asyncio.timeout(5)` (sole writer; done-callback retrieves the exception), per-key ingest skip with one WARN, `key_for` per D-31/D-138 returning `(PyJWK, jwk_alg)` | `'unknown_kid'` | `'unavailable'`, `_reset_for_tests`.
- Verification: ruff check + format clean; `python -c "import app.jwks"` ok. TDD: recorded under Step 20.
- Files modified: `services/xstockstrat-agent/app/jwks.py`
- Deviations: none. Notes: the clock is the module function `_now()` (monotonic) so tests can patch it; a JWK without a string `kid` counts as unusable (skipped with the WARN), since a token must name a `kid`.

### Step 20 — JWKS state machine [done]
- `conftest.py` session `sso_keys` fixture (C-13: RSA key + JWKS, a `rotated_jwk` under the same `kid`, `mint(headers=, signer=, **claims)` RS256 `typ=at+jwt`); `test_jwks.py` (16 cases, respx + fake `_now` clock): fresh hit, FRESH..MAX_AGE serve + background refresh, **@AC-79** known `kid` 3601 s past its fetch + JWKS 500 → `'unavailable'`, inside the cooldown no new fetch, then a refetch → the rotated key; never-fetched cooldown; **@AC-61** unknown `kid` + JWKS 500 → `'unavailable'`; ok but absent → `'unknown_kid'`; 30 s cooldown count; 5 concurrent callers share one fetch; trailing-slash discovery issuer, cross-origin `jwks_uri` (also on a cached-then-expired refetch), 302 not followed, oversized body; EdDSA/`none`/alg-less/broken JWKs skipped with one WARN each, only-unusable → `'unavailable'`; a failed unawaited refresh logs no "never retrieved".
- TDD: red (before Step 19): collection `ImportError: cannot import name 'jwks' from 'app'` → green: `test_jwks.py` 16 passed; full `pytest --cov=app --cov-fail-under=40` 957 passed (89.01 %); ruff clean; `def sso_keys` at `conftest.py:404`, no `generate_private_key` in `test_jwks.py`. Mutation checks: dropping the done-callback's `t.exception()` fails the never-retrieved case; serving keys past MAX_AGE fails the AC-79 case.
- Files modified: `services/xstockstrat-agent/tests/{test_jwks,conftest}.py`
- Deviations: none

### Step 21 — Effective scope, the resolve client helper and the new rejection reasons [done]
- `scopes.py`: `_OAUTH_SCOPE_BITS`, `MCP_SCOPES_SUPPORTED` (read, write, admin, trade), `granted_scopes`, `scopes_to_mask`, `effective_access_scope` (key presence wins, 0 included); `tools.py` both sites (`_caller_access_scope`, `CallerPropagationMiddleware`) call it and the import swaps `roles_to_access_scope` for it; `client.py` `rpc_timeout_s()` beside `_RPC_TIMEOUT_S` and `resolve_external_identity(issuer, subject, *, trace_id, timeout_s)` (own identity channel, lazy `gen.identity`, `metadata=[("x-trace-id", …)]`, `timeout=timeout_s`, roles via `Role.Name(r).removeprefix('ROLE_').lower()`); `tool_metrics.py` docstring adds `jwks_unavailable | account_refused`.
- Verification: ruff check + format clean; `grep -c effective_access_scope app/tools.py` = 3; the resolve body shows `metadata=[("x-trace-id", trace_id)]` and `timeout=timeout_s`. TDD: recorded under Step 22.
- Files modified: `services/xstockstrat-agent/app/{scopes,tools,client,tool_metrics}.py`
- Deviations: none

### Step 22 — Scope narrowing at both sites, the resolve helper and the telemetry allow-list [done]
- `test_sso_scope.py` (13 cases): **@AC-12** trader & `read` → 1; **@AC-13** viewer & all four → 1; **@AC-22** trader & `read write` → 3; `scope` string = `scp`; neither → 0; non-list `scp` → `scope` fallback; bit map + `MCP_SCOPES_SUPPORTED` order; key-presence (0) at `effective_access_scope`; both sites (`_caller_access_scope`, `CallerPropagationMiddleware`) honour stamped 3 and 0, `scp=[]` → `x-access-scope 0`; legacy claims keep `roles_to_access_scope` (PRESERVE). `test_telemetry_allowlist.py` `_drive()` records `jwks_unavailable` and `account_refused`. `test_client_deadlines.py`: `resolve_external_identity` passes `timeout=4.5` and exactly `[("x-trace-id", …)]` on the identity channel, maps roles; `rpc_timeout_s()` reads the patched constant; the AST deadline guard allow-lists `(resolve_external_identity, ResolveExternalIdentity): timeout_s`.
- TDD: red (before Step 21): 13 failed (`AttributeError: module 'app.scopes' has no attribute 'scopes_to_mask'` / `'app.client' has no attribute 'resolve_external_identity'`, …), 27 passed → green: full `pytest --cov=app --cov-fail-under=40` 971 passed (89.11 %); the two files 36 passed; ruff clean.
- Files modified: `services/xstockstrat-agent/tests/{test_sso_scope,test_telemetry_allowlist,test_client_deadlines}.py`
- Deviations: none. Note: the telemetry allow-list case was green before Step 21 too (`record_auth_rejected` takes any label; Step 21 only documents the two values), so its RED is not behavioural.

### Step 23 — oidc token validator, role cache, the status map and mode-gated routes [done]
- New `app/sso_auth.py`: `AGENT_PUBLIC_URL` from `oauth_metadata`, F-07 `_ROLE_TTL_S = 60.0` / `_CLOCK_SKEW_S = 30`, `RESOLVE_REFUSALS`, `Outcome` + `Verdict`, `_precheck` (non-empty `kid`, allow-listed `alg`, `typ` at+jwt case-insensitive, dict payload with `iss == issuer`), `authenticate` under one `asyncio.timeout_at(loop.time() + client.rpc_timeout_s())` (discovery, `key_for`, verified decode with strict `exp`, exact `aud` X/[X] → else `wrong_audience`, non-empty `sub`; success-only `(iss, sub)` cache on a monotonic `_now()`; `client.resolve_external_identity` with the remaining budget; the refusal/UNAVAILABLE/INTERNAL map), stamped claims `{user_id, roles, access_scope, trace_id}`, `_reset_for_tests`. `main.py`: `handle_mcp` reads `current_auth_mode()` per request (after the removed-transport 404); `oidc` → `_handle_oidc` (invalid issuer → `internal_error` 503 before the bearer check; `missing_bearer` 401; OK stamps claims; 403 `_send_forbidden` text/plain; else 503); `_legacy_only` wraps the AS-metadata and four `/oauth/*` routes (404 text/plain in `oidc`). `oauth_metadata.py`: PRM in `oidc` → `{resource, authorization_servers: [issuer], scopes_supported}` or 503 text/plain `no-store`.
- Verification: ruff check + format clean; `pytest tests/test_oauth.py tests/test_streamable_http_auth.py tests/test_auth_deadline.py` 30 passed; no `_RPC_TIMEOUT_S` in `sso_auth.py`; `check-config-wiring.mjs --keys identity.auth.mode,agent.oidc.issuer` exit 0. TDD: recorded under Step 24.
- Files modified: `services/xstockstrat-agent/app/{sso_auth,main,oauth_metadata}.py`
- Deviations: none. Interpretations of unstated branches (design § 2 step 4 "JWKS lookup … failed or timed out → 503 `jwks_unavailable`"): a discovery failure (`JwksError`/`httpx.HTTPError`) and an overall timeout before the decode both record `jwks_unavailable`; a timeout during Resolve records `identity_unavailable`; a Resolve reply with `is_active = false` is treated as the `account inactive` refusal (403, not cached). The three-line bearer extraction moved into a local `_bearer_token(scope)` shared by `_authorized` and the `oidc` path (no behaviour change; the local regression net is green).
