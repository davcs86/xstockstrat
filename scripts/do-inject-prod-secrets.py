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
  * Placeholder secrets (JWT, broker key) already appear in the spec as
    YOUR_PROD_* tokens — straight string replace (mirrors deploy.yml).
  * SECRET envs with no placeholder (Alpaca keys, MCP agent secret) have a
    `value:` line injected into their 3-line block.

Any secret whose env var is empty/unset is left untouched, so the workflow
degrades gracefully (DO treats it as an unset SECRET) and logs a warning.

Reads the spec on stdin, writes the rendered spec to stdout.
"""
import json
import os
import sys

# SECRET envs that have no YOUR_PROD_* placeholder in the spec and therefore
# need a `value:` line injected into their block. Keyed by env var name read
# from the process environment (populated from GitHub Secrets in CI).
INJECT_KEYS = ("ALPACA_API_KEY", "ALPACA_API_SECRET", "MCP_AGENT_SECRET")


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

    jwt = os.environ.get("JWT_SECRET", "")
    if jwt:
        content = content.replace("YOUR_PROD_JWT_SECRET", jwt)
    else:
        sys.stderr.write("warning: JWT_SECRET is empty\n")

    broker = os.environ.get("BROKER_ACCOUNTS_ENCRYPTION_KEY", "")
    if broker:
        content = content.replace(
            "YOUR_PROD_BROKER_ACCOUNTS_ENCRYPTION_KEY", broker
        )
    else:
        sys.stderr.write("warning: BROKER_ACCOUNTS_ENCRYPTION_KEY is empty\n")

    for key in INJECT_KEYS:
        content = inject_block(content, key, os.environ.get(key, ""))

    sys.stdout.write(content)


if __name__ == "__main__":
    main()
