# Context Log: fix-python-loop-supervision

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-21 (/sdd-triage)

- Bug recorded as defect report `docs/reports/2026-10-21-python-loop-supervision-defect.md` (Issues disabled);
  sidecar `triaged` / `ref: feature:259-fix-python-loop-supervision`.
- Source: repo-surveyor debt-radar scan `docs/repo-surveyor/debt-radar-findings.md` @ 4535695, findings D-07, D-08, D-56.
- Severity: SEV-2 (group). Impact type: silent-background-loop-death. Environment: dev (main-dev) @ a053b0e. Config-only: no.
- Operator decisions (2026-10-21): grouped by service+theme from the debt-radar scan; Track C for all SEV-2 (precedent #1264); batch launched via /sdd-batch with designGate halt.
- Routed to SDD path (Track C).
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..6), context.md.
- Affected services: xstockstrat-analysis, xstockstrat-indicators, xstockstrat-ingest.
- Root cause hypothesis: per-cycle hardening without a supervised-loop helper or task registry (D-07); gRPC-only
  reconnect handler (D-08); skip-on-error plus a `GREATEST` cursor (D-56).
- Re-verification on a053b0e: all three D-ids reproduce by reading.
  - D-07: scan cites `fundsignal_loop.py:164-165` → now `:158-165` (`while True` at `:164`); `_tick`'s `except` also
    does DB I/O (`:152-155`). Servicer loops unchanged at `servicer.py:5925-5930`, `:6100-6106`, `:6144-6146`.
    `DurableSchedule` has no try at all (`durable_schedule.py:57,75,91`). `main.py` unretained `create_task` at
    `:143,167,174,194,211,215,221,225`. `live_loop.run_forever` (`live_loop.py:326-338`) is the guarded counter-example.
  - D-08: analysis `watcher.py:56,78` (unchanged), indicators `:56,77` (unchanged), ingest `:69,91` (unchanged).
  - D-56: `pnl_pattern_consumer.py:155-159` (scan `:156-159`), `GREATEST` at `:408`.
- **Overlaps:**
  - `244-fix-python-config-stored-zero` (implementation-ready) edits the same three `app/config/watcher.py` files
    (getters, not `_watch`) and the tick functions this feature touches: `servicer.py:5890,6066` and
    `fundsignal_loop.py:143,154` (`retry_seconds` wrappers), plus `entry_backfill.py:56-58`. Line-disjoint today, but
    rebase against 244 if it merges first; record in `merge-order.md` at /sdd-spec.
  - `248-fix-ledger-trimmed-notify-payload` (implementation-ready) Step "consumers unchanged" re-reads
    `pnl_pattern_consumer.py:147-162` and treats any change that advances a cursor before the handler as stop-and-ask.
    D-56's fix keeps that property (it retries before advancing), but it changes those lines, so 248's verification
    grep (`await asyncio.sleep(2)`) must still hold or be re-pointed. Sequence 248 first or coordinate.
  - `246-fix-fundsignal-neutral-score` and `260-fix-fundsignal-emit-accounting` edit `fundsignal_loop.py` (scoring /
    emit areas, disjoint from `run_forever`/`_tick`); rebase only.
  - `262-fix-analysis-owner-scope` (D-55) touches the unretained `entry_backfill` task at `main.py:174`; agree who
    owns the task-retention helper (this feature) so 262 reuses it rather than adding a second one.
  - Same-batch sibling `268-fix-indicators-formula-correctness` (draft) touches indicators
    `tests/test_config_watcher.py` and cites `pnl_pattern_consumer.py:50`; test-file rebase only.
- Recommended design depth: full → `/sdd-design fix-python-loop-supervision` (rationale: 3 affected services, the C-0
  full trigger). Design forks: one shared supervised-loop helper vs per-loop try; where the retained task set lives;
  D-56 poison-event rule (retry count, then park table vs log-and-advance).
- Development branch: feature/fix-python-loop-supervision
