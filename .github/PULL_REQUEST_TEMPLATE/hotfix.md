## Hotfix: <!-- short description -->

**GitHub issue:** <!-- URL -->
**Hotfix branch:** `hotfix/<!-- slug -->`
**Affected service(s):** <!-- list -->

---

## Root cause

<!-- One sentence: what was wrong and why it happened -->

## Fix summary

<!-- One sentence: what was changed to resolve it -->

## Financial impact assessment

<!-- Was live trading affected? Were any incorrect orders placed? Any P&L impact? -->

---

## Pre-merge checklist

- [ ] `platform.maintenance_mode = true` was set before investigation (SEV-1 only)
- [ ] Root cause identified and documented above
- [ ] Fix is minimal — scoped only to the reported bug, no refactoring
- [ ] Verification command run and passed (document output below)
- [ ] Platform lead has reviewed and approved this PR
- [ ] Back-merge into `main-dev` is planned immediately after merge (do not delay)

## Verification

<!-- Paste the command and its output that confirms the fix works -->

```
$ <command>
<output>
```

---

## Post-merge steps (for merger to complete)

1. Clear maintenance mode if set: `platform.maintenance_mode = false`
2. Confirm the automatic `main` → `main-dev` sync (`sync-main-to-maindev.yml`) landed — or merge its
   `sync/main-into-main-dev` conflict PR with **Create a merge commit**. Never push `main-dev` directly.
3. Run `/sdd-triage <!-- issue-number or --from-report path --> backmerge`: it updates
   `docs/runbooks/hotfix-log.md` (`Status` → `deployed`, back-merge SHA) through a PR.
4. Close the GitHub issue with a comment linking this PR.

---

> **Merge strategy:** This PR targets `main` — use **"Create a merge commit"**, never squash.
> Squashing breaks git ancestry between `main` and `main-dev`.
