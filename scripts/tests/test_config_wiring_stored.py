"""Unit tests for scripts/config-wiring-stored.py; the database path is covered by the CI freshness job."""

import hashlib

from conftest import load_script

cs = load_script("config-wiring-stored.py")


def sha(data):
    return hashlib.sha256(data).hexdigest()


def test_inputs_manifest_lists_generator_and_migrations_in_byte_order(tmp_path):
    files = {
        "scripts/config-wiring-stored.py": b"gen",
        "scripts/scratch_db.py": b"helper",
        f"{cs.CONFIG_MIGRATIONS}/001_a.up.sql": b"a",
        f"{cs.CONFIG_MIGRATIONS}/001_a.down.sql": b"b",
        f"{cs.CONFIG_MIGRATIONS}/Z_upper.up.sql": b"c",
    }
    for rel, data in files.items():
        (tmp_path / rel).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / rel).write_bytes(data)
    manifest = "".join(f"{sha(files[rel])}  {rel}\n" for rel in sorted(files))
    assert cs.inputs_sha256(str(tmp_path)) == sha(manifest.encode())


def test_inputs_hash_changes_when_a_generator_source_changes(tmp_path):
    for rel in cs.GENERATOR_FILES:
        (tmp_path / rel).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / rel).write_bytes(b"v1")
    (tmp_path / cs.CONFIG_MIGRATIONS).mkdir(parents=True)
    before = cs.inputs_sha256(str(tmp_path))
    (tmp_path / "scripts/scratch_db.py").write_bytes(b"v2")
    assert cs.inputs_sha256(str(tmp_path)) != before


def test_committed_stored_set_matches_the_current_inputs():
    import json

    with open(cs.REPO_ROOT + "/scripts/config-wiring-stored.json") as f:
        assert json.load(f)["inputs_sha256"] == cs.inputs_sha256()
