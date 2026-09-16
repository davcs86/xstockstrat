# Design: fix-trading-config-key-mismatch

**Created**: 2026-09-15
**Rounds**: 3 (full; termination: approved with open risks recorded)
**Approved by**: user @ 2026-09-15
**Grounded in**: recon.md

---

## Chosen Approach

Fix the SEV-1 config-resolution defect in **four coordinated parts**, all aligning to the full-dotted
CONFIG-9 storage contract (`services/xstockstrat-config/docs/context-constitution.md:26`; feature-147/184).
Root cause is two orthogonal faults (recon § Runtime evidence, § Root cause): trading never receives the
`platform` namespace (config broadcasts `subscribers=0`), and the deviating seed rows are stored
namespace-relative while consumers read full-dotted.

**Part A — Trading watcher: multi-namespace delivery (trading only).**
Convert trading's copied watcher (`services/xstockstrat-trading/internal/config/config.go:75` `NewWatcher`)
to variadic `NewWatcher(endpoint, applicationEnv, tradingMode string, namespaces ...string)`, spawning one
`watchLoop(ns)` goroutine per namespace, each with its own `stream()`/reconnect, all writing the single
`w.snapshot` under the existing `w.mu` (`config.go:67`). `cmd/server/main.go:61` passes `("trading","platform")`.
No key transform in the getters (`config.go:167-205`) — post-migration the server streams full-dotted
`row.key`, so the raw `w.snapshot[key]` lookups resolve as-is. **SNAPSHOT/RELOAD becomes a namespace-scoped
replace** (replacing the verbatim `w.snapshot = snap.Values` at `config.go:144`): in one `w.mu.Lock()` section,
delete keys with prefix `ns+"."`, then insert `snap.Values` — so the `trading` stream's RELOAD (fires on any
`trading.*` SetConfig) can never wipe `platform.*` (transient false HALTED). **DELTA stays a per-key merge**
(`config.go:146-148`) — asymmetric but benign (own-namespace; `platform.trading_state` never deleted).
**Readiness**: replace the single `once`/`ready` (`config.go:69`) with a per-namespace `pending` set;
under the mutex, `delete(pending, ns)` on each namespace's first SNAPSHOT and `close(ready)` via a
`closeOnce` when empty (double-close-safe on stream reconnect); `WaitForSnapshot` (`config.go:156`) blocks
until **all** subscribed namespaces delivered, else the 90s timeout aborts startup (fail-closed — never
serves the default HALTED as if live). **Portfolio/marketdata watchers are NOT touched** — they read no
`platform.*` key (recon Codebase Map), and their full-dotted getters resolve once storage is healed; no
shared-module extraction (C-18/YAGNI — only trading needs multi-namespace).

**Part B — Migration 029: heal storage to full-dotted + preserve prod bracket protection.**
`services/xstockstrat-config/migrations/029_heal_config_keys_full_dotted.{up,down}.sql` (next number = 029,
recon Dependencies). UP: one guarded blanket heal
`UPDATE config.config_values SET key = namespace||'.'||key WHERE key NOT LIKE namespace||'.%' AND is_secret=false AND namespace IN ('platform','trading','portfolio','marketdata')`
— the `NOT LIKE` guard skips already-dotted rows (no double-prefix; e.g. dotted `marketdata.*`), `is_secret=false`
leaves the `GetSecret` vendor-credential rows untouched (recon § marketdata; @AC-6/@AC-7 safe). Then a
**deterministic** bracket bump: `UPDATE ... SET value_data='true' WHERE namespace='trading' AND
key='trading.risk.bracket_orders_enabled' AND environment='production' AND user_id IS NULL` (literal, not
copy-from-staging; retry-idempotent). No explicit `BEGIN/COMMIT` (matches 002/013/017; rely on golang-migrate
atomicity). `value_type` is never touched (fails.md:344-346). **DOWN is forward-only-safe** — see Open Risks:
it must not silently over-strip pre-dotted `@AC-13`/@feature-184 rows, so it ships as an explicit
no-op/guarded refusal (rollback = redeploy the prior image), or an enumerated exact-inverse strip once the
per-row DB audit runs at /sdd-spec.

**Part C — Three-part atomic key-rename edit set (lockstep with 029).**
Since the `platform.trading_state` row's `key` becomes full-dotted, three writers/validators move together
or the kill-switch write path breaks: (1) `escalateSystemic` writer `Key:"trading_state"`→`"platform.trading_state"`
(`services/xstockstrat-trading/internal/service/trading.go:1905`); (2) config internal-caller allowlist grant
`key:'trading_state'`→`'platform.trading_state'` (`services/xstockstrat-config/src/grpc/authz.ts:70`);
(3) `SetConfig` enum-validation guard `namespace==='platform' && key==='trading_state'`→`key==='platform.trading_state'`
(`services/xstockstrat-config/src/grpc/configServiceImpl.ts:397`) — else the ACTIVE/REDUCE_ONLY/HALTED
enum validation silently stops running post-rename. config-ui/agent writers are data-driven off `ListKeys`
(returns the stored key) → no change (smoke-check only).

**Part D — Consumer surface (C-14): the `/trader` frontend reader + its e2e.**
The rename changes the key the server serves to **every** reader. The `/trader/positions` page reads the
**bare** key `resp.values['trading_state']` (`services/xstockstrat-ui/src/app/trader/positions/page.tsx:120-121`)
from `getConfig({namespace:'platform'})`; after 029 that lookup returns `undefined` and the platform-wide
restriction banner silently goes dark (the mirror of the Go bug). This is the C-14 consumer surface: change
`page.tsx:120-121` → `values['platform.trading_state']`, and update the e2e fixtures/specs keyed on the bare
form so the regression fails RED with the post-029 shape (C-12/C-13, fails.md:2005): `e2e/fixtures/configKeys.ts`,
`e2e/mock-backend.ts`, `e2e/trader/positions-reconciliation.spec.ts` (the three config-ui specs that reference
`trading_state` — `value-persists-after-save`, `reason-capture`, `audit` — to be re-audited at /sdd-spec for
whether they assert the bare key). `page.tsx:120-121` is the **only** runtime bare-key reader in ui/agent
(verified sweep). Docs: `services/xstockstrat-trading/CLAUDE.md` — remove the false "all config values served
by namespace `trading`" line, update the `platform.trading_state`/`bracket_orders_enabled` rows.

**Honored production-delta ledger (safety-positive activations, recorded per operator sign-off).** Healing
storage makes previously-dead seeds resolve; the operator chose to HONOR the conservative production seeds
(all tighten toward safety) and OVERRIDE bracket:

| Key (full-dotted, post-029) | Prod seed (mig 002 `live`) | Go default | Direction | Action |
|---|---|---|---|---|
| `trading.approval.require_above_qty` | 100 | 500 | approval sooner | HONOR seed |
| `trading.approval.require_above_notional` | 10000 | 50000 | approval sooner | HONOR seed |
| `trading.risk.max_position_pct` | 0.02 | 0.05 | tighter warn (warn-only) | HONOR seed |
| `trading.risk.daily_loss_limit` | 0.01 live / 0.02 paper | 0.02 | dormant? | HONOR; **verify no reader at /sdd-spec** |
| `trading.risk.bracket_orders_enabled` | false (mig 013 prod) | true | would turn protection OFF | **OVERRIDE → true (029)** |

Staging (=paper) seeds match the Go defaults for these keys → **no staging behavior change**; every delta is
production-only.

---

## Rejected Alternatives

- **Watcher idempotent-prefix (Layer B in the watcher)** — rejected: leaves config DB storage in the
  namespace-relative form (does not advance the @feature-184 full-dotted-storage contract), re-derives the
  prefix in three copied watchers, and is fragile against a namespace with mixed formats. (Operator chose the
  data-migration path to heal the source of truth once.)
- **Reader alignment / getters→bare (B-read)** — rejected: re-keys ~28 trading + portfolio + marketdata
  getters *and* the frontend reader to bare, and re-keying the config snapshot to bare is a **CHANGE** to the
  @feature-184 `@AC-1` / @feature-147 `@AC-2`/`@AC-13` full-dotted contract needing separate sign-off.
- **Server-side namespace-folding** (config emits `${namespace}.${key}` for all consumers) — rejected: widens
  the snapshot contract for every Node/Python consumer and risks the redaction/overlay edges (@AC-2/@AC-13); and
  it still doesn't deliver `platform.*` to trading (delivery is orthogonal to key format).
- **Server-side shared `platform` namespace merged into every subscription** (delivery alternative to the 2nd
  stream) — rejected: broadens portfolio/marketdata snapshots with keys they don't read; the trading-only
  second stream is the localized C-18 choice.
- **Shared Go config module** across the three watchers — rejected: YAGNI/C-18 for a bug fix (only trading
  needs multi-namespace; the per-service copy stays).

---

## Open Risks

- [ ] **DOWN migration reversibility (highest).** A symmetric prefix-strip DOWN cannot distinguish rows 029
  healed (bare→dotted) from rows already dotted pre-029 (`portfolio.watchlist.*` @AC-13, dotted `marketdata.*`),
  so a prod `migrate down` would re-break them (CONFIG-9 miss, kill-switch re-darkened). **Decision required at
  /sdd-spec**: ship an explicit forward-only DOWN (documented no-op/guarded refusal; rollback = redeploy prior
  image) — authorable now without the blocked DB audit — OR an enumerated exact-inverse strip once the per-row
  audit yields the healed-key list (C-01/P-03 — do not invent the list). Prefer the no-op now, upgrade if the
  audit lands. — target: /sdd-spec migration step.
- [ ] **Per-row DB audit still blocked** (postgres-mcp co-process flaky). /sdd-spec must run
  `SELECT namespace,key,is_secret FROM config.config_values WHERE namespace IN ('platform','trading','portfolio','marketdata')`
  to (a) confirm no non-secret `marketdata.*`/`portfolio.*` row is already full-dotted in a way the DOWN would
  over-revert, and (b) supply any enumerated DOWN list. The guarded blanket UP is safe regardless (skips dotted +
  secrets). — target: /sdd-spec.
- [ ] **`trading.risk.daily_loss_limit` reader unconfirmed** — recon getter enumeration does not list it; grep to
  confirm it is dormant (behavior-neutral) or record the honored delta. — target: /sdd-spec.
- [ ] **Deploy sequencing / window** (order: migrate 029 → deploy config authz+enum → deploy trading). The old
  trading binary firing `escalateSystemic` with bare `Key:"trading_state"` during the window is **refused**
  (PERMISSION_DENIED on the new allowlist, or NOT_FOUND via the existence gate, no `create_key`) — no stray row;
  the residual is that a systemic auto-escalation may no-op during the window, but its `EmitAlert` (`trading.go:1915`)
  still pages a human (fail-safe). Keep config→trading tight; correct the deploy note (more fail-safe than the
  round-2 draft claimed). golang-migrate leaves 029 "dirty" on failure (manual `force`); the `NOT LIKE`
  idempotency only aids a manual re-run. — target: /sdd-spec + PR description.
- [ ] **Concurrency invariants (spec constraints).** The `delete(prefix)+insert` must be one `w.mu.Lock()` section
  (no reader observes a gap); the two goroutines touch disjoint prefixes (`platform.` vs `trading.`), no
  cross-clobber; the `pending`-set delete + emptiness check + `close(ready)` must be atomic under a lock (not just
  `closeOnce` — to avoid a missed close). — target: /sdd-execute step + tests.
- [ ] **Full bare-key reader re-audit** — `page.tsx:120-121` is the only runtime bare reader found across
  ui/agent; re-confirm at /sdd-spec that no other consumer of the four rekeyed namespaces reads a bare key. —
  target: /sdd-spec.

---

## Constitution Rules Touched

- `F-01` — honored: 029 is a new numbered migration; the bracket bump and DOWN restore live in 029's own files,
  never an edit to applied 002/013.
- `F-06` — honored: the extra `platform` WatchConfig stream is a gRPC subscription, not a direct DB pool slot;
  connection budget untouched.
- `F-07` — honored: 029 changes config **data** (`key`/`value_data`), not source; services still read via
  WatchConfig.
- `C-01`/`F-04` — honored: every path:line is grounded in recon/discovery; the DOWN enumerated-list and the
  daily_loss_limit reader are left to the /sdd-spec DB audit rather than invented (P-03).
- `C-08`/`P-06` — honored: per-artifact RED-before-green tests, sequenced so RED fails on behavior (multi-namespace
  delivery absent / scoped-replace clobber / bare-key UI reader) not on the signature change; fixtures use the
  server-shaped (post-029 full-dotted) key form (fails.md:2005/1650 anti-vacuous-green).
- `C-10`/`C-14` — honored: the consumer surface (`/trader/positions` banner) is in the atomic edit set + e2e
  (Part D); `xstockstrat-ui` is an affected service, not left stale.
- `C-12`/`C-13` — honored: e2e fixtures (`configKeys.ts`, `mock-backend.ts`) updated to the post-029 shape in the
  same change.
- `C-18` — honored: minimum footprint (only trading's watcher gains multi-namespace; no shared-module extraction;
  no getter re-keying); the migration heals the source of truth once rather than re-deriving in three watchers.
- `P-03`/`P-04`/`P-05` — honored: ambiguities (DB audit, DOWN list, daily_loss reader) surfaced as Open Risks with
  target steps, not guessed; phase gates recorded; context.md updated as decisions land.
- Ledger: `fails.md:344-346` (value_type immutable — not repeated), `fails.md:2005-2016` (bare-vs-full key seam —
  the frontend-reader finding is its analogue; fixtures use the split/DB form), `fails.md:1215-1217` (trading_state
  is `string`, read via GetString), `fails.md:1287-1289` (WatchConfig reads `value_data` — untouched).

## Business Rules Touched (C-16)

- PRESERVE `@AC-12` "config resolves full-dotted `platform.trading_state`→HALTED per environment"
  (`services/xstockstrat-config/acceptance/config-secrets-and-scoping.feature`) — not regressed: it seeds its own
  full-dotted fixture; 029 aligns storage the same way.
- PRESERVE `@AC-13` "per-user overlay resolves full-dotted `portfolio.watchlist.max_per_user`" (same suite) — not
  regressed on the forward path (029 heals it to full-dotted); the migration round-trip test asserts the per-user
  overlay survives up→down (the DOWN over-strip risk is the Open Risk above).
- PRESERVE `@AC-2` "WatchConfig never streams secret plaintext" (same suite) — not regressed: `is_secret=true`
  rows excluded from 029; redaction path untouched.
- PRESERVE `@AC-10` "WatchConfigRequest carries environment, no trading_mode" — not regressed: request shape
  unchanged; the second stream uses the same request.
- PRESERVE `@AC-1` "`config.config_values.key` holds the full dotted form" (`opportunity-config-operability.feature`,
  @feature-184) — **satisfied/strengthened**: 029 brings the deviating rows into the full-dotted contract.
- PRESERVE `@AC-1` "drawdown breach alerts from live `portfolio.risk.max_drawdown_pct`" (@feature-172) — restored
  from the silent-default fallback by healing storage.
- PRESERVE `@AC-2` "higher confidence → larger auto-sized position, reading `trading.risk.*`" (@feature-110) —
  monotonicity survives; absolute inputs now resolve live (honored-delta ledger).
- PRESERVE `@AC-6`/`@AC-7` "marketdata resolves vendor creds via GetSecret" (@feature-147) — separate path;
  excluded from 029.
- PRESERVE `@AC-1` "dead getEnvBool gone from Go config packages" (`platform.feature`, @feature-175) — the watcher
  edit must stay green and not reintroduce it.
- CHANGE (operator sign-off) — production `trading.risk.bracket_orders_enabled` false→true reverses feature 030's
  deliberate "false pending feature 103" decision. Signed off by user @ 2026-09-15 (recorded in context.md). The
  honored conservative prod deltas (approval/max_position tightening) are likewise a recorded, operator-approved
  activation of the @feature-002 intended production limits.
