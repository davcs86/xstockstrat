# Context: spec-hygiene-guards

**Feature**: `docs/roadmap/features/298-spec-hygiene-guards/feature.md`
**Product Spec**: `docs/roadmap/features/298-spec-hygiene-guards/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/298-spec-hygiene-guards/implementation-spec.md`

---

## Session 2026-11-05 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from the PR #657 delta.
- Number reserved by `scripts/sdd-allocate-feature-number.sh` → **298** (297 was already reserved on the cursor).
- Operator scope decisions (AskUserQuestion): scope = D1 + D2 + D3; existing duplicate NNN = renumber only the non-launched side, allowlist the launched pairs; slug `spec-hygiene-guards`.
- Verified against `main-dev` `b371a3e` (PR head `4ea94ea`, base `main`, branch `claude/specs-implementation-gaps-l5o3jc`, 3 files, never merged).

### PR #657 disposition (finding → state on `main-dev` → where it lives now)

| PR finding | Current state | Disposition |
|---|---|---|
| GAP-1 `alpaca-default` seed (001 FR-6) | Owner: obsolete. 001 spec pruned (only `context.md`/`feature.md`/`status.md` remain) | Closed. Residual literal fallbacks → **FR-5** |
| GAP-2 `agent.oauth.*` unseeded | Still unseeded in `services/xstockstrat-config/migrations/` (001-037). PR's `006` migration is obsolete: `trading_mode` column removed by feature 147 | Owned by **295** (`implementation-ready`, parity gate lists agent `oauth.*`); defect `2026-10-29-agent-dcr-fail-closed-defect` still `open` |
| GAP-3 `OTEL_SERVICE_NAME` | 0 hits in `.do/app*.yaml`; `SERVICE_NAME` set (12 each). 015 archive synthesis records the `SERVICE_NAME` rename | Closed |
| DIV-1/S-5 (038 GHCR) | 038 spec pruned; `docker-build.yml` reusable workflow is the live design | Closed |
| DIV-2/S-4 (009 webhooks) | 009 spec pruned; `docs/runbooks/mcp-tools.md` has no webhook/`x-mcp-secret` text | Closed |
| S-1 phases 0/2 "Pending" | Root `CLAUDE.md` says phases 0-7 DONE | Closed |
| S-2 "All services → ledger/notify" | **Still present** at root `CLAUDE.md` ~L325-326 | **FR-4** |
| S-3 agent not subscribing | Still true today; 295 makes the agent subscribe | Resolved by 295, no edit now |
| S-6 033 `code-completed` | 033 is `launched` | Closed |
| 005/006 → 045 nginx | Consistent | Closed |
| Dup numbers 020/052 | Resolved (renumbered to 042/058 per runbook) but **9 new pairs exist** (058, 064, 065, 097, 111, 140, 149, 153, 169; 169 has three dirs) and no gate | **FR-1..FR-3** |
| "Active Features" table lists 001/004 only | Table no longer exists in root `CLAUDE.md` | Closed |

### Evidence for FR-4 (verify again at design time)

- `AppendEvent` callers outside tests: trading, portfolio, marketdata, indicators, ingest, analysis, identity; none in config, agent, notify.
- `EmitAlert` callers outside tests: trading (`trading.go`), portfolio (`portfolio_service.go`), marketdata (`marketdata_service.go`), ingest (`handlers/servicer.py`), analysis (`fundsignal_loop.py`, `live_loop.py`), agent (`client.py`, `tools.py`); notify is the server.

### Evidence for FR-5

- `services/xstockstrat-portfolio/internal/service/portfolio_service.go:333` `acctID = "alpaca-default"` when `fill.AccountId == ""`.
- `services/xstockstrat-analysis/app/engine/pnl_pattern_consumer.py:334` and `:406` `payload.get("account_id", "") or "alpaca-default"`.
- `grep -rn "EnsureAlpacaDefault\|alpaca-default" services/xstockstrat-trading/internal services/xstockstrat-trading/cmd` is empty: nothing creates a broker row with that id. The only other hits are the inert column `DEFAULT`s in trading `003` and portfolio `003`, and UI e2e fixtures.

### Next

Resolve OQ-1..OQ-4, then `/sdd-review spec-hygiene-guards product-spec`. Note for the design phase: this feature is mandatory-SDD per root `CLAUDE.md`; FR-4 is docs-only but is bundled so one PR carries the whole PR #657 delta.
