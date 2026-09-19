Feature: proto-deprecated-field-removal-program (tech-debt / breaking-change program)
  Draft acceptance for the removal of genuinely-dead deprecated proto fields
  (docs/reports/2026-09-18-deprecated-fields-in-rpc-contracts-defect.md, Defect 2).
  To be expanded during /sdd-design and /sdd-spec under proper proto approvals.

  @AC-1
  Scenario: a removed field's number is reserved
    Given a deprecated proto field verified to have no reader
    When it is removed from the .proto
    Then its field number is added to a reserved statement
    And buf breaking is satisfied via the documented v-migration workflow

  @AC-2
  Scenario: a field with a live reader is not removed
    Given portfolio.proto repeated string symbols has a live reader (live_loop legacy-row fallback)
    When the removal batch is planned
    Then that field is excluded until its legacy rows are migrated onto bindings

  @AC-3
  Scenario: enum-value removals are gated on a data audit
    Given an enum value with stored numeric values in persisted rows or in-flight messages
    When its removal is considered
    Then it is not removed until a data audit confirms no stored/in-flight value decodes to it

  @AC-4
  Scenario: a removed enum value's number is reserved
    Given a deprecated enum value cleared by the data audit for removal
    When it is removed from the enum
    Then its numeric value is added to a reserved statement (never silently reused by a later value)
