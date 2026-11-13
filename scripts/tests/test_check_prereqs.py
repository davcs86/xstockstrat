"""Tests for scripts/check-prereqs.py against stub tools on PATH; no Docker."""

import pytest
from conftest import load_script
from localenv_stubs import Sandbox

SCRIPT = "check-prereqs.py"
mod = load_script(SCRIPT)


@pytest.fixture
def box(tmp_path):
    return Sandbox(tmp_path, SCRIPT)


@pytest.mark.parametrize(
    "version,expected", [("1.25", "1"), ("22", "22"), ("9.15.0", "9")]
)
def test_major(version, expected):
    assert mod.major(version) == expected


@pytest.mark.parametrize(
    "output,expected",
    [
        ("go version go1.25.3 darwin/arm64", "1.25.3"),
        ("Docker version 27.3.1, build ce12230", "27.3.1"),
        ("v22.11.0", "22.11.0"),
        ("10.2", "10.2"),
        ("line without\nversion 3.13.1 below", "3.13.1"),
        ("v22", None),
        ("", None),
    ],
)
def test_first_version(output, expected):
    assert mod.first_version(output) == expected


def test_all_tools_present(box):
    box.toolchain()
    result = box.run(SCRIPT)
    assert result.returncode == 0 and result.stderr == ""
    assert result.stdout == (
        "Checking required tools...\n\n"
        "  ✓ docker  27.3.1  (daemon running)\n\n"
        "Checking language toolchains (needed for local tests and linters)...\n\n"
        "  ✓ go  1.25.3  (required: 1.25)\n"
        "  ✓ golangci-lint  2.5.0  (required: 2.5.0)\n"
        "  ✓ python3  3.12.4  (required: 3.12)\n"
        "  ✓ node  22.11.0  (required: 22)\n"
        "  ✓ pnpm  9.15.9  (required: 9.15.0)\n\n"
        "All required tools present.\n"
    )
    assert box.calls() == [
        "docker --version",
        "docker info",
        "go version",
        "golangci-lint --version",
        "python3 --version",
        "node --version",
        "pnpm --version",
    ]


def test_quiet_prints_nothing(box):
    box.toolchain()
    result = box.run(SCRIPT, "--quiet")
    assert (result.returncode, result.stdout, result.stderr) == (0, "", "")


def test_unknown_argument(box):
    box.toolchain()
    result = box.run(SCRIPT, "--quiet", "--bogus")
    assert result.returncode == 1
    assert (result.stdout, result.stderr) == ("", "Unknown argument: --bogus\n")
    assert box.calls() == []


def test_docker_missing_is_fatal(box):
    box.toolchain(docker=None)
    result = box.run(SCRIPT)
    assert result.returncode == 1
    assert "  ✗ docker not found  →  brew install --cask docker\n" in result.stdout
    assert result.stdout.endswith(
        "ERROR: docker is required. Install it, start the daemon, then re-run.\n"
    )
    assert "All required tools present." not in result.stdout


def test_docker_daemon_down_is_fatal(box):
    box.toolchain()
    box.docker(info=1)
    result = box.run(SCRIPT)
    assert result.returncode == 1
    assert (
        "  ✗ docker  27.3.1  (daemon not running — start Docker Desktop)\n"
        in result.stdout
    )


def test_missing_and_mismatched_toolchains_only_warn(box):
    box.toolchain(go=None, golangci_lint=None, python3=None, node="v20.1.0")
    result = box.run(SCRIPT)
    assert result.returncode == 0
    assert "  ⚠ go not found  →  brew install go\n" in result.stdout
    assert (
        "  ⚠ golangci-lint not found  →  brew install golangci-lint\n" in result.stdout
    )
    assert "  ⚠ python3 not found  →  brew install python@3.12\n" in result.stdout
    assert "  ⚠ node  20.1.0  (required: 22)  — version mismatch\n" in result.stdout
    assert result.stdout.endswith(
        "WARNING: some language toolchains are missing or mismatched.\n"
        "         Local test and lint runs for those languages will not work.\n"
        "         Services run in Docker and are unaffected.\n"
        "All required tools present.\n"
    )


def test_version_command_without_a_version_aborts(box):
    box.toolchain(go="garbage")
    result = box.run(SCRIPT)
    assert result.returncode == 1
    assert result.stdout.endswith("linters)...\n\n")
    assert box.calls()[-1] == "go version"


def test_only_the_first_output_line_is_parsed_for_toolchains(box):
    box.toolchain(pnpm="warning\n9.15.9")
    assert box.run(SCRIPT).returncode == 1


def test_failing_version_command_propagates_its_status(box):
    box.toolchain()
    box.stub("node", "v22.11.0", rc=3)
    result = box.run(SCRIPT)
    assert result.returncode == 3
    assert "node" not in result.stdout
