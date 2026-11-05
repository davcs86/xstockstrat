# Promoted from docs/roadmap/features/279-homelab-compose-deploy/acceptance.feature at archive time
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-279` tag.
# Durable regression guard: the trading gRPC health service must not answer before init has finished.
# A rule enters only by promotion from a reviewed feature acceptance.feature, never by hand-authoring.

Feature: homelab-compose-deploy (trading readiness guarantee)
  Regression guard for the homelab gate's health-gated rollback: a Go service reports healthy only
  after its config snapshot and init are complete.

  @AC-17 @FR-5 @feature-279
  Scenario: A Go service is not healthy before its init has finished
    Given xstockstrat-trading is still waiting for its config snapshot
    When "service healthcheck" runs inside the container
    Then it exits 1, because nothing listens on 127.0.0.1:50051 until init completes
