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

_No blocking dependencies registered. If `/sdd-review` detects a hard conflict between
two active features, it will propose adding a row here._

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
