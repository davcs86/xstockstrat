Feature: fix-template-update-metadata (bug fix)
  Regression guard for docs/reports/2026-10-21-template-update-metadata-defect.md:
  ManageTemplate UPDATE drops name/description (indicators, analysis), and RETIRE / empty-id CREATE diverge (D-41).

  @AC-1 @regression
  Scenario Outline: An admin rename of a template is persisted
    Given an admin and a <kind> template "t-1" named "Old" with description "d1" at version 1 in <service>
    When the admin calls ManageTemplate UPDATE on "t-1" with name "New", description "d2" and the same payload
    Then ListTemplates on <service> returns "t-1" with name "New" and description "d2"

    Examples:
      | kind     | service                |
      | FORMULA  | xstockstrat-indicators |
      | STRATEGY | xstockstrat-analysis   |
      | SIGNAL_SOURCE | xstockstrat-ingest     |

  @AC-2 @regression
  Scenario: Retiring a template twice keeps the same retired_at semantics in every service
    Given a template "t-1" in each of indicators, analysis and ingest
    When the admin retires "t-1" at 2026-10-21T10:00:00Z and again at 2026-10-21T11:00:00Z in each service
    Then all three services report the same retired_at rule for "t-1" (the agreed first-wins or last-wins value)
    And all three set updated_at on retire

  @AC-3 @regression
  Scenario: CREATE with an empty template_id behaves the same in every service
    Given an admin
    When the admin calls ManageTemplate CREATE with template_id "" and a valid payload on indicators, analysis and ingest
    Then all three services apply the same agreed outcome (all mint an id, or all return INVALID_ARGUMENT)
