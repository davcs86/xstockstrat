# Context: fix-marketdata-secret-exposure  (archived 2026-11-04)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-11-04 — /sdd-archiver

> Cite convention: this file's pre-archive text and the deleted specs are cited at the pre-archive SHA as
> `old context.md@1ed63958:N`, `design.md@1ed63958:N`, `implementation-spec.md@1ed63958:N`, `recon.md@1ed63958:N`,
> `product-spec.md@1ed63958:N` (`git show 1ed63958:docs/roadmap/features/254-fix-marketdata-secret-exposure/<file>`).
> Source cites without a SHA were re-opened at the archive-time tree (origin/main-dev lineage); where a line number drifted the current
> anchor is given and marked "drifted".

**What**: SEV-2 Track C bug fix closing two vendor-credential leaks found by the debt-radar scan (D-39, D-40). D-39:
the FMP and Finnhub `getJSON` now unwrap the `*url.Error` and `%w`-wrap only `ue.Err` (cause-free fallback) at both the
transport (`Do`) and build-request sites, so the `apikey=`/`token=` query key never reaches errors, gRPC
`Unavailable` statuses, logs or OTel (`fmp_client.go:246,248,267,269`, `finnhub_client.go:121,123,129,131` at HEAD,
drifted from the spec's `:226/:243` and `:114/:118`). D-40: config's `marketdata` `GetSecret` grant is now bound to
`peerSan: 'xstockstrat-marketdata'` (`authz.ts:137` at HEAD, drifted from `:119`), like the ingest grant. 9 steps, no
proto/migration/config-key/env change. Landed on main-dev as integration PR #1344 (squash `1b5a922a`, deployed to dev
2026-10-29; old context.md@1ed63958:631, :638-639); launched 2026-10-30 via the main promotion PR #1368 (commit
`df521ff5`).

**Why (irrecoverable rationale)**:
- Operator scope (binding, 2026-10-21): D-39 and D-40 only, grouped by service+theme, Track C for SEV-2 per
  precedent #1264 (old context.md@1ed63958:13, :46-48).
- Unwrapping `ue.Err` (rather than dropping `%w`) was chosen to keep `errors.Is(ctx.DeadlineExceeded/Canceled)` and
  the dial/TLS cause; the cause-free `else` branch exists so a future non-`*url.Error` path cannot reintroduce the URL
  (design.md@1ed63958:20-33, :125, :128).
- The SAN-bound grant was preferred over any new code path because enforcement already existed
  (`hasSecretCallerAuthority`, `authz.ts:149-162` at design time; now function `:168`, SAN check `:181`); the fix is one grant line plus
  tests (design.md@1ed63958:83-86).
- Feature 224 had deliberately SAN-bound only the new ingest grant and left marketdata header-only
  (`224-private-by-default-templates/implementation-spec.md:1615`, `context.md:741`, per old
  context.md@1ed63958:19-20; 224's files are cited from this feature's text, not re-opened by this drafter).
- AC-1/AC-2 use real-dial tests (`http://127.0.0.1:1`, key `k-secret`) rather than a stub RoundTripper; the reason is not
  recorded (design.md@1ed63958:43 says only "These are real-dial tests"; recon.md@1ed63958:56 lists a returning-error
  RoundTripper as the alternative, and product-spec.md@1ed63958:64 gives `127.0.0.1:1` + `k-secret` as the repro).
- The wire (mTLS) harness for the `GetSecret` describe was kept, rather than a direct-handler stub. Two grounds:
  the wire-level guarantee at `secretsAndScope.test.ts:8-10`, backed by `fails.md:668` (the 2026-07-27
  metadata-delivery lesson; design.md@1ed63958:126), and a SAN check is only proven by a valid-CA wrong-SAN handshake
  (`fails.md:2403-2406`; design.md@1ed63958:78).

**Rejected alternatives** (all from design.md@1ed63958:121-134 and the round-2 state, old context.md@1ed63958:181-193):
- `mintCa(dir)` in the shared PKI helper — lost: cannot serve `mtls.test.ts` `mintPki`'s second CA with a different CN
  (`foreign-ca`), breaking the import-only promise.
- Deny cases in `secretCallerAuthz.test.ts` — lost: repeats the `perUserSecrets.test.ts` unit deny matrix and wire AC-3
  (three places to sync, C-18); only the allow case gets the SAN added.
- Fallback that `%w`-wraps raw `err` when `errors.As` fails — lost: a future non-`*url.Error` path would re-leak.
- Direct-handler-only config tests with stubbed `getAuthContext` — lost: drops the wire-level guarantee and the real
  valid-CA wrong-SAN handshake.
- A third inline copy of the PKI helpers — lost on the stated ground that `mintLeaf` exceeds the jscpd 100-token floor
  (but see Scars: that ground was moot for test files; the C-18 DRY reason stands).
- A shared Go test package for `assertNoKeyLeak` — lost (YAGNI); the helper stays file-local in each client's test file,
  justified as "below the jscpd floor (`.jscpd.json:4`)" (implementation-spec.md@1ed63958:233-234). Same moot ground:
  `.jscpd.json:22` ignores `**/*_test.go`.
- Dropping `%w` entirely — lost: loses `errors.Is(DeadlineExceeded/Canceled)` and the dial/TLS cause.
- Shared `redactURLError` Go helper now — lost: ~4 lines at 2 sites in 2 packages, below the floor, would need a new
  package (YAGNI). Named in the residuals report as the consolidation point.
- String-scrubbing `apikey=`/`token=` from error text — lost: fragile, treats the symptom.
- Key in a request header (FMP `apikey` header, Finnhub `X-Finnhub-Token`; the class-closing fix) — lost for this
  feature: outside D-39/D-40 scope and vendor header support unverified; deferred to the residuals report.
- Redirect-server test for the Location-header residual — lost: input must come from the vendor and the closing fix is
  out of scope; accepted residual, untested.
- Leaving the `build request: %w` sites in the defect report (the round-2 default) — rejected by the operator at the
  design gate 2026-10-22 (old context.md@1ed63958:231-233).
- Smoke grep on the em-dash string or on any boot — lost: log encoding could give a false zero, and a pre-config-deploy
  boot passes vacuously (design.md@1ed63958:134); the ASCII substring on a post-config-healthy boot was chosen.

**Operator decisions (binding)**:
- 2026-10-21: grouped by service+theme from the 2026-10-20 debt-radar scan; Track C; scope D-39/D-40 only; batch via
  /sdd-batch with designGate halt (old context.md@1ed63958:13, :46-48).
- 2026-10-22 design gate r2 (old context.md@1ed63958:225-235): approved as synthesized; explicit C-16 sign-off for the
  CHANGE to config `@AC-4` (header-only -> header + DNS SAN for grants that set `peerSan`), with the promotion form
  also chosen by the operator: "promoted at launch alongside `@AC-4`, which is never rewritten" (:227-230; round 2
  had already called the form "settled", :97, :115); scope addition folding the
  `build request: %w` sites into Step 1 (overrides the round-2 default); standing x-trace-id/no-C-03-waiver decision
  (2026-10-21) not engaged (no new emit/write path).
- 2026-10-28 (standing authorization, operator chat in session_01NpS3HShZK6pSnogA7CFo2f): sequential execute with
  unattended checkpoints, C-16 promotion auto-confirmed unless it changes an existing `@AC` rule, merge-train
  authorized, 255 and 275 deferred, operator-only DB/prod steps hold the merge (old context.md@1ed63958:346-354).
- 2026-10-29: Step 9 (dev smoke) set `done` while still unperformed, as post-merge verification that no longer holds the
  integration PR; the same update widened its check to "Grafana logs/traces, or the Verification grep" (old
  context.md@1ed63958:513-516; implementation-spec.md@1ed63958:621-628, :625).
- 2026-10-29: amend the existing config feature-147 `@AC-4` in place (see Permanent deviations #1) (old
  context.md@1ed63958:626). It reached the operator because the standing authorization auto-confirms C-16 promotion
  "unless it changes an existing @AC rule" (:351-352, :408) and the promotion planner had flagged "CHANGES EXISTING
  RULE" (:616); this overrode the 2026-10-22 operator decision above, not only the design.

**Unrecorded / waived gates**:
- No `merge-order.md` row was ever recorded for 254 against 215, 241, 255, 263 (impl-spec review open thread,
  old context.md@1ed63958:326-336); 241, 255 and 263 are now `launched` (their textual-overlap risk is moot), but 215 is
  still `in-progress` (`docs/roadmap/features/215-block-fundamentals-strategy-on-etf/status.md`), so that pair is open.
- `/context-forge:context-constitution` teardown was unavailable in the execute session and was done by hand; the
  integration PR body was required to record both the plugin's unavailability and the manual reconciliation (old
  context.md@1ed63958:495-497; implementation-spec.md@1ed63958:640-649). Whether the PR body actually recorded it is
  not verifiable from the archived files. Related ledger scar: `fails.md` 2026-08-06 fix-mcp-writepath-authz (skipping
  the scan because the plugin was missing).
- The husky pre-commit hook never ran on the docs-only promotion commits (`core.hooksPath` pointed at a nonexistent
  `.husky/_`; no `node_modules` in the main worktree); `--no-verify` was not used (old context.md@1ed63958:627).
- Pre-merge SAN-material gate (P-03) was grepped at Step 7 against `gen-dev-certs.sh:28`, `:50`, `deploy.yml:101`
  (old context.md@1ed63958:479-480). The design/spec cited `deploy.yml:102`; the Step 7 re-spec re-pointed the grep to
  `:101` because `:102` would have blocked P-03 falsely after the main-dev merge (:340-341). Prod leaf SANs were never inspected ("Not found: running deployments' leaf SANs",
  recon.md@1ed63958:119); prod gets no separate check (design.md@1ed63958:138).

**Scars & gotchas**:
- Finnhub `GetFundamentalsMulti` skips per-symbol errors (`finnhub_client.go:64-69`, spec-time cite, not re-verified at
  HEAD), so AC-2 must drive
  `GetFundamentals`/`fetchMetric` (`/stock/metric`) or it sees no error at all; AC-1 is pinned to `/stable/quote`, FMP's
  first call (old context.md@1ed63958:50-53).
- Body-read wraps (`fmp "read %s body: %w"`, `finnhub` equivalent) need no change: only `Client.do`'s `uerr` builds a
  `*url.Error`; `cancelTimerBody.Read` returns the raw read error (go1.27.0 `client.go:997-1009`) (old
  context.md@1ed63958:286-292). The redirect residual cite `client.go:665` is `:648` on the go1.27.0 install, so the
  report cites `Client.do` by function and quoted text (implementation-spec.md@1ed63958:640-643).
- AC-6 (no peer SAN) is testable at the unit layer only: an mTLS server rejects a cert-less peer before the handler
  runs (design.md@1ed63958:95).
- Four existing config tests encoded the old "no SAN" behavior and break with the one-line grant: `perUserSecrets.test.ts`
  "no SAN required", `secretCallerAuthz.test.ts` marketdata allow case, and the `secretsAndScope.test.ts` AC-4/AC-16
  tests that ran over `createInsecure()` (recon.md@1ed63958:101-105). The grant and the unit-test flip must land in one
  commit or the suite goes red between steps (F-05) (old context.md@1ed63958:297-299).
- A SAN mis-bind fails soft: `GetSecret` denial surfaces only as the boot WARN `resolving vendor credential from config
  failed` (`main.go:78` at HEAD; spec-time cites `:70`, then `:77-78`), marketdata boots with empty vendor credentials,
  and health checks stay green (design.md@1ed63958:138; recon.md@1ed63958:110). Documented at marketdata
  `CLAUDE.md:223` at HEAD (drifted from `:218`) per Step 8.
- Sequential execute vs the spec's TDD order: the spec said author Steps 2-3 first and run RED before Step 1, but
  sequential mode executes Step 1 as its own unit. RED was captured with throwaway probe tests in Step 1, then for Steps
  2-3 by swapping in the pre-Step-1 client files from `ba303400^` and restoring HEAD (old
  context.md@1ed63958:361-366, :379, :397; implementation-spec.md@1ed63958:668-686).
- The spec marked `TestTransportError_PreservesDeadlineCause` "red N/A — characterization"; it was actually RED on its
  "no `*url.Error` in the chain" assertion (only its `errors.Is(DeadlineExceeded)` half held pre-fix). The spec, not
  the design, said N/A (old context.md@1ed63958:383-385; implementation-spec.md@1ed63958:674-681). Finnhub's
  `ClientConfig` has no `Metrics` field, so its test client omits it.
- The design justified the shared PKI helper partly by the jscpd 100-token floor, but `.jscpd.json` ignores
  `**/__tests__/**` and `**/*.test.ts` (verified at HEAD), so jscpd never scans those test files; `scripts/check-duplication.sh`
  also refused to run in the worktree and jscpd was run directly (0 clones in config) (implementation-spec.md@1ed63958:661-667).
  The spec repeated it for the Go `assertNoKeyLeak` helper ("below the jscpd floor", implementation-spec.md@1ed63958:233-234)
  although `.jscpd.json:22` ignores `**/*_test.go`; `docs/patterns/dry-guard-rail.md:39,75` already documents the
  test exclusion, so this was a miss to read the documented rule.
- Tooling: the provisioned `~/go/bin/golangci-lint` v2.14.0 was built with go1.26 and refuses the go1.27 module; rebuild
  at the same pin with `GOTOOLCHAIN=go1.27.0 go install .../golangci-lint@v2.14.0` into the scratchpad (old
  context.md@1ed63958:369-371). `doctl` is not installed in the agent sandbox; use the DO apps MCP `apps-get-logs`
  (old context.md@1ed63958:417).
- The config suite prints the node:test spec reporter, not TAP, so TAP-style verification greps never match; use
  `grep -E "AC-3 \(254\)|✖|ℹ fail"` (implementation-spec.md@1ed63958:656-660).
- Teardown by hand: the config `docs/context-constitution.md` `:35`/`:51` edits were spec-planned drift targets (sdd-spec
  grep, old context.md@1ed63958:300-304; Step 8, :486-490) and only their cites needed refreshing; the one drift found
  OUTSIDE the spec's Files was `docs/patterns/config-governance.md:25`, which named only the `ingest` grant as
  SAN-bound (implementation-spec.md@1ed63958:644-648).
- Dev smoke gotcha: Loki held no marketdata log streams, so the planned log grep could not run (and would have passed
  vacuously); the equivalent used was Tempo: 4 `ConfigService/GetSecret` spans at 06:47:56Z on the new config pod
  `xstockstrat-config-856865669c-zbmgm` with `rpc.grpc.status_code=0`, and 0 `GetSecret` spans with `status_code != 0`
  over 06:40-07:10Z (old context.md@1ed63958:629-634). PASS; no revert of the `authz.ts` line needed. The trace
  substitute was pre-sanctioned by the 2026-10-29 operator update ("Grafana logs/traces, or the Verification grep").

**Permanent deviations** (design.md checked directly for each "design said"):
1. design said promote feature AC-3/AC-4/AC-6 "alongside config `@AC-4`, never rewriting it" (design.md@1ed63958:119,
   :165) -> shipped: the new suites were created AND the existing config feature-147 `@AC-4 @FR-3` in
   `services/xstockstrat-config/acceptance/config-secrets-and-scoping.feature:42-47` was amended in place (added the
   precondition "the caller presents an mTLS peer certificate whose DNS SAN is `xstockstrat-marketdata`" and a
   `@feature-254` tag; 147 `@AC-5` untouched) -> because of an operator decision 2026-10-29 (old
   context.md@1ed63958:626). The scenario-promoter had flagged this as a tightening, not a literal CONFLICT, and
   planned additive-only (old context.md@1ed63958:616). The "never rewrite" premise was also an OPERATOR decision at the
   2026-10-22 gate (old context.md@1ed63958:227-230), so the amendment overrode that decision, and it reached the
   operator only because the standing authorization excludes changes to an existing `@AC` (:351-352, :408). Source of
   the premise: recon.md@1ed63958:106 left the form open ("decide at promotion time whether the new AC-3/4/6 sit beside
   or supersede the old @AC-4") and stated "The archiver never rewrites a promoted scenario"; design turned that open
   choice into "alongside, never rewrite".
2. design said the dev smoke is a mechanical grep of a post-config-healthy marketdata boot log for the ASCII
   substring `resolving vendor credential from config failed`, pass = 0 matches (design.md@1ed63958:109-115) -> shipped:
   the log grep could not run (no Loki streams); a Tempo positive-evidence check ran instead (see Scars). The substitute
   was pre-sanctioned by the 2026-10-29 operator update that widened Step 9 to "Grafana logs/traces, or the
   Verification grep" (implementation-spec.md@1ed63958:625; old context.md@1ed63958:515). Step 9 itself was marked
   `done` before it was performed, by operator decision, and the smoke ran post-merge in a separate operator session
   (old context.md@1ed63958:513-516, :629-634). Design had itself narrowed the product-spec ask, which wanted a positive
   signal ("confirm marketdata logs a **successful** vendor-credential resolve at boot",
   product-spec.md@1ed63958:92-93; the same sentence glosses it as "no `PERMISSION_DENIED` from `GetSecret`", so the narrowing is softer than it looks), to a zero-match grep (design.md@1ed63958:109-113); the shipped check returned to
   positive evidence.
3. design said Step 4 docs update only `services/xstockstrat-config/CLAUDE.md` invariant #6 plus a drift check of root
   CLAUDE.md and marketdata CLAUDE.md (design.md@1ed63958:97-107) -> shipped: also config
   `docs/context-constitution.md` (`:35`, `:51`; planned at spec time, old context.md@1ed63958:300-304, :486-490) and
   out-of-Files `docs/patterns/config-governance.md:25`, the only item the by-hand teardown found beyond the spec's
   Files (implementation-spec.md@1ed63958:644-648).
4. design numbered its steps 1-5; the spec renumbered to 9: design Step 3 (3a-3d) = spec Steps 4-7, design Step 4 = spec
   Step 8, design Step 5 = spec Step 9; design Step 2 = spec Step 3, design Step 1 split into spec Steps 1-2 (old
   context.md@1ed63958:280-282). Design "Open Threads" targets use design numbering.
5. Not a design deviation (spec only): body-read open thread resolved as "no change, no test" (design.md@1ed63958:142
   left it to /sdd-spec).

**Cross-feature signal**:
- Feature 224 shipped a SAN-bound ingest `GetSecret` grant and left marketdata header-only on purpose; the gap lived
  until 254. The sibling `SetConfig` internal-caller grant (`trading-reconciliation-poller`) still has no `peerSan`
  (`authz.ts:84-94` at HEAD; was `:66-76`): defect report
  `docs/reports/2026-10-20-config-setconfig-internal-caller-no-peersan-defect.md` is still `open`. Feature 241 (launched)
  scoped it out as a follow-up; 254 explicitly did not take it (product-spec Out of Scope; design.md@1ed63958:85).
  A SAN-binding rollout is per-grant, so each leftover header-only grant is its own defect.
- Feature 261 deferred its own D-40 here ("261 defers D-40 here", old context.md@1ed63958:70).
- Textual-merge overlaps handled by whichever lands second rebasing: 241 and 263 (`authz.ts`, 241 also
  `perUserSecrets.test.ts`), 255 (the three marketdata files), 215 (`fmp_client.go`/`finnhub_client.go`), 246 (reads the
  clients read-only). At HEAD 241, 246, 255, 261, 263 are `launched`; 215 is still `in-progress`
  (`docs/roadmap/features/215-block-fundamentals-strategy-on-etf/status.md`). At HEAD the FMP transport path additionally wraps in a `stageError`
  (`fmp_client.go:267,269`), a later change; the unwrap-and-`%w` shape is still present, but this drafter did not run the tests.
- Tag collision is intentional in the promoted suites: marketdata and config suites already carry `@feature-147`
  `@AC-6/@AC-7` and `@AC-4/@AC-5`; provenance is the `@AC`+`@feature` pair (old context.md@1ed63958:615).

**Deferred follow-ons** (still open as of archive HEAD):
- `docs/reports/2026-10-29-marketdata-vendor-key-url-residuals-defect.md` (sidecar `open`, SEV-2): (a) redirect
  `Location`-parse residual (`failed to parse Location header %q` can quote a vendor-sent URL; accepted untested, low
  confidence); (b) query-string keys reach vendor/proxy access logs (high confidence). Recommended fix that closes the
  class: key in request header (FMP `apikey`, Finnhub `X-Finnhub-Token`; vendor support unverified), plus a shared
  `redactURLError` helper if URL-bearing errors must still be handled. This report must NOT be pruned by the reports
  archiver while `open`.
- `docs/reports/2026-10-20-config-setconfig-internal-caller-no-peersan-defect.md` (sidecar `open`): the SetConfig
  `peerSan` gap (241's follow-up).
- Original defect report `docs/reports/2026-10-21-marketdata-secret-exposure-defect.md` (pruned 2026-11-04; git show 9892b610:docs/reports/2026-10-21-marketdata-secret-exposure-defect.md) had sidecar `triaged`
  (`ref: feature:254-fix-marketdata-secret-exposure`) when drafted; prunable by the reports pass only if the sidecar
  still reads `triaged` with that `feature:` ref and 254 is `launched` (sdd-archiver `reference/report-pruning.md` R-1).
- A `GetSecret` audit by caller SAN (debt-radar signal-map cross-reference) was listed Out of Scope and remains unbuilt
  (product-spec.md@1ed63958:107).
- Prod gets no separate SAN check; a leaf missing `DNS:xstockstrat-marketdata` would fail soft (boot WARN, empty
  credentials, green health). Stale at HEAD: the pre-merge gate cite `.github/workflows/deploy.yml:101/102`
  (`gen-dev-certs.sh` per env) no longer resolves — deploy.yml has no `gen-dev-certs` call since `515cbd09` (SOPS
  secrets migration, #1405); leaf provisioning for current deploys was not re-traced by this drafter.
- Open Threads that were closed: body-read wrap (resolved, no change); both gate questions (answered 2026-10-22).

**Ledger entries written**: insights.md (2), fails.md (2) — see the 2026-11-04 entries. The fails assumption entry on
the C-16 promotion form is written narrowly as a recurrence of `fails.md:2668-2671` (188). One further lesson already
covered: DUP `fails.md:3049-3052` (D-39 `*url.Error` unwrap, full coverage; the entry's Evidence cites `design.md Step 1`,
which this archive deletes -> read it as `git show 1ed63958:docs/roadmap/features/254-fix-marketdata-secret-exposure/design.md`).

**Runtime-invariant recommendations (→ /context-constitution)**:
- MARKETDATA candidate: `ResolveSecret` failure (including a `PERMISSION_DENIED` from a SAN mis-bind) is a boot WARN
  (`main.go:78`) that leaves vendor credentials empty while health stays green; a change to the marketdata leaf SAN or
  to the config `marketdata` grant (`authz.ts:137`, `peerSan: 'xstockstrat-marketdata'`) therefore must be verified by
  positive evidence of a successful `GetSecret` at boot. (Marketdata `docs/context-constitution.md` has MARKETDATA-9 on
  namespace-relative keys, not this.)
- CONFIG candidate: the `marketdata` and `ingest` `GetSecret` grants are SAN-bound while the `SetConfig`
  internal-caller grant is not (`authz.ts:84-94`); an invariant row distinguishing the three prevents "all grants are
  SAN-bound" assumptions. (Config `docs/context-constitution.md:35`/`:51` already updated by Step 8 for the two
  GetSecret grants.)
- Go client invariant: vendor HTTP clients that carry a credential in the query string must `%w`-wrap only
  `(*url.Error).Err` at both the build-request and `Do` sites, with a cause-free fallback (already codified as a ledger
  fail, `fails.md:3049-3052`).

**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 1ed63958.
acceptance.feature is retained (promoted 2026-10-29: marketdata AC-1/2/5/7 and config AC-3/4/6 in
`services/xstockstrat-{marketdata,config}/acceptance/fix-marketdata-secret-exposure.feature`; config feature-147 `@AC-4`
amended in `config-secrets-and-scoping.feature:42`).
