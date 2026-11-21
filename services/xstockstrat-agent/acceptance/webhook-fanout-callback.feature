# Promoted from docs/roadmap/features/334-webhook-fanout-callback/acceptance.feature at integration
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-334` tag.
# Durable business rules xstockstrat-agent guarantees for the trigger_backfill callback_url argument.
# A rule enters only by promotion from a reviewed feature acceptance.feature, never by hand-authoring.

Feature: xstockstrat-agent - the trigger_backfill callback_url argument is documented
    As an AI agent (or operator) that triggers a long-running backfill, I want to pass an optional
    callback_url to trigger_backfill and have xstockstrat deliver the job's terminal event to that URL
    at-least-once, so that I no longer have to poll get_backfill_status.

  @AC-22 @FR-11 @feature-334
  Scenario: the tool documentation and the strat-lab skill describe callback_url
    When a reader opens "docs/runbooks/mcp-tools.md" and the strat-lab "backtest" skill
    Then both name the "callback_url" argument of trigger_backfill and state that the URL must be https and allowlisted
