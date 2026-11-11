"""Stub executables for script tests: each logs its argv to a file, then runs a scripted `sh` body."""

import subprocess
import sys

from conftest import SCRIPTS_DIR


class Stubs:
    """A PATH holding only the stubs added here, so a tool that was not added is a missing tool."""

    def __init__(self, tmp_path):
        self.bin = tmp_path / "bin"
        self.bin.mkdir()
        self.log = tmp_path / "calls.log"

    def add(self, name, body=""):
        """Bodies may use `sh` builtins only: no other tool is on PATH."""
        stub = self.bin / name
        stub.write_text(f'#!/bin/sh\necho "{name} $*" >>"$STUB_LOG"\n{body}\n')
        stub.chmod(0o755)

    def calls(self):
        return self.log.read_text().splitlines() if self.log.exists() else []

    def run(self, script, *args, env=None):
        """Run scripts/<script> as a child; returns the CompletedProcess with text stdout/stderr."""
        return subprocess.run(
            [sys.executable, str(SCRIPTS_DIR / script), *args],
            env={"PATH": str(self.bin), "STUB_LOG": str(self.log), **(env or {})},
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            stdin=subprocess.DEVNULL,
        )
