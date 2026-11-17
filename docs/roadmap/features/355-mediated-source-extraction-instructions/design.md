# Design: mediated-source-extraction-instructions

**Created**: 2026-11-17
**Rounds**: 6 (full; termination: approved — the five-round cap was lifted by the user at the round-4 gate, context.md)
**Approved by**: user @ 2026-11-17
**Grounded in**: recon.md
**Debate register**: debate.md

Paths: `ingest/` = `services/xstockstrat-ingest/`, `agent/` = `services/xstockstrat-agent/`,
`ui/` = `services/xstockstrat-ui/`. "recon §X" cites a section of recon.md, whose `path:line`
evidence is not repeated here. `D-n` / `R-n` / `O-n` are debate.md ids.

---

## Chosen Approach

A mediated source's extraction logic becomes a stored prose field that every agent-facing response
carries; the dead `extractor_module` disappears from those responses. "Mediated" is one predicate
per service — `source_type` starts with `mediated_` — never an enumerated list (D-4; recon §Risks,
ledger 2026-08-05).

### Proto (D-1)

`string extraction_instructions = 15;` on `ingest.v1.SignalSource` (recon §Codebase Map → proto).
Plain, not `optional`. A template payload is a typed `SignalSource`, so templates get the field
without a schema change.

### Migration 017 (D-2, D-3, D-8, D-14, D-29)

One pair, `ingest/migrations/017_signal_source_extraction_instructions.{up,down}.sql` (the name must
not end `_seed_source_templates.up.sql` — recon §Dependencies).

- Up: `ALTER TABLE ingest.signal_sources ADD COLUMN IF NOT EXISTS extraction_instructions TEXT NOT
  NULL DEFAULT ''`; then one `UPDATE ingest.source_templates AS t SET payload = t.payload ||
  jsonb_build_object('extraction_instructions', v.instructions), updated_at = NOW() FROM (VALUES …)
  AS v(template_id, instructions) WHERE t.template_id = v.template_id AND t.created_by = 'system'
  AND t.payload->>'extraction_instructions' IS DISTINCT FROM v.instructions`. Replays touch no row.
  **No `version` bump.** No DB CHECK for the cap.
- A header comment states the row grammar (two dollar-quoted literals per row: template id, then
  the instructions; no literal contains the quote tag) without writing the tag itself.
- Down: remove the key from the four system rows, then `DROP COLUMN IF EXISTS`.
- `scripts/migration-assertions/ingest-017.sql`: column shape; the four system rows have non-empty
  prose and `version = 1`; re-running the up changes no `payload` / `updated_at`; the down removes
  key and column and leaves the `fundamentals` source. `ingest-016.sql`, 016 itself and
  `scripts/check-seed-template-parity.py` are unchanged.
- `scripts/migration-rerun.py`: the hardcoded clean ingest version goes 16 → 17.

### Ingest (D-5, D-11, D-12, D-13, D-15, D-16, D-29)

Beside `validate_config_json` (recon §Codebase Map → ingest repositories):
`EXTRACTION_INSTRUCTIONS_MAX_CHARS = 16_000`, `is_mediated_source_type`,
`normalize_extraction_instructions` (whitespace-only → `""`; non-blank stored verbatim), and
`validate_extraction_instructions(source_type, text, *, require)`, checked in the order length
(`len(text) > 16_000`, code points) → required (mediated, `require`, empty) → non-mediated with
non-empty text. Every message names `extraction_instructions`.

`_validate_source_write` gains the instructions arguments and runs `validate_config_json` →
credential check → the new validator, at its two existing call sites — i.e. after the stored-row
lookup / NOT_FOUND / PERMISSION_DENIED and mask checks on update, and after the conflict check on
register (recon §Codebase Map → servicer; recon §Risks "check order").

| Operation | Text validated | `require` |
|---|---|---|
| REGISTER / InstantiateTemplate (`_register_source`) | normalized request value | `True` |
| UPDATE, path applied (named in the mask, **or no mask**) | normalized request value | `mediated(merged_type)` |
| UPDATE, path not applied | stored value | `mediated(merged_type) and not mediated(stored_type)` |
| ManageTemplate CREATE / UPDATE | normalized, written back before `_template_payload` | `True` |
| RETIRE / reactivate / deactivate | not validated | — |

A maskless update is plain replace-all: on a mediated source it must carry non-empty prose (D-11).
`app.extractors.noop` is forced in `_register_source` (register + instantiate) and in the update
merge whenever the effective type is mediated; a legacy stored `""` flips on the row's next update
(D-15). The column is appended last in `_LIST_COLS`, `insert_source` (`$10`) and `update_source`
(`$9`); `_source_to_proto` maps it with `.get(…, "")`; the path joins `_SS_MASKABLE_PATHS` and
`_TEMPLATE_PAYLOAD_FIELDS` (recon §Patterns to REUSE — the `reliability_weight` precedent).

### Agent (D-6, D-9, D-18, D-19, D-25)

`client.py` only carries the raw field: request builder, list projection, and
`_managed_source_to_dict`. The shaping lives in `tools.py` (recon §Codebase Map → agent; tool tests
mock `client.*`): `_is_mediated`, `_DEFAULT_EXTRACTION_INSTRUCTIONS` (module constant),
`_instruction_fields`, `_shape_managed_source`; all reads use `.get` / `.pop(k, None)`.

| Tool | Mediated source | Non-mediated source |
|---|---|---|
| `list_signal_sources` | slug, display_name, source_type, config_json, extractor_tool, has_credentials, reliability_weight, **extraction_instructions**, **extraction_instructions_is_default**, **origin** | today's 7 keys |
| `manage_signal_source`, `instantiate_template` (signal_source) | slug, display_name, source_type, active, has_credentials, reliability_weight, user_id, origin, **extraction_instructions**, **extraction_instructions_is_default** — no `extractor_module` | today's 9 keys, incl. `extractor_module` |

`extraction_instructions` is always non-empty for a mediated source: the stored text, or the default
text with `extraction_instructions_is_default: true`. `manage_signal_source` gains
`extraction_instructions: str | None`, masked only when supplied (so `""` reaches ingest's
rejection). Docstrings change for `list_signal_sources` (new keys; `extractor_tool: null` means
"read the content yourself and follow `extraction_instructions`", never "no extraction"),
`manage_signal_source`, `instantiate_template`, `list_templates` (one line),
`extract_website_content` (returns the **whole** body; `scrape_selector` is only a hint — recon
§Risks) and the module header. `agent/app/prompts/signal_extraction.md` and
`docs/runbooks/mcp-tools.md` change in the same step, each gaining the precedence line "a source's
`extraction_instructions` override this generic guidance"; a doc-parity test covers prompt, runbook
and docstrings.

### UI (D-7, D-13, D-17)

`/insights/signal-sources`: an "Extraction instructions" `Textarea` replaces the "Extractor Module"
`Input` when `isMediatedType`. Save rules: (i) mediated + non-blank → send the prose and name the
path; (ii) the **loaded** value was `""` and is still exactly `""` → omit the path, other fields
save; (iii) whitespace-only or loaded prose cleared → no request, "Extraction instructions are
required"; (iv) non-mediated → field not rendered, path never named, `''` sent on both source
builders. Cap by `Array.from(text).length > 16000`. The loaded value is captured in
`formFromSource`. `/config-ui/templates` changes three sites — `PAYLOAD_FIELDS.SIGNAL_SOURCE`,
`formFromTemplate`, `buildInput`. Tests: request-body assertions and per-test `page.route` stubs
(a stateful ListTemplates / ManageTemplate pair for `@AC-14`); fixtures
`SOURCE_TEMPLATE_MEDIATED_WEBSITE` and `SIGNAL_SOURCE_MEDIATED_LEGACY` outside the shared arrays;
`INVENTORY.md` rows extended (recon §Patterns to REUSE — C-12).

### Steps (D-18, D-23, D-29)

1. **S1** proto field + `buf-gen` + agent request builder + agent list projection + the two agent
   parity tests.
2. **S2** migration 017 + `ingest-017.sql` + `migration-rerun.py`. (`@AC-16` at SQL level.)
3. **S3** ingest repository, validator, servicer, tests — including the 017 overlay inside `_rows()`
   of `test_seed_source_templates.py` and the positional-argument edits — plus the ingest
   `CLAUDE.md` § Database line and the findings row. (`@AC-1..5, 9, 16..23, 25, 26`.)
4. **S4** agent `tools.py`, `_managed_source_to_dict`, docstrings, prompt, runbook, doc-parity test.
   (`@AC-6..10, 15, 24`.)
5. **S5** UI pages, fixtures, `INVENTORY.md`, e2e. (`@AC-11..14`.)

Only `agent/app/client.py` is touched by two steps (different symbols). Each step passes its own
verification alone.

### Deploy window

`db-migrator` runs 017 before services roll. Old ingest on the new schema works (defaulted column;
unknown payload key ignored). New agent/UI against old ingest shows the default text. Old agent/UI
against new ingest has mediated registers rejected until they deploy.

### Instruction texts (D-19..D-27, D-30) — ship verbatim

Structure claims were verified against live staging fetches on 2026-11-17 (context.md), except the
Robinhood Snacks email.

#### `_DEFAULT_EXTRACTION_INSTRUCTIONS` (agent `tools.py` module constant)

```
This source has no extraction instructions of its own, so follow this generic procedure. Having no instructions never means there is nothing to extract.
1. Get the content. The fields named below (extractor_tool, config_json) are on this source's entry in list_signal_sources.
   - Email source (its source_type contains 'email'): first find the messages that match config_json.sender_patterns and config_json.subject_patterns in your mail tool. If you have no mail tool, ingest nothing and tell the operator.
   - If extractor_tool is null, there is no extraction tool to call: read the content yourself (for an email source, the message body).
   - If extractor_tool is extract_email_content, call it with this source's slug and the matching message's attachments (attachments_b64; config_json.attachment_mime_types says which) or the links in it (urls; config_json.url_patterns says which), and read the raw_text it returns.
   - If extractor_tool is extract_website_content, call it with this source's slug. It returns the whole fetched page as raw_text; config_json.scrape_selector only tells you which elements of the page hold the content.
   - If the extraction tool raises an error, ingest nothing and tell the operator what it said.
2. Recency: use only content published within the last 24 hours. Take each item's own publication time (an email's sent time; for a page or feed, the time the item itself shows) and compare it with the current date and time. Skip an item that is older than 24 hours or whose publication time you cannot tell. If you cannot determine the current date and time of day (from your context, a clock tool, or by asking the operator; a date alone is not enough), ingest nothing and tell the operator.
3. Extract only signals the content states clearly: a company with a US exchange ticker you are certain of, and a direction of buy, sell, hold or watchlist. Do not invent signals and never guess a ticker. Send at most one signal per ticker and direction per run, taken from the newest qualifying item.
4. Call ingest_signal once per signal: source = this source's slug; symbol = the ticker; direction; conviction above 0 and at most 1, and only one of 0.3 (worth watching), 0.6 (a clear, explicit call) or 0.9 (an emphatic call), so that a repeated run sends the same value; valid_from = the item's own publication time as ISO 8601 with its offset (for example 2026-05-01T14:30:00Z). Never use the current time for valid_from or valid_until. For a watchlist signal also set valid_until = valid_from + 7 days in the same format, so the watchlist entry expires. Add headline, raw_url and tags when known. Because the times come from the content and the conviction is one of these fixed values, a repeated run sends identical values: re-sending an identical signal inside ingest's deduplication window is a no-op (the result says deduplicated: true); outside it a new signal is created.
5. Tell the operator that this source has no extraction instructions (extraction_instructions_is_default is true) and that you used this generic procedure. They can add instructions with manage_signal_source (operation 'update', this slug, extraction_instructions). If this source's origin names a template (origin.template_id in this list_signal_sources entry), that template's curated instructions are its payload.extractionInstructions in list_templates (kind 'signal_source'), and the operator can copy them onto this source with that update.
```

#### `tpl-sec_edgar_8k`

```
Source content: SEC EDGAR's latest 8-K filings as an Atom XML feed. Fetch it with extract_website_content(this source's slug); raw_text is the whole feed. The elements matched by config_json.scrape_selector are the filings, one per filing. In each: <title> is '8-K - <Company> (<CIK>) (Filer)', or '8-K/A - ...' for an amendment; <summary> is HTML-escaped and starts with Filed, AccNo and Size, then one 'Item N.NN: <description>' line per reported item; <updated> is the filing timestamp with its UTC offset; <link href> is the filing index URL. The feed carries no ticker.
Recency: use only filings whose <updated> is within the last 24 hours of the current date and time; skip older filings. If you cannot determine the current date and time of day (from your context, a clock tool, or by asking the operator; a date alone is not enough), ingest nothing and tell the operator.
What to ingest (skip everything else):
- Skip amendments (title starting '8-K/A').
- If the filing reports item 1.03 (bankruptcy or receivership), 3.01 (delisting or failure to meet a listing rule) or 4.02 (non-reliance on previously issued financial statements): direction 'sell', conviction 0.6, no valid_until.
- Otherwise, if it reports item 1.01 (entry into a material definitive agreement) or 2.01 (completion of an acquisition or disposition of assets): direction 'watchlist', conviction 0.3, valid_until = valid_from + 7 days.
- Every other item, including 2.02 (results of operations), is skipped. A filing yields at most one signal; a sell item wins over a watchlist item.
- Send at most one signal per ticker and direction per run, taken from the newest qualifying filing (latest <updated>).
Ticker: map the company name and CIK to the issuer's US exchange ticker only when you are certain; otherwise skip the filing. Never guess.
ingest_signal fields: source = this source's slug; symbol = the ticker; direction, conviction and valid_until as above; valid_from = the filing's <updated> value as ISO 8601, keeping its offset; valid_until, when set, in the same format; headline = '<Company> 8-K: Item N.NN <description>' for the triggering item (the lowest-numbered item of the winning direction when several qualify); raw_url = the filing's <link href>; tags = ['sec_8k', 'item_N.NN'] for that same item. Never use the current time for valid_from or valid_until: they come from the filing, so a repeated run sends identical values. Re-sending an identical signal inside ingest's deduplication window is a no-op; outside it a new signal is created.
If extract_website_content raises an error, or the content does not have this shape, ingest nothing and tell the operator.
```

#### `tpl-sec_edgar_form4`

```
Source content: SEC EDGAR's latest Form 4 (insider transaction) filings as an Atom XML feed. Fetch it with extract_website_content(this source's slug); raw_text is the whole feed. The elements matched by config_json.scrape_selector are the feed entries. Each filing appears as several entries that share one AccNo (accession number) in their <summary>: one titled '4 - <Company> (<CIK>) (Issuer)' and one or more titled '4 - <Name> (<CIK>) (Reporting)', one per reporting person. <updated> is the filing timestamp with its UTC offset and <link href> the filing index URL. The feed has no transaction data (no buy or sell, no share count, no price) and no ticker.
Recency: use only filings whose <updated> is within the last 24 hours of the current date and time; ignore older filings entirely, including when counting a cluster. If you cannot determine the current date and time of day (from your context, a clock tool, or by asking the operator; a date alone is not enough), ingest nothing and tell the operator.
What to ingest: insider clusters only. Group the recent entries by AccNo, tie each filing to its issuer through its Issuer entry, and skip any AccNo whose Issuer entry, or every one of whose Reporting entries, is not in this fetch. Also ignore every filing whose <updated> equals the oldest <updated> in this fetch: the feed holds only the latest entries and may have cut that filing off. An issuer is a cluster only when this fetch holds at least two separate filings (different AccNo) for it that have no reporting person in common: no Reporting CIK of one filing appears on the other. Two filings that share any reporting person do not count as a pair, and several Reporting entries on one filing (a joint filing, for example a fund and its general partner) are one filing and never a cluster on their own. A counted filing is a recent filing for that issuer, not skipped or ignored above, that shares no reporting person with at least one other such filing for that issuer. For each cluster issuer ingest exactly one signal: direction 'watchlist', conviction 0.3. Skip every other issuer. Never ingest 'buy' or 'sell' from this source: the feed does not say which way the insiders traded.
Ticker: map the issuer to its US exchange ticker only when you are certain; otherwise skip the issuer. Never guess.
ingest_signal fields: source = this source's slug; symbol = the ticker; direction = 'watchlist'; conviction = 0.3; valid_from = the newest <updated> among that issuer's counted filings, as ISO 8601, keeping its offset; valid_until = valid_from + 7 days, same format; headline = 'Form 4 cluster: <N> filings by different insiders for <Company>', where N is the number of counted filings; raw_url = the <link href> of that issuer's newest counted Issuer entry; tags = ['sec_form4', 'insider_cluster']. This gives at most one signal per ticker and direction per run, dated by the newest qualifying filing. Never use the current time for valid_from or valid_until: they come from the feed, so a repeated run sends identical values. Re-sending an identical signal inside ingest's deduplication window is a no-op; outside it a new signal is created.
If extract_website_content raises an error, or the content does not have this shape, ingest nothing and tell the operator.
```

#### `tpl-prnewswire_releases`

```
Source content: PR Newswire's latest news-releases list page, as HTML. Fetch it with extract_website_content(this source's slug); raw_text is the whole page. The elements matched by config_json.scrape_selector are the releases, one link each: inside it an <h3> holds the release time ('HH:MM ET', in a <small>) followed by the headline, and a <p> holds a one-sentence teaser. The href is relative to https://www.prnewswire.com. The page lists only the newest releases (about 25, often less than an hour's worth), so a run sees only what was released shortly before it. The list is not limited to US issuers or to English.
Release time: the page shows a time of day without a date. Put it on the current date in New York (America/New_York), or on the previous day if that would be later than the current time; if the page shows the release's date, use that date instead. If you cannot determine the current date and time of day (from your context, a clock tool, or by asking the operator; a date alone is not enough), ingest nothing and tell the operator.
Recency: use only releases published within the last 24 hours of the current date and time. Dated as above, every listed release falls inside that window unless the page shows an older date.
What to ingest: a release only when both hold:
1. The headline or teaser names a US exchange ticker in the form (NYSE: XXXX), (NASDAQ: XXXX), (Nasdaq: XXXX) or (NYSE American: XXXX). Skip releases with no ticker, or with only an OTC or non-US listing (for example TSX, LSE, ASX); do not look tickers up.
2. The release announces quarterly or annual results, a change to guidance, a merger or acquisition, a regulatory decision (for example from the FDA), or a material contract award.
For each such release: direction 'watchlist', conviction 0.3. Never 'buy' or 'sell': a press release is the issuer's own promotional framing. Skip non-English releases. Send at most one signal per ticker and direction per run, taken from the newest qualifying release.
ingest_signal fields: source = this source's slug; symbol = the ticker from the parentheses; direction = 'watchlist'; conviction = 0.3; valid_from = the release time dated as above, as ISO 8601 with its New York offset (for example 2026-11-17T09:05:00-05:00); valid_until = valid_from + 7 days, same format; headline = the release headline; raw_url = https://www.prnewswire.com followed by the href; tags = ['prnewswire'] plus one of 'earnings', 'guidance', 'm_and_a', 'regulatory', 'contract'. Never use the current time for valid_from or valid_until: they come from the release, so a repeated run sends identical values. Re-sending an identical signal inside ingest's deduplication window is a no-op; outside it a new signal is created.
If extract_website_content raises an error, or the content does not have this shape, ingest nothing and tell the operator.
```

#### `tpl-robinhood_snacks`

```
Source content: the Robinhood Snacks daily newsletter email. extractor_tool is null for this source, so there is no extraction tool to call: find the messages that match config_json.sender_patterns and config_json.subject_patterns in your mail tool and read each body yourself. If you have no mail tool, ingest nothing and tell the operator. A newsletter is several short market stories, each about one or a few companies, usually naming the ticker.
Recency: use only emails whose sent time is within the last 24 hours of the current date and time; skip older emails. If you cannot determine the current date and time of day (from your context, a clock tool, or by asking the operator; a date alone is not enough), ingest nothing and tell the operator.
What to ingest: for each company that is the main subject of a story and is named with its US exchange ticker (or is a US-listed company whose ticker you know with certainty), direction 'watchlist', conviction 0.3. Skip companies mentioned only in passing, indexes, ETFs, crypto and private companies. Never 'buy' or 'sell': the newsletter reports news, it does not recommend trades. Send at most one signal per ticker and direction per run, taken from the newest qualifying email.
ingest_signal fields: source = this source's slug; symbol = the ticker; direction = 'watchlist'; conviction = 0.3; valid_from = the email's sent time as ISO 8601 with its offset; valid_until = valid_from + 7 days, same format; headline = the story's headline or a one-line summary of it; tags = ['robinhood_snacks']. Leave raw_url out. Never use the current time for valid_from or valid_until: they come from the email, so a repeated run sends identical values. Re-sending an identical signal inside ingest's deduplication window is a no-op; outside it a new signal is created.
If the content does not have this shape, ingest nothing and tell the operator.
```

## Rejected Alternatives

- `R-1` `optional string` (explicit presence) — rejected: no caller needs the distinction; adds `string | undefined` and `HasField` plumbing.
- `R-2` Bump `version` on the four system templates — rejected: breaks the 016 assertion (`version = 1`) and 016's down; legacy instances are covered by the default text.
- `R-3` A shared / generated five-type "mediated" constant — rejected: three languages; a prefix test cannot drop a type.
- `R-4` Serve `signal_extraction.md` as an MCP prompt — rejected: beyond the spec; docstrings and responses already reach every caller.
- `R-5` Seed the template prose in a separate migration 018 — rejected: column and prose must ship together.
- `R-6` Treat a maskless `""` as "omitted" — rejected by the user: a one-off rule that protects no caller.
- `R-7` Normalize existing mediated rows' `extractor_module` in SQL — rejected: an UPDATE on user-owned rows nobody reads; the down could not restore it.
- `R-8` Return a server timestamp from `list_signal_sources` — declined by the user: outside the spec; a possible follow-up feature.

## Open Risks

- [ ] Feature 328 (`fix-agent-bearer-secret-orphan`) edits the same `manage_signal_source` / `instantiate_template` bodies; no merge-order row — whichever merges second rebases. — S4.
- [ ] Admin-authored mediated templates with no prose stop instantiating and cannot be updated until prose is added (D-12). — S3; note in the PR.
- [ ] An unpaginated `ListSignalSources` with maximum-length prose can exceed the default 4 MiB gRPC receive limit (≈60 maxed-out multibyte sources in one owner's list). No guard. — follow-up if it occurs.
- [ ] A host that knows only the date, with no clock tool, ingests nothing from mediated sources (R-8). — operator guidance in the runbook, S4.
- [ ] The 7-day watchlist expiry does not reach an existing open-ended SIGNAL entry or a MANUAL entry, and a later watchlist signal without `valid_until` untracks a tracked one (feature-281 behaviour). — out of scope; runbook pointer, S4.
- [ ] "Never ingested twice" holds only while `signals.dedup_window_hours` ≥ 24; the default text's 0.3 / 0.6 / 0.9 choice is still an LLM judgement; a new non-overlapping Form 4 filing creates a fresh watchlist signal (never an alert). — none.
- [ ] Within the dedup window a second, separate 8-K `sell` for the same ticker is swallowed as deduplicated (`valid_from` is never compared). Missed, never wrong. — none.
- [ ] Form 4 clusters are seen only inside one 100-entry fetch and the oldest-timestamp group is always dropped; SEC ticker mapping relies on the agent's own certainty (no lookup tool). — a CIK→ticker tool would be a follow-up feature.
- [ ] The seeded prose rests on external feed/page shapes checked on 2026-11-17; drift falls back to "ingest nothing and tell the operator". Prose in an applied migration can only be changed by a new migration and does not reach existing instances. — operator review of the five texts in the S2 PR is the last chance to edit them cheaply.
- [ ] Instances of the four templates created before 017 keep empty prose and get the generic default until the operator copies the template's text over (the default text tells the agent how). — none.
- [ ] A legacy mediated row's `extractor_module` `""` becomes `app.extractors.noop` on its next update. — stated in the ingest findings row, S3.
- [ ] `signal_extraction.md` is loaded by nothing at runtime; it is edited for consistency only. — none.

## Constitution Rules Touched

- `C-01` / `F-04` — honored by: every claim traces to recon.md or a code citation in debate.md; unfound items stayed in recon §Risks.
- `C-04` — not engaged: the new field is open prose, not a closed set.
- `C-07` — honored by: `017_…up.sql` + `.down.sql`, last ingest prefix + 1 (re-derive at spec time).
- `C-08` / `P-06` — honored by: S3, S4 carry their tests; S1's red is the two parity tests; S2's is `ingest-017.sql`.
- `C-09` — honored by: S1 runs `buf lint`, `buf breaking`, `./scripts/buf-gen.sh`.
- `C-10` — honored by: every surface that describes the tools changes in S4 (docstrings, runbook, prompt) under a parity test; `migration-rerun.py` updated with the migration; system templates change by migration only.
- `C-12` / `C-13` — honored by: UI fixtures + `INVENTORY.md` in S5; a mediated-source builder shared by two test files moves to that service's `conftest.py`.
- `C-14` — honored by: both consumer surfaces (agent tools, UI segments) have their own steps.
- `C-15` — honored by: `@AC-1..26` each have a named test home; ids are append-only.
- `C-16` — honored by: no existing rule changes (below).
- `C-18` — honored by: one field, one validator, one predicate per service; rejected mechanisms recorded as R-1..R-8; no size guard, no server clock.
- `P-01` / `P-02` / `P-04` — honored by: the orchestrator wrote everything and mediated six rounds; every gate decision is in context.md, including the round-cap override.
- `F-01` — honored by: 016 is not edited; 017 is new.
- `F-06` / `F-07` — not engaged: no pool change; the cap and the prose are contract constants, not runtime config.
- `F-11` — honored by: no Floor breach was raised in any round.

## Business Rules Touched (C-16)

- PRESERVE `@AC-6`, `@AC-7`, `@AC-18`, `@AC-11`, `@AC-12`, `@AC-40` `@feature-335` (`ingest/acceptance/seed-curated-templates.feature`) — not regressed by: 017 only adds a payload key to the same four rows, ships with the validation, and its down composes with 016's.
- PRESERVE `@AC-1..3` `@feature-269` (`ingest/acceptance/fix-template-update-metadata.feature`) — not regressed by: RETIRE is never validated; fixtures are non-mediated.
- PRESERVE `@AC-1`, `@AC-2`, `@AC-6` `@feature-166`; `@AC-7`, `@AC-8` `@feature-224` (ingest) — not regressed by: non-mediated sources need no prose; validation fails closed after the existing checks.
- PRESERVE `@AC-9`, `@AC-1`, `@AC-3` `@feature-161` (`agent/acceptance/surface-signal-weight-decay-config.feature`) — not regressed by: the parity tests are updated in S1; INVALID_ARGUMENT still surfaces as a tool error.
- EXTEND `@AC-2`, `@AC-10` `@feature-161` — new case added: `extraction_instructions` is in the update mask only when supplied.
- PRESERVE `@AC-25` `@feature-224`, `@AC-30` `@feature-335`, `@AC-4` `@feature-241` (agent) — not regressed by: no tool added or removed; bearer path untouched.
- PRESERVE `@AC-4`, `@AC-5` `@feature-161`, `@AC-6` `@feature-270`, `@AC-29` `@feature-335`, `@AC-24` `@feature-224` (ui) — not regressed by: the weight field stays; reactivate / deactivate are not validated; system templates stay read-only.
- PRESERVE `platform.feature` `@AC-22`, `@AC-19`, `@AC-24`, `@AC-26` `@feature-335`; `@AC-36`, `@AC-26`, `@AC-35`, `@AC-32` `@feature-224`; `@AC-39` `@feature-294` — not regressed by: row set and ownership unchanged; PERMISSION_DENIED / ALREADY_EXISTS keep precedence; the instantiate failure label stays in the closed set.
