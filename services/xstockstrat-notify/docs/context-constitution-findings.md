# xstockstrat-notify — Constitution Findings

Defects and drift surfaced by `/context-constitution` on 2026-07-24; refreshed 2026-09-02 (branch
`claude/loaded-plugins-list-d120nl` @ `82a0549`); re-verified 2026-10-14 (branch `ccr-fe84109f-0lwin8` @ `09ec8d9`); refreshed 2026-10-19 (branch `ccr-c386317f-6vt6t6` @ `a914f69` — all open rows re-verified still open; numeric-only severity test re-anchored; line hints re-stamped); refreshed 2026-11-04 (branch `ccr-d09db3b6-ao7ybn` @ `9892b61` — untargeted-push report marked resolved, bare-line cites in the TTL Resolved entry re-grounded, `TRADING_MODE` row widened, +3 open questions; no new latent bugs found in the feature-242/266 paths); refreshed 2026-11-10 (branch `main-dev` @ `3b0fa6ab` — 3 dead config keys and the banner's fictional-ledger-dep half resolved; +1 doc-lie (banner "config-as-startup-gate-only")); last refreshed 2026-11-15 (`claude/context-constitution-parity-zggeq3` @ `d600cf3`). For triage/fixing, not
governance. Repeated defects (dead `middleware/propagation.ts`, Node-20 drift) live in the root
findings log.

## Documentation that lies (docs claim behavior the code lacks)

_None open in this section_ — open doc-lie rows are in the additions section below. The 3 unwired config keys (`notify.stream.max_subscribers`, `notify.alert.retention_days`, `notify.alert.max_body_bytes`) are **no longer a doc-lie** (2026-09-02): CLAUDE.md now labels each "Documented, not yet enforced," so the docs are honest. The underlying dead-config gap was resolved 2026-11-10 (see Resolved).
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

- **RESOLVED 2026-11-15 — the six feature-338 commsgun rows (found 2026-11-15), by feature `346-fix-commsgun-email-channel`.** Each was confirmed by a regression test that failed on `d1c9727` and passes after the fix (`npm test`: 393 pass / 6 fail before, 399 / 0 after):
  - ⚠ non-https `commsgun.enqueue_url`: `src/fanout/emailProvider.ts#commsgunSettings` reads a URL failing `src/fanout/webhookUrlRule.ts#checkHttpsUrl` (the webhook URL rule without its allowlist: `https` only, ≤ 2048 characters, no whitespace or control characters, no userinfo, no trailing-dot host) as empty. The base is then not set (`unconfigured` when pinned, SendGrid in `auto`) and no POST is made (`emailProvider.test.ts` "@AC-1 (346)", "@AC-6 (346)"; `commsgunWorker.test.ts` "the enqueue URL is http" → `no_endpoint`, zero client calls). The pinned-mode alert explains the rule only when the URL is the missing key. An https-only rule cannot break a valid deployment, because the edge serves the tailnet name only on tcp:443 with its ACME wildcard certificate (feature 338 `recon.md` § Tailnet path).
  - Unsanitised subject: `src/fanout/emailRender.ts#renderEmail` replaces CR/LF runs with a space and cuts the subject to 998 code points, matching the producer exactly (`api/internal/enqueue/validate.go#emailContent`: `strings.ContainsAny(subject, "\r\n")` or `utf8.RuneCountInString(subject) > SubjectMaxLen`, re-read at commsgun `4e3e58d`). SendGrid gets the same subject. Rows already queued keep their stored subject (NOTIFY-17) (`sendgridSender.test.ts` "@AC-2 (346)").
  - No standing incident when pinned: `src/fanout/commsgunWorker.ts#standingIncidents` raises the "app key not available" incident in `commsgun` mode as well as `auto`, and the body text depends on the mode (`commsgunWorker.test.ts` "@AC-3 (346)"; @AC-25 now expects that incident next to the row alert).
  - 408 permanent: `src/fanout/commsgunClient.ts#classifyStatus` retries 408 as class `408` (`commsgunClient.test.ts` "@AC-4 (346)"). `docs/email-providers.md` and NOTIFY-17 are updated to match.
  - Found in review 2026-11-15 and fixed in the same PR: the email text was uncapped, so an alert body over commsgun's 256 KiB request limit (`api/internal/constants/constants.go#MaxBodyBytes`, a permanent 413) ended `undelivered`, and in pinned mode was lost. `renderEmail` now cuts the text, counted as JSON-escaped bytes, to 248 KiB plus a `[truncated]` line, leaving room for a worst-case subject and recipient (`sendgridSender.test.ts` "346 @AC-5", four escape-cost cases).
  - The two SendGrid doc-lie rows: the feature-020 line, the `fanout.sendgrid_{from,to}_email` rows and the `SENDGRID_API_KEY=` comment in `CLAUDE.md` now say "SendGrid email …".

- **RESOLVED 2026-11-10 — 3 dead config keys (`notify.stream.max_subscribers`, `notify.alert.retention_days`, `notify.alert.max_body_bytes`)**: dropped from `CLAUDE.md#Config Keys Consumed` (~L70-87) by commit `adf411c3`, which then listed only the six read keys (five `fanout.*` + `push.min_severity`; since feature 338 the section lists 20 read keys, still none of the three); `src/` grep for all three = zero hits.
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
