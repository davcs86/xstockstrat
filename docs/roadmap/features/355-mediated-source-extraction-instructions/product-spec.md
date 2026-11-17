# Product Spec: mediated-source-extraction-instructions

**Created**: 2026-11-17

---

## Problem Statement

A `mediated_*` signal source is processed by an LLM agent, so its extraction logic is prose — it
cannot be a Python module. The registry still models it as one: every mediated source carries
`extractor_module = app.extractors.noop`, the agent tools ask for and return that value, and there is
no field for the prose. A consuming agent that registers, updates or instantiates one reads "noop", concludes the source has no extraction step,
and ingests nothing.

## User Story

As an operator whose LLM agents consume `mediated_*` signal sources over MCP, I want each mediated
source to carry its extraction logic as prose and to stop presenting an extractor module, so that a
consuming agent knows what to extract instead of concluding there is no work.

## Functional Requirements

"Mediated source" below means a source whose `source_type` is one of the five `mediated_*` types
(`mediated_simple_email`, `mediated_email_attachment`, `mediated_linked_email`,
`mediated_simple_website`, `mediated_authenticated_website`). "Empty" instructions means absent,
`""`, or whitespace only.

FR-1. A signal source has a first-class prose field `extraction_instructions`, persisted by
`xstockstrat-ingest` and carried on the `SignalSource` proto message.

FR-2. Registering a mediated source with empty `extraction_instructions` is rejected with
`INVALID_ARGUMENT`; nothing is persisted.

FR-3. Registering a mediated source does not require `extractor_module`. Ingest stores
`app.extractors.noop` for a mediated source itself, whatever the caller sent.

FR-4. A partial update of a mediated source preserves `extraction_instructions` when the field is
omitted and replaces it when supplied — the same merge rule every other updatable field follows.

FR-5. A mediated source that already exists with empty `extraction_instructions` keeps working: it
is still listed, still updatable in its other fields, and no migration fills the field in.

FR-6. Every agent tool response that describes a mediated source (`list_signal_sources`,
`manage_signal_source`, `instantiate_template` with `kind=signal_source`) carries a non-empty
`extraction_instructions` and a boolean `extraction_instructions_is_default`. When the stored value
is empty, the agent layer substitutes one fixed generic instruction text and sets the boolean to
`true`; otherwise it returns the stored text and `false`.

FR-7. `manage_signal_source` and `instantiate_template` responses for a mediated source do not
contain `extractor_module`, and the `manage_signal_source` contract no longer tells the caller to
provide it for a mediated source. (`list_signal_sources` already omits it and must keep doing so.)

FR-8. Non-mediated sources are unchanged: `manage_signal_source` and `instantiate_template` still
accept and return `extractor_module` for them, and their responses carry neither
`extraction_instructions` nor `extraction_instructions_is_default`.

FR-9. The signal-source form in `/insights` shows an "Extraction instructions" input in place of the
"Extractor Module" input when the selected type is mediated, and requires it when creating one. The
signal-source template form in `/config-ui` offers the same field.

FR-10. The agent's extraction prompt (`app/prompts/signal_extraction.md`) and
`docs/runbooks/mcp-tools.md` describe the new field and the default-text behaviour, in the same
change.

FR-11. The four seeded mediated system templates (`tpl-sec_edgar_8k`, `tpl-sec_edgar_form4`,
`tpl-prnewswire_releases`, `tpl-robinhood_snacks`) carry non-empty `extraction_instructions` in
their payload, and a source instantiated from a template inherits the template's instructions.

FR-12. An update that sets `extraction_instructions` to empty on a mediated source is rejected with
`INVALID_ARGUMENT`; the stored value is unchanged.

FR-13. A register or update that leaves a non-mediated source with non-empty
`extraction_instructions` is rejected with `INVALID_ARGUMENT`.

FR-14. `extraction_instructions` longer than 16,000 characters is rejected with `INVALID_ARGUMENT`
on register and update.

## Out of Scope

- Removing `extractor_module` from the proto message or the `ingest.signal_sources` table, or hiding
  it for non-mediated sources (user decision 2026-11-17: "hide for mediated only").
- Backfilling `extraction_instructions` on existing mediated source rows (user decision: "required
  for new only").
- Resolving `extractor_module` at runtime (it stays stored-and-echoed; ingest finding 2026-11-04).
- Deleting the dead `app/extractors/noop.py` / `example_simple_email.py` modules.
- Per-source credential resolution for `extract_email_content` / `extract_website_content`.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-ingest` — owns `ingest.signal_sources`; new column, register/update validation,
  server-side `extractor_module` default for mediated types.
- `xstockstrat-agent` — `list_signal_sources`, `manage_signal_source`, `instantiate_template`
  parameters and return shapes; `signal_extraction.md` prompt.
- `xstockstrat-ui` — `/insights` signal-sources form and `/config-ui` templates form.
- `packages/proto` — additive field on `ingest.v1.SignalSource`.

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — `xstockstrat-ui` segments `/insights` (signal-sources page: new "Extraction
  instructions" field, "Extractor Module" hidden for mediated types) and `/config-ui` (templates
  page: same field on a signal-source template). Both pages already exist and are already
  registered in `PLATFORM_SUBNAV`; no new route.
- [x] **Agent** — `xstockstrat-agent` MCP tools `list_signal_sources` (new response field),
  `manage_signal_source` (new arg, `extractor_module` optional and absent from the response for
  mediated types), `instantiate_template` (response shape for a mediated `signal_source`).
- [ ] **None**

## Proto Contract Changes

- `ingest.v1.SignalSource`: add `string extraction_instructions` at the next free field number
  (15 on `main-dev` today — re-derive from the union of open branches at design time). Additive,
  non-breaking. `extractor_module = 4` is untouched.

## Config Key Changes

- [x] No new config keys

## Database Changes

- `ingest.signal_sources`: add column `extraction_instructions` (text) via a new ingest migration
  (next free prefix `017` on `main-dev` today — re-derive at design time). Up + down pair. Existing
  source rows are not backfilled.
- Seeded template payloads: a migration adds `extraction_instructions` to the four mediated system
  templates (FR-11). `scripts/check-seed-template-parity.py` and its testdata follow. Whether this
  is the same migration or the next prefix is a design decision.

## Feature Workflow Notes

Branch to create: `feature/mediated-source-extraction-instructions` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto or config change)
- [ ] 2 service owners + platform lead (breaking proto change)
- [x] DBA review + service owner (schema migration)

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [x] **OQ-1 — templates vs "required for new".** Resolved (user, 2026-11-17): seed prose into the
  four mediated system templates → FR-11.
- [x] **OQ-2 — clearing on update.** Resolved (user): rejected → FR-12.
- [x] **OQ-3 — non-mediated sources.** Resolved (user): non-empty value rejected → FR-13.
- [x] **OQ-4 — shape of the fallback.** Resolved (user): literal generic prose plus
  `extraction_instructions_is_default` → FR-6.
- [x] **OQ-5 — stored `extractor_module` for a mediated register.** Resolved (user): keep
  `app.extractors.noop`, written server-side → FR-3.
- [x] **OQ-6 — length cap.** Resolved (user): 16,000 characters → FR-14.

## Design Notes

- **Known trap (ledger `fails.md` 2026-08-05, signal-source-registry):** mediated types were dropped
  from sibling artifacts twice. Every FR that names "mediated" must be checked against all five
  types in the validator, the agent projection, the UI type lists, and the tests.
- **Known trap (ledger `fails.md` 2026-08-02, mcp-tools-alignment-triage):** tool docstrings and
  `docs/runbooks/mcp-tools.md` drift without an executable parity test — the changed return shapes
  need one, and the docstring + runbook change in the same PR.
- **Overlap (soft):** `328-fix-agent-bearer-secret-orphan` (spec-ready) edits the same
  `manage_signal_source` / `instantiate_template` functions in `services/xstockstrat-agent/app/tools.py`.
- The wording of the generic default text (FR-6) and of the four template instructions (FR-11) is
  authored in design/spec and reviewed by the operator in the PR.
- FR-3 "whatever the caller sent": the `/insights` edit form round-trips the stored
  `extractorModule`, so a mediated update must tolerate a supplied value rather than reject it.
