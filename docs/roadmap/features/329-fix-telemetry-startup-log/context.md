# Context Log: fix-telemetry-startup-log

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-10 (/sdd-triage)

- Bug reported via defect report (Issues disabled; clustered triage):
  - docs/reports/2026-10-19-telemetry-startup-log-raw-endpoint-defect.md — Telemetry startup log prints the raw OTLP endpoint env var (SEV-3)
- Cluster rationale: single-report feature — one stale log pattern repeated across the Node and Python telemetry modules.
- Severity: SEV-3
- Routed to SDD path (Track C)
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..AC-2), context.md; stamped the report sidecar `triaged`
- Affected services (from report): config, identity, ledger, notify, ui, analysis, indicators, ingest, agent
- Root cause hypothesis: log line kept the pre-226 `endpoint` variable after the exporter stopped taking it
- Recommended design depth: full → `/sdd-design fix-telemetry-startup-log` (rationale: SEV-3 and mechanical, but 9 affected services — rubric escalate signal ≥2 services)
- Development branch: feature/fix-telemetry-startup-log

## Session 2026-11-10 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings: bug-template conventions (no FR-N/@FR tags; no Consumer Surface section); AC-1 examples cover 4 of 9 services; docs fix has no scenario; 'SDK default' Then hedged
- Overlap findings: none (logging only)
- Recommended design depth: full (9 services)
- Tree: ccr-500a9eb9-nvk45x (origin/main-dev 0fecb24d + triage/docs commits; no feature branch yet)

## Session 2026-11-11 — sdd-batch design gate (round 2)

- /sdd-design fix-telemetry-startup-log (full) is at its approval gate after round 2 (gate policy: halt). design.md is not written and status.md is unchanged (spec-ready). The register is in debate.md.

### Open Threads

- **Approach (settled D-1..D-11):** the fix changes values only, at 9 read sites. The log text, the argument-less exporters and the try/catch scope stay as they are.
  - Node (ui, config, identity, ledger, notify `src/telemetry.ts`): `process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'SDK default'`. This is logical OR with two pipes; the `//` in the D-2 register row is markdown-mangled pipes (D-7).
  - Python (analysis, indicators, ingest, agent `app/telemetry.py`): `os.getenv(...)`, where `is None` gives `"SDK default"` and `""` is logged as `""`.
  - Tests are written RED first:
    - Node leaves: `runChild` gains an env-override parameter in which `undefined` deletes the key. An init-only child resolves on the `[otel] tracing enabled` line without flushing. It asserts `→ SDK default` is present and `undefined` is absent. A pinned case asserts that `""` also gives `→ SDK default`.
    - UI AC-1: a vitest file with a self-installed `console.info` recorder that calls `sdk.shutdown()` or stubs the exporters.
    - UI AC-2: asserts the full `→ <set URL>` suffix inside `defineExportSuite`.
    - Python: caplog on `record.endpoint` for three cases: unset, set and `""`.
  - Docs: one line at services/xstockstrat-ui/CLAUDE.md:302 (D-5, D-6).
  - Delivery: one PR, in the order RED tests → 9 edits → docs line.
- **Strongest open objection:** none. O-1 (Node logs a whitespace-only endpoint raw) was closed in round 2 as an accepted Open Risk. No `.trim()` is added, because it rests on an unverifiable SDK claim and no deploy surface sets such a value.
- **Floor status:** no breaches.
- **Uncovered @AC changes:** AC-1 is a CHANGE that no operator decision covers, so it needs operator sign-off at the gate. Preserved unchanged: AC-2, 226:UI@AC-2, 294:@AC-42, 171:@AC-2, config:@AC-7.
- **Open Risks:**
  - Per-signal blind spot: if only `OTEL_EXPORTER_OTLP_(TRACES|METRICS|LOGS)_ENDPOINT` is set, the log reads `SDK default`.
  - O-1: a whitespace-only Node value is logged raw.
  - Node and Python treat an empty string differently (Node logs `SDK default`, Python logs `""`). The Node side rests on the unverified getStringFromEnv claim.
  - The Python SDK's empty-string resolution is unverified at the pinned version.
  - The leaf tests depend on the runChild change and on the tsc-first build for ledger and identity.
  - The UI vitest may hang or leak through its SIGTERM handler without shutdown.
  - The near-duplicate test additions across 9 services may trigger jscpd noise.

```sdd-batch-design-state
{
  "round": 2,
  "synth": {
    "approach": "The settled D-1..D-6 design stands. The production code edits are values only, at 9 sites. The log text, the argument-less exporters and the try/catch scope do not change.\n\n**Node, 5 sites.** Each site becomes `const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'SDK default';`. The operator is logical OR, two pipes. The D-2 row shows `//` only because the pipes were mangled by markdown table escaping.\n- services/xstockstrat-ui/src/telemetry.ts:36\n- services/xstockstrat-config/src/telemetry.ts:163\n- services/xstockstrat-identity/src/telemetry.ts:164\n- services/xstockstrat-ledger/src/telemetry.ts:164\n- services/xstockstrat-notify/src/telemetry.ts:165\n\n**Python, 4 sites.** Each site becomes `endpoint = os.getenv(\"OTEL_EXPORTER_OTLP_ENDPOINT\")`, then `if endpoint is None: endpoint = \"SDK default\"`.\n- services/xstockstrat-analysis/app/telemetry.py:180\n- services/xstockstrat-indicators/app/telemetry.py:176\n- services/xstockstrat-ingest/app/telemetry.py:177\n- services/xstockstrat-agent/app/telemetry.py:54\n\n**Tests, RED first, each shown failing on the current code.**\n\n1. **Node leaves, AC-1 (config, identity, ledger, notify).**\n   - The existing `runChild` in each leaf hard-codes `OTEL_EXPORTER_OTLP_ENDPOINT` and spreads `...process.env` before it:\n     - identity src/__tests__/telemetry.export.test.ts:176-182\n     - config :248-259\n     - ledger :204-215\n     - notify :206-217\n   - Add an optional env-override parameter to `runChild`. It is merged after the defaults, and any key whose value is `undefined` is deleted from the child env. This removes both the hard-coded value and any value inherited from the runner's own `process.env`.\n   - The AC-1 child only calls `initTelemetry()`, with `OTEL_METRIC_EXPORT_INTERVAL=600000` as `:184` already sets.\n   - It resolves once stdout contains the `[otel] tracing enabled` line, then exits without flushing. It must never post to the dead `localhost:4318`, so it stays well clear of the 20 s SIGKILL guard.\n   - Assert that stdout contains `→ SDK default` and does not contain `undefined`.\n   - Add one more leaf case with `OTEL_EXPORTER_OTLP_ENDPOINT=\"\"` that asserts `→ SDK default`. This pins the `||` choice so a later refactor to `??` fails loudly.\n\n2. **UI, AC-1.**\n   - A new vitest file with a self-installed `console.info` recorder (fails.md:2853-2856) and the endpoint deleted from `process.env`.\n   - After the assertion it calls `sdk.shutdown()`, or it stubs the exporters, so that no real export is attempted and the SIGTERM handler at telemetry.ts:66 does not leak.\n\n3. **UI, AC-2.** Inside `defineExportSuite` (instrumentation.testkit.ts:65,87), assert the full `[otel] tracing enabled → <set URL>` suffix (D-4).\n\n4. **Python.** Use caplog on `record.endpoint` with the existing `otel_reset` fixtures (analysis conftest.py:506, indicators :196, ingest :103, agent :302). Three cases:\n   - unset ⇒ `\"SDK default\"`\n   - set ⇒ the value\n   - `\"\"` ⇒ `\"\"`\n\n**Docs.** Add one line at services/xstockstrat-ui/CLAUDE.md:302, per D-5 and D-6.\n\n**Open Risks recorded in context.md:**\n- the per-signal blind spot\n- O-1: a whitespace-only Node value is logged raw\n- the Node/Python empty-string divergence (Node logs `SDK default`, Python logs `\"\"`)\n\n**Delivery.** One PR, in this order: RED tests, the 9 edits, the docs line.\n\n**Verification:**\n- `node --test` for each leaf, plus the production `tsc` build (ledger and identity build with tsc first)\n- UI vitest\n- pytest in each Python service",
    "open_objections": [],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "AC-1",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-2",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "226:UI@AC-2",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "294:@AC-42",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "171:@AC-2",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "config:@AC-7",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Node `?.trim() || 'SDK default'` to close O-1 in code: lost because it adds a second SDK claim (that a whitespace-only value is treated as unset) which cannot be checked here, since no node_modules is present (fails.md:3568-3571). No deploy surface sets a blank or whitespace value.",
      "Node `?? 'SDK default'` (absent-only, to match Python): lost because it contradicts settled D-2 (`||`). It is viable only if the operator reopens D-2.",
      "A dedicated minimal spawn per leaf for AC-1 instead of extending runChild: lost because it duplicates about 15 lines of spawn plumbing in 4 leaves (C-18/DRY). An env-override parameter is smaller.",
      "Calling the existing runChild unchanged, or only dropping its hard-coded endpoint: lost because the hard-coded value plus the `...process.env` spread make the 'unset' case impossible to reach or dependent on the host, so the RED test would pass vacuously on the buggy code."
    ],
    "open_risks": [
      "Per-signal blind spot: if only OTEL_EXPORTER_OTLP_(TRACES|METRICS|LOGS)_ENDPOINT is set, the log reads `SDK default` while the SDK exports elsewhere. Documented in UI CLAUDE.md:302 and context.md.",
      "O-1, accepted: Node logs a whitespace-only endpoint raw, while the SDK may treat it as unset. It never renders `undefined`, and no deploy surface sets such a value.",
      "Node and Python treat an empty string differently (Node logs `SDK default`, Python logs `\"\"`). Node's blank-as-unset behaviour still rests on the unverified getStringFromEnv claim. Pinned by tests and recorded in context.md.",
      "The Python SDK's empty-string resolution is unverified at the pinned version. A logged `\"\"` does not say where the exporter actually sends.",
      "Leaf child-process tests depend on the runChild env-override change and on the tsc-first build for ledger/identity (fails.md:2237-2240). Verify both `node --test` and `tsc` per leaf.",
      "UI vitest AC-1 really calls sdk.start() and registers a SIGTERM handler. Without shutdown or stubbed exporters it may hang or leak between tests.",
      "Near-duplicate test additions across 9 services risk jscpd noise. Keep each to the minimum assertion."
    ],
    "constitution_rules_touched": [
      "C-11",
      "C-15",
      "C-16",
      "C-18",
      "P-02",
      "P-03"
    ],
    "rationale": "The proposer's handling of O-1 is accepted by both sides. Adding `.trim()` would rest on a second SDK claim that cannot be verified here, and no deploy surface sets a blank or whitespace value (docker-compose.yml:62,133; .do/app*.yaml:34). O-1 is closed as an Open Risk.\n\nThe adversary's harness objection is confirmed by reading the code. Each leaf's runChild hard-codes OTEL_EXPORTER_OTLP_ENDPOINT after spreading process.env:\n- identity :182\n- config :259\n- ledger :215\n- notify :217\n\nSo D-3's \"reuse the harness\" needs an env-override parameter that deletes the key. Without it, the RED test is vacuous.\n\nThe dead-port flake concern is answered by an init-only child that exits on the log line without flushing, and by UI shutdown or stubbing.\n\nThe Node empty-string case gets a pinned test, so the `||` choice cannot silently drift to `??`.\n\nD-2's `//` is clarified as `||`, the token both the prior synthesis and the proposer use. This is a text clarification, not a reopen.\n\nNo settled D-n is contradicted, no R-n is reintroduced and no petitions were filed. All findings were non-blocking, so nothing blocking remains.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "D-2's Node operator is logical OR (two pipes): `process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'SDK default'`. The register row's `//` is the pipes mangled by markdown escaping.",
          "evidence": "PRIOR STATE approach text; proposer r2 Assumptions; adversary r2 register-hygiene objection"
        },
        {
          "text": "Each Node leaf's runChild gains an optional env-override parameter, merged after the defaults, in which `undefined` deletes the key. The AC-1 child uses it to remove OTEL_EXPORTER_OTLP_ENDPOINT from both the hard-coded value and the inherited process.env.",
          "evidence": "services/xstockstrat-identity/src/__tests__/telemetry.export.test.ts:176-182; config :248-259; ledger :204-215; notify :206-217"
        },
        {
          "text": "The AC-1 unset-endpoint child only calls initTelemetry(), resolves on the `[otel] tracing enabled` stdout line and exits without flushing. The UI vitest AC-1 file self-installs a console.info recorder and calls sdk.shutdown() or stubs the exporters.",
          "evidence": "identity telemetry.export.test.ts:184,193-196,208; services/xstockstrat-ui/src/telemetry.ts:63,66; fails.md:2853-2856"
        },
        {
          "text": "A Node test case with OTEL_EXPORTER_OTLP_ENDPOINT=\"\" asserts `→ SDK default`, pinning `||`. The Node/Python empty-string divergence is recorded as an Open Risk in context.md.",
          "evidence": "Adversary r2 C-15 objection; proposer r2 strongest risk"
        },
        {
          "text": "O-1 is accepted as an Open Risk in context.md with no code change: a whitespace-only Node endpoint is logged raw.",
          "evidence": "fails.md:3568-3571; docker-compose.yml:62,133; .do/app.yaml:34; no node_modules present to check against"
        }
      ],
      "new_rejected": [
        {
          "text": "Node `?.trim() || 'SDK default'`",
          "why": "It stacks a second SDK claim (that whitespace means unset) which cannot be verified here, and no deploy surface sets such a value."
        },
        {
          "text": "A dedicated minimal spawn per leaf for the AC-1 unset case",
          "why": "It duplicates spawn plumbing across 4 leaves (C-18). Extending runChild with an env-override parameter is smaller."
        },
        {
          "text": "Reusing runChild unchanged, or only dropping its hard-coded endpoint, for the unset case",
          "why": "The hard-coded value and the process.env spread make the unset case unreachable or host-dependent, so the RED test would be vacuous."
        }
      ],
      "new_objections": [],
      "closed_objections": [
        {
          "id": "O-1",
          "how": "Accepted as a recorded Open Risk in context.md. No `.trim()` is added because it would be an unverifiable SDK claim, no deploy surface sets a blank or whitespace value, and the output never renders `undefined`. Both sides agree."
        }
      ],
      "reopen_petitions": [],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```

## Session 2026-11-13 — sdd-batch design gate (round 3)

- /sdd-design fix-telemetry-startup-log (full) is at its approval gate after round 3 (gate policy: halt). design.md is not written and status.md is unchanged (spec-ready). The register is in debate.md (round 3 added D-12..D-15, R-11..R-14 and O-2).

### Open Threads

- **Approach (settled D-1..D-15):** the fix still changes values only, at 9 read sites. The log text, the argument-less exporters and the try/catch scope stay as they are. Round 3 re-pointed every citation at the current tree (D-15) and corrected two test-harness claims.
  - Node (`|| 'SDK default'`): ui `src/telemetry.ts:80`, config `:211`, identity `:212`, ledger `:212`, notify `:213`.
  - Python (`os.getenv(...)`, then `if endpoint is None: endpoint = "SDK default"`): analysis `app/telemetry.py:246`, indicators `:242`, ingest `:243`, agent `:120`.
  - Node leaf tests (D-12, D-14): the `runChild` env parameter is named `extraEnv`. Config (`:316`) and ledger (`:241`) already have it, so its type is widened to `Record<string, string | undefined>`. Identity (`:204`) and notify (`:239`) gain it with the same name and position. A new `INIT_ONLY_CHILD` sends `console.warn` to stdout, calls `initTelemetry()` and exits with `process.stdout.write('', () => process.exit(0))`. The test asserts `[otel] tracing enabled`, then `→ SDK default`, then that `undefined` is absent. A second case with `""` pins `||`.
  - UI AC-1 (D-13): a new file, `src/telemetry.startupLog.test.ts`. It installs the `console.info` recorder before the import. Teardown snapshots the SIGTERM listeners, awaits the one new listener (which returns `sdk.shutdown()`), then removes it. `process.emit('SIGTERM')` is never used.
  - UI AC-2: tighten `instrumentation.testkit.ts:100` to the full `→ http://127.0.0.1:${port}/otlp` suffix.
  - Python: caplog on `record.endpoint` for three cases: unset, set and `""`.
  - Docs: one line at `services/xstockstrat-ui/CLAUDE.md:325` (D-5, D-6).
  - Delivery: one PR, in the order failing tests → 9 edits → docs line.
- **Strongest open objection (O-2, non-blocking):** test hermeticity. In the unset and `""` cases, the Python and UI tests flush to the real `localhost:4318` at teardown (analysis `conftest.py:535-541`; the awaited UI `sdk.shutdown()`). The impl-spec must choose one of:
  - (a) per-signal endpoints pointed at the suite's local receiver, with the base variable left unset
  - (b) a short `OTEL_EXPORTER_OTLP_TIMEOUT` in those cases only
- **Floor status:** no breaches.
- **Uncovered @AC changes:** AC-1 is a CHANGE that no operator decision covers, so it needs operator sign-off at the gate. Preserved unchanged: AC-2, 226:UI@AC-2, 294:@AC-42, 171:@AC-2, config:@AC-7.
- **Open Risks:**
  - Per-signal blind spot: if only `OTEL_EXPORTER_OTLP_(TRACES|METRICS|LOGS)_ENDPOINT` is set, the log reads `SDK default`.
  - O-1: Node logs a whitespace-only value raw.
  - Node and Python treat an empty string differently (Node logs `SDK default`, Python logs `""`).
  - The pinned Node SDK might throw on an exporter built with `""`, which would break the D-10 case.
  - The UI AC-1 shutdown might hang against a dead endpoint; the O-2 mitigation bounds this.
  - The leaf tests depend on the tsc-first build for ledger and identity.
  - The near-duplicate test additions across 9 services may trigger jscpd noise.

```sdd-batch-design-state
{
  "round": 3,
  "synth": {
    "approach": "The design settled in D-1 to D-11 stands. Round 3 changes two things: every citation now points at the current tree, and the two test-harness claims the adversary showed were wrong are corrected. The spec must cite the line numbers below, not recon's.\n\n**Production: 9 value-only edits.** The log text, the argument-less exporters and the try/catch scope do not change.\n\nNode, 5 sites. Each becomes `const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'SDK default';` (D-2/D-7):\n- services/xstockstrat-ui/src/telemetry.ts:80 (log at :114)\n- services/xstockstrat-config/src/telemetry.ts:211 (:240)\n- services/xstockstrat-identity/src/telemetry.ts:212 (:241)\n- services/xstockstrat-ledger/src/telemetry.ts:212 (:241)\n- services/xstockstrat-notify/src/telemetry.ts:213 (:242)\n\nPython, 4 sites. Each keeps `endpoint = os.getenv(\"OTEL_EXPORTER_OTLP_ENDPOINT\")` and adds the next line `if endpoint is None: endpoint = \"SDK default\"`:\n- services/xstockstrat-analysis/app/telemetry.py:246 (log at :281)\n- services/xstockstrat-indicators/app/telemetry.py:242 (:275)\n- services/xstockstrat-ingest/app/telemetry.py:243 (:276)\n- services/xstockstrat-agent/app/telemetry.py:120 (:153)\n\n**Tests are written first and must fail on the current code.**\n\n1. **Node leaves: the `runChild` env parameter.** This implements D-8. Two leaves already have the parameter:\n   - config :312-316 and ledger :237-241 declare `extraEnv: Record<string, string> = {}`, spread last (config :331, ledger :256).\n   - Existing callers: ledger :355 via `childFlushMetric` at :353, and config :405.\n   - Change: widen the type to `Record<string, string | undefined>`.\n\n   Two leaves do not, and get the same parameter with the same name, default and last-spread position:\n   - identity :204 (hard-coded endpoint at :215)\n   - notify :239 (hard-coded endpoint at :250)\n\n   A key whose value is `undefined` must not reach the child. Either delete such keys after the spread, or rely on `child_process.spawn` ignoring undefined-valued env entries (a documented Node behaviour). Both satisfy D-8, and the spec picks one.\n\n2. **Node leaves: the init-only child.** A new `INIT_ONLY_CHILD` script:\n   - Points `console.warn` at stdout, so an `[otel] init failed` line is visible.\n   - Calls `require(process.env.TELEMETRY_JS).initTelemetry()`.\n   - Exits with `process.stdout.write('', () => process.exit(0))`, not `setImmediate`, because pipe writes on macOS are not guaranteed synchronous.\n\n   It is invoked as `runChild(INIT_ONLY_CHILD, '', undefined, { OTEL_EXPORTER_OTLP_ENDPOINT: undefined })`. Assertions, in order:\n   - stdout includes `[otel] tracing enabled`\n   - stdout includes `→ SDK default`\n   - stdout does not include `undefined`\n\n   A second case passes `{ OTEL_EXPORTER_OTLP_ENDPOINT: '' }` and asserts `→ SDK default`, which pins `||` (D-10). `OTEL_METRIC_EXPORT_INTERVAL=600000` (identity :217) and the no-flush exit mean nothing is exported and the 20 s SIGKILL guard is never reached (D-9).\n\n3. **UI AC-1: a new file, `services/xstockstrat-ui/src/telemetry.startupLog.test.ts`.** It is kept separate from the existing `telemetry.hostProvider.test.ts` and relies on the default per-file vitest isolation (vitest.config.ts sets no pool or isolate override). It must:\n   - Install a `console.info` recorder before the first OTel or telemetry import, then load telemetry with a dynamic import (instrumentation.testkit.ts:48-49; fails.md:2853-2856).\n   - Delete `OTEL_EXPORTER_OTLP_ENDPOINT` and call `initTelemetry()`.\n   - Assert the recorded line contains `[otel] tracing enabled → SDK default`.\n\n   Teardown, within D-9:\n   - Snapshot `process.listeners('SIGTERM')` before `initTelemetry()`.\n   - Take the one new listener afterwards. It is the arrow `() => sdk.shutdown().catch(...)` registered at telemetry.ts:116, so it returns the shutdown promise.\n   - `await` it, then `process.removeListener('SIGTERM', fn)`.\n   - Never use `process.emit('SIGTERM')`.\n\n4. **UI AC-2.** Tighten `services/xstockstrat-ui/src/instrumentation.testkit.ts:100` from the prefix check to the full `[otel] tracing enabled → http://127.0.0.1:${port}/otlp`. The endpoint is set at :78. All three `defineExportSuite` callers share that setup, and the recursion guard is untouched (D-4).\n\n5. **Python.** Use `caplog` on `record.endpoint` of the `\"OTel tracing initialised\"` record, with the `otel_reset` fixtures: analysis tests/conftest.py:506, indicators :196, ingest :103, agent :302. Three cases:\n   - unset ⇒ `\"SDK default\"`\n   - set ⇒ the value\n   - `\"\"` ⇒ `\"\"`\n\n**Hermeticity of the unset and empty-string cases.** This is open and non-blocking; the impl-spec must pick one:\n- (a) Point `OTEL_EXPORTER_OTLP_{TRACES,METRICS,LOGS}_ENDPOINT` at the suite's local receiver while the base variable stays unset. The log reads only the base variable (D-5), so the assertion still holds.\n- (b) Set a short `OTEL_EXPORTER_OTLP_TIMEOUT` in those cases only.\n\n**Docs.** In services/xstockstrat-ui/CLAUDE.md:325, the line becomes: `OTEL_EXPORTER_OTLP_ENDPOINT  # required when OTEL_ENABLED=true; unset ⇒ SDK default. Base var only (per-signal *_ENDPOINT not reflected in the startup log). Credentials go in OTEL_EXPORTER_OTLP_HEADERS, never the URL.` This covers D-5 and D-6.\n\n**Open Risks to record in context.md:**\n- the per-signal blind spot\n- O-1: a whitespace-only Node value is logged raw\n- the Node and Python empty-string divergence\n\n**Delivery.** One PR, in this order: the failing tests, the 9 edits, the docs line. Verify with, per leaf, `node --test` plus the `tsc` build; the UI vitest suite; and pytest in each Python service.",
    "open_objections": [
      {
        "text": "Test hermeticity. In the Python unset case, the `otel_reset` teardown at analysis conftest.py:535-541 shuts down the logger provider, which flushes the startup record to the real localhost:4318. In the UI unset case, the awaited sdk.shutdown() flushes metrics the same way, and the empty-string cases build `\"\" + /v1/traces`. Results then depend on whether a local collector is running and on the SDK's unverified retry policy (fails.md:3568-3571). The impl-spec must pick a mitigation: (a) per-signal endpoints pointed at the suite's local receiver while the base var stays unset, or (b) a short OTEL_EXPORTER_OTLP_TIMEOUT in those cases only.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "AC-1",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-2",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "226:UI@AC-2",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "294:@AC-42",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "171:@AC-2",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "config:@AC-7",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Adding a new 4th `runChild` parameter named `envOverride` in all four leaves: lost because config :316 and ledger :241 already declare `extraEnv` as the 4th parameter, with existing callers at ledger :355 and config :405. A second name would make the four copies drift (C-18).",
      "UI AC-1 teardown via `process.emit('SIGTERM')`: lost because emit returns a boolean rather than the shutdown promise, so the shutdown cannot be awaited, and it also fires every SIGTERM listener vitest or tinypool installed in the worker.",
      "Init-only child exiting via `setImmediate(() => process.exit(0))`: lost because pipe writes on macOS are not guaranteed synchronous, which risks truncated stdout on the primary dev platform that Linux CI would never catch.",
      "UI AC-1 in a spawned child process like the leaves: lost because the UI has no spawn harness and porting one is more plumbing than the listener-snapshot teardown (C-18).",
      "No UI teardown at all, relying on vitest per-file isolation as the existing instrumentation suites do: lost because it contradicts settled D-9 (`calls sdk.shutdown() or stubs the exporters`) and would need an operator REOPEN."
    ],
    "open_risks": [
      "Per-signal blind spot: if only OTEL_EXPORTER_OTLP_(TRACES|METRICS|LOGS)_ENDPOINT is set, the log reads `SDK default` while the SDK exports elsewhere. Documented in UI CLAUDE.md:325 and context.md.",
      "O-1, accepted: Node logs a whitespace-only endpoint raw, while the SDK may treat it as unset.",
      "Node and Python treat an empty string differently (Node logs `SDK default`, Python logs `\"\"`). The SDK's empty-string resolution is unverified at the pinned versions.",
      "If the pinned Node SDK throws while constructing an exporter with OTEL_EXPORTER_OTLP_ENDPOINT=\"\", the D-10 case fails. Redirecting `console.warn` to stdout makes the cause visible, but the case itself would need re-deciding.",
      "The UI AC-1 file really starts the NodeSDK. If the awaited shutdown hangs against a dead endpoint, the vitest timeout trips. The hermeticity mitigation still to be chosen bounds this.",
      "Leaf tests depend on the tsc-first build for ledger and identity (fails.md:2237-2240). Verify both `node --test` and `tsc` for each leaf.",
      "Near-duplicate test additions across 9 services risk jscpd noise. Keep each to the minimum assertion."
    ],
    "constitution_rules_touched": [
      "C-01",
      "C-11",
      "C-15",
      "C-16",
      "C-18",
      "P-02",
      "P-03",
      "P-06"
    ],
    "rationale": "I checked both of the adversary's blocking claims against the current tree, and both hold.\n\n**runChild signature.** config `telemetry.export.test.ts:316` and ledger `:241` already declare `extraEnv: Record<string, string> = {}`, spread last at config `:331` and ledger `:256`. Identity (`:204`) and notify (`:239`) do not have it. So the proposal's \"add a 4th parameter envOverride\" would be wrong for two leaves and would leave the copies with different names. The correction is to widen the type in config and ledger, and add the same name and position in identity and notify. That is D-8 as written, which never fixed a parameter name, so no reopen is needed.\n\n**UI teardown.** `services/xstockstrat-ui/src/telemetry.ts:116` registers `process.on('SIGTERM', () => sdk.shutdown().catch(console.error))`. `process.emit` cannot await that, and it fires every listener in the worker. Snapshotting the listeners, awaiting the new one and then removing it does satisfy D-9's \"calls sdk.shutdown()\" and needs no new export.\n\n**Line numbers.** The proposal's refreshed numbers are verified: the Node reads at ui `:80`, config `:211`, identity and ledger `:212`, notify `:213`; the Python reads at analysis `:246`, indicators `:242`, ingest `:243`, agent `:120`; the `otel_reset` fixtures; and UI CLAUDE.md `:325`. The stale recon and D-row citations are superseded for the spec. The settled decisions themselves are unchanged.\n\n**Non-blocking hardening adopted as cheap:**\n- the stdout write callback as the exit path\n- a visible `console.warn` plus a prefix assertion first\n- a separately named UI test file, with the recorder installed before the import\n\n**Left open (non-blocking):** hermeticity. Option (a) runs deliberately inside the D-5 blind spot, and (b) still connects to localhost:4318; neither is clearly dominant, so the spec author picks.\n\n**Register check:**\n- No settled D-n is contradicted, no locked R-n is reintroduced, and no closed O-n is re-raised.\n- Neither side filed a petition.\n- Both blocking objections are resolved in this approach. Only the non-blocking hermeticity objection remains.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "D-8's runChild env parameter is named `extraEnv`, typed `Record<string, string | undefined>`, defaulting to {} and spread last. In config (:316) and ledger (:241) the existing parameter's type is widened. Identity (:204) and notify (:239) gain the same name in the same position. A key whose value is undefined does not reach the child, removed either by an explicit delete or by spawn ignoring undefined env values.",
          "evidence": "services/xstockstrat-config/src/__tests__/telemetry.export.test.ts:312-331,405; services/xstockstrat-ledger/src/__tests__/telemetry.export.test.ts:237-256,353-355; identity :204-223; notify :239-258"
        },
        {
          "text": "UI AC-1 lives in its own file, services/xstockstrat-ui/src/telemetry.startupLog.test.ts. It installs the console.info recorder before the first OTel or telemetry import. Teardown snapshots process.listeners('SIGTERM') before initTelemetry(), awaits the single new listener (it returns sdk.shutdown()), then removes it. process.emit('SIGTERM') is never used.",
          "evidence": "services/xstockstrat-ui/src/telemetry.ts:116; instrumentation.testkit.ts:48-49,90-94; vitest.config.ts (no pool or isolate override); telemetry.hostProvider.test.ts exists"
        },
        {
          "text": "The leaf INIT_ONLY_CHILD redirects console.warn to stdout, calls initTelemetry(), and exits via process.stdout.write('', () => process.exit(0)). The test asserts `[otel] tracing enabled` before `→ SDK default` and the absence of `undefined`.",
          "evidence": "runChild stdio ['ignore','pipe','inherit'] at identity :223, config :333, ledger :258; root CLAUDE.md (macOS is the primary dev platform); fails.md:3568-3571"
        },
        {
          "text": "The impl-spec cites the current lines. Node reads: ui :80, config :211, identity :212, ledger :212, notify :213. Python reads: analysis :246, indicators :242, ingest :243, agent :120. UI AC-2 tightens instrumentation.testkit.ts:100. The docs line is UI CLAUDE.md:325.",
          "evidence": "Re-grepped in round 3 against the current tree"
        }
      ],
      "new_rejected": [
        {
          "text": "A new runChild parameter named `envOverride`, distinct from the existing `extraEnv`",
          "why": "config and ledger already have `extraEnv` as the 4th parameter, with live callers. A second name makes the four copies drift (C-18)."
        },
        {
          "text": "UI AC-1 teardown via process.emit('SIGTERM')",
          "why": "It returns a boolean, not the shutdown promise, so it cannot be awaited, and it fires every SIGTERM listener in the vitest worker."
        },
        {
          "text": "Init-only child exiting via setImmediate(() => process.exit(0))",
          "why": "Pipe writes on macOS are not guaranteed synchronous, so stdout could be truncated on the primary dev platform without CI ever catching it."
        },
        {
          "text": "UI AC-1 in a spawned child process",
          "why": "The UI has no spawn harness, and porting one is more plumbing than the listener-snapshot teardown (C-18)."
        }
      ],
      "new_objections": [
        {
          "text": "Test hermeticity: the unset and empty-string Python and UI cases flush to the real localhost:4318 at teardown (analysis conftest.py:535-541; the awaited UI sdk.shutdown()). The impl-spec must choose between (a) per-signal endpoints pointed at a local receiver with the base var unset, or (b) a short OTEL_EXPORTER_OTLP_TIMEOUT in those cases only.",
          "blocking": false
        }
      ],
      "closed_objections": [],
      "reopen_petitions": [],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```

## Session 2026-11-13 — sdd-design

- Phase 0 Recon: recon.md was written 2026-11-11.
  - Services: config, identity, ledger, notify, ui, analysis, indicators, ingest, agent.
  - Key reuse patterns: the per-service telemetry copy with no shared helper (insights.md:4389), and the existing `runChild` spawn-with-env harness.
- Phase 1 Grilling: 3 rounds, full mode, run by /sdd-batch. design.md and debate.md are written; debate State is approved.
  - Chosen approach: a value-only fallback at 9 read sites.
    - Node: `|| 'SDK default'`.
    - Python: `os.getenv` plus `is None` ⇒ `"SDK default"`.
  - Tests are written first and must fail on the current code:
    - Node leaves: `runChild` `extraEnv` plus `INIT_ONLY_CHILD`.
    - UI: `telemetry.startupLog.test.ts` with listener-snapshot SIGTERM teardown.
    - UI AC-2: suffix tightened at `instrumentation.testkit.ts:100`.
    - Python: caplog on `record.endpoint`.
  - Docs: one line at UI `CLAUDE.md:325`.
  - Rejected: R-1..R-14 (key ones: resolved-URL logging, shared helper, userinfo strip, `.trim()`, `envOverride` name, `process.emit('SIGTERM')`, `setImmediate` exit).
- Constitution rules touched: C-01, C-11, C-15, C-16, C-18, P-02, P-03, P-06. Floor breaches: none.
- C-16: AC-1 CHANGE (literal `SDK default` for an unset base var) was signed off by the operator on 2026-11-13 at the sdd-batch design gate. All other touched @ACs are PRESERVE: AC-2, 226:UI@AC-2, 294:@AC-42, 171:@AC-2, config:@AC-7.
- Reopen petitions: none filed.
- Status: spec-ready → design-approved.

### Decisions

- D-1..D-15 in debate.md bind the spec. Cite the current-tree lines in D-15, not recon.md's stale ones:
  - Node: ui :80, config :211, identity :212, ledger :212, notify :213.
  - Python: analysis :246, indicators :242, ingest :243, agent :120.

### Open Threads

- [ ] **O-2 hermeticity (non-blocking).** In the unset and `""` cases, the Python and UI tests flush to the real localhost:4318. The spec picks one: (a) per-signal endpoints pointed at the local receiver with the base var unset, or (b) a short `OTEL_EXPORTER_OTLP_TIMEOUT`. Target: /sdd-spec (UI AC-1 and Python test steps).
- [ ] **Per-signal blind spot (D-5).** If only `OTEL_EXPORTER_OTLP_(TRACES|METRICS|LOGS)_ENDPOINT` is set, the log reads `SDK default`. Target: docs step (UI CLAUDE.md:325).
- [ ] **O-1, accepted (D-11).** Node logs a whitespace-only value raw. No code change. Target: none (recorded).
- [ ] **Empty-string divergence (D-10).** Node logs `SDK default`, Python logs `""`. The SDK's own empty-string resolution is unverified. Target: Node-leaf and Python test steps.
- [ ] **Pinned Node SDK may throw on `""`.** If it throws while building an exporter, the D-10 case breaks. Target: Node-leaf test step; re-decide if it fails.
- [ ] **UI AC-1 shutdown may hang** against a dead endpoint. Bounded by the O-2 choice. Target: UI AC-1 test step.
- [ ] **tsc-first builds.** Leaf tests depend on the tsc-first build for ledger and identity (fails.md:2237-2240). Run `node --test` and `tsc` per leaf. Target: verification step.
- [ ] **jscpd noise.** Near-duplicate test additions across 9 services may trigger it. Keep each assertion minimal. Target: each test step (pre-commit DRY rail).

## Session 2026-11-13 — sdd-spec

- Generated implementation-spec.md with 19 steps. Status → implementation-ready.
  - Structure: 9 per-service units (test step + service step, `**Lands with**`) in the order config, identity, ledger, notify, ui, analysis, indicators, ingest, agent, then 1 docs step (UI CLAUDE.md).
- Tree: `detached@26a61637 ≡ origin/feature/fix-telemetry-startup-log`.
  - The feature branch is based on `main-dev@c4fd48b0a`, 41 commits behind `origin/main-dev@52f6d5a6`. It was not synced here, because this run was limited to editing the feature directory.
  - All code evidence was read from `origin/main-dev@52f6d5a6` and matches the D-15 lines.
  - `/sdd-execute` BRANCH SYNC must merge `origin/main-dev` before Step 1.
- Key codebase findings:
  - Read sites (main-dev):
    - Node: ui `src/telemetry.ts:80`, config `:211`, identity `:212`, ledger `:212`, notify `:213`.
    - Python: analysis `app/telemetry.py:246`, indicators `:242`, ingest `:243`, agent `:120`.
    - UI AC-2 anchor: `instrumentation.testkit.ts:100`. Docs line: UI `CLAUDE.md:325`.
  - `runChild` `extraEnv`:
    - Already present in config (`:316`, spread `:331`) and ledger (`:241`, spread `:256`; `childFlushMetric` `:353` stays `Record<string, string>` and remains assignable).
    - Added in identity (`:204-208`) and notify (`:239-243`).
  - D-12 mechanism chosen: spawn ignores `undefined`-valued env entries. Probe on this host (Node v22.23.4): a child spawned with `env: { ...process.env, X: undefined }` printed `undefined false`.
  - `.jscpd.json` ignores `__tests__`, `*.test.ts`, `tests/` and `test_*.py`, so the jscpd Open Risk is moot for the test additions.

### Decisions

- **O-2 hermeticity: option (a).** The Python cases and the UI AC-1 case point `OTEL_EXPORTER_OTLP_{TRACES,METRICS,LOGS}_ENDPOINT` at the suite's local receiver while the base variable is unset, `""` or set. Why:
  - nothing goes to a real `localhost:4318`;
  - the awaited UI `sdk.shutdown()` stays deterministic;
  - it needs no SDK timing claim;
  - it also exercises the D-5 per-signal blind spot.

  The Node-leaf `INIT_ONLY_CHILD` exits without flushing, so it needs no mitigation.
- **Python fallback form.** Two lines, `if endpoint is None:` / `endpoint = "SDK default"`, because ruff E701 rejects the one-line form.
- **Python test shape.** One parametrized test per service: unset ⇒ `"SDK default"`, set ⇒ the value, `""` ⇒ `""`. Only the unset case is RED; the other two are characterization cases.
- **UI AC-2.** The `instrumentation.testkit.ts:100` tightening is a characterization (green before and after; red N/A, AC-2 PRESERVE).
- **Coverage of the AC-1 Examples table.** It names 4 services; the spec adds AC-1 tests to all 9.

### Open Threads

- [x] **O-2 hermeticity.** Resolved: option (a) (see Decisions).
- [x] **jscpd noise.** Closed: test paths are in the `.jscpd.json` ignore list.
- [ ] **Pinned Node SDK may throw on `""`.** Decided at U1 (config, Step 1). If the `""` case shows `[otel] init failed`, halt and return it to design; do not drop it (D-10, P-03).
- [ ] **tsc-first builds.** Each Node-leaf unit verifies `pnpm run build` and `pnpm test`.
- [ ] **C-16 promotion of `@AC-1` (CHANGE) and `@AC-2`.** Happens in the integration PR, not in a step (F-08).
