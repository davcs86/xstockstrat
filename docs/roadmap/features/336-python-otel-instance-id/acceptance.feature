Feature: python-otel-instance-id
  As a platform operator, I want every service on a host provider to carry the same <host.provider>-<service.name> instance id, so that I can select a provider's streams and series by one prefix and Python series stop churning on restart.

  @AC-1 @FR-1
  Scenario Outline: A Python service exports a provider-prefixed instance id on homelab
    Given the <service> service starts with OTEL_ENABLED=true, HOST_PROVIDER=homelab and SERVICE_NAME=<service>
    When it exports a metric data point, a span and a log record
    Then the resource of each of the three signals has service.instance.id "<instance_id>"

    Examples:
      | service    | instance_id         |
      | analysis   | homelab-analysis    |
      | ingest     | homelab-ingest      |
      | indicators | homelab-indicators  |
      | agent      | homelab-agent       |

  @AC-2 @FR-1
  Scenario: A Python service exports a provider-prefixed instance id on DigitalOcean
    Given the analysis service starts with OTEL_ENABLED=true, HOST_PROVIDER=digitalocean and SERVICE_NAME=analysis
    When it exports a metric data point
    Then its resource has service.instance.id "digitalocean-analysis"

  @AC-3 @FR-2
  Scenario Outline: An unset or unrecognised provider yields the unknown instance-id prefix
    Given the ingest service starts with OTEL_ENABLED=true, SERVICE_NAME=ingest and HOST_PROVIDER <provider_state>
    When it reaches SERVING and exports a metric data point
    Then its resource has service.instance.id "unknown-ingest"

    Examples:
      | provider_state   |
      | unset            |
      | set to "aws"     |
      | set to "Homelab" |

  @AC-9 @FR-2
  Scenario: An unrecognised provider still resolves host.provider to unknown
    Given the ingest service starts with OTEL_ENABLED=true, SERVICE_NAME=ingest and HOST_PROVIDER set to "aws"
    When it reaches SERVING and exports a metric data point
    Then its resource has host.provider "unknown" and the service reports SERVING

  @AC-4 @FR-3
  Scenario: The instance id is identical across two process starts
    Given the indicators service starts twice in a row with OTEL_ENABLED=true and HOST_PROVIDER=homelab
    When each process exports a metric data point
    Then both exported resources have service.instance.id "homelab-indicators"

  @AC-5 @FR-4
  Scenario Outline: The Python telemetry suite passes asserting the new id and the old preserve rule is gone
    Given feature 332 @AC-21 asserted that a Python instance id does not start with "homelab-"
    When the telemetry tests of the <service> service run with HOST_PROVIDER=homelab
    Then the run passes, it includes an assertion that service.instance.id equals "homelab-<service>", and it includes no assertion that the id lacks the "homelab-" prefix

    Examples:
      | service    |
      | analysis   |
      | ingest     |
      | indicators |
      | agent      |

  @AC-6 @FR-4
  Scenario: The observability doc's resource-attribute paragraph no longer makes Python the exception
    Given docs/patterns/observability.md after this feature
    When the paragraph describing how service.instance.id is set is read
    Then it states that Go, Node, UI and Python set service.instance.id to <host.provider>-<service.name>, and it contains no sentence saying Python keeps an SDK-generated id

  @AC-10 @FR-4
  Scenario: The observability doc's open-risks list no longer attributes churn to Python
    Given docs/patterns/observability.md after this feature
    When its "Open risks" list is read
    Then the series-budget item has no "Python restart churn" clause, and the relabel-once item names the Python series alongside Go, Node and UI

  @AC-11 @FR-5
  Scenario: The observability doc's post-deploy check counts services by instance prefix and documents the selector
    Given docs/patterns/observability.md after this feature
    When its "Post-deploy check" list and its log-filter guidance are read
    Then the list keeps the existing host_provider="homelab" count (at least 11 jobs idle, 12 after one UI login), adds the same-threshold count by instance=~"homelab-.+", says instance is homelab-<job> for all 12 jobs, and documents {service_instance_id=~"homelab-.+"} as covering all 12 services

  @AC-12 @FR-5
  Scenario: The produced-signals guard still passes after the doc edits
    Given the doc edits of @AC-6, @AC-10 and @AC-11 are applied
    When scripts/check-otel-produced-signals.py and scripts/tests/test_check_otel_produced_signals.py are run
    Then both exit 0 with no failed check

  @AC-7 @FR-5 @manual
  Scenario: The documented homelab post-deploy check counts services by instance prefix
    Given homelab staging has been deployed and a UI login has happened
    When the PromQL count(group by (job) (target_info{deployment_environment="staging", instance=~"homelab-.+"})) is evaluated
    Then it returns 12, and on an idle stack with no UI login it returns at least 11, matching the existing host_provider-based check

  @AC-8 @FR-5 @manual
  Scenario: The instance-id Loki selector returns the four Python services on homelab
    Given the analysis, ingest, indicators and agent services on homelab have each logged within the last 15 minutes
    When the LogQL sum by (service_name) (count_over_time({service_instance_id=~"homelab-.+"}[15m])) is evaluated
    Then the result includes service_name values "analysis", "ingest", "indicators" and "agent", each with a count above 0
