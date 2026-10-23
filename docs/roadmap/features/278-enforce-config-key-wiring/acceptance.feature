Feature: enforce-config-key-wiring
  As a platform maintainer, I want the execution/validation loop and CI to prove that every planned config key is read under its stored key, so that a seeded key cannot be inert or a read key unseeded.

  @AC-1 @FR-1
  Scenario: A key seeded bare but read dotted is reported as a form mismatch
    Given a config migration seeds namespace "ingest" with key "mcp_client.request_timeout_seconds"
    And ingest code reads the key "ingest.mcp_client.request_timeout_seconds"
    When the wiring check runs
    Then it reports one finding of kind "form-mismatch" naming both strings

  @AC-2 @FR-1
  Scenario: A seeded key that no code reads is reported as unread
    Given a config migration seeds namespace "ledger" with key "stream.notify_enabled"
    And no service code reads "stream.notify_enabled" or "ledger.stream.notify_enabled"
    When the wiring check runs
    Then it reports one finding of kind "seeded-unread" for "ledger" "stream.notify_enabled"

  @AC-3 @FR-1
  Scenario: A key that code reads but no migration seeds is reported as unseeded
    Given ingest code reads the key "ingest.backfill.retry_on_failure"
    And no config migration seeds it
    When the wiring check runs
    Then it reports one finding of kind "read-unseeded" for "ingest.backfill.retry_on_failure"

  @AC-4 @FR-2
  Scenario: An execute step that seeds a key is not marked done while its key has a finding
    Given a "config" step declares the key "analysis.fundsignal.enabled"
    And the wiring check reports a finding for "analysis.fundsignal.enabled"
    When /sdd-execute validates the step
    Then the step stays not-done
    And the output names the finding and the key

  @AC-5 @FR-2
  Scenario: A step that touches no config key is not blocked by unrelated findings
    Given the wiring check reports a finding for "ledger.stream.notify_enabled"
    And an execute step changes only a Go handler and declares no config key
    When /sdd-execute validates the step
    Then the step is marked done

  @AC-6 @FR-3
  Scenario: An impl-spec with a config key but no reader step fails review
    Given a product spec lists the config key "analysis.fundsignal.enabled"
    And its implementation spec has no step naming the reader file and symbol for that key
    When /sdd-review reviews the implementation spec
    Then the review reports a failing finding for "analysis.fundsignal.enabled" requiring a reader step and a snapshot-built test

  @AC-7 @FR-4
  Scenario: CI fails on a new finding that is not in the baseline
    Given the baseline lists the 18 findings recorded in feature 277's context.md
    And a pull request seeds a key that no code reads
    When the CI wiring-check job runs
    Then the job fails and names the new finding

  @AC-8 @FR-4
  Scenario: A baseline entry without an owner is rejected
    Given a baseline entry for "ledger" "stream.notify_enabled" that names no owning defect or feature
    When the CI wiring-check job runs
    Then the job fails and names the entry
