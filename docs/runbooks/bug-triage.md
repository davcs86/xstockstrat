# Bug Triage Runbook

Defines how bug reports enter the xstockstrat workflow, how to classify severity, and which
process path each severity takes.

---

## Quick-Start: Which Track?

Read this table first. If any condition in a row matches, use that track.

| Condition | Track | Entry command |
|---|---|---|
| Live trading broken, wrong orders executing, or financial loss occurring | **A — Hotfix** | `/sdd-triage <issue-number>` |
| Bug confirmed in `main` (production) but trading is functioning normally | **A — Hotfix** | `/sdd-triage <issue-number>` |
| Bug is a misconfigured value (wrong threshold, wrong flag, wrong timeout) | **B — Config-only** | `/sdd-triage <issue-number>` |
| Bug only in `main-dev` (dev environment) or local dev | **C — SDD path** | `/sdd-triage <issue-number>` |
| Bug found via test failure, code review, or static analysis | **C — SDD path** | `/sdd-triage <issue-number>` |

The `/sdd-triage` skill reads the GitHub issue and routes automatically. Use this table when
running triage manually or when the skill is unavailable.

---

## Severity Definitions

### SEV-1 — Critical

Live trading is impaired or financial integrity is at risk.

Indicators (any one is sufficient):
- Orders not executing or executing incorrectly on the live Alpaca API
- Portfolio P&L calculation is wrong and may have driven a trade decision
- Order approval flow is bypassed or stuck — orders hanging indefinitely
- Authentication failure blocking all API access
- Data corruption in the ledger (append-only event store)

**First action before anything else:**
```bash
# Halt all trading via WatchConfig — takes effect within one stream cycle, no restart needed
# Set via config-ui at http://localhost:3002 or directly via the config service RPC
platform.maintenance_mode = true
```

Then open a GitHub issue using the bug report template and run `/sdd-triage <issue-number>`.

### SEV-2 — High

Wrong behavior with potential financial impact in a future trade cycle, but trading is not
currently impaired.

Indicators:
- Indicator formula produces incorrect output that would affect strategy scoring
- Portfolio positions are displayed incorrectly but no live orders have been affected yet
- Config value propagation is delayed or missing for a non-critical key
- A webhook handler is silently dropping events

### SEV-3 — Low

UI/UX issues, cosmetic defects, non-financial logic errors, or incorrect output with no trading
path dependency.

---

## Track A — Hotfix (SEV-1 or production bugs)

Use when the bug is confirmed in `main` (production) or live trading is at risk.

### Branch model

```
main (prod)
  └─ hotfix/<slug>     ← branches from main; PR targets main
```

After merge to `main`, the hotfix is immediately back-merged into `main-dev` to prevent divergence.

### Process

1. **Set maintenance mode** (SEV-1 only): `platform.maintenance_mode = true` via config-ui.
2. **Open the GitHub issue** using `.github/ISSUE_TEMPLATE/bug-report.yml` if not already open.
3. **Run `/sdd-triage <issue-number>`** — the skill creates the branch, logs the incident, and
   opens the PR using the hotfix PR template.
4. **Write the fix** on `hotfix/<slug>`.
5. **Merge the PR** — requires explicit platform-lead approval (enforced by the PR template
   checklist and GitHub branch protection on `main`).
6. **Back-merge** into `main-dev`:
   ```bash
   git checkout main-dev && git pull origin main-dev
   git merge origin/main
   git push origin main-dev
   ```
   The `/sdd-triage` skill automates this step when run with the `backmerge` sub-command.
7. **Append to `docs/runbooks/hotfix-log.md`** — the skill does this automatically; do it
   manually if the skill was not used.
8. **Clear maintenance mode** (if set): `platform.maintenance_mode = false`.

### Artifact trail

- Entry in `docs/runbooks/hotfix-log.md` (append-only incident register)
- GitHub issue closed with audit comment (who fixed it, commit SHA, PR URL)
- No `docs/roadmap/features/` directory is created for hotfixes

### Approval

| Step | Required approver |
|---|---|
| PR merge to `main` | Platform lead (hotfix PR template checkbox + branch protection) |

---

## Track B — Config-Only Fix

Use when the bug is a misconfigured runtime value with no code change needed.

xstockstrat uses `WatchConfig` streaming. Most threshold, timeout, and flag values can be
corrected without a deploy. The fix propagates to all subscribed services within one stream
cycle (typically < 1 second).

### Process

1. **Identify the config key** using the service CLAUDE.md "Config Keys" table.
2. **Run `/sdd-triage <issue-number>`** — the skill confirms the diagnosis and prints the exact
   `SetConfig` command with the correct namespace, key, and value.
3. **Apply the change** via config-ui (`http://localhost:3002`) or the config service RPC.
4. **Verify propagation** — watch the service logs for the `config updated` event.
5. The skill **closes the GitHub issue** with an audit comment showing what was changed and why.

### Artifact trail

- GitHub issue closed with config-change audit comment
- No branch, no PR, no CI run, no `docs/roadmap/features/` directory

### Approval

| Step | Required approver |
|---|---|
| Config value change | Service owner (per `docs/runbooks/config-rollout.md` rules) |

---

## Track C — SDD Path (SEV-2 / SEV-3)

Use when the bug requires a code change but is not a production emergency.

The bug is treated as a lightweight feature. It uses the existing SDD skill chain (`/sdd-spec`,
`/sdd-execute`) with a pre-populated artifact set created by `/sdd-triage`.

### Branch model

```
main-dev (dev trunk)
  └─ feature/<slug>                   ← integration branch (same prefix as features)
       └─ feature-steps/<slug>-step-N ← per-step branches (same prefix as features)
```

The `feature/<slug>` prefix is used intentionally so `/sdd-execute`'s boot sequence works
without modification — it reads the `**Development Branch**` field from `feature.md` directly.

### Process

1. **Open the GitHub issue** using `.github/ISSUE_TEMPLATE/bug-report.yml`.
2. **Run `/sdd-triage <issue-number>`** — the skill creates
   `docs/roadmap/features/<slug>/feature.md` (Type: bug), `product-spec.md` pre-populated from
   the issue body, and `context.md`. Status: `draft`.
3. **Run `/sdd-spec <slug>`** — generates the numbered implementation steps with grep-backed
   evidence, exactly as for a feature.
4. **Run `/sdd-execute <slug> next`** (repeat) — same step loop as features.
5. Integration PR from `feature/<slug>` to `main-dev`. Normal CI runs.
6. Status: `code-completed`. The fix rides the next `/promote` cycle to production.
7. The promote skill includes the bug in the CHANGELOG under "Bug Fixes".

### Artifact trail

- `docs/roadmap/features/<slug>/feature.md` (Type: bug, lifecycle status tracked)
- `docs/roadmap/features/<slug>/product-spec.md` (pre-populated from issue)
- `docs/roadmap/features/<slug>/implementation-spec.md` (generated by `/sdd-spec`)
- `docs/roadmap/features/<slug>/context.md` (append-only session log)
- GitHub issue linked in `feature.md`; closed when status reaches `launched`

### Approval

| Step | Required approver |
|---|---|
| PR to `main-dev` | 1 service owner (same as features) |
| Any proto change | Existing proto approval matrix (see `docs/runbooks/proto-versioning.md`) |

---

## Hotfix Log Format

The `docs/runbooks/hotfix-log.md` file is an **append-only** incident register. Each Track A
hotfix appends one entry. Do not edit or delete existing entries.

Entry format:
```markdown
## <ISO-8601 timestamp> — hotfix/<slug>

- **GitHub issue**: <URL>
- **Severity**: SEV-1 | SEV-2
- **Affected service(s)**: <service name(s)>
- **Root cause**: <one sentence>
- **Fix summary**: <one sentence>
- **PR**: <URL>
- **Platform-lead approver**: <GitHub handle>
- **Back-merge commit**: <SHA>
- **Maintenance mode applied**: yes | no
- **Status**: in-progress | deployed
```

Change `Status` from `in-progress` to `deployed` after the back-merge is complete.

---

## Reference

| Resource | Path |
|---|---|
| Triage skill | `/sdd-triage` |
| Hotfix incident register | `docs/runbooks/hotfix-log.md` |
| Config rollout procedure | `docs/runbooks/config-rollout.md` |
| Feature workflow (promotion cycle) | `docs/runbooks/feature-workflow.md` |
| Hotfix PR template | `.github/PULL_REQUEST_TEMPLATE/hotfix.md` |
| Bug report issue template | `.github/ISSUE_TEMPLATE/bug-report.yml` |
