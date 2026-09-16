# Context: fix-trading-config-key-mismatch  (archived 2026-09-16)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-09-16 — /sdd-archiver

**What**: A SEV-1 "trading halted" staging outage root-caused to TWO orthogonal config faults: (1) the trading watcher subscribed to only its own `trading` namespace, so every `platform` broadcast reached `subscribers=0` and `platform.trading_state` never arrived; (2) deviating seed rows were stored namespace-relative (`trading_state`) while consumers read full-dotted (`platform.trading_state`), violating CONFIG-9. The fix healed storage to full-dotted via config migration 029, gave trading a second `platform` WatchConfig stream with a namespace-scoped snapshot replace, and carried the key rename through every writer/validator/reader in lockstep. Shipped as feature-dir **192** but every internal artifact and the shipped service docs call it **"189"** (see scar).

**Why (irrecoverable rationale)**:
- The bug had been silently defaulting *all* `trading.*` reads the whole time; it became visible only on `platform.trading_state` because that is the single key whose code default (`HALTED`) diverges from its intended seed (`ACTIVE`) — every other key's default happened to equal its seed, so the mismatch was invisible.
- Routed to Track C (SDD, off `main-dev`) rather than the mechanical SEV-1 → Track A hotfix (off `main`), by explicit user decision: the failure mode is fail-safe (orders blocked, never wrongly executed → an outage, not financial bleed), the fix is systemic/cross-service warranting a design debate, and Track A off `main` would violate the harness branch mandate.

**Rejected alternatives**:
- Watcher idempotent-prefix — lost: leaves DB storage bare (doesn't advance the full-dotted contract), re-derives the prefix in three copied watchers, and would double-prefix + corrupt already-dotted keys (namespaces hold mixed formats).
- Reader alignment (getters → bare) — lost: re-keys ~28 getters AND is a CHANGE to the feature-147/184 full-dotted storage contract needing separate sign-off.
- Server-side key-format namespace-folding (config emits `${ns}.${key}` to all consumers) — lost: widens the snapshot contract for every consumer, risks redaction/overlay edges, and still doesn't *deliver* `platform.*` to trading.
- Delivery-side server-merge (fold the `platform` namespace into EVERY consumer's subscription) — lost: broadens portfolio/marketdata snapshots with keys they don't read; the trading-only second stream is the localized C-18 choice.
- Shared Go config module across the three watchers — lost: YAGNI/C-18 for a bug fix; only trading needs multi-namespace.

**Scars & gotchas**:
- **Feature-number drift (189 vs 192)** — every internal artifact and the *shipped* `services/xstockstrat-trading/CLAUDE.md` + migration `029_..down.sql` comment refer to this feature as "189". Grepping `feature 192` for the bracket-override rationale finds nothing; grepping `189` lands on the wrong feature. A renumber-on-collision whose "189" references were not all rewritten.
- **DOWN migration forced forward-only (`SELECT 1;` no-op)** — the per-row DB audit needed to author an exact-inverse DOWN was blocked (postgres-mcp co-process unavailable at recon+spec time); a symmetric prefix-strip can't distinguish rows 029 healed from rows already dotted pre-029 (`portfolio.watchlist.*` @AC-13), so it would re-break CONFIG-9. Rollback = redeploy the prior image.
- **The read-path test gap was the exact hole the bug slipped through** — trading's `config_test.go` `fakeConfigServiceClient.WatchConfig` just `panic`ed, so no test ever exercised a getter against a populated snapshot. The RED test deliberately uses full-dotted *server-shaped* fixtures (a bare-key override fixture would mask exactly this class of bug). (Ledgered.)
- **Deploy window is fail-safe** — order: migrate 029 → deploy config (authz+enum rename) → deploy trading. An old trading binary firing `escalateSystemic` with the bare `Key:"trading_state"` mid-window is refused (PERMISSION_DENIED on the renamed allowlist / NOT_FOUND via the existence gate); its `EmitAlert` still pages a human.
- **SNAPSHOT/RELOAD is a namespace-scoped delete-prefix+insert, not a verbatim `w.snapshot = snap.Values` replace** — because a `trading`-stream RELOAD (fires on any `trading.*` SetConfig) would otherwise wipe `platform.*` and cause a transient false `HALTED`.
- **Spec under-scoped the rename's own regression test** — `trading_reconciliation_test.go` asserted the bare writer key, was not in any step's Files list, and broke on the writer rename (`platform.platform.trading_state`); fixed as a Step 3 deviation. (Ledgered.)
- **e2e structural-RED** — the reduce-only banner Playwright e2e could not run locally (host `next dev` SSR-warmup budget; Docker build impractical); RED verified structurally, authoritative gate deferred to CI (PR #1141). Same class as the golangci-lint 2.5.0 (go1.25) refusing a go1.27 target → local fell back to `go vet`; CI's pinned 2.13.1 is authoritative.

**Permanent deviations**:
- Production `trading.risk.bracket_orders_enabled` false → true, reversing feature-030's deliberate "false pending feature 103" — explicit user sign-off recorded per C-16; honoring the seed would have turned bracket protection OFF.
- Healing storage silently reactivated ALL dormant production seeds, not just bracket: `approval.require_above_qty` 500→100, `require_above_notional` 50000→10000, `max_position_pct` 0.05→0.02 (migration 002 `live` rows that had never resolved). Operator chose to HONOR these (all tighten toward safety). Staging (=paper) seeds already matched the Go defaults, so every delta is production-only.

**Cross-feature signal**:
- The identical watcher (`internal/config/config.go`) is copy-pasted across trading/portfolio/marketdata with no shared module; the same latent silent-default fault lived in all three and was fixed only in trading — portfolio/marketdata were healed by migration 029 alone (no code change) because they read no `platform.*` key. The copy-paste watcher is the recurrence vector. (Ledgered.)
- feature-172 drawdown enforcement (`portfolio.risk.max_drawdown_pct`) and feature-110 position sizing (`trading.risk.*`) were silently running on their CODE DEFAULTS in production pre-029 (bare-key storage never resolved through the full-dotted read path); migration 029 RESTORES them to their intended seed values as a pure side effect with NO code change in those services. A future agent debugging a behavior shift at the 029 deploy with no code diff in portfolio/trading needs this.

**Deferred follow-ons**:
- C-16 scenario promotion was DEFERRED by operator at launch ("skip promotion, just finalize PR"). **Closed at archive time** — the three `@AC-*` regression scenarios are now promoted to `services/xstockstrat-trading/acceptance/fix-trading-config-key-mismatch.feature` (`@feature-192`) by this /sdd-archiver run.
- DOWN migration should be upgraded to an enumerated exact-inverse strip if/when a per-row DB audit becomes runnable (postgres-mcp restored).
- Post-deploy smoke owed: confirm no unintended `portfolio.*`/`marketdata.*` production behavior regressed from the dormant-seed activation (UP-side blast radius shipped unverified — audit was blocked).

**Ledger entries written**: insights.md (0), fails.md (4) — see the 2026-09-16 entries. (Both insight candidates — namespace-scoped snapshot replace + per-namespace readiness, and the config-key-rename atomic-edit-set rule — were already captured by the design-trap entry at fails.md:2257 and were not re-appended.)
**Runtime-invariant recommendations (→ /context-constitution)**: TRADING-* candidate — xstockstrat-trading subscribes to TWO config namespaces (`trading` + `platform`); the kill-switch/maintenance keys (`platform.trading_state`, `platform.maintenance_mode`) live under `platform`, not `trading`. CONFIG-* candidate — storage is now uniformly full-dotted across `platform/trading/portfolio/marketdata` non-secret rows (migration 029); `is_secret=true` vendor-credential rows stay namespace-relative because the `GetSecret` path sends `Namespace`+`Key` separately; a future blanket key operation must preserve that split.
**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 594ea7e.
