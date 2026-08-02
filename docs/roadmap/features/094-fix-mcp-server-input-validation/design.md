# Design: fix-mcp-server-input-validation

**Created**: 2026-08-02
**Rounds**: 1 (quick; termination: approved — no Floor breach, all objections resolved in-synthesis)
**Approved by**: standing autonomous directive ("implement 086–094 in sequence, one PR per feature") @ 2026-08-02
**Grounded in**: recon.md

---

## Chosen Approach

Two independent additive server-side guards, one per service, each paired with a RED-first test.
No proto/migration/config changes (recon § Dependencies). The change surface also carries the two
**MCP-tool docstrings** that describe today's (broken) behavior, because they are the model-facing
contract and go stale the instant the guards land — the exact RC-1 drift the source triage flagged
(ledger 2026-08-02).

### F-9 — ingest conviction range guard

In `app/handlers/servicer.py` `IngestSignal`, insert immediately after the direction guard
(`servicer.py:672`), before the DB source-registry lookup (`:675`) — fail fast, in-memory:

```python
if not (0.0 <= signal.conviction <= 1.0):
    await context.abort(
        grpc.StatusCode.INVALID_ARGUMENT, "conviction must be between 0.0 and 1.0"
    )
    return
```

The **inverted-range form** (`not (0.0 <= c <= 1.0)`) is chosen over `c < 0.0 or c > 1.0`
deliberately: they are identical for every finite value (`0.0` and `1.0` pass; `(0,1]` unaffected;
`±inf` rejected), but the inverted form **also rejects `NaN`** — every NaN comparison is False, so
`c < 0.0 or c > 1.0` would let a `NaN` conviction through, and it would then hit `NaN > 0.0 == False`
at the NULL-sentinel (`servicer.py:692`) and be **silently stored NULL** — reproducing this feature's
own bug for a different input. The inverted form closes that (adversary round 1, C-01/P-03).

`0.0` still passes the guard and falls through to the NULL-sentinel at `:692` (→ NULL), because the
proto `conviction` is a plain-scalar `double` with no proto3 presence (`ingest.proto:109`), so `0.0`
== "not provided". Making genuine zero-conviction representable stays out of scope (product-spec).
The DB CHECK `BETWEEN 0 AND 1` (`001_newsletter_signals.up.sql:14`, inclusive) is left as the
belt-and-braces backstop; the guard just converts the surfaced error from `INTERNAL` → `INVALID_ARGUMENT`.

**RED test** — new class `TestIngestSignalConvictionValidation` in `tests/test_ingest_servicer.py`,
mirroring `TestIngestSignalRegistryValidation` (`:822-847`): a **real** `ingest_pb2.ExternalSignal`
with `conviction=1.5`, a second `conviction=-0.1`, and a third `conviction=float("nan")`, each
asserting `context.abort.call_args[0][0] == grpc.StatusCode.INVALID_ARGUMENT`. Green regressions:
`conviction=0.7` proceeds to the INSERT (`resp.signal_id`), and `conviction=0.0` still succeeds
(stored NULL, not rejected).

### F-10 — notify emitAlert empty-field guard

In `src/grpc/notifyServiceImpl.ts` `emitAlert`, right after `const req = call.request;` (`:31`),
before the INSERT:

```typescript
if (!req.title?.trim() || !req.body?.trim()) {
  return callback({ code: 3, message: 'title and body are required' });
}
```

Numeric `code: 3` (== `INVALID_ARGUMENT`) mirrors identity's validation-guard idiom
(`identityServiceImpl.ts:52`) and notify's own numeric error style (`:95`) — zero new imports.
`.trim()` **deliberately widens** AC-2 ("empty title or body") to also reject whitespace-only:
the product-spec harm is "stored and **delivered blank**" (§ Problem Statement), and a whitespace-only
title delivers visually blank to a `StreamAlerts` subscriber exactly as `""` does. Recorded as a
conscious widening per CLAUDE.md How-to-Act #2/#3. The `?.` optional-chain is unreachable given
proto3's `""` default but kept as cheap defense (without it an impossible `undefined` would throw an
uncaught `TypeError` → `UNKNOWN`, not `INVALID_ARGUMENT`).

**Harness flip (prerequisite, not optional).** notify's suite still runs the
`--experimental-strip-types` harness (`package.json:12-13`) and `NotifyServiceImpl` uses a
parameter-property constructor (`:21-24`) that strip-types cannot compile — so the existing suite is a
**zero-assertion green** and has *never executed* (the 074 trap). A genuine RED-then-green F-10 test is
impossible under it. Flip `package.json` `test`/`test:coverage` to compile-first
(`tsc && node --test dist/__tests__/*.test.js`, byte-identical to config's script) and rewrite
`notifyServiceImpl.test.ts` to static imports with the `try/catch` + `if (!impl) return` early-returns
removed. notify's `tsconfig.json` is byte-identical to config's (`include: ["src/**/*"]`, `rootDir:
./src` → `outDir: ./dist`), so `tsc` already emits `dist/__tests__/*.test.js` — the flip is a clean
2-file change with no tsconfig edit.

**074 de-cloak guardrail (mandatory execute-time step).** Because the existing cases have never run,
flipping may surface latent red (config's flip surfaced "1 fails, 1 hangs"). Step 2 must, *before*
adding the F-10 case: compile the suite, run it, and confirm **every** pre-existing case
(severity string→int `:120-151`, Date `createdAt` serializer `:279-307`, DB-failure `code:13`
`:153-167`) executes and passes green — enumerating each preserved case in the rewrite — so the RED
demo proves the new test fails while all prior cases stay green (074 guard against silently dropped
coverage). Any latent red found is fixed within Step 2 (or, if it balloons, surfaced as a deviation
per P-03).

### Docs / MCP-tool surface (same PR)

- `services/xstockstrat-agent/app/tools.py:214-216` — `ingest_signal` docstring: replace "A value >
  1.0 is not caught here and fails downstream as INTERNAL, not INVALID_ARGUMENT" with the new
  contract (out-of-range or NaN → `INVALID_ARGUMENT`; omitted/0.0 → NULL).
- `services/xstockstrat-agent/app/tools.py:274-275` — `emit_alert` docstring: replace "stored and
  delivered verbatim with NO server-side validation — empty strings are accepted" with "empty (or
  whitespace-only) title/body are rejected `INVALID_ARGUMENT`".
- `docs/runbooks/mcp-tools.md` — the `ingest_signal` conviction row and the `emit_alert` section:
  reflect the new `INVALID_ARGUMENT` behavior (recon flagged `:200`/`:244`; verify exact lines at spec time).
- `docs/roadmap/features/merge-order.md` — record the 092↔094 notify collision (below).

### Absence-claim verification (ledger 080, recorded not assumed)

`rg 'EmitAlert|IngestSignal' services --glob '*.{go,py,ts}'` (adversary-run, to re-run at spec time):
- `IngestSignal` — one non-test caller: the agent (`app/client.py:107`), conviction optional →
  F-9 cannot break a caller passing valid/absent conviction.
- `EmitAlert` — five internal callers: trading (`trading.go:1442,1456`), analysis
  (`live_loop.py:189`), portfolio, marketdata — each builds title/body from literal-prefixed format
  strings (structurally non-empty). The agent's own auto-emit (`tools.py:243-244`) is likewise always
  non-empty. → F-10 cannot break an existing caller.

## Rejected Alternatives

- **F-9 as `c < 0.0 or c > 1.0`** — rejected: lets `NaN` through (all NaN comparisons False), which
  then stores NULL at `:692`, re-creating the feature's own silent-NULL bug for a different input.
  The inverted-range form dominates it (same finite behavior + NaN rejection).
- **F-10 empty-string-only (no `.trim()`)** — rejected: a whitespace-only title/body is delivered
  visually blank, which is the product-spec's stated harm; `.trim()` covers it. (Widening recorded.)
- **Split 094 into 094a (ingest) + 094b (notify, stacked on 092)** — rejected: violates the standing
  "one PR per feature" directive and introduces a hard cross-feature ordering dependency that blocks
  the notify fix on 092 landing. 094 stays one self-contained PR; the 092 overlap is handled by
  merge-order + rebase (identical-intent flip).
- **Skip the harness flip, keep strip-types** — rejected: impossible to write a genuine RED F-10 test
  (the module import itself fails to compile); would ship an unverifiable guard (074).
- **Change `NotifyServiceImpl` to drop parameter properties instead of flipping the harness** —
  rejected: larger, riskier source edit than a 2-file harness flip that config already proves out.

## Open Risks

- [ ] **092 notify-harness collision** — 092 (PR #850, unmerged) and 094 both rewrite
  `notify/package.json` + `notifyServiceImpl.test.ts`. Whichever lands second rebases on the other;
  intent is identical (compile-first flip) so the reconciliation is a union (092 adds an EmitAlert
  descriptor-parity test, 094 adds the empty-field test). Record in `merge-order.md`; the
  `/sdd-review impl-spec` overlap scan must confirm. — addressed at Step 2 / merge-order write.
- [ ] **notify de-cloak latent red** — the never-executed existing cases may fail once compiled;
  Step 2's guardrail greens them first. If remediation balloons beyond a trivial fix, surface as a
  P-03 deviation rather than absorbing it silently. — addressed at Step 2.

## Constitution Rules Touched

- `C-01` / `P-03` — honored: the NaN slip (an unstated failure mode) and the absence claim ("no other
  caller affected") are both surfaced with their grep/analysis, not assumed; the de-cloak risk is
  named, not swallowed.
- `C-08` / `P-06` — honored: both guards ship with a paired RED-first test that fails before the fix
  and passes after, in the suite it ships in (the notify suite is made real by the harness flip so the
  RED actually executes).
- `C-10` — honored: every surface describing the changed behavior updates in the same PR — both
  `tools.py` docstrings, the `mcp-tools.md` runbook, and the merge-order entry (no producer/consumer
  drift).
- `C-13` — honored: new Python (`TestIngestSignalConvictionValidation`) and Node (F-10 case) test
  fixtures follow the existing per-service test conventions; no cross-service fixture duplication.
- `F-04` — honored: every `path:line` above is grounded in the recon digests; nothing invented.
- `F-11` — honored: no Floor breach (no migration edit, no `main-dev` push, no invented paths); quick
  mode's single adversarial round ran and its objections are resolved.
