"""Structure tests for the smoke platform wiring: DO specs, workflows and the compose block."""

import pathlib
import re

import yaml

ROOT = pathlib.Path(__file__).resolve().parents[3]


def _load(rel):
    return yaml.safe_load((ROOT / rel).read_text())


def _component(spec, kind, name):
    return next(c for c in spec.get(kind, []) if c["name"] == name)


def _env(component, key):
    return next(e for e in component["envs"] if e["key"] == key)


def test_do_dev_smoke_internal_only_no_ingress():
    spec = _load(".do/app.dev.yaml")
    smoke = _component(spec, "services", "xstockstrat-smoke")
    assert smoke["internal_ports"] == [9110]
    assert "http_port" not in smoke
    assert "routes" not in smoke
    routed = [r["component"]["name"] for r in spec["ingress"]["rules"]]
    assert "xstockstrat-smoke" not in routed
    assert _env(smoke, "SMOKE_ENV")["value"] == "do-dev"
    assert _env(smoke, "MTLS_KEY").get("type") == "SECRET"
    assert _env(smoke, "DATABASE_URL").get("type") == "SECRET"


def test_do_prod_spec_has_no_smoke():
    text = (ROOT / ".do/app.yaml").read_text()
    assert not re.search(r"smoke", text, re.I)
    spec = yaml.safe_load(text)
    names = [c["name"] for k in ("services", "jobs", "workers") for c in spec.get(k, [])]
    assert "xstockstrat-smoke" not in names


def test_post_deploy_job_record_only_and_envs():
    spec = _load(".do/app.dev.yaml")
    job = _component(spec, "jobs", "smoke-record")
    assert job["kind"] == "POST_DEPLOY"
    assert job["image"]["repository"] == "xstockstrat/xstockstrat-smoke"
    cmd = job["run_command"]
    assert "python -m app.trigger" in cmd and "--mode record-only" in cmd
    assert "--env do-dev" in cmd and "9110" in cmd
    keys = {e["key"] for e in job["envs"]}
    assert {"MTLS_CERT", "MTLS_KEY", "MTLS_CA_CERT", "SMOKE_RESULTS_PAT"} <= keys
    assert _env(job, "MTLS_KEY").get("type") == "SECRET"
    assert _env(job, "SMOKE_RESULTS_PAT").get("type") == "SECRET"
    assert _env(job, "MTLS_CERT")["value"] == "YOUR_DEV_SMOKE_TRIGGER_MTLS_CERT"


def test_db_migrator_job_unchanged_and_ordered_before_smoke_job():
    spec = _load(".do/app.dev.yaml")
    kinds = {j["name"]: j["kind"] for j in spec["jobs"]}
    assert kinds["db-migrator"] == "PRE_DEPLOY"


def test_docker_build_has_smoke_entry_with_sha_build_arg():
    wf = _load(".github/workflows/docker-build.yml")
    build = wf["jobs"]["build"]
    entries = build["strategy"]["matrix"]["include"]
    assert len(entries) == 14
    smoke = next(e for e in entries if e["service"] == "xstockstrat-smoke")
    assert smoke["dockerfile"] == "services/xstockstrat-smoke/Dockerfile"
    step = next(s for s in build["steps"] if s.get("name") == "Build and push")
    args = step["with"]["build-args"]
    assert "SMOKE_GIT_SHA=${{ github.sha }}" in args


def test_deploy_declares_and_dev_passes_the_results_pat():
    deploy = _load(".github/workflows/deploy.yml")
    secrets = deploy[True]["workflow_call"]["secrets"]
    assert "SMOKE_RESULTS_PAT" in secrets and not secrets["SMOKE_RESULTS_PAT"]["required"]
    dev = _load(".github/workflows/deploy-dev.yml")
    passed = dev["jobs"]["deploy"]["secrets"]
    assert passed["SMOKE_RESULTS_PAT"] == "${{ secrets.DEV_SMOKE_RESULTS_PAT }}"
    prod = _load(".github/workflows/deploy-prod.yml")
    assert "SMOKE_RESULTS_PAT" not in prod["jobs"]["deploy"].get("secrets", {})


def test_compose_smoke_block_only_default_interpolation():
    spec = _load("docker-compose.yml")
    smoke = spec["services"]["xstockstrat-smoke"]
    raw = (ROOT / "docker-compose.yml").read_text()
    block = raw.split("xstockstrat-smoke:\n", 1)[1].split("\n\n", 1)[0]
    for m in re.finditer(r"\$\{([^}]*)\}", block):
        assert ":-" in m.group(1) and ":?" not in m.group(1), m.group(0)
    assert smoke["environment"]["SMOKE_ENV"] == "homelab-staging"
    assert "9110" in " ".join(smoke["ports"])
