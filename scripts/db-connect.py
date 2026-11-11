#!/usr/bin/env python3
"""Whitelist your current IP on a DigitalOcean managed database cluster, open psql, then remove the rule.

Usage: db-connect.py [-c CLUSTER_ID] [-d DB_NAME] [-i IP] [-- <extra psql args>]   (-h prints the full help)
Environment defaults: DB_CLUSTER_ID, DB_NAME, DB_IP. Requires doctl (authenticated), psql and curl.

Exit status is psql's. Before psql starts: 1 for a bad option, a missing tool, an undetectable IP or
unreadable connection details, else the status of the failing doctl call. A failing cleanup lookup
replaces any of these with its own status and leaves the rule in place.
"""

import os
import re
import shutil
import signal
import subprocess
import sys

DEFAULT_CLUSTER_ID = "1b5ad082-8145-4e09-bdcf-936adfc21f2a"  # xstockstrat cluster

HELP = """\
#
# db-connect.py — temporarily whitelist your current IP on a DigitalOcean managed
# database cluster, open a psql session, then remove the firewall rule on exit.
#
# The DO managed DB only trusts the App Platform apps by default, so a laptop has to
# add its IP to "Trusted Sources" to connect. This script does that append/connect/
# cleanup cycle for you and never leaves a stray rule behind.
#
# Requirements: doctl (authenticated: `doctl auth init`), psql, curl.
#
# Usage:
#   ./db-connect.py [-c CLUSTER_ID] [-d DB_NAME] [-i IP] [-- <extra psql args>]
#
# Examples:
#   ./db-connect.py                                  # interactive psql, defaults below
#   ./db-connect.py -d xstockstrat-staging
#   ./db-connect.py -d xstockstrat-staging -- -c "select now();"
#
# Defaults can also come from the environment: DB_CLUSTER_ID, DB_NAME, DB_IP."""

VALUE_OPTIONS = {
    "-c": "cluster",
    "--cluster": "cluster",
    "-d": "db",
    "--db": "db",
    "-i": "ip",
    "--ip": "ip",
}


def parse_args(argv, env):
    """Options as a dict (cluster, db, ip, psql_args); exits 0 on --help and 1 on a bad option."""
    opts = {
        "cluster": env.get("DB_CLUSTER_ID") or DEFAULT_CLUSTER_ID,
        "db": env.get("DB_NAME") or "defaultdb",
        "ip": env.get("DB_IP") or "",
        "psql_args": [],
    }
    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg in VALUE_OPTIONS:
            if i + 1 >= len(argv):
                print(f"{sys.argv[0]}: $2: unbound variable", file=sys.stderr)
                sys.exit(1)
            opts[VALUE_OPTIONS[arg]] = argv[i + 1]
            i += 2
        elif arg == "--":
            opts["psql_args"] = argv[i + 1 :]
            break
        elif arg in ("-h", "--help"):
            print(HELP)
            sys.exit(0)
        else:
            print(f"unknown option: {arg}", file=sys.stderr)
            sys.exit(1)
    return opts


def exit_status(code):
    return code if code >= 0 else 128 - code


def rule_uuid(listing, ip):
    """UUID of the first `ip_addr` rule for ip in `doctl databases firewalls list` output, or ""."""
    for line in listing.split("\n"):
        fields = line.split()
        if len(fields) >= 3 and fields[1] == "ip_addr" and fields[2] == ip:
            return fields[0]
    return ""


def connection_fields(output):
    """[host, port, user, password] from the first line; None unless that line is newline-terminated."""
    line, newline, _ = output.partition("\n")
    if not newline:
        return None
    fields = re.split(r"[ \t]+", line.strip(" \t"), maxsplit=3)
    return fields + [""] * (4 - len(fields))


class Session:
    """The append/connect/cleanup cycle; cleanup removes only the rule this session added."""

    def __init__(self, cluster, ip):
        self.cluster, self.ip = cluster, ip
        self.rule_added = False
        self.trapped = False

    def trap(self, signum, frame):
        # A Python handler, not SIG_IGN: children keep the default disposition, so Ctrl-C still reaches psql.
        self.trapped = True

    def run(self, cmd, **kwargs):
        """Run to completion; a signal trapped meanwhile runs cleanup afterwards, as the bash trap did."""
        proc = subprocess.run(cmd, check=False, **kwargs)
        if self.trapped:
            self.trapped = False
            self.cleanup()
        return proc

    def check(self, cmd, **kwargs):
        code = self.run(cmd, **kwargs).returncode
        if code != 0:
            sys.exit(exit_status(code))

    def cleanup(self):
        if not self.rule_added:
            return
        listing = subprocess.run(
            [
                "doctl",
                "databases",
                "firewalls",
                "list",
                self.cluster,
                "--format",
                "UUID,Type,Value",
                "--no-header",
            ],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )
        if listing.returncode != 0:
            sys.exit(exit_status(listing.returncode))
        uuid = rule_uuid(listing.stdout.decode(errors="replace"), self.ip)
        if not uuid:
            return
        print(f"Removing firewall rule for {self.ip} ({uuid})...", flush=True)
        removed = subprocess.run(
            ["doctl", "databases", "firewalls", "remove", self.cluster, "--uuid", uuid],
            check=False,
            stdout=subprocess.DEVNULL,
        )
        if removed.returncode == 0:
            print("Firewall rule removed.", flush=True)
        else:
            print(
                f"WARNING: failed to remove rule {uuid} — remove it manually in the DO dashboard.",
                file=sys.stderr,
            )

    def connect(self, db, psql_args):
        print(
            f"Appending firewall rule ip_addr:{self.ip} to cluster {self.cluster}...",
            flush=True,
        )
        self.check(
            [
                "doctl",
                "databases",
                "firewalls",
                "append",
                self.cluster,
                "--rule",
                f"ip_addr:{self.ip}",
            ],
            stdout=subprocess.DEVNULL,
        )
        self.rule_added = True
        # DO takes a few seconds to propagate the new trusted source. A child, so Ctrl-C ends the wait.
        self.check(["sleep", "5"])

        # The password may contain URL-significant characters: it goes in PGPASSWORD, never in a URI.
        details = self.run(
            [
                "doctl",
                "databases",
                "connection",
                self.cluster,
                "--format",
                "Host,Port,User,Password",
                "--no-header",
            ],
            stdout=subprocess.PIPE,
        )
        fields = connection_fields(details.stdout.decode(errors="surrogateescape"))
        if fields is None:
            sys.exit(1)
        host, port, user, password = fields

        print(f"Connecting to {db} on {host}:{port} as {user} ...", flush=True)
        self.check(
            ["psql", "-h", host, "-p", port, "-U", user, "-d", db, *psql_args],
            env={**os.environ, "PGPASSWORD": password, "PGSSLMODE": "require"},
        )


def main(argv=None):
    opts = parse_args(sys.argv[1:] if argv is None else argv, os.environ)

    for tool in ("doctl", "psql", "curl"):
        if not shutil.which(tool):
            print(f"error: '{tool}' not found in PATH", file=sys.stderr)
            return 1

    ip = opts["ip"]
    if not ip:
        detected = subprocess.run(
            ["curl", "-fsS", "https://api.ipify.org"],
            check=False,
            stdout=subprocess.PIPE,
        )
        if detected.returncode != 0:
            print("error: could not detect public IP", file=sys.stderr)
            return 1
        ip = detected.stdout.decode(errors="replace").rstrip("\n")
    print(f"Using IP: {ip}")

    session = Session(opts["cluster"], ip)
    signal.signal(signal.SIGINT, session.trap)
    signal.signal(signal.SIGTERM, session.trap)
    try:
        session.connect(opts["db"], opts["psql_args"])
    finally:
        session.cleanup()
    return 0


if __name__ == "__main__":
    sys.exit(main())
