"""A throwaway repo layout plus stub executables for the local-environment script tests: no Docker, no network."""

import shutil
import subprocess
import sys

from conftest import SCRIPTS_DIR

SERVICES = [
    "ledger",
    "identity",
    "notify",
    "config",
    "trader",
    "insights",
    "config-ui",
    "indicators",
    "ingest",
    "analysis",
]


class Sandbox:
    """Copies `scripts` into <tmp>/repo/scripts and runs them with PATH holding only the stubs."""

    def __init__(self, tmp_path, *scripts):
        self.root = tmp_path / "repo"
        self.bin = tmp_path / "bin"
        self.log = tmp_path / "calls.log"
        (self.root / "scripts").mkdir(parents=True)
        self.bin.mkdir()
        for name in scripts:
            shutil.copy(SCRIPTS_DIR / name, self.root / "scripts" / name)

    def _write(self, path, body):
        path.write_text(f'#!/bin/sh\necho "{path.name} $*" >>"{self.log}"\n{body}\n')
        path.chmod(0o755)

    def stub(self, name, out="", rc=0, fail_on=""):
        """`rc` applies to every call, or only to calls whose arguments contain `fail_on`."""
        self._write(
            self.bin / name,
            f"echo '{out}'\ncase \"$*\" in *'{fail_on}'*) exit {rc};; esac",
        )

    def docker(self, info=0, build=0, run=0, cp=0):
        """`docker cp` creates its destination on success; build logs DOCKER_BUILDKIT."""
        self._write(
            self.bin / "docker",
            'case "$1" in\n'
            "  --version) echo 'Docker version 27.3.1, build ce12230';;\n"
            f"  info) exit {info};;\n"
            f'  build) echo "BUILDKIT=$DOCKER_BUILDKIT" >>"{self.log}"; echo building; exit {build};;\n'
            f"  run) echo running; exit {run};;\n"
            f'  cp) [ {cp} = 0 ] || exit {cp}; /bin/mkdir -p "$3";;\n'
            "esac",
        )

    def toolchain(self, **overrides):
        """Stubs for every tool check-prereqs probes; `name=None` leaves that tool off PATH."""
        tools = {
            "docker": "",
            "go": "go version go1.25.3 darwin/arm64",
            "golangci-lint": "golangci-lint has version 2.5.0 built with go1.25",
            "python3": "Python 3.12.4",
            "node": "v22.11.0",
            "pnpm": "9.15.9",
        } | {name.replace("_", "-"): out for name, out in overrides.items()}
        for name, out in tools.items():
            if out is None:
                continue
            if name == "docker":
                self.docker()
            else:
                self.stub(name, out)

    def repo_script(self, name, rc=0):
        self._write(self.root / "scripts" / name, f"exit {rc}")

    def services(self, names=SERVICES):
        for name in names:
            (self.root / "services" / f"xstockstrat-{name}").mkdir(parents=True)

    def run(self, script, *args, env=None, stdin=""):
        return subprocess.run(
            [sys.executable, str(self.root / "scripts" / script), *args],
            env={"PATH": str(self.bin), "HOME": str(self.root)} | (env or {}),
            check=False,
            input=stdin,
            capture_output=True,
            text=True,
            cwd=self.root,
            umask=0o022,
        )

    def calls(self):
        return self.log.read_text().splitlines() if self.log.exists() else []
