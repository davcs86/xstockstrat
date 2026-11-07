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
import tempfile
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
    ("homelab", "DB_PASSWORD", True, (HOMELAB,)),
    ("homelab", "APP_URL", True, (HOMELAB,)),
    ("homelab", "SEED_USER_ID", True, (HOMELAB,)),
)

OWN = {DO: "digitalocean", HOMELAB: "homelab"}
# CI-only: exported on their own and never written into the VM .env (APP_ENV).
HOMELAB_EXPORTS = (
    "TS_AUTHKEY",
    "TS_AUTHKEY_EXPIRES",
    "DEPLOY_SSH_KEY",
    "DEPLOY_KNOWN_HOSTS",
    "MTLS_CA",
)
MASK_FLOOR = 4  # shorter values are non-secret flags; masking them would blank unrelated log text
DELIM_PREFIX = "ghadelim_"


class SecretError(Exception):
    """A failure whose message names keys only."""


def keys_for(target):
    """[(name, required, namespaces)]: one entry per name, the target's own namespace before common."""
    seen = set()
    for ns, n, _, t in KEYS:
        if ns != "common" and [OWN.get(x) for x in t] != [ns]:
            raise SecretError(
                f"KEYS row {ns}.{n}: a non-common row must target only its own namespace's target"
            )
        if (ns, n) in seen:
            raise SecretError(f"KEYS declares {ns}.{n} twice")
        seen.add((ns, n))
    merged = {}
    for ns, n, req, t in KEYS:
        if target in t:
            _, r, nss = merged.get(n, (n, False, []))
            merged[n] = (n, r or req, nss + [ns] if ns == "common" else [ns] + nss)
    return list(merged.values())


def legacy_name(name):
    return "LEGACY_" + name


def legacy_names(target):
    """The LEGACY_* env names a workflow must provide for this target."""
    return sorted(legacy_name(n) for n, _, _ in keys_for(target))


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


def _sha(value):
    return hashlib.sha256(value.encode()).hexdigest()


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
            if not isinstance(value, str):
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
    merged = keys_for(target)
    for entries in data.values():
        for v in entries.values():
            mask(v)
    for name, _, _ in merged:
        mask(os.environ.get(legacy_name(name), ""))
    values, sources, missing, lines = {}, {}, [], []
    for name, required, nss in merged:
        legacy = os.environ.get(legacy_name(name), "")
        won = next((ns for ns in nss if data.get(ns, {}).get(name, "") != ""), None)
        if won is not None:
            values[name] = data[won][name]
            parts = [won] if won != "common" and "common" in nss else []
            if legacy != "" and _sha(values[name]) != _sha(legacy):
                parts.append("differs from legacy")
                print(
                    f"::warning::{name}: the SOPS value differs from the legacy GitHub secret"
                )
            sources[name] = "sops" + (f" ({'; '.join(parts)})" if parts else "")
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


def _quoted(key, value):
    if "'" in value or "\n" in value or "\r" in value:
        raise SecretError(
            f"{key}: value contains a quote or newline, which the homelab .env cannot hold"
        )
    if DELIM_PREFIX in value:
        raise SecretError(f"{key}: value contains the reserved heredoc delimiter")
    return f"{key}='{value}'"


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
    merged = keys_for(args.target)
    names = [n for n, _, nss in merged if "common" not in nss] + [
        n for n, _, nss in merged if "common" in nss
    ]
    exports = {n: values[n] for n in HOMELAB_EXPORTS}
    exports["APP_ENV"] = "\n".join(
        _quoted(n, values[n]) for n in names if n in values and n not in HOMELAB_EXPORTS
    )
    write_github_env(args.github_env, exports)


SEEDED = ("common", "digitalocean")
RECIPIENT_LINE = re.compile(
    r"^\s*(?:-\s+)?recipient:\s+(age1[0-9a-z]+)\s*$", re.MULTILINE
)


def _run(cmd, cwd=None, stdin=None):
    return subprocess.run(
        cmd, cwd=cwd, input=stdin, capture_output=True, text=True, check=False
    )


def _repo_root():
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _existing_on_main_dev(env):
    """The FETCH_HEAD copy of secrets/<env>.enc.yaml, or None; a fetch failure is never 'absent'."""
    root = _repo_root()
    if _run(["git", "fetch", "--depth=1", "origin", "main-dev"], cwd=root).returncode:
        raise SecretError("cannot fetch main-dev")
    rel = f"secrets/{env}.enc.yaml"
    listed = _run(["git", "ls-tree", "--name-only", "FETCH_HEAD", "--", rel], cwd=root)
    if listed.returncode:
        raise SecretError("cannot list FETCH_HEAD")
    if listed.stdout.strip() != rel:
        return None
    shown = _run(["git", "show", f"FETCH_HEAD:{rel}"], cwd=root)
    if shown.returncode:
        raise SecretError(f"cannot read {rel} from FETCH_HEAD")
    return shown.stdout


def _decrypt_text(env, text):
    proc = _run(
        [
            "sops",
            "decrypt",
            "--input-type",
            "yaml",
            "--output-type",
            "json",
            "/dev/stdin",
        ],
        stdin=text,
    )
    if proc.returncode:
        raise SecretError(
            f"cannot decrypt secrets/{env}.enc.yaml (sops exit {proc.returncode})"
        )
    return json.loads(proc.stdout)


def _verify(env, ciphertext, payload, recipients):
    plain = _decrypt_text(env, ciphertext)
    if sorted(plain) != sorted(SEEDED):
        raise SecretError(
            "self-verify: top-level keys are not exactly common, digitalocean"
        )
    for ns in SEEDED:
        got, want = plain[ns], payload[ns]
        if sorted(got) != sorted(want):
            raise SecretError(f"self-verify: {ns} key set differs from the sources")
        for k, v in got.items():
            if not isinstance(v, str) or _sha(v) != _sha(want[k]):
                raise SecretError(f"self-verify: {ns}.{k} differs from its source")
    body = ciphertext.split("\nsops:", 1)[0]
    leaves = [ln for ln in body.splitlines() if re.match(r"^\s+[A-Za-z_]\w*: ", ln)]
    if any("ENC[AES256_GCM," not in ln for ln in leaves):
        raise SecretError("self-verify: a value is not encrypted")
    if sorted(RECIPIENT_LINE.findall(ciphertext)) != sorted(recipients):
        raise SecretError(
            "self-verify: recipients are not exactly the env key + operator"
        )


def _changes(old, new):
    lines = []
    for ns in SEEDED:
        before, after = old.get(ns, {}), new.get(ns, {})
        for k in sorted(set(before) | set(after)):
            if k not in before:
                state = "added"
            elif k not in after:
                state = "removed"
            elif _sha(before[k]) != _sha(after[k]):
                state = "changed"
            else:
                state = "unchanged"
            lines.append(f"- `{ns}.{k}`: {state}")
    return "\n".join(lines) + "\n"


def cmd_build(args):
    env = args.env
    seeded = [(ns, n, req) for ns, n, req, _ in KEYS if ns in SEEDED]
    for _, name, _ in seeded:
        mask(os.environ.get(legacy_name(name), ""))
    operator = os.environ.get("SOPS_OPERATOR_AGE_RECIPIENT", "").strip()
    if not operator:
        raise SecretError("SOPS_OPERATOR_AGE_RECIPIENT is empty")
    existing = _existing_on_main_dev(env)
    if existing is not None and not args.force:
        raise SecretError(
            f"secrets/{env}.enc.yaml already exists; re-run with force=true to overwrite"
        )
    payload = {ns: {} for ns in SEEDED}
    missing = []
    for ns, name, required in seeded:
        value = os.environ.get(legacy_name(name), "")
        if value != "":
            payload[ns][name] = value
        elif required:
            missing.append(name)
    if missing:
        raise SecretError("; ".join(f"{n} is required but missing" for n in missing))
    key = os.environ.get("SOPS_AGE_KEY", "")
    pub = _run(["age-keygen", "-y"], stdin=key)
    if not key or pub.returncode:
        raise SecretError("SOPS_AGE_KEY is not a valid age identity")
    env_recipient = pub.stdout.strip()
    recipients = [env_recipient, operator]
    cwd = os.environ.get("RUNNER_TEMP") or tempfile.mkdtemp()
    enc = _run(
        [
            "sops",
            "encrypt",
            "--input-type",
            "json",
            "--output-type",
            "yaml",
            "--filename-override",
            f"secrets/{env}.enc.yaml",
            "--age",
            ",".join(recipients),
            "/dev/stdin",
        ],
        cwd=cwd,
        stdin=json.dumps(payload),
    )
    if enc.returncode:
        raise SecretError(
            f"cannot encrypt secrets/{env}.enc.yaml (sops exit {enc.returncode})"
        )
    _verify(env, enc.stdout, payload, recipients)
    changes = None
    if existing is not None:
        changes = _changes(_decrypt_text(env, existing), payload)
    os.makedirs(args.out, exist_ok=True)
    with open(os.path.join(args.out, f"{env}.enc.yaml"), "w") as f:
        f.write(enc.stdout)
    with open(os.path.join(args.out, f"{env}.recipient"), "w") as f:
        f.write(env_recipient + "\n")
    if changes is not None:
        with open(os.path.join(args.out, f"{env}.changes.md"), "w") as f:
            f.write(f"### `secrets/{env}.enc.yaml` (forced re-seed)\n\n{changes}")


def cmd_sops_config(args):
    operator = os.environ.get("SOPS_OPERATOR_AGE_RECIPIENT", "").strip()
    if not operator:
        raise SecretError("SOPS_OPERATOR_AGE_RECIPIENT is empty")
    out = ["creation_rules:"]
    for env in ENVS:
        with open(os.path.join(args.dir, f"{env}.recipient")) as f:
            recipient = f.read().strip()
        out += [
            f"  - path_regex: secrets/{env}\\.enc\\.yaml$",
            f"    age: {recipient},{operator}",
        ]
    print("\n".join(out))


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
    b = sub.add_parser(
        "build", help="seed secrets/<env>.enc.yaml from the LEGACY_* values"
    )
    b.add_argument("--env", required=True, choices=ENVS)
    b.add_argument("--out", required=True)
    b.add_argument("--force", action="store_true")
    b.set_defaults(func=cmd_build)
    c = sub.add_parser(
        "sops-config", help="print .sops.yaml from <dir>/<env>.recipient"
    )
    c.add_argument("dir")
    c.set_defaults(func=cmd_sops_config)
    args = parser.parse_args(argv)
    try:
        args.func(args)
    except SecretError as e:
        print(f"::error::{e}")
        print(e, file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
