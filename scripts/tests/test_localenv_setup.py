"""Tests for scripts/localenv-setup.py with a stub docker and gen-dev-certs.sh; builds and pulls nothing."""

import pytest
from localenv_stubs import Sandbox

SCRIPT = "localenv-setup.py"
NO_CA = {"CODEGEN_PROXY_CA": "none"}


@pytest.fixture
def box(tmp_path):
    box = Sandbox(tmp_path, SCRIPT)
    box.docker()
    box.repo_script("gen-dev-certs.sh")
    return box


def build_call(box, *extra):
    return (
        f"docker build {' '.join(extra)}{' ' if extra else ''}--platform linux/amd64"
        f" -t xstockstrat-codegen -f {box.root}/Dockerfile.codegen {box.root}"
    )


def test_main_path_builds_generates_and_issues_certs(box):
    result = box.run(SCRIPT, env=NO_CA)
    assert result.returncode == 0 and result.stderr == ""
    assert box.calls() == [
        "docker info",
        build_call(box),
        "BUILDKIT=1",
        (
            f"docker run --rm --platform linux/amd64 -v {box.root}:/workspace -w /workspace"
            " xstockstrat-codegen ./scripts/buf-gen.sh"
        ),
        "gen-dev-certs.sh ",
    ]
    out = result.stdout
    assert out.startswith(
        "\n\033[1m\033[0;36m===> Building proto-gen container (xstockstrat-codegen)\033[0m\n"
        "\033[0;36m[INFO]\033[0m  This may take a few minutes on first run.\n"
        "building\n"
        "\033[0;32m[OK]\033[0m    Image built: xstockstrat-codegen\n"
    )
    assert out.index("running") < out.index("Stubs written to:")
    assert (
        "\n\033[1mDone. You can now run:\033[0m\n  python3 scripts/bootstrap.py\n"
        in out
    )
    assert out.endswith("  4. Prepare the database\n")


def test_no_cache_and_proxy_ca_are_passed_to_the_build(box):
    ca = box.root / "ca.crt"
    ca.touch()
    result = box.run(SCRIPT, "--no-cache", env={"CODEGEN_PROXY_CA": str(ca)})
    assert result.returncode == 0
    assert f"Trusting egress-proxy CA in the build: {ca}\n" in result.stdout
    assert box.calls()[1] == build_call(
        box, "--no-cache", "--secret", f"id=proxy_ca,src={ca}"
    )


def test_absent_proxy_ca_file_is_ignored(box):
    box.run(SCRIPT, env={"CODEGEN_PROXY_CA": str(box.root / "nope.crt")})
    assert box.calls()[1] == build_call(box)


def test_unknown_argument(box):
    result = box.run(SCRIPT, "--no-cache", "--x", env=NO_CA)
    assert result.returncode == 1
    assert result.stderr == "\033[0;31m[ERROR]\033[0m Unknown argument: --x\n"
    assert box.calls() == ["docker info"]


def test_docker_missing(box):
    (box.bin / "docker").unlink()
    result = box.run(SCRIPT, env=NO_CA)
    assert result.returncode == 1 and result.stdout == ""
    assert result.stderr == (
        "\033[0;31m[ERROR]\033[0m Docker not found. Install Docker Desktop:"
        " https://www.docker.com/products/docker-desktop/\n"
    )


def test_docker_daemon_down(box):
    box.docker(info=1)
    result = box.run(SCRIPT, env=NO_CA)
    assert result.returncode == 1
    assert result.stderr == (
        "\033[0;31m[ERROR]\033[0m Docker daemon is not running. Start Docker Desktop and try again.\n"
    )
    assert box.calls() == ["docker info"]


def test_build_failure_propagates(box):
    box.docker(build=5)
    result = box.run(SCRIPT, env=NO_CA)
    assert result.returncode == 5
    assert "Image built" not in result.stdout
    assert not any(call.startswith("docker run") for call in box.calls())


def test_codegen_failure_propagates(box):
    box.docker(run=6)
    result = box.run(SCRIPT, env=NO_CA)
    assert result.returncode == 6
    assert "gen-dev-certs.sh " not in box.calls()


def test_cert_generation_failure_propagates(box):
    box.repo_script("gen-dev-certs.sh", rc=4)
    result = box.run(SCRIPT, env=NO_CA)
    assert result.returncode == 4
    assert "Done. You can now run:" not in result.stdout
