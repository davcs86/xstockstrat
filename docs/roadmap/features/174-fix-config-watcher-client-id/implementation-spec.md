# Implementation Spec: fix-config-watcher-client-id

**Status**: `complete`
**Created**: 2026-09-04
**Feature**: `docs/roadmap/features/174-fix-config-watcher-client-id/feature.md`
**Total Steps**: 5
**Feature Branch**: `feature/fix-config-watcher-client-id`

---

## Execution Summary

Proportionate cosmetic fix (per `design.md`): the analysis and ingest config watchers each send a
copy-pasted `client_id=f"indicators-{id(self)}"` on their `WatchConfig` request, mislabelling them to
`xstockstrat-config` as `indicators-…`. Recon **resolved the significance question** — `client_id` is
diagnostic-only in the config service (an opaque `Date.now()`-unique `subId` segment plus log lines;
the subscriber map keys on `subId`, fan-out filters on namespace+environment, `id(self)` is already
unique) — so this is observability hygiene, not a functional collision. `xstockstrat-config` is **not
modified**.

Per service (analysis, then ingest), the change is byte-identical except the prefix: extract the
inline `WatchConfigRequest(...)` build in `_watch()` into a `_build_watch_request(self) ->
config_pb2.WatchConfigRequest` method, flip the prefix (`indicators-` → `analysis-` / `ingest-`), fix
the module docstring line 2, and add a RED-before-green wire-object test that asserts the built
request via the existing non-dialing `_StubWatcher`. A whole-request seam (not a `_client_id() -> str`
seam) is chosen so the test asserts the real wire object — a future inline revert re-hardcoding
`client_id="indicators-…"` on the request would stay caught (fails-074), and `@AC-10` gains a live
regression assertion. A final `docs` step discharges the teardown, narrowing the findings entries.

**Consumer surface (C-14):** None — internal/platform-only (a `WatchConfigRequest` field; no
`xstockstrat-ui` segment, no Agent MCP tool). No consumer-surface step required — a decision recorded
in `product-spec.md § Consumer Surface(s)`, not an omission.

**Scenario coverage (C-15):**
- `@AC-1` (analysis watcher client_id prefixed `analysis-`, not `indicators-`) → **Step 2**
- `@AC-2` (ingest watcher client_id prefixed `ingest-`, not `indicators-`) → **Step 4**

## Step Dependencies

- Step 2 [test] covers Step 1 [service] (analysis `_build_watch_request` + prefix flip).
- Step 4 [test] covers Step 3 [service] (ingest `_build_watch_request` + prefix flip).
- Steps 1–2 (analysis) and Steps 3–4 (ingest) are independent of each other — either service pair may
  go first; the ordering above is arbitrary.
- Step 5 [docs] teardown should run last (after both code fixes land) so the findings/CLAUDE.md
  reconciliation reflects the corrected code. It is docs-only; no code depends on it.

---

### Step 1 — service: analysis — extract `_build_watch_request()` and correct the `indicators-` identity

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/config/watcher.py` — modify

**Reviewers**: xstockstrat-analysis service owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Confirmed via Read `services/xstockstrat-analysis/app/config/watcher.py`:
  - L2 (module docstring): `Config watcher for xstockstrat-indicators.` (copy-pasted, wrong service)
  - L54–64 `_watch()` builds the request inline:
    ```python
    stream = self._stub.WatchConfig(
        config_pb2.WatchConfigRequest(
            namespace=self.namespace,
            client_id=f"indicators-{id(self)}",   # L60 — the defect
            environment=self._environment,
            trading_mode=self._trading_mode,
        )
    )
    ```
  - `self._environment` / `self._trading_mode` set in `__init__` (L46–47); `self.namespace` set L43.
- The `WatchConfigRequest` still carries `trading_mode` as a live proto field (also present on the
  ingest watcher L75) — moved verbatim, not removed.

**TDD**: `red-green required`

**Covers**: `—`

**Instructions**:
1. Fix the module docstring L2: `Config watcher for xstockstrat-indicators.` →
   `Config watcher for xstockstrat-analysis.` (leave L3 unchanged).
2. Add a method on `ConfigWatcher` (place it directly above `_watch()`):
   ```python
   def _build_watch_request(self) -> config_pb2.WatchConfigRequest:
       return config_pb2.WatchConfigRequest(
           namespace=self.namespace,
           client_id=f"analysis-{id(self)}",
           environment=self._environment,
           trading_mode=self._trading_mode,
       )
   ```
   The **only** delta from the current inline build is the prefix `indicators-` → `analysis-`. Keep
   `client_id` computed from `id(self)` inside the builder (no new instance attribute — keeps the move
   minimal, per `design.md`). Preserve `environment` and `trading_mode` verbatim (guards `@AC-10`).
3. Replace the inline `config_pb2.WatchConfigRequest(...)` argument in `_watch()` (L58–63) with
   `self._build_watch_request()`, so the call reads
   `stream = self._stub.WatchConfig(self._build_watch_request())`.
4. Do not touch any other method, the `resolve_environment`/`resolve_trading_mode` helpers, or the
   `sandbox_*` properties.

**Verification**:
- `grep -n "analysis-\|indicators-\|_build_watch_request\|xstockstrat-analysis" services/xstockstrat-analysis/app/config/watcher.py`
  — confirm `client_id=f"analysis-{id(self)}"` present, no `indicators-` remains, `_build_watch_request`
  defined and called, docstring says `xstockstrat-analysis`.
- Lint (may run in the paired Step 2): `cd services/xstockstrat-analysis && ruff check . && ruff format --check .`

---

### Step 2 — test: analysis — wire-object assertion on the built `WatchConfigRequest`

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify

**Reviewers**: xstockstrat-analysis service owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Confirmed via Read `services/xstockstrat-analysis/tests/test_analysis_servicer.py`:
  - L475 `class _StubWatcher(ConfigWatcher):` — non-dialing stub; its `__init__` sets `self.endpoint`,
    `self.namespace = "analysis"`, `self._snapshot`, `self._snapshot_event` (L476–480). It does **not**
    set `_environment` / `_trading_mode`, so the test must set them on the instance.
  - L483 `class TestConfigWatcherGetters:` — existing home for `_StubWatcher`-based tests.
  - The module already imports `asyncio`, `config_pb2`, and `common_pb2` (the getter tests at
    L490/L496 use `config_pb2`; confirm `common_pb2` import at top — add
    `from gen.common.v1 import common_pb2` if absent).

**TDD**: `red-green required`

**Covers**: `AC-1`

**Instructions**:
1. Add a new test (either a method on `TestConfigWatcherGetters` or a small sibling class near L483)
   that reuses the existing `_StubWatcher` — do **not** add a second stub:
   ```python
   def test_build_watch_request_client_id_and_scope(self):
       w = _StubWatcher()
       w._environment = common_pb2.ENVIRONMENT_STAGING
       w._trading_mode = common_pb2.TRADING_MODE_PAPER
       req = w._build_watch_request()
       # @AC-1 — analysis subscriber identity, not the copy-pasted indicators- prefix
       assert req.client_id.startswith("analysis-")
       assert not req.client_id.startswith("indicators-")
       # @AC-10 regression — WatchConfigRequest keeps environment + trading_mode on the wire
       assert req.environment == common_pb2.ENVIRONMENT_STAGING
       assert req.trading_mode == common_pb2.TRADING_MODE_PAPER
       assert req.namespace == "analysis"
   ```
2. This asserts the **real built request object**, not a string source, so a future inline revert that
   re-hardcodes `client_id="indicators-…"` on the request stays caught (fails-074).
3. **C-13 (non-frontend test data):** the only literals are proto enum constants
   (`common_pb2.ENVIRONMENT_STAGING`, `TRADING_MODE_PAPER`) and the `"analysis-"` prefix — not domain
   fixtures, single consumer, inline is compliant; no `conftest.py` home is warranted.
4. **Red-before-green:** run against the pre-Step-1 tree the test fails (`_build_watch_request` does
   not yet exist → `AttributeError`); after Step 1 it passes.

**Verification**:
- `cd services/xstockstrat-analysis && pytest tests/test_analysis_servicer.py -k build_watch_request -q`
  — passes after Step 1 (fails before).
- Coverage + lint gate: `cd services/xstockstrat-analysis && ruff check . && ruff format --check . && pytest --cov=app --cov-fail-under=40`
  — confirm ≥ 40%.

---

### Step 3 — service: ingest — extract `_build_watch_request()` and correct the `indicators-` identity

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/config/watcher.py` — modify

**Reviewers**: xstockstrat-ingest service owner — signal normalization correctness, idempotent ingestion, newsletter source schema stability

**Codebase Evidence**:
- Confirmed via Read `services/xstockstrat-ingest/app/config/watcher.py`:
  - L2 (module docstring): `Config watcher for xstockstrat-indicators.`
  - L67–77 `_watch()` builds the request inline with `client_id=f"indicators-{id(self)}"` at **L73**:
    ```python
    stream = self._stub.WatchConfig(
        config_pb2.WatchConfigRequest(
            namespace=self.namespace,
            client_id=f"indicators-{id(self)}",   # L73 — the defect
            environment=self._environment,
            trading_mode=self._trading_mode,
        )
    )
    ```
  - `self._environment` / `self._trading_mode` set in `__init__` (L59–60); `self.namespace` set L55.
  - The file also carries dead indicators-only `sandbox_*` helpers (L150–163) — **out of scope**
    (a separate change class; kept as an open findings item, see Step 5).

**TDD**: `red-green required`

**Covers**: `—`

**Instructions**:
1. Fix the module docstring L2: `Config watcher for xstockstrat-indicators.` →
   `Config watcher for xstockstrat-ingest.`
2. Add a `_build_watch_request(self) -> config_pb2.WatchConfigRequest` method on `ConfigWatcher`
   (directly above `_watch()`), byte-identical to analysis Step 1 except the prefix is `ingest-`:
   ```python
   def _build_watch_request(self) -> config_pb2.WatchConfigRequest:
       return config_pb2.WatchConfigRequest(
           namespace=self.namespace,
           client_id=f"ingest-{id(self)}",
           environment=self._environment,
           trading_mode=self._trading_mode,
       )
   ```
3. Replace the inline `config_pb2.WatchConfigRequest(...)` in `_watch()` (L71–76) with
   `self._build_watch_request()`.
4. Do **not** delete or touch the dead `sandbox_*` helpers, the `resolve_secret` method, or any
   backfill/dedup helpers — this PR resolves only the identity portion.

**Verification**:
- `grep -n "ingest-\|indicators-\|_build_watch_request\|xstockstrat-ingest" services/xstockstrat-ingest/app/config/watcher.py`
  — confirm `client_id=f"ingest-{id(self)}"` present, no `indicators-` remains **in the client_id/docstring**
  (note the `sandbox_*`/`indicators.sandbox.*` config-key strings at L150–161 legitimately keep the
  `indicators` token — those are config keys, not the identity, and stay), `_build_watch_request`
  defined and called, docstring says `xstockstrat-ingest`.
- Lint (may run in the paired Step 4): `cd services/xstockstrat-ingest && ruff check . && ruff format --check .`

---

### Step 4 — test: ingest — wire-object assertion on the built `WatchConfigRequest`

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/tests/test_ingest_servicer.py` — modify

**Reviewers**: xstockstrat-ingest service owner — signal normalization correctness, idempotent ingestion, newsletter source schema stability

**Codebase Evidence**:
- Confirmed via Read `services/xstockstrat-ingest/tests/test_ingest_servicer.py`:
  - L1017 `class _StubWatcher(ConfigWatcher):` — "skips gRPC init for unit testing getters"; `__init__`
    sets `self.endpoint`, `self.namespace = "ingest"`, `self._snapshot`, `self._snapshot_event`
    (L1020–1025). Does **not** set `_environment` / `_trading_mode`.
  - L1028 `class TestConfigWatcherGetters:` — existing `_StubWatcher` test home; module already uses
    `config_pb2` (L1035). Confirm `common_pb2` is imported at top — add
    `from gen.common.v1 import common_pb2` if absent.

**TDD**: `red-green required`

**Covers**: `AC-2`

**Instructions**:
1. Add a test reusing the existing `_StubWatcher` (no second stub), mirroring Step 2 with the
   `ingest-` prefix:
   ```python
   def test_build_watch_request_client_id_and_scope(self):
       w = _StubWatcher()
       w._environment = common_pb2.ENVIRONMENT_STAGING
       w._trading_mode = common_pb2.TRADING_MODE_PAPER
       req = w._build_watch_request()
       # @AC-2 — ingest subscriber identity, not the copy-pasted indicators- prefix
       assert req.client_id.startswith("ingest-")
       assert not req.client_id.startswith("indicators-")
       # @AC-10 regression — environment + trading_mode preserved on the wire
       assert req.environment == common_pb2.ENVIRONMENT_STAGING
       assert req.trading_mode == common_pb2.TRADING_MODE_PAPER
       assert req.namespace == "ingest"
   ```
2. **C-13:** proto enum constants + a one-token prefix literal, single consumer — inline compliant, no
   fixture home.
3. **Red-before-green:** fails against the pre-Step-3 tree (`_build_watch_request` absent); passes
   after Step 3.

**Verification**:
- `cd services/xstockstrat-ingest && pytest tests/test_ingest_servicer.py -k build_watch_request -q`
  — passes after Step 3 (fails before).
- Coverage + lint gate: `cd services/xstockstrat-ingest && ruff check . && ruff format --check . && pytest --cov=app --cov-fail-under=40`
  — confirm ≥ 40%.

---

### Step 5 — docs: teardown — narrow the findings entries and reconcile the CLAUDE.md defect references

**Status**: `done`
**Service**: `docs` (per-service context files)
**Files**:
- `services/xstockstrat-analysis/docs/context-constitution-findings.md` — modify
- `services/xstockstrat-ingest/docs/context-constitution-findings.md` — modify
- `services/xstockstrat-analysis/CLAUDE.md` — modify
- `services/xstockstrat-ingest/CLAUDE.md` — modify
- `docs/context-constitution-findings.md` (root) — modify

**Reviewers**: none

**Codebase Evidence** (grep-confirmed):
- `services/xstockstrat-analysis/docs/context-constitution-findings.md:18` — row
  `**ConfigWatcher carries indicators identity**` cites docstring `:2` and `client_id` **`:61`**
  (stale — actual is **`:60`**, and after Step 1 the client_id lives in `_build_watch_request`).
- `services/xstockstrat-ingest/docs/context-constitution-findings.md:27` — row cites docstring `:2`,
  `client_id` **`:75`** (stale — actual **`:73`**), **and** dead `sandbox_*` helpers `:152-165` (a
  **separate live defect**, out of scope). Line 5 of the same file also references the
  `client_id="indicators-…"` copy-paste as a repeated pattern.
- `services/xstockstrat-analysis/CLAUDE.md:4` — Constitution blockquote lists
  `` `client_id="indicators-"` copy-paste `` as a defect.
- `services/xstockstrat-ingest/CLAUDE.md:4` — same blockquote lists the copy-paste defect.
- `docs/context-constitution-findings.md:39` (root) — open question "is the `client_id` significant…?"
  citing `analysis/app/config/watcher.py:61`, `ingest/app/config/watcher.py:61` (both stale) — recon
  RESOLVED this as **cosmetic**.

**TDD**: `N/A (docs-only, no behavior change)`

**Covers**: `—`

**Instructions**:
1. **analysis findings `:18`** — the finding is a copy-paste identity defect fully fixed here: mark it
   resolved (or strike it), noting the docstring and `client_id` are now `analysis-…` via
   `_build_watch_request` (feature 174). Correct the stale `:61` → the change lands in
   `_build_watch_request` (client_id no longer inline at L60).
2. **ingest findings `:27`** — **NARROW, do not wholesale-resolve.** Strike **only** the identity
   clause (docstring + `client_id`), noting it is fixed by feature 174 (`ingest-…` via
   `_build_watch_request`). **RETAIN** the dead-helper clause (`sandbox_timeout_ms` /
   `sandbox_memory_bytes` / `sandbox_allowed_imports`, currently at `app/config/watcher.py:150-163`)
   as an unresolved item — it is a different change class (dead-code deletion), out of scope for this
   cosmetic PR. Wholesale-resolving would silently drop a live defect (the exact fails.md failure
   mode). Also update the stale `client_id` `:75` reference and correct the dead-helper range to the
   actual `:150-163` while narrowing.
3. **analysis `CLAUDE.md:4`** and **ingest `CLAUDE.md:4`** — remove the
   `` `client_id="indicators-"` copy-paste `` item from each Constitution blockquote's defect list (it
   is fixed). For ingest, keep the `9 dead config keys` item as-is; do not remove the whole line.
4. **root `docs/context-constitution-findings.md:39`** — the open significance question is resolved:
   update the entry to record recon's finding (config never keys on `client_id`; opaque `subId`
   segment + logs only; `id(self)` already unique) and that analysis/ingest are corrected to their own
   prefixes by feature 174. The indicators watcher's own `indicators-` prefix remains correct and
   unchanged. Correct the stale `:61`/`:61` line citations.
5. Run the Teardown audit per root `CLAUDE.md § Teardown`: run
   `/context-forge:context-constitution refresh` scoped to the five touched files and fix any grounded
   drift it reports. If the context-forge plugin is unavailable, perform the manual equivalent
   (re-read each touched context file against the corrected code, reconcile, and record in the PR body
   both that the plugin was unavailable **and** the manual reconciliation performed).

**Verification**:
- `grep -rn "client_id.*indicators-\|indicators-.*client_id\|client_id=\"indicators" services/xstockstrat-analysis/CLAUDE.md services/xstockstrat-ingest/CLAUDE.md services/xstockstrat-analysis/docs/context-constitution-findings.md docs/context-constitution-findings.md`
  — the identity-defect references are gone or marked resolved (no live "unfixed" claim remains for
  analysis/ingest).
- `grep -n "sandbox_" services/xstockstrat-ingest/docs/context-constitution-findings.md` — the dead
  `sandbox_*` helper clause is **still present** as an open item (must NOT disappear).
- `grep -rn "indicators-" services/xstockstrat-analysis/app/config/watcher.py services/xstockstrat-ingest/app/config/watcher.py`
  — no `indicators-` client_id/docstring remains (config-key strings `indicators.sandbox.*` in ingest
  are expected and unaffected).

---

## Deviation Log

- **Step 5 teardown — context-forge plugin unavailable.** `/context-forge:context-constitution refresh`
  is not an invocable skill this session. **Manual reconciliation performed** across the 5 touched
  context files: analysis findings row marked RESOLVED (matches `analysis-` prefix via
  `_build_watch_request`); ingest findings row NARROWED (identity struck, dead `sandbox_*` helper clause
  retained at the actual `:164-176`); both service `CLAUDE.md:4` blockquotes dropped the fixed
  `client_id` copy-paste item; root findings `:39` significance question resolved as cosmetic with the
  recon rationale. No drift; the dead-helper defect deliberately kept open (out of scope).
  **Disposition**: manual teardown equivalent (plugin unavailable).
