# sdd-triage — Track A (Hotfix)

Loaded by the router when the triage flow routes to **Track A**. Follow it end to end, then stop.

### A-1. Maintenance mode reminder (SEV-1 only)

If severity is SEV-1, print immediately:
```
⚠ SEV-1 detected. If live trading is at risk, set maintenance mode NOW before continuing:
  Config key: platform.maintenance_mode = true
  Via config-ui: http://localhost:3002
  This halts all trading via WatchConfig with no service restart.
```

Ask: "Has maintenance mode been applied (or confirmed not needed)? (yes / skip)"
Wait for response before continuing.

### A-2. Create hotfix branch

```bash
git fetch origin main
git checkout main
git pull origin main
git checkout -b hotfix/<slug>
```

Print: "Branch `hotfix/<slug>` created from `main`."

### A-3. Append to hotfix-log.md

Read `docs/runbooks/hotfix-log.md`. Prepend a new entry immediately after the
`<!-- New entries are prepended below this line -->` comment:

```markdown
## <ISO-8601 timestamp> — hotfix/<slug>

- **GitHub issue**: <url>
- **Severity**: <SEV-N>
- **Affected service(s)**: <extracted from issue body>
- **Root cause**: <extracted from issue root cause hypothesis, or "under investigation">
- **Fix summary**: _pending_
- **PR**: _pending_
- **Platform-lead approver**: _pending_
- **Back-merge commit**: _pending_
- **Maintenance mode applied**: <yes | no>
- **Status**: in-progress
```

Write the file back.

### A-4. Print next steps

```
Hotfix setup complete.
  Branch: hotfix/<slug>
  hotfix-log.md: entry added (Status: in-progress)

Next steps:
  1. Write the fix on branch hotfix/<slug>
  2. Commit your changes
  3. Push: git push -u origin hotfix/<slug>
  4. Open a PR using the hotfix template:
       gh pr create --base main --head hotfix/<slug> \
         --title "Hotfix: <title>" \
         --template .github/PULL_REQUEST_TEMPLATE/hotfix.md
  5. Get platform-lead approval and merge
  6. After merge, run: /sdd-triage <issue-number> backmerge
```

Stop — do not continue.
