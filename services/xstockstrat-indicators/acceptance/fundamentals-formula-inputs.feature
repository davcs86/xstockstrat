# Promoted from docs/roadmap/features/201-fundamentals-formula-inputs/acceptance.feature
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-201` tag.
# Durable business rule: the indicators formula store validates a formula's declared fundamental
# inputs at write time. A rule enters only by promotion, never by hand-authoring.

Feature: xstockstrat-indicators - fundamental-input validation at formula registration
  RegisterFormula/UpdateFormula reject the zero-value FundamentalMetric sentinel in fundamental_inputs.

  @AC-6 @FR-7 @feature-201
  Scenario: A formula's declared fundamentals inputs are validated at formula-registration write time
    Given a RegisterFormula (or UpdateFormula) whose fundamental_inputs contains FUNDAMENTAL_METRIC_UNSPECIFIED (the zero-value sentinel)
    When the formula is written
    Then indicators rejects the write INVALID_ARGUMENT naming the unspecified fundamentals metric
    And a formula declaring only valid FundamentalMetric enum values (e.g. PE_RATIO, ROE) is accepted and can then be bound into a strategy component
    # Validation lives at indicators RegisterFormula/UpdateFormula because fundamental_inputs is a closed FundamentalMetric enum on FormulaDefinition (R3: relocated here from the ManageStrategy path; a closed enum makes a non-member structurally unrepresentable, so the only invalid value is the zero-value sentinel).
