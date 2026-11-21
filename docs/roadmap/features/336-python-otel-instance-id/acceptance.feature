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
    Then its resource has host.provider "unknown"

  @AC-4 @FR-3
  Scenario: The instance id is identical across two process starts
    Given the indicators service starts twice in a row with OTEL_ENABLED=true and HOST_PROVIDER=homelab
    When each process exports a metric data point
    Then both exported resources have service.instance.id "homelab-indicators"

  @AC-5 @FR-4
  Scenario Outline: The Python telemetry suite passes asserting the new id and the old preserve rule is gone
    Given feature 332 @AC-21 asserted that a Python instance id does not start with "homelab-"
    When the telemetry tests of the <service> service run with HOST_PROVIDER=homelab
    Then the run passes

    Examples:
      | service    |
      | analysis   |
      | ingest     |
      | indicators |
      | agent      |

  @AC-6 @FR-4
  Scenario: The observability doc's resource-attribute paragraph states one id shape for all runtimes
    Given docs/patterns/observability.md after this feature
    When the paragraph describing how service.instance.id is set is read
    Then it states that Go, Node, UI and Python all set service.instance.id to <host.provider>-<service.name>

  @AC-10 @FR-4
  Scenario: The observability doc's series-budget risk no longer attributes churn to Python
    Given docs/patterns/observability.md after this feature
    When its "Open risks" series-budget item is read
    Then it contains no "Python restart churn" text

  @AC-11 @FR-5
  Scenario: The observability doc's post-deploy check adds the instance-prefix count
    Given docs/patterns/observability.md after this feature, whose existing host_provider="homelab" count is already present
    When its "Post-deploy check" list is read
    Then it adds a count by instance=~"homelab-.+" with the same thresholds: at least 11 jobs on an idle stack and 12 after one UI login

  @AC-12 @FR-5
  Scenario: The produced-signals guard still passes after the doc edits
    Given the doc edits of @AC-6, @AC-10, @AC-11 and @AC-14 to @AC-17 are applied
    When scripts/check-otel-produced-signals.py and scripts/tests/test_check_otel_produced_signals.py are run
    Then both exit 0 with no failed check

  @AC-13 @FR-4
  Scenario: No Python telemetry test still asserts the superseded preserve rule
    Given feature 332 @AC-21 added the assertion text not metrics_res["service.instance.id"].startswith("homelab-") to the Python telemetry tests
    When that exact text is searched for across tests/test_telemetry.py of analysis, ingest, indicators and agent
    Then the search finds 0 matches

  @AC-14 @FR-4
  Scenario: The observability doc no longer says Python keeps an SDK-generated id
    Given docs/patterns/observability.md after this feature
    When the text "Python keeps its SDK-generated id" is searched for
    Then the search finds 0 matches

  @AC-15 @FR-4
  Scenario: The observability doc's relabel-once risk names the Python series
    Given docs/patterns/observability.md after this feature
    When its "Open risks" relabel-once item is read
    Then it names the Python series alongside Go, Node and UI

  @AC-16 @FR-4
  Scenario: The observability doc states the instance bullet for all 12 jobs
    Given docs/patterns/observability.md after this feature
    When the post-deploy bullet describing the instance label is read
    Then it says instance is homelab-<job> for all 12 jobs

  @AC-17 @FR-5
  Scenario: The observability doc documents the instance-prefix Loki selector
    Given docs/patterns/observability.md after this feature
    When its log-filter guidance is read
    Then it documents {service_instance_id=~"homelab-.+"} as covering all 12 services

  @AC-7 @FR-5 @manual
  Scenario: The documented homelab post-deploy check counts services by instance prefix
    Given homelab staging has been deployed and a UI login has happened
    When the PromQL count(group by (job) (target_info{deployment_environment="staging", instance=~"homelab-.+"})) is evaluated
    Then it returns 12

  @AC-18 @FR-5 @manual
  Scenario: The documented homelab post-deploy check on an idle stack counts at least 11 services
    Given homelab staging has been deployed and no UI login has happened
    When the PromQL count(group by (job) (target_info{deployment_environment="staging", instance=~"homelab-.+"})) is evaluated
    Then it returns at least 11

  @AC-8 @FR-5 @manual
  Scenario: The instance-id Loki selector returns the four Python services on homelab
    Given the analysis, ingest, indicators and agent services on homelab have each logged within the last 15 minutes
    When the LogQL sum by (service_name) (count_over_time({service_instance_id=~"homelab-.+"}[15m])) is evaluated
    Then the result includes service_name values "analysis", "ingest", "indicators" and "agent", each with a count above 0
