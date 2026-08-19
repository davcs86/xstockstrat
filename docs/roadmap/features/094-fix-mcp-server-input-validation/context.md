# Context: fix-mcp-server-input-validation  (archived 2026-08-19)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-19 — /sdd-archiver

**What**: Shipped two additive server-side validation guards — an ingest `IngestSignal` conviction-range guard and a notify `emitAlert` empty/whitespace title-body guard — each converting a previously silent or mis-typed failure into `INVALID_ARGUMENT`. The ingest guard closes a silent-NULL data-corruption path; the notify guard was gated on first resurrecting a test suite that had never actually run. Both landed as one self-contained PR; no proto/migration/config touched.

**Why (irrecoverable rationale)**: The ingest guard is deliberately written as the inverted-range form `not (0.0 <= c <= 1.0)` rather than the obvious `c < 0.0 or c > 1.0`. The two are identical for every finite value, but the naive form lets `NaN` through (every NaN comparison is `False`), and a `NaN` conviction then hits the `> 0.0` NULL-sentinel at `servicer.py:692` (`NaN > 0.0 == False`) and is silently stored NULL — reproducing this very feature's bug for a different input class. A future agent reading the shipped `not (...)` guard cannot recover why it isn't the naive form. `0.0` intentionally still passes the guard and falls through to NULL because the proto `conviction` is a plain-scalar `double` with no proto3 presence, so `0.0` is indistinguishable from unset.

**Rejected alternatives**:
- Naive `c < 0.0 or c > 1.0` conviction guard — lost because it admits NaN → silent NULL.
- `emitAlert` empty-string-only guard (no `.trim()`) — lost because a whitespace-only title/body delivers visually blank to a `StreamAlerts` subscriber; `.trim()` is a recorded, deliberate widening of AC-2.
- Split into 094a (ingest) + 094b (notify stacked on 092) — lost because it violates one-PR-per-feature and creates a hard ordering dependency on 092 landing.
- Keep the strip-types harness / drop notify's parameter-property constructor instead of flipping — lost: the former makes a genuine RED impossible; the latter is a larger, riskier source edit than the 2-file harness flip.

**Scars & gotchas**: The NaN→silent-NULL interaction is the load-bearing gotcha: any float range-guard upstream of a `> 0.0`-style NULL-sentinel must reject NaN, or it re-opens the corruption path. notify's `emitAlert` test suite was a zero-assertion green that had never executed — the `--experimental-strip-types` harness cannot compile the `NotifyServiceImpl` parameter-property constructor, and the test's lazy `try/catch` import + `if (!impl) return` early-returns swallowed that into a passing no-op (the "074 trap"); RED-first work first required flipping to the compile-first script (byte-identical to config's) and de-cloaking every pre-existing case. Under the flipped `tsc` harness, inline `pool` object-literals passed to `new NotifyServiceImpl(pool, {})` fail TS excess/missing-property checks against the `Pool` type and need `as any` casts. Step-2 RED mechanics: a bare `MagicMock()` `_db` would go RED via an await-on-MagicMock `TypeError` rather than the asserted abort-miss, so the RED test mocked the full happy path so the pre-guard tree runs to completion and cleanly reports DID NOT RAISE. The `emitAlert` guard keeps the optional-chain `req.title?.trim()` deliberately, even though proto3's `""` default means `title`/`body` can never be `undefined`: cheap defense so an impossible `undefined` yields `INVALID_ARGUMENT`, not an uncaught `TypeError`→`UNKNOWN` — noted so a future reader doesn't read the `?.` on a non-nullable proto3 string as cargo-culting.

**Permanent deviations**: None — shipped guards matched design exactly. The one design-time risk (that de-cloaking notify might surface latent red, as config's identical flip had "1 fails, 1 hangs") did not materialize: all 14 pre-existing notify cases passed green on first compiled run. Recorded only so a future reader doesn't assume the clean de-cloak means the cases were never real.

**Cross-feature signal**: The notify strip-types → compile-first flip has now been forced by three separate features (074 originating the trap, 092, 094), remediated piecemeal one Node service per feature. Generalizable exposure: any Node service whose impl uses parameter-property constructors and still runs `--experimental-strip-types` may be shipping a never-executing suite.

**Deferred follow-ons**: Making a genuine zero-conviction representable requires a proto3-presence change on `ExternalSignal.conviction`; out of scope, tracked in report F-9. Until then `0.0` == unset == NULL is a load-bearing invariant. `emit_alert` authorization gating is feature 092 (F-11), not this fix.

**Ledger entries written**: insights.md (1), fails.md (1) — see the 2026-08-19 `fix-mcp-server-input-validation` entries. (A second insight — the strip-types→compile-first flip — was a DUP of the 074 fails.md lesson and skipped.)

**Runtime-invariant recommendations (→ /context-constitution)**: NOTIFY-* / PLAT test-infra candidate for `docs/context-constitution-findings.md` — "a Node service test suite running under `node --experimental-strip-types` silently becomes a zero-assertion no-op when the implementation uses parameter-property constructors, especially if the test wraps imports in `try/catch` + `if (!impl) return`. notify was remediated by 094; audit identity and ledger for the same latent pattern" (may partially exist via the 074 findings entry — verify before adding).

**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 1d97c6c. (Surviving triage report `docs/reports/2026-08-01-mcp-tools-alignment-triage.md` independently holds the reproduction detail.)
