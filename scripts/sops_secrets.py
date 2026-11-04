#!/usr/bin/env python3
"""Deploy-secret resolution from secrets/<env>.enc.yaml (SOPS/age), with a per-key LEGACY_<NAME> fallback.

One KEYS table serves the DO render (imported by do-render-app-spec.py), the homelab CLI and the bootstrap.
Errors name keys only; every value is masked before any other output.
"""

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import uuid

ENVS = ("staging", "production")
DO, HOMELAB = "do", "homelab"

# (namespace, name, required, targets)
KEYS = (
    ("common", "JWT_SECRET", True, (DO, HOMELAB)),
    ("common", "BROKER_ACCOUNTS_ENCRYPTION_KEY", True, (DO, HOMELAB)),
    ("common", "CONFIG_SECRETS_ENCRYPTION_KEY", True, (DO, HOMELAB)),
    ("common", "MTLS_CA", True, (DO, HOMELAB)),
    ("common", "SLACK_WEBHOOK_URL", False, (DO, HOMELAB)),
    ("common", "SENDGRID_API_KEY", False, (DO, HOMELAB)),
    ("common", "VAPID_PRIVATE_KEY", False, (DO, HOMELAB)),
    ("common", "VAPID_PUBLIC_KEY", False, (DO, HOMELAB)),
    ("common", "VAPID_SUBJECT", False, (DO, HOMELAB)),
    ("common", "OTEL_EXPORTER_OTLP_ENDPOINT", False, (DO,)),
    ("common", "OTEL_EXPORTER_OTLP_HEADERS", False, (DO,)),
    ("digitalocean", "PROJECT_ID", False, (DO,)),
    ("homelab", "TS_AUTHKEY", True, (HOMELAB,)),
    ("homelab", "TS_AUTHKEY_EXPIRES", True, (HOMELAB,)),
    ("homelab", "DEPLOY_SSH_KEY", True, (HOMELAB,)),
    ("homelab", "DEPLOY_KNOWN_HOSTS", True, (HOMELAB,)),
    ("homelab", "app_env", True, (HOMELAB,)),
)

COMMON = tuple(n for ns, n, _, _ in KEYS if ns == "common")
# Common app keys appended to the homelab APP_ENV; MTLS_CA travels separately and compose hardcodes OTEL off.
HOMELAB_TAIL = tuple(
    n for ns, n, _, t in KEYS if ns == "common" and HOMELAB in t and n != "MTLS_CA"
)
HOMELAB_EXPORTS = (
    "TS_AUTHKEY",
    "TS_AUTHKEY_EXPIRES",
    "DEPLOY_SSH_KEY",
    "DEPLOY_KNOWN_HOSTS",
    "MTLS_CA",
)
MASK_FLOOR = 4  # shorter values are non-secret flags; masking them would blank unrelated log text
DELIM_PREFIX = "ghadelim_"
VAR_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
LEGACY_COMMON_LINE = re.compile(
    r"^\s*(?:export\s+)?(?:" + "|".join(COMMON) + r")\s*[=:]"
)


class SecretError(Exception):
    """A failure whose message names keys only."""


def keys_for(target):
    return [(ns, n, req) for ns, n, req, t in KEYS if target in t]


def legacy_name(name):
    return "LEGACY_" + ("APP_ENV" if name == "app_env" else name)


def legacy_names(target):
    """The LEGACY_* env names a workflow must provide for this target."""
    return sorted(legacy_name(n) for _, n, _ in keys_for(target))


def default_file(env):
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(root, "secrets", f"{env}.enc.yaml")


def _escape_command_data(text):
    return text.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")


def mask(value):
    if len(value) < MASK_FLOOR:
        return
    if "\n" not in value and "\r" not in value:
        print("::add-mask::" + _escape_command_data(value))
    for line in value.splitlines():
        if len(line) >= MASK_FLOOR:
            print("::add-mask::" + _escape_command_data(line))


def _strings(value):
    return list(value.values()) if isinstance(value, dict) else [value]


def _sha(value):
    blob = json.dumps(value, sort_keys=True) if isinstance(value, dict) else value
    return hashlib.sha256(blob.encode()).hexdigest()


def decrypt(env, path):
    """Decrypted namespaces of a SOPS file; every leaf checked to be a string."""
    if not os.environ.get("SOPS_AGE_KEY"):
        raise SecretError(f"SOPS_AGE_KEY is empty but secrets/{env}.enc.yaml exists")
    proc = subprocess.run(
        ["sops", "decrypt", "--output-type", "json", path],
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        raise SecretError(
            f"cannot decrypt secrets/{env}.enc.yaml (sops exit {proc.returncode})"
        )
    data = json.loads(proc.stdout)
    for ns, entries in data.items():
        if not isinstance(entries, dict):
            raise SecretError(f"{ns} must be a mapping")
        for name, value in entries.items():
            if name == "app_env" and ns == "homelab":
                if not isinstance(value, dict):
                    raise SecretError("homelab.app_env must be a mapping")
                for k, v in value.items():
                    if not isinstance(v, str):
                        raise SecretError(f"homelab.app_env.{k} must be a string")
            elif not isinstance(value, str):
                raise SecretError(f"{ns}.{name} must be a string")
    return data


def _summary(lines):
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path, "a") as f:
            f.write("### Secret sources\n" + "".join(f"- {line}\n" for line in lines))


def resolve(env, target, file=None):
    """Return (values, sources) for the target; exits 1 if a required key is in neither store."""
    if env not in ENVS:
        raise SecretError(f"environment must be one of {', '.join(ENVS)}")
    path = file or default_file(env)
    data = decrypt(env, path) if os.path.exists(path) else {}
    candidates = []
    for ns, name, required in keys_for(target):
        stored = data.get(ns, {}).get(name)
        legacy = os.environ.get(legacy_name(name), "")
        candidates.append((name, required, stored, legacy))
    for _, _, stored, legacy in candidates:
        for v in _strings(stored) if stored is not None else []:
            mask(v)
        mask(legacy)
    values, sources, missing, lines = {}, {}, [], []
    for name, required, stored, legacy in candidates:
        if stored is not None and stored != "":
            values[name] = stored
            differs = (
                legacy != ""
                and not isinstance(stored, dict)
                and _sha(stored) != _sha(legacy)
            )
            sources[name] = "sops (differs from legacy)" if differs else "sops"
            if differs:
                print(
                    f"::warning::{name}: the SOPS value differs from the legacy GitHub secret"
                )
        elif legacy != "":
            values[name], sources[name] = legacy, "github"
        elif required:
            sources[name] = "MISSING"
            missing.append(name)
        else:
            sources[name] = "absent (optional)"
        lines.append(f"{name}: {sources[name]}")
    _summary(lines)
    if missing:
        for name in missing:
            print(f"::error::{name} is in neither SOPS nor the GitHub secrets")
            print(f"{name} is in neither SOPS nor the GitHub secrets", file=sys.stderr)
        sys.exit(1)
    return values, sources


def _quoted(key, value, label=None):
    if "'" in value or "\n" in value or "\r" in value:
        raise SecretError(
            f"{label or key}: value contains a quote or newline, which the homelab .env cannot hold"
        )
    return f"{key}='{value}'"


def homelab_app_env(values):
    """APP_ENV = app_env body (SOPS map or legacy blob minus common keys) + the DO common tail, last."""
    app_env = values["app_env"]
    if isinstance(app_env, dict):
        body = []
        for k, v in app_env.items():
            if not VAR_NAME.match(k):
                raise SecretError(
                    f"homelab.app_env key {k} is not a valid variable name"
                )
            if k in COMMON:
                raise SecretError(f"homelab.app_env must not contain common key {k}")
            body.append(_quoted(k, v, label=f"homelab.app_env.{k}"))
    else:
        body = [
            line for line in app_env.split("\n") if not LEGACY_COMMON_LINE.match(line)
        ]
    tail = [_quoted(n, values[n]) for n in HOMELAB_TAIL if n in values]
    return "\n".join(body + tail)


def write_github_env(path, exports):
    for name, value in exports.items():
        if DELIM_PREFIX in value:
            raise SecretError(f"{name}: value contains the reserved heredoc delimiter")
    with open(path, "a") as f:
        for name, value in exports.items():
            delim = DELIM_PREFIX + uuid.uuid4().hex
            f.write(f"{name}<<{delim}\n{value}\n{delim}\n")


def cmd_resolve(args):
    values, _ = resolve(args.env, args.target, args.file)
    app_env = values["app_env"]
    if isinstance(app_env, dict):
        for k, v in app_env.items():
            if DELIM_PREFIX in v:
                raise SecretError(
                    f"homelab.app_env.{k}: value contains the reserved heredoc delimiter"
                )
    exports = {n: values[n] for n in HOMELAB_EXPORTS}
    exports["APP_ENV"] = homelab_app_env(values)
    write_github_env(args.github_env, exports)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser(
        "resolve", help="resolve homelab secrets into GITHUB_ENV heredocs"
    )
    r.add_argument("--env", required=True, choices=ENVS)
    r.add_argument("--target", required=True, choices=(HOMELAB,))
    r.add_argument("--github-env", required=True)
    r.add_argument("--file")
    r.set_defaults(func=cmd_resolve)
    args = parser.parse_args(argv)
    try:
        args.func(args)
    except SecretError as e:
        print(f"::error::{e}")
        print(e, file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
