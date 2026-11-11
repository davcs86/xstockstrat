"""Regression cases for scripts/check-otel-produced-signals.py.

Each case copies the OTel assets, docs, protos and registered producer files into a throwaway tree, mutates
it, and asserts the guard's hits. Verbatim pre-250 text lives in scripts/testdata/otel-produced-signals/.
"""

import re
import shutil

import pytest
from conftest import SCRIPTS_DIR, load_script

og = load_script("check-otel-produced-signals.py")

REPO = SCRIPTS_DIR.parent
FIXTURES = SCRIPTS_DIR / "testdata" / "otel-produced-signals"
RULES = "packages/otel/alerts/alert-rules.yaml"
MUTE = "packages/otel/alerts/mute-timings.yaml"
DASHBOARD = "packages/otel/dashboards/service-health.json"
GRAFANA_DOC = "docs/setup/grafana-cloud.md"
DASH_README = "packages/otel/dashboards/README.md"
NOTIFY_PROTO = "packages/proto/notify/v1/notify.proto"
RULE_LINE = "- `xstk-retired-fake` — alert rule"
EXISTING_FILE_LINE = "- `service-health.json` — file"
DASH_LINE = "- `xstk-service-health` — dashboard"
DASHBOARD_NAMES = re.compile(
    "service-health|signal-pipeline|infrastructure|trading-service|service-detail"
)


def real_stream_matcher():
    """The matcher the guard must see, derived independently from the protos."""
    pattern = re.compile(r"^\s*rpc\s+([A-Za-z0-9_]+).*returns\s*\(\s*stream\s")
    names = set()
    for proto in REPO.glob("packages/proto/*/v1/*.proto"):
        names.update(
            m.group(1) for m in map(pattern.match, proto.read_text().splitlines()) if m
        )
    return f'rpc_method!~"{"|".join(sorted(names))}"'


MATCHER = real_stream_matcher()


@pytest.fixture(scope="session")
def pristine(tmp_path_factory):
    tree = tmp_path_factory.mktemp("otel") / "tree"
    shutil.copytree(REPO / "packages" / "otel", tree / "packages" / "otel")
    for name in ("setup", "patterns"):
        shutil.copytree(REPO / "docs" / name, tree / "docs" / name)
    shutil.copytree(REPO / ".do", tree / ".do")
    singles = [
        "docs/launch-pdfs/product-features.md",
        "docs/context-constitution-findings.md",
        "docs/sdd/business-rules/platform.feature",
        "docker-compose.yml",
        "deploy/homelab/compose.yml",
    ]
    singles += [
        str(p.relative_to(REPO)) for p in REPO.glob("packages/proto/*/v1/*.proto")
    ]
    for line in (REPO / og.REGISTRY).read_text().splitlines()[1:]:
        fields = line.split("\t")
        if fields[0]:
            singles += fields[2].split(",")
    for rel in dict.fromkeys(singles):
        (tree / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(REPO / rel, tree / rel)
    (tree / "docs" / "reports").mkdir()
    return tree


@pytest.fixture
def tree(pristine, tmp_path):
    return shutil.copytree(pristine, tmp_path / "tree")


def append(tree, rel, *lines):
    with open(tree / rel, "a") as f:
        f.write("".join(line + "\n" for line in lines))


def rewrite(tree, rel, fn):
    (tree / rel).write_text(fn((tree / rel).read_text()))


def drop_lines(tree, rel, predicate, first_only=False):
    kept, dropped = [], False
    for line in (tree / rel).read_text().splitlines(keepends=True):
        if predicate(line) and not (first_only and dropped):
            dropped = True
        else:
            kept.append(line)
    (tree / rel).write_text("".join(kept))


def rule_expr(metric, matchers=""):
    return (
        f"      expr: sum(rate({metric}{{{matchers}}}[5m]))"
        if matchers
        else f"      expr: sum(rate({metric}[5m]))"
    )


def dash(tree, expr):
    (tree / DASHBOARD).write_text(
        "{\n"
        '  "templating": { "list": [ {\n'
        '    "query": "label_values(rpc_server_duration_milliseconds_count, service_name)"\n'
        "  } ] },\n"
        '  "uid": "xstk-service-health",\n'
        '  "panels": [ { "targets": [ {\n'
        f'    "expr": "{expr}"\n'
        "  } ] } ]\n"
        "}\n"
    )


def fallback_tree(tree):
    """No dashboard JSON, and no line that names one."""
    for path in (tree / "packages/otel/dashboards").glob("*.json"):
        path.unlink()
    for base in ("docs", "packages/otel"):
        for path in (tree / base).rglob("*"):
            if path.is_file() and DASHBOARD_NAMES.search(path.read_text()):
                drop_lines(tree, path.relative_to(tree), DASHBOARD_NAMES.search)


def hits(tree):
    return og.Guard(str(tree)).run()


def assert_hit(tree, *needles):
    found = "\n".join(hits(tree))
    assert found, "expected hits, got none"
    for needle in needles:
        assert needle in found


# --- green: the real tree ------------------------------------------------------------------------


def test_the_real_tree_is_green(tree):
    assert hits(tree) == []
    assert og.main([str(REPO)]) == 0


def test_main_prints_hits_to_stderr_and_exits_1(tree, capfd):
    append(tree, RULES, "      expr: rpc_client_bogus_total")
    assert og.main([f"{tree}/"]) == 1
    captured = capfd.readouterr()
    assert captured.out == ""
    assert re.fullmatch(rf"AC-8 P1 {RULES}:\d+: rpc_client_bogus_total\n", captured.err)


# --- AC-8: the allowlist --------------------------------------------------------------------------


def test_unregistered_metric(tree):
    append(tree, RULES, "      expr: rpc_client_bogus_total")
    assert_hit(tree, f"AC-8 P1 {RULES}:", "rpc_client_bogus_total")


def test_registered_metric_passes(tree):
    append(
        tree,
        RULES,
        "      expr: sum by (service_name) (rate(mcp_tool_duration_milliseconds_count[5m]))",
    )
    assert hits(tree) == []


def test_unregistered_service_name_in_a_block_scalar(tree):
    append(
        tree,
        RULES,
        "      expr: |",
        '        sum(count_over_time({service_name="nosuch"} [5m]))',
    )
    assert_hit(tree, f"AC-8 P1 {RULES}:", 'service_name="nosuch"')


def test_unregistered_loki_literal(tree):
    append(
        tree,
        RULES,
        '      expr: sum(count_over_time({service_name="analysis"} |= "never produced" [5m]))',
    )
    assert_hit(tree, f"AC-8 P1 {RULES}:", '|= "never produced"')


def test_registered_loki_query_passes(tree):
    expr = 'sum(count_over_time({service_name="analysis"} |= "live_loop: cycle complete" | json | level=~"info" [30m]))'
    append(tree, RULES, f"      expr: {expr}")
    assert hits(tree) == []


def test_verbatim_pre_250_rule_file(tree):
    shutil.copy(
        FIXTURES / "alert-rules.prefix.yaml",
        tree / "packages/otel/alerts/alert-rules.prefix.yaml",
    )
    assert_hit(
        tree,
        "AC-8 P1 packages/otel/alerts/alert-rules.prefix.yaml:",
        "ScoreStrategy|RunBacktest",
    )


def test_producer_literal_drift(tree):
    producer = "services/xstockstrat-agent/app/tool_metrics.py"
    rewrite(
        tree, producer, lambda s: s.replace("mcp.tool.duration", "mcp.tool.renamed")
    )
    assert_hit(
        tree, f"AC-8 P1-producer {og.REGISTRY}:", "mcp_tool_duration_milliseconds_count"
    )


def test_registry_missing(tree):
    (tree / og.REGISTRY).unlink()
    assert_hit(tree, f"AC-8 P1-producer {og.REGISTRY}:1: registry missing")


# --- AC-17: Part 4, the proto-derived stream exclusion ---------------------------------------------


def test_selector_with_the_matcher_passes(tree):
    append(tree, RULES, rule_expr("rpc_server_duration_milliseconds_count", MATCHER))
    assert hits(tree) == []


@pytest.mark.parametrize("suffix", ["count", "bucket", "sum"])
def test_bare_selector_fails(tree, suffix):
    metric = f"rpc_server_duration_milliseconds_{suffix}"
    append(tree, RULES, rule_expr(metric))
    assert_hit(tree, f"AC-17 P4 {RULES}:", f"{metric} (no label matchers)")


@pytest.mark.parametrize("suffix", ["count", "bucket", "sum"])
def test_selector_with_only_other_matchers_fails(tree, suffix):
    append(
        tree,
        RULES,
        rule_expr(
            f"rpc_server_duration_milliseconds_{suffix}", 'service_name="analysis"'
        ),
    )
    assert_hit(tree, f"AC-17 P4 {RULES}:", f"(missing {MATCHER})")


def test_label_values_templating_is_exempt(tree):
    dash(tree, "sum(mcp_tool_duration_milliseconds_count)")
    assert hits(tree) == []


def test_the_same_selector_in_a_panel_target_fails(tree):
    dash(tree, "sum(rpc_server_duration_milliseconds_count)")
    assert_hit(tree, f"AC-17 P4 {DASHBOARD}:")


def test_dashboard_target_with_the_matcher_passes(tree):
    escaped = MATCHER.replace('"', '\\"')
    dash(tree, f"sum(rpc_server_duration_milliseconds_count{{{escaped}}})")
    assert hits(tree) == []


def test_a_new_stream_rpc_needs_the_matcher_updated(tree):
    append(tree, RULES, rule_expr("rpc_server_duration_milliseconds_count", MATCHER))
    append(tree, NOTIFY_PROTO, "rpc StreamFoo(Req) returns (stream Resp);")
    assert_hit(tree, f"AC-17 P4 {RULES}:", "StreamFoo")


def test_rpc_line_without_returns(tree):
    append(tree, NOTIFY_PROTO, "rpc Foo(Req);")
    assert_hit(tree, f"AC-17 P4 {NOTIFY_PROTO}:")


def test_stream_rpc_named_like_a_unary_rpc(tree):
    append(
        tree,
        "packages/proto/marketdata/v1/marketdata.proto",
        "rpc GetBars(Req) returns (stream Resp);",
    )
    assert_hit(
        tree,
        "AC-17 P4 packages/proto:1: stream rpc GetBars shares its name with a unary rpc",
    )


def test_commented_stream_rpc_is_ignored(tree):
    append(tree, RULES, rule_expr("rpc_server_duration_milliseconds_count", MATCHER))
    append(tree, NOTIFY_PROTO, "// rpc StreamFoo(Req) returns (stream Resp);")
    assert hits(tree) == []


def test_sampler_env_in_a_do_spec(tree):
    append(tree, ".do/app.yaml", "  - key: OTEL_TRACES_SAMPLER")
    assert_hit(tree, "AC-17 P4-sampler .do/app.yaml:")


def test_grpc_exclusion_env_in_compose(tree):
    append(tree, "docker-compose.yml", "      OTEL_PYTHON_GRPC_EXCLUDED_SERVICES: x")
    assert_hit(tree, "AC-17 P4-sampler docker-compose.yml:")


# --- feature 332 AC-22 / AC-23: no resource-attribute override or sampler in any deploy spec -------

HOMELAB_COMPOSE = "deploy/homelab/compose.yml"


@pytest.mark.parametrize(
    ("rel", "line"),
    [
        (HOMELAB_COMPOSE, "      OTEL_RESOURCE_ATTRIBUTES: host.provider=digitalocean"),
        (
            "docker-compose.yml",
            "      OTEL_RESOURCE_ATTRIBUTES: host.provider=digitalocean",
        ),
        (".do/app.yaml", "  - key: OTEL_RESOURCE_ATTRIBUTES"),
        (".do/app.dev.yaml", "  - key: OTEL_RESOURCE_ATTRIBUTES"),
    ],
)
def test_resource_attributes_env_in_a_deploy_spec(tree, rel, line):
    append(tree, rel, line)
    assert_hit(tree, f"AC-22 P4-resattr {rel}:")


def test_sampler_env_in_the_homelab_compose(tree):
    append(tree, HOMELAB_COMPOSE, "      OTEL_TRACES_SAMPLER: traceidratio")
    assert_hit(tree, f"AC-17 P4-sampler {HOMELAB_COMPOSE}:")


# --- feature 332 AC-10 / AC-11: the documented host.provider queries (Part 6) -----------------------

OBS = "docs/patterns/observability.md"


def sub(old, new, count=0):
    def fn(text):
        assert old in text, f"fixture drift: {old!r} not in {OBS}"
        return text.replace(old, new, count) if count else text.replace(old, new)

    return fn


@pytest.mark.parametrize(
    ("old", "new", "needles"),
    [
        ("```promql otel-guard:host-provider\n", "```promql\n", (f"AC-10 P6 {OBS}:",)),
        ("```logql otel-guard:host-provider\n", "```logql\n", (f"AC-11 P6 {OBS}:",)),
        (
            "on (job, instance, deployment_environment) group_left",
            "on (job, instance) group_left",
            (f"AC-10 P6 {OBS}:",),
        ),
        (
            'target_info{deployment_environment="staging", host_provider="homelab"}',
            'target_info{deployment_environment="staging"}',
            (f"AC-10 P6 {OBS}:",),
        ),
        (
            'count{deployment_environment="staging", rpc_method',
            "count{rpc_method",
            (f"AC-10 P6 {OBS}:",),
        ),
        ("\n)\n```\n", "\n```\n", (f"AC-10 P6 {OBS}:", "unbalanced")),
        (", " + MATCHER + "}[5m]", "}[5m]", (f"AC-17 P4 {OBS}:",)),
        (
            "target_info{deployment_environment",
            "target_infox{deployment_environment",
            (f"AC-8 P1 {OBS}:", "target_infox"),
        ),
        (' | host_provider="homelab"\n```', "\n```", (f"AC-11 P6 {OBS}:",)),
        (
            '{service_name="analysis"} | deployment_environment',
            '{service_name="analysis" | deployment_environment',
            (f"AC-11 P6 {OBS}:", "unbalanced"),
        ),
        (
            '{service_name="analysis"} | deployment_environment',
            '{service_name="nosuch"} | deployment_environment',
            (f"AC-8 P1 {OBS}:", 'service_name="nosuch"'),
        ),
    ],
    ids=[
        "AC-10-no-promql-block",
        "AC-11-no-logql-block",
        "AC-10-join-missing-deployment-environment",
        "AC-10-target-info-lacks-host-provider",
        "AC-10-rpc-selector-lacks-environment",
        "AC-10-unbalanced",
        "AC-10-rpc-selector-lacks-stream-matcher",
        "AC-10-unregistered-metric",
        "AC-11-lacks-host-provider",
        "AC-11-unbalanced",
        "AC-11-unregistered-stream",
    ],
)
def test_query_block_mutation(tree, old, new, needles):
    rewrite(tree, OBS, sub(old, new))
    assert_hit(tree, *needles)


def test_two_promql_blocks_fail(tree):
    append(
        tree,
        OBS,
        "```promql otel-guard:host-provider",
        'sum(rate(target_info{deployment_environment="staging", host_provider="homelab"}[5m]))',
        "```",
    )
    assert_hit(tree, f"AC-10 P6 {OBS}:", "found 2")


# --- feature 332 AC-12: the host.provider contract and the post-deploy check stay documented ---------


def test_the_host_provider_contract_stays_documented(tree):
    doc = (tree / OBS).read_text()
    for want in (
        "host.provider",
        "digitalocean",
        "homelab",
        "unknown",
        "<host.provider>-<service.name>",
        "Do not set `OTEL_RESOURCE_ATTRIBUTES`",
        'count(group by (job) (target_info{deployment_environment="staging", host_provider="homelab"}))',
        "egress",
        "at least 11 jobs",
        "12 after one UI login",
    ):
        assert want in doc, want


# --- AC-8 / AC-14: alert rule invariants (Part 5) ---------------------------------------------------


def test_the_real_tree_declares_three_rules(tree):
    assert len(og.alert_rules((tree / RULES).read_text().split("\n"))) == 3


def test_rule_without_nodatastate(tree):
    drop_lines(tree, RULES, lambda line: "noDataState:" in line, first_only=True)
    assert_hit(tree, f"AC-8 P5 {RULES}:", "xstk-error-rate-high has no noDataState")


def test_stall_rule_nodata_must_alert(tree):
    rewrite(
        tree, RULES, lambda s: s.replace("noDataState: Alerting", "noDataState: OK")
    )
    assert_hit(
        tree,
        f"AC-8 P5 {RULES}:",
        "xstk-analysis-no-scoring noDataState must be Alerting",
    )


def test_rpc_rule_nodata_must_be_ok(tree):
    rewrite(
        tree, RULES, lambda s: s.replace("noDataState: OK", "noDataState: NoData", 1)
    )
    assert_hit(tree, f"AC-8 P5 {RULES}:", "noDataState must be OK")


def test_mute_timing_renamed(tree):
    rewrite(
        tree,
        MUTE,
        lambda s: s.replace(
            "name: outside-us-market-hours", "name: outside-market-hours"
        ),
    )
    assert_hit(tree, f"AC-14 P5 {MUTE}:")


def test_mute_timing_file_missing(tree):
    (tree / MUTE).unlink()
    assert_hit(tree, f"AC-14 P5 {MUTE}:")


def test_stall_rule_label_dropped(tree):
    drop_lines(tree, RULES, lambda line: "mute_outside_market_hours" in line)
    assert_hit(tree, f"AC-14 P5 {RULES}:", "mute_outside_market_hours")


# --- AC-14: restored dashboards reference only produced series ---------------------------------------


def test_the_real_tree_ships_five_dashboards_with_the_service_variable(tree):
    assert len(list((tree / "packages/otel/dashboards").glob("*.json"))) == 5
    text = (REPO / DASHBOARD).read_text()
    assert (
        '"query": "label_values(rpc_server_duration_milliseconds_count, service_name)"'
        in text
    )
    for datasource in ("DS_PROMETHEUS", "DS_LOKI", "DS_TEMPO"):
        assert f'"name": "{datasource}"' in text


def test_unregistered_series_in_a_panel(tree):
    dash(tree, "sum(rate(rpc_client_bogus_total[5m]))")
    assert_hit(tree, f"AC-8 P1 {DASHBOARD}:", "rpc_client_bogus_total")


def test_unregistered_service_in_a_panel(tree):
    dash(tree, 'sum(count_over_time({service_name=\\"nosuch\\"} [5m]))')
    assert_hit(tree, f"AC-8 P1 {DASHBOARD}:", 'service_name="nosuch"')


def test_unproduced_literal_in_a_panel(tree):
    dash(
        tree,
        'sum(count_over_time({service_name=\\"analysis\\"} |= \\"signal.ingested\\" [5m]))',
    )
    assert_hit(tree, f"AC-8 P1 {DASHBOARD}:", '|= "signal.ingested"')


def test_metadata_filter_passes(tree):
    dash(
        tree,
        'sum(rate({service_name=\\"trading\\"} | detected_level=\\"error\\" [5m]))',
    )
    assert hits(tree) == []


def test_panel_selector_without_the_matcher(tree):
    dash(
        tree,
        'sum(rate(rpc_server_duration_milliseconds_count{service_name=\\"trading\\"}[5m]))',
    )
    assert_hit(tree, f"AC-17 P4 {DASHBOARD}:")


# --- Part 3: docs name only assets that exist ------------------------------------------------------


def test_signal_talk_in_docs_is_free(tree):
    append(
        tree,
        GRAFANA_DOC,
        "Loki and Prometheus now carry rpc_server_duration_milliseconds with service_name=analysis; P99 per service.",
    )
    append(
        tree,
        "docs/patterns/observability.md",
        "Metrics and logs are exported over OTLP.",
    )
    assert hits(tree) == []


def test_a_line_with_several_tags_reports_each(tree):
    append(tree, GRAFANA_DOC, "see xstk-retired-fake and dashboards-gone.json")
    assert_hit(tree, f"AC-3 P3-name {GRAFANA_DOC}:", f"AC-3 P3-file {GRAFANA_DOC}:")


def test_fenced_removed_uid_passes(tree):
    append(tree, GRAFANA_DOC, og.OPEN, RULE_LINE, og.CLOSE)
    assert hits(tree) == []


def test_the_same_line_unfenced_fails(tree):
    append(tree, GRAFANA_DOC, RULE_LINE)
    assert_hit(tree, f"AC-3 P3-name {GRAFANA_DOC}:")


def test_prose_inside_a_fence_fails(tree):
    append(tree, GRAFANA_DOC, og.OPEN, "Delete these by hand.", og.CLOSE)
    assert_hit(tree, f"AC-3 P3-fence {GRAFANA_DOC}:")


def test_unclosed_fence_fails(tree):
    append(tree, GRAFANA_DOC, og.OPEN, RULE_LINE)
    assert_hit(tree, f"AC-3 P3-fence {GRAFANA_DOC}:", "unclosed fence")


def test_nested_and_stray_fence_markers_fail(tree):
    append(tree, GRAFANA_DOC, og.OPEN, og.OPEN, og.CLOSE, og.CLOSE)
    assert_hit(tree, "nested fence", "closing marker without an opening marker")


def test_fencing_a_file_that_still_exists_fails(tree):
    append(tree, GRAFANA_DOC, og.OPEN, EXISTING_FILE_LINE, og.CLOSE)
    assert_hit(tree, f"AC-3 P3-fence {GRAFANA_DOC}:")


def test_ascii_separator_in_a_fence_passes(tree):
    append(tree, GRAFANA_DOC, og.OPEN, RULE_LINE.replace("—", "-"), og.CLOSE)
    assert hits(tree) == []


def test_a_comment_cannot_make_a_deleted_asset_exist(tree):
    append(tree, RULES, "# removed xstk-retired-fake")
    append(tree, GRAFANA_DOC, "xstk-retired-fake")
    assert_hit(tree, f"AC-3 P3-name {GRAFANA_DOC}:")


def test_a_wrong_count_in_removal_prose_fails(tree):
    append(tree, "packages/otel/alerts/README.md", "Delete the four alert rules below")
    assert_hit(tree, "AC-3 P3-count packages/otel/alerts/README.md:")


def test_fallback_tree_with_fenced_dashboards_passes(tree):
    fallback_tree(tree)
    append(tree, DASH_README, og.OPEN, DASH_LINE, EXISTING_FILE_LINE, og.CLOSE)
    assert hits(tree) == []


def test_fallback_tree_with_unfenced_dashboards_fails(tree):
    fallback_tree(tree)
    append(tree, DASH_README, DASH_LINE, EXISTING_FILE_LINE)
    assert_hit(tree, f"AC-3 P3-name {DASH_README}:")


def test_the_attribute_set_stays_documented_without_trading_mode(tree):
    readme = (tree / DASH_README).read_text()
    for attribute in ("service.name", "deployment.environment", "platform"):
        assert attribute in readme
    assert "trading_mode" not in readme


def test_feature_files_are_outside_the_scan(tree):
    append(
        tree,
        "docs/sdd/business-rules/platform.feature",
        "  # see xstk-retired-fake on purpose",
    )
    assert hits(tree) == []


# --- units ---------------------------------------------------------------------------------------


def test_metric_identifiers_drop_functions_keywords_matchers_and_strings():
    expr = 'sum by (svc) (rate(a_total{x="y"}[5m])) / on (svc) b:ratio and c_count offset 5m'
    assert og.metric_identifiers(expr) == ["a_total", "b:ratio", "c_count", "m"]


def test_metric_identifiers_of_a_label_values_query():
    assert og.metric_identifiers("label_values(a_total, service_name)") == ["a_total"]


def test_alert_exprs_joins_a_block_scalar_and_strips_inline_quotes():
    lines = [
        "  expr: |",
        "    a",
        "",
        "      b",
        "  for: 5m",
        '  expr: "c"',
        "  expr: >-",
        "    d",
    ]
    assert og.alert_exprs(lines) == [(1, " a b"), (6, "c"), (7, " d")]


def test_count_claims():
    assert og.count_claims(
        "the five dashboards and 3 v1 alert rules; one alert rule"
    ) == [
        "five dashboards",
        "3 v1 alert rules",
        "one alert rule",
    ]
