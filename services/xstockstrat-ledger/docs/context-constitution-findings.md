# xstockstrat-ledger — Constitution Findings

Defects and drift surfaced by `/context-constitution` on 2026-07-24; refreshed 2026-09-02 (branch
`claude/loaded-plugins-list-d120nl` @ `82a0549`); re-verified 2026-10-14 (branch `ccr-fe84109f-0lwin8` @ `09ec8d9`); refreshed 2026-10-19 (branch `ccr-c386317f-6vt6t6` @ `a914f69` — all open rows re-verified still open; line hints re-stamped); updated 2026-10-29 (feature 248 — NOTIFY-trim rows resolved); refreshed 2026-11-04 (branch `ccr-d09db3b6-ao7ybn` @ `9892b61` — +2 latent bugs (`exportEvents` backpressure/cancel, unguarded `toSeq`), +3 doc-lie rows, `TRADING_MODE` evidence rewritten, +3 open questions, impl-test report's ledger half closed). For triage/fixing, not
governance. Repeated defects (dead `middleware/propagation.ts`, Node-20 drift) live in the root
findings log.

## Documentation that lies (docs claim behavior the code lacks)

| What the docs say | What the code does | Evidence | Suggested action |
|---|---|---|---|
| CLAUDE.md: immutability "enforced via PostgreSQL rules (`NO UPDATE`/`NO DELETE`)" | Rules aren't supported on hypertables; enforced via `deny_mutation` **triggers** | `CLAUDE.md:5` vs `migrations/001_…up.sql:26,46-60` | ✓ **RESOLVED** (2026-08-02 refresh) — CLAUDE.md:9,32 now say immutability is "enforced via PostgreSQL **triggers**, `deny_mutation`" |
| `CLAUDE.md` § Live Streaming Architecture says portfolio holds **three** permanent `StreamEvents` subscriptions; Environment Variables lists `TRADING_MODE=paper` | Portfolio holds **five** (adds `account.deregistered`, `order.bracket_updated`) and analysis adds a sixth, unfiltered P&L stream (LEDGER-3); `TRADING_MODE` is the repo-wide docs-vs-code disagreement logged in the root findings (2026-11-04: `src/services/configWatcher.ts#startWatch` now sends only `TradingMode.TRADING_MODE_UNSPECIFIED` and no `src/` code reads the env var — only `src/__tests__/telemetry.test.ts` sets it — so the `TRADING_MODE=paper` env line is pure dead config here) | `CLAUDE.md#Live Streaming Architecture` now "**five**" (~L46), `TRADING_MODE` (~L123); `services/xstockstrat-portfolio/internal/service/portfolio_service.go#ConsumeBracketUpdates (~L1151)`; `services/xstockstrat-analysis/app/engine/pnl_pattern_consumer.py#PnLPatternConsumer (~L119)` | Subscription count/list: ✓ **RESOLVED (feature 248)** — CLAUDE.md § Live Streaming Architecture now says **five** and names analysis's unfiltered stream. `TRADING_MODE` env block: still **open** |
| `CLAUDE.md` § Stream Key Conventions omits `user:{owner}` (found 2026-11-04) | The key is produced by `app/admin_audit.py` in analysis, ingest and indicators (root PLAT-15); the `account:`, `copilot:` and `config:` rows are present | `services/xstockstrat-analysis/app/admin_audit.py` (`stream_key=f"user:{stream_owner}"`) | Add the row |
| `CLAUDE.md` § Database says `pg_notify('ledger_stream_{stream_key}', …)` and "Compression: after 3 days / Retention: 2 years" (found 2026-11-04) | The trigger sanitizes the channel with `regexp_replace(NEW.stream_key, '[^a-zA-Z0-9]', '_', 'g')` (code uses the `ledger_stream_all` channel), and no migration defines a compression or retention policy | `migrations/001_ledger_events_hypertable.up.sql#notify_event_inserted` | Fix both lines |
| `CLAUDE.md` § Ports lists four RPCs and omits `ExportEvents` (found 2026-11-04) | `ExportEvents` is in the proto and the impl | `src/grpc/ledgerServiceImpl.ts#exportEvents` | Add it |

## Latent bugs (looks broken, not merely non-obvious)

| Issue | Impact | Evidence |
|---|---|---|
| Large-payload events (>~7000 chars) streamed live arrive as a **trimmed stub** with `payload=undefined` and `occurredAt=new Date(undefined)` → Invalid Date; replay/query of the same event is correct | Live-tail consumers of big events get silently corrupt rows. **Cross-module (plausible, unconfirmed, 2026-10-14):** analysis's `PnLPatternConsumer` subscribes with null filters, so it receives the stub for any `order.*` / `portfolio.position.closed` event over ~7000 chars; `process_event` reads `event.payload` via `HasField`, so a trimmed stub would be processed with an empty payload — depends on `rowToEvent` yielding `payload: undefined` | `migrations/001_…up.sql#notify_event_inserted` trim (~L71-80), `ledgerServiceImpl.ts#rowToEvent` `payload` (~L381) / `occurredAt` (~L383). ✓ **RESOLVED (feature 248)** — `EventNotifier` resolves a trimmed row by PK before fan-out (`src/services/eventNotifier.ts#drain (~L176-246)`); a resolve failure ends matching streams 13/14 for client replay |
| **`exportEvents` ignores `call.write()` backpressure and cancel/close** (found 2026-11-04): unlike `streamEvents` (`waitForDrain`, `call.on('cancelled')`), the export loop writes without checking the return value or a cancelled flag. | After a client disconnect the cursor loop keeps draining the whole scan on its dedicated `pg.Client` and writes to a dead call; a large export also buffers in memory. Single-site asymmetry, not an N≥3 pattern. | `src/grpc/ledgerServiceImpl.ts#exportEvents` (~L412-414), `#streamExportRows` |
| **`streamEvents` calls `toSeq(req.fromSequence)` with no try/catch** (found 2026-11-04, minor): a value above 2^53 throws an unhandled rejection instead of `InvalidArgument` (`QueryEvents` handles bad tokens; `StreamEvents` does not). | A bad `from_sequence` crashes the handler's async path rather than failing the call cleanly. | `src/grpc/ledgerServiceImpl.ts#streamEvents`, `#toSeq` (~L30) |

## Dead / orphaned code

| What | Why it looks dead | Evidence |
|---|---|---|
| 3 documented config keys (`ledger.stream.notify_enabled` — row deleted by feature 306 on 2026-11-10, `ledger.retention.years`, `ledger.compression.after_days`) | Read by no code; `ConfigWatcher` is a startup gate only. `ledger.stream.notify_enabled=false` is a no-op (the DB trigger fires unconditionally). **Reframed 2026-08-09** — no longer a "docs that lie" issue: CLAUDE.md's Config Keys table already says "Documented, not yet enforced/implemented — no code reads it" for all three (fixed by commit `06e451c`); the underlying dead-key gap is unchanged. | `CLAUDE.md#Config Keys Consumed (~L73-75)` vs `src/` (grep zero, re-verified 2026-10-19), `migrations/001_…up.sql#ledger_event_notify (~L87-89)` — action: wire or delete the keys |
| `package.json`'s `migrate` npm script (`node-pg-migrate up`) | Migration files use the golang-migrate `NNN_*.up/.down.sql` convention driven by `scripts/db-migrate.sh`; `node-pg-migrate` has no config here and would not apply them. **Reframed 2026-08-09** — no longer a "docs mismatch": CLAUDE.md's Running Locally section already tells the reader to run `../../scripts/db-migrate.sh` (golang-migrate), so nobody is currently pointed at the broken script — it's just a dead leftover. | `package.json#"migrate" (~L11)` vs `CLAUDE.md#Running Locally (~L130)` — action: delete the dead `migrate` script |

## Cross-module contract notes (not a bug — for consumers)

- **`ledger.events.user_id` is permanently NULL for all pre-feature-021 rows and CANNOT be backfilled** (an `UPDATE` is denied by the `deny_mutation` trigger). Any future consumer that assumes `user_id` is populated for historical events is wrong by construction; consumers must tolerate NULL `user_id`. `migrations/003_events_user_id.up.sql` (~L8-12). Not fixable — document as a contract.

## Open questions (unresolved *why* — needs a maintainer)

- `ExportEvents` reads `occurred_at BETWEEN $2 AND $3`; the window-days config only rejects a span that is too wide, so a start after the end silently returns zero rows — intended? `src/grpc/ledgerServiceImpl.ts#exportEvents` — status: **open**
- `streamExportRows` builds its `pg.Client` from `(this.pool as any).options` (`connectionString`/`ssl`) instead of `index.ts`'s `dbUrl`/`sslOption` — intentional single-source reach-in? — status: **open**
- The NOTIFY 8KB-trim path vs the live-tail stub it produces — is the truncated live event intended (consumers expected to re-`GetEvent` on a partial row), or should `StreamEvents` re-fetch the full row before `call.write` when the NOTIFY payload was trimmed? `migrations/001_…up.sql#notify_event_inserted (~L71-80)`, `ledgerServiceImpl.ts#rowToEvent (~L381,383)` — status: **RESOLVED (feature 248)** — neither: the notifier re-fetches the full row by PK on the LISTEN connection before fan-out (`src/services/eventNotifier.ts#drain (~L176-246)`), keeping the `StreamEvents` flush synchronous
- Are `GetEvent` (by `event_id`) and `StreamEvents` deliberately unscoped by `x-user-id` (internal-only), and may any user-facing BFF route reach them? An edge forwarding `GetEvent` by id would expose another user's payload. `src/grpc/ledgerServiceImpl.ts#getEvent`, `#streamEvents` — status: **open** (found 2026-11-04; root owner-scope row)
- Is the idempotent-append dedup (returns the stored event with no payload compare) intended to ignore a differing payload under the same key? `ledgerServiceImpl.ts#appendEvent` — status: **open** (found 2026-11-04)
- On a resolve timeout the deliberate `client.end()` resyncs every live stream (LEDGER-8) — acceptable at scale, where one slow PK read ends all N subscribers' streams? — status: **open** (found 2026-11-04)


## Filed as defect reports (2026-10-19)

The open rows above were re-verified against `1302e6d` and recorded as `docs/reports/` defects
(status sidecar `open`) for `/sdd-triage --from-report`. A row stays here until its report is resolved.

| Report | Title |
|---|---|
| [`2026-10-19-dead-config-keys-defect`](../../../docs/reports/2026-10-19-dead-config-keys-defect.md) | Documented config keys that no code reads (ledger, notify, trading, marketdata, ingest) |
| [`2026-10-19-ledger-claude-md-drift-defect`](../../../docs/reports/2026-10-19-ledger-claude-md-drift-defect.md) | Ledger CLAUDE.md misstates the RPC list, subscriber count and compression/retention policy |
| `2026-10-19-ledger-stream-trimmed-notify-payload-defect` (pruned 2026-11-04; git show 9892b610:docs/reports/2026-10-19-ledger-stream-trimmed-notify-payload-defect.md) | Live StreamEvents delivers a payload-less stub for events over ~7000 chars — **resolved (feature 248)** |
| [`2026-10-19-orphaned-code-defect`](../../../docs/reports/2026-10-19-orphaned-code-defect.md) | Orphaned modules, scripts and dependencies across services |
| `2026-10-20-node-impl-test-suites-never-load-impl-defect` (pruned 2026-11-04; git show 9892b610:docs/reports/2026-10-20-node-impl-test-suites-never-load-impl-defect.md) | identity and ledger unit suites never load the service implementation (impl tests pass vacuously; found 2026-10-20) — **ledger half no longer reproduces (verified 2026-11-04: `ledgerServiceImpl.test.ts` does `await import('../grpc/ledgerServiceImpl.js')` and asserts `typeof LedgerServiceImpl === 'function'`)** |
| [`2026-10-28-node-leaf-c8-check-coverage-unenforced-defect`](../../../docs/reports/2026-10-28-node-leaf-c8-check-coverage-unenforced-defect.md) | Node-leaf c8 `--lines 40` is declared but never enforced (no `--check-coverage`) |

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins). Defects to action, not rules. Re-run `/context-constitution` to refresh._
