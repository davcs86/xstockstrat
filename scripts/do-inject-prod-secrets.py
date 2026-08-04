#!/usr/bin/env python3
"""Inject production runtime secrets into a DO App Platform spec from stdin.

Used by the manual prod bring-up workflow (.github/workflows/prod-up.yml) when
the production app is recreated from scratch via `doctl apps create`.

Why this is needed: `doctl apps update` preserves the SECRET env values that
were set once in the DigitalOcean dashboard, but a fresh `doctl apps create`
starts with no history — every required SECRET must be supplied at create time
or the component comes up with an empty value. Since `.do/app.yaml` is checked
into a public repo, those values live in GitHub Secrets and are injected here.

Two injection styles:
  * Placeholder secrets (JWT, broker key, Alpaca, FMP) already appear in the
    spec as YOUR_PROD_* tokens — straight string replace, mirroring the
    substitution in deploy.yml.
  * SECRET envs with no placeholder (MCP agent secret) have a `value:` line
    injected into their 3-line block.

Any required secret whose env var is empty/unset is left untouched, so the
workflow degrades gracefully (DO treats it as an unset SECRET) and logs a
warning. FMP_API_KEY is optional — the FMP fundamentals pipeline is off by
default (marketdata.fmp.enabled=false) — so its warning is suppressed when
unset, matching deploy.yml.

Reads the spec on stdin, writes the rendered spec to stdout.
"""
import json
import os
import sys

# SECRET envs that have no YOUR_PROD_* placeholder in the spec and therefore
# need a `value:` line injected into their block. Keyed by env var name read
# from the process environment (populated from GitHub Secrets in CI).
INJECT_KEYS = ("MCP_AGENT_SECRET",)

# Required placeholder token -> env var name, mirrors the substitution in
# deploy.yml's prod path.
PLACEHOLDER_KEYS = (
    ("YOUR_PROD_JWT_SECRET", "JWT_SECRET"),
    ("YOUR_PROD_BROKER_ACCOUNTS_ENCRYPTION_KEY", "BROKER_ACCOUNTS_ENCRYPTION_KEY"),
    ("YOUR_PROD_ALPACA_API_KEY", "ALPACA_API_KEY"),
    ("YOUR_PROD_ALPACA_API_SECRET", "ALPACA_API_SECRET"),
)

# Optional placeholder token -> env var name. The FMP fundamentals pipeline is
# off by default, so an unset key is a valid state — no warning if empty.
OPTIONAL_PLACEHOLDER_KEYS = (("YOUR_PROD_FMP_API_KEY", "FMP_API_KEY"),)


def inject_block(content, key, value):
    """Add a `value:` line to the `- key: <key>` SECRET block(s)."""
    if not value:
        sys.stderr.write(
            "warning: %s is empty; leaving it as an unset SECRET\n" % key
        )
        return content
    block = (
        "      - key: %s\n"
        "        scope: RUN_TIME\n"
        "        type: SECRET" % key
    )
    if block not in content:
        sys.stderr.write("warning: no SECRET block for %s found in spec\n" % key)
        return content
    # json.dumps yields a double-quoted scalar that is valid YAML for any value.
    replacement = block + "\n        value: " + json.dumps(value)
    return content.replace(block, replacement)


def main():
    content = sys.stdin.read()

    for placeholder, env_key in PLACEHOLDER_KEYS:
        value = os.environ.get(env_key, "")
        if value:
            content = content.replace(placeholder, value)
        else:
            sys.stderr.write("warning: %s is empty\n" % env_key)

    for placeholder, env_key in OPTIONAL_PLACEHOLDER_KEYS:
        value = os.environ.get(env_key, "")
        if value:
            content = content.replace(placeholder, value)

    for key in INJECT_KEYS:
        content = inject_block(content, key, os.environ.get(key, ""))

    sys.stdout.write(content)


if __name__ == "__main__":
    main()
