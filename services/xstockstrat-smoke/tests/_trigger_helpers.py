import json
import subprocess

RUN_ID = "r-20261030T031500Z-1"
HASH_A, HASH_B, HASH_C, HASH_D = ("a" * 64, "b" * 64, "c" * 64, "d" * 64)


def git(cwd, *args):
    return subprocess.run(
        ["git", "-C", str(cwd), "-c", "user.name=t", "-c", "user.email=t@t", *args],
        check=True,
        capture_output=True,
        text=True,
    ).stdout


def rec(check_id, outcome="PASS", check_hash=HASH_A, started_at="2026-10-30T03:15:00.000Z"):
    return {
        "check_id": check_id,
        "check_hash": check_hash,
        "feature": "smoke-check-runtime",
        "part": "phase-1",
        "outcome": outcome,
        "started_at": started_at,
        "duration_ms": 3,
        "rpcs_invoked": [],
        "evidence": {"rows": 2},
    }


def body(run_id=RUN_ID, env="homelab-staging", records=None, started_at="2026-10-30T03:15:00Z"):
    return {
        "schema_version": 1,
        "run_id": run_id,
        "env": env,
        "deployed_sha": "a1b2c3d",
        "started_at": started_at,
        "trigger": "api",
        "triggered_by": "xstockstrat-smoke-trigger",
        "records": records if records is not None else [rec("c1")],
    }


def write_json(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj))
    return path
