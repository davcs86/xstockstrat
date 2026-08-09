# xstockstrat-analysis — Constitution Findings

Defects and drift surfaced by `/context-constitution` on 2026-07-24. For triage/fixing, not
governance. The config zero-trap fix and the internal admin-scope-injection security question are
recorded at the root (they are cross-cutting).

## Latent bugs (looks broken, not merely non-obvious)

| Issue | Impact | Evidence |
|---|---|---|
| **`ConfigWatcher` carries indicators identity**: module docstring "Config watcher for xstockstrat-**indicators**" and `client_id=f"indicators-{id(self)}"` | analysis registers with the config service under an "indicators-…" client id (copy-paste from the indicators template) | `app/config/watcher.py:2` (docstring), `:61` (`client_id`) |

## Open questions (unresolved *why* — needs a maintainer)

- ⚠ **security** — The fundamentals background loop injects `x-access-scope=4` (admin bit) into its own outbound metadata; the admin check is `int(x-access-scope) & 0x04`. Is a background loop self-granting the admin bit the intended trust model? (Cross-cutting with the MCP agent's hardcoded `x-access-scope=7`; tracked in the root findings log.) `app/engine/fundsignal_loop.py:346`, `servicer.py:190-202` — status: **open**

> Note: the "all-None custom formula on staging" bug (PR #769/#773) is **resolved** by feature 067 —
> `evaluator.py:210-247` now uses `MessageToDict` (recursive `ListValue` decode). Not an open defect.

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins). Defects to action, not rules. Re-run `/context-constitution` to refresh._
