"""Unit tests for scripts/do-render-app-spec.py; sops-secrets.test.sh covers the real sops/openssl path."""

import argparse
import os
import stat

import pytest
from conftest import load_script

import sops_secrets

dr = load_script("do-render-app-spec.py")

VPC = "0123abcd-0123-0123-0123-0123456789ab"
SPEC = """name: demo-app
vpc:
  id: YOUR_VPC_ID
image: ghcr.io/YOUR_GITHUB_ORG/svc:YOUR_IMAGE_TAG
jwt: YOUR_DEV_JWT_SECRET
headers: YOUR_DEV_OTEL_EXPORTER_OTLP_HEADERS
ca: YOUR_DEV_MTLS_CA_CERT
"""


def args_for(tmp_path, spec=SPEC, **over):
    spec_path = tmp_path / "app.yaml"
    spec_path.write_text(spec)
    base = {
        "env": "staging",
        "spec": str(spec_path),
        "app_name": "demo-app",
        "image_tag": "sha-1",
        "org": "acme",
        "vpc_id": VPC,
        "out": str(tmp_path / "out.yaml"),
    }
    return argparse.Namespace(**{**base, **over})


@pytest.fixture
def stubbed(monkeypatch):
    values = {
        "JWT_SECRET": "jwt-value",
        "OTEL_EXPORTER_OTLP_HEADERS": "Basic abc",
        "MTLS_CA": "bundle",
    }
    monkeypatch.setattr(sops_secrets, "resolve", lambda env, target: (dict(values), {}))
    monkeypatch.setattr(dr, "mint", lambda ca: {"MTLS_CA_CERT": "PEM\nLINE\n"})
    monkeypatch.delenv("GITHUB_OUTPUT", raising=False)
    return values


def test_yaml_pem_escapes_backslash_quote_and_newline():
    assert dr.yaml_pem('a\\b"c\nd') == '"a\\\\b\\"c\\nd"'


def test_spec_name_reads_top_level_name_only():
    assert dr.spec_name("x: 1\nname: demo-app\n") == "demo-app"
    assert dr.spec_name("services:\n  - name: nested\n") is None


def test_render_fills_placeholders_and_writes_0600(tmp_path, stubbed):
    args = args_for(tmp_path)
    dr.render(args)
    out = (tmp_path / "out.yaml").read_text()
    assert "ghcr.io/acme/svc:sha-1" in out
    assert f"id: {VPC}" in out
    assert "jwt: jwt-value" in out
    assert "headers: Authorization=Basic abc" in out
    assert 'ca: "PEM\\nLINE\\n"' in out
    assert "YOUR_" not in out
    assert stat.S_IMODE(os.stat(args.out).st_mode) == 0o600


def test_render_keeps_an_already_prefixed_otel_header(tmp_path, stubbed, monkeypatch):
    values = {**stubbed, "OTEL_EXPORTER_OTLP_HEADERS": "Authorization=Basic abc"}
    monkeypatch.setattr(sops_secrets, "resolve", lambda env, target: (values, {}))
    dr.render(args_for(tmp_path))
    assert "headers: Authorization=Basic abc\n" in (tmp_path / "out.yaml").read_text()


def test_render_writes_github_output(tmp_path, stubbed, monkeypatch):
    gh_out = tmp_path / "gh_output"
    monkeypatch.setenv("GITHUB_OUTPUT", str(gh_out))
    monkeypatch.setattr(
        sops_secrets,
        "resolve",
        lambda env, target: ({**stubbed, "PROJECT_ID": "p-1"}, {}),
    )
    dr.render(args_for(tmp_path))
    assert gh_out.read_text() == "app_name=demo-app\nproject_id=p-1\n"


@pytest.mark.parametrize(
    ("over", "spec", "message"),
    [
        ({"app_name": "other"}, SPEC, "top-level name is 'demo-app'"),
        ({"vpc_id": "NOT-A-UUID"}, SPEC, "not a lowercase VPC UUID"),
        ({}, SPEC + "again: YOUR_VPC_ID\n", "must occur exactly once (found 2)"),
        ({}, SPEC + "extra: YOUR_DEV_NOT_A_KEY\n", "unfilled placeholders remain"),
    ],
)
def test_render_rejects_bad_input_without_writing(
    tmp_path, stubbed, over, spec, message
):
    args = args_for(tmp_path, spec=spec, **over)
    with pytest.raises(sops_secrets.SecretError) as exc:
        dr.render(args)
    assert message in str(exc.value)
    assert not os.path.exists(args.out)


def test_main_reports_secret_error_and_exits_1(tmp_path, stubbed, capsys):
    args = args_for(tmp_path, app_name="other")
    argv = [
        "--env", args.env, "--spec", args.spec, "--app-name", args.app_name, "--image-tag", args.image_tag,
        "--org", args.org, "--vpc-id", args.vpc_id, "--out", args.out,
    ]  # fmt: skip
    with pytest.raises(SystemExit) as exc:
        dr.main(argv)
    assert exc.value.code == 1
    assert "::error::" in capsys.readouterr().out
