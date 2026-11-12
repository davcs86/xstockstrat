Feature: python-otel-instance-id
  As a platform operator, I want every service on a host provider to carry a <host.provider>-<service.name>-<suffix6> instance id, so that I can select a provider's streams and series by prefix and replicas of one service never collide.

  @AC-1 @FR-1
  Scenario Outline: Every runtime exports a provider-prefixed instance id with a 6-hex suffix on homelab
    Given the <service> service starts with OTEL_ENABLED=true, HOST_PROVIDER=homelab and SERVICE_NAME=<service>
    When it exports a metric data point, a span and a log record
    Then the resource of each of the three signals has a service.instance.id matching ^homelab-<service>-[0-9a-f]{6}$

    Examples:
      | service    |
      | trading    |
      | portfolio  |
      | marketdata |
      | ledger     |
      | identity   |
      | notify     |
      | config     |
      | ui         |
      | analysis   |
      | ingest     |
      | indicators |
      | agent      |

  @AC-2 @FR-1
  Scenario: A DigitalOcean service exports a digitalocean-prefixed instance id
    Given the analysis service starts with OTEL_ENABLED=true, HOST_PROVIDER=digitalocean and SERVICE_NAME=analysis
    When it exports a metric data point
    Then its resource has a service.instance.id matching ^digitalocean-analysis-[0-9a-f]{6}$

  @AC-3 @FR-2
  Scenario Outline: An unset or unrecognised provider yields the unknown prefix and the service still starts
    Given the ingest service starts with OTEL_ENABLED=true, SERVICE_NAME=ingest and HOST_PROVIDER <provider_state>
    When it reaches SERVING and exports a metric data point
    Then its resource has host.provider "unknown" and a service.instance.id matching ^unknown-ingest-[0-9a-f]{6}$

    Examples:
      | provider_state   |
      | unset            |
      | set to "aws"     |
      | set to "Homelab" |

  @AC-4 @FR-3
  Scenario Outline: A Docker container id in the OS hostname becomes the suffix
    Given the trading service runs with HOST_PROVIDER=homelab and the OS hostname "<hostname>"
    When it exports a metric data point
    Then its resource has service.instance.id "homelab-trading-<suffix>"

    Examples:
      | hostname                                                         | suffix |
      | 9f8e7d6c5b4a                                                     | 9f8e7d |
      | 9f8e7d6c5b4a3210fedcba98765432100123456789abcdef0123456789abcdef | 9f8e7d |

  @AC-5 @FR-3
  Scenario Outline: A hostname that is not a container id falls back to a random 6-hex suffix
    Given the ui service runs with HOST_PROVIDER=homelab, the env var HOSTNAME "0.0.0.0" and the OS hostname "<hostname>"
    When it exports a metric data point
    Then its resource has a service.instance.id matching ^homelab-ui-[0-9a-f]{6}$ and the suffix is not derived from "<hostname>"

    Examples:
      | hostname                |
      | analysis-7d9f8b-xk2lq   |
      | 9F8E7D6C5B4A            |
      | 9f8e7d6c5b4             |
      | myhost                  |

  @AC-6 @FR-4
  Scenario: The instance id is identical across two process starts in the same container
    Given the indicators service starts twice in a row in a container whose OS hostname is "0123456789ab", with HOST_PROVIDER=homelab
    When each process exports a metric data point
    Then both exported resources have service.instance.id "homelab-indicators-012345"

  @AC-7 @FR-4
  Scenario: Two replicas of one service export distinct instance ids
    Given two config containers with OS hostnames "aaaaaa111111" and "bbbbbb222222" both run with HOST_PROVIDER=homelab
    When both export a metric data point
    Then their service.instance.id values are "homelab-config-aaaaaa" and "homelab-config-bbbbbb", and target_info holds two distinct (job, instance) rows for job "config"

  @AC-8 @FR-5
  Scenario: The telemetry tests assert the new shape and none asserts the superseded forms
    Given feature 332 asserted the exact id "homelab-<service>" on 8 runtimes and, for Python, @AC-21 asserted the id does not start with "homelab-"
    When the telemetry tests of all 12 services are read
    Then each asserts the pattern ^homelab-<service>-[0-9a-f]{6}$ and none contains an exact "homelab-<service>" literal for service.instance.id or an assertion that it does not start with "homelab-"

  @AC-9 @FR-6
  Scenario: The observability doc states one id shape and its churn behaviour
    Given docs/patterns/observability.md
    When its resource-attribute paragraph, its open risks and its post-deploy check are read
    Then it states that all 12 services set service.instance.id to <host.provider>-<service.name>-<suffix6>, that the suffix is the container id's first 6 hex or else random, that a container recreate starts a new series, and that instance is homelab-<job>-<suffix> for 12 jobs, with no sentence saying Python keeps an SDK-generated id

  @AC-10 @FR-7
  Scenario: The documented homelab post-deploy check counts all 12 services by instance prefix
    Given homelab staging has all 12 services exporting with OTEL_ENABLED=true
    When the PromQL count(group by (job) (target_info{deployment_environment="staging", instance=~"homelab-.+"})) is evaluated
    Then it returns 12

  @AC-11 @FR-7
  Scenario: The instance-id Loki selector returns all 12 services on homelab
    Given all 12 homelab services have each logged within the last 15 minutes
    When the LogQL sum by (service_name) (count_over_time({service_instance_id=~"homelab-.+"}[15m])) is evaluated
    Then the result has 12 service_name values, each with a count above 0
