Feature: ui-env-themed-bundles
  As an operator, I want the xstockstrat-ui to be built as separate bundles for staging and
  production, each with its own visual theme, so the two environments are instantly
  distinguishable — without changing any content or behavior.

  @AC-1 @FR-1 @FR-2 @FR-4
  Scenario: Production build compiles only the production palette
    Given the UI is built with UI_THEME="production"
    When the emitted CSS under .next/static/css is inspected
    Then it contains the --primary color from src/styles/themes/production.css (literal pinned from design.md)
    And it does not contain the Nocturne --primary color oklch(0.432 0.095 166.913)

  @AC-2 @FR-1 @FR-2 @FR-3
  Scenario: Staging build compiles exactly the Nocturne palette
    Given the UI is built with UI_THEME="staging"
    When the emitted CSS under .next/static/css is inspected
    Then every Nocturne :root token value from main-dev@9eaf04f globals.css:87-125 (for example --primary oklch(0.432 0.095 166.913) and --background oklch(0.147 0.004 49.25)) is present as the same color
    And no color that exists only in src/styles/themes/production.css is present

  @AC-3 @FR-7
  Scenario: Unset UI_THEME defaults to staging
    Given UI_THEME is not set
    When the UI is built
    Then the emitted CSS contains the Nocturne --primary color oklch(0.432 0.095 166.913)

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

  @AC-7 @FR-8 @FR-11
  Scenario: Bundles differ only in theme tokens
    Given the /trader and /insights pages rendered from a staging build and from a production build
    When their accessibility trees and visible text are compared
    Then they are identical
    And the computed background-color of <body> differs between the two

  @AC-8 @FR-4 @FR-9
  Scenario: Production theme meets the contrast baseline and charts render
    Given the UI is built with UI_THEME="production"
    When the /trader page with a price chart is loaded
    Then foreground/background and primary-foreground/primary token pairs have contrast ratio >= 4.5:1 (exact ratios pinned from design.md)
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

  @AC-11 @FR-9
  Scenario: Staging theme charts still render
    Given the UI is built with UI_THEME unset
    When the /trader page with a price chart is loaded
    Then the chart canvas renders without a "Failed to parse color" error

  @AC-12 @FR-11
  Scenario: /insights charts follow the selected theme
    Given a production build and a staging build
    When /insights/strategies/<id> renders the equity curve
    Then the first series stroke resolves to that build's --chart-1 color
    And no non-comment line in src/**/*.ts or src/**/*.tsx outside src/components/ui and *.test.ts matches /hsl\(\s*\d|oklch\(|#[0-9a-fA-F]{6}\b/
    And src/components/ui/sidebar.tsx no longer contains "hsl(var(--sidebar-border))"

  @AC-13 @FR-12
  Scenario: PWA chrome color follows the theme
    Given the UI is built with UI_THEME="production"
    When /manifest.webmanifest and the /trader <meta name="theme-color"> are fetched
    Then theme_color, background_color and the meta content equal the --background of src/styles/themes/production.css converted to #rrggbb (literal pinned from design.md)
    And the manifest still has display "standalone", the 192 and 512 icons, and Cache-Control "no-cache"

  @AC-14 @FR-13
  Scenario: Production palette meets the documented contrast baseline
    Given src/styles/themes/production.css
    When every X/X-foreground pair plus primary, muted-foreground and destructive as text on background and on card are evaluated
    Then each text pair is >= 4.5:1 and ring on background is >= 3:1

  @AC-15 @FR-14
  Scenario: A tag cannot be re-themed
    Given ghcr.io/davcs86/xstockstrat/xstockstrat-ui:abc1234 exists with label io.xstockstrat.ui-theme="production"
    When docker-build.yml builds xstockstrat-ui for image_tag "abc1234" with ui_theme "staging"
    Then the job fails with "refusing to re-theme" before pushing, and the existing tag's digest is unchanged

  @AC-16 @FR-14
  Scenario Outline: Deploy paths enforce the UI theme label
    Given xstockstrat-ui:abc1234 carries theme label "<label>"
    When <workflow> targets environment "<target>" with image_tag "abc1234"
    Then the run <outcome> before deploying

    Examples:
      | workflow       | label      | target     | outcome                                                |
      | deploy-homelab | production | staging    | fails, naming "production" and "staging"               |
      | deploy-homelab | staging    | production | fails, naming "staging" and "production"               |
      | deploy-homelab | staging    | staging    | proceeds                                               |
      | deploy-homelab | <none>     | staging    | proceeds with no warning                               |
      | deploy-homelab | <none>     | production | proceeds and logs a warning naming the unlabelled image |
      | staging-up     | production | staging    | fails, naming "production" and "staging"               |
      | staging-up     | staging    | staging    | proceeds                                               |
      | prod-up        | staging    | production | fails, naming "staging" and "production"               |
      | prod-up        | production | production | proceeds                                               |
      | prod-up        | <none>     | production | proceeds and logs a warning naming the unlabelled image |

  @AC-17 @FR-13
  Scenario: Staging contrast shortfalls are recorded, not fixed
    Given docs/patterns/ui-ux-governance.md §5 and src/styles/themes/staging.css
    When the §5 known-deviations list is read
    Then it names every staging pair below its threshold with its ratio, including primary as text on background (about 2.4:1)
    And it states that staging values are frozen per FR-3
    And the contrast unit test asserts exactly that listed set of staging failures, no more and no fewer
