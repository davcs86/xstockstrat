"""Tests for scripts/run-e2e.py with a stub docker; builds and runs no container."""

import re

import pytest
from localenv_stubs import Sandbox

SCRIPT = "run-e2e.py"
NO_CA = {"E2E_PROXY_CA": "none"}
REPORT = "services/xstockstrat-ui/playwright-report"


@pytest.fixture
def box(tmp_path):
    box = Sandbox(tmp_path, SCRIPT)
    box.docker()
    (box.root / "services" / "xstockstrat-ui").mkdir(parents=True)
    return box


def normalised(calls):
    return [re.sub(r"e2e-run-\d+", "e2e-run-PID", call) for call in calls]


def test_main_path_runs_extracts_the_report_and_removes_the_container(box):
    stale = box.root / REPORT / "old.html"
    stale.parent.mkdir()
    stale.touch()
    result = box.run(SCRIPT, env=NO_CA)
    assert result.returncode == 0 and result.stderr == ""
    assert normalised(box.calls()) == [
        "docker info",
        f"docker build -t xstockstrat-e2e -f {box.root}/Dockerfile.e2e {box.root}",
        "BUILDKIT=1",
        "docker run --name xstockstrat-e2e-run-PID xstockstrat-e2e",
        f"docker cp xstockstrat-e2e-run-PID:/workspace/{REPORT} {box.root}/{REPORT}",
        "docker rm xstockstrat-e2e-run-PID",
    ]
    assert not stale.exists() and (box.root / REPORT).is_dir()
    assert f"Report extracted to: {REPORT}/\n" in result.stdout
    assert result.stdout.endswith("\n\033[0;32m[OK]\033[0m    All E2E tests passed.\n")


def test_flags_are_split_between_the_build_and_playwright(box):
    ca = box.root / "ca.crt"
    ca.touch()
    result = box.run(
        SCRIPT,
        "--no-cache",
        "--shard=1/2",
        "--no-report",
        "--grep",
        "auth",
        env={"E2E_PROXY_CA": str(ca)},
    )
    assert result.returncode == 0
    calls = normalised(box.calls())
    assert calls[1] == (
        f"docker build --no-cache --secret id=proxy_ca,src={ca}"
        f" -t xstockstrat-e2e -f {box.root}/Dockerfile.e2e {box.root}"
    )
    assert calls[3:] == [
        "docker run --name xstockstrat-e2e-run-PID xstockstrat-e2e --shard=1/2 --grep auth",
        "docker rm xstockstrat-e2e-run-PID",
    ]
    assert "Extracting Playwright report" not in result.stdout


def test_test_failure_still_extracts_and_returns_its_status(box):
    box.docker(run=3)
    result = box.run(SCRIPT, env=NO_CA)
    assert result.returncode == 3
    assert result.stderr == "\033[0;31m[ERROR]\033[0m E2E tests failed (exit code 3).\n"
    assert (box.root / REPORT).is_dir()
    assert normalised(box.calls())[-1] == "docker rm xstockstrat-e2e-run-PID"


def test_missing_report_is_tolerated(box):
    stale = box.root / REPORT / "old.html"
    stale.parent.mkdir()
    stale.touch()
    box.docker(cp=1)
    result = box.run(SCRIPT, env=NO_CA)
    assert result.returncode == 0
    assert (
        "No report directory found in container (tests may not have produced one).\n"
        in result.stdout
    )
    assert "Report extracted to" not in result.stdout
    assert not (box.root / REPORT).exists()


def test_build_failure_propagates(box):
    box.docker(build=5)
    result = box.run(SCRIPT, env=NO_CA)
    assert result.returncode == 5
    assert not any(call.startswith("docker run") for call in box.calls())


def test_docker_missing(box):
    (box.bin / "docker").unlink()
    result = box.run(SCRIPT, env=NO_CA)
    assert result.returncode == 1 and result.stdout == ""
    assert "Docker not found." in result.stderr


def test_docker_daemon_down(box):
    box.docker(info=1)
    result = box.run(SCRIPT, env=NO_CA)
    assert result.returncode == 1
    assert "Docker daemon is not running." in result.stderr
    assert box.calls() == ["docker info"]
