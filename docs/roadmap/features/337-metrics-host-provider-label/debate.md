# Debate Register: metrics-host-provider-label

**State**: in-debate
**Mode**: full (upgraded from quick at the post-recon P-04 gate, 2026-11-12)
**Rounds run**: 0 (round numbers continue across runs; the mode's 2–5 bounds count this run only)

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 0 | 2026-11-12 | operator brief + product-spec | 3 | 2 | 0 | 0 | 0 | seed |

## Settled Decisions

| ID | Round | Decision | Evidence | Status |
|---|---|---|---|---|
| D-1 | 0 | Metrics only. The logs filter `\| host_provider="homelab"` and the 332 resource attribute / `target_info` row are unchanged. | Operator brief; product-spec Out of Scope, FR-6 | settled |
| D-2 | 0 | The label value is the already-resolved 332 `host.provider` (exact lowercase, else `unknown`); no second reader of `HOST_PROVIDER`, no new env var, no config key. | product-spec FR-2; recon.md Dependencies | settled |
| D-3 | 0 | Dashboards and alerts under `packages/otel/` are not edited; provider-scoped alerts stay with `otel-env-provider-scoped-alerts`. This feature must not depend on or edit feature 336 (Python `service.instance.id`). | Operator brief; product-spec FR-8, Out of Scope | settled |

## Rejected Alternatives (locked)

| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 0 | Carry the provider in `service.namespace` or any repurposed standard attribute | Operator decision; it changes `job` on existing series; also rejected in feature 332 `R-6` | locked |
| R-2 | 0 | Use `OTEL_RESOURCE_ATTRIBUTES` as the carrier | The deploy-spec guard rejects it (`@AC-22 @feature-332`, `check-otel-produced-signals.py:444-445`); precedence unverified per SDK | locked |

## Objections

| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|

## Reopen Petitions

| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
