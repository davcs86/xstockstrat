"""A throwaway database beside $DATABASE_URL, for config-wiring-stored.py and config-heal-dryrun.py.

Needs psql and migrate on PATH. Every line a tool prints is passed through redact(), so no URL is shown.
"""

import os
import re
import shutil
import subprocess
import sys
import tempfile

URL = re.compile(r"postgres(ql)?://\S*")
MIGRATIONS_TABLE = "x-migrations-table=config_schema_migrations"
SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRIPTS_DIR)
CONFIG_MIGRATIONS = "services/xstockstrat-config/migrations"


def redact(text):
    return URL.sub("<url>", text)


def scratch_urls(database_url, name):
    """(psql URL, migrate URL) of database `name` on the server database_url points at."""
    base, _, query = database_url.partition("?")
    url = f"{base.rsplit('/', 1)[0]}/{name}"
    if query:
        return f"{url}?{query}", f"{url}?{query}&{MIGRATIONS_TABLE}"
    return url, f"{url}?{MIGRATIONS_TABLE}"


def run(cmd, stdin=None, capture=False):
    """Run cmd; print its redacted output, or with capture return stdout. Exits with cmd's status on failure."""
    done = subprocess.run(
        cmd,
        stdin=stdin,
        stdout=subprocess.PIPE,
        stderr=None if capture else subprocess.STDOUT,
        check=False,
    )
    if not capture:
        sys.stdout.write(redact(done.stdout.decode("utf-8", errors="replace")))
        sys.stdout.flush()
    if done.returncode:
        sys.exit(done.returncode)
    return done.stdout


class ScratchDb:
    def __init__(self, prefix):
        self.database_url = os.environ.get("DATABASE_URL")
        if not self.database_url:
            sys.exit("DATABASE_URL is required")
        self.name = f"{prefix}_{os.getpid()}"
        self.url, self.migrate_url = scratch_urls(self.database_url, self.name)
        self.work = None

    def __enter__(self):
        self.work = tempfile.mkdtemp()
        self.migrations = os.path.join(self.work, "mig")
        run(
            [
                "psql",
                self.database_url,
                "-q",
                "-v",
                "ON_ERROR_STOP=1",
                "-c",
                f"CREATE DATABASE {self.name};",
            ]
        )
        render = os.path.join(SCRIPTS_DIR, "render-migrations.sh")
        run([render, os.path.join(REPO_ROOT, CONFIG_MIGRATIONS), self.migrations])
        return self

    def __exit__(self, *exc):
        subprocess.run(
            [
                "psql",
                self.database_url,
                "-q",
                "-c",
                f"DROP DATABASE IF EXISTS {self.name};",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        shutil.rmtree(self.work, ignore_errors=True)

    def psql(self, *args, script=None, stdin=None):
        """psql against the scratch database; `script` is SQL text fed on stdin."""
        cmd = ["psql", self.url, "-q", "-v", "ON_ERROR_STOP=1", *args]
        if script is None:
            return run(cmd, stdin=stdin)
        with tempfile.TemporaryFile() as f:
            f.write(script.encode())
            f.seek(0)
            return run(cmd, stdin=f)

    def query(self, sql, *args):
        """Unaligned, tuples-only stdout of a SQL script, as bytes."""
        with tempfile.TemporaryFile() as f:
            f.write(sql.encode())
            f.seek(0)
            return run(
                ["psql", self.url, "-q", "-At", "-v", "ON_ERROR_STOP=1", *args],
                stdin=f,
                capture=True,
            )

    def migrate(self, *args):
        run(["migrate", "-path", self.migrations, "-database", self.migrate_url, *args])
