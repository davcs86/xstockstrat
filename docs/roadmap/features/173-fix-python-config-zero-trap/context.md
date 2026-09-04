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
