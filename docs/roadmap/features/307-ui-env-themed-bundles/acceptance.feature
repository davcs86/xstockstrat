Feature: ui-env-themed-bundles
  As an operator, I want the xstockstrat-ui to be built as separate bundles for staging and
  production, each with its own visual theme, so the two environments are instantly
  distinguishable — without changing any content or behavior.

  @AC-1 @FR-1 @FR-2 @FR-4
  Scenario: Production build compiles only the production palette
    Given the UI is built with UI_THEME="production"
    When the emitted CSS under .next/static/css is inspected
    Then it contains the production --primary token value
    And it does not contain the Nocturne --primary token value

  @AC-2 @FR-1 @FR-2 @FR-3
  Scenario: Staging build compiles exactly the Nocturne palette
    Given the UI is built with UI_THEME="staging"
    When the emitted CSS under .next/static/css is inspected
    Then every Nocturne :root token value from main-dev's globals.css is present unchanged
    And no production-only token value is present

  @AC-3 @FR-7
  Scenario: Unset UI_THEME defaults to staging
    Given UI_THEME is not set
    When the UI is built
    Then the emitted CSS contains the Nocturne --primary token value

  @AC-4 @FR-7
  Scenario: Unknown UI_THEME fails the build
    Given UI_THEME="prod"
    When the UI is built
    Then the build exits non-zero with an error naming the allowed values "staging" and "production"

  @AC-5 @FR-5
  Scenario: Order-side semantic colors are identical across themes
    Given a staging bundle and a production bundle
    When the resolved --color-buy, --color-sell and --color-paper values are compared
    Then they equal hsl(159 52% 54%), hsl(359 63% 67%) and hsl(43 41% 64%) in both bundles

  @AC-6 @FR-6
  Scenario: Each deploy workflow ships its environment's themed image under unchanged tags
    Given a push to main-dev triggers deploy-dev.yml and a push to main triggers deploy-prod.yml
    When each run's xstockstrat-ui image is pulled and its .next/static/css is inspected
    Then the main-dev image (tags <short-sha>, latest-dev) contains the Nocturne --primary value
    And the main image (tags <short-sha>, latest) contains the production --primary value

  @AC-7 @FR-8
  Scenario: Bundles differ only in theme tokens
    Given the /trader page rendered from a staging build and from a production build
    When their accessibility trees and visible text are compared
    Then they are identical
    And the computed background-color of <body> differs between the two

  @AC-8 @FR-4 @FR-9
  Scenario: Production theme meets the contrast baseline and charts render
    Given the UI is built with UI_THEME="production"
    When the /trader page with a price chart is loaded
    Then foreground/background and primary-foreground/primary token pairs have contrast ratio >= 4.5:1
    And the chart canvas renders without a "Failed to parse color" error

  @AC-9 @FR-1
  Scenario: Docker image build honours the UI_THEME build arg
    Given `docker build --build-arg UI_THEME=production -f services/xstockstrat-ui/Dockerfile .`
    When the image's services/xstockstrat-ui/.next/static/css is inspected
    Then it contains the production --primary value and not the Nocturne --primary value

  @AC-10 @FR-10
  Scenario: Theme is identical regardless of runtime APPLICATION_ENV
    Given a staging-themed build
    When it is started once with APPLICATION_ENV="production" and once with APPLICATION_ENV="staging"
    Then the computed background-color of <body> on /trader is identical in both runs
