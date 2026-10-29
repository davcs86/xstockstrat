Feature: fix-template-update-metadata (bug fix)
  Regression guard for docs/reports/2026-10-21-template-update-metadata-defect.md:
  ManageTemplate UPDATE drops name/description (indicators, analysis), and RETIRE / empty-id CREATE diverge (D-41).

  @AC-1 @FR-1 @FR-2 @regression
  Scenario Outline: An admin rename of a template is persisted and bumps the version once
    Given an admin and a <kind> template "t-1" named "Old" with description "d1" at version 1 in <service>
    When the admin calls ManageTemplate UPDATE on "t-1" with name "New", description "d2" and the same payload
    Then the UPDATE response returns "t-1" with name "New", description "d2" and version 2
    And ListTemplates on <service> returns "t-1" with name "New", description "d2" and version 2

    Examples:
      | kind          | service                |
      | FORMULA       | xstockstrat-indicators |
      | STRATEGY      | xstockstrat-analysis   |
      | SIGNAL_SOURCE | xstockstrat-ingest     |

  @AC-2 @FR-3 @FR-4 @regression
  Scenario Outline: Retiring a template twice keeps the first retired_at and sets updated_at each time
    Given an admin and a <kind> template "t-1" in <service>
    When the admin retires "t-1"
    And the admin retires "t-1" again
    Then the second RETIRE succeeds and returns "t-1" as retired
    And "t-1" in <service> keeps the retired_at set by the first RETIRE
    And "t-1" in <service> has an updated_at later than that retired_at

    Examples:
      | kind          | service                |
      | FORMULA       | xstockstrat-indicators |
      | STRATEGY      | xstockstrat-analysis   |
      | SIGNAL_SOURCE | xstockstrat-ingest     |

  @AC-3 @FR-5 @regression
  Scenario Outline: CREATE with an empty template_id is rejected
    Given an admin
    When the admin calls ManageTemplate CREATE on <service> with a <kind> template, template_id "" and a valid payload
    Then the call fails with INVALID_ARGUMENT
    And ListTemplates on <service> returns no new <kind> template

    Examples:
      | kind          | service                |
      | FORMULA       | xstockstrat-indicators |
      | STRATEGY      | xstockstrat-analysis   |
      | SIGNAL_SOURCE | xstockstrat-ingest     |
