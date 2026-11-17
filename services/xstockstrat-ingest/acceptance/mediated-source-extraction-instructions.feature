# Promoted from docs/roadmap/features/355-mediated-source-extraction-instructions/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-355` tag.
# Source: @AC-1..5, 16..23, 25, 26 — ingest scenarios. A rule enters only by promotion, never by hand-authoring.

Feature: mediated-source-extraction-instructions (ingest)
  Acceptance scenarios for the xstockstrat-ingest service promoted from feature 355. Covers
  registering, updating and templating mediated_* signal sources that carry extraction_instructions
  prose instead of an extractor module.

  @AC-1 @FR-1 @FR-3 @feature-355
  Scenario: A mediated source registers with prose and no extractor module
    Given no signal source with slug "whale_alerts" exists for the caller
    When the caller registers source "whale_alerts" of type "mediated_simple_email" with config_json {"sender_patterns": ["alerts@example.com"], "subject_patterns": ["*"]}, extraction_instructions "Each bolded ticker with a call sweep over $1M is a buy signal." and no extractor_module
    Then the register succeeds
    And ingest ListSignalSources returns "whale_alerts" with extraction_instructions "Each bolded ticker with a call sweep over $1M is a buy signal."
    And ingest ListSignalSources returns "whale_alerts" with extractor_module "app.extractors.noop"

  @AC-2 @FR-2 @feature-355
  Scenario Outline: A mediated source with empty instructions is rejected at registration
    Given no signal source with slug "no_prose" exists for the caller
    When the caller registers source "no_prose" of type "<source_type>" with config_json <config_json>, credentials_ref <credentials_ref> and extraction_instructions <instructions>
    Then the register fails with INVALID_ARGUMENT naming "extraction_instructions"
    And no signal source with slug "no_prose" exists for the caller

    Examples:
      | source_type                    | config_json                                                                                                     | credentials_ref  | instructions |
      | mediated_simple_email          | {"sender_patterns": ["a@example.com"], "subject_patterns": ["*"]}                                               | (none)           | ""           |
      | mediated_email_attachment      | {"sender_patterns": ["a@example.com"], "subject_patterns": ["*"], "attachment_mime_types": ["application/pdf"]} | (none)           | ""           |
      | mediated_linked_email          | {"sender_patterns": ["a@example.com"], "subject_patterns": ["*"], "url_patterns": ["https://example.com/*"]}    | (none)           | ""           |
      | mediated_simple_website        | {"url": "https://example.com/feed", "scrape_selector": "main"}                                                  | (none)           | ""           |
      | mediated_authenticated_website | {"url": "https://example.com/feed", "scrape_selector": "main"}                                                  | "cred-ref-1"     | ""           |
      | mediated_simple_email          | {"sender_patterns": ["a@example.com"], "subject_patterns": ["*"]}                                               | (none)           | "   "        |
      | mediated_simple_email          | {"sender_patterns": ["a@example.com"], "subject_patterns": ["*"]}                                               | (none)           | (omitted)    |

  @AC-3 @FR-4 @feature-355
  Scenario: A partial update preserves instructions that are not supplied
    Given a mediated source "whale_alerts" with extraction_instructions "Each bolded ticker is a buy signal." and reliability_weight 1.0
    When the caller updates "whale_alerts" supplying only reliability_weight 0.5
    Then the source has reliability_weight 0.5
    And the source still has extraction_instructions "Each bolded ticker is a buy signal."

  @AC-4 @FR-4 @feature-355
  Scenario: A partial update replaces instructions that are supplied
    Given a mediated source "whale_alerts" with extraction_instructions "Each bolded ticker is a buy signal."
    When the caller updates "whale_alerts" supplying only extraction_instructions "Only tickers under the heading 'New positions' are buy signals."
    Then the source has extraction_instructions "Only tickers under the heading 'New positions' are buy signals."

  @AC-5 @FR-5 @feature-355
  Scenario: A mediated source that predates the field keeps working
    Given a mediated source "robinhood_snacks" of type "mediated_simple_email" stored with extraction_instructions ""
    When the caller updates "robinhood_snacks" supplying only display_name "Snacks"
    Then the update succeeds
    And ingest ListSignalSources returns "robinhood_snacks" with display_name "Snacks" and extraction_instructions ""

  @AC-16 @FR-11 @feature-355
  Scenario Outline: Every seeded mediated template carries instructions
    Given the ingest migrations are applied
    When the system template "<template_id>" is read
    Then its payload has a non-empty extraction_instructions

    Examples:
      | template_id             |
      | tpl-sec_edgar_8k        |
      | tpl-sec_edgar_form4     |
      | tpl-prnewswire_releases |
      | tpl-robinhood_snacks    |

  @AC-17 @FR-12 @feature-355
  Scenario: Clearing instructions on a mediated source is rejected
    Given a mediated source "whale_alerts" with extraction_instructions "Each bolded ticker is a buy signal."
    When the caller updates "whale_alerts" supplying only extraction_instructions ""
    Then the update fails with INVALID_ARGUMENT
    And the source still has extraction_instructions "Each bolded ticker is a buy signal."

  @AC-18 @FR-13 @feature-355
  Scenario: Instructions on a non-mediated source are rejected
    Given no signal source with slug "plain_mail" exists for the caller
    When the caller registers source "plain_mail" of type "simple_email" with config_json {"sender_patterns": ["a@example.com"], "subject_patterns": ["*"]}, extractor_module "app.extractors.example_simple_email" and extraction_instructions "Each ticker is a buy."
    Then the register fails with INVALID_ARGUMENT
    And no signal source with slug "plain_mail" exists for the caller

  @AC-19 @FR-14 @feature-355
  Scenario Outline: The instruction length cap is 16,000 characters
    Given no signal source with slug "long_prose" exists for the caller
    When the caller registers source "long_prose" of type "mediated_simple_email" with config_json {"sender_patterns": ["a@example.com"], "subject_patterns": ["*"]} and extraction_instructions of <length> characters
    Then the register <outcome>

    Examples:
      | length | outcome                     |
      | 16000  | succeeds                    |
      | 16001  | fails with INVALID_ARGUMENT |

  @AC-20 @FR-3 @feature-355
  Scenario: A supplied extractor module is overridden on a mediated source
    Given a mediated source "robinhood_snacks" stored with extractor_module "app.extractors.noop"
    When the caller updates "robinhood_snacks" supplying extractor_module "app.extractors.example_simple_email"
    Then the update succeeds
    And ingest ListSignalSources returns "robinhood_snacks" with extractor_module "app.extractors.noop"

  @AC-21 @FR-13 @feature-355
  Scenario: Adding instructions to a non-mediated source by update is rejected
    Given a source "plain_mail" of type "simple_email" stored with extraction_instructions ""
    When the caller updates "plain_mail" supplying only extraction_instructions "Each ticker is a buy."
    Then the update fails with INVALID_ARGUMENT
    And ingest ListSignalSources returns "plain_mail" with extraction_instructions ""

  @AC-22 @FR-14 @feature-355
  Scenario: The length cap applies on update
    Given a source "whale_alerts" of type "mediated_simple_email" with extraction_instructions "Each bolded ticker is a buy signal."
    When the caller updates "whale_alerts" supplying only extraction_instructions of 16001 characters
    Then the update fails with INVALID_ARGUMENT
    And the source still has extraction_instructions "Each bolded ticker is a buy signal."

  @AC-23 @FR-5 @FR-12 @feature-355
  Scenario: A whitespace-only value on a legacy empty mediated source is rejected
    Given a source "robinhood_snacks" of type "mediated_simple_email" stored with extraction_instructions ""
    When the caller updates "robinhood_snacks" supplying only extraction_instructions "   "
    Then the update fails with INVALID_ARGUMENT

  @AC-25 @FR-15 @feature-355
  Scenario Outline: A signal-source template payload obeys the instruction rules
    Given an admin caller
    When the admin creates signal_source template "tpl-x" with payload source_type "<source_type>", config_json <config_json> and extraction_instructions <instructions>
    Then the create fails with INVALID_ARGUMENT naming "extraction_instructions"
    And no template "tpl-x" exists

    Examples:
      | source_type           | config_json                                                       | instructions                |
      | mediated_simple_email | {"sender_patterns": ["a@example.com"], "subject_patterns": ["*"]} | ""                          |
      | simple_email          | {"sender_patterns": ["a@example.com"], "subject_patterns": ["*"]} | "Each ticker is a buy."     |
      | mediated_simple_email | {"sender_patterns": ["a@example.com"], "subject_patterns": ["*"]} | a text of 16001 characters  |

  @AC-26 @FR-13 @feature-355
  Scenario: A whitespace-only value on a non-mediated source is stored as empty
    Given no signal source with slug "plain_mail" exists for the caller
    When the caller registers source "plain_mail" of type "simple_email" with config_json {"sender_patterns": ["a@example.com"], "subject_patterns": ["*"]}, extractor_module "app.extractors.example_simple_email" and extraction_instructions "   "
    Then the register succeeds
    And ingest ListSignalSources returns "plain_mail" with extraction_instructions ""
