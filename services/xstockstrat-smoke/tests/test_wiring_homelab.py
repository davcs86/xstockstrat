"""Homelab staging overlay: fixture-JSON render assertions, workflow structure, release .env."""

import copy
import json
import os
import pathlib
import shutil
import subprocess

import pytest
import yaml

ROOT = pathlib.Path(__file__).resolve().parents[3]
HOMELAB = ROOT / "deploy" / "homelab"
TESTDATA = HOMELAB / "testdata"
JQ = HOMELAB / "render-assert.jq"
HOST = "db.ts.natanddavehouse.com"
BIND = "100.64.0.7"
SMOKE = "xstockstrat-smoke"
SHIP = "docker compose -f compose.yml -f compose.smoke.yml config --no-interpolate --format json"


def _fixture(name):
    return json.loads((TESTDATA / name).read_text())


def _assert(render, target, *, bind="", overlay="no"):
    cmd = ["jq", "-c", "--arg", "target", target, "--arg", "host", HOST]
    cmd += ["--arg", "bind", bind, "--arg", "overlay", overlay, "-f", str(JQ)]
    p = subprocess.run(cmd, input=json.dumps(render), capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    return json.loads(p.stdout)


def _staging(mutate=None, bind=BIND):
    doc = copy.deepcopy(_fixture("staging.json"))
    if mutate:
        mutate(doc["services"])
    return _assert(doc, "staging", bind=bind, overlay="yes")


def _workflow():
    return yaml.safe_load((ROOT / ".github/workflows/deploy-homelab.yml").read_text())


def _step(job, name_part):
    return next(s for s in job["steps"] if name_part in s.get("name", ""))


def test_prod_render_has_no_smoke():
    prod = _fixture("production.json")
    assert len(prod["services"]) == 13 and SMOKE not in prod["services"]
    assert _assert(prod, "production") == []
    assert "smoke-in-production" in _assert(
        {"services": {**prod["services"], SMOKE: _fixture("staging.json")["services"][SMOKE]}},
        "production",
    )


def test_compose_yml_stays_smoke_free_and_overlay_adds_only_smoke():
    assert "smoke" not in (HOMELAB / "compose.yml").read_text().lower()
    overlay = yaml.safe_load((HOMELAB / "compose.smoke.yml").read_text())
    assert list(overlay["services"]) == [SMOKE]


def test_staging_render_has_smoke_ro_dsn_pool_1():
    staging = _fixture("staging.json")
    assert len(staging["services"]) == 14
    env = staging["services"][SMOKE]["environment"]
    assert env["DATABASE_URL"].startswith("postgresql://xstockstrat_staging_smoke_ro:")
    assert ":5432/xstockstrat-staging?sslmode=require" in env["DATABASE_URL"]
    assert env["DB_POOL_MAX"] == "1" and "DB_PGBOUNCER" not in env
    assert _staging() == []

    def set_env(key, val):
        def m(s):
            s[SMOKE]["environment"][key] = val

        return m

    dsn = staging["services"][SMOKE]["environment"]["DATABASE_URL"]
    assert "smoke-dsn" in _staging(set_env("DATABASE_URL", dsn.replace("_smoke_ro", "")))
    assert "smoke-dsn" in _staging(set_env("DATABASE_URL", dsn.replace(":5432/", ":6432/")))
    assert "smoke-dsn" in _staging(set_env("DB_PGBOUNCER", "true"))
    assert "smoke-pool" in _staging(set_env("DB_POOL_MAX", "2"))


def test_smoke_stays_out_of_the_direct_pool_sum_and_must_be_classified():
    def bump(s):
        s[SMOKE]["environment"]["DB_POOL_MAX"] = "1"
        s["xstockstrat-notify"]["environment"]["DB_POOL_MAX"] = "1"

    assert "pool-budget" not in _staging(bump)
    assert "smoke-missing" in _assert(
        {"services": {k: v for k, v in _fixture("staging.json")["services"].items() if k != SMOKE}},
        "staging",
        bind=BIND,
        overlay="yes",
    )
    assert "ports" in _assert(_fixture("staging.json"), "staging", bind=BIND, overlay="no")


def test_smoke_port_bound_to_bind_addr_not_wildcard():
    def host_ip(ip):
        def m(s):
            port = s[SMOKE]["ports"][0]
            if ip is None:
                port.pop("host_ip", None)
            else:
                port["host_ip"] = ip

        return m

    for bad in (None, "0.0.0.0", "100.64.0.99"):
        assert "smoke-bind" in _staging(host_ip(bad))
    assert "smoke-bind" in _staging(bind="")
    assert "smoke-bind" in _staging(bind="0.0.0.0")


def test_smoke_healthcheck_restart_logging_and_env_label():
    def hc(period):
        def m(s):
            s[SMOKE]["healthcheck"]["start_period"] = period

        return m

    for short in ("1m0s", "30s", "1m29s"):
        assert "smoke-healthcheck" in _staging(hc(short))
    assert "smoke-healthcheck" not in _staging(hc("1m30s"))
    assert "smoke-healthcheck" not in _staging(hc("2m0s"))
    assert "smoke-restart" in _staging(lambda s: s[SMOKE].update(restart="no"))
    assert "smoke-logging" in _staging(lambda s: s[SMOKE].pop("logging"))
    assert "smoke-env" in _staging(lambda s: s[SMOKE]["environment"].update(SMOKE_ENV="do-dev"))


def test_shipped_file_has_no_name_or_networks_and_14_image_refs():
    shipped = (TESTDATA / "shipped-staging.json").read_text()
    doc = json.loads(shipped)
    assert "name" not in doc and "networks" not in doc
    assert shipped.count("${IMAGE_") == 14
    assert SMOKE in doc["services"] and len(doc["services"]) == 14


@pytest.mark.skipif(shutil.which("docker") is None, reason="needs docker compose")
def test_fixtures_match_a_live_render():
    env = {"PATH": os.environ["PATH"], "HOME": os.environ.get("HOME", "/")}

    def run(*args):
        r = subprocess.run(
            ["docker", "compose", *args], capture_output=True, text=True, cwd=HOMELAB, env=env
        )
        if r.returncode != 0 and "unknown shorthand flag" in r.stderr:
            pytest.skip("docker compose plugin missing")
        assert r.returncode == 0, r.stderr
        return r.stdout

    envf = ["--env-file", str(TESTDATA / "render.env")]
    prod_env = ["--env-file", str(TESTDATA / "render.production.env")]
    assert json.loads(
        run(*prod_env, "-f", "compose.yml", "config", "--format", "json")
    ) == _fixture("production.json")
    both = ["-f", "compose.yml", "-f", "compose.smoke.yml"]
    assert json.loads(run(*envf, *both, "config", "--format", "json")) == _fixture("staging.json")
    shipped = json.loads(run(*both, "config", "--no-interpolate", "--format", "json"))
    shipped.pop("name", None)
    shipped.pop("networks", None)
    assert shipped == _fixture("shipped-staging.json")


def test_no_smoke_step_for_production():
    wf = _workflow()
    deploy = wf["jobs"]["deploy"]
    detect = _step(deploy, "smoke overlay")
    assert detect["id"] == "overlay"
    assert '"$TARGET_ENV" = staging' in detect["run"]
    assert "-f deploy/homelab/compose.smoke.yml" in detect["run"]
    for s in deploy["steps"]:
        if s is detect or "smoke" not in json.dumps(s).lower():
            continue
        gated = "steps.overlay.outputs.smoke == 'true'" in s.get("if", "")
        # Always-run steps (resolver, ship, release .env) branch on the overlay flag inside.
        env_json = json.dumps(s.get("env", {}))
        inner = "steps.overlay.outputs.smoke" in env_json or "SMOKE_BIND_ADDR" in env_json
        assert gated or inner, s.get("name")


def test_smoke_step_strict_exit_1_on_red():
    deploy = _workflow()["jobs"]["deploy"]
    names = [s.get("name", "") for s in deploy["steps"]]
    smoke = _step(deploy, "Smoke checks")
    run = smoke["run"]
    assert "--mode strict" in run and "--env homelab-staging" in run
    assert "mint-smoke-trigger-leaf.sh" in run and "decode-ca" in run
    assert "SMOKE_ENDPOINT" in run and "$VM_IP:9110" in run
    assert "|| true" not in run and not smoke.get("continue-on-error")
    assert 'exit "$rc"' in run
    assert smoke["id"] == "smoke" and "ran=true" in run
    assert names.index(smoke["name"]) > names.index(_step(deploy, "Ship the release")["name"])
    assert names.index(smoke["name"]) < names.index(_step(deploy, "Leave the tailnet")["name"])
    assert deploy["outputs"]["smoke_ran"] == "${{ steps.smoke.outputs.ran }}"
    assert "ghcr" not in run.lower()


def test_overlay_steps_gated_on_file_existence():
    deploy = _workflow()["jobs"]["deploy"]
    gate = "steps.overlay.outputs.smoke == 'true'"
    assert _step(deploy, "smoke overlay")["run"].count("compose.smoke.yml") == 1
    resolver = _step(deploy, "Resolve every image tag")
    assert "SMOKE_OVERLAY" in resolver["env"] or "steps.overlay" in json.dumps(resolver["env"])
    assert "compose.smoke.yml" in resolver["run"]
    ship = _step(deploy, "Ship the release")
    assert SHIP in ship["run"] and "del(.name,.networks)" in ship["run"]
    assert "steps.overlay.outputs.smoke" in json.dumps(ship["env"])
    bind = _step(deploy, "Smoke port")
    assert gate in bind["if"] and "SMOKE_BIND_ADDR" in bind["run"] and "$VM_IP" in bind["run"]
    for name in ("Smoke checks", "Upload the smoke run file"):
        assert gate in _step(deploy, name)["if"]


def test_record_job_permissions():
    wf = _workflow()
    assert wf["jobs"]["deploy"]["permissions"] == {"contents": "read", "packages": "read"}
    rec = wf["jobs"]["record"]
    assert rec["needs"] == "deploy" or rec["needs"] == ["deploy"]
    assert rec["if"].startswith("always()") and "needs.deploy.outputs.smoke_ran" in rec["if"]
    assert rec["permissions"] == {"contents": "write"}
    text = json.dumps(rec)
    for secret in ("TS_AUTHKEY", "DEPLOY_SSH_KEY", "DEPLOY_KNOWN_HOSTS", "OP_SERVICE", "APP_ENV"):
        assert secret not in text
    assert "tailscale" not in text.lower() and "ssh" not in text.lower()
    assert "download-artifact" in text and "push_with_retry" in text


def _release_env(tmp_path, target, app_env, bind=None):
    ca = tmp_path / "ca"
    subprocess.run(
        ["bash", str(ROOT / "scripts/gen-dev-certs.sh")],
        env={**os.environ, "CERTS_DIR": str(ca)},
        check=True,
        capture_output=True,
    )
    import base64

    ca_b64 = base64.b64encode(
        json.dumps(
            {
                "ca_cert": (ca / "_ca/ca.pem").read_text(),
                "ca_key": (ca / "_ca/ca-key.pem").read_text(),
            }
        ).encode()
    ).decode()
    images = tmp_path / "images.env"
    images.write_text("IMAGE_UI=ghcr.io/x/ui@sha256:" + "0" * 64 + "\n")
    env = {"PATH": os.environ["PATH"], "HOME": str(tmp_path), "TARGET_ENV": target}
    env.update(APP_ENV=app_env, MTLS_CA=ca_b64)
    if bind is not None:
        env["SMOKE_BIND_ADDR"] = bind
    out = tmp_path / "out.env"
    p = subprocess.run(
        ["bash", str(ROOT / "scripts/homelab-release-env.sh"), str(images), str(out)],
        env=env,
        capture_output=True,
        text=True,
    )
    return p, out


def test_release_env_writes_smoke_bind_addr_only_for_staging(tmp_path):
    p, out = _release_env(tmp_path, "staging", "A=1\nSMOKE_BIND_ADDR=6.6.6.6", BIND)
    assert p.returncode == 0, p.stderr
    lines = out.read_text().splitlines()
    assert lines.count(f"SMOKE_BIND_ADDR={BIND}") == 1 and "SMOKE_BIND_ADDR=6.6.6.6" not in lines
    p, out = _release_env(tmp_path, "production", "A=1\nSMOKE_BIND_ADDR=6.6.6.6", BIND)
    assert p.returncode == 0, p.stderr
    assert "SMOKE_BIND_ADDR" not in out.read_text()
    p, out = _release_env(tmp_path, "staging", "A=1", None)
    assert p.returncode == 0 and "SMOKE_BIND_ADDR" not in out.read_text()


@pytest.mark.parametrize("bad", ["0.0.0.0", "evil;rm", "100.64.0.7\nX=1"])
def test_release_env_rejects_a_wildcard_or_malformed_bind_addr(tmp_path, bad):
    p, out = _release_env(tmp_path, "staging", "A=1", bad)
    assert p.returncode != 0 and not out.exists()
