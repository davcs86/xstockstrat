# Design: fix-config-watcher-client-id

**Created**: 2026-09-04
**Rounds**: 2 (quick base + 1 extra; termination: approved)
**Approved by**: user @ 2026-09-04
**Grounded in**: recon.md

---

## Chosen Approach

A proportionate cosmetic fix: correct the copy-pasted `indicators-` identity in the **analysis** and
**ingest** config watchers so each subscriber (and its module docstring) names its own service.
Recon resolved the significance question — `client_id` is **cosmetic/diagnostic only** in
`xstockstrat-config` (used solely as an opaque segment of a `Date.now()`-unique `subId` and in log
lines; the subscriber map keys on `subId`, fan-out filters on namespace+environment, and `id(self)`
already makes each unique) — so this is observability-hygiene, not a functional collision.

**The change (per service, byte-identical except the prefix):** extract the inline
`WatchConfigRequest(...)` build in each `_watch()` into a `_build_watch_request(self) ->
config_pb2.WatchConfigRequest` method, and call `self._stub.WatchConfig(self._build_watch_request())`.
The extracted builder moves the existing four fields verbatim — `namespace=self.namespace`,
`client_id=…`, `environment=self._environment`, `trading_mode=self._trading_mode` — with the **only**
delta being the prefix: `f"indicators-{id(self)}"` → `f"analysis-{id(self)}"` (analysis
`watcher.py:60`) / `f"ingest-{id(self)}"` (ingest `watcher.py:73`). `client_id` stays computed from
`id(self)` inside the builder (no new attribute — keeps the move minimal). Also fix each watcher's
**module docstring line 2** (`"Config watcher for xstockstrat-indicators"` → `-analysis`/`-ingest`),
because the findings entries bind the docstring to the same "indicators identity" defect. The
indicators watcher is unchanged (its `indicators-` prefix is correct).

**Why `_build_watch_request()` and not `_client_id() -> str`** (R1 adversary): a string-only seam
asserts the source, not that `_watch()` puts it on the wire — a future inline revert re-hardcoding
`client_id="indicators-…"` on the request would stay GREEN (fails-074/1946 partial-repeat). The
whole-request seam lets the test assert the **real wire object** and simultaneously gives `@AC-10` a
live regression assertion.

**Test (per service, RED-before-green):** reuse the **existing** non-dialing `_StubWatcher(ConfigWatcher)`
(analysis `tests/test_analysis_servicer.py:475`, ingest `tests/test_ingest_servicer.py:1017`; overrides
only `__init__`, no channel/task). The stub sets the two attrs the builder reads
(`w._environment = common_pb2.ENVIRONMENT_STAGING`, `w._trading_mode = common_pb2.TRADING_MODE_PAPER`),
then `req = w._build_watch_request()` and asserts: (a) `req.client_id.startswith("analysis-")` (ingest:
`"ingest-"`) and `not …startswith("indicators-")` — **@AC-1** / **@AC-2**; (b)
`req.environment == ENVIRONMENT_STAGING` and `req.trading_mode == TRADING_MODE_PAPER` — a live wire-object
regression guarding **@AC-10**. RED today (`_build_watch_request` doesn't exist / prefix wrong), GREEN after.

**Consumer surface (C-14):** None — internal/platform-only (a `WatchConfigRequest` field; no UI/agent surface).

## Rejected Alternatives

- **`_client_id() -> str` seam** — rejected (R1): asserts the string source, not the wire object; a
  silent inline revert would stay green.
- **Bare two-literal flip, no test** — rejected: forfeits the `@AC-1`/`@AC-2` regression guard the
  acceptance file mandates (a C-15 gap); a future copy-paste could reintroduce it undetected.
- **Shared cross-service service-name-prefix helper** — rejected (How-to-Act #2): three independent
  Python services, no shared app lib (only generated proto), a one-token literal each service owns; a
  shared module for it is over-engineering. C-13 lazy-materialization doesn't fire (one consumer each).
- **Deleting the dead `sandbox_*` helpers in ingest** — rejected (out of scope): a different change
  class (dead-code deletion) bundled into the same findings entry; this cosmetic PR resolves only the
  identity portion — see Open Risks.

## Open Risks

- [ ] **Teardown must NARROW, not wholesale-resolve, the ingest findings entry.** The ingest finding
  (`services/xstockstrat-ingest/docs/context-constitution-findings.md:27`) bundles a **separate live
  defect** — dead indicators-only `sandbox_timeout_ms`/`sandbox_memory_bytes`/`sandbox_allowed_imports`
  helpers at `ingest/app/config/watcher.py:152-165`. In-PR, strike only the *identity* clause (docstring
  + client_id) and **retain** the dead-helper clause as an unresolved item. Marking the whole finding
  resolved would silently drop a live defect (the exact fails.md failure mode).
- [ ] **Teardown scope = four locations** (in-PR + `context-constitution refresh`, or manual-equivalent
  note): `services/xstockstrat-analysis/CLAUDE.md:3`, `services/xstockstrat-ingest/CLAUDE.md:3`,
  `services/xstockstrat-analysis/docs/context-constitution-findings.md:18`,
  `services/xstockstrat-ingest/docs/context-constitution-findings.md:27`. The findings docs cite stale
  line numbers (analysis `:61`, ingest `:75`) — actual `:60`/`:73`; correct while narrowing.
- [ ] Confirm the `_StubWatcher` location in each service and that setting `_environment`/`_trading_mode`
  is sufficient for `_build_watch_request()` (it reads only namespace + those two + `id(self)`).

## Constitution Rules Touched

- `C-08`/`P-06`/`C-15` — `@AC-1`/`@AC-2` covered by the wire-object RED-before-green test (asserts the
  built `WatchConfigRequest`, not a proxy — non-vacuous, fails-074-safe).
- `C-16` — `@AC-10` (WatchConfigRequest keeps `environment`, no `trading_mode` drop) not regressed, and
  now positively asserted by the same test. No portfolio/analysis/ingest risk `@AC` touched.
- `C-14` — internal/platform-only, stated with reason.
- `C-13`/DRY — no shared helper (over-engineering); each service names itself.
- `C-01`/`F-04` — all sites grep-confirmed (analysis `watcher.py:60`, ingest `:73`, docstrings `:2`);
  stale findings line numbers corrected at teardown.
- Teardown (root `CLAUDE.md`) — four context locations reconciled in-PR; the ingest dead-helper sub-item
  kept open.
- No Floor (`F-*`) breach.

## Business Rules Touched (C-16)

- PRESERVE `@AC-10` "Config messages carry environment production/staging and no trading_mode"
  (`services/xstockstrat-config/acceptance/config-secrets-and-scoping.feature:66-70`) — not regressed;
  the relabel changes only the `client_id` string, and the new test positively asserts `environment`/
  `trading_mode` on the built request.
