# Debate Register: mediated-source-extraction-instructions

**State**: in-debate
**Mode**: full
**Rounds run**: 1 (round numbers continue across runs; the mode's 2–5 / 1 bounds count this run only)

Paths: `ingest/` = `services/xstockstrat-ingest/`, `agent/` = `services/xstockstrat-agent/`,
`ui/` = `services/xstockstrat-ui/`.

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-17 | /sdd-design | 12 | 6 | 9 | 13 | 0 | yes |

## Settled Decisions

<!-- Status: settled → superseded by D-m (only after a user-approved REOPEN) -->
| ID | Round | Decision | Evidence | Status |
|---|---|---|---|---|
| D-1 | 1 | Proto: plain `string extraction_instructions = 15` on `ingest.v1.SignalSource` (not `optional`). | `packages/proto/ingest/v1/ingest.proto:172-193` | settled |
| D-2 | 1 | Column: `ADD COLUMN IF NOT EXISTS extraction_instructions TEXT NOT NULL DEFAULT ''` on `ingest.signal_sources`; code always binds a `str`; no DB CHECK for the cap (ingest validator is the single authority). | `scripts/migration-assertions/fixtures-pre-224.sql:19`; `.github/workflows/ci.yml:896-935` | settled |
| D-3 | 1 | One migration pair `017_signal_source_extraction_instructions` (name must not end `_seed_source_templates.up.sql`): the column, plus an idempotent `payload \|\| jsonb_build_object('extraction_instructions', …)` UPDATE on the four `created_by = 'system'` template rows. **No `version` bump.** Down removes the payload key, then drops the column. New `scripts/migration-assertions/ingest-017.sql`; `ingest-016.sql` unchanged. A header comment states the 017 row grammar. | `scripts/check-seed-template-parity.py:31`; `ingest/tests/test_seed_source_templates.py:29-32`; `scripts/migration-assertions/ingest-016.sql:6-16`; `ingest/migrations/016_seed_source_templates.down.sql:8` | settled |
| D-4 | 1 | "Mediated" is `source_type` starting with `mediated_`, one predicate per service: ingest `is_mediated_source_type` beside `validate_config_json`; agent `_is_mediated` beside `_EXTRACTOR_TOOL_MAP`; UI reuses `isMediatedType`. No enumerated five-type list. Ingest's fail-closed type allow-list runs first. | `ingest/app/repositories/signal_sources.py:280-283`; `agent/app/tools.py:303-310`; `ui/src/app/insights/signal-sources/page.tsx:123-125` | settled |
| D-5 | 1 | Ingest: one pure validator `validate_extraction_instructions(source_type, text, *, require)` (cap 16,000; mediated+require+blank → error naming the field; non-mediated+non-blank → error) run on register/instantiate and update, **after** the conflict / permission checks. `app.extractors.noop` is forced in `_register_source` and in the update merge when the effective type is mediated. Column appended last in `_LIST_COLS`, `insert_source` ($10), `update_source` ($9); mapped in `_source_to_proto`; path added to `_SS_MASKABLE_PATHS` and `_TEMPLATE_PAYLOAD_FIELDS`. | `ingest/app/handlers/servicer.py:58-67,167-176,1576-1578,1605-1607,1620,1652-1688`; `ingest/tests/test_signal_sources.py:274-317` | settled |
| D-6 | 1 | Agent: `client.py` passes the raw field through (builder + both projections); the mediated shaping lives in `tools.py` — drop `extractor_module`, add `extraction_instructions` (stored, or `_DEFAULT_EXTRACTION_INSTRUCTIONS`) + `extraction_instructions_is_default`; non-mediated responses drop the raw key. Helpers read with `.get`/`.pop(k, None)` so existing mocked client returns keep working. The default text is a `tools.py` module constant. `manage_signal_source` gains `extraction_instructions`, masked only when supplied. | `agent/app/client.py:192-224,1386-1441`; `agent/app/tools.py:92-97,539-574,1473-1482`; `agent/tests/test_tools.py:154-164,1412-1419` | settled |
| D-7 | 1 | UI: `/insights/signal-sources` renders an "Extraction instructions" `Textarea` instead of the "Extractor Module" `Input` when the type is mediated; client-side required + 16,000 cap; `/config-ui/templates` gets one unconditional multiline `FieldDef`. | `ui/src/app/insights/signal-sources/page.tsx:269-338,601-609`; `ui/src/app/config-ui/templates/page.tsx:47-52,80-87` | settled |
| D-8 | 1 | The migration step also changes `("ingest", 16)` → `("ingest", 17)` in `scripts/migration-rerun.py`, and 017's down must succeed when replayed by the refused-down pass. | `scripts/migration-rerun.py:1102,1114` | settled |
| D-9 | 1 | The `list_signal_sources` docstring and the `tools.py` module header document `extraction_instructions` / `extraction_instructions_is_default` and state that `extractor_tool: null` means "read the content yourself and follow `extraction_instructions`", never "no extraction". `list_templates` gets one docstring line on `extractorModule` vs `extractionInstructions`. The AC-15 doc-parity test covers the tool docstrings as well as the runbook and the prompt file. Agent tests cover `mediated_simple_email` explicitly. | `agent/app/tools.py:5,543-551,1356-1365`; `agent/app/main.py:124-143` | settled |
| D-10 | 1 | No change to `scripts/check-seed-template-parity.py` (it never reads 017). The guards for the seeded prose are `ingest-017.sql` and `ingest/tests/test_seed_source_templates.py`, whose overlay of 017 enforces strict id/prose pairs, exactly the four seeded ids, and runs the validator with `require=True` on each payload. | `scripts/check-seed-template-parity.py:31,48-55,91-100`; `ingest/tests/test_seed_source_templates.py:35-68` | settled |
| D-11 | 1 | **Maskless update = plain replace-all**, no special case (user, round-1 gate). The field is applied when the mask names it, or when no mask is sent. Prose is required (non-blank) on an update when the effective type is mediated AND (the field is applied OR the stored type was not mediated). A maskless update that omits the prose therefore sends `""` and is rejected on a mediated source; a masked update that does not name the path leaves a legacy empty row untouched (FR-5). | `ingest/app/handlers/servicer.py:1579-1599` | settled |
| D-12 | 1 | `ManageTemplate` CREATE/UPDATE run the validator with `require=True` (user, round-1 gate), after the system-row PERMISSION_DENIED check; RETIRE is never checked. An existing admin mediated template without prose cannot be updated until prose is added. | `ingest/app/handlers/servicer.py:1712-1732` | settled |

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 1 | `optional string extraction_instructions` (explicit presence). | No in-repo caller sends a maskless update; presence adds `string \| undefined` in TS and `HasField` plumbing for a distinction nobody uses; `""` is never a valid applied value on a mediated source (FR-12). C-18. | locked |
| R-2 | 1 | Bump `version` on the four system templates so instances show `update_available`. | Breaks `ingest-016.sql:6-16` (`version = 1`) and makes `016 .down.sql:8` leave rows behind; legacy instances are already covered by the default text (FR-5/FR-6). | locked |
| R-3 | 1 | A shared / generated five-type "mediated" constant across services. | Three languages; a prefix test enumerates nothing, so it cannot drop a type (the ledger 2026-08-05 trap). C-18. | locked |
| R-4 | 1 | Serve `signal_extraction.md` as an MCP prompt so FR-10 reaches agents at runtime. | Beyond the spec; the tool docstrings and responses (D-9, D-6) carry the guidance to every caller. C-18 YAGNI. | locked |
| R-5 | 1 | Seed the template prose in a separate migration `018`. | Column and prose must ship together (feature 335 `@AC-7`); one pair is simpler and its round trip is asserted once. | locked |
| R-6 | 1 | Treat a maskless `""` as "omitted" and keep the stored prose. | User chose plain replace-all at the round-1 gate: the exception protects no in-repo caller and is the only field that would deviate from maskless replace-all. P-03 / C-18. | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | `scripts/migration-rerun.py:1114` hardcodes ingest clean at 16 — CI fails once 017 exists. C-10 / C-01. | yes | closed @ round 1 (D-8; verified at `migration-rerun.py:1114`) |
| O-2 | 1 | The `list_signal_sources` docstring (`agent/app/tools.py:543-551`) and module header stay stale; with `extractor_tool: null` for `mediated_simple_email` the "no work" signal survives on the most-read surface. C-10, ledger 2026-08-02. | yes | closed @ round 1 (D-9) |
| O-3 | 1 | Adding the key to the parity script's `SOURCE_PAYLOAD_FIELDS` is inert (the script reads only 016). C-18. | no | closed @ round 1 (D-10) |
| O-4 | 1 | The test overlay of 017 is a second parsed source of truth and can fail silently. C-18. | no | closed @ round 1 (D-3 grammar header + D-10 strict pairs) |
| O-5 | 1 | "A maskless `\"\"` means omitted" is a new, unrequested update rule that protects no real caller and departs from maskless replace-all (`ingest/app/handlers/servicer.py:1598-1599`); it also makes a maskless mediated→non-mediated change with stored prose unrejectable-by-clear. P-03 / C-18. | no | closed @ round 1 (D-11 / R-6, user at the gate) |
| O-6 | 1 | Shaping helpers would `KeyError` on existing mocked client dicts. | no | closed @ round 1 (D-6 `.get`/`.pop`) |
| O-7 | 1 | `@AC-14` ("reopening shows the prose") cannot be proved against the current mock: `ui/e2e/mock-backend.ts:1678-1692` lists a static template and echoes without storing. Needs a per-test stateful route stub or a request-body assertion; new fixtures need `INVENTORY.md` rows (C-12). | no | open |
| O-8 | 1 | Whitespace has two stored forms on non-mediated rows, and the UI silently drops a whitespace-only edit from the mask while the agent gets INVALID_ARGUMENT (`@AC-23`). | no | open |
| O-9 | 1 | Leaving `updated_at` untouched on the four template rows makes the catalog's `meta.updated_at` wrong (`ingest/app/handlers/servicer.py:198-199`); `SET updated_at = NOW()` is safe for both 016 guards. | no | open |
| O-10 | 1 | Requiring prose on `ManageTemplate` CREATE/UPDATE goes beyond FR-1..14: an admin can no longer make a name-only edit to an existing admin mediated template that has no prose. | no | closed @ round 1 (D-12, user accepted the side effect at the gate) |
| O-11 | 1 | Forcing noop in the update merge silently rewrites stored `extractor_module = ""` to `app.extractors.noop` on a legacy seed-instantiated row's next update. Invisible at agent/UI; needs stating. | no | open |
| O-12 | 1 | `list_templates` raw payloads can still show `extractorModule` for admin-authored mediated templates. | no | closed @ round 1 (D-9 docstring line; the tool stays outside FR-6/FR-7) |
| O-13 | 1 | Feature 328 edits the same `manage_signal_source` / `instantiate_template` bodies; needs a `merge-order.md` sequencing note. | no | waived @ round 1 (user: no ordering row; carried as an Open Risk in design.md) |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
