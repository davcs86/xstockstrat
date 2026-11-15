Feature: fix-commsgun-email-channel (bug fix)
  Regression guard for the feature-338 commsgun email defects logged 2026-11-15
  in services/xstockstrat-notify/docs/context-constitution-findings.md.

  @AC-1 @regression
  Scenario: A non-https enqueue URL counts as an unset URL
    Given commsgun.enqueue_url is "http://comms.example/enqueue" and commsgun.app_id and commsgun.to_email are set
    When notify reads the commsgun settings
    Then the base is not configured
    And a pinned commsgun dispatch is "unconfigured" and no enqueue request is made

  @AC-2 @regression
  Scenario: The email subject carries no CR/LF and is at most 998 characters
    Given an alert with severity "WARNING" and a title holding a line break and 2000 characters
    When the email is rendered
    Then the subject contains no CR or LF
    And the subject is at most 998 characters long

  @AC-3 @regression
  Scenario: Pinned commsgun mode raises the standing app-key incident
    Given fanout.email_provider is "commsgun", the base is set and commsgun.app_key is not set
    When a commsgun worker tick runs
    Then one WARNING alert "Commsgun is set up but its app key is not available" is raised

  @AC-4 @regression
  Scenario: A 408 from the enqueue endpoint is retried
    Given the commsgun enqueue endpoint answers 408
    When the answer is classified
    Then the row is retried, not ended
