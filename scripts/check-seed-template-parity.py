#!/usr/bin/env python3
"""Fail when a seeded template payload differs from the staging export it was authored from.

Usage: check-seed-template-parity.py [--kind formula|strategy|source]... [--snapshot PATH] [--root DIR]

  Seeds     services/xstockstrat-{indicators,analysis,ingest}/migrations/*_seed_{formula,strategy,source}_templates.up.sql;
            a row is four consecutive $t$...$t$ literals: template_id, name, description, payload JSON.
  Snapshot  the unedited output of scripts/testdata/seed-templates-staging-export.sql.
  Allowed   formula ids rewritten to template ids (derived from the snapshot names), a key omitted on one
            side whose other-side value is a proto3 default, user_id/origin/warnings/active/live_enabled
            absent from strategy payloads, the blend template's strategy_id, and the composite formula
            template (pinned to the indicators code module by that service's tests, not to staging).

Each difference prints "<kind> <template name or id>: <field path>: <what differs>" to stderr.
Exit 0 = at parity; 1 = differences; 2 = unreadable input or a seed file that does not parse.
"""

import argparse
import copy
import hashlib
import json
import re
import sys
from pathlib import Path

DEFAULT_SNAPSHOT = "scripts/testdata/seed-templates-staging-2026-11-12.json"
SEED_GLOBS = {
    "formula": "services/xstockstrat-indicators/migrations/*_seed_formula_templates.up.sql",
    "strategy": "services/xstockstrat-analysis/migrations/*_seed_strategy_templates.up.sql",
    "source": "services/xstockstrat-ingest/migrations/*_seed_source_templates.up.sql",
}
SYSTEM_FORMULA_ID = "d1ff5e6b-6d9c-589d-b95e-defd862c702b"
COMPOSITE_NAME = "Fundamentals Value+Quality Composite (template)"
COMPOSITE_TEMPLATE_ID = "tpl-fundamentals_value_quality_composite_template"
BLEND_STRATEGY_ID = "fundamentals_macd_blend"
BLEND_TEMPLATE_STRATEGY_ID = "fundamentals_macd_blend_copy"
CUSTOM_FORMULA_KIND = "COMPONENT_KIND_CUSTOM_FORMULA"
ABSENT_STRATEGY_KEYS = ("user_id", "origin", "warnings", "active", "live_enabled")
SOURCE_PAYLOAD_FIELDS = (
    "slug",
    "display_name",
    "source_type",
    "extractor_module",
    "config_json",
    "reliability_weight",
)
_LITERAL = re.compile(r"\$t\$(.*?)\$t\$", re.DOTALL)
_MISSING = object()


class SeedError(Exception):
    """A seed file or snapshot that cannot be read as the fixed grammar."""


def parse_seed(text):
    """Rows of a seed file, in file order."""
    literals = _LITERAL.findall(text)
    if not literals or len(literals) % 4:
        raise SeedError(
            f"{len(literals)} $t$ literals; expected a non-zero multiple of 4"
        )
    rows = []
    for i in range(0, len(literals), 4):
        template_id, name, description, raw = literals[i : i + 4]
        try:
            payload = json.loads(raw)
        except ValueError as e:
            raise SeedError(f"{template_id}: payload is not JSON ({e})") from e
        if not isinstance(payload, dict):
            raise SeedError(f"{template_id}: payload is not a JSON object")
        rows.append(
            {
                "template_id": template_id,
                "name": name,
                "description": description,
                "payload": payload,
            }
        )
    return rows


def load_seed(root, kind):
    matches = sorted(Path(root).glob(SEED_GLOBS[kind]))
    if len(matches) != 1:
        raise SeedError(
            f"{SEED_GLOBS[kind]}: {len(matches)} files match; expected exactly 1"
        )
    try:
        return parse_seed(matches[0].read_text())
    except SeedError as e:
        raise SeedError(f"{matches[0].name}: {e}") from e


def slug(name):
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


def md5(text):
    return hashlib.md5(text.encode()).hexdigest()


def is_default(value):
    return isinstance(value, (int, float, str, list, dict)) and value in (0, "", [], {})


def _named(items):
    return all(isinstance(i, dict) and isinstance(i.get("name"), str) for i in items)


def diff(expected, actual, path=""):
    """Paths at which `actual` (seed) differs from `expected` (staging), proto3 defaults aside."""
    if expected is _MISSING or actual is _MISSING:
        present = actual if expected is _MISSING else expected
        if is_default(present):
            return []
        side = "seed" if expected is _MISSING else "staging"
        return [f"{path}: only in {side} ({present!r})"]
    if isinstance(expected, dict) and isinstance(actual, dict):
        out = []
        for key in sorted(set(expected) | set(actual)):
            out += diff(
                expected.get(key, _MISSING),
                actual.get(key, _MISSING),
                f"{path}.{key}" if path else key,
            )
        return out
    if isinstance(expected, list) and isinstance(actual, list):
        if expected and actual and _named(expected) and _named(actual):
            return diff(
                {i["name"]: i for i in expected}, {i["name"]: i for i in actual}, path
            )
        if len(expected) != len(actual):
            return [
                f"{path}: staging has {len(expected)} items, seed has {len(actual)}"
            ]
        out = []
        for n, (e, a) in enumerate(zip(expected, actual)):
            out += diff(e, a, f"{path}[{n}]")
        return out
    if expected != actual or isinstance(expected, bool) != isinstance(actual, bool):
        return [f"{path}: staging {expected!r}, seed {actual!r}"]
    return []


def formula_id_map(snapshot_formulas):
    """(staging formula id -> template id, problems). Derived from the snapshot, never hand-written."""
    id_map, problems, seen = {}, [], set()
    for f in snapshot_formulas:
        if f["name"] in seen:
            problems.append(
                f"formula {f['name']}: name: duplicate formula name in the snapshot"
            )
        seen.add(f["name"])
        if f["formula_id"] == SYSTEM_FORMULA_ID:
            id_map[f["formula_id"]] = COMPOSITE_TEMPLATE_ID
        else:
            id_map[f["formula_id"]] = "tpl-" + slug(f["name"])
    return id_map, problems


def _unmatched(kind, rows, matched):
    return [
        f"{kind} {r['template_id']}: template_id: seed row has no staging counterpart"
        for r in rows
        if r["template_id"] not in matched
    ]


def compare_formulas(rows, snapshot_formulas, id_map):
    by_id = {r["template_id"]: r for r in rows}
    out, matched = [], set()
    for f in snapshot_formulas:
        tid, label = id_map[f["formula_id"]], f"formula {f['name']}"
        row = by_id.get(tid)
        if row is None:
            out.append(f"{label}: template_id: no seed row {tid}")
            continue
        matched.add(tid)
        payload = row["payload"]
        if f["formula_id"] == SYSTEM_FORMULA_ID:
            if row["name"] != COMPOSITE_NAME or payload.get("name") != COMPOSITE_NAME:
                out.append(f"formula {tid}: name: must be {COMPOSITE_NAME!r}")
            continue
        checks = [
            ("name", f["name"], payload.get("name", "")),
            ("name (column)", payload.get("name", ""), row["name"]),
            (
                "description (column)",
                payload.get("description", ""),
                row["description"],
            ),
            ("source", f["source_md5"], md5(payload.get("source", ""))),
            ("description", f["description_md5"], md5(payload.get("description", ""))),
        ]
        out += [
            f"{label}: {what}: staging {e!r}, seed {a!r}"
            for what, e, a in checks
            if e != a
        ]
        expected = {
            "parameters": f.get("parameters") or [],
            "outputs": f.get("outputs") or [],
            "warmupPeriod": f.get("warmup_period") or 0,
            "inputSchema": f.get("input_schema") or {},
            "fundamentalInputs": f.get("fundamental_inputs") or [],
        }
        actual = {key: payload[key] for key in expected if key in payload}
        out += [f"{label}: {d}" for d in diff(expected, actual)]
    return out + _unmatched("formula", rows, matched)


def expected_strategy_payload(definition, id_map):
    """(the template form of a staging definition, problems)."""
    expected = copy.deepcopy(definition)
    for key in ABSENT_STRATEGY_KEYS:
        expected.pop(key, None)
    problems = []
    for comp in expected.get("components", []):
        if comp.get("kind") == CUSTOM_FORMULA_KIND and comp.get("formula_id"):
            mapped = id_map.get(comp["formula_id"])
            if mapped is None:
                problems.append(
                    f"components.{comp.get('ref_name')}.formula_id: {comp['formula_id']} is not in the snapshot formulas"
                )
            else:
                comp["formula_id"] = mapped
    if expected.get("strategy_id") == BLEND_STRATEGY_ID:
        expected["strategy_id"] = BLEND_TEMPLATE_STRATEGY_ID
    return expected, problems


def _by_ref(definition):
    """Components keyed by ref_name so a difference names the component, not its index."""
    keyed = dict(definition)
    comps = definition.get("components")
    if isinstance(comps, list) and all(
        isinstance(c, dict) and c.get("ref_name") for c in comps
    ):
        keyed["components"] = {c["ref_name"]: c for c in comps}
    return keyed


def compare_strategies(rows, snapshot_strategies, id_map):
    by_id = {r["template_id"]: r for r in rows}
    out, matched = [], set()
    for s in snapshot_strategies:
        tid, label = f"tpl-{s['strategy_id']}", f"strategy {s['strategy_id']}"
        row = by_id.get(tid)
        if row is None:
            out.append(f"{label}: template_id: no seed row {tid}")
            continue
        matched.add(tid)
        payload = row["payload"]
        out += [
            f"{label}: {key}: must be absent from a template payload"
            for key in ABSENT_STRATEGY_KEYS
            if key in payload
        ]
        if row["name"] != s["display_name"]:
            out.append(
                f"{label}: name (column): staging {s['display_name']!r}, seed {row['name']!r}"
            )
        expected, problems = expected_strategy_payload(s["definition_json"], id_map)
        out += [f"{label}: {p}" for p in problems]
        actual = {k: v for k, v in payload.items() if k not in ABSENT_STRATEGY_KEYS}
        out += [f"{label}: {d}" for d in diff(_by_ref(expected), _by_ref(actual))]
    return out + _unmatched("strategy", rows, matched)


def compare_sources(rows, snapshot_sources):
    by_id = {r["template_id"]: r for r in rows}
    out, matched = [], set()
    for s in snapshot_sources:
        tid, label = f"tpl-{s['slug']}", f"source {s['slug']}"
        row = by_id.get(tid)
        if row is None:
            out.append(f"{label}: template_id: no seed row {tid}")
            continue
        matched.add(tid)
        payload = row["payload"]
        out += [
            f"{label}: {key}: not a template payload field"
            for key in sorted(set(payload) - set(SOURCE_PAYLOAD_FIELDS))
        ]
        if row["name"] != s["display_name"]:
            out.append(
                f"{label}: name (column): staging {s['display_name']!r}, seed {row['name']!r}"
            )
        expected = {
            key: s[key] for key in SOURCE_PAYLOAD_FIELDS if s.get(key) is not None
        }
        actual = {key: payload[key] for key in SOURCE_PAYLOAD_FIELDS if key in payload}
        out += [f"{label}: {d}" for d in diff(expected, actual)]
    return out + _unmatched("source", rows, matched)


def check(root, snapshot, kinds):
    id_map, out = formula_id_map(snapshot.get("formulas", []))
    if "formula" in kinds:
        out += compare_formulas(
            load_seed(root, "formula"), snapshot.get("formulas", []), id_map
        )
    if "strategy" in kinds:
        out += compare_strategies(
            load_seed(root, "strategy"), snapshot.get("strategies", []), id_map
        )
    if "source" in kinds:
        out += compare_sources(load_seed(root, "source"), snapshot.get("sources", []))
    return out


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--kind", action="append", choices=sorted(SEED_GLOBS))
    parser.add_argument("--snapshot")
    parser.add_argument("--root", default=str(Path(__file__).resolve().parent.parent))
    args = parser.parse_args(argv)
    snapshot_path = (
        Path(args.snapshot) if args.snapshot else Path(args.root) / DEFAULT_SNAPSHOT
    )
    try:
        snapshot = json.loads(snapshot_path.read_text())
        differences = check(args.root, snapshot, args.kind or sorted(SEED_GLOBS))
    except (OSError, ValueError, SeedError) as e:
        print(f"check-seed-template-parity: {e}", file=sys.stderr)
        return 2
    for line in differences:
        print(line, file=sys.stderr)
    return 1 if differences else 0


if __name__ == "__main__":
    sys.exit(main())
