#!/usr/bin/env python3
"""Print the mTLS dotenv lines for deploy/homelab/compose.yml from a gen-dev-certs.sh tree at $CERTS_DIR.

Values are double-quoted with \\n escapes, which compose's dotenv parser turns back into PEM newlines.
"""

import os
import sys

SERVICES = (
    "trading",
    "portfolio",
    "marketdata",
    "indicators",
    "ingest",
    "analysis",
    "ledger",
    "identity",
    "notify",
    "config",
    "ui",
    "agent",
)


def quoted(path: str) -> str:
    with open(path) as f:
        pem = f.read()
    if any(c in pem for c in '"$\\'):
        sys.exit(f"homelab-mtls-env: {path} has a character dotenv would reinterpret")
    return '"' + pem.replace("\n", "\\n") + '"'


def main() -> None:
    certs = os.environ.get("CERTS_DIR") or sys.exit(
        "homelab-mtls-env: CERTS_DIR is required"
    )
    paths = {"MTLS_CA_CERT": os.path.join(certs, "_ca", "ca.pem")}
    for svc in SERVICES:
        leaf = os.path.join(certs, f"xstockstrat-{svc}")
        paths[f"{svc.upper()}_MTLS_CERT"] = os.path.join(leaf, "cert.pem")
        paths[f"{svc.upper()}_MTLS_KEY"] = os.path.join(leaf, "key.pem")
    missing = sorted(p for p in paths.values() if not os.path.isfile(p))
    if missing:
        sys.exit(f"homelab-mtls-env: missing {missing}")
    for name, path in paths.items():
        print(f"{name}={quoted(path)}")


if __name__ == "__main__":
    main()
