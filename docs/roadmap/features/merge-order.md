# Feature Merge Order

Tracks inter-feature merge dependencies. A feature listed in the **Feature** column
cannot open its final integration PR to `main-dev` until the feature in the
**Must wait for** column has been merged and reached `launched` status.

**Maintained by:**
- `/sdd-review` — auto-proposes entries when overlap detection finds a FAIL-level conflict
  (migration number collision, proto field number collision, duplicate config key). Always
  asks for user confirmation before writing.
- Developers — manual entries when architectural ordering is known before conflicts arise.

---

## Blocking Dependencies

| Feature | Must wait for | Reason | Resolved |
|---|---|---|---|
| `broker-accounts-ui` | `add-ikbr-account-support` | Consumes proto stubs and backend RPCs (`ListBrokerAccounts`, `ListPortfolios`, `RegisterBrokerAccount`, `DeregisterBrokerAccount`) defined by that feature | Yes |
| `strategy-engine` | `agent-mcp-server` | Steps 8–11 modify `client.py`, `tools.py`, `test_client.py`, `test_tools.py` — all four are **created** by `agent-mcp-server` (feature 009); they must exist before strategy-engine modifies them | Yes |
| `live-strategy-alert-engine` | `strategy-engine` | Hard dependency: requires `StrategyDefinition` model, `analysis.strategies` table, and `StrategyEvaluator` module delivered by `strategy-engine` (feature 047) | No |
| `strategy-creation-flow` | `formula-management-ui` | Consumes `ListFormulas` RPC from `xstockstrat-indicators` (feature 003); formula picker in the component editor depends on this RPC existing in generated stubs | Yes |
| `strategy-creation-flow` | `strategy-engine` | Consumes `ManageStrategy`, `GetStrategy`, `ListStrategyDefinitions`, and `SetStrategyLive` RPCs from `xstockstrat-analysis` (feature 047); all strategy authoring and live toggle RPCs must exist before the UI can call them | Yes |
| `strategy-creation-flow` | `live-strategy-alert-engine` | FR-5 live evaluation toggle calls `SetStrategyLive` and reads `live_enabled` column on `analysis.strategies` — both introduced by feature 048 | Yes |

---

## How to add an entry manually

1. Add a row to the table above.
2. Set **Resolved** to `No` while the blocking feature is still in-flight.
3. Update **Resolved** to `Yes` once the blocking feature is `launched` (merged to `main-dev`
   and deployed). You may then also remove the row — it serves no further purpose.

## How `/sdd-execute` uses this file

Before creating the **final integration PR** (feature branch → `main-dev`), `/sdd-execute`
reads this file. If the current feature appears in the Feature column and the blocking feature
has not yet reached `launched` status, it warns the user and asks for confirmation before
proceeding with the PR.

Per-step PRs (step branch → feature branch) are not affected by this file.
