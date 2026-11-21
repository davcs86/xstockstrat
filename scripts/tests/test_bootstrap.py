"""Tests for scripts/bootstrap.py with stub tools and the real sibling scripts; no Docker, no installs."""

import pytest
from conftest import load_script
from localenv_stubs import Sandbox

SCRIPT = "bootstrap.py"
mod = load_script(SCRIPT)

PREREQ_CALLS = [
    "docker --version",
    "docker info",
    "go version",
    "golangci-lint --version",
    "python3 --version",
    "node --version",
    "pnpm --version",
]


@pytest.fixture
def box(tmp_path):
    """A bootstrapped-looking checkout: .env, proto stubs, every service directory, all tools."""
    box = Sandbox(
        tmp_path, SCRIPT, "setup-env.py", "check-prereqs.py", "localenv-setup.py"
    )
    box.toolchain()
    box.services()
    (box.root / ".env").write_text("X=1\n")
    gen = box.root / "packages" / "proto" / "gen" / "python"
    gen.mkdir(parents=True)
    (gen / "setup.py").touch()
    (box.root / "services" / "xstockstrat-ingest" / "requirements.txt").touch()
    return box


@pytest.mark.parametrize(
    "output,expected",
    [
        ("v22.11.0\n", ("22.11.0", "22")),
        ("v20.9.1\n", ("20.9.1", "20")),
        ("22\n", ("22", "22")),
        ("vfoo.1\n", ("foo.1", "foo")),
        ("", ("", "")),
    ],
)
def test_node_version(output, expected):
    assert mod.node_version(output) == expected


def test_main_path_installs_host_dependencies(box):
    result = box.run(SCRIPT)
    assert result.returncode == 0 and result.stderr == ""
    assert "==> .env file exists — skipping setup.\n" in result.stdout
    assert (
        "    (To reconfigure: rm .env && python3 scripts/setup-env.py)\n"
        in result.stdout
    )
    assert "==> Node.js 22.11.0 ✓\n" in result.stdout
    assert "==> Proto stubs already present — skipping generation.\n" in result.stdout
    assert "  → packages/proto/gen/python (editable install)\n" in result.stdout
    assert result.stdout.endswith(
        " DB migration logs:  docker compose logs db-migrator --tail=50\n"
        "======================================================\n"
    )
    assert box.calls() == [
        *PREREQ_CALLS,
        "node -v",
        *["pnpm install --frozen-lockfile"] * 7,
        "python3 -m pip install -q -r requirements.txt",
        "python3 -m pip install -q -e .",
    ]
    assert (box.root / ".env").read_text() == "X=1\n"


def test_ci_skips_env_setup(box):
    (box.root / ".env").unlink()
    result = box.run(SCRIPT, env={"GITHUB_ACTIONS": "true"})
    assert result.returncode == 0
    assert "==> CI environment detected — skipping .env setup.\n" in result.stdout
    assert not (box.root / ".env").exists()


def test_missing_env_runs_setup_env_interactively(box):
    (box.root / ".env").unlink()
    result = box.run(SCRIPT, stdin="\n\n1\nhttp://e\nhdr\n")
    assert result.returncode == 0
    assert "==> .env file not found. Starting interactive setup...\n" in result.stdout
    assert "JWT_SECRET='" in (box.root / ".env").read_text()
    assert result.stdout.index(".env created successfully") < result.stdout.index(
        "==> Checking required tools..."
    )


def test_setup_env_failure_aborts(box):
    (box.root / ".env").unlink()
    result = box.run(SCRIPT)
    assert result.returncode == 1
    assert "Checking required tools" not in result.stdout
    assert box.calls() == []


def test_prereq_failure_aborts(box):
    (box.bin / "docker").unlink()
    result = box.run(SCRIPT)
    assert result.returncode == 1
    assert result.stdout.endswith(
        "ERROR: docker is required. Install it, start the daemon, then re-run.\n"
    )
    assert "pnpm install --frozen-lockfile" not in box.calls()


def test_wrong_node_major_aborts(box):
    box.stub("node", "v20.9.1")
    result = box.run(SCRIPT)
    assert result.returncode == 1
    assert "⚠️  Node.js version is 20.9.1 (expected 22.x)\n" in result.stdout
    assert result.stdout.endswith(
        "   2. Install Node 22 via Homebrew: brew install node@22\n\n"
    )
    assert box.calls()[-1] == "node -v"


def test_missing_optional_tools_are_skipped(box):
    for name in ("node", "pnpm", "python3"):
        (box.bin / name).unlink()
    result = box.run(SCRIPT)
    assert result.returncode == 0
    assert "==> Node.js not found — skipping version check.\n" in result.stdout
    assert "==> pnpm not found — skipping Node.js dep install.\n" in result.stdout
    assert "==> python3 not found — skipping Python dep install.\n" in result.stdout
    assert box.calls() == [*PREREQ_CALLS[:4]]


def test_missing_proto_stubs_run_localenv_setup(box):
    (box.root / "packages" / "proto" / "gen" / "python" / "setup.py").unlink()
    (box.root / "packages" / "proto" / "gen" / "python").rmdir()
    box.repo_script("gen-dev-certs.sh")
    result = box.run(SCRIPT, env={"CODEGEN_PROXY_CA": "none"})
    assert result.returncode == 0
    assert (
        "==> Proto stubs missing — running localenv-setup.py (Docker required)...\n"
        in result.stdout
    )
    calls = box.calls()
    assert "gen-dev-certs.sh " in calls
    assert any(call.startswith("docker build ") for call in calls)


def test_localenv_setup_failure_aborts(box):
    (box.root / "packages" / "proto" / "gen" / "python" / "setup.py").unlink()
    (box.root / "packages" / "proto" / "gen" / "python").rmdir()
    box.docker(build=9)
    result = box.run(SCRIPT, env={"CODEGEN_PROXY_CA": "none"})
    assert result.returncode == 9
    assert "pnpm install --frozen-lockfile" not in box.calls()


def test_pnpm_failure_propagates(box):
    box.stub("pnpm", "9.15.9", rc=7, fail_on="install")
    result = box.run(SCRIPT)
    assert result.returncode == 7
    assert result.stdout.endswith("  → xstockstrat-ledger\n9.15.9\n")
    assert box.calls().count("pnpm install --frozen-lockfile") == 1


def test_pip_failure_propagates(box):
    box.stub("python3", "Python 3.12.4", rc=5, fail_on="pip")
    result = box.run(SCRIPT)
    assert result.returncode == 5
    assert "Bootstrap complete!" not in result.stdout


def test_missing_service_directory_aborts(box):
    (box.root / "services" / "xstockstrat-trader").rmdir()
    result = box.run(SCRIPT)
    assert result.returncode == 1
    assert result.stderr == (
        f"cd: {box.root}/services/xstockstrat-trader: No such file or directory\n"
    )
    assert box.calls().count("pnpm install --frozen-lockfile") == 4
