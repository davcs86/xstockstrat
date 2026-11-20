# Implementation Spec: fix-auth-trust-hardening

**Status**: `pending`
**Created**: 2026-11-20
**Feature**: `docs/roadmap/features/319-fix-auth-trust-hardening/feature.md`
**Total Steps**: 8
**Feature Branch**: `feature/fix-auth-trust-hardening`

---

## Execution Summary

Three independent slices, in the order of design.md: config (Steps 1-4), identity (Steps 5-6), agent (Steps 7-8).
The config slice follows the harness-green → RED negative → grant-and-unit-flip ordering
(insights.md 2026-11-04, fix-marketdata-secret-exposure): Step 1 only moves two wire suites onto an mTLS
loopback with a `xstockstrat-trading` client leaf and must stay green under the old header-only grant; Steps 2-4
then land the SAN-bound grant, its tests and the C-16 durable-scenario amendments as one commit. The identity and
agent slices are each one service + test unit. No proto, migration, config-key, env-var or port change.

**Consumer surface (C-14)**: none — internal/platform-only, by decision (design.md § Chosen Approach). The edges are
the `SetConfig` and `RevokeToken` RPCs and the agent's HTTP `POST /oauth/register`; no UI segment or MCP tool changes.

**Tree**: every `path:line` below was re-grepped at spec time on `origin/feature/fix-auth-trust-hardening@307a0c2c`
(merge-base with `origin/main-dev`: `c4fd48b0`, the recon tree). The `/sdd-review impl-spec` pass (2026-11-20)
re-checked the Step 2 `configServiceImpl.ts` anchors and the `watch_core.py` md5 at `@24b8aa72`; later merges can
shift lines, so `/sdd-execute` re-greps each anchor in its discovery phase.

### Scenario Coverage (C-15)

| Scenario | Covered by |
|---|---|
| `@AC-1` internal-caller SetConfig from a peer without the trading SAN is denied | Step 3 |
| `@AC-2` RevokeToken with an unsigned token revokes nothing (incl. the counter `And`) | Step 6 |
| `@AC-3` DCR is refused while the registration policy cannot be read | Step 8 |

### Spec-time findings the design did not hold (P-03 — surfaced, not guessed)

- **F-A — `watch_core.py` is a byte-identical four-copy group.** D-5 adds a public `WatchCore.has_snapshot()`.
  `scripts/check-watcher-copies.sh:17-20` (CI `config-wiring` job; root constitution Pointers row,
  `docs/context-constitution.md:99`: "edit every copy in a group or none") requires the indicators, ingest,
  analysis and agent copies to stay identical. Step 7 therefore edits **all four** copies in one commit. The three
  extra files are an additive, unused-there method; no other service's behaviour changes. This widens the diff
  beyond design.md's four affected services at file level only. Avoiding it would mean defining `has_snapshot` on
  the agent's `ConfigWatcher` subclass instead of on `WatchCore`, which contradicts D-5 and needs an operator
  REOPEN — not taken here.
- **F-B — the deny log's `peerSan` needs the peer's SAN.** `peerDnsSans` (`authz.ts:158`) is module-private and D-1
  forbids a second parser, so Step 2 adds `export` to it.
- **F-C — `setConfigSpelling.test.ts` changes in Step 1, not at the flip.** Design lists four test files flipping
  with the grant. With the harness moved first, that file's poller-success cases already run on the trading leaf
  and need no edit at the flip; `setConfigAuthz.test.ts` keeps its insecure loopback and only its `@AC-54` field-set
  assertion changes (Step 3). All four files are still covered, across Steps 1 and 3.
- **F-D — 296 `@AC-5` is already retired.** The header of
  `services/xstockstrat-config/acceptance/fix-config-keys-contract.feature:5-8` (feature 306) says 296 `@AC-3..5`
  are retired and "left unedited". The operator-signed Given amendment is still applied (Step 4), because the
  sign-off names it; the retirement comment is left as is.
- **O-3 is still unconfirmed.** No operator decision names the OQ3 resolution. Steps 5-6 implement settled `D-4`
  (ignore an unverifiable token, `success:true`, no UPDATE, WARN plus counter). `/sdd-execute`'s Phase-2
  confirmation of the Steps 5+6 unit is the confirmation point; a rejection means `R-5`, which only the operator
  can reopen, and re-specs Steps 5-6.

## Step Dependencies

- Step 2 requires Step 1: the SAN-bound grant denies the poller on an insecure loopback, so the two wire suites
  must already present a `xstockstrat-trading` leaf (harness-green first).
- Steps 2+3+4 land together: Step 2 changes the `hasInternalCallerAuthority` signature in a package whose `tsc`
  build compiles tests (`services/xstockstrat-config/tsconfig.json` `include: ["src/**/*"]`; `pnpm test` runs
  `tsc` first), so `internalCallerAuthz.test.ts` must change in the same commit; it also changes the deny-log
  field set that `setConfigAuthz.test.ts:193-199` pins. Step 4's three durable-scenario amendments land with the
  code, never after it (`D-12`, `R-10`, C-16). Only Step 3 is a build trigger for Step 2; Step 4 is docs and
  Gherkin, compiles nothing, and is folded into the unit by that rule alone.
- Step 3 [test] covers Step 2 [service]; Step 1 [test] is a harness-only step with no paired service step.
- Steps 5+6 land together: `telemetryAllowlist.test.ts` `drive()` references `recordRevokeUnverifiable`, which
  Step 5 creates, and identity's `tsc` build compiles tests (`services/xstockstrat-identity/tsconfig.json`
  `include: ["src/**/*"]`). Step 6 [test] covers Step 5 [service].
- Steps 7+8 land together: `tests/test_oauth.py:168` `test_register_survives_config_read_failure` asserts the old
  201 and turns red on Step 7's handler change (F-05 same-commit rule, design.md Step 3). Step 8 [test] covers
  Step 7 [service].
- The three slices (1-4, 5-6, 7-8) are independent of each other.
- Open Risks carried from design.md:
  - Grant ↔ generator SAN drift has no CI guard (`R-11`); mitigated only by Step 4's PLAT-9 contract note and
    trading findings row. Follow-up owner: the trading findings row.
  - `identity.revoke.unverifiable` spikes after a `JWT_SECRET` rotation — stated in the counter description and
    `services/xstockstrat-identity/CLAUDE.md` (Step 5).
  - `ignoreExpiration` lets an old, validly signed token still revoke — accepted; noted in Step 5.
  - A stale agent snapshot keeps serving the last-known DCR policy — accepted (`D-6`); noted in Step 7.
  - The agent 503 path is unreachable after a correct boot — guarded by the constraint comment in Step 7 (`D-7`).
- Merge-order overlap (not resolvable inside this feature directory; no row for 319 exists in
  `docs/roadmap/features/merge-order.md`): `configServiceImpl.ts` with feature 314; agent files with
  314/322/328/331; `docs/context-constitution.md` is widely edited; and, new at spec time (F-A), the four
  `watch_core.py` copies — re-run `bash scripts/check-watcher-copies.sh` after merging `origin/main-dev` at the
  integration PR (fails.md 2026-11-10, signal-map-instrumentation).
  - Trunk peers found by the `/sdd-review impl-spec` overlap scan (2026-11-20), all file-level: `authz.ts` and
    `identityServiceImpl.ts` and agent `watcher.py` with 345-authelia-sso; `configServiceImpl.ts` with
    330-fix-live-enrich-ttl-seed and 321-fix-trading-config-plumbing; identity `telemetry.ts` with
    329-fix-telemetry-startup-log and 337-metrics-host-provider-label. The second merger re-anchors.
  - `POST /oauth/register` is shared with 345-authelia-sso, whose spec (`origin/main-dev`, `:1191-1193`, its
    `@AC-43`) returns 404 for the route once SSO is configured and keeps `tests/test_oauth.py` green as its legacy
    net. Steps 7-8 here change that file and the legacy-mode status (503 with no snapshot). Which status the
    route returns under SSO, and the merge order of the two, is an operator decision — context.md Open Threads.
  - The scan could not read the specs of batch peers that exist only on `origin/feature/<slug>` branches; the
    314/322/328/331 overlaps above are this spec's own note, not independently verified.
- Launch promotion (C-16, integration PR): 319 `@AC-1` → config suite, `@AC-2` → identity suite (extending the
  sibling instruments of identity `@AC-52` in `signal-map-instrumentation.feature`), `@AC-3` → agent suite. The
  CHANGE amendments are not deferred to launch; they are Steps 4 and 7.
- Post-deploy smoke (product-spec Acceptance Criteria; insights.md 2026-11-04 "positive evidence"): on dev, confirm
  the config log sink returns data, then that no `SetConfig denied` ERROR carries
  `internalCaller=trading-reconciliation-poller` with `peerSan=xstockstrat-trading`. A systemic escalation is rare,
  so a positive `SetConfig` success from trading may not occur in the window; record that limit instead of calling
  a zero-match grep a pass.

---

### Step 1 — test: move the internal-caller wire suites onto an mTLS loopback (harness only)

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/__tests__/mtlsTestPki.ts` — modify
- `services/xstockstrat-config/src/__tests__/internalCallerSetConfig.test.ts` — modify
- `services/xstockstrat-config/src/__tests__/setConfigSpelling.test.ts` — modify

**Reviewers**: xstockstrat-config owner — secret encryption + redaction, WatchConfig stream stability (here: write
authz test harness)

**Codebase Evidence**:
- `mtlsTestPki.ts:5,9,17` export `sh`, `mintLeaf(dir, name, ca, caKey)` (leaf `subjectAltName=DNS:${name}`) and
  `setEnv(cert, key, ca)`.
- The mTLS loopback sequence to reuse: `secretsAndScope.test.ts:76-96` — mint a CA with `sh('req','-x509',…)`,
  `mintLeaf` a `xstockstrat-config` server leaf and per-identity client leaves, `setEnv(...serverLeaf, caPem)`,
  `server.bindAsync('127.0.0.1:0', mtls.serverCredentials(), …)`, then per client `setEnv(...leaf, caPem)` and
  `new ConfigServiceClient(addr, mtls.clientCredentials(), mtls.targetOverride('xstockstrat-config'))`.
  `src/mtls.ts:22,28,35` export `serverCredentials`, `clientCredentials`, `targetOverride`.
- Insecure harnesses to replace: `internalCallerSetConfig.test.ts:54-61` (`grpc.ServerCredentials.createInsecure()`
  / `grpc.credentials.createInsecure()`); `setConfigSpelling.test.ts:120,125` (same).
- Poller-success cases that will need the trading SAN after Step 2: `internalCallerSetConfig.test.ts:84` (`@AC-2`),
  `:115` (HALTED); `setConfigSpelling.test.ts:222` (`@AC-3` relative key), `:256` (`@AC-25`).
- A shared "CA + leaves + bind + clients" helper: **Not found** — `secretsAndScope.test.ts` and
  `peerSanSpike.test.ts:25-45` each inline it. It is created from scratch in `mtlsTestPki.ts`.
- `.jscpd.json` ignores test files, so the extraction is justified by C-18, not by the duplication hook
  (fails.md 2026-11-04, fix-marketdata-secret-exposure).

**TDD**: `N/A (harness-only switch — no behaviour is asserted new; the whole suite must stay green under the old header-only grant)`

**Covers**: —

**Instructions**:
1. In `mtlsTestPki.ts`, add one exported helper (name `startMtlsLoopback`) that takes a `grpc.Server` (services
   already added) and a list of client leaf names, and: creates a temp dir, mints a CA, mints the
   `xstockstrat-config` server leaf and one leaf per client name with `mintLeaf`, binds the server on
   `127.0.0.1:0` with `mtls.serverCredentials()` after `setEnv(...serverLeaf, caPem)`, and returns the port plus,
   per client name, the `ChannelCredentials` built by `mtls.clientCredentials()` right after
   `setEnv(...thatLeaf, caPem)`. It is the `secretsAndScope.test.ts:76-96` sequence, verbatim in behaviour. Do
   not refactor `secretsAndScope.test.ts` or `peerSanSpike.test.ts` onto it (out of scope).
2. `internalCallerSetConfig.test.ts`: replace the insecure bind/client at `:54-61` with `startMtlsLoopback(server,
   ['xstockstrat-trading', 'xstockstrat-notify'])`. `client` becomes the `xstockstrat-trading`-leaf client (with
   `mtls.targetOverride('xstockstrat-config')`); keep a second `notifyClient` on the `xstockstrat-notify` leaf,
   closed in `after`, unused until Step 3. Give `setConfig` an optional client parameter defaulting to `client`.
   No assertion changes.
3. `setConfigSpelling.test.ts`: replace the insecure bind/client at `:120,125` with
   `startMtlsLoopback(server, ['xstockstrat-trading'])`; the single `client` is the trading-leaf client. No
   assertion changes.
4. C-13: the leaf names are service-registry names, not domain fixtures; no fixture home is created.

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run lint && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
grep -n "createInsecure" src/__tests__/internalCallerSetConfig.test.ts src/__tests__/setConfigSpelling.test.ts   # expect no match
grep -n "startMtlsLoopback" src/__tests__/mtlsTestPki.ts src/__tests__/internalCallerSetConfig.test.ts src/__tests__/setConfigSpelling.test.ts
git diff --stat -- src/grpc   # expect empty: no production file changes in this step
```
The full suite passes with the same test count as before the step.

---

### Step 2 — service: bind the poller grant to the mTLS peer SAN; attribute only authorized callers

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/grpc/authz.ts` — modify
- `services/xstockstrat-config/src/grpc/configServiceImpl.ts` — modify
- `services/xstockstrat-config/CLAUDE.md` — modify

**Reviewers**: xstockstrat-config owner — secret encryption + redaction, scoping, WatchConfig stream stability;
Security — auth scope, `x-internal-caller` allow-list

**Codebase Evidence**:
- `authz.ts:76` `interface InternalCallerGrant { callerID; namespace; key; allowedTargetValues }` — no `peerSan`.
- `authz.ts:84-92` `INTERNAL_CALLER_ALLOWLIST`, grant `callerID: 'trading-reconciliation-poller'` at `:86`.
- `authz.ts:104-119` `export function hasInternalCallerAuthority(md: Metadata | undefined, namespace, key,
  targetValue)`.
- Reuse targets in the same file: `peerSan?: string` on `SecretCallerGrant` (`:133`, doc comment `:132`);
  `export interface SecretCallerCall { metadata?; getAuthContext? }` (`:152`); `function peerDnsSans(call)`
  (`:158`, module-private); predicate `(grant.peerSan === undefined || peerDnsSans(call).includes(grant.peerSan))`
  (`:185`); `export function hasPeerDnsSan(call)` (`:228`).
- Only non-test caller: the `internalCallerAuthorized` statement at `configServiceImpl.ts:679-686` — the call
  expression `hasInternalCallerAuthority(` is at `:681`, its `call.metadata` argument at `:682`. Imports at `configServiceImpl.ts:14-15` (`hasInternalCallerAuthority`, `hasPeerDnsSan`).
- Deny path: `configServiceImpl.ts:687-711`; `fields` built at `:690-694` with `reason:
  'no_admin_or_internal_grant'`; the internal-caller ERROR branch at `:697-706`; `callback(ADMIN_SCOPE_ERROR)` `:709`.
- `configServiceImpl.ts:217-220` `LOG_ID_MAX = 64`, `truncateForLog`.
- Attribution: `configServiceImpl.ts:724` `const callerIdentity = first(call.metadata, HEADER_INTERNAL_CALLER) ||
  null;` (raw header, unconditional); `:729` `author` already gates on `internalCallerAuthorized`; `callerIdentity`
  is INSERT param 11 (`:839`).
- `services/xstockstrat-config/CLAUDE.md:44` invariant 7 (header-only wording); `:122` the `GetSecret` denial-log
  line in Observability.
- Legitimate caller presents its own leaf: `services/xstockstrat-trading/internal/config/config.go:70`
  (recon.md); leaf SAN `DNS:${svc}` from `scripts/gen-dev-certs.sh:50`, `xstockstrat-trading` in `SERVICES` (`:28`).

**Lands with**: `Step 3, Step 4`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `authz.ts`:
   - Add `peerSan?: string` to `InternalCallerGrant` with the same doc comment as `:132`.
   - Add `peerSan: 'xstockstrat-trading'` to the `trading-reconciliation-poller` grant (`:86`). A two-line
     constraint comment states that the literal must equal the leaf DNS SAN minted by `scripts/gen-dev-certs.sh`.
   - Add `export type PeerCall = SecretCallerCall;`.
   - Change `hasInternalCallerAuthority` to take `call: PeerCall` as its first parameter (replacing `md`), read the
     header with `first(call?.metadata, HEADER_INTERNAL_CALLER)`, and add the `:185` predicate
     `(grant.peerSan === undefined || peerDnsSans(call).includes(grant.peerSan))` to the `.some(...)`. Update its
     doc comment: it also fails closed on a peer that does not present the grant's DNS SAN.
   - Add `export` to `peerDnsSans` (`:158`). Do not write a second SAN parser. Do not add a
     `setConfigDenialReason` (`R-1`). Leave `SECRET_CALLER_ALLOWLIST`, `hasSecretCallerAuthority` and
     `secretDenialReason` untouched (C-10).
2. `configServiceImpl.ts`:
   - `:682` pass `call` instead of `call.metadata`.
   - `:724` persist `caller_identity` only for an authorized internal-caller write:
     `const callerIdentity = internalCallerAuthorized ? first(call.metadata, HEADER_INTERNAL_CALLER) || null : null;`
     (`D-2`). `:729` is unchanged.
   - In the internal-caller ERROR branch only (`:697-706`), add two log fields: `hadPeerSan: hasPeerDnsSan(call)`
     and `peerSan: truncateForLog(peerDnsSans(call)[0] ?? '')` (import `peerDnsSans`). Keep `reason:
     'no_admin_or_internal_grant'`, the ERROR level, `ADMIN_SCOPE_ERROR` and the WARN branch as they are. No config
     value is logged (`@AC-54`).
3. `services/xstockstrat-config/CLAUDE.md`:
   - Invariant 7 (`:44`): the `trading-reconciliation-poller` grant also requires the mTLS peer certificate to
     carry DNS SAN `xstockstrat-trading` (`peerSan`, checked by `hasInternalCallerAuthority(call, …)` via
     `getAuthContext()`), so the header alone never suffices; `caller_identity` is persisted only when the
     internal-caller grant authorized the write, and is `NULL` otherwise even if the header was sent.
   - Observability (after `:122`): the `SetConfig` internal-caller denial log also carries `hadPeerSan` and a
     truncated `peerSan`.
4. No trading code change (`R-12`). Header propagation: no new outbound call.

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run lint && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
grep -n "peerSan: 'xstockstrat-trading'" src/grpc/authz.ts
grep -n "hasInternalCallerAuthority(" -A2 src/grpc/configServiceImpl.ts   # first argument is `call`
grep -n "internalCallerAuthorized ? first(call.metadata, HEADER_INTERNAL_CALLER)" src/grpc/configServiceImpl.ts
grep -n "setConfigDenialReason" -r src   # expect no match (R-1)
```
Run as the Steps 2+3+4 unit: the union of the three steps' verifications.

---

### Step 3 — test: 319 @AC-1, the forged-attribution case and the unit flip

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/__tests__/internalCallerAuthz.test.ts` — modify
- `services/xstockstrat-config/src/__tests__/internalCallerSetConfig.test.ts` — modify
- `services/xstockstrat-config/src/__tests__/setConfigAuthz.test.ts` — modify

**Reviewers**: xstockstrat-config owner — write authz, scoping; Security — auth scope

**Codebase Evidence**:
- `internalCallerAuthz.test.ts:16-20` `mdWith(callerID)` returns a bare `grpc.Metadata`; eight calls of
  `hasInternalCallerAuthority(mdWith(…)|undefined, …)` at `:25,37,49,61,68,79,84,96`.
- SAN fake to copy: `secretCallerAuthz.test.ts:21-28` `callWith(callerID, subjectaltname?)` →
  `{ metadata, getAuthContext: () => (subjectaltname === undefined ? {} : { sslPeerCertificate: { subjectaltname } }) }`;
  the same shape at `configServiceImpl.test.ts:679-680`. SAN strings carry the `DNS:` prefix
  (`secretCallerAuthz.test.ts:30` `'DNS:xstockstrat-ingest'`).
- `internalCallerSetConfig.test.ts`: after Step 1 it has `client` (trading leaf) and `notifyClient` (notify leaf);
  INSERT params index 6 = `updated_by`, 10 = `caller_identity` (`:97-100`); the admin-write case at `:152-164`
  sends no `x-internal-caller`.
- `setConfigAuthz.test.ts:174-200` `@AC-54` pins the denial field set to
  `['internalCaller','key','namespace','reason','targetState']` (`:193-199`); `:202-212` pins the WARN branch
  (`internalCaller`/`targetState` undefined). This file stays on its insecure loopback (`:126,132`): it has no
  poller-success case.
- `setConfigSpelling.test.ts` needs no edit here (moved in Step 1; spec-time finding F-C).

**Lands with**: `Step 2, Step 4`

**TDD**: `red-green required`

**Covers**: `AC-1`

**Instructions**:
1. `internalCallerAuthz.test.ts`: replace `mdWith` with a `callWith(callerID, subjectaltname?)` fake copied from
   `secretCallerAuthz.test.ts:21-28`, and a `const TRADING_SAN = 'DNS:xstockstrat-trading'`. Every existing
   "authorizes" case passes `TRADING_SAN`; every existing "denies" case keeps its own denial reason while also
   passing `TRADING_SAN` (so it proves that reason, not the SAN). The absent-metadata case passes `{}`. Add:
   - denies the poller when the peer SAN is `DNS:xstockstrat-notify` (`@AC-1`, pure layer);
   - denies when the call has no `getAuthContext` at all, and when the peer presents no SAN (fail closed);
   - authorizes when `xstockstrat-trading` appears anywhere in a comma-separated `subjectaltname` list.
2. `internalCallerSetConfig.test.ts` (wire layer, the RED for `@AC-1`):
   - `@AC-1 (319)`: via `notifyClient`, `SetConfig` `platform` / `trading_state` = `HALTED` with only
     `x-internal-caller: trading-reconciliation-poller` → `PERMISSION_DENIED`, and no query at all is issued
     (`queries.length === 0`, so no `INSERT INTO config.config_values`; the `config.config_audit` row is written
     by a DB trigger on that INSERT, so "no INSERT" is the in-process proof of "no audit row"). The same request
     via `client` (trading leaf) succeeds with INSERT params `[6]` and `[10]` equal to
     `'trading-reconciliation-poller'`.
   - Forged attribution (`D-2`): via `notifyClient`, an admin write (`x-access-scope: 7`, `x-user-id: admin-7`)
     that also sends `x-internal-caller: trading-reconciliation-poller`, to `platform` / `log_level` → succeeds,
     params `[6] === 'admin-7'` and `[10] === null`.
   - The denial log for the `@AC-1` call carries `hadPeerSan: true` and `peerSan: 'xstockstrat-notify'` and no
     value other than `targetState`.
3. `setConfigAuthz.test.ts:193-199`: the `@AC-54` field-set assertion gains `hadPeerSan` and `peerSan`; assert
   `d.hadPeerSan === false` and `d.peerSan === ''` (insecure loopback). The WARN-branch test (`:202-212`)
   additionally asserts `hadPeerSan` and `peerSan` are `undefined`.
4. C-13: the SAN literal has one consumer per file and no shared home exists (`src/__tests__/fixtures/` holds
   only `collectingReader.ts`); inline is compliant. Do not create a fixture module.
5. RED evidence: on the Step 1 tree, the `@AC-1` wire negative fails (the notify-leaf call is authorized) and the
   forged-attribution case fails (`params[10]` is the forged header); `internalCallerAuthz.test.ts` fails to
   compile against the old signature, which is why the unit is atomic.

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run lint && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
grep -n "AC-1 (319)\|xstockstrat-notify" src/__tests__/internalCallerSetConfig.test.ts src/__tests__/internalCallerAuthz.test.ts
grep -n "__tests__/fixtures" src/__tests__/internalCallerAuthz.test.ts src/__tests__/internalCallerSetConfig.test.ts   # no new fixture import (C-13: single-consumer inline)
```
Preserved rules stay green in the same run: 254 `@AC-3/@AC-4/@AC-6` (`secretsAndScope.test.ts`,
`secretCallerAuthz.test.ts`), 241 `@AC-1/@AC-3` and `@AC-54` (`setConfigAuthz.test.ts`).

---

### Step 4 — docs: C-16 durable-scenario amendments, PLAT-9 contract, trading finding

**Status**: `pending`
**Service**: `docs/` + `services/xstockstrat-config/acceptance/` + `services/xstockstrat-trading/docs/`
**Files**:
- `services/xstockstrat-config/acceptance/fix-config-audit-author-spoof.feature` — modify
- `services/xstockstrat-config/acceptance/fix-config-keys-contract.feature` — modify
- `services/xstockstrat-config/acceptance/fix-config-keys-drift.feature` — modify
- `docs/context-constitution.md` — modify
- `services/xstockstrat-trading/docs/context-constitution-findings.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `fix-config-audit-author-spoof.feature:25-27` — `@AC-2 @FR-2 @regression @feature-241`, Given
  `a caller with no x-user-id and x-internal-caller "trading-reconciliation-poller"`.
- `fix-config-keys-contract.feature:36-38` — `@AC-5 @FR-1 @regression @feature-296`, Given
  `the trading poller sends SetConfig "platform" / "platform.trading_state" = "REDUCE_ONLY" as internal caller
  "trading-reconciliation-poller"`; retirement header at `:5-8` (feature 306).
- `fix-config-keys-drift.feature:88-90` — `@AC-25 @FR-1 @regression @feature-295`, Given
  `the grant for "trading-reconciliation-poller" on "platform" / "platform.trading_state"`.
- `docs/context-constitution.md:47` PLAT-9 row: "it has **no** `peerSan`"; anchors
  `authz.ts#InternalCallerGrant (~L76-82)`, `#INTERNAL_CALLER_ALLOWLIST (~L84)`, `#hasInternalCallerAuthority
  .some( (~L112)`, verified-against `(~L104-119)`.
- `services/xstockstrat-trading/docs/context-constitution-findings.md:16-18` — `## Latent bugs` table, columns
  `| Issue | Impact | Evidence |`.
- The pre-existing trading defect: `services/xstockstrat-trading/internal/service/trading.go:2270`
  (`s.configSetter.SetConfig(ctx, "trading-reconciliation-poller", …)`), `:2278-2280` (WARN only on error),
  `:2285` (alert title "… trading reduced to REDUCE_ONLY", emitted regardless).
- Dedup (fails.md 2026-11-04, fix-agent-getconfig-deadline): `grep -rli "escalateSystemic\|reduced to
  REDUCE_ONLY\|systemic escalation" docs/reports/ services/xstockstrat-trading/docs/` → only
  `docs/reports/2026-10-21-trading-untargeted-per-account-alerts-defect.md`, which is about alert targeting, not a
  failed `SetConfig`. No existing row or report covers this finding. Re-run the grep at execute time.
- Operator C-16 sign-off for the three Given amendments: context.md § Session 2026-11-20 (operator decisions at
  the design gate), option A.

**Lands with**: `Step 2, Step 3`

**TDD**: `N/A (docs and Gherkin text; no code)`

**Covers**: —

**Instructions**:
1. Amend each of the three scenarios in place. Add `@feature-319` to the tag line and extend the Given named
   above with `from an mTLS peer with DNS SAN "xstockstrat-trading"`. Do not change any `When`/`Then`/`And`, do not
   add a scenario "alongside" (`R-10`), do not edit the `:5-8` retirement header of
   `fix-config-keys-contract.feature`.
2. `docs/context-constitution.md:47` (PLAT-9): rewrite the write-direction clause — the allowlist is
   `{callerID, namespace, key, allowedTargetValues, peerSan}`, and the `trading-reconciliation-poller` grant
   requires the mTLS peer DNS SAN `xstockstrat-trading`, exactly as the read direction does. Record the
   cross-module contract naming both ends: the grant's `peerSan` literal
   (`services/xstockstrat-config/src/grpc/authz.ts#INTERNAL_CALLER_ALLOWLIST`) must equal the leaf DNS SAN emitted
   by `scripts/gen-dev-certs.sh` (`subjectAltName = DNS:${svc}`); an FQDN SAN or a hand-minted leaf silently
   denies the poller's escalation, and there is no CI guard. Refresh the `authz.ts` anchors against the tree as
   it stands after Step 2 (re-grep; do not carry the old `~L` numbers).
3. `services/xstockstrat-trading/docs/context-constitution-findings.md`: add one row to `## Latent bugs` —
   `escalateSystemic` only WARNs when `SetConfig` fails yet still emits the CRITICAL alert "trading reduced to
   REDUCE_ONLY", so an operator is told a halt happened when the write was denied or failed (found 2026-11-20,
   feature 319; predates 319; no code change in 319). Evidence: the three `trading.go` symbols above.

**Verification**:
```bash
grep -c "@feature-319" services/xstockstrat-config/acceptance/fix-config-audit-author-spoof.feature services/xstockstrat-config/acceptance/fix-config-keys-contract.feature services/xstockstrat-config/acceptance/fix-config-keys-drift.feature   # 1 each
grep -n 'DNS SAN "xstockstrat-trading"' services/xstockstrat-config/acceptance/fix-config-audit-author-spoof.feature services/xstockstrat-config/acceptance/fix-config-keys-contract.feature services/xstockstrat-config/acceptance/fix-config-keys-drift.feature
grep -n 'has \*\*no\*\* `peerSan`' docs/context-constitution.md   # expect no match
grep -n "gen-dev-certs.sh" docs/context-constitution.md | grep -n "PLAT-9"
grep -n "escalateSystemic" services/xstockstrat-trading/docs/context-constitution-findings.md
git diff --stat -- services/xstockstrat-trading/internal   # expect empty (R-12)
```
`git diff` of the three `.feature` files shows only the tag line and the one Given line changed in each scenario.

---

### Step 5 — service: RevokeToken verifies the signature; HS256 pinned; unverifiable counter

**Status**: `pending`
**Service**: `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/src/grpc/identityServiceImpl.ts` — modify
- `services/xstockstrat-identity/src/telemetry.ts` — modify
- `services/xstockstrat-identity/CLAUDE.md` — modify
- `services/xstockstrat-identity/docs/context-constitution-findings.md` — modify

**Reviewers**: xstockstrat-identity owner — JWT expiry and rotation, API key scoping; Security — JWT claims
minimal, identity/auth scope

**Codebase Evidence**:
- `identityServiceImpl.ts:279-298` `async revokeToken`; `:281` empty token → `success: true`; `:283` comment
  `// Decode without verify to handle expired tokens`; `:284` `(jwt as any).decode(token)`; outer catch →
  `{ code: 13, message: err.message }`.
- Reuse: `private get jwtSecret()` `:130-136` (throws when `JWT_SECRET` is unset); the verify idiom
  `(jwt as any).verify(token, this.jwtSecret)` in `validateToken` `:218`; signing `:320` (`sign(claimsPayload,
  this.jwtSecret, { expiresIn })`, default HS256; `aud` only for OAuth, `:319`).
- `validateFailureReason` `:24-29` maps `JsonWebTokenError` → `invalid`, so an algorithm-rejected token under the
  HS256 pin is counted as `invalid`.
- Telemetry import block `identityServiceImpl.ts:11-17`.
- `telemetry.ts:340-354` the `BoundCounter` declarations (`refreshRejections` at `:349`); `:360-380` the
  `record*` exports (`recordRefreshRejection` at `:372`).
- `jsonwebtoken` `^9.0.2` (`package.json:34`).
- `services/xstockstrat-identity/CLAUDE.md:4` constitution pointer `defects (⚠ unsigned-token revoke)`; `:92`
  Instruments line; `:93` "No token, email or hash is ever logged or labelled."
- `services/xstockstrat-identity/docs/context-constitution-findings.md:60` — the
  `2026-10-19-identity-revoketoken-unverified-decode-defect` row; `:58` shows the resolved-row convention
  (`— **resolved (…)**`).

**Lands with**: `Step 6`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `telemetry.ts`: after `refreshRejections` (`:349-351`) add a label-free counter
   `new BoundCounter('identity.revoke.unverifiable', { description: 'RevokeToken calls ignored because the token
   failed signature verification (forged, malformed, or pre-rotation)' })`, and after `recordRefreshRejection`
   (`:372-374`) add `export function recordRevokeUnverifiable(): void` that adds 1 with no attributes. No label
   (`R-9`); do not reuse `identity.token.validate_failures` (`R-7`).
2. `identityServiceImpl.ts`:
   - Add `recordRevokeUnverifiable` to the import block (`:11-17`).
   - `validateToken` (`:218`): pass `{ algorithms: ['HS256'] }` as the third `verify` argument. This is a
     behaviour change on the validate path that product-spec.md does not name; it comes from design.md
     § Chosen Approach (`:57-59`, `:163`; C-10 parity with `revokeToken`) and is pinned by Step 6's HS384 case.
     Signing (`:320`) uses the default HS256, so no token this service mints is affected.
   - `revokeToken` (`:279`): inside the existing outer `try`, read `this.jwtSecret` first (a missing secret still
     reaches the outer catch → `code: 13`, and does not touch the counter). Then verify in an inner `try`:
     `(jwt as any).verify(token, secret, { ignoreExpiration: true, algorithms: ['HS256'] })`. On an inner failure:
     call `recordRevokeUnverifiable()`, log the fixed WARN `'RevokeToken: unverifiable token ignored'` carrying at
     most the verify error class name (`err?.name`) — never the token, payload or `user_id` — and return
     `callback(null, { success: true })` with no UPDATE (`D-4`, `D-10`; not an error, `R-5`). On success the
     existing `decoded?.user_id` UPDATE and `Tokens revoked` INFO run unchanged. Do not require `aud`
     (IDENTITY-4). Replace the `:283` comment with a constraint comment of at most two lines: expired tokens must
     still revoke, so expiry is ignored but the signature is not.
3. `services/xstockstrat-identity/CLAUDE.md`: `:92` add `identity.revoke.unverifiable` (label-free) to the
   Instruments line, with the constraint that it is not a forgery signal on its own — a `JWT_SECRET` rotation makes
   legitimate logouts of pre-rotation tokens increment it. `:4` change `defects (⚠ unsigned-token revoke) in` to
   `defects in`.
4. `docs/context-constitution-findings.md:60`: mark the row resolved in the `:58` style
   (`— **resolved (feature 319: RevokeToken verifies the signature, HS256, ignoreExpiration)**`).
5. Accepted and not changed here: with `ignoreExpiration`, an old validly signed token can still revoke. No new
   outbound call, so header propagation is unaffected.

**Verification**:
```bash
cd services/xstockstrat-identity && pnpm run lint && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
grep -n "decode(token)" src/grpc/identityServiceImpl.ts   # expect no match
grep -n "algorithms: \['HS256'\]" src/grpc/identityServiceImpl.ts   # two matches: validateToken and revokeToken
grep -n "identity.revoke.unverifiable\|recordRevokeUnverifiable" src/telemetry.ts src/grpc/identityServiceImpl.ts
grep -n "unsigned-token revoke" CLAUDE.md   # expect no match
```
Run as the Steps 5+6 unit.

---

### Step 6 — test: 319 @AC-2 and the counter allowlist

**Status**: `pending`
**Service**: `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/src/__tests__/revokeToken.test.ts` — create
- `services/xstockstrat-identity/src/__tests__/telemetryAllowlist.test.ts` — modify

**Reviewers**: xstockstrat-identity owner — JWT expiry and rotation; Security — identity/auth scope

**Codebase Evidence**:
- A RevokeToken behaviour test: **Not found** — `identityServiceImpl.test.ts:263-277` only checks that an empty
  token does not crash. `revokeToken.test.ts` is created from scratch.
- Patterns to copy: `identityTelemetry.test.ts:10-12` (`install()` from `./fixtures/collectingReader`, the
  `config = { getInt: (_k, def) => def }` stub), `:14-19` (direct handler invocation
  `new IdentityServiceImpl(pool, config)` + callback promise), `:21-35` `captureStdout`, `:42-45` an expired token
  minted with `jwt.sign({ user_id, exp: now - 60 }, secret)`.
- `fixtures/collectingReader.ts:14,28,36,43` exports `install`, `points`, `values`, `counterValue` (`values(reader,
  name)` suits a label-free counter).
- Spy pool shape: `identityServiceImpl.test.ts:47-54` `makePool` (`query(sql, params)`).
- `telemetryAllowlist.test.ts:31-38` `MIN_INSTRUMENTS`; `:41-49` `drive()`.
- Each `dist/__tests__/*.test.js` runs in its own process under `node --test` (`package.json:12`), so a new file
  gets its own meter provider and `JWT_SECRET`.

**Lands with**: `Step 5`

**TDD**: `red-green required`

**Covers**: `AC-2`

**Instructions**:
1. Create `revokeToken.test.ts` with a recording pool (captures every `query(sql, params)`) and a counter reader.
   Cases, each asserting the callback result, the recorded queries and the counter delta:
   - `@AC-2 (319)` unsigned: a JWT with header `{"alg":"none"}`, payload `{"user_id":"victim-1"}` and an empty
     signature → `{ success: true }`, **zero** queries (so both of victim-1's `refresh_tokens` rows keep
     `revoked_at` NULL), `identity.revoke.unverifiable` +1.
   - `@AC-2 (319)` expired but correctly signed (HS256, the test `JWT_SECRET`, `exp` in the past) for `victim-1`
     → exactly one query, the `UPDATE identity.refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND
     revoked_at IS NULL` with params `['victim-1']`; counter +0.
   - signed with a different secret → ignored, zero queries, counter +1.
   - signed with the right secret but HS384 → ignored, zero queries, counter +1; and `validateToken` rejects the
     same token with code 16 (the HS256 pin in both handlers, C-10).
   - garbage string → ignored, zero queries, counter +1.
   - `JWT_SECRET` unset → callback error `code: 13`, zero queries, counter +0 (restore the env var in `finally`).
   - the WARN for an unverifiable call: captured stdout contains `RevokeToken: unverifiable token ignored`, and
     contains neither the token string nor `victim-1` (`D-10`).
   - empty token still returns `{ success: true }` with zero queries and counter +0.
2. `telemetryAllowlist.test.ts`: add `'identity.revoke.unverifiable'` to `MIN_INSTRUMENTS` (`:31-38`) and
   `telemetry.recordRevokeUnverifiable();` to `drive()` (`:41-49`), putting the label-free counter under the
   closed-label / forbidden-key gate (identity `@AC-41` preserved).
3. C-13: the JWT secret and `victim-1` are single-consumer scenario literals in one new file; inline is compliant,
   no fixture module is added.
4. RED evidence: on the pre-Step-5 tree the unsigned-token case issues the UPDATE for `victim-1` (behaviour
   failure), and `telemetryAllowlist.test.ts` does not compile — hence the atomic unit.

**Verification**:
```bash
cd services/xstockstrat-identity && pnpm run lint && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
grep -n "AC-2 (319)" src/__tests__/revokeToken.test.ts
grep -n "identity.revoke.unverifiable\|recordRevokeUnverifiable" src/__tests__/telemetryAllowlist.test.ts
grep -n "__tests__/fixtures\|./fixtures/" src/__tests__/revokeToken.test.ts   # only collectingReader (C-13: no domain fixture; single-consumer inline)
```
Preserved in the same run: 265 `@AC-1/@AC-2/@AC-4` and the `validateToken` suites in
`identityServiceImpl.test.ts` / `identityTelemetry.test.ts`.

---

### Step 7 — service: agent DCR fails closed when no policy snapshot is readable

**Status**: `pending`
**Service**: `xstockstrat-agent` (plus the three byte-identical `watch_core.py` copies — spec-time finding F-A)
**Files**:
- `services/xstockstrat-agent/app/config/watch_core.py` — modify
- `services/xstockstrat-indicators/app/config/watch_core.py` — modify (byte-identical copy)
- `services/xstockstrat-ingest/app/config/watch_core.py` — modify (byte-identical copy)
- `services/xstockstrat-analysis/app/config/watch_core.py` — modify (byte-identical copy)
- `services/xstockstrat-agent/app/config/watcher.py` — modify
- `services/xstockstrat-agent/app/oauth_server.py` — modify
- `services/xstockstrat-agent/CLAUDE.md` — modify
- `services/xstockstrat-agent/docs/context-constitution-findings.md` — modify
- `services/xstockstrat-agent/acceptance/fix-agent-getconfig-deadline.feature` — modify

**Reviewers**: xstockstrat-agent owner — OAuth 2.1 edge-auth correctness and statelessness, no secret values in
output; Security — auth scope; xstockstrat-indicators / xstockstrat-ingest / xstockstrat-analysis owners — the
shared `watch_core.py` copy only

**Codebase Evidence**:
- `services/xstockstrat-agent/app/config/watch_core.py:55` `class WatchCore`; `:96-100` `_apply` sets
  `self._snapshot`; `:153-160` `wait_for_snapshot`; `:189-196` `_lookup` reads
  `snapshot = getattr(self, "_snapshot", None)` and returns `None` when it is `None`. No `has_snapshot` exists
  (**Not found** — created).
- Copy group: `scripts/check-watcher-copies.sh:17-20` lists the four `watch_core.py` files; all four have md5
  `17d555e01c1cdbfeb4aa57fb2590033e` at spec time; `docs/context-constitution.md:99` — "edit every copy in a group
  or none"; CI `config-wiring` job.
- `services/xstockstrat-agent/app/config/watcher.py:13` imports `WatchCore`; `:16` `WATCHED_NAMESPACES =
  ("agent", "indicators")`; `:19` `_WATCHERS`; `:64` `get_watcher`; `:68-77` `read_value` (returns `None` for no
  watcher, no snapshot, or key absent); `:97` boot blocks on `wait_for_snapshot`.
- `services/xstockstrat-agent/app/oauth_server.py:28` `from app.config.watcher import read_value as
  read_config_value`; `:76` `async def register`; JSON parse `:78-83`; `:85` comment "Best-effort: a config read
  failure must not 500 DCR."; read 1 `:86-90` (`except` logs "defaulting to enabled"); 403 `:91-94`;
  `redirect_uris` 400 `:96-101`; read 2 `:104-108` (`except` logs "defaulting to empty allowlist"); error shape
  `JSONResponse({"error": "server_error"}, 500)` `:138`.
- `services/xstockstrat-agent/CLAUDE.md:208` — `oauth.registration_enabled` row, "(disabled ⇒ 403)".
- `services/xstockstrat-agent/docs/oauth.md:21` — the `POST /oauth/register` route row; the file makes no
  fail-open claim (grep `fail-open|best-effort|defaults to enabled` → no match), so it is not edited (`D-16`).
- `services/xstockstrat-agent/docs/context-constitution-findings.md:91` — the
  `2026-10-29-agent-dcr-fail-closed-defect` row.
- `services/xstockstrat-agent/acceptance/fix-agent-getconfig-deadline.feature:37-43` — `@AC-4 @FR-2 @regression
  @feature-247` "OAuth dynamic client registration does not hang", `Then … with HTTP 201` (`:42`), `And the body
  carries a client_id …` (`:43`).
- Operator sign-off for the 247 `@AC-4` change: context.md § Session 2026-11-10 (operator decisions before
  /sdd-design).

**Lands with**: `Step 8`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `watch_core.py` — add to `class WatchCore`, directly after `wait_for_snapshot` (`:153-160`), a public
   `has_snapshot(self) -> bool` returning whether `getattr(self, "_snapshot", None)` is not `None` (a snapshot
   retained after a stream disconnect still counts, `D-6`). Apply the **identical** edit to all four copies; the
   files must stay byte-identical. No stream-liveness signal (`R-2`).
2. `services/xstockstrat-agent/app/config/watcher.py` — after `get_watcher` (`:64-65`) add
   `has_snapshot(namespace: str) -> bool`: `False` when the namespace has no watcher, else the watcher's
   `has_snapshot()`. Module code calls the public method only, never `_snapshot` (`R-3`).
3. `services/xstockstrat-agent/app/oauth_server.py`:
   - `:28` also import `has_snapshot as has_config_snapshot`.
   - In `register`, directly after the JSON parse (`:78-83`) and before the `registration_enabled` read, return
     `JSONResponse({"error": "server_error"}, 503)` when `has_config_snapshot("agent")` is false, with one WARNING
     log line. Use `server_error`, not `temporarily_unavailable` (`R-4`).
   - The two `except Exception` branches (`:88-90`, `:106-108`) return the same 503 instead of defaulting to
     enabled / an empty allowlist; their log text no longer says "defaulting".
   - Replace the `:85` comment with a constraint comment of at most two lines: the guard is defensive (boot blocks
     on the snapshot, so it is unreachable after a correct start) and must not be removed as dead code — an
     unreadable policy must never register a client (`D-7`).
   - Unchanged: a readable snapshot with the key unset keeps the defaults (`true` / `""`); a readable `false`
     still returns 403; the `:138` 500 for an identity failure stays. The 503 path adds no metric label
     (agent `@AC-47` preserved).
4. `services/xstockstrat-agent/CLAUDE.md:208`: "(disabled ⇒ 403)" becomes "(disabled ⇒ 403; policy snapshot
   absent ⇒ 503)".
5. `docs/context-constitution-findings.md:91`: mark the row resolved by feature 319 (fail-closed 503).
6. `acceptance/fix-agent-getconfig-deadline.feature` `@AC-4` — amend in place (`D-8`): add `@feature-319` to the
   tag line; the Given at `:39` becomes "the agent has no readable config snapshot for namespace \"agent\"";
   `:42` becomes "Then the endpoint responds within 2 × D plus 1 second with HTTP 503" (the no-hang bound is
   kept); `:43` becomes "And no client_id is issued". Keep the scenario title and the `:40-41` lines.
7. No new outbound gRPC call; header propagation is unaffected. No trading-domain surface is touched.

**Verification**:
```bash
# Every line runs from the repo root; the subshells keep the working directory there.
bash scripts/check-watcher-copies.sh   # "all groups byte-identical"
(cd services/xstockstrat-agent && ruff check . && ruff format --check . && uv run pytest --cov=app --cov-fail-under=40)
for s in indicators ingest analysis; do (cd services/xstockstrat-$s && ruff check app/config/watch_core.py && ruff format --check app/config/watch_core.py && uv run pytest tests/test_config_watcher.py -q); done
grep -n "def has_snapshot" services/xstockstrat-agent/app/config/watch_core.py services/xstockstrat-agent/app/config/watcher.py
grep -n "defaulting to" services/xstockstrat-agent/app/oauth_server.py   # expect no match
grep -n "_snapshot" services/xstockstrat-agent/app/oauth_server.py   # expect no match (R-3)
grep -n "@feature-319\|HTTP 503" services/xstockstrat-agent/acceptance/fix-agent-getconfig-deadline.feature
```
The per-service `tests/test_config_watcher.py` run is a smoke for the three other owners: each file builds that
service's `ConfigWatcher` on the edited `watch_core.py`. `has_snapshot` has no caller in those services, so its
behaviour is tested only in the agent (Step 8); the copies are held equal by `check-watcher-copies.sh`.
Run as the Steps 7+8 unit.

---

### Step 8 — test: 319 @AC-3, the inverted fail-open test and the readable-false 403

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_oauth.py` — modify

**Reviewers**: xstockstrat-agent owner — OAuth 2.1 edge-auth correctness; Security — auth scope

**Codebase Evidence**:
- `tests/test_oauth.py:139-151` `test_register_returns_client_id` (201 on the conftest snapshot with the keys
  unset); `:154-157` non-https 400; `:160-165` `test_register_disabled_returns_403` (sets
  `get_watcher("agent")._snapshot.values["oauth.registration_enabled"].bool_val = False`);
  `:168-183` `test_register_survives_config_read_failure` asserts **201** with `read_config_value` raising.
- `tests/conftest.py:112-130` autouse `config_snapshots` registers a dial-free watcher per namespace with
  `monkeypatch.setitem(watcher._WATCHERS, ns, w)`; a bare instance is built with
  `watcher.ConfigWatcher.__new__(watcher.ConfigWatcher)`.
- The lifespan re-creates a missing watcher and waits up to 90 s for its snapshot:
  `app/config/watcher.py:93-97` (`if ns not in _WATCHERS: _WATCHERS[ns] = ConfigWatcher(endpoint, ns)`), started
  from `app/main.py:92`. So the `agent` watcher must be removed **after** `TestClient(_app())` has entered, never
  before.
- `tests/test_config_watcher.py:46-50` `install_watcher(monkeypatch, namespace, **values)` — the public way to set
  snapshot values (imported by `tests/test_tools.py:24`).
- `tests/conftest.py:134` `hung_config_server` patches the `GetConfig` path and cannot drive `@AC-3` (recon.md).
- No other test posts to `/oauth/register` or patches `oauth_server.read_config_value`
  (`grep -rn "oauth/register\|read_config_value" tests` → `test_oauth.py` and one unrelated `tools` patch at
  `test_tools.py:445`).

**Lands with**: `Step 7`

**TDD**: `red-green required`

**Covers**: `AC-3`

**Instructions**:
1. Invert `test_register_survives_config_read_failure` (`:168-183`): rename it to
   `test_register_fails_closed_on_config_read_failure`; with `read_config_value` raising it now asserts status
   503, body `{"error": "server_error"}`, no `client_id` key, and that the patched `client.register_oauth_client`
   was not awaited. Replace its docstring (it cites feature 093's best-effort rule).
2. Add `@AC-3 (319)` `test_register_refused_without_policy_snapshot`: use `install_watcher(monkeypatch, "agent",
   **{"oauth.registration_enabled": False})` for the scenario's first Given; enter `with TestClient(_app()) as tc:`;
   **inside** the block remove the watcher with `monkeypatch.delitem(watcher._WATCHERS, "agent")`; POST
   `{"redirect_uris": ["https://attacker.example/cb"]}`; assert 503, `{"error": "server_error"}`, no `client_id`,
   and `client.register_oauth_client` (an `AsyncMock`) not awaited. Do not mutate `_snapshot` (`R-3`).
3. Add `test_register_refused_when_watcher_has_no_snapshot`: inside the `TestClient` block, replace the `agent`
   entry with a bare `watcher.ConfigWatcher.__new__(watcher.ConfigWatcher)` (no `_snapshot` attribute) via
   `monkeypatch.setitem` → 503. This covers `WatchCore.has_snapshot()` returning false.
4. Add `test_register_readable_false_returns_403`: `install_watcher(monkeypatch, "agent",
   **{"oauth.registration_enabled": False})` → 403 `access_denied`, proving a readable `false` is not turned into
   503. Leave `test_register_disabled_returns_403` (`:160-165`) as it is.
5. Add an ordering assertion: with no snapshot, a body whose `redirect_uris` is empty still gets 503, not the 400
   (the snapshot check precedes the `redirect_uris` validation); an invalid JSON body still gets 400.
6. `test_register_returns_client_id` (`:139-151`) must stay green unchanged: a readable snapshot with the keys
   unset keeps the defaults.
7. C-13: the redirect URI and policy value are scenario one-offs in the single DCR test module; inline is
   compliant, nothing moves to `tests/conftest.py`.
8. RED evidence: on the pre-Step-7 tree the three new no-snapshot tests get 201/400 instead of 503.

**Verification**:
```bash
cd services/xstockstrat-agent && ruff check . && ruff format --check . && uv run pytest --cov=app --cov-fail-under=40
uv run pytest tests/test_oauth.py -k "register" -q
grep -n "test_register_survives_config_read_failure" tests/test_oauth.py   # expect no match
grep -n "AC-3 (319)\|attacker.example" tests/test_oauth.py
grep -n "_snapshot\b" tests/test_oauth.py   # only the pre-existing line in test_register_disabled_returns_403
grep -n "def .*fixture\|conftest" tests/test_oauth.py   # C-13: no new fixture; single-consumer inline literals
```
Preserved in the same run: 247 `@AC-1/@AC-5` and agent `@AC-47` suites.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
