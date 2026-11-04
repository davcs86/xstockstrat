#!/usr/bin/env python3
"""Render a DigitalOcean app spec: YOUR_* placeholders from sops_secrets.resolve(env, "do"), mTLS leaves off MTLS_CA.

Used by deploy.yml and prod-up.yml. Writes the spec (0600) to --out, never stdout; every secret is masked first.
"""

import argparse
import glob
import os
import re
import shutil
import subprocess
import sys
import tempfile

# Imported via a sys.path insert, so never run this entry point with python3 -I.
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import sops_secrets

PLACEHOLDER = re.compile(r"YOUR_(?:DEV|PROD)_([A-Z0-9_]+)")
OTEL_HEADERS = "OTEL_EXPORTER_OTLP_HEADERS"


def yaml_pem(pem):
    """A double-quoted YAML scalar with escaped newlines; YAML un-escapes it back to the PEM."""
    body = pem.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
    return '"' + body + '"'


def spec_name(text):
    m = re.search(r"^name:\s*(\S+)\s*$", text, re.MULTILINE)
    return m.group(1) if m else None


def mint(ca_bundle):
    """{placeholder name: PEM} for the CA and the 12 per-service leaves minted off the CA bundle."""
    certs = tempfile.mkdtemp()
    try:
        decoded = subprocess.run(
            ["bash", os.path.join(HERE, "mtls-provision.sh"), "decode-ca", certs],
            env={**os.environ, "MTLS_CA": ca_bundle},
            capture_output=True,
            check=False,
        )
        if decoded.returncode:
            raise sops_secrets.SecretError(
                f"MTLS_CA cannot be decoded (mtls-provision exit {decoded.returncode})"
            )
        minted = subprocess.run(
            ["bash", os.path.join(HERE, "gen-dev-certs.sh")],
            env={k: v for k, v in os.environ.items() if not k.startswith("LEGACY_")}
            | {"CERTS_DIR": certs},
            capture_output=True,
            check=False,
        )
        if minted.returncode:
            raise sops_secrets.SecretError(
                f"cannot mint mTLS leaves (gen-dev-certs exit {minted.returncode})"
            )
        with open(os.path.join(certs, "_ca", "ca.pem")) as f:
            pems = {"MTLS_CA_CERT": f.read()}
        for svc_dir in sorted(glob.glob(os.path.join(certs, "xstockstrat-*"))):
            sfx = os.path.basename(svc_dir).removeprefix("xstockstrat-").upper()
            for kind, name in (("CERT", "cert.pem"), ("KEY", "key.pem")):
                with open(os.path.join(svc_dir, name)) as f:
                    pems[f"MTLS_{kind}_{sfx}"] = f.read()
        return pems
    finally:
        shutil.rmtree(certs, ignore_errors=True)


def render(args):
    with open(args.spec) as f:
        text = f.read()
    found = spec_name(text)
    if found != args.app_name:
        raise sops_secrets.SecretError(
            f"{args.spec}: top-level name is {found!r}, expected {args.app_name!r}"
        )
    text = text.replace("YOUR_GITHUB_ORG", args.org).replace(
        "YOUR_IMAGE_TAG", args.image_tag
    )
    values, _ = sops_secrets.resolve(args.env, sops_secrets.DO)
    fill = {
        n: values.get(n, "")
        for ns, n, _ in sops_secrets.keys_for(sops_secrets.DO)
        if ns == "common" and n != "MTLS_CA"
    }
    headers = fill[OTEL_HEADERS]
    if headers and not headers.startswith("Authorization="):
        fill[OTEL_HEADERS] = "Authorization=" + headers
        sops_secrets.mask(fill[OTEL_HEADERS])
    for name, pem in mint(values["MTLS_CA"]).items():
        quoted = yaml_pem(pem)
        sops_secrets.mask(quoted)
        sops_secrets.mask(pem)
        fill[name] = quoted
    text = PLACEHOLDER.sub(lambda m: fill.get(m.group(1), m.group(0)), text)
    leftover = sorted({m.group(0) for m in PLACEHOLDER.finditer(text)})
    if leftover:
        raise sops_secrets.SecretError(f"unfilled placeholders remain: {leftover}")
    fd = os.open(args.out, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(text)
    gh_output = os.environ.get("GITHUB_OUTPUT")
    if gh_output:
        with open(gh_output, "a") as f:
            f.write(
                f"app_name={args.app_name}\nproject_id={values.get('PROJECT_ID', '')}\n"
            )


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--env", required=True, choices=sops_secrets.ENVS)
    p.add_argument("--spec", required=True)
    p.add_argument("--app-name", required=True)
    p.add_argument("--image-tag", required=True)
    p.add_argument("--org", required=True)
    p.add_argument("--out", required=True)
    args = p.parse_args(argv)
    try:
        render(args)
    except sops_secrets.SecretError as e:
        print(f"::error::{e}")
        print(e, file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
