# Promoted from docs/roadmap/features/355-mediated-source-extraction-instructions/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-355` tag.
# Source: @AC-6..10, 15, 24, 27 — MCP agent contract scenarios. A rule enters only by promotion, never by hand-authoring.

Feature: mediated-source-extraction-instructions (agent)
  Acceptance scenarios for the xstockstrat-agent service promoted from feature 355. Covers the
  extraction_instructions / extraction_instructions_is_default fields on list_signal_sources,
  manage_signal_source and instantiate_template responses, the absence of extractor_module for
  mediated sources, the update-mask rule for the field, and the prompt/runbook parity.

  @AC-6 @FR-6 @feature-355
  Scenario: Listing a mediated source returns its stored instructions
    Given a mediated source "whale_alerts" with extraction_instructions "Each bolded ticker is a buy signal."
    When an agent calls list_signal_sources
    Then the entry for "whale_alerts" has extraction_instructions "Each bolded ticker is a buy signal."
    And the entry for "whale_alerts" has extraction_instructions_is_default false

  @AC-7 @FR-6 @feature-355
  Scenario: Listing a mediated source without instructions returns the generic default text
    Given a mediated source "robinhood_snacks" stored with extraction_instructions ""
    When an agent calls list_signal_sources
    Then the entry for "robinhood_snacks" has extraction_instructions equal to the agent's fixed generic instruction text, which is not empty
    And the entry for "robinhood_snacks" has extraction_instructions_is_default true
    And the entry for "robinhood_snacks" does not contain the text "noop"

  @AC-8 @FR-6 @FR-7 @feature-355
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

  @AC-9 @FR-7 @FR-11 @feature-355
  Scenario: Instantiating a seeded mediated template inherits its instructions
    Given the system template "tpl-robinhood_snacks" of kind signal_source and type "mediated_simple_email"
    When an agent instantiates it as "my_snacks"
    Then the instantiate succeeds
    And the returned source has a non-empty extraction_instructions equal to the template payload's extraction_instructions and extraction_instructions_is_default false
    And the returned source has no "extractor_module" key

  @AC-10 @FR-8 @feature-355
  Scenario: A non-mediated source still carries its extractor module
    Given no signal source with slug "ext_feed" exists for the caller
    When an agent calls manage_signal_source with operation "register", slug "ext_feed", source_type "mcp_client", extractor_module "app.extractors.mcp_client", config_json {"mcp_endpoint": "https://mcp.example.com/mcp", "mcp_tool": "get_signals"} and bearer_token "t0ken"
    Then the response has extractor_module "app.extractors.mcp_client"
    And the response has no "extraction_instructions" key and no "extraction_instructions_is_default" key

  @AC-15 @FR-10 @feature-355
  Scenario: The agent prompt and runbook describe the field
    Given the agent's signal_extraction prompt and docs/runbooks/mcp-tools.md
    When either is read
    Then each contains the field names "extraction_instructions" and "extraction_instructions_is_default"
    And neither tells the agent to provide "extractor_module" for a mediated source

  @AC-24 @FR-6 @feature-355
  Scenario: A mediated list entry carries its template origin and a non-mediated one does not
    Given a source "my_snacks" of type "mediated_simple_email" instantiated from template "tpl-robinhood_snacks"
    And a source "ext_feed" of type "mcp_client"
    When an agent calls list_signal_sources
    Then the entry for "my_snacks" has origin.template_id "tpl-robinhood_snacks"
    And the entry for "ext_feed" has no "origin" key

  @AC-27 @FR-4 @feature-355
  Scenario Outline: manage_signal_source names extraction_instructions in the update mask only when supplied
    Given a mediated source "whale_alerts" exists with display_name "Whale" and extraction_instructions "Each bolded ticker is a buy signal."
    When an agent calls manage_signal_source with operation "update", slug "whale_alerts" and <supplied>
    Then the ManageSignalSource request's update_mask paths are exactly "<mask>"

    Examples:
      | supplied                                                                  | mask                    |
      | display_name "Whale Alerts" and no extraction_instructions                | display_name            |
      | extraction_instructions "Only 'New positions' tickers are buy signals."   | extraction_instructions |
