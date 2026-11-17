# Promoted from docs/roadmap/features/355-mediated-source-extraction-instructions/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-355` tag.
# Source: @AC-11..14 — UI scenarios. A rule enters only by promotion, never by hand-authoring.

Feature: mediated-source-extraction-instructions (ui)
  Acceptance scenarios for the xstockstrat-ui service promoted from feature 355. Covers the
  /insights/signal-sources form (extraction instructions vs extractor module by source type, and
  the required-instructions block) and the /config-ui/templates signal-source template form.

  @AC-11 @FR-9 @feature-355
  Scenario: The signal-source form swaps the extractor module input for instructions on a mediated type
    Given the operator opens the new-source form on /insights/signal-sources
    When the operator selects source type "mediated_simple_email"
    Then an "Extraction instructions" input is shown
    And no "Extractor Module" input is shown

  @AC-12 @FR-9 @feature-355
  Scenario: The signal-source form keeps the extractor module input on a non-mediated type
    Given the operator opens the new-source form on /insights/signal-sources
    When the operator selects source type "simple_email"
    Then an "Extractor Module" input is shown
    And no "Extraction instructions" input is shown

  @AC-13 @FR-9 @feature-355
  Scenario: The signal-source form blocks a mediated source with no instructions
    Given the operator opens the new-source form on /insights/signal-sources and selects source type "mediated_simple_email"
    When the operator submits the form with "Extraction instructions" empty
    Then no register request is sent
    And the form shows the message "Extraction instructions are required"

  @AC-14 @FR-9 @feature-355
  Scenario: The template form offers extraction instructions for a signal-source template
    Given an admin edits a signal_source template of type "mediated_simple_website" with config_json {"url": "https://example.com/feed", "scrape_selector": "main"} on /config-ui/templates
    When the admin enters "Each 8-K item 2.02 entry is an earnings signal." in "Extraction instructions" and saves
    Then reopening the template shows "Each 8-K item 2.02 entry is an earnings signal." in "Extraction instructions"
