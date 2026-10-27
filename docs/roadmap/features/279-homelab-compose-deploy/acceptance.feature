Feature: homelab-compose-deploy
  As the platform operator, I want main-dev deployed to the homelab staging VM and main to the homelab production VM
  alongside DigitalOcean, so that the platform runs on infrastructure I own and an unhealthy release rolls itself back.

  @AC-1 @FR-1
  Scenario: The release .env pins every image by digest and the compose file renders without a build or a bind mount
    Given a release .env with IMAGE_TRADING=ghcr.io/davcs86/xstockstrat/xstockstrat-trading@sha256:<64 hex> and the other 12 IMAGE_* lines
    When "docker compose --env-file .env -f deploy/homelab/compose.yml config" runs
    Then it exits 0 with 13 services, every image ends in "@sha256:<64 hex>", and no service has a "build" or a "volumes" key

  @AC-2 @FR-1
  Scenario: A missing required value fails the render instead of starting a half-configured stack
    Given a release .env with no DB_PASSWORD line
    When "docker compose config" runs on deploy/homelab/compose.yml
    Then it exits non-zero with "required variable DB_PASSWORD is missing a value"

  @AC-3 @FR-2
  Scenario: Only the UI and the agent publish ports, and every long-running service is health-checked
    Given the rendered homelab compose file
    When its published ports and healthchecks are listed
    Then the published ports are exactly 3000 (xstockstrat-ui) and 9000 (xstockstrat-agent)
    And every service except db-migrator has a healthcheck

  @AC-4 @FR-3
  Scenario: Stateless services go through PgBouncer and LISTEN/NOTIFY services connect directly, for staging
    Given TARGET_ENV=staging and DB_PASSWORD=pw in APP_ENV
    When the release .env is built and the compose file rendered
    Then xstockstrat-trading has DATABASE_URL "postgresql://xstockstrat_staging:pw@db.ts.natanddavehouse.com:6432/xstockstrat-staging?sslmode=require" and DB_PGBOUNCER "true"
    And xstockstrat-config has DATABASE_URL "postgresql://xstockstrat_staging:pw@db.ts.natanddavehouse.com:5432/xstockstrat-staging?sslmode=require" and no DB_PGBOUNCER

  @AC-5 @FR-4
  Scenario: A failed migration fails the deploy and the VM keeps the previous release
    Given release "abc123def456-1" is current and healthy
    And release "abc123def456-2" whose db-migrator exits 1
    When the gate runs "deploy abc123def456-2"
    Then the deploy exits 1 with "release abc123def456-2 did not become healthy"
    And "status" reports "current: abc123def456-1" and no application container from abc123def456-2 is running

  @AC-6 @FR-5
  Scenario Outline: The Go healthcheck succeeds against its own SERVING health service over mTLS
    Given a <service> server on 127.0.0.1 presenting the "<service>" leaf and reporting SERVING
    When "service healthcheck" runs with the same MTLS_CERT, MTLS_KEY and MTLS_CA_CERT
    Then it exits 0

    Examples:
      | service                |
      | xstockstrat-trading    |
      | xstockstrat-portfolio  |
      | xstockstrat-marketdata |

  @AC-7 @FR-5
  Scenario Outline: The Go healthcheck fails while the server reports NOT_SERVING
    Given a <service> server on 127.0.0.1 reporting NOT_SERVING
    When the healthcheck probe runs
    Then it exits 1

    Examples:
      | service                |
      | xstockstrat-trading    |
      | xstockstrat-portfolio  |
      | xstockstrat-marketdata |

  @AC-8 @FR-6
  Scenario: APP_ENV cannot override pipeline-generated values
    Given APP_ENV contains DB_NAME=evil and IMAGE_UI=evil
    When the release .env is built for staging
    Then the rendered xstockstrat-ui image is the resolved "@sha256:" digest, DB_NAME is "xstockstrat-staging" and DB_USER is "xstockstrat_staging"

  @AC-9 @FR-6
  Scenario: Each service gets its own leaf from the environment's CA, intact through dotenv
    Given MTLS_CA is the base64 {ca_cert, ca_key} of "xstockstrat-homelab-staging-ca"
    When the release .env is built and the compose file rendered
    Then xstockstrat-trading's MTLS_CERT verifies against MTLS_CA_CERT, matches its MTLS_KEY, and has SAN "DNS:xstockstrat-trading", and MTLS_CA_CERT is byte-identical to the CA's ca.pem
    And the release .env file mode is 0600

  @AC-10 @FR-6
  Scenario: An image tag that was never built stops the deploy before anything is shipped
    Given no image ghcr.io/davcs86/xstockstrat/xstockstrat-config:doesnotexist
    When the digest-resolution step runs for tag "doesnotexist"
    Then the job fails with "not found" and the gate is never called

  @AC-11 @FR-7
  Scenario: Homelab deploys run beside the DO deploy only when enabled
    Given repository variable HOMELAB_DEPLOY_ENABLED is unset
    When main-dev is pushed
    Then the "Deploy to dev" job runs and the "Deploy to homelab staging" job is skipped

  @AC-12 @FR-8
  Scenario: The run summary names each secret's source and a missing secret fails the job
    Given no OP_SERVICE_ACCOUNT_TOKEN and no MTLS_CA secret in the staging environment
    When the homelab deploy runs
    Then the summary lists "MTLS_CA: MISSING" and the job fails with "MTLS_CA is in neither 1Password nor the GitHub secrets"

  @AC-13 @FR-9
  Scenario: OTel is off on the homelab
    Given the rendered homelab compose file
    When the environment of any service is read
    Then OTEL_ENABLED is "false" and there is no otel-collector service

  @AC-14 @FR-10
  Scenario: CI may reach staging over SSH only
    Given the homelab-edge policy with the new tag:ci grant
    When "headscale policy check" runs its tests
    Then tag:ci reaches tag:xstockstrat-staging:22 and is denied tag:xstockstrat-staging:3000, tag:xstockstrat-staging:9000 and tag:db:6432

  @AC-15 @FR-10
  Scenario: The gate's wait timeout is set by the pinned forced command, within bounds
    Given authorized_keys pins "app-deploy /opt/xstockstrat xstockstrat 300"
    When the gate deploys a release
    Then "up" runs with "--wait-timeout 300"
    And a pinned value of 5 or "1;id" is rejected with exit 2

  @AC-16 @FR-3
  Scenario: Production uses its own database and role
    Given TARGET_ENV=production and DB_PASSWORD=pw in APP_ENV
    When the release .env is built and the compose file rendered
    Then xstockstrat-config has DATABASE_URL "postgresql://xstockstrat_production:pw@db.ts.natanddavehouse.com:5432/xstockstrat-production?sslmode=require"

  @AC-17 @FR-5
  Scenario: A Go service is not healthy before its init has finished
    Given xstockstrat-trading is still waiting for its config snapshot
    When "service healthcheck" runs inside the container
    Then it exits 1, because nothing listens on 127.0.0.1:50051 until init completes

  @AC-18 @FR-7
  Scenario: A push to main deploys homelab production only after a reviewer approves
    Given HOMELAB_DEPLOY_ENABLED is "true" and the "production" environment requires reviewers
    When main is pushed
    Then "Deploy to prod" (DigitalOcean) runs immediately and "Deploy to homelab production" waits for approval

  @AC-19 @FR-7
  Scenario: A manual run redeploys an already-built SHA
    Given images tagged "98c78d3" exist for all 13 repositories
    When "Deploy homelab" is dispatched with environment "staging" and image_tag "98c78d3"
    Then every IMAGE_* line in the run summary is the digest of the "98c78d3" tag

  @AC-20 @FR-6
  Scenario: The runner joins the tailnet as an ephemeral CI node and leaves it afterwards
    Given a valid TS_AUTHKEY minted with tags tag:ci, --reusable and --ephemeral
    When the homelab deploy runs, whether it succeeds or fails
    Then the runner registers as "gha-xstockstrat-<run id>-<attempt>" and the "Leave the tailnet" step logs it out

  @AC-21 @FR-5
  Scenario Outline: The Go healthcheck fails when nothing listens on the service port
    Given nothing listening on 127.0.0.1:<port>
    When the <service> healthcheck probe runs
    Then it exits 1

    Examples:
      | service                | port  |
      | xstockstrat-trading    | 50051 |
      | xstockstrat-portfolio  | 50052 |
      | xstockstrat-marketdata | 50053 |

  # Covered by scripts/homelab-render.test.sh (CI job homelab-render) unless stated.
  @AC-22 @FR-6
  Scenario: APP_ENV cannot change the mode, environment or database names
    Given APP_ENV contains "APPLICATION_ENV=evil", "export TRADING_MODE=paper", "DB_USER=evil" and "DB_HOST: evil.example.test"
    When the release .env is built for production and rendered
    Then all 12 app services have APPLICATION_ENV "production" and TRADING_MODE "live", the .env contains no "evil", and the same build for staging renders "development" and "paper"

  @AC-23 @FR-2
  Scenario: The UI listens on all interfaces inside its container
    Given a rendered staging release
    When the xstockstrat-ui environment is read
    Then HOSTNAME is "0.0.0.0"

  # Covered by scripts/migration-ahead-check.test.sh and scripts/migration-rerun.sh pass 4 (CI job migration-rerun).
  @AC-24 @FR-4
  Scenario: An older migrator skips a schema a newer release already migrated
    Given marketdata's database is clean at version 9 and the migrator image's highest marketdata file is 008
    When db-migrate.sh up runs
    Then it logs "[ahead] marketdata is at version 9", exits 0 and leaves the version at 9

  @AC-25 @FR-4
  Scenario: An older migrator refuses a schema a newer release left dirty
    Given marketdata's database is dirty at version 9 and the migrator image's highest marketdata file is 008
    When db-migrate.sh up runs
    Then it exits 1 without running force 0, the version stays "9 (dirty)", and stderr names "force 8" and the literal "$DATABASE_URL" but no postgres:// URL

  @AC-26 @FR-4
  Scenario Outline: The ahead check fails closed on input it cannot read
    Given migrations directory <files> and version output "<version>"
    When migration-ahead-check.sh runs
    Then it exits 2

    Examples:
      | files            | version       |
      | 008_a, 009_b     | garbage dirty |
      | abc_x.up.sql     | 3             |
      | (empty)          | 3             |

  @AC-27 @FR-4
  Scenario: Zero-padded migration versions compare as decimal numbers
    Given migrations 008_a and 009_b
    When the ahead check runs with version "9" and then with version "10"
    Then it exits 0 for "9" and 10 for "10"

  @AC-28 @FR-6
  Scenario: Building the release .env leaves no CA key behind and prints no secret
    Given a target "qa", or an MTLS_CA that is not valid base64, or a CA key that does not match its certificate
    When homelab-release-env.sh runs
    Then it exits non-zero, writes no .env, leaves no file in its temp directory, and its stderr contains no input value

  @AC-29 @FR-6
  Scenario: The render check names each broken render and never passes an empty one
    Given the production render with one of: the agent service removed, ui HOSTNAME removed, trading TRADING_MODE "paper", a ":latest" image, an extra published port, DB_PGBOUNCER on config, a missing healthcheck, no services at all, or a non-object input
    When render-assert.jq evaluates it
    Then the output is a non-empty label list such as "services", "ui-hostname" or "trading-mode:xstockstrat-trading" and contains no environment value

  @AC-30 @FR-4
  Scenario: The migrator image carries every script db-migrate.sh calls
    Given the image built from scripts/Dockerfile.migrate
    When CI inspects /repo/scripts in the image
    Then migration-dirty-guard.sh is executable and migration-ahead-check.sh is present

  @AC-31 @FR-6
  Scenario: A line compose cannot parse fails the render without printing the .env
    Given APP_ENV contains the line "BAD!KEY=SECRETPROBE"
    When homelab-render-check.sh renders the release
    Then it exits 1 and its output contains "details suppressed" and not "SECRETPROBE"

  @AC-32 @FR-6
  Scenario: An unclosed quote fails the render without printing the rest of the file
    Given APP_ENV contains the line BROKEN="SECRETPROBE with no closing quote
    When homelab-render-check.sh renders the release
    Then it exits 1 and its output contains neither "SECRETPROBE" nor "PRIVATE KEY"

  # Covered by homelab-edge scripts/app-deploy-test.sh.
  @AC-33 @FR-10
  Scenario: The gate refuses a release that does not render and shows only variable names
    Given a release whose compose config fails with a parse error quoting "SECRETPROBE" and "required variable DB_PASSWORD is missing a value"
    When the gate runs "deploy" for it
    Then it exits 2, prints "required variable DB_PASSWORD is missing a value" but not "SECRETPROBE", pulls nothing and leaves "current" unchanged

  @AC-34 @FR-7
  Scenario: Production can only be deployed from main
    Given the GitHub "production" environment restricts deployment branches to main
    When "Deploy homelab" is dispatched for production from another branch
    Then GitHub rejects the job before it starts (live evidence, checked once by hand)

  @AC-35 @FR-3
  Scenario: The database user and database name are distinct and checked separately
    Given the production render
    When config's DATABASE_URL user is changed to "xstockstrat-production" or its path to "/xstockstrat_production"
    Then render-assert.jq reports "direct:xstockstrat-config"

  @AC-36 @FR-3
  Scenario: The direct pools stay within the homelab connection budget
    Given the production render
    When config's DB_POOL_MAX is "5", or notify's DB_POOL_MAX is removed, or trading sets DB_POOL_MAX "2"
    Then render-assert.jq reports "pool-budget" (or "pool-budget:xstockstrat-trading")

  # Covered by homelab-edge scripts/gatus-config-test.py; turns green only once feature 271 is deployed to that environment.
  @AC-37 @FR-10
  Scenario: Gatus checks the UI's public health route without following a login redirect
    Given the rendered Gatus configuration
    When the xstockstrat-ui and xstockstrat-staging-ui endpoints are read
    Then each probes ":3000/trader/api/health" with ignore-redirect true and requires status 200 and "[BODY].status == ok"

  @AC-38 @FR-3
  Scenario: The app VM's containers can reach the database host
    Given the VM is on the tailnet under its tag hostname and db-host has run since
    When the runbook's postgres:16-alpine psql probe connects to db.ts.natanddavehouse.com on 5432 and 6432 as xstockstrat_<env>
    Then both answer "select 1" (live evidence, before the first deploy)

  @AC-39 @FR-10
  Scenario: Gatus pins each agent's OAuth resource to its own public URL
    Given the rendered Gatus configuration
    When the xstockstrat-agent and xstockstrat-staging-agent endpoints are read
    Then they require "[BODY].resource" to equal "https://xstockstrat.natanddavehouse.com/agent" and "https://xstockstrat-staging-ui.ts.natanddavehouse.com:8443/agent"

  @AC-40 @FR-10
  Scenario: The UI health probe path is not reachable from the internet
    Given the public edge
    When GET https://xstockstrat.natanddavehouse.com/trader/api/health is requested
    Then it answers 404 (homelab-edge verify.yml)
