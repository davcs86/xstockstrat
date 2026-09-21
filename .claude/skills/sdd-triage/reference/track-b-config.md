# sdd-triage — Track B (Config-Only Fix)

Loaded by the router when the triage flow routes to **Track B**. Follow it end to end, then stop.

### B-1. Identify config key

Read the issue body for any mentioned config keys (pattern: `<service>.<category>.<key>`).
If none found, ask: "Which config key needs to be changed? (format: service.category.key)"

### B-2. Print the fix command

Read `docs/runbooks/config-rollout.md` to confirm the SetConfig procedure.

Print:
```
Config-only fix identified.
  Key: <config-key>
  Current value (from issue): <value if mentioned, otherwise "unknown">
  Recommended action: update via config-ui at http://localhost:3002
    or use the SetConfig RPC directly.

See docs/runbooks/config-rollout.md for the full rollout and rollback procedure.
```

### B-3. Ask for confirmation

Ask: "Has the config change been applied and verified? (yes / no)"

If yes: proceed to B-4.
If no: print "Apply the config change, verify propagation in service logs, then confirm."
  Stop — do not continue.

### B-4. Close the GitHub issue

```bash
gh issue close $ARGUMENTS[0] \
  --comment "Resolved via config-only fix. Changed \`<config-key>\` to correct value. No code deploy needed — WatchConfig propagated the change to all services."
```

Print:
```
Config-only fix complete.
  GitHub issue #<number>: closed
  No branch, no PR, no CI run.
```

Stop — do not continue.
