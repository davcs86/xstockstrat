# Design: fix-marketdata-secret-exposure

**Created**: 2026-10-22
**Rounds**: 2 (full; termination: approved)
**Approved by**: user @ 2026-10-22 (design gate r2; operator approval, Floor clear)
**Grounded in**: recon.md

---

## Chosen Approach

This design has two independent, surgical Track C fixes. Each fix gets its own step, and each step's tests are written to fail first (P-06). There is no proto change, migration, config key, env var or DB-pool change (recon.md:87-93). The change is internal-only: there is no UI segment or agent-tool surface (C-14). The only consumer-visible effect is the text of the `CodeUnavailable` message returned by marketdata's `GetFundamentals` / `GetFundamentalsMulti`. That text keeps the vendor and the path and drops the key-bearing URL (recon.md:89).

### Step 1: D-39 client redaction (marketdata)

**Transport-error sites.** These are the two transport-error returns in the shared `getJSON`:
- `services/xstockstrat-marketdata/internal/fmp/fmp_client.go:241-243` (recon.md:27-28);
- `internal/finnhub/finnhub_client.go:116-118` (recon.md:32-33).

Each one unwraps the `*url.Error` and wraps only its inner cause. The else-branch carries no cause:

```go
var ue *url.Error
if errors.As(err, &ue) {
    return fmt.Errorf("fmp: %s request failed: %w", path, ue.Err)
}
return fmt.Errorf("fmp: %s request failed", path)
```

- Finnhub gets the same shape with the `finnhub:` prefix.
- The cause-free fallback means a future non-`*url.Error` path cannot reintroduce the URL.
- Wrapping `ue.Err` keeps `errors.Is(err, context.DeadlineExceeded/Canceled)` working, along with the dial/TLS cause (recon.md:109).
- This reuses the rule the non-2xx branch already follows, "never include the URL" (`fmp_client.go:254-255`, `finnhub_client.go:126-127`; recon.md:54).

**Build-request sites (scope addition, operator 2026-10-22).** These fold into this step under the same no-URL rule:
- `fmp_client.go:226` (`"fmp: build request: %w"`);
- `finnhub_client.go:114` (`"finnhub: build request: %w"`).

For a malformed operator-set `base_url`, the `http.NewRequestWithContext` error is a `*url.Error` (`Op: "parse"`) that carries the full raw URL, including the key (recon.md:107). The shape is the same unwrap: `fmt.Errorf("fmp: %s build request: %w", path, ue.Err)`, with a cause-free else-branch. Finnhub matches.

**Untouched.** `reserve()` and the refund `defer` (`fmp_client.go:231-240`) are not moved. The `return` stays after `reserve()` and the `counted` logic is unchanged, so feature-217 @AC-4 holds (recon.md:26, :78). `getJSON` is the single chokepoint, so the fix also covers the classification refresh (`classification_service.go:205`) and the `fetchProfile` filler.

**Tests (AC-1, AC-2).** These are real-dial tests:
- Build clients with `fmp.NewClient` / `finnhub.NewClient` (`fmp_client.go:60`, `finnhub_client.go:35`) using BaseURL `http://127.0.0.1:1` and APIKey `k-secret`.
- Call FMP `GetFundamentalsMulti` (first call `/stable/quote`, recon.md:29), FMP `fetchProfile`, and Finnhub `GetFundamentals` (`/stock/metric`, recon.md:34). Use Finnhub `GetFundamentals`, not `GetFundamentalsMulti`, because Multi swallows per-symbol errors (recon.md:35).
- Each test asserts three things:
  - the vendor and path are present;
  - `k-secret`, `apikey=` and `token=` are absent;
  - `errors.As(err, new(*url.Error))` is false.

**Further tests.**
- **Ctx-timeout case, one per client.** An `httptest` server blocks and the ctx has a short deadline. The test asserts `errors.Is(err, context.DeadlineExceeded)`, which proves the inner cause is preserved.
- **Build-request case, one per client** (operator scope addition). A BaseURL with an invalid control character (for example `"http://127.0.0.1:1\x7f"`) makes the parse fail. The test asserts the path is present, `k-secret`, `apikey=` and `token=` are absent, and there is no `*url.Error` in the chain.

### Step 2: D-39 service-edge tests (AC-5, AC-7; tests only)

- Pass a real `*fmp.Client` into `newFundSvc(enabledCfg("fmp"), newFakeFundRepo(), client, …)` (`marketdata_service_test.go:309`/`:290`/`:188`). `*fmp.Client` satisfies `source.FundamentalsSource` (`fmp_client.go:157`; recon.md:58-62).
- Assert `CodeUnavailable` and a key-free message on the single RPC (`marketdata_service.go:1760`, AC-5) and on the batch RPC (`:1704`, AC-7). Use the assertion pattern at `marketdata_service_test.go:2930`.
- The service-layer `%w` wraps stay unchanged. They only test sentinels (`ErrFMPDailyCapExceeded`, `ErrNoFundamentals`), never the transport chain (recon.md:37).

### Step 3: D-40 SAN-bound grant (config)

The commits inside this step follow a fixed order.

**(3a) Shared PKI helper.**
- Create `services/xstockstrat-config/src/__tests__/mtlsTestPki.ts`. It exports only `sh`, `mintLeaf` and `setEnv`, moved verbatim from `peerSanSpike.test.ts:17-33` and `mtls.test.ts:21-23,35-41,57-60`. The two copies were verified identical in round 2.
- There is no `mintCa`, because `mtls.test.ts` `mintPki` (`:43-55`) mints two CAs inline with distinct CNs.
- The two existing files change only by dropping their local copies and adding an import.
- `tsconfig.json:14` (`src/**/*`) compiles the helper. `package.json:12-13` runs only `*.test.js`, so the helper never runs as a test, and c8 excludes `__tests__/**`.

**(3b) Wire harness, scoped to the GetSecret describe of `secretsAndScope.test.ts` (`:63-136`).** This resolves recon.md:104.
- Mint the test CA inline with one `sh('req','-x509',…)` line, which is below the jscpd floor.
- Mint three leaves via `mintLeaf`: `xstockstrat-config` (server), `xstockstrat-marketdata` and `xstockstrat-ingest`.
- The server binds with `mtls.serverCredentials()` (`mtls.ts:22`) instead of `createInsecure()` (`:75`).
- Two `ConfigServiceClient`s use `mtls.clientCredentials()` (`mtls.ts:28`) plus `mtls.targetOverride('xstockstrat-config')` (`mtls.ts:35`), with `setEnv` called before each one. `load()` runs per call (`mtls.ts:11-31`).
- The existing AC-4 (`:88`), AC-5 (`:98`, `:108`) and AC-16 (`:117`, `:127`) tests run on the wire through the marketdata client.
- Commit 1 is the harness switch, shown green while the grant is still header-only.
- Commit 2 adds wire AC-3: `x-internal-caller: marketdata` over the ingest leaf, expecting `PERMISSION_DENIED`. Its red run is recorded as evidence. A valid-CA, wrong-SAN negative is the required proof of a SAN check (`fails.md:2403-2406`; recon.md:112).
- The SetConfig encrypt describe (`:139+`) stays insecure.
- openssl already runs in the same `pnpm test:coverage` job (`ci.yml:587`).

**(3c) Grant, commit 3.**
- Add `peerSan: 'xstockstrat-marketdata'` to the marketdata entry at `src/grpc/authz.ts:115-119`, mirroring the ingest entry (`:124`) (recon.md:41-42, :55).
- Enforcement already exists (`hasSecretCallerAuthority` `:149`, SAN check `:162`; recon.md:44-47). The handler needs no change (`configServiceImpl.ts:337`; recon.md:48).
- The ingest grant (`:124`) and the SetConfig grant (`:66-76`, owned by feature 241) are untouched.
- Wire AC-3 turns green, and it is the only test that changes state.

**(3d) Unit layer, in the same commit.**
- Replace `perUserSecrets.test.ts:236-248` (recon.md:102) with:
  - AC-4: `DNS:xstockstrat-marketdata` returns `found=true`;
  - AC-3: `DNS:xstockstrat-ingest` is denied;
  - AC-6: `() => ({})` and `undefined` are denied, reusing the trio at `:188-196` (recon.md:64).
- This is the only home of the unit deny matrix.
- `secretCallerAuthz.test.ts:57-60` changes only to `callWith('marketdata','DNS:xstockstrat-marketdata')` (recon.md:103). No deny cases are added there.
- AC-6 is tested at the unit layer only, because an mTLS server rejects a peer with no certificate before the handler runs.

### Step 4: Docs and tracking

- Update `services/xstockstrat-config/CLAUDE.md` invariant #6: the marketdata grant also requires DNS SAN `xstockstrat-marketdata` (recon.md:139).
- File `docs/reports/<date>-marketdata-vendor-key-url-residuals-defect.md` with a `.status` sidecar. With the build-request sites folded into Step 1, the report covers what is left:
  - **(a) Redirect residual.** Go's `failed to parse Location header %q` error can embed a URL the vendor sent.
  - **(b) Access logs.** Query-string keys reach proxy and vendor access logs.
- The report names key-in-header (FMP `apikey` header, Finnhub `X-Finnhub-Token`) as the fix that closes the class, and a shared `redactURLError` helper as the consolidation point.
- `context.md` records (a) as an accepted residual with no test and points to the report.
- The teardown audit (`fails.md:670`) also checks two places for drift:
  - the Config Governance paragraph in the root `CLAUDE.md`;
  - `services/xstockstrat-marketdata/CLAUDE.md`, where the GetSecret grant is described as header-only.

### Step 5: Mechanical dev smoke check

1. Pick a marketdata boot whose timestamp is after the new config instance became healthy. Force a marketdata restart after config is up if needed.
2. Grep its boot logs for the ASCII substring `resolving vendor credential from config failed` (`main.go:70`; recon.md:21).
3. Pass means zero matches. Any match fails the check.

Rollback is reverting the Step 3c `authz.ts` line alone. Steps 1-2 are independent of it (recon.md:144). The cert material was re-confirmed before merge: `gen-dev-certs.sh:28`/`:50` and `deploy.yml:102` (recon.md:94-97).

### Promotion (P-03/C-16)

At launch, feature AC-3, AC-4 and AC-6 are promoted alongside config `@AC-4`, which is never rewritten. Each new scenario names `@AC-4` and states the tightening: "allow-listed" means header plus DNS SAN for grants that set `peerSan`. The user signed off on this CHANGE at the 2026-10-22 design gate.

## Rejected Alternatives

- **`mintCa(dir)` in the shared PKI helper:** rejected because it cannot serve the second CA in `mtls.test.ts` `mintPki`, which has a different CN (`:43-55`), and it breaks the import-only promise for the existing files.
- **Deny cases in `secretCallerAuthz.test.ts`:** rejected because they would repeat the `perUserSecrets.test.ts` deny matrix and wire AC-3, leaving three places to keep in sync (C-18).
- **A Step 1 fallback that `%w`-wraps the raw err when `errors.As` fails:** rejected because any future non-`*url.Error` path would leak the URL again.
- **Direct-handler-only config tests with a stubbed `getAuthContext`:** rejected because they drop the wire-level guarantee (`secretsAndScope.test.ts:8-10`, `fails.md:668`) and leave no real valid-CA, wrong-SAN handshake for AC-3.
- **Inlining a third copy of the PKI helpers:** rejected because `mintLeaf` is above the jscpd 100-token floor (`.jscpd.json:4`).
- **Dropping `%w` entirely:** rejected because it loses `errors.Is(ctx.DeadlineExceeded/Canceled)` and the dial/TLS cause.
- **A shared `redactURLError` Go helper now:** rejected because it is about 4 lines at a few sites in 2 packages, below the jscpd floor, and would need a new package (YAGNI). It is named in the residual report as the consolidation point.
- **String-scrubbing `apikey=`/`token=` from error text:** rejected because it is fragile and only treats the symptom.
- **Putting the key in a request header (the fix that closes the class):** rejected because it is outside the D-39/D-40 scope and vendor header support is unverified. It is deferred to the residual defect report as the recommended fix.
- **A redirect-server test for the Location-header residual:** rejected because the input must come from the vendor and the fix that closes it is out of scope. It is an accepted residual, recorded in context.md and the report.
- **Leaving the `build request: %w` sites in the defect report (the round-2 default):** rejected by the operator at the 2026-10-22 gate. They are the same rule in the same two functions, so they fold into Step 1, each with its own test.
- **Smoke grep on the em-dash string, or on any boot:** rejected because log encoding could give a false zero, and a boot from before the config deploy passes vacuously.

## Open Risks

- [ ] **A SAN mis-bind fails soft.** If a marketdata leaf lacks `DNS:xstockstrat-marketdata`, then GetSecret returns `PERMISSION_DENIED`, `main.go:70` WARNs, marketdata boots with empty vendor credentials, and health checks stay green. Mitigations: `deploy.yml:102` mints all leaves via `gen-dev-certs.sh`, and Step 5 runs the smoke check. Prod gets no separate check. To be addressed at Step 5 and the pre-merge gate for Step 3.
- [ ] **The mTLS harness switch could fail for harness reasons.** Possible causes are `targetOverride`/SAN pairing for the `xstockstrat-config` server leaf, or env sequencing. Mitigation: the commit order (green harness, then red AC-3, then the grant). To be addressed at Step 3 (3b).
- [ ] **Accepted redirect residual.** A malformed vendor `Location` header can still embed a key-bearing URL in the inner cause. To be addressed at Step 4 (defect report).
- [ ] **Query-string keys still reach proxy and vendor access logs** until the key-in-header fix lands. To be addressed at Step 4 (defect report).
- [ ] **Body-read wrap (`fmp_client.go:251`, `"fmp: read %s body: %w"`).** Recon did not establish whether an `io.ReadAll` error can embed the URL (recon.md:108). To be addressed at /sdd-spec and Step 1: confirm it, and add an assertion if it can.
- [ ] **Textual merge overlap.** Features 241 and 263 touch `authz.ts` and 241 touches `perUserSecrets.test.ts`; 255 touches the three marketdata files. Whichever lands second rebases. To be addressed at Step 1 and Step 3 rebase time.
- [ ] **The mTLS harness adds RSA key-generation time** (one CA, three leaves) to the config test suite. Accepted; to be watched at Step 3.

## Constitution Rules Touched

- `C-01`: honored by keeping the fix inside the owning services. Marketdata owns its client errors and config owns its allow-list, and there is no cross-service contract change.
- `C-08`: honored because no secret plaintext appears in any error, log or status. Secrets stay decryptable only through `GetSecret`, now gated by header plus mTLS SAN.
- `C-11`: honored by the full 2-round debate, the operator design-gate approval, and the design-phase ledger touch below.
- `C-15`: honored by tracing every FR to an `@AC-*` in `acceptance.feature` (AC-1..AC-7) and naming the test that proves each one.
- `C-16`: honored by recording the config `@AC-4` CHANGE with user sign-off, and promoting the new scenarios alongside it, never rewriting it.
- `C-18`: honored by having one home for the unit deny matrix, one shared PKI helper instead of a third copy, and no premature Go redaction helper.
- `P-02`: honored because proposer and adversary saw only mediated, synthesized state.
- `P-03`: honored by surfacing both gate questions (the @AC-4 CHANGE and the build-request fold) to the user instead of guessing. Both were answered on 2026-10-22.
- `P-05`: honored by appending decisions to context.md as they happened.
- `P-06`: honored by writing every step red-first. Step 3's red evidence is the wire AC-3 run before the grant change.
- **Floor (`F-*`):** no breaches.
- **Operator trace-id decision (2026-10-21):** not engaged, because neither fix adds an emit or write path.

## Business Rules Touched (C-16)

- CHANGE `@AC-4` "An allow-listed internal caller resolves a secret via GetSecret" (`services/xstockstrat-config/acceptance/config-secrets-and-scoping.feature`, `@FR-3 @feature-147`). The guarantee narrows from header-only to header plus DNS SAN for grants that set `peerSan`, so marketdata now requires `xstockstrat-marketdata`.
  - Signed off by the user @ 2026-10-22 at the design gate, round 2 (context.md, Session 2026-10-22 sdd-design).
  - Promoted alongside @AC-4, never rewriting it.
- PRESERVE `@AC-5` "GetSecret fails closed for a caller not on the allow-list" (same file). Not regressed, because the existing deny tests (`secretsAndScope.test.ts:98`, `:108`) run unchanged on the wire. Feature AC-3/AC-6 add the wrong-SAN and no-SAN deny cases next to it.
- PRESERVE `@AC-16` "GetSecret distinguishes an unset secret from a decrypt failure" (same file). Not regressed, because `secretsAndScope.test.ts:117`, `:127` still assert `found=false` vs `INTERNAL` over the mTLS harness, using the real marketdata leaf.
- PRESERVE `@AC-2`, `@AC-3`, `@AC-14` (config redaction at every read edge). Not regressed, because the read and broadcast paths are untouched.
- PRESERVE marketdata `@AC-6` / `@AC-7` `@feature-147` (vendor credential resolved from config; a missing credential warns but marketdata still starts). Not regressed, because the real leaf carries the SAN. Step 5 smoke-checks it, and the warn-and-start behavior is unchanged.
- PRESERVE marketdata `@AC-7` `@feature-215` (absence vs outage mapping). Not regressed, because the service wraps and sentinel checks are unchanged and the transport error still maps to Unavailable.
- PRESERVE `@AC-4` `@feature-217`, both "An FMP outage does not break classification reads" and "Failed FMP calls refund the shared daily budget". Not regressed, because `reserve()` and the refund `defer` are untouched and the `return` stays after `reserve()`.
- EXTEND the feature's own `254:@AC-1`, `@AC-2`, `@AC-3`, `@AC-5`, `@AC-6`, `@AC-7`. These are new regression guarantees covered by the operator scope decision (D-39/D-40). `254:@AC-4` is PRESERVE: the happy path for the real marketdata leaf.
- Not impacted: `docs/sdd/business-rules/platform.feature` `@AC-35 @feature-224` (the ingest SAN precedent) and `@AC-1/2/4/5 @feature-210` (mTLS transport, which is relied on and not altered).
