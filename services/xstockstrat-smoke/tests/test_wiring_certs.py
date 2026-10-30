"""Cert scripts and the deploy.yml placeholder substitution, run for real with throwaway certs."""

import os
import pathlib
import re
import subprocess

import yaml

ROOT = pathlib.Path(__file__).resolve().parents[3]
SCRIPTS = ROOT / "scripts"


def _run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


def _san(cert):
    out = _run(["openssl", "x509", "-in", str(cert), "-noout", "-ext", "subjectAltName"]).stdout
    return re.findall(r"DNS:([\w.-]+)", out)


def test_gen_dev_certs_mints_13_leaves_incl_smoke_never_the_trigger(tmp_path):
    env = {**os.environ, "CERTS_DIR": str(tmp_path)}
    r = _run(["bash", str(SCRIPTS / "gen-dev-certs.sh")], env=env)
    assert r.returncode == 0, r.stderr
    assert "13 service leaves" in r.stdout
    leaves = sorted(p.name for p in tmp_path.glob("xstockstrat-*"))
    assert len(leaves) == 13
    assert "xstockstrat-smoke" in leaves and "xstockstrat-smoke-trigger" not in leaves
    assert _san(tmp_path / "xstockstrat-smoke" / "cert.pem") == ["xstockstrat-smoke"]


def test_mtls_dev_env_pair_list_has_smoke():
    text = (SCRIPTS / "mtls-dev-env.sh").read_text()
    assert '"smoke:SMOKE"' in text and "13 per-service" in text


def test_mint_trigger_leaf_chains_to_ca_and_leaves_no_ca_key(tmp_path):
    ca_dir = tmp_path / "certs"
    env = {**os.environ, "CERTS_DIR": str(ca_dir)}
    assert _run(["bash", str(SCRIPTS / "gen-dev-certs.sh")], env=env).returncode == 0
    out = tmp_path / "trigger"
    r = _run(["bash", str(SCRIPTS / "mint-smoke-trigger-leaf.sh"), str(ca_dir), str(out)])
    assert r.returncode == 0, r.stderr
    assert sorted(p.name for p in out.iterdir()) == ["ca.pem", "cert.pem", "key.pem"]
    assert _san(out / "cert.pem") == ["xstockstrat-smoke-trigger"]
    v = _run(
        ["openssl", "verify", "-CAfile", str(ca_dir / "_ca" / "ca.pem"), str(out / "cert.pem")]
    )
    assert v.returncode == 0, v.stderr
    assert not (ca_dir / "xstockstrat-smoke-trigger").exists()


def _substitution_script():
    wf = yaml.safe_load((ROOT / ".github/workflows/deploy.yml").read_text())
    step = next(
        s
        for s in wf["jobs"]["deploy"]["steps"]
        if s.get("name") == "Substitute app spec placeholders"
    )
    return step["run"]


def _substitute(tmp_path, spec_rel, *, with_trigger=True, pat="ghp_throwaway_pat"):
    certs = tmp_path / "certs"
    env = {**os.environ, "CERTS_DIR": str(certs)}
    assert _run(["bash", str(SCRIPTS / "gen-dev-certs.sh")], env=env).returncode == 0
    trig = tmp_path / "trigger"
    if with_trigger:
        assert (
            _run(
                ["bash", str(SCRIPTS / "mint-smoke-trigger-leaf.sh"), str(certs), str(trig)]
            ).returncode
            == 0
        )
    out = tmp_path / "out.yaml"
    script = (
        _substitution_script()
        .replace("${{ github.repository_owner }}", "acme")
        .replace("${{ inputs.image_tag }}", "abc1234")
        .replace("${{ inputs.app_spec }}", str(ROOT / spec_rel))
        .replace("/tmp/app_spec_substituted.yaml", str(out))
    )
    run_env = {
        **os.environ,
        "BROKER_ACCOUNTS_ENCRYPTION_KEY": "b",
        "JWT_SECRET": "j",
        "CONFIG_SECRETS_ENCRYPTION_KEY": "c",
        "MTLS_CERTS_DIR": str(certs),
        "SMOKE_RESULTS_PAT": pat,
        "SMOKE_DB_PASSWORD": "dbpw-throwaway",
    }
    if with_trigger:
        run_env["SMOKE_TRIGGER_DIR"] = str(trig)
    r = _run(["bash", "-c", script], env=run_env)
    return r, out, certs, trig


def test_dev_spec_substitution_has_no_leftovers_and_trigger_is_not_clobbered(tmp_path):
    r, out, certs, trig = _substitute(tmp_path, ".do/app.dev.yaml")
    assert r.returncode == 0, r.stderr
    text = out.read_text()
    assert not re.findall(r"YOUR_(?:DEV|PROD)_\w+", text)
    spec = yaml.safe_load(text)
    job = next(j for j in spec["jobs"] if j["name"] == "smoke-record")
    svc = next(s for s in spec["services"] if s["name"] == "xstockstrat-smoke")
    job_env = {e["key"]: e["value"] for e in job["envs"]}
    svc_env = {e["key"]: e["value"] for e in svc["envs"]}
    assert job_env["MTLS_CERT"] == (trig / "cert.pem").read_text()
    assert job_env["MTLS_KEY"] == (trig / "key.pem").read_text()
    assert svc_env["MTLS_CERT"] == (certs / "xstockstrat-smoke" / "cert.pem").read_text()
    assert job_env["MTLS_CERT"] != svc_env["MTLS_CERT"]
    assert job_env["SMOKE_RESULTS_PAT"] == "ghp_throwaway_pat"
    assert "dbpw-throwaway" in svc_env["DATABASE_URL"]


def test_missing_trigger_leaf_fails_closed(tmp_path):
    r, out, *_ = _substitute(tmp_path, ".do/app.dev.yaml", with_trigger=False)
    assert r.returncode != 0
    assert "SMOKE_TRIGGER" in r.stderr


def test_prod_spec_substitution_needs_no_trigger_leaf(tmp_path):
    r, out, *_ = _substitute(tmp_path, ".do/app.yaml", with_trigger=False)
    assert r.returncode == 0, r.stderr
    assert not re.findall(r"YOUR_(?:DEV|PROD)_\w+", out.read_text())


def test_deploy_mints_trigger_leaf_only_when_the_spec_asks_for_it():
    wf = yaml.safe_load((ROOT / ".github/workflows/deploy.yml").read_text())
    step = next(
        s for s in wf["jobs"]["deploy"]["steps"] if "mint-smoke-trigger-leaf.sh" in s.get("run", "")
    )
    assert "SMOKE_TRIGGER" in step["run"] and "grep" in step["run"]
