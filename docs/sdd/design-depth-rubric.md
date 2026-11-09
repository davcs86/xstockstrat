# Design-Depth Rubric

Single source for the `/sdd-design` depth recommendation. Read by `/sdd-review product-spec` (features,
Mode A4), `/sdd-triage` Track C (bugs, C-0), and `/sdd-design` (post-Recon escalation). Depth only
sets the debate length — Phase 0 Recon and the Floor check (F-11) run in full at every depth.

A recommendation is advisory: never auto-invoke `/sdd-design` (P-04). `skip` is bug-only (C-11).

## Escalate-to-full signals (features and bugs)

Any one → **full** (`/sdd-design <slug>`):

- a proto change;
- a DB migration or schema change;
- ≥2 affected services — a named consumer surface (`xstockstrat-ui` / `xstockstrat-agent`, C-14)
  counts as a service even if absent from Affected Services;
- a FAIL-level or warning-level overlap from the `feature-overlap` pass (features only).

## Features (`/sdd-review product-spec`)

Default **full**. **quick** (`/sdd-design <slug> quick`) only when no escalate signal fires: single
service, no proto, no migration/schema, no overlap finding. A config-key change alone does not
escalate a feature.

## Bugs (`/sdd-triage` Track C)

Escalate signals above → **full**. Otherwise:

- **quick** — SEV-2, OR a config change is mentioned, OR the root cause is "under investigation".
- **skip** — SEV-3, single service, no proto/migration/config, clear root cause (`/sdd-spec` notes the
  absent design and proceeds).

## Post-Recon escalation (one-way, `/sdd-design` Phase 0)

When running `quick`, Recon may surface what the spec did not state. If recon.md shows any escalate
signal above, or `scenario-recon` classifies an existing `@AC-*` rule as **CHANGE**, offer
*Upgrade to full* / *Keep quick* through the P-04 gate. Never downgrade `full` to `quick`.
