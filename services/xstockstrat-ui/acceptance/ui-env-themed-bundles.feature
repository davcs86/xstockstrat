# Promoted from docs/roadmap/features/307-ui-env-themed-bundles/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-307` tag.
# Durable business rules the ui service already guarantees — do not hand-edit to document new
# behavior; a rule enters only by promotion from a reviewed feature acceptance.feature.

Feature: Per-environment themed UI bundles in xstockstrat-ui
  The UI is built as separate staging and production bundles, each with its own visual theme selected
  at build time, without changing any content or behavior.

  @AC-1 @FR-1 @FR-2 @FR-4 @feature-307
  Scenario: Production build compiles only the production palette
    Given the UI is built with UI_THEME="production"
    When the emitted CSS under .next/static/css is inspected
    Then it contains the production --primary color oklch(0.63 0.16 262)
    And it does not contain the Nocturne --primary color oklch(0.432 0.095 166.913)

  @AC-2 @FR-1 @FR-2 @FR-3 @feature-307
  Scenario: Staging build compiles exactly the Nocturne palette
    Given the UI is built with UI_THEME="staging"
    When the emitted CSS under .next/static/css is inspected
    Then every Nocturne :root token value from main-dev@9eaf04f globals.css:87-125 (for example --primary oklch(0.432 0.095 166.913) and --background oklch(0.147 0.004 49.25)) is present as the same color
    And no color that exists only in src/styles/themes/production.css is present

  @AC-3 @FR-7 @feature-307
  Scenario: Unset UI_THEME defaults to staging
    Given UI_THEME is not set
    When the UI is built
    Then the emitted CSS contains the Nocturne --primary color oklch(0.432 0.095 166.913)

  @AC-4 @FR-7 @feature-307
  Scenario: Unknown UI_THEME fails the build
    Given UI_THEME="prod"
    When the UI is built
    Then the build exits non-zero with an error naming the allowed values "staging" and "production"

  @AC-5 @FR-5 @feature-307
  Scenario: Order-side semantic colors are identical across themes
    Given a staging bundle and a production bundle
    When the resolved --color-buy, --color-sell and --color-paper values are compared
    Then they equal hsl(159 52% 54%), hsl(359 63% 67%) and hsl(43 41% 64%) in both bundles

  @AC-7 @FR-8 @FR-11 @feature-307
  Scenario: Bundles differ only in theme tokens
    Given the /trader and /insights pages rendered from a staging build and from a production build
    When their accessibility trees and visible text are compared
    Then they are identical
    And the computed background-color of <body> differs between the two

  @AC-8 @FR-4 @FR-9 @feature-307
  Scenario: Production theme meets the contrast baseline and charts render
    Given the UI is built with UI_THEME="production"
    When the /trader page with a price chart is loaded
    Then foreground/background and primary-foreground/primary token pairs have contrast ratio >= 4.5:1 (foreground/background 18.07:1, primary-foreground/primary 5.46:1, within ±0.05)
    And the chart canvas renders without a "Failed to parse color" error

  @AC-9 @FR-1 @feature-307
  Scenario: Docker image build honours the UI_THEME build arg
    Given `docker build --build-arg UI_THEME=production -f services/xstockstrat-ui/Dockerfile .`
    When the image's services/xstockstrat-ui/.next/static/css is inspected
    Then it contains the production --primary value and not the Nocturne --primary value

  @AC-10 @FR-10 @feature-307
  Scenario: Theme is identical regardless of runtime APPLICATION_ENV
    Given a staging-themed build
    When it is started once with APPLICATION_ENV="production" and once with APPLICATION_ENV="staging"
    Then the computed background-color of <body> on /trader is identical in both runs

  @AC-11 @FR-9 @feature-307
  Scenario: Staging theme charts still render
    Given the UI is built with UI_THEME unset
    When the /trader page with a price chart is loaded
    Then the chart canvas renders without a "Failed to parse color" error

  @AC-12 @FR-11 @feature-307
  Scenario: /insights charts follow the selected theme
    Given a production build and a staging build
    When /insights/strategies/<id> renders the equity curve
    Then the first series stroke resolves to that build's --chart-1 color
    And no non-comment line in src/**/*.ts or src/**/*.tsx outside src/components/ui and *.test.ts matches /hsl\(\s*\d|oklch\(|#[0-9a-fA-F]{6}\b/

  @AC-13 @FR-12 @feature-307
  Scenario: PWA chrome color follows the theme
    Given the UI is built with UI_THEME="production"
    When /manifest.webmanifest and the /trader <meta name="theme-color"> are fetched
    Then theme_color, background_color and the meta content equal "#080d17" (the production --background); a staging build yields "#0c0a09"
    And the manifest still has display "standalone", the 192 and 512 icons, and Cache-Control "no-cache"

  @AC-14 @FR-13 @feature-307
  Scenario: Production palette meets the documented contrast baseline
    Given src/styles/themes/production.css
    When every X/X-foreground pair plus primary, muted-foreground and destructive as text on background and on card are evaluated
    Then each text pair is >= 4.5:1 and ring on background is >= 3:1

  @AC-17 @FR-13 @feature-307
  Scenario: Staging contrast shortfalls are recorded, not fixed
    Given docs/patterns/ui-ux-governance.md §5 and src/styles/themes/staging.css
    When the §5 known-deviations list is read
    Then it names every staging pair below its threshold with its ratio to one decimal place, including primary as text on background (2.6:1)
    And it states that staging values are frozen per FR-3
    And the set of staging pairs below threshold computed from src/styles/themes/staging.css equals the set named in §5, with no pair missing and none extra
