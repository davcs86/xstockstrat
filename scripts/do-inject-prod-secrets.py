#!/usr/bin/env python3
"""Inject production runtime secrets into a DO App Platform spec from stdin.

Used by the manual prod bring-up workflow (.github/workflows/prod-up.yml) when
the production app is recreated from scratch via `doctl apps create`.

Why this is needed: `doctl apps update` preserves the SECRET env values that
were set once in the DigitalOcean dashboard, but a fresh `doctl apps create`
starts with no history — every required SECRET must be supplied at create time
or the component comes up with an empty value. Since `.do/app.yaml` is checked
into a public repo, those values live in GitHub Secrets and are injected here.

Placeholder secrets (JWT, broker key, config-secrets key) already appear in the
spec as YOUR_PROD_* tokens — straight string replace, mirroring the substitution
in deploy.yml.

Feature 147: the vendor credentials (Alpaca/FMP/Finnhub) are no longer deploy
secrets — they are stored encrypted in xstockstrat-config and set post-deploy via
the config write path — and MCP_AGENT_SECRET is retired (the agent signs its
OAuth txn with JWT_SECRET, injected into the agent block as a YOUR_PROD_JWT_SECRET
placeholder). So no INJECT_KEYS remain.

Any required secret whose env var is empty/unset is left untouched, so the
workflow degrades gracefully (DO treats it as an unset SECRET) and logs a warning.

Reads the spec on stdin, writes the rendered spec to stdout.
"""
import os
import sys

# Required placeholder token -> env var name, mirrors the substitution in
# deploy.yml's prod path.
PLACEHOLDER_KEYS = (
    ("YOUR_PROD_JWT_SECRET", "JWT_SECRET"),
    ("YOUR_PROD_BROKER_ACCOUNTS_ENCRYPTION_KEY", "BROKER_ACCOUNTS_ENCRYPTION_KEY"),
    ("YOUR_PROD_CONFIG_SECRETS_ENCRYPTION_KEY", "CONFIG_SECRETS_ENCRYPTION_KEY"),
)

# Optional placeholder token -> env var name; off until set, so an unset key is a valid state
# (no warning if empty). Feature 147 moved the data-source vendor credentials into encrypted config;
# the notify fanout secrets (feature 020) remain app-level type: SECRET env vars.
OPTIONAL_PLACEHOLDER_KEYS = (
    ("YOUR_PROD_SLACK_WEBHOOK_URL", "SLACK_WEBHOOK_URL"),
    ("YOUR_PROD_SENDGRID_API_KEY", "SENDGRID_API_KEY"),
    # Feature 163 — Web Push (VAPID). Private key is the secret; public key + subject are non-secret
    # but injected the same way so all three placeholders resolve. Off until all three are set.
    ("YOUR_PROD_VAPID_PRIVATE_KEY", "VAPID_PRIVATE_KEY"),
    ("YOUR_PROD_VAPID_PUBLIC_KEY", "VAPID_PUBLIC_KEY"),
    ("YOUR_PROD_VAPID_SUBJECT", "VAPID_SUBJECT"),
)


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

    sys.stdout.write(content)


if __name__ == "__main__":
    main()
