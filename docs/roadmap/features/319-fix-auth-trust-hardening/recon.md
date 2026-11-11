# Recon: fix-auth-trust-hardening

**Created**: 2026-11-11
**From**: product-spec.md
**Tree**: detached at origin/main-dev@c4fd48b0 (no `feature/fix-auth-trust-hardening` branch existed at recon time). Discovery digests were UNSTAMPED; every `path:line` below was re-grepped on this tree.
**Affected services**: xstockstrat-config, xstockstrat-trading, xstockstrat-identity, xstockstrat-agent

---

## Objective

Close three auth edges that trust unverified input:
1. **Config.** The `SetConfig` internal-caller grant `trading-reconciliation-poller` honours the `x-internal-caller` header with no mTLS peer check. It must require peer DNS SAN `xstockstrat-trading`, using the binding the `GetSecret` grants already use.
2. **Identity.** `RevokeToken` revokes every refresh token of a `user_id` it got from an unverified `jwt.decode`. It must verify the signature with `ignoreExpiration`.
3. **Agent.** `/oauth/register` treats an unreadable registration policy as permissive. Per the operator sign-off of 2026-11-10 (context.md), it must fail closed: 503 and no `client_id`.

## Codebase Map

- **`xstockstrat-config`** (Node.js/TS)
  - Grant type with no `peerSan`: `interface InternalCallerGrant` at `services/xstockstrat-config/src/grpc/authz.ts:76`. The grant `callerID: 'trading-reconciliation-poller'` is at `authz.ts:86` (`namespace: 'platform'`, `key: 'trading_state'`, `allowedTargetValues: ['REDUCE_ONLY','HALTED']`, per digest, lines 84-92).
  - Gate: `export function hasInternalCallerAuthority(` at `authz.ts:104`. It takes `(md, namespace, key, targetValue)`, i.e. Metadata only, so it cannot read the peer certificate.
  - Only non-test caller: `services/xstockstrat-config/src/grpc/configServiceImpl.ts:681` passes `call.metadata`. That must change to `call`.
  - Deny path: `configServiceImpl.ts:687-711` logs `reason: 'no_admin_or_internal_grant'` at error level and returns `ADMIN_SCOPE_ERROR` (PERMISSION_DENIED) at `:709`.
  - Audit author: `configServiceImpl.ts:729` `const author = callerUserId || (internalCallerAuthorized ? (callerIdentity ?? '') : '');`. A peer-mismatched caller that is treated as unauthorized is therefore never attributed.
  - Last migration: `047_config_alias_removal_rows.up.sql` (`services/xstockstrat-config/migrations/`). None needed.
  - Contract doc: `services/xstockstrat-config/CLAUDE.md` invariant 7 (line 44 onward) describes the grant as header-only. Invariant 6 (line 43) describes the `GetSecret` `peerSan` binding.
- **`xstockstrat-trading`** (Go)
  - Legitimate caller: `services/xstockstrat-trading/internal/service/trading.go:2270` `s.configSetter.SetConfig(ctx, "trading-reconciliation-poller", …)`.
  - mTLS dial to config: `services/xstockstrat-trading/internal/config/config.go:70` `mtls.ClientConfig("xstockstrat-config")`. It presents trading's own leaf (`internal/mtls/mtls.go:61-72` per digest 2).
  - Leaf SAN provisioning: `scripts/gen-dev-certs.sh:28` lists `xstockstrat-trading` in `SERVICES`, and `:50` sets `subjectAltName = DNS:${svc}`. `docs/runbooks/inter-service-mtls-rollout.md:8,18` says leaves are minted by that script with SAN = the registry service name. So trading's leaf SAN is `xstockstrat-trading`, and no trading code change is needed.
  - Test constant: `services/xstockstrat-trading/internal/testdata/caller_ids.go:5` `ReconciliationPollerCallerID`.
  - Last migration: `011_offline_fees_snapshot_headers.up.sql`. None needed.
- **`xstockstrat-identity`** (Node.js/TS)
  - Buggy handler: `services/xstockstrat-identity/src/grpc/identityServiceImpl.ts:279` `async revokeToken`. The comment `// Decode without verify to handle expired tokens` is at `:283`, and `(jwt as any).decode(token)` follows it. The handler returns `success:true` for an empty token, and its catch returns `{ code: 13 }`.
  - Pattern already in this file (digest 3 missed it; its grep `jwt\.verify` does not match the `(jwt as any).verify` spelling):
    - `validateToken` at `:211`, with `(jwt as any).verify(token, this.jwtSecret)` at `:218`.
    - `private get jwtSecret()` at `:130`. It throws when `JWT_SECRET` is unset (`:132-134`).
    - Signing at `:320` is `(jwt as any).sign(claimsPayload, this.jwtSecret, { expiresIn })`. That uses the default HS256 and adds `aud` only for OAuth (`:319`).
  - Failure-reason helper: `validateFailureReason` at `:24`, which reads the env var (`'secret_missing'` at `:25`).
  - Last migration: `006_user_metadata.up.sql`. None needed.
  - Findings row to clear: `services/xstockstrat-identity/docs/context-constitution-findings.md:60` (linked from `services/xstockstrat-identity/CLAUDE.md:4`, "⚠ unsigned-token revoke").
- **`xstockstrat-agent`** (Python)
  - DCR handler: `services/xstockstrat-agent/app/oauth_server.py:76` `async def register`.
  - Fail-open read 1: `oauth_server.py:87` reads `oauth.registration_enabled`, and `:89` logs `defaulting to enabled`.
  - Fail-open read 2: `oauth_server.py:105` reads `oauth.allowed_redirect_uris`, and `:107` logs `defaulting to empty allowlist`.
  - Error JSON shape: `oauth_server.py:138` returns `JSONResponse({"error": "server_error"}, 500)`.
  - Import alias: `oauth_server.py:28` `from app.config.watcher import read_value as read_config_value`.
  - Config-read pattern: `services/xstockstrat-agent/app/config/watcher.py:64` `get_watcher`, and `:68` `read_value`. `read_value` returns `None` when there is no watcher. Through `app/config/watch_core.py:189` `_lookup` it also returns `None` when `_snapshot is None` (`:194-196`) and when the key is absent. It never raises on a stall. Boot waits on `wait_for_snapshot(SNAPSHOT_WAIT_TIMEOUT_S)` (`watcher.py:97`).
  - `_CONFIG_READ_TIMEOUT_S = 3.0` is at `services/xstockstrat-agent/app/client.py:41`. It is used by `get_config_value`, not by the DCR path.
  - Degraded-metric precedent: `app/tools.py:2675` `tool_metrics.record_degraded("policy_default")`.

## Patterns to REUSE

- **SetConfig SAN binding.** Reuse the `GetSecret` mechanism in the same file:
  - `peerSan?: string` field (`authz.ts:133`), with grants `peerSan: 'xstockstrat-marketdata'` (`:141`) and `'xstockstrat-ingest'` (`:147`)
  - `export interface SecretCallerCall { metadata?, getAuthContext? }` (`:152`)
  - `function peerDnsSans(call)` (`:158`, module-private)
  - predicate `(grant.peerSan === undefined || peerDnsSans(call).includes(grant.peerSan))` (`:185`)
  - log-only reason function `secretDenialReason` (`:205`, `peer_san` branch at `:222`)
  - `hasPeerDnsSan` (`:228`)

  Do not write a second SAN parser.
- **RevokeToken verify.** Reuse `this.jwtSecret` and the `(jwt as any).verify(...)` idiom from `validateToken` (`identityServiceImpl.ts:218`), adding `{ ignoreExpiration: true }`. Do not require `aud` (IDENTITY-4: only OAuth tokens carry it).
- **DCR fail-closed.** Reuse the `JSONResponse({"error": …}, status)` shape (`oauth_server.py:138`). `record_degraded` (`tools.py:2675`) is an option only if its closed label set allows it (see @AC-47 below).
- **Config tests.** Copy peer-SAN fakes from:
  - `services/xstockstrat-config/src/__tests__/secretCallerAuthz.test.ts`
  - `peerSanSpike.test.ts` (real grpc-js `getAuthContext`)
  - `configServiceImpl.test.ts:679-680` (`getAuthContext: () => … { sslPeerCertificate: { subjectaltname: san } }`)
- **Agent tests.** Use `services/xstockstrat-agent/tests/test_oauth.py` (Starlette `TestClient`; snapshot edit pattern at `:162`).

## Existing Business Rules (preserve / extend)

Folded from the scenario-recon digest (digest 5).

- **CHANGE** `@AC-2 @FR-2 @regression @feature-241` "An automated internal-caller write is attributed to its x-internal-caller identity" (`services/xstockstrat-config/acceptance/fix-config-audit-author-spoof.feature`). The Given has no mTLS peer, but the write will now succeed only from peer DNS SAN `xstockstrat-trading`. The attribution Thens are preserved. This needs a Given amendment in place plus a `@feature-319` tag (fails.md, 2026-11-04 fix-marketdata-secret-exposure: amend a tightening's preconditions in place, do not promote "alongside"), with sign-off recorded in context.md.
- **CHANGE** `@AC-5 @FR-1 @regression @feature-296` "The previous-image reconciliation poller can still escalate during rollout" (`services/xstockstrat-config/acceptance/fix-config-keys-contract.feature`). The success path now requires SAN `xstockstrat-trading`. The canonicalise-WARN and ACTIVE-denied Thens are preserved.
- **CHANGE** `@AC-25 @FR-1 @regression @feature-295` "Internal-caller grants and write bounds match on the canonical key" (`services/xstockstrat-config/acceptance/fix-config-keys-drift.feature`). The grant write now requires SAN `xstockstrat-trading`. The `[1,1000]` bound Then and the exact-key match are preserved.
- **CHANGE** `@AC-4 @FR-2 @regression @feature-247` "OAuth dynamic client registration does not hang" (`services/xstockstrat-agent/acceptance/fix-agent-getconfig-deadline.feature`). An unreadable policy now yields 503 with no `client_id` instead of 201. The no-hang bound is kept. Operator sign-off is recorded in context.md (Session 2026-11-10, operator decisions).
- **PRESERVE** `@AC-3 @FR-3 @FR-2 @regression @feature-241` "A write with a free-text author but no propagated identity is rejected" (same 241 file). It must stay `INVALID_ARGUMENT` with no write.
- **PRESERVE** `@AC-1 @FR-1 @regression @feature-241` "A human SetConfig write is attributed to the propagated x-user-id, not the request author". The human/admin path is unaffected.
- **PRESERVE** `@AC-54 @FR-8 @feature-294` "Config denial of a global SetConfig write is attributed" (`services/xstockstrat-config/acceptance/signal-map-instrumentation.feature`). The denial stays `PERMISSION_DENIED`, the log carries `internalCaller`, and no value is logged.
- **PRESERVE** `@AC-3`, `@AC-4`, `@AC-6` `@feature-254` (`services/xstockstrat-config/acceptance/fix-marketdata-secret-exposure.feature`). The `GetSecret` wrong-SAN and no-SAN denials, and marketdata's own resolve, must not regress under the shared `authz.ts` edit.
- **PRESERVE** `@AC-4 @FR-3 @feature-147 @feature-254` "An allow-listed internal caller resolves a secret via GetSecret" (`services/xstockstrat-config/acceptance/config-secrets-and-scoping.feature`).
- **PRESERVE** `@AC-5 @FR-3 @feature-247` "a healthy config service is read unchanged under the deadline" and `@AC-1 @FR-1 @regression @feature-247` "get_config_value is bounded by its default deadline" (`services/xstockstrat-agent/acceptance/fix-agent-getconfig-deadline.feature`).
- **PRESERVE** `@AC-47 @FR-6 @feature-294` "OAuth transaction rejects, degraded post-commit steps and onboarding lines are recorded" (`services/xstockstrat-agent/acceptance/signal-map-instrumentation.feature`). Any new metric label must stay inside the closed sets.
- **PRESERVE** `@AC-1`, `@AC-2`, `@AC-4` `@feature-265` (`services/xstockstrat-identity/acceptance/fix-identity-auth-code-race.feature`). Refresh-token issuance, single-use codes and the claim shape are unaffected. `verify` must use the same secret and algorithm that `sign` uses.
- **PRESERVE** `@AC-9`, `@AC-10` `@feature-242` (`services/xstockstrat-identity/acceptance/fix-push-untargeted-broadcast.feature`). The SAN-gated `ListAdminUserIds` is untouched.
- **PRESERVE** `@AC-7 @FR-2 @feature-169` "Reconciliation poller resumes ticking after ResumeAccount" (`services/xstockstrat-trading/acceptance/resume-halted-account.feature`). Trading must keep reaching config with SAN `xstockstrat-trading`.
- **PRESERVE** `@AC-1`, `@AC-2`, `@AC-4`, `@AC-5` `@feature-210` (`docs/sdd/business-rules/platform.feature`). The mTLS identity stays as is, with no SAN-check bypass flag and unchanged header-trio semantics.
- **EXTEND** (net-new): no existing `@AC-*` guarantees anything about `RevokeToken` or `jwt.decode`. 319 @AC-2 is purely additive.

## Dependencies

- **Proto/RPC.** None. `SetConfig`, `RevokeToken` and HTTP `/oauth/register` already exist.
- **Migration.** None. If one were needed, the next free numbers would be config 048, identity 007 and trading 012.
- **Config keys.** None new. The existing keys read are `agent` `oauth.registration_enabled` (default `true`) and `oauth.allowed_redirect_uris` (default `""`), per `services/xstockstrat-agent/CLAUDE.md`. Grant target is `platform` / `trading_state`.
- **Inter-service edges.** trading → config `SetConfig`, unchanged on the wire. The new SAN requirement depends on trading's leaf SAN, which is verified above.
- **New env vars / ports.** None.

## Risks / Not-found

- **Signature change to `hasInternalCallerAuthority`.** Moving from Metadata to call breaks every test call site:
  - `internalCallerAuthz.test.ts` (`mdWith(...)`, lines 26-97)
  - `internalCallerSetConfig.test.ts` (90-126)
  - `setConfigAuthz.test.ts` (177, 276)
  - `setConfigSpelling.test.ts` (200, 263)

  Per F-05, these must flip in the same commit as the grant. Per insights.md (2026-11-04 fix-marketdata-secret-exposure, ordering), use harness-green, then a RED negative, then the grant and unit flip.
- **Denial log reason.** The current deny log says `no_admin_or_internal_grant`. Whether a SAN mismatch gets a distinct reason (a `secretDenialReason` analogue) is a design choice. It must stay PERMISSION_DENIED and must not log values (@AC-54).
- **DCR premise is stale.** The product spec's "config stalls ≥ `_CONFIG_READ_TIMEOUT_S`" no longer describes the DCR path. Since feature 295, `read_value` reads the snapshot and returns `None` for all three of: no watcher, `_snapshot is None`, and key absent. The `except Exception` branches at `oauth_server.py:88`/`:106` are near-dead. The fix needs a read that tells "unreadable" (no watcher or no snapshot) apart from "key unset". Unset must keep the default `true` / `""`, or every unseeded environment breaks DCR. The `hung_config_server` fixture (`tests/conftest.py:134`) patches the `GetConfig` path and cannot drive AC-3. Drive AC-3 by removing the `agent` watcher or nulling its `_snapshot` instead.
- **Fail-open test to invert.** `tests/test_oauth.py:168` `test_register_survives_config_read_failure` asserts 201 on a raising read. It must flip in the same commit (F-05).
- **Ordering of DCR checks.** The 400 `redirect_uris` validation sits between the two reads (`oauth_server.py:96-101`). Decide whether a 503 from read 2 comes before or after the 400.
- **Policy readable and set to `false`.** That must still return 403 (agent CLAUDE.md). No existing suite pins it, so add one.
- **RevokeToken forged or garbage input (product-spec Open Question 3, unresolved).** The handler can either reject with an error or ignore and return `success:true`. No existing suite pins either. The design must decide, and record it in context.md.
- **RevokeToken with `JWT_SECRET` unset.** `this.jwtSecret` throws, so the handler hits catch `code: 13`. Confirm that is acceptable, or mirror `validateToken`'s `secret_missing` logging.
- **Feature 247 artifacts.** Not opened. 247's FR-2/AC-4 is superseded by this feature's AC-3. Amend the promoted scenario in place at launch (C-16).
- **Not found, and not searched:** `docs/oauth.md` (named in the agent CLAUDE.md OAuth section, may describe the fail-open). Check it at spec time.
- **fails.md (2026-11-04 fix-marketdata-secret-exposure, jscpd).** jscpd ignores test files. Justify any shared peer-SAN test helper by C-18 or the dry-reviewer, not by jscpd.
- **insights.md (2026-10-20 fix-agent-getconfig-deadline).** This feature reverses that pattern's accepted fail-open. Cite it in design.md's rejected alternatives.
- **Overlap (sdd-review).** `configServiceImpl.ts` is shared with feature 314. The agent service is shared with 314, 322, 328 and 331.

## Recommended Scope

Advisory. These are independent slices, so they can be separate steps. Each step pairs its code with tests (C-08, P-06).

1. **Config SAN binding.**
   - Add `peerSan: 'xstockstrat-trading'` to the poller grant.
   - Change `hasInternalCallerAuthority` to take the call and apply the `:185` predicate.
   - Update the call site at `configServiceImpl.ts:681`.
   - Move the four test files onto SAN fakes: harness-green first, then RED for AC-1, then the flip.
   - Update config CLAUDE.md invariant 7.
2. **Identity RevokeToken.**
   - Use `verify(token, this.jwtSecret, { ignoreExpiration: true })` and settle OQ3's behaviour for forged input.
   - Add AC-2 tests: unsigned token gives no revoke; expired-but-signed token revokes.
   - Clear findings row `services/xstockstrat-identity/docs/context-constitution-findings.md:60`.
3. **Agent DCR fail-closed.**
   - Add an "unreadable" distinction to the policy read.
   - Return 503 with no `client_id` for both reads.
   - Invert `test_register_survives_config_read_failure`, add AC-3, and add a 403-when-readable-false test.
   - Update agent CLAUDE.md and `docs/oauth.md` if they describe the fail-open.
4. **Docs and C-16 launch amendments.**
   - Amend in place (with `@feature-319`) the Givens of config `@AC-2` (241), `@AC-5` (296) and `@AC-25` (295).
   - Supersede agent `@AC-4` (247).
