Feature: mediated-source-extraction-instructions
  As an operator whose LLM agents consume mediated_* signal sources over MCP, I want each mediated
  source to carry its extraction logic as prose and to stop presenting an extractor module, so that
  a consuming agent knows what to extract instead of concluding there is no work.

  @AC-1 @FR-1 @FR-3
  Scenario: A mediated source registers with prose and no extractor module
    Given no signal source with slug "whale_alerts" exists for the caller
    When the caller registers source "whale_alerts" of type "mediated_simple_email" with config_json {"sender_patterns": ["alerts@example.com"], "subject_patterns": ["*"]}, extraction_instructions "Each bolded ticker with a call sweep over $1M is a buy signal." and no extractor_module
    Then the register succeeds
    And ingest ListSignalSources returns "whale_alerts" with extraction_instructions "Each bolded ticker with a call sweep over $1M is a buy signal."
    And ingest ListSignalSources returns "whale_alerts" with extractor_module "app.extractors.noop"

  @AC-2 @FR-2
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

  @AC-3 @FR-4
  Scenario: A partial update preserves instructions that are not supplied
    Given a mediated source "whale_alerts" with extraction_instructions "Each bolded ticker is a buy signal." and reliability_weight 1.0
    When the caller updates "whale_alerts" supplying only reliability_weight 0.5
    Then the source has reliability_weight 0.5
    And the source still has extraction_instructions "Each bolded ticker is a buy signal."

  @AC-4 @FR-4
  Scenario: A partial update replaces instructions that are supplied
    Given a mediated source "whale_alerts" with extraction_instructions "Each bolded ticker is a buy signal."
    When the caller updates "whale_alerts" supplying only extraction_instructions "Only tickers under the heading 'New positions' are buy signals."
    Then the source has extraction_instructions "Only tickers under the heading 'New positions' are buy signals."

  @AC-5 @FR-5
  Scenario: A mediated source that predates the field keeps working
    Given a mediated source "robinhood_snacks" of type "mediated_simple_email" stored with extraction_instructions ""
    When the caller updates "robinhood_snacks" supplying only display_name "Snacks"
    Then the update succeeds
    And ingest ListSignalSources returns "robinhood_snacks" with display_name "Snacks" and extraction_instructions ""

  @AC-6 @FR-6
  Scenario: Listing a mediated source returns its stored instructions
    Given a mediated source "whale_alerts" with extraction_instructions "Each bolded ticker is a buy signal."
    When an agent calls list_signal_sources
    Then the entry for "whale_alerts" has extraction_instructions "Each bolded ticker is a buy signal."
    And the entry for "whale_alerts" has extraction_instructions_is_default false

  @AC-7 @FR-6
  Scenario: Listing a mediated source without instructions returns the generic default text
    Given a mediated source "robinhood_snacks" stored with extraction_instructions ""
    When an agent calls list_signal_sources
    Then the entry for "robinhood_snacks" has extraction_instructions equal to the agent's fixed generic instruction text, which is not empty
    And the entry for "robinhood_snacks" has extraction_instructions_is_default true
    And the entry for "robinhood_snacks" does not contain the text "noop"

  @AC-8 @FR-6 @FR-7
  Scenario Outline: manage_signal_source responses for a mediated source carry instructions and no extractor module
    Given a mediated source "whale_alerts" with extraction_instructions "Each bolded ticker is a buy signal."
    When an agent calls manage_signal_source on "whale_alerts" with <call>
    Then the response has extraction_instructions "Each bolded ticker is a buy signal." and extraction_instructions_is_default false
    And the response has no "extractor_module" key

    Examples:
      | call                                               |
      | operation "update" and reliability_weight 0.5     |
      | operation "deactivate"                             |
      | operation "reactivate"                             |

  @AC-9 @FR-7 @FR-11
  Scenario: Instantiating a seeded mediated template inherits its instructions
    Given the system template "tpl-robinhood_snacks" of kind signal_source and type "mediated_simple_email"
    When an agent instantiates it as "my_snacks"
    Then the instantiate succeeds
    And the returned source has a non-empty extraction_instructions equal to the template payload's extraction_instructions and extraction_instructions_is_default false
    And the returned source has no "extractor_module" key

  @AC-10 @FR-8
  Scenario: A non-mediated source still carries its extractor module
    Given no signal source with slug "ext_feed" exists for the caller
    When an agent calls manage_signal_source with operation "register", slug "ext_feed", source_type "mcp_client", extractor_module "app.extractors.mcp_client", config_json {"mcp_endpoint": "https://mcp.example.com/mcp", "mcp_tool": "get_signals"} and bearer_token "t0ken"
    Then the response has extractor_module "app.extractors.mcp_client"
    And the response has no "extraction_instructions" key and no "extraction_instructions_is_default" key

  @AC-11 @FR-9
  Scenario: The signal-source form swaps the extractor module input for instructions on a mediated type
    Given the operator opens the new-source form on /insights/signal-sources
    When the operator selects source type "mediated_simple_email"
    Then an "Extraction instructions" input is shown
    And no "Extractor Module" input is shown

  @AC-12 @FR-9
  Scenario: The signal-source form keeps the extractor module input on a non-mediated type
    Given the operator opens the new-source form on /insights/signal-sources
    When the operator selects source type "simple_email"
    Then an "Extractor Module" input is shown
    And no "Extraction instructions" input is shown

  @AC-13 @FR-9
  Scenario: The signal-source form blocks a mediated source with no instructions
    Given the operator opens the new-source form on /insights/signal-sources and selects source type "mediated_simple_email"
    When the operator submits the form with "Extraction instructions" empty
    Then no register request is sent
    And the form shows the message "Extraction instructions are required"

  @AC-14 @FR-9
  Scenario: The template form offers extraction instructions for a signal-source template
    Given an admin edits a signal_source template of type "mediated_simple_website" with config_json {"url": "https://example.com/feed", "scrape_selector": "main"} on /config-ui/templates
    When the admin enters "Each 8-K item 2.02 entry is an earnings signal." in "Extraction instructions" and saves
    Then reopening the template shows "Each 8-K item 2.02 entry is an earnings signal." in "Extraction instructions"

  @AC-15 @FR-10
  Scenario: The agent prompt and runbook describe the field
    Given the agent's signal_extraction prompt and docs/runbooks/mcp-tools.md
    When either is read
    Then each contains the field names "extraction_instructions" and "extraction_instructions_is_default"
    And neither tells the agent to provide "extractor_module" for a mediated source

  @AC-16 @FR-11
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

  @AC-17 @FR-12
  Scenario: Clearing instructions on a mediated source is rejected
    Given a mediated source "whale_alerts" with extraction_instructions "Each bolded ticker is a buy signal."
    When the caller updates "whale_alerts" supplying only extraction_instructions ""
    Then the update fails with INVALID_ARGUMENT
    And the source still has extraction_instructions "Each bolded ticker is a buy signal."

  @AC-18 @FR-13
  Scenario: Instructions on a non-mediated source are rejected
    Given no signal source with slug "plain_mail" exists for the caller
    When the caller registers source "plain_mail" of type "simple_email" with config_json {"sender_patterns": ["a@example.com"], "subject_patterns": ["*"]}, extractor_module "app.extractors.example_simple_email" and extraction_instructions "Each ticker is a buy."
    Then the register fails with INVALID_ARGUMENT
    And no signal source with slug "plain_mail" exists for the caller

  @AC-19 @FR-14
  Scenario Outline: The instruction length cap is 16,000 characters
    Given no signal source with slug "long_prose" exists for the caller
    When the caller registers source "long_prose" of type "mediated_simple_email" with config_json {"sender_patterns": ["a@example.com"], "subject_patterns": ["*"]} and extraction_instructions of <length> characters
    Then the register <outcome>

    Examples:
      | length | outcome                     |
      | 16000  | succeeds                    |
      | 16001  | fails with INVALID_ARGUMENT |

  @AC-20 @FR-3
  Scenario: A supplied extractor module is overridden on a mediated source
    Given a mediated source "robinhood_snacks" stored with extractor_module "app.extractors.noop"
    When the caller updates "robinhood_snacks" supplying extractor_module "app.extractors.example_simple_email"
    Then the update succeeds
    And ingest ListSignalSources returns "robinhood_snacks" with extractor_module "app.extractors.noop"

  @AC-21 @FR-13
  Scenario: Adding instructions to a non-mediated source by update is rejected
    Given a source "plain_mail" of type "simple_email" stored with extraction_instructions ""
    When the caller updates "plain_mail" supplying only extraction_instructions "Each ticker is a buy."
    Then the update fails with INVALID_ARGUMENT
    And ingest ListSignalSources returns "plain_mail" with extraction_instructions ""

  @AC-22 @FR-14
  Scenario: The length cap applies on update
    Given a source "whale_alerts" of type "mediated_simple_email" with extraction_instructions "Each bolded ticker is a buy signal."
    When the caller updates "whale_alerts" supplying only extraction_instructions of 16001 characters
    Then the update fails with INVALID_ARGUMENT
    And the source still has extraction_instructions "Each bolded ticker is a buy signal."

  @AC-23 @FR-5 @FR-12
  Scenario: A whitespace-only value on a legacy empty mediated source is rejected
    Given a source "robinhood_snacks" of type "mediated_simple_email" stored with extraction_instructions ""
    When the caller updates "robinhood_snacks" supplying only extraction_instructions "   "
    Then the update fails with INVALID_ARGUMENT
