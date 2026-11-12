"""Unit tests for scripts/check-seed-template-parity.py on a synthetic seed tree and snapshot."""

import copy
import hashlib
import json
import re
from pathlib import Path

import pytest
from conftest import load_script

sp = load_script("check-seed-template-parity.py")

ZSCORE_ID = "11111111-1111-4111-8111-111111111111"
ER_ID = "22222222-2222-4222-8222-222222222222"
ER_SOURCE = "result = {'value': [1.0]}\n"
ER_DESC = "Kaufman efficiency ratio."
CUSTOM = "COMPONENT_KIND_CUSTOM_FORMULA"


def md5(text):
    return hashlib.md5(text.encode()).hexdigest()


def period_param(default):
    return {"name": "period", "type": "PARAMETER_TYPE_INT", "defaultValue": default}


def formula_payload(name, source, description, default):
    return {
        "name": name,
        "description": description,
        "source": source,
        "parameters": [period_param(default)],
    }


def snapshot_formula(formula_id, name, source, description, default):
    return {
        "formula_id": formula_id,
        "name": name,
        "author": "owner-1",
        "source_md5": md5(source),
        "description_md5": md5(description),
        "parameters": [period_param(default)],
        "outputs": [],
        "warmup_period": 0,
        "fundamental_inputs": [],
        "input_schema": {},
    }


def component(ref, formula_id):
    return {
        "ref_name": ref,
        "kind": CUSTOM,
        "formula_id": formula_id,
        "params": {"period": 10.0},
    }


def definition(strategy_id, formula_id):
    return {
        "strategy_id": strategy_id,
        "display_name": f"Display {strategy_id}",
        "components": [component("er", formula_id)],
        "entry_rule": '{"fn": "<", "lhs": "er", "rhs": 0.3}',
        "exit_rule": '{"fn": ">", "lhs": "er", "rhs": 0.5}',
    }


def base():
    """A consistent (seeds, snapshot) pair: 3 formulas, 2 strategies, 1 source."""
    composite_tid = sp.COMPOSITE_TEMPLATE_ID
    seeds = {
        "formula": [
            (
                "tpl-kaufman_efficiency_ratio",
                "Kaufman Efficiency Ratio",
                ER_DESC,
                formula_payload("Kaufman Efficiency Ratio", ER_SOURCE, ER_DESC, 10),
            ),
            (
                "tpl-mean_reversion_z_score",
                "Mean-Reversion Z-Score",
                "",
                {
                    "name": "Mean-Reversion Z-Score",
                    "source": "result = 1",
                    "parameters": [period_param(20)],
                },
            ),
            (
                composite_tid,
                sp.COMPOSITE_NAME,
                "",
                {"name": sp.COMPOSITE_NAME, "source": "x"},
            ),
        ],
        "strategy": [
            (
                "tpl-er_trend",
                "Display er_trend",
                "",
                definition("er_trend", "tpl-kaufman_efficiency_ratio"),
            ),
            (
                f"tpl-{sp.BLEND_STRATEGY_ID}",
                f"Display {sp.BLEND_STRATEGY_ID}",
                "",
                {
                    **definition(sp.BLEND_STRATEGY_ID, composite_tid),
                    "strategy_id": sp.BLEND_TEMPLATE_STRATEGY_ID,
                },
            ),
        ],
        "source": [
            (
                "tpl-prnewswire_releases",
                "PR Newswire",
                "",
                {
                    "slug": "prnewswire_releases",
                    "display_name": "PR Newswire",
                    "source_type": "mediated_simple_website",
                    "extractor_module": "app.extractors.noop",
                    "config_json": {
                        "url": "https://example.test/",
                        "scrape_selector": "a.link",
                    },
                    "reliability_weight": 1.0,
                },
            ),
        ],
    }
    snapshot = {
        "exported_at": "2026-11-12T00:00:00+00:00",
        "formulas": [
            snapshot_formula(ER_ID, "Kaufman Efficiency Ratio", ER_SOURCE, ER_DESC, 10),
            snapshot_formula(ZSCORE_ID, "Mean-Reversion Z-Score", "result = 1", "", 20),
            {
                **snapshot_formula(
                    sp.SYSTEM_FORMULA_ID,
                    "Fundamentals Value+Quality Composite (v1)",
                    "s",
                    "d",
                    1,
                ),
                "author": "system",
                "fundamental_inputs": [2, 3],
            },
        ],
        "strategies": [
            {
                "strategy_id": "er_trend",
                "display_name": "Display er_trend",
                "active": True,
                "live_enabled": True,
                "definition_json": {
                    **definition("er_trend", ER_ID),
                    "user_id": "owner-1",
                    "active": True,
                    "live_enabled": True,
                },
            },
            {
                "strategy_id": sp.BLEND_STRATEGY_ID,
                "display_name": f"Display {sp.BLEND_STRATEGY_ID}",
                "active": True,
                "live_enabled": True,
                "definition_json": {
                    **definition(sp.BLEND_STRATEGY_ID, sp.SYSTEM_FORMULA_ID),
                    "user_id": "owner-1",
                },
            },
        ],
        "sources": [
            {
                "slug": "prnewswire_releases",
                "display_name": "PR Newswire",
                "source_type": "mediated_simple_website",
                "extractor_module": "app.extractors.noop",
                "reliability_weight": 1.0,
                "config_json": {
                    "url": "https://example.test/",
                    "scrape_selector": "a.link",
                },
            },
        ],
    }
    return seeds, snapshot


def seed_sql(rows):
    values = ",\n".join(
        f"  ($t${tid}$t$, $t${name}$t$, $t${desc}$t$, $t${payload if isinstance(payload, str) else json.dumps(payload)}$t$::jsonb, 'system')"
        for tid, name, desc, payload in rows
    )
    return f"INSERT INTO x (template_id, name, description, payload, created_by) VALUES\n{values}\nON CONFLICT (template_id) DO NOTHING;\n"


SEED_PATHS = {
    "formula": "services/xstockstrat-indicators/migrations/008_seed_formula_templates.up.sql",
    "strategy": "services/xstockstrat-analysis/migrations/028_seed_strategy_templates.up.sql",
    "source": "services/xstockstrat-ingest/migrations/016_seed_source_templates.up.sql",
}


def write_tree(tmp_path, seeds, snapshot, kinds=("formula", "strategy", "source")):
    for kind in kinds:
        path = tmp_path / SEED_PATHS[kind]
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(seed_sql(seeds[kind]))
    snap = tmp_path / "snapshot.json"
    snap.write_text(json.dumps(snapshot))
    return snap


def run(tmp_path, seeds, snapshot, *extra, kinds=("formula", "strategy", "source")):
    snap = write_tree(tmp_path, seeds, snapshot, kinds)
    return sp.main(["--root", str(tmp_path), "--snapshot", str(snap), *extra])


def test_consistent_tree_passes(tmp_path, capsys):
    seeds, snapshot = base()
    assert run(tmp_path, seeds, snapshot) == 0
    assert capsys.readouterr().err == ""


# ── 1. parser good / bad pair ────────────────────────────────────────────────


def test_source_ending_in_newline_round_trips_through_the_parser():
    payload = formula_payload("Kaufman Efficiency Ratio", ER_SOURCE, ER_DESC, 10)
    rows = sp.parse_seed(
        seed_sql(
            [
                (
                    "tpl-kaufman_efficiency_ratio",
                    "Kaufman Efficiency Ratio",
                    ER_DESC,
                    payload,
                )
            ]
        )
    )
    assert rows[0]["payload"]["source"].endswith("\n")
    assert md5(rows[0]["payload"]["source"]) == md5(ER_SOURCE)


def test_a_missing_literal_is_exit_2(tmp_path, capsys):
    seeds, snapshot = base()
    write_tree(tmp_path, seeds, snapshot)
    path = tmp_path / SEED_PATHS["formula"]
    path.write_text(path.read_text().replace("$t$Kaufman Efficiency Ratio$t$, ", "", 1))
    assert (
        sp.main(
            ["--root", str(tmp_path), "--snapshot", str(tmp_path / "snapshot.json")]
        )
        == 2
    )
    assert "seed_formula_templates" in capsys.readouterr().err


def test_a_payload_that_is_a_json_array_is_exit_2(tmp_path):
    seeds, snapshot = base()
    seeds["source"][0] = ("tpl-prnewswire_releases", "PR Newswire", "", "[1, 2]")
    assert run(tmp_path, seeds, snapshot) == 2


def test_an_unreadable_snapshot_is_exit_2(tmp_path):
    seeds, snapshot = base()
    write_tree(tmp_path, seeds, snapshot)
    assert (
        sp.main(["--root", str(tmp_path), "--snapshot", str(tmp_path / "absent.json")])
        == 2
    )


def test_two_seed_files_for_one_kind_is_exit_2(tmp_path):
    seeds, snapshot = base()
    write_tree(tmp_path, seeds, snapshot)
    dup = tmp_path / SEED_PATHS["source"].replace("016_", "017_")
    dup.write_text(seed_sql(seeds["source"]))
    assert (
        sp.main(
            ["--root", str(tmp_path), "--snapshot", str(tmp_path / "snapshot.json")]
        )
        == 2
    )


# ── 2. AC-14 ─────────────────────────────────────────────────────────────────


def test_ac14_a_drifted_parameter_default_names_the_template_and_field(
    tmp_path, capsys
):
    seeds, snapshot = base()
    seeds["formula"][0][3]["parameters"][0]["defaultValue"] = 11
    assert run(tmp_path, seeds, snapshot) == 1
    err = capsys.readouterr().err
    assert "Kaufman Efficiency Ratio" in err
    assert "parameters.period.defaultValue" in err


def test_a_changed_source_is_reported_by_md5(tmp_path, capsys):
    seeds, snapshot = base()
    seeds["formula"][0][3]["source"] = ER_SOURCE.rstrip("\n")
    assert run(tmp_path, seeds, snapshot) == 1
    assert "Kaufman Efficiency Ratio: source" in capsys.readouterr().err


# ── 3. id map ────────────────────────────────────────────────────────────────


def test_two_snapshot_formulas_with_one_name_fail(tmp_path, capsys):
    seeds, snapshot = base()
    snapshot["formulas"].append(
        snapshot_formula(
            "33333333-3333-4333-8333-333333333333",
            "Kaufman Efficiency Ratio",
            "a",
            "b",
            1,
        )
    )
    assert run(tmp_path, seeds, snapshot) == 1
    assert "duplicate formula name" in capsys.readouterr().err


def test_a_strategy_component_uuid_missing_from_the_snapshot_formulas_fails(
    tmp_path, capsys
):
    seeds, snapshot = base()
    snapshot["strategies"][0]["definition_json"]["components"][0]["formula_id"] = (
        "99999999-9999-4999-8999-999999999999"
    )
    assert run(tmp_path, seeds, snapshot) == 1
    assert "not in the snapshot formulas" in capsys.readouterr().err


def test_a_seed_component_that_keeps_the_staging_uuid_fails(tmp_path, capsys):
    seeds, snapshot = base()
    seeds["strategy"][0][3]["components"][0]["formula_id"] = ER_ID
    assert run(tmp_path, seeds, snapshot) == 1
    assert "components.er.formula_id" in capsys.readouterr().err


def test_a_mapped_formula_without_a_seed_row_fails(tmp_path, capsys):
    seeds, snapshot = base()
    del seeds["formula"][1]
    assert run(tmp_path, seeds, snapshot) == 1
    assert "tpl-mean_reversion_z_score" in capsys.readouterr().err


def test_the_system_formula_maps_to_the_composite_template():
    _, snapshot = base()
    id_map, problems = sp.formula_id_map(snapshot["formulas"])
    assert problems == []
    assert id_map[sp.SYSTEM_FORMULA_ID] == sp.COMPOSITE_TEMPLATE_ID
    assert id_map[ER_ID] == "tpl-kaufman_efficiency_ratio"
    assert sp.slug("SMA Trend Slope (fractional)") == "sma_trend_slope_fractional"


# ── 4. AC-36 ─────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "key", ["user_id", "origin", "warnings", "active", "live_enabled"]
)
def test_ac36_an_owner_or_state_key_in_a_strategy_payload_is_reported(
    tmp_path, capsys, key
):
    seeds, snapshot = base()
    seeds["strategy"][0][3][key] = "x"
    assert run(tmp_path, seeds, snapshot) == 1
    assert f"er_trend: {key}: must be absent" in capsys.readouterr().err


# ── 5. allowlist ─────────────────────────────────────────────────────────────


def test_an_omitted_warmup_against_zero_passes_and_a_real_one_fails(tmp_path, capsys):
    seeds, snapshot = base()
    snapshot["formulas"][0]["warmup_period"] = 220
    assert run(tmp_path, seeds, snapshot) == 1
    assert "Kaufman Efficiency Ratio: warmupPeriod" in capsys.readouterr().err


def test_the_composite_must_carry_the_template_name(tmp_path, capsys):
    seeds, snapshot = base()
    tid, _, desc, payload = seeds["formula"][2]
    seeds["formula"][2] = (
        tid,
        "Fundamentals Value+Quality Composite (v1)",
        desc,
        payload,
    )
    assert run(tmp_path, seeds, snapshot) == 1
    assert sp.COMPOSITE_TEMPLATE_ID in capsys.readouterr().err


def test_a_changed_entry_rule_fails(tmp_path, capsys):
    seeds, snapshot = base()
    seeds["strategy"][0][3]["entry_rule"] = '{"fn": "<", "lhs": "er", "rhs": 0.31}'
    assert run(tmp_path, seeds, snapshot) == 1
    assert "er_trend: entry_rule" in capsys.readouterr().err


def test_the_blend_template_must_use_the_copy_id(tmp_path, capsys):
    seeds, snapshot = base()
    seeds["strategy"][1][3]["strategy_id"] = sp.BLEND_STRATEGY_ID
    assert run(tmp_path, seeds, snapshot) == 1
    assert f"{sp.BLEND_STRATEGY_ID}: strategy_id" in capsys.readouterr().err


def test_a_dead_signal_params_key_only_in_the_snapshot_fails(tmp_path, capsys):
    seeds, snapshot = base()
    snapshot["strategies"][0]["definition_json"]["signal_params"] = {
        "signal_weight": 0.4
    }
    assert run(tmp_path, seeds, snapshot) == 1
    assert "er_trend: signal_params" in capsys.readouterr().err


def test_an_empty_signal_params_only_in_the_snapshot_passes(tmp_path):
    seeds, snapshot = base()
    snapshot["strategies"][0]["definition_json"]["signal_params"] = {}
    assert run(tmp_path, seeds, snapshot) == 0


def test_a_changed_scrape_selector_fails(tmp_path, capsys):
    seeds, snapshot = base()
    seeds["source"][0][3]["config_json"]["scrape_selector"] = "entry"
    assert run(tmp_path, seeds, snapshot) == 1
    assert "prnewswire_releases: config_json.scrape_selector" in capsys.readouterr().err


def test_a_changed_extractor_module_fails(tmp_path, capsys):
    seeds, snapshot = base()
    seeds["source"][0][3]["extractor_module"] = "app.extractors.other"
    assert run(tmp_path, seeds, snapshot) == 1
    assert "prnewswire_releases: extractor_module" in capsys.readouterr().err


def test_a_source_payload_key_outside_the_template_fields_fails(tmp_path, capsys):
    seeds, snapshot = base()
    seeds["source"][0][3]["credentials_ref"] = "secret-key"
    assert run(tmp_path, seeds, snapshot) == 1
    assert "prnewswire_releases: credentials_ref" in capsys.readouterr().err


def test_a_missing_reliability_weight_fails_unless_staging_is_zero(tmp_path, capsys):
    seeds, snapshot = base()
    del seeds["source"][0][3]["reliability_weight"]
    assert run(tmp_path, seeds, snapshot) == 1
    assert "prnewswire_releases: reliability_weight" in capsys.readouterr().err
    seeds2, snapshot2 = copy.deepcopy((seeds, snapshot))
    snapshot2["sources"][0]["reliability_weight"] = 0
    assert run(tmp_path, seeds2, snapshot2) == 0


def test_a_template_id_that_is_not_tpl_plus_the_staging_id_fails(tmp_path, capsys):
    seeds, snapshot = base()
    _tid, name, desc, payload = seeds["strategy"][0]
    seeds["strategy"][0] = ("tpl-other", name, desc, payload)
    assert run(tmp_path, seeds, snapshot) == 1
    err = capsys.readouterr().err
    assert "tpl-er_trend" in err and "tpl-other" in err


# ── 6. --kind ────────────────────────────────────────────────────────────────


def test_kind_source_reads_only_the_source_seed(tmp_path):
    seeds, snapshot = base()
    assert run(tmp_path, seeds, snapshot, "--kind", "source", kinds=("source",)) == 0


def test_a_placeholder_user_agent_passes_and_any_other_change_fails(tmp_path, capsys):
    seeds, snapshot = base()
    snapshot["sources"][0]["config_json"]["request_headers"] = {
        "User-Agent": "agent/1.0 (staging)"
    }
    seeds["source"][0][3]["config_json"]["request_headers"] = {
        "User-Agent": sp.PLACEHOLDER_USER_AGENT
    }
    assert run(tmp_path, seeds, snapshot) == 0
    seeds["source"][0][3]["config_json"]["request_headers"] = {
        "User-Agent": "something else"
    }
    assert run(tmp_path, seeds, snapshot) == 1
    assert "config_json.request_headers.User-Agent" in capsys.readouterr().err


# ── The committed seeds (real files) ─────────────────────────────────────────

REPO = Path(__file__).resolve().parents[2]
SNAPSHOT = REPO / sp.DEFAULT_SNAPSHOT
TPL_ID = re.compile(r"tpl-[a-z0-9_]+")
SERVICE_OF = {"formula": "indicators", "strategy": "analysis", "source": "ingest"}


def real_rows(kind):
    return sp.load_seed(REPO, kind)


def seed_path(kind, suffix):
    (up,) = sorted(REPO.glob(sp.SEED_GLOBS[kind]))
    return up.with_name(up.name.replace(".up.sql", f".{suffix}.sql"))


def test_the_committed_seeds_hold_9_14_and_4_rows():
    assert [len(real_rows(k)) for k in ("formula", "strategy", "source")] == [9, 14, 4]


def test_ac36_no_committed_strategy_payload_carries_owner_or_state_fields():
    for row in real_rows("strategy"):
        assert not set(row["payload"]) & set(sp.ABSENT_STRATEGY_KEYS), row[
            "template_id"
        ]


@pytest.mark.parametrize("kind", ["formula", "strategy", "source"])
def test_one_seeded_id_set_across_insert_guard_down_and_assertions(kind):
    ids = {r["template_id"] for r in real_rows(kind)}
    up = seed_path(kind, "up").read_text()
    guard = up.split("ON CONFLICT (template_id) DO NOTHING;", 1)[1].split("END $$;", 1)[
        0
    ]
    assert set(TPL_ID.findall(guard)) == ids
    assert set(TPL_ID.findall(seed_path(kind, "down").read_text())) == ids
    slug = seed_path(kind, "up").name.split("_", 1)[1].removesuffix(".up.sql")
    assertion_files = [
        p
        for p in sorted(
            (REPO / "scripts/migration-assertions").glob(f"{SERVICE_OF[kind]}-*.sql")
        )
        if re.search(rf"\\ir .*{slug}", p.read_text())
    ]
    assert len(assertion_files) == 1, assertion_files
    post_state = assertion_files[0].read_text().split("ARRAY[", 1)[1].split("]", 1)[0]
    assert set(TPL_ID.findall(post_state)) == ids


def in_list(query, column):
    """The quoted values of every `<column> IN ( ... )` list in the export query."""
    lists = re.findall(rf"{re.escape(column)} IN \((.*?)\)\s*\n", query, re.DOTALL)
    assert lists, column
    return [set(re.findall(r"'([^']+)'", body)) for body in lists]


def test_the_export_query_names_exactly_what_is_seeded():
    query = (REPO / "scripts/testdata/seed-templates-staging-export.sql").read_text()
    strategy_ids = {
        r["template_id"].removeprefix("tpl-") for r in real_rows("strategy")
    }
    slugs = {r["template_id"].removeprefix("tpl-") for r in real_rows("source")}
    formula_names = {r["name"] for r in real_rows("formula")} - {sp.COMPOSITE_NAME}
    assert len(formula_names) == 8
    assert all(ids == strategy_ids for ids in in_list(query, "strategy_id"))
    assert in_list(query, "g.slug") == [slugs]
    assert in_list(query, "f.name") == [formula_names]


def test_every_seeded_strategy_formula_reference_is_a_seeded_formula_template():
    formula_ids = {r["template_id"] for r in real_rows("formula")}
    for row in real_rows("strategy"):
        for comp in row["payload"].get("components", []):
            if comp.get("kind") == sp.CUSTOM_FORMULA_KIND:
                assert comp["formula_id"] in formula_ids, (
                    row["template_id"],
                    comp["ref_name"],
                )


def test_ac35_committed_seeds_are_at_parity_with_the_staging_export(capsys):
    """Pre-merge gate: fails until the operator's staging export is committed unedited."""
    assert SNAPSHOT.exists(), (
        f"{sp.DEFAULT_SNAPSHOT} is missing: run scripts/testdata/seed-templates-staging-export.sql "
        "on staging and commit its output before merging"
    )
    assert sp.main(["--root", str(REPO)]) == 0, capsys.readouterr().err
