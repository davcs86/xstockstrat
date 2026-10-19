# xstockstrat-notify — Constitution Findings

Defects and drift surfaced by `/context-constitution` on 2026-07-24; refreshed 2026-09-02 (branch
`claude/loaded-plugins-list-d120nl` @ `82a0549`); re-verified 2026-10-14 (branch `ccr-fe84109f-0lwin8` @ `09ec8d9`); refreshed 2026-10-19 (branch `ccr-c386317f-6vt6t6` @ `a914f69` — all open rows re-verified still open; numeric-only severity test re-anchored; line hints re-stamped). For triage/fixing, not
governance. Repeated defects (dead `middleware/propagation.ts`, Node-20 drift) live in the root
findings log.

## Documentation that lies (docs claim behavior the code lacks)

_None currently open_ — the 3 unwired config keys (`notify.stream.max_subscribers`, `notify.alert.retention_days`, `notify.alert.max_body_bytes`) are **no longer a doc-lie** (2026-09-02): CLAUDE.md now labels each "Documented, not yet enforced," so the docs are honest. The underlying dead-config gap is tracked under Dead / orphaned code below.
| CLAUDE.md dependency "xstockstrat-ledger — Emit alert lifecycle events" + `LEDGER_ENDPOINT` | No ledger client and no `LEDGER_ENDPOINT` read anywhere | `CLAUDE.md:39,57` vs `src/` (grep zero) | ✓ **RESOLVED** (2026-08-02 refresh) — the fictional `xstockstrat-ledger` dep + `LEDGER_ENDPOINT` were removed from the deps table (config + PostgreSQL only) |

## Documentation that lies — additions (2026-10-14)

| What the docs say | What the code does | Evidence | Suggested action |
|---|---|---|---|
| `CLAUDE.md` Constitution banner lists "fictional ledger dep" among the defects and omits the dead `jsonwebtoken`/`bcrypt` deps; Environment Variables lists `TRADING_MODE=paper` | The ledger dep was removed 2026-08-02; `TRADING_MODE` belongs to the repo-wide docs-vs-code disagreement in the root findings log | `services/xstockstrat-notify/CLAUDE.md` banner; `src/services/configWatcher.ts` | Refresh the banner and env block |

## Latent bugs (looks broken, not merely non-obvious)

| Issue | Impact | Evidence |
|---|---|---|
| Severity filter type/runtime mismatch: `StreamSubscriber.severities: number[]` vs the runtime string enum under `stringEnums`; the only test covers the numeric path | A subscriber that sets a `severities` filter compares string-vs-string, but the `number[]` annotation invites a "fix" that breaks the filter; CI won't catch it | `notifyServiceImpl.ts#StreamSubscriber` (~L14), `#streamAlerts` (~L127), `#matchesSubscriber` (~L280); numeric-only test `src/__tests__/notifyServiceImpl.test.ts` "filters by severity when severities array is set" (`severities: [1, 2]` ~L610) |

## Dead / orphaned code

| What | Why it looks dead | Evidence |
|---|---|---|
| `jsonwebtoken` + `bcrypt` (+ `@types`) deps | no usage in `src/` — copied from the identity template (re-verified 2026-10-14: still in `package.json`, grep zero in `src/`) | `package.json` (grep zero in `src/`) |
| 3 config keys `notify.stream.max_subscribers`, `notify.alert.retention_days`, `notify.alert.max_body_bytes` | read by no code (CLAUDE.md now self-labels each "Documented, not yet enforced" — honest, but still dead) | `CLAUDE.md#Config Keys Consumed` (~L75-77) (grep zero in `src/`, re-verified 2026-10-19) — action: wire or delete |

## Open questions (unresolved *why* — needs a maintainer)

- Fan-out ignores `call.write()` backpressure (drops only on thrown exception, no `drain`) — is unbounded per-slow-subscriber server-side buffering acceptable, or should an over-buffered subscriber be dropped? `notifyServiceImpl.ts#emitAlert` `sub.call.write(alert)` (~L84) — status: **open**
- `ListAlerts.unreadCount` ignores both `limit` and `unreadOnly` (counts all targeted-or-broadcast unread alerts for the user) — intended? `src/grpc/notifyServiceImpl.ts#listAlerts` — status: **open**
- `unregisterPushSubscription` takes no `x-user-id` at all, not even a presence check (consistent with NOTIFY-6) — intended? — status: **open**
- The acknowledged-flag filter in `matchesSubscriber` looks unreachable on the live stream, since every emitted alert has `acknowledged: false` — status: **open**
- ⚠ An empty `targetUserId` broadcasts a Web Push to **EVERY subscription of EVERY user** (unfiltered `SELECT … FROM notify.push_subscriptions`) — consistent with `StreamAlerts` broadcast semantics, but for OS-level device notifications one untargeted alert pings all users' installed PWAs. Is cross-user push broadcast intended, or should untargeted alerts skip push? `src/fanout/webPush.ts#dispatch` (unfiltered branch ~L97-101; targeted branch ~L91-96, query ~L93) — status: **open**

## Resolved

- **RESOLVED 2026-09-03 — `WEBPUSH_HTTP_TIMEOUT_MS` was named as an HTTP timeout but consumed as the Web Push message TTL (10s), so any device offline > 10s silently missed OS alerts and no real send timeout was enforced (latent bug, 2026-09-02).** The mis-named constant is gone; current code splits it into `WEBPUSH_TTL_SECONDS = 3600` and `WEBPUSH_SEND_TIMEOUT_MS = 10000` (`src/fanout/webPush.ts:15-16`), passes both distinctly to `webpush.sendNotification({ TTL, timeout })` (`:148-151`), and adds a regression test asserting the deliberate 1h TTL + a real socket timeout (`src/__tests__/webPush.test.ts:200-224`). Both prongs — "no send timeout" and "10s TTL drops offline devices" — are fixed. Confirmed by re-resolving the citations against current code. The invariant is now captured as the TTL-vs-send-timeout scar in the constitution.

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins). Defects to action, not rules. Re-run `/context-constitution` to refresh._
