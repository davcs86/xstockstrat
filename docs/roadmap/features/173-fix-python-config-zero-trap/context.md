# Context Log: fix-python-config-zero-trap

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-09-04 (/sdd-triage --from-report)

- Bug surfaced via `docs/reports/2026-09-04-comment-audit-triage.md` item 3 (comment-audit pass).
  No GitHub issue — Issues disabled on this repo; the dated report is the routable artifact.
- Severity: **SEV-2** (silent-wrong-behavior: a deliberate operator config value is silently ignored).
- Routed to SDD path (Track C). Environment is dev/local (main-dev), not a production emergency → C,
  not a hotfix.
- Created: feature.md, product-spec.md, acceptance.feature (regression scenario), context.md, status.md.
- Affected services: `xstockstrat-indicators`, `xstockstrat-ingest` (both `app/config/watcher.py`).
- Triage verification: **confirmed**.
  - indicators watcher: `get_str` (`:92` `v.string_val or default`), `get_int` (`:100`),
    `get_float` (`:116`) — all trapping; only `get_bool` (`:108`) uses `HasField`.
  - ingest watcher: same shape — `get_str` (`:105`), `get_int` (`:113`), `get_float` (`:129`);
    `get_bool` (`:121`) `HasField`-safe.
  - analysis watcher precedent: `get_int_present` (`:102`, `HasField` `:113`) and `get_float_present`
    (`:131`, `:142`) already exist. **Caveat**: analysis added int+float `_present` variants ONLY —
    there is no `get_str_present` anywhere, so the empty-string trap is unsolved platform-wide. The
    design must decide whether a string escape hatch is in scope.
- Root cause hypothesis: consumer defect — `or default` conflates falsy-0 with unset. The `HasField`
  fix landed in analysis but was never ported to indicators/ingest. `ConfigValue` is a `oneof`, so
  present-but-zero is distinguishable; this is not a proto/contract limit (re-confirms CF-N10).
- Recommended design depth: **full** → `/sdd-design fix-python-config-zero-trap`.
  Rationale (C-0): SEV-2 AND affected services ≥ 2 → full. Tempering note: the fix pattern is already
  proven in `xstockstrat-analysis`, so the real debate surface is narrow (mainly: shared-home vs
  per-service copy under the DRY guard rail, and whether `get_str_present` is in scope). A maintainer
  may reasonably downgrade to `quick`; recording `full` to honor the deterministic C-0 rule.
- Development branch: `feature/fix-python-config-zero-trap`.

---

## Session 2026-09-04 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- First pass FAILED (2 blockers, 3 warnings). Revised and re-reviewed → PASS (0 blockers, 0 warnings).
- Blockers fixed:
  - C-15 (acceptance malformed): bound scenarios to concrete 0-meaningful keys with `@FR-*` tags.
  - C-14 (missing Consumer Surface(s)): added `None — internal/platform-only` with the operator-visible
    config-ui/agent edge addressed.
- Warnings fixed: numbered FR-1/FR-2/FR-3 (criterion 2); Open Questions OQ-1..OQ-4 surfaced (criterion 9).
- **Substantive resolution** (was the reviewer's key concern — "fix may be defensive-only"): confirmed
  concrete 0-meaningful keys DO exist in ingest — `ingest.backfill.max_retry_attempts` (0 = no retries,
  passed through with no re-clamp at `servicer.py:521`) and `ingest.signals.dedup_window_hours`
  (0 = disable dedup, consumed at `servicer.py:823`). So this is a real SEV-2 bug in ingest, not merely
  defensive. Indicators' numeric keys (`timeout_ms`, `memory_bytes`) are NOT 0-meaningful → numeric port
  there is hardening; its real 0-case is the string `allowed_imports=""` (needs the nonexistent
  `get_str_present`) → carried as OQ-1.
- Overlap findings: none (CLEAN). Soft/rebase textual overlap with draft feature 174 on
  `ingest/app/config/watcher.py` (disjoint regions — 173 the accessor bodies, 174 the `client_id` line);
  not a live collision, no merge-order row required. Whichever lands second rebases.
- Warnings carried into design: none blocking. Open questions OQ-1..OQ-4 to be closed by `/sdd-design`.

---

## Session 2026-09-04 — sdd-design

- Phase 0 Recon: wrote recon.md (services: xstockstrat-ingest, xstockstrat-indicators; key reuse
  patterns: analysis `get_int_present`/`get_float_present` port, `get_bool` `HasField` idiom, the
  `ConfigValue` oneof `config.proto:60-71`). Confirmed both ingest 0-meaningful sites have no downstream
  re-clamp; the mcp_client keys are intentionally clamped ≥1 (must not un-clamp).
- Phase 1 Grilling: **3 rounds (full), approved**, no Floor breach.
  - Chosen approach: targeted add-not-replace port — `get_int_present` → ingest (route
    `max_retry_attempts` + `dedup_window_hours`); net-new `get_str_present` → indicators (route
    `allowed_imports=""` → deny-all); per-service copies; excluded `max_concurrent_*` semaphore keys
    annotated with intentional-zero-trap comments at their real Semaphore sites (`servicer.py:191` jobs,
    `:519` chunks); extract `_effective_max_attempts()` seam so the retry consumer is testably RED.
  - Rejected: blanket accessor swap (would un-clamp mcp_client keys); shared `_present` package (services
    share no importable lib; classes diverge); the "assert inline expression" test fallback (vacuous,
    fails-074); loop-driving @AC-1 (14s backoff).
- **Decisions closing the open questions**:
  - OQ-1 (string escape hatch): **RESOLVED — in scope.** Add `get_str_present`, fix
    `indicators.sandbox.allowed_imports=""` (a live security-relevant trap: today the empty allow-list
    reverts to the permissive 4-module default, making the sandbox MORE permissive than configured).
    User-approved at the R1 gate; `@AC-4` authored in acceptance.feature.
  - OQ-2 (DRY shared home): **RESOLVED — per-service copy.** No shared importable Python package exists;
    watcher classes diverge. Deferred jscpd waiver noted for the `dry-reviewer` (design.md Open Risks).
  - OQ-3 (indicators numeric port): **RESOLVED — no numeric port** (indicators numeric keys aren't
    0-meaningful → dead code). Indicators is in scope for the string fix only.
  - OQ-4 (retry semantics): **RESOLVED — intended least-surprise.** `max_retry_attempts=0` with
    `retry_on_failure=true` converging to the same 0-attempt outcome as `retry_on_failure=false` is a
    respected independent knob, not a defect.
  - **FR-1 narrowing (signed off)**: drop the consumerless `get_float_present` from ingest — int-only
    port. Deliberate narrowing of product-spec FR-1's literal text (which named both); `/sdd-spec` must
    honor int-only. Recorded here + design.md Open Risks (How-to-Act #2).
- Constitution rules touched: C-05, C-08, C-13, C-15, C-16, P-06, F-04, F-07 (all honored). Floor
  breaches: none in any round.
- Business rules: 3 PRESERVE (platform.feature @AC-1/@AC-3 auto-add; ingest @AC-4 dedup) — held at the
  default window; no CHANGE, no sign-off owed.
- Status: spec-ready → design-approved.
- Open Threads (carry into /sdd-spec): FR-1 int-only; `_effective_max_attempts()` sole-definition seam;
  `_snapshot`-injection vs `_StubWatcher` fallback; @AC-4 subprocess-sandbox test cost; deferred DRY.

---

## Session 2026-09-04 — sdd-spec

- Generated implementation-spec.md with 6 steps. Status → implementation-ready.
- Structure: ingest first (Steps 1-3: watcher `get_int_present` + `_effective_max_attempts()` seam +
  paired regression test), indicators second (Steps 4-5: net-new `get_str_present` + `allowed_imports`
  re-point + paired test), then Step 6 docs/FR-3 audit. Consumer surface confirmed internal-only (C-14),
  restated in Execution Summary — no consumer-surface step.
- FR-1 int-only narrowing honored: `get_float_present` NOT ported into ingest (dead public API).
- Key codebase findings (grep/Read-confirmed against the current tree):
  - Ingest watcher (`services/xstockstrat-ingest/app/config/watcher.py`): `get_int` `:107-113`
    (`v.int_val or default`); `get_bool` `:115-121` HasField-safe; `backfill_max_retry_attempts`
    `:174-176` and `dedup_window_hours` `:192-194` are the two keys to re-point;
    `backfill_max_concurrent_jobs` `:166-168` / `backfill_max_concurrent_chunks` `:187-189` stay on
    `get_int` (Semaphore-deadlock keys, annotate). This file carries the documented copy-paste defect
    (docstring + `client_id="indicators-"` + leftover sandbox helpers) but its accessor/property line
    numbers match recon/design exactly.
  - Port source: `services/xstockstrat-analysis/app/config/watcher.py:102-113` `get_int_present`
    (verbatim). No `get_str_present` exists anywhere → net-new in indicators.
  - Ingest servicer seam site: `servicer.py:520-522` inline `max_attempts` expression inside
    `_run_chunks` (`:513`), consumed at loop guard `:568` and short-circuit `:564`; real backoff
    `asyncio.sleep(2**attempt)` at `:571` (~14s) — the reason for the seam. Jobs semaphore `:191`,
    chunks semaphore `:519`, dedup SQL `$7` at `:809-810`/`:823`.
  - Indicators watcher: `get_str` `:86-92`, `get_bool` `:102-108` (mirror idiom),
    `sandbox_allowed_imports` `:126-131`; consumer `app/handlers/servicer.py:127`.
  - Tests: analysis `test_config_watcher.py` has NO accessor tests (only resolve_* helpers) → the
    accessor/property tests here are net-new. `test_ingest_servicer.py:31-63` `make_servicer` is the
    consumer scaffold (imports `config_pb2` + `ConfigWatcher`); indicators `test_formulas.py`
    `IndicatorsServicer(config_watcher=…)` is the optional end-to-end scaffold.
  - Test discipline applied: real `config_pb2.ConfigSnapshot`/`ConfigValue` + dial-free
    `ConfigWatcher.__new__` (insights-069/1060 real-proto rule; fails-074 no-live-watcher / no
    zero-assertion rule). `int_val=0` / `string_val=""` set the oneof case so `HasField` is True.

## Open Threads (carry into /sdd-execute)

- Step 2 seam must be the SOLE definition of `max_attempts` (delete the inline expr; keep the
  `make_servicer(max_retry=…)` loop tests green) — design.md Open Risk.
- `@AC-4` primary is the deterministic property assertion (`sandbox_allowed_imports == []`); the
  subprocess end-to-end run is optional/reviewer-gated (flake fallback per design.md Open Risk).
- Deferred DRY (OQ-2): the ~11-line `get_int_present` copy across analysis+ingest may trip jscpd —
  accepted per-service duplication, waivable at execute time (note for `dry-reviewer`).
- Step 6 teardown: context-constitution refresh scoped to the two edited service `CLAUDE.md` files.

---

## Session 2026-09-04T18:52:00Z — sdd-review impl-spec (advisory)

- Result: **PASS** — 0 failures, 1 warning (advisory — did not block). ConfigValue oneof premise + seam sites + excluded semaphore keys verified; tests non-vacuous with genuine RED; no Floor risk.
- Carried into execution:
  - Step 6: the FR-3 audit grep over ingest/app/config/watcher.py will also surface the DEAD `indicators.sandbox.*` helper copy at ingest watcher.py:149-163 (a get_str read of indicators.sandbox.allowed_imports) — [ ] unaddressed: pre-declare this dead copy as known-out-of-scope in the Step 6 enumeration so the "stop and reconcile" instruction does not false-stop on it (C-01 evidence completeness). It is dead code (ingest runs no sandbox); NOT a correctness/security/Floor issue. Same dead helper 174 deliberately leaves open.
- Overlap findings: SOFT (WARN, rebase-only) — 173 and 174 both edit three xstockstrat-ingest files (app/config/watcher.py, tests/test_ingest_servicer.py, CLAUDE.md) at DISJOINT line ranges. Recommend sequencing: land 173 (SEV-2 correctness) BEFORE 174 (cosmetic); 174 rebases. No shared migration/proto/config. No merge-order row written (WARN-level, not FAIL) — pending operator decision.
