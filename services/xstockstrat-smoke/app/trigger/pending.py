"""Pending = catalog checks with no recorded PASS for (check_id, check_hash, env)."""

import json
import pathlib


def read_recorded(results_dir) -> list[dict]:
    """Flatten every run file under results_dir, attaching each run's env to its records."""
    out = []
    for f in sorted(pathlib.Path(results_dir).glob("smoke-results/*/*.json")):
        run = json.loads(f.read_text())
        out.extend({**r, "env": run["env"]} for r in run["records"])
    return out


def pending(catalog: list[dict], recorded: list[dict], env: str) -> list[str]:
    passed = {
        (r["check_id"], r["check_hash"])
        for r in recorded
        if r["env"] == env and r["outcome"] == "PASS"
    }
    return [c["id"] for c in catalog if (c["id"], c["check_hash"]) not in passed]
