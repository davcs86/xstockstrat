# xstockstrat-notify — Constitution Findings

Defects and drift surfaced by `/context-constitution` on 2026-07-24; refreshed 2026-09-02 (branch
`claude/loaded-plugins-list-d120nl` @ `82a0549`); re-verified 2026-10-14 (branch `ccr-fe84109f-0lwin8` @ `09ec8d9`); refreshed 2026-10-19 (branch `ccr-c386317f-6vt6t6` @ `a914f69` — all open rows re-verified still open; numeric-only severity test re-anchored; line hints re-stamped); refreshed 2026-11-04 (branch `ccr-d09db3b6-ao7ybn` @ `9892b61` — untargeted-push report marked resolved, bare-line cites in the TTL Resolved entry re-grounded, `TRADING_MODE` row widened, +3 open questions; no new latent bugs found in the feature-242/266 paths); refreshed 2026-11-10 (branch `main-dev` @ `3b0fa6ab` — 3 dead config keys and the banner's fictional-ledger-dep half resolved; +1 doc-lie (banner "config-as-startup-gate-only")); last refreshed 2026-11-13 (`main-dev` @ `52f6d5a`). For triage/fixing, not
governance. Repeated defects (dead `middleware/propagation.ts`, Node-20 drift) live in the root
findings log.

## Documentation that lies (docs claim behavior the code lacks)

_None currently open_ — the 3 unwired config keys (`notify.stream.max_subscribers`, `notify.alert.retention_days`, `notify.alert.max_body_bytes`) are **no longer a doc-lie** (2026-09-02): CLAUDE.md now labels each "Documented, not yet enforced," so the docs are honest. The underlying dead-config gap was resolved 2026-11-10 (see Resolved).
| CLAUDE.md dependency "xstockstrat-ledger — Emit alert lifecycle events" + `LEDGER_ENDPOINT` | No ledger client and no `LEDGER_ENDPOINT` read anywhere | `CLAUDE.md:39,57` vs `src/` (grep zero) | ✓ **RESOLVED** (2026-08-02 refresh) — the fictional `xstockstrat-ledger` dep + `LEDGER_ENDPOINT` were removed from the deps table (config + PostgreSQL only) |

## Documentation that lies — additions (2026-10-14)

| What the docs say | What the code does | Evidence | Suggested action |
|---|---|---|---|
| `CLAUDE.md` Environment Variables lists `TRADING_MODE=paper` (banner half resolved 2026-11-10, see Resolved) | `TRADING_MODE` belongs to the repo-wide docs-vs-code disagreement in the root findings log (2026-11-04: nothing in `src/` reads the env var — only `src/__tests__/telemetry.test.ts` sets it — and `src/services/configWatcher.ts` sends `TradingMode.TRADING_MODE_UNSPECIFIED`) | `services/xstockstrat-notify/CLAUDE.md` env block (~L127); `src/services/configWatcher.ts` (~L89) | Refresh the env block |
| `CLAUDE.md` constitution banner names "config-as-startup-gate-only" as a local invariant (new 2026-11-10) | Config is read live per dispatch: `FanoutDispatcher` reads the five `fanout.*` keys and `WebPushDispatcher` reads `push.min_severity` on every `EmitAlert` (NOTIFY-3); `CLAUDE.md` § Config Keys Consumed itself says "Read live per dispatch" | `services/xstockstrat-notify/CLAUDE.md` banner (~L4) vs `src/fanout/fanout.ts#dispatch` (~L62), `src/fanout/webPush.ts#dispatch` (~L101) | Reword the banner to "fanout/push config read live per dispatch" on the next constitution-pointer refresh |

## Latent bugs (looks broken, not merely non-obvious)

| Issue | Impact | Evidence |
|---|---|---|
| Severity filter type/runtime mismatch: `StreamSubscriber.severities: number[]` vs the runtime string enum under `stringEnums`; the only test covers the numeric path | A subscriber that sets a `severities` filter compares string-vs-string, but the `number[]` annotation invites a "fix" that breaks the filter; CI won't catch it | `notifyServiceImpl.ts#StreamSubscriber` (~L14), `#streamAlerts` (~L127), `#matchesSubscriber` (~L280); numeric-only test `src/__tests__/notifyServiceImpl.test.ts` "filters by severity when severities array is set" (`severities: [1, 2]` ~L610) |

## Dead / orphaned code

| What | Why it looks dead | Evidence |
|---|---|---|
| `jsonwebtoken` + `bcrypt` (+ `@types`) deps | no usage in `src/` — copied from the identity template (re-verified 2026-10-14: still in `package.json`, grep zero in `src/`) | `package.json` (grep zero in `src/`) |

## Open questions (unresolved *why* — needs a maintainer)

- Fan-out ignores `call.write()` backpressure (drops only on thrown exception, no `drain`) — is unbounded per-slow-subscriber server-side buffering acceptable, or should an over-buffered subscriber be dropped? `notifyServiceImpl.ts#persistAndBroadcast` `sub.call.write(alert)` (~L124) — status: **open**
- `ListAlerts.unreadCount` ignores both `limit` and `unreadOnly` (counts all targeted-or-broadcast unread alerts for the user) — intended? `src/grpc/notifyServiceImpl.ts#listAlerts` — status: **open**
- `unregisterPushSubscription` takes no `x-user-id` at all, not even a presence check (consistent with NOTIFY-6) — intended? — status: **open**
- The acknowledged-flag filter in `matchesSubscriber` looks unreachable on the live stream, since every emitted alert has `acknowledged: false` — status: **open**
- `adminDirectory.ts#createAdminDirectory` is single-flight: a joiner gets the first caller's headers, and a failed shared lookup skips the push for every joined alert. Acceptable given that identity is header-blind and trace correlation is the only loss? (NOTIFY-8) — status: **open** (found 2026-11-04)
- `webPush.ts#dispatch` sends to each subscription sequentially with `await` (10 s timeout each) — is serial delivery intended, given N slow endpoints delay later devices? — status: **open** (found 2026-11-04)
- `listAlerts` shows alerts with `target_user_id IS NULL` in every user's history while Web Push now goes to admins only — is the in-app-broadcast versus admin-only-push split intentional (CLAUDE.md says the in-app broadcast still reaches everyone)? — status: **open** (found 2026-11-04)
- `fanoutWebhook` dedupes on `idempotency_key` alone: a repeat carrying a different `callback_url` or payload is a silent OK no-op (same shape as ledger's idempotent-append payload question). Intended? `src/grpc/notifyServiceImpl.ts#fanoutWebhook` `ON CONFLICT (idempotency_key) DO NOTHING` (~L344) — status: **open** (found 2026-11-13, refresh)

## Resolved

- **RESOLVED 2026-11-10 — 3 dead config keys (`notify.stream.max_subscribers`, `notify.alert.retention_days`, `notify.alert.max_body_bytes`)**: dropped from `CLAUDE.md#Config Keys Consumed` (~L70-87) by commit `adf411c3`, which now lists only the six read keys (five `fanout.*` + `push.min_severity`); `src/` grep for all three = zero hits.
- **RESOLVED 2026-11-10 — banner half of the banner / `TRADING_MODE` row**: the `CLAUDE.md` constitution banner no longer lists the fictional ledger dep and now names the dead `jsonwebtoken`/`bcrypt` deps (commit `adf411c3`). The `TRADING_MODE` half stays open above.
- **RESOLVED 2026-10-29 — resolved by feature 242 (admin-only untargeted audience).** An empty `targetUserId` used to Web-Push **every subscription of every user** (unfiltered `SELECT … FROM notify.push_subscriptions`), so one untargeted alert pinged all users' installed PWAs (open question, 2026-09-02). `src/fanout/webPush.ts#dispatch` now resolves the untargeted audience to admin-role users via a live identity `ListAdminUserIds` call (`src/services/adminDirectory.ts`) and queries `WHERE user_id = ANY($1::text[])` (~L116); a lookup failure skips the push. Per-user producers (portfolio risk, analysis live loop) now set `target_user_id`. The invariant is NOTIFY-8 in the constitution.
- **RESOLVED 2026-09-03 — `WEBPUSH_HTTP_TIMEOUT_MS` was named as an HTTP timeout but consumed as the Web Push message TTL (10s), so any device offline > 10s silently missed OS alerts and no real send timeout was enforced (latent bug, 2026-09-02).** The mis-named constant is gone; current code splits it into `WEBPUSH_TTL_SECONDS = 3600` and `WEBPUSH_SEND_TIMEOUT_MS = 10000` (`src/fanout/webPush.ts#WEBPUSH_TTL_SECONDS`), passes both distinctly to `webpush.sendNotification({ TTL, timeout })` (`#deliver`), and adds a regression test asserting the deliberate 1h TTL + a real socket timeout (`src/__tests__/webPush.test.ts`, "sends a deliberate 1h message TTL"). Both prongs — "no send timeout" and "10s TTL drops offline devices" — are fixed. Confirmed by re-resolving the citations against current code. The invariant is now captured as the TTL-vs-send-timeout scar in the constitution.


## Filed as defect reports (2026-10-19)

The open rows above were re-verified against `1302e6d` and recorded as `docs/reports/` defects
(status sidecar `open`) for `/sdd-triage --from-report`. A row stays here until its report is resolved.

| Report | Title |
|---|---|
| `2026-10-19-dead-config-keys-defect` (pruned 2026-11-10; `git show adf411c3:docs/reports/2026-10-19-dead-config-keys-defect.md`) | Documented config keys that no code reads (ledger, notify, trading, marketdata, ingest) |
| `2026-10-19-notify-claude-md-drift-defect` (pruned 2026-11-10; `git show adf411c3:docs/reports/2026-10-19-notify-claude-md-drift-defect.md`) | Notify CLAUDE.md banner and credential note cite resolved or retired items |
| [`2026-10-19-notify-listalerts-owner-fallback-unscoped-defect`](../../../docs/reports/2026-10-19-notify-listalerts-owner-fallback-unscoped-defect.md) | ListAlerts trusts the body userId and is unscoped with no identity |
| [`2026-10-19-notify-severities-type-runtime-mismatch-defect`](../../../docs/reports/2026-10-19-notify-severities-type-runtime-mismatch-defect.md) | StreamAlerts severities filter typed number[] but carries string enums at runtime |
| [`2026-10-19-notify-stream-ignores-backpressure-defect`](../../../docs/reports/2026-10-19-notify-stream-ignores-backpressure-defect.md) | StreamAlerts fan-out ignores write backpressure (unbounded buffering) |
| `2026-10-19-notify-untargeted-push-broadcasts-all-users-defect` (pruned 2026-11-04; git show 9892b610:docs/reports/2026-10-19-notify-untargeted-push-broadcasts-all-users-defect.md) | Untargeted alert sends a Web Push to every user's devices — **resolved (feature 242; verified 2026-11-04)**, see the Resolved section |
| [`2026-10-19-orphaned-code-defect`](../../../docs/reports/2026-10-19-orphaned-code-defect.md) | Orphaned modules, scripts and dependencies across services |
| [`2026-10-28-node-leaf-c8-check-coverage-unenforced-defect`](../../../docs/reports/2026-10-28-node-leaf-c8-check-coverage-unenforced-defect.md) | Node-leaf c8 `--lines 40` is declared but never enforced (no `--check-coverage`) |

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins). Defects to action, not rules. Re-run `/context-constitution` to refresh._
