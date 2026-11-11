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
