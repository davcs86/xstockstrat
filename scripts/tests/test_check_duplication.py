"""Tests for scripts/check-duplication.py with stub pnpm/npx executables; jscpd never runs."""

import pytest
from conftest import SCRIPTS_DIR
from stub_tools import Stubs

SCRIPT = "check-duplication.py"
CONFIG = f"--config {SCRIPTS_DIR.parent / '.jscpd.json'}"
PROBE = "pnpm exec jscpd --version"
# A pnpm whose workspace has jscpd: the --version probe succeeds, the scan exits $SCAN_STATUS.
PNPM = '[ "$3" = --version ] && exit 0\necho "jscpd report"\nexit "${SCAN_STATUS:-0}"'
FAILED = (
    "FAILED - duplication above threshold. Extract the repeated code into a shared module,\n"
    "         or run with DUP_REPORT_ONLY=1 to treat it as advisory.\n"
)


@pytest.fixture
def stubs(tmp_path):
    return Stubs(tmp_path)


def test_default_scope_is_enforced_through_the_workspace_binary(stubs):
    stubs.add("pnpm", PNPM)
    stubs.add("npx")
    proc = stubs.run(SCRIPT)
    assert proc.returncode == 0
    assert proc.stdout == (
        "Scanning for code duplication (jscpd) in: services packages\n"
        "jscpd report\n"
        "OK - no duplication above threshold.\n"
    )
    assert stubs.calls() == [
        PROBE,
        f"pnpm exec jscpd {CONFIG} --threshold 0 services packages",
    ]


def test_clones_fail_with_the_jscpd_status(stubs):
    stubs.add("pnpm", PNPM)
    proc = stubs.run(SCRIPT, "services/a", "packages/b", env={"SCAN_STATUS": "3"})
    assert proc.returncode == 3
    assert proc.stdout == (
        "Scanning for code duplication (jscpd) in: services/a packages/b\n"
        "jscpd report\n" + FAILED
    )
    assert stubs.calls()[1] == (
        f"pnpm exec jscpd {CONFIG} --threshold 0 services/a packages/b"
    )


def test_report_only_drops_the_threshold_and_never_blocks(stubs):
    stubs.add("pnpm", PNPM)
    proc = stubs.run(
        SCRIPT, "services", env={"DUP_REPORT_ONLY": "1", "SCAN_STATUS": "3"}
    )
    assert proc.returncode == 0
    assert proc.stdout.endswith(
        "Report-only mode (non-blocking) — review the jscpd report above for any duplication.\n"
    )
    assert stubs.calls()[1] == f"pnpm exec jscpd {CONFIG} services"


@pytest.mark.parametrize("value", ["", "0", "true"])
def test_only_the_value_1_selects_report_only(stubs, value):
    stubs.add("pnpm", PNPM)
    proc = stubs.run(SCRIPT, env={"DUP_REPORT_ONLY": value, "SCAN_STATUS": "1"})
    assert proc.returncode == 1
    assert "--threshold 0" in stubs.calls()[1]


@pytest.mark.parametrize("pnpm", [None, "exit 1"])
def test_falls_back_to_npx_when_pnpm_has_no_jscpd(stubs, pnpm):
    if pnpm is not None:
        stubs.add("pnpm", pnpm)
    stubs.add("npx", "echo boom >&2\nexit 2")
    proc = stubs.run(SCRIPT, "x")
    assert proc.returncode == 2
    assert proc.stderr == "boom\n"
    assert proc.stdout.endswith(FAILED)
    assert stubs.calls()[-1] == f"npx --yes jscpd {CONFIG} --threshold 0 x"


def test_no_runner_at_all_is_command_not_found(stubs):
    proc = stubs.run(SCRIPT)
    assert proc.returncode == 127
    assert proc.stderr.endswith("check-duplication.py: npx: command not found\n")
    assert proc.stdout.endswith(FAILED)
