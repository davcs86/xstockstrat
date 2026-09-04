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
