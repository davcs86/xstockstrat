# xstockstrat-ledger — Constitution Findings

Defects and drift surfaced by `/context-constitution` on 2026-07-24; refreshed 2026-09-02 (branch
`claude/loaded-plugins-list-d120nl` @ `82a0549`); re-verified 2026-10-14 (branch `ccr-fe84109f-0lwin8` @ `09ec8d9`); refreshed 2026-10-19 (branch `ccr-c386317f-6vt6t6` @ `a914f69` — all open rows re-verified still open; line hints re-stamped). For triage/fixing, not
governance. Repeated defects (dead `middleware/propagation.ts`, Node-20 drift) live in the root
findings log.

## Documentation that lies (docs claim behavior the code lacks)

| What the docs say | What the code does | Evidence | Suggested action |
|---|---|---|---|
| CLAUDE.md: immutability "enforced via PostgreSQL rules (`NO UPDATE`/`NO DELETE`)" | Rules aren't supported on hypertables; enforced via `deny_mutation` **triggers** | `CLAUDE.md:5` vs `migrations/001_…up.sql:26,46-60` | ✓ **RESOLVED** (2026-08-02 refresh) — CLAUDE.md:9,32 now say immutability is "enforced via PostgreSQL **triggers**, `deny_mutation`" |
| `CLAUDE.md` § Live Streaming Architecture says portfolio holds **three** permanent `StreamEvents` subscriptions; Environment Variables lists `TRADING_MODE=paper` | Portfolio holds **five** (adds `account.deregistered`, `order.bracket_updated`) and analysis adds a sixth, unfiltered P&L stream (LEDGER-3); `TRADING_MODE` is the repo-wide docs-vs-code disagreement logged in the root findings (`configWatcher.ts` still references it) | `CLAUDE.md#Live Streaming Architecture` "**three**" (~L46), `TRADING_MODE` (~L117); `services/xstockstrat-portfolio/internal/service/portfolio_service.go#ConsumeBracketUpdates (~L1151)`; `services/xstockstrat-analysis/app/engine/pnl_pattern_consumer.py#PnLPatternConsumer (~L119)` | Update the subscription count/list and the env block |

## Latent bugs (looks broken, not merely non-obvious)

| Issue | Impact | Evidence |
|---|---|---|
| Large-payload events (>~7000 chars) streamed live arrive as a **trimmed stub** with `payload=undefined` and `occurredAt=new Date(undefined)` → Invalid Date; replay/query of the same event is correct | Live-tail consumers of big events get silently corrupt rows. **Cross-module (plausible, unconfirmed, 2026-10-14):** analysis's `PnLPatternConsumer` subscribes with null filters, so it receives the stub for any `order.*` / `portfolio.position.closed` event over ~7000 chars; `process_event` reads `event.payload` via `HasField`, so a trimmed stub would be processed with an empty payload — depends on `rowToEvent` yielding `payload: undefined` | `migrations/001_…up.sql#notify_event_inserted` trim (~L71-80), `ledgerServiceImpl.ts#rowToEvent` `payload` (~L371) / `occurredAt` (~L373) |

## Dead / orphaned code

| What | Why it looks dead | Evidence |
|---|---|---|
| 3 documented config keys (`ledger.stream.notify_enabled`, `ledger.retention.years`, `ledger.compression.after_days`) | Read by no code; `ConfigWatcher` is a startup gate only. `ledger.stream.notify_enabled=false` is a no-op (the DB trigger fires unconditionally). **Reframed 2026-08-09** — no longer a "docs that lie" issue: CLAUDE.md's Config Keys table already says "Documented, not yet enforced/implemented — no code reads it" for all three (fixed by commit `06e451c`); the underlying dead-key gap is unchanged. | `CLAUDE.md#Config Keys Consumed (~L68-70)` vs `src/` (grep zero, re-verified 2026-10-19), `migrations/001_…up.sql#ledger_event_notify (~L87-89)` — action: wire or delete the keys |
| `package.json`'s `migrate` npm script (`node-pg-migrate up`) | Migration files use the golang-migrate `NNN_*.up/.down.sql` convention driven by `scripts/db-migrate.sh`; `node-pg-migrate` has no config here and would not apply them. **Reframed 2026-08-09** — no longer a "docs mismatch": CLAUDE.md's Running Locally section already tells the reader to run `../../scripts/db-migrate.sh` (golang-migrate), so nobody is currently pointed at the broken script — it's just a dead leftover. | `package.json#"migrate" (~L11)` vs `CLAUDE.md#Running Locally (~L124)` — action: delete the dead `migrate` script |

## Cross-module contract notes (not a bug — for consumers)

- **`ledger.events.user_id` is permanently NULL for all pre-feature-021 rows and CANNOT be backfilled** (an `UPDATE` is denied by the `deny_mutation` trigger). Any future consumer that assumes `user_id` is populated for historical events is wrong by construction; consumers must tolerate NULL `user_id`. `migrations/003_events_user_id.up.sql` (~L8-12). Not fixable — document as a contract.

## Open questions (unresolved *why* — needs a maintainer)

- `ExportEvents` reads `occurred_at BETWEEN $2 AND $3`; the window-days config only rejects a span that is too wide, so a start after the end silently returns zero rows — intended? `src/grpc/ledgerServiceImpl.ts#exportEvents` — status: **open**
- `streamExportRows` builds its `pg.Client` from `(this.pool as any).options` (`connectionString`/`ssl`) instead of `index.ts`'s `dbUrl`/`sslOption` — intentional single-source reach-in? — status: **open**
- The NOTIFY 8KB-trim path vs the live-tail stub it produces — is the truncated live event intended (consumers expected to re-`GetEvent` on a partial row), or should `StreamEvents` re-fetch the full row before `call.write` when the NOTIFY payload was trimmed? `migrations/001_…up.sql#notify_event_inserted (~L71-80)`, `ledgerServiceImpl.ts#rowToEvent (~L371,373)` — status: **open**


## Filed as defect reports (2026-10-19)

The open rows above were re-verified against `1302e6d` and recorded as `docs/reports/` defects
(status sidecar `open`) for `/sdd-triage --from-report`. A row stays here until its report is resolved.

| Report | Title |
|---|---|
| [`2026-10-19-dead-config-keys-defect`](../../../docs/reports/2026-10-19-dead-config-keys-defect.md) | Documented config keys that no code reads (ledger, notify, trading, marketdata, ingest) |
| [`2026-10-19-ledger-claude-md-drift-defect`](../../../docs/reports/2026-10-19-ledger-claude-md-drift-defect.md) | Ledger CLAUDE.md misstates the RPC list, subscriber count and compression/retention policy |
| [`2026-10-19-ledger-stream-trimmed-notify-payload-defect`](../../../docs/reports/2026-10-19-ledger-stream-trimmed-notify-payload-defect.md) | Live StreamEvents delivers a payload-less stub for events over ~7000 chars |
| [`2026-10-19-orphaned-code-defect`](../../../docs/reports/2026-10-19-orphaned-code-defect.md) | Orphaned modules, scripts and dependencies across services |

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins). Defects to action, not rules. Re-run `/context-constitution` to refresh._
