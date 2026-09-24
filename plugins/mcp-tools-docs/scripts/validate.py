#!/usr/bin/env python3
"""Integrity validator for the mcp-tools-docs plugin.

mcp-tools-docs is a dual-tool plugin (Claude Code + Cursor): one generated skill tree with a
manifest per tool. Python 3 stdlib only (plugin script policy: Python, never Bash). Checks:
  1. both plugin manifests (.claude-plugin/plugin.json, .cursor-plugin/plugin.json) parse, carry
     the required fields, and share a byte-identical semver `version`;
  2. the single skill's SKILL.md has YAML frontmatter with the required keys and no unquoted ': '
     that would make the stdlib-less YAML loader silently drop the whole block;
  3. every reference/... path named in the router SKILL.md resolves to a file;
  4. the generated skill is FRESH — i.e. `generate.py --check` reports no drift versus
     docs/runbooks/mcp-tools.md (the source of truth). A stale skill is the one failure mode this
     plugin has that the others cannot, so it is a first-class check here;
  5. each marketplace catalog at the repo root registers this plugin with a resolving source.

Usage:
  python3 validate.py [--plugin-root PATH]
  python3 validate.py --self-test
Exit 0 when clean; exit 1 with one MISSING:/ERROR:/YAML:/VERSION:/DRIFT: line per finding.
"""

import argparse
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

FRONTMATTER_RE = re.compile(r"\A---\n(.*?)\n---\n", re.DOTALL)
INTERNAL_PATH_RE = re.compile(r"reference/[A-Za-z0-9_./-]+\.md")
FRONTMATTER_SCALAR_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_-]*:\s+(?P<val>\S.*)$")
SEMVER_RE = re.compile(r"^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$")
MANIFEST_REQUIRED = ("name", "description", "version")
SKILL_REQUIRED_KEYS = ("name", "description")


def check_manifest(path, findings):
    if not path.is_file():
        findings.append(f"MISSING: {path} does not exist")
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        findings.append(f"ERROR: {path} is not valid JSON ({exc})")
        return None
    for field in MANIFEST_REQUIRED:
        if field not in data:
            findings.append(f"MISSING: {path} lacks required field '{field}'")
    version = data.get("version")
    if version is not None and not SEMVER_RE.match(str(version)):
        findings.append(f"VERSION: {path} version '{version}' is not MAJOR.MINOR.PATCH semver")
    return data


def frontmatter_yaml_risks(block):
    risky = []
    for line in block.splitlines():
        m = FRONTMATTER_SCALAR_RE.match(line)
        if m and m.group("val")[:1] not in ("'", '"') and ": " in m.group("val"):
            risky.append(line.strip())
    return risky


def check_skill(skill_dir, findings):
    skill_md = skill_dir / "SKILL.md"
    if not skill_md.is_file():
        findings.append(f"MISSING: {skill_md} does not exist")
        return
    text = skill_md.read_text(encoding="utf-8")
    match = FRONTMATTER_RE.match(text)
    if match is None:
        findings.append(f"MISSING: {skill_md} has no YAML frontmatter")
        return
    keys = {re.match(r"^([A-Za-z][A-Za-z0-9_-]*):", ln).group(1)
            for ln in match.group(1).splitlines() if re.match(r"^([A-Za-z][A-Za-z0-9_-]*):", ln)}
    for key in SKILL_REQUIRED_KEYS:
        if key not in keys:
            findings.append(f"MISSING: {skill_md} frontmatter lacks '{key}'")
    for line in frontmatter_yaml_risks(match.group(1)):
        findings.append(f"YAML: {skill_md} frontmatter value has an unquoted ': ' (all fields "
                        f"silently dropped at load) — quote it: {line[:70]}")
    for ref in sorted(set(INTERNAL_PATH_RE.findall(text))):
        if not (skill_dir / ref).is_file():
            findings.append(f"MISSING: {skill_md} references '{ref}' which does not exist under {skill_dir}")


def check_freshness(plugin_root, findings):
    gen = plugin_root / "scripts" / "generate.py"
    if not gen.is_file():
        findings.append(f"MISSING: {gen} (generator) does not exist")
        return
    proc = subprocess.run([sys.executable, str(gen), "--check"],
                          capture_output=True, text=True)
    if proc.returncode != 0:
        detail = (proc.stdout + proc.stderr).strip().replace("\n", " ")
        findings.append(f"DRIFT: generated skill is stale vs the runbook — {detail[:200]}")


def check_marketplaces(plugin_root, findings):
    repo_root = plugin_root.parent.parent
    plugin_name = plugin_root.name
    for catalog_dir in (".claude-plugin", ".cursor-plugin"):
        marketplace = repo_root / catalog_dir / "marketplace.json"
        if not marketplace.is_file():
            continue
        try:
            data = json.loads(marketplace.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            findings.append(f"ERROR: {marketplace} is not valid JSON ({exc})")
            continue
        entries = data.get("plugins", []) if isinstance(data, dict) else []
        names = {e.get("name") for e in entries if isinstance(e, dict)}
        if plugin_name not in names:
            findings.append(f"MISSING: {marketplace} has no entry named '{plugin_name}'")
        for entry in entries:
            if isinstance(entry, dict) and entry.get("name") == plugin_name:
                source = entry.get("source", "")
                if not (isinstance(source, str) and (repo_root / source).is_dir()):
                    findings.append(f"MISSING: {marketplace} entry '{plugin_name}' source '{source}' does not resolve")


def validate(plugin_root, skip_freshness=False):
    findings = []
    claude = check_manifest(plugin_root / ".claude-plugin" / "plugin.json", findings)
    cursor = check_manifest(plugin_root / ".cursor-plugin" / "plugin.json", findings)
    if claude and cursor and claude.get("version") != cursor.get("version"):
        findings.append(
            f"VERSION: manifest versions differ — .claude-plugin={claude.get('version')!r} "
            f".cursor-plugin={cursor.get('version')!r} (they must be byte-identical)")

    skills_dir = plugin_root / "skills"
    skill_dirs = sorted(d for d in skills_dir.glob("*") if d.is_dir()) if skills_dir.is_dir() else []
    if not skill_dirs:
        findings.append(f"MISSING: no skills found under {skills_dir}")
    for skill_dir in skill_dirs:
        check_skill(skill_dir, findings)

    if not skip_freshness:
        check_freshness(plugin_root, findings)
    check_marketplaces(plugin_root, findings)
    return findings


def self_test():
    failures = []

    def expect(label, findings, needle):
        if not any(needle in f for f in findings):
            failures.append(f"self-test '{label}': expected '{needle}', got {findings}")

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "broken-plugin"
        (root / ".claude-plugin").mkdir(parents=True)
        (root / ".cursor-plugin").mkdir(parents=True)
        (root / ".claude-plugin" / "plugin.json").write_text('{"description": "d", "version": "1.0"}', encoding="utf-8")
        (root / ".cursor-plugin" / "plugin.json").write_text('{"name": "x", "description": "d", "version": "0.2.0"}', encoding="utf-8")
        skill = root / "skills" / "mcp-tools"
        skill.mkdir(parents=True)
        (skill / "SKILL.md").write_text(
            "---\nname: mcp-tools\ndescription: Turn X into Y. Usage: run it\n---\n"
            "See `reference/tools/missing.md`.\n", encoding="utf-8")
        findings = validate(root, skip_freshness=True)
        expect("missing manifest field", findings, "lacks required field 'name'")
        expect("non-semver version", findings, "not MAJOR.MINOR.PATCH")
        expect("version parity", findings, "manifest versions differ")
        expect("colon-space yaml", findings, "YAML:")
        expect("dangling internal ref", findings, "reference/tools/missing.md")

    if failures:
        print("\n".join(failures))
        return 1
    print("self-test: all negative fixtures caught OK")
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--plugin-root", type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        return self_test()

    findings = validate(args.plugin_root)
    if findings:
        print("\n".join(findings))
        return 1
    print(f"OK: {args.plugin_root} passed all checks")
    return 0


if __name__ == "__main__":
    sys.exit(main())
