Feature: python-otel-instance-id
  As a platform operator, I want every service on a host provider to carry the same <host.provider>-<service.name> instance id, so that I can select a provider's streams and series by one indexed label and Python series stop churning on restart.

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
  Scenario Outline: An unset or unrecognised provider yields the unknown prefix and the service still starts
    Given the ingest service starts with OTEL_ENABLED=true, SERVICE_NAME=ingest and HOST_PROVIDER <provider_state>
    When it reaches SERVING and exports a metric data point
    Then its resource has service.instance.id "unknown-ingest" and host.provider "unknown"

    Examples:
      | provider_state   |
      | unset            |
      | set to "aws"     |
      | set to "Homelab" |

  @AC-4 @FR-3
  Scenario: The instance id is identical across two process starts
    Given the indicators service starts twice in a row with OTEL_ENABLED=true and HOST_PROVIDER=homelab
    When each process exports a metric data point
    Then both exported resources have service.instance.id "homelab-indicators"

  @AC-5 @FR-4
  Scenario: The Python telemetry tests assert the new id and none asserts the old preserve rule
    Given feature 332 @AC-21 asserted that a Python instance id does not start with "homelab-"
    When the four tests/test_telemetry.py files of analysis, ingest, indicators and agent are read
    Then each asserts service.instance.id equals "homelab-<service>" for HOST_PROVIDER=homelab and none contains an assertion that it does not start with "homelab-"

  @AC-6 @FR-4 @FR-5
  Scenario: The observability doc states one id shape for all 12 services
    Given docs/patterns/observability.md
    When its resource-attribute paragraph and its post-deploy check are read
    Then it states that all 12 services set service.instance.id to <host.provider>-<service.name>, contains no sentence saying Python keeps an SDK-generated id, and says instance is homelab-<job> for 12 jobs

  @AC-7 @FR-5
  Scenario: The documented homelab post-deploy check counts all 12 services by instance prefix
    Given homelab staging has all 12 services exporting with OTEL_ENABLED=true
    When the PromQL count(group by (job) (target_info{deployment_environment="staging", instance=~"homelab-.+"})) is evaluated
    Then it returns 12

  @AC-8 @FR-5
  Scenario: The instance-id Loki selector returns the four Python services on homelab
    Given the analysis, ingest, indicators and agent services on homelab have each logged within the last 15 minutes
    When the LogQL sum by (service_name) (count_over_time({service_instance_id=~"homelab-.+"}[15m])) is evaluated
    Then the result includes service_name values "analysis", "ingest", "indicators" and "agent", each with a count above 0
