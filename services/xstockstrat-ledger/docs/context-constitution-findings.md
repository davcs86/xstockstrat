# xstockstrat-ledger — Constitution Findings

Defects and drift surfaced by `/context-constitution` on 2026-07-24. For triage/fixing, not
governance. Repeated defects (dead `middleware/propagation.ts`, Node-20 drift) live in the root
findings log.

## Documentation that lies (docs claim behavior the code lacks)

| What the docs say | What the code does | Evidence | Suggested action |
|---|---|---|---|
| CLAUDE.md: immutability "enforced via PostgreSQL rules (`NO UPDATE`/`NO DELETE`)" | Rules aren't supported on hypertables; enforced via `deny_mutation` **triggers** | `CLAUDE.md:5` vs `migrations/001_…up.sql:26,46-60` | ✓ **RESOLVED** (2026-08-02 refresh) — CLAUDE.md:9,32 now say immutability is "enforced via PostgreSQL **triggers**, `deny_mutation`" |

## Latent bugs (looks broken, not merely non-obvious)

| Issue | Impact | Evidence |
|---|---|---|
| Large-payload events (>~7000 chars) streamed live arrive as a **trimmed stub** with `payload=undefined` and `occurredAt=new Date(undefined)` → Invalid Date; replay/query of the same event is correct | Live-tail consumers of big events get silently corrupt rows | `migrations/001_…up.sql:71-80`, `ledgerServiceImpl.ts:304-316` |

## Dead / orphaned code

| What | Why it looks dead | Evidence |
|---|---|---|
| 3 documented config keys (`ledger.stream.notify_enabled`, `ledger.retention.years`, `ledger.compression.after_days`) | Read by no code; `ConfigWatcher` is a startup gate only. `ledger.stream.notify_enabled=false` is a no-op (the DB trigger fires unconditionally). **Reframed 2026-08-09** — no longer a "docs that lie" issue: CLAUDE.md's Config Keys table already says "Documented, not yet enforced/implemented — no code reads it" for all three (fixed by commit `06e451c`); the underlying dead-key gap is unchanged. | `CLAUDE.md:62-67` vs `src/` (grep zero), `migrations/001_…up.sql:87-89` — action: wire or delete the keys |
| `package.json`'s `migrate` npm script (`node-pg-migrate up`) | Migration files use the golang-migrate `NNN_*.up/.down.sql` convention driven by `scripts/db-migrate.sh`; `node-pg-migrate` has no config here and would not apply them. **Reframed 2026-08-09** — no longer a "docs mismatch": CLAUDE.md's Running Locally section already tells the reader to run `../../scripts/db-migrate.sh` (golang-migrate), so nobody is currently pointed at the broken script — it's just a dead leftover. | `package.json:11` vs `CLAUDE.md` (Running Locally section) — action: delete the dead `migrate` script |

## Open questions (unresolved *why* — needs a maintainer)

- The NOTIFY 8KB-trim path vs the live-tail stub it produces — is the truncated live event intended (consumers expected to re-`GetEvent` on a partial row), or should `StreamEvents` re-fetch the full row before `call.write` when the NOTIFY payload was trimmed? `migrations/001_…up.sql:71-80`, `ledgerServiceImpl.ts:304-316` — status: **open**

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins). Defects to action, not rules. Re-run `/context-constitution` to refresh._
