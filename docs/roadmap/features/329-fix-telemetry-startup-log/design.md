# Design: fix-telemetry-startup-log

**Created**: 2026-11-13
**Rounds**: 3 (full; termination: approved)
**Approved by**: operator @ 2026-11-13 (sdd-batch design gate; Floor clear)
**Grounded in**: recon.md
**Debate register**: debate.md

---

## Chosen Approach

The fix changes values only, at the 9 places the startup log reads its endpoint (D-1). The log text,
the argument-less exporters and the try/catch scope do not change. Exporters stay env-only, and the
computed value is never passed into an exporter (recon.md:78-79). No shared helper is added, because
each telemetry module is a per-service copy by design (recon.md:73-77; R-6).

**Consumer surface.** The change is internal-only. It touches each service's own stdout and
structured startup log record, plus one env-docs line in `services/xstockstrat-ui/CLAUDE.md`. No UI
segment or Agent tool behaviour changes.

**Line numbers.** recon.md's line numbers (recon.md:29-62) are stale. The spec must cite the
current-tree lines that round 3 re-grepped (D-15), listed below.

### Production edits (9 sites)

Node, 5 sites, using the recon.md:25 idiom. Each becomes
`const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'SDK default';`. The operator is
logical OR, which is D-2 as corrected by D-7.

| Service | Read site | Log line |
|---|---|---|
| ui | `services/xstockstrat-ui/src/telemetry.ts:80` | `:114` |
| config | `services/xstockstrat-config/src/telemetry.ts:211` | `:240` |
| identity | `services/xstockstrat-identity/src/telemetry.ts:212` | `:241` |
| ledger | `services/xstockstrat-ledger/src/telemetry.ts:212` | `:241` |
| notify | `services/xstockstrat-notify/src/telemetry.ts:213` | `:242` |

Python, 4 sites, using the recon.md:47 idiom. Each keeps
`endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT")` and adds
`if endpoint is None: endpoint = "SDK default"` on the next line. An empty string is logged as the
explicit `""` (D-2; R-1).

| Service | Read site | Log line |
|---|---|---|
| analysis | `services/xstockstrat-analysis/app/telemetry.py:246` | `:281` |
| indicators | `services/xstockstrat-indicators/app/telemetry.py:242` | `:275` |
| ingest | `services/xstockstrat-ingest/app/telemetry.py:243` | `:276` |
| agent | `services/xstockstrat-agent/app/telemetry.py:120` | `:153` |

The fallback is the literal `SDK default`, not a resolved URL. The URL is an SDK claim that cannot
be verified at the pinned versions (recon.md:130-133; R-3). Only the base variable is read (D-5).

### Tests (written first; each must fail on the current code)

No existing test asserts the startup log text (recon.md:148-151).

1. **Node leaves: the `runChild` env parameter (D-8, D-12).** The parameter is named `extraEnv`,
   typed `Record<string, string | undefined>`, defaults to `{}`, and is spread last.
   - Config (`src/__tests__/telemetry.export.test.ts:312-316`, spread `:331`) and ledger (`:237-241`,
     spread `:256`) already have the parameter. Only its type is widened. Their existing callers
     (config `:405`; ledger `:355` via `childFlushMetric` `:353`) stay valid.
   - Identity (`:204`, hard-coded endpoint `:215`) and notify (`:239`, `:250`) gain the parameter
     with the same name, default and position.
   - A key whose value is `undefined` must not reach the child. The spec picks one mechanism: an
     explicit delete after the spread, or relying on `child_process.spawn` ignoring
     undefined-valued env entries.
2. **Node leaves: the init-only child (D-3, D-9, D-14).** A new `INIT_ONLY_CHILD` script:
   - sends `console.warn` to stdout;
   - calls `require(process.env.TELEMETRY_JS).initTelemetry()`;
   - exits via `process.stdout.write('', () => process.exit(0))`.

   It is called as `runChild(INIT_ONLY_CHILD, '', undefined, { OTEL_EXPORTER_OTLP_ENDPOINT: undefined })`
   and asserts, in this order: `[otel] tracing enabled`, then `→ SDK default`, then that `undefined`
   is absent.

   A second case passes `''` and asserts `→ SDK default`, which pins `||` (D-10).
   `OTEL_METRIC_EXPORT_INTERVAL=600000` plus the no-flush exit keep the child clear of the 20 s
   SIGKILL guard.
3. **UI AC-1 (D-9, D-13).** A new file, `services/xstockstrat-ui/src/telemetry.startupLog.test.ts`,
   separate from `telemetry.hostProvider.test.ts`. It relies on vitest's default per-file isolation.
   - **Setup:** install a self-made `console.info` recorder before the first OTel or telemetry
     import (fails.md:2853-2856; recon.md:84-87), then load telemetry with a dynamic import.
   - **Act:** delete `OTEL_EXPORTER_OTLP_ENDPOINT` and call `initTelemetry()`.
   - **Assert:** the recorded line contains `[otel] tracing enabled → SDK default`.
   - **Teardown:** snapshot `process.listeners('SIGTERM')` before `initTelemetry()`. Afterwards,
     await the one new listener, which returns `sdk.shutdown()` (telemetry.ts:116), then remove it.
     Never call `process.emit('SIGTERM')` (R-12).
4. **UI AC-2 (D-4).** Tighten `services/xstockstrat-ui/src/instrumentation.testkit.ts:100` from the
   prefix check to the full `[otel] tracing enabled → http://127.0.0.1:${port}/otlp`. The endpoint is
   set at `:78`. All three `defineExportSuite` callers share this setup, and the recursion guard is
   untouched.
5. **Python.** Use `caplog` on `record.endpoint` of the `"OTel tracing initialised"` record. The
   endpoint is a structured `extra` field, so `caplog.text` won't work (recon.md:47-49, 88-91). Use
   the `otel_reset` fixtures: analysis `tests/conftest.py:506`, indicators `:196`, ingest `:103`,
   agent `:302`. Three cases:
   - unset ⇒ `"SDK default"`
   - set ⇒ the value
   - `""` ⇒ `""`

**Hermeticity (O-2, open, non-blocking).** The spec must pick one of these for the unset and `""`
cases:
- (a) point the per-signal `OTEL_EXPORTER_OTLP_{TRACES,METRICS,LOGS}_ENDPOINT` at the suite's local
  receiver while the base variable stays unset;
- (b) set a short `OTEL_EXPORTER_OTLP_TIMEOUT` in those cases only.

### Docs

Replace the bare line at `services/xstockstrat-ui/CLAUDE.md:325` (recon.md:32 cites the old `:302`)
with:

`OTEL_EXPORTER_OTLP_ENDPOINT  # required when OTEL_ENABLED=true; unset ⇒ SDK default. Base var only (per-signal *_ENDPOINT not reflected in the startup log). Credentials go in OTEL_EXPORTER_OTLP_HEADERS, never the URL.`

This covers D-5 and D-6.

### Delivery

One PR, in this order: the failing tests, then the 9 edits, then the docs line.

Verify with:
- `node --test` and the production `tsc` build in each Node leaf (recon.md:145-147);
- the UI vitest suite;
- `pytest` in each Python service.

## Rejected Alternatives

- `R-1` Python `or "SDK default"` fallback. Rejected because it would label an empty-string endpoint
  as SDK default if the exporter falls back only when the key is absent, and the repo can't verify
  which is true.
- `R-2` Node leaf AC-1 in the in-process export suite via `logged(warnSpy)`. Rejected because
  `warnSpy` watches `console.warn`, not `console.info`, and the endpoint is already set in-process
  before `initTelemetry`.
- `R-3` Log the resolved URL (`localhost:4318` or base + `/v1/traces`). Rejected because it is an
  SDK claim that is unproven at the pinned versions.
- `R-4` Read the endpoint back from the constructed exporter's private fields. Rejected because
  private SDK fields break on version bumps. It is kept only as the escalation path for per-signal
  vars.
- `R-5` Resolve `TRACES_ENDPOINT // ENDPOINT // 'SDK default'`. Rejected because it mixes a verbatim
  per-signal URL with a base URL in one log value.
- `R-6` A shared cross-service endpoint helper. Rejected as a speculative abstraction for a one-token
  per-service change (C-18, insights.md:4389).
- `R-7` Strip userinfo from the logged endpoint. Rejected as a speculative mechanism with no new
  exposure. The docs convention covers config `@AC-7`.
- `R-8` Node `?.trim() || 'SDK default'`. Rejected because it stacks a second unverifiable SDK claim
  (that whitespace means unset), and no deploy surface sets such a value.
- `R-9` A dedicated minimal spawn per leaf for the AC-1 unset case. Rejected because it duplicates
  spawn plumbing across 4 leaves (C-18). Extending `runChild` is smaller.
- `R-10` Reusing `runChild` unchanged, or only dropping its hard-coded endpoint. Rejected because
  the hard-coded value and the `process.env` spread make the unset case unreachable or host-dependent,
  so the failing test would prove nothing.
- `R-11` A new `runChild` parameter named `envOverride`, separate from the existing `extraEnv`.
  Rejected because config and ledger already have `extraEnv` as the 4th parameter with live callers,
  so a second name would make the four copies drift (C-18).
- `R-12` UI AC-1 teardown via `process.emit('SIGTERM')`. Rejected because it returns a boolean
  rather than the shutdown promise, so it cannot be awaited, and it fires every SIGTERM listener in
  the vitest worker.
- `R-13` Init-only child exiting via `setImmediate(() => process.exit(0))`. Rejected because pipe
  writes on macOS are not guaranteed synchronous, so stdout could be cut short on the primary dev
  platform without CI ever noticing.
- `R-14` UI AC-1 in a spawned child process. Rejected because the UI has no spawn harness, and
  porting one is more plumbing than the listener-snapshot teardown (C-18).

One more alternative was rejected in round 3 but has no R-n ID: no UI teardown at all, relying on
vitest per-file isolation. It contradicts settled D-9, so adopting it would need an operator REOPEN.

## Open Risks

- [ ] **Per-signal blind spot.** If only `OTEL_EXPORTER_OTLP_(TRACES|METRICS|LOGS)_ENDPOINT` is set,
  the log reads `SDK default` while the SDK exports elsewhere (D-5). Addressed by the UI CLAUDE.md:325
  docs line in the docs step. R-4 is the escalation path.
- [ ] **O-1, accepted.** Node logs a whitespace-only endpoint raw, while the SDK may treat it as
  unset (D-11). No code change. Recorded here and in context.md.
- [ ] **Empty-string divergence.** Node logs `SDK default`, Python logs `""`. The SDK's own
  empty-string resolution is unverified at the pinned versions. Pinned by the D-10 and Python `""`
  test cases.
- [ ] **Node SDK may throw on `""`.** If the pinned Node SDK throws while building an exporter from
  `OTEL_EXPORTER_OTLP_ENDPOINT=""`, the D-10 case fails. Sending `console.warn` to stdout makes the
  cause visible. Re-decide at the Node-leaf test step if it happens.
- [ ] **UI shutdown may hang.** The UI AC-1 file really starts the NodeSDK, so an awaited shutdown
  against a dead endpoint can trip the vitest timeout. Bounded by the O-2 mitigation the spec chooses
  at the UI AC-1 test step.
- [ ] **tsc-first builds.** The leaf tests depend on the tsc-first build for ledger and identity
  (fails.md:2237-2240). Verify both `node --test` and `tsc` per leaf at the verification step.
- [ ] **jscpd noise.** Near-duplicate test additions across 9 services may trigger jscpd. Keep each
  test to the minimum assertion and check at the pre-commit DRY rail.

## Constitution Rules Touched

- `C-01`: honored by grounding every claim in recon.md and the round-3 re-grep (D-15). No invented
  paths.
- `C-11`: honored by settling the design forks in the register before the spec: literal vs URL
  (D-1/R-3), per-signal (D-5), userinfo (D-6), and Python empty string (D-2).
- `C-15`: honored because AC-1 and AC-2 in acceptance.feature stay the single source of acceptance
  truth, and each gets a failing-first test.
- `C-16`: honored by the operator sign-off for this feature's AC-1 CHANGE (2026-11-13, sdd-batch
  design gate). All other touched `@AC`s are PRESERVE.
- `C-18`: honored by adding no shared helper (R-6), reusing `runChild`'s existing `extraEnv` name
  (R-11), and adding no extra spawn plumbing (R-9, R-14).
- `P-02`: honored because the proposer and adversary exchanged only mediated, synthesized state
  across the 3 rounds.
- `P-03`: honored because unverifiable SDK behaviour is recorded as Open Risks, not assumed (R-1,
  R-3, R-8).
- `P-06`: honored by delivering in the order failing tests, then fix, then docs, in one PR.
- Floor (`F-*`): no breaches.

## Business Rules Touched (C-16)

- CHANGE `@AC-1` "the startup log names the effective export endpoint when the env var is unset"
  (`docs/roadmap/features/329-fix-telemetry-startup-log/acceptance.feature`). The guarantee is now
  the literal `SDK default` rather than a resolved URL. It covers the unset base variable only:
  per-signal vars are outside it, and Python logs an explicit `""` for an empty string. Signed off
  by the operator @ 2026-11-13 (sdd-batch design gate; context.md session 2026-11-13 — sdd-design).
- PRESERVE `@AC-2` "the startup log names the configured endpoint when the env var is set" (this
  feature). Not regressed: the set value is logged verbatim, and the UI test tightens to the full
  suffix (D-4).
- PRESERVE `@AC-2` "The UI registers its instrumentation hook and exports over OTLP/HTTP"
  (`services/xstockstrat-ui/acceptance/fix-otel-trace-export.feature`, feature 226). Not regressed:
  the `[otel] tracing enabled` prefix is kept, only the text after `→` changes, and exporters stay
  env-only.
- PRESERVE `@AC-42` "Telemetry is a no-op when disabled and never blocks startup"
  (`docs/sdd/business-rules/platform.feature`, feature 294). Not regressed: the new expression cannot
  throw, the disabled path is untouched, and the try/catch scope is unchanged.
- PRESERVE `@AC-2` "Telemetry init remains non-blocking…" (`docs/sdd/business-rules/platform.feature`,
  feature 171). Not regressed: this is a value-only edit inside the existing init.
- PRESERVE `@AC-7` "Exported log records carry no secret plaintext"
  (`services/xstockstrat-config/acceptance/otel-metrics-logs-export.feature`, feature 274). Not
  regressed: the raw endpoint is logged as before (D-6), and the docs line says credentials go in
  `OTEL_EXPORTER_OTLP_HEADERS`, never in the URL.

## Rounds

| Round | Date | +D | +R | O closed | +O | Petitions |
|---|---|---|---|---|---|---|
| 1 | 2026-11-11 | 6 | 7 | 0 | 1 | 0 |
| 2 | 2026-11-11 | 5 | 3 | 1 | 0 | 0 |
| 3 | 2026-11-13 | 4 | 4 | 0 | 1 | 0 |

**Termination:** approved by the operator at the sdd-batch design gate after round 3 (full mode,
within the 2–5 bound). The Floor is clear and no reopen petitions were filed. One objection is still
open: O-2 (hermeticity), which is non-blocking and left for the spec to choose a mitigation.
