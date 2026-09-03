# xstockstrat-notify — Constitution Findings

Defects and drift surfaced by `/context-constitution` on 2026-07-24; refreshed 2026-09-02 (branch
`claude/loaded-plugins-list-d120nl` @ `82a0549`). For triage/fixing, not
governance. Repeated defects (dead `middleware/propagation.ts`, Node-20 drift) live in the root
findings log.

## Documentation that lies (docs claim behavior the code lacks)

_None currently open_ — the 3 unwired config keys (`notify.stream.max_subscribers`, `notify.alert.retention_days`, `notify.alert.max_body_bytes`) are **no longer a doc-lie** (2026-09-02): CLAUDE.md now labels each "Documented, not yet enforced," so the docs are honest. The underlying dead-config gap is tracked under Dead / orphaned code below.
| CLAUDE.md dependency "xstockstrat-ledger — Emit alert lifecycle events" + `LEDGER_ENDPOINT` | No ledger client and no `LEDGER_ENDPOINT` read anywhere | `CLAUDE.md:39,57` vs `src/` (grep zero) | ✓ **RESOLVED** (2026-08-02 refresh) — the fictional `xstockstrat-ledger` dep + `LEDGER_ENDPOINT` were removed from the deps table (config + PostgreSQL only) |

## Latent bugs (looks broken, not merely non-obvious)

| Issue | Impact | Evidence |
|---|---|---|
| Severity filter type/runtime mismatch: `StreamSubscriber.severities: number[]` vs the runtime string enum under `stringEnums`; the only test covers the numeric path | A subscriber that sets a `severities` filter compares string-vs-string, but the `number[]` annotation invites a "fix" that breaks the filter; CI won't catch it | `notifyServiceImpl.ts:14,141,247`, `notifyServiceImpl.test.ts:295-303` |
| **`WEBPUSH_HTTP_TIMEOUT_MS` is named/commented as an HTTP request timeout but is actually consumed as the Web Push message TTL** (2026-09-02): `webpush.sendNotification(..., { TTL: WEBPUSH_HTTP_TIMEOUT_MS / 1000 })` → TTL **10 seconds**. So (a) no real HTTP/send timeout is enforced despite the name, and (b) a 10-second push TTL means any device offline >10s never receives the notification — very likely not intended for OS alerts. | No send timeout; OS pushes silently expire after 10s of device-offline | `src/fanout/webPush.ts:25,139` — action: separate the two concerns (real send timeout vs. an intentional TTL) and pick a deliberate TTL; ask maintainer for intended value |

## Dead / orphaned code

| What | Why it looks dead | Evidence |
|---|---|---|
| `jsonwebtoken` + `bcrypt` (+ `@types`) deps | no usage in `src/` — copied from the identity template (not re-verified this refresh) | `package.json` (grep zero in `src/`) |
| 3 config keys `notify.stream.max_subscribers`, `notify.alert.retention_days`, `notify.alert.max_body_bytes` | read by no code (CLAUDE.md now self-labels each "Documented, not yet enforced" — honest, but still dead) | `CLAUDE.md:70-72` (grep zero) — action: wire or delete |

## Open questions (unresolved *why* — needs a maintainer)

- Fan-out ignores `call.write()` backpressure (drops only on thrown exception, no `drain`) — is unbounded per-slow-subscriber server-side buffering acceptable, or should an over-buffered subscriber be dropped? `notifyServiceImpl.ts:90` — status: **open**
- ⚠ An empty `targetUserId` broadcasts a Web Push to **EVERY subscription of EVERY user** (unfiltered `SELECT … FROM notify.push_subscriptions`) — consistent with `StreamAlerts` broadcast semantics, but for OS-level device notifications one untargeted alert pings all users' installed PWAs. Is cross-user push broadcast intended, or should untargeted alerts skip push? `src/fanout/webPush.ts:108-114` — status: **open**

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins). Defects to action, not rules. Re-run `/context-constitution` to refresh._
