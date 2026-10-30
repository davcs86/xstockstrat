"""Recorder: run-file path/validation and push_with_retry against a local bare repo."""

import json
import threading

import pytest

from app.trigger import record
from tests._trigger_helpers import RUN_ID, body, git, rec, write_json


@pytest.fixture
def bare(tmp_path):
    path = tmp_path / "remote.git"
    git(tmp_path, "init", "-q", "--bare", str(path))
    return path


def clone(bare, tmp_path, name):
    dest = tmp_path / name
    git(tmp_path, "clone", "-q", str(bare), str(dest))
    return dest


def committed(bare, tmp_path, name, run_id):
    repo = clone(bare, tmp_path, name)
    path = record.write_run_file(repo, body(run_id=run_id, records=[rec(f"c-{run_id}")]))
    return repo, path


def branch_files(bare):
    return git(bare, "ls-tree", "-r", "--name-only", "smoke-results").split()


def test_run_file_path_and_fields(tmp_path):
    b = body()
    assert record.record_path("homelab-staging", b["started_at"], RUN_ID) == (
        "smoke-results/homelab-staging/20261030T031500Z-r-20261030T031500Z-1.json"
    )
    out = record.write_run_file(tmp_path, b)
    assert out == tmp_path / record.record_path("homelab-staging", b["started_at"], RUN_ID)
    written = json.loads(out.read_text())
    (r,) = written["records"]
    assert {"check_id", "check_hash", "outcome", "started_at", "evidence"} <= set(r)
    assert written["env"] == "homelab-staging" and written["deployed_sha"] == "a1b2c3d"


def test_record_path_accepts_fractional_and_offset_timestamps():
    assert record.record_path("do-dev", "2026-10-30T03:15:00.123Z", "x").endswith(
        "/20261030T031500Z-x.json"
    )
    assert record.record_path("do-dev", "2026-10-30T05:15:00+02:00", "x").endswith(
        "/20261030T031500Z-x.json"
    )


def test_write_run_file_rejects_schema_violation_and_overwrite(tmp_path):
    pytest.importorskip("jsonschema")
    bad = body()
    bad["records"][0]["outcome"] = "MAYBE"
    with pytest.raises(Exception, match="MAYBE"):
        record.write_run_file(tmp_path, bad)
    record.write_run_file(tmp_path, body())
    with pytest.raises(FileExistsError):
        record.write_run_file(tmp_path, body())


def test_first_push_creates_orphan_branch(bare, tmp_path):
    repo, path = committed(bare, tmp_path, "a", "r1")
    record.push_with_retry(repo, [path])
    assert branch_files(bare) == ["smoke-results/homelab-staging/20261030T031500Z-r1.json"]
    assert git(bare, "rev-list", "--max-parents=0", "smoke-results").split()


def test_concurrent_pushes_each_once_linear_history(bare, tmp_path):
    seed, seed_path = committed(bare, tmp_path, "seed", "r0")
    record.push_with_retry(seed, [seed_path])
    one, p1 = committed(bare, tmp_path, "one", "r1")
    two, p2 = committed(bare, tmp_path, "two", "r2")
    errors = []

    def go(repo, path):
        try:
            record.push_with_retry(repo, [path])
        except Exception as e:  # noqa: BLE001
            errors.append(e)

    threads = [threading.Thread(target=go, args=a) for a in ((one, p1), (two, p2))]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert not errors
    files = branch_files(bare)
    assert sorted(files) == sorted(
        f"smoke-results/homelab-staging/20261030T031500Z-r{i}.json" for i in (0, 1, 2)
    )
    assert git(bare, "rev-list", "--merges", "smoke-results").strip() == ""
    assert len(git(bare, "rev-list", "smoke-results").split()) == 3


def test_stale_orphan_base_rebases_onto_remote_branch(bare, tmp_path):
    a, pa = committed(bare, tmp_path, "a", "r1")
    b, pb = committed(bare, tmp_path, "b", "r2")  # cloned while the remote had no branch
    record.push_with_retry(a, [pa])
    record.push_with_retry(b, [pb])
    assert len(branch_files(bare)) == 2
    assert git(bare, "rev-list", "--max-parents=0", "smoke-results").split().__len__() == 1


def test_push_failure_raises(tmp_path):
    repo = tmp_path / "r"
    git(tmp_path, "init", "-q", str(repo))
    git(repo, "remote", "add", "origin", str(tmp_path / "missing.git"))
    path = write_json(repo / "smoke-results" / "x.json", {"a": 1})
    with pytest.raises(record.PushError):
        record.push_with_retry(repo, [path], attempts=2)
