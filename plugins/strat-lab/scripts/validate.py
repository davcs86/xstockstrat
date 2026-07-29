#!/usr/bin/env python3
"""Integrity validator for the strat-lab plugin.

strat-lab is a dual-tool plugin (Claude Code + Cursor): one shared skills tree with a manifest for
each tool. Python 3 stdlib only (plugin script policy: Python, never Bash). Checks:
  1. both plugin manifests (.claude-plugin/plugin.json, .cursor-plugin/plugin.json) parse, carry
     the required fields, and share a byte-identical semver `version` (a drift means one tool's
     users never see the update);
  2. every skill SKILL.md has YAML frontmatter with the required keys and no unquoted ': ' that
     would make the stdlib-less YAML loader silently drop the whole block;
  3. every reference/... and templates/... path named in a skill's markdown resolves to a file;
  4. each marketplace catalog present at the repo root registers this plugin with a resolving
     `./plugins/...` source.

Unlike sibling plugins, strat-lab legitimately targets the xstockstrat MCP server, so there is no
"xstockstrat" origin-leak guard here.

Usage:
  python3 validate.py [--plugin-root PATH]   # validate (default root: this script's parent dir)
  python3 validate.py --self-test            # run the built-in negative-fixture tests

Exit 0 when clean; exit 1 with one MISSING:/ERROR:/YAML:/VERSION: line per finding.
"""

import argparse
import json
import re
import sys
import tempfile
from pathlib import Path

FRONTMATTER_RE = re.compile(r"\A---\n(.*?)\n---\n", re.DOTALL)
INTERNAL_PATH_RE = re.compile(r"(?:reference|templates)/[A-Za-z0-9_./-]+\.md")
FRONTMATTER_SCALAR_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_-]*:\s+(?P<val>\S.*)$")
SEMVER_RE = re.compile(r"^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$")
SKILL_REQUIRED_KEYS = ("name", "description")
MANIFEST_REQUIRED = ("name", "description", "version")


def frontmatter_keys(block):
    keys = set()
    for line in block.splitlines():
        m = re.match(r"^([A-Za-z][A-Za-z0-9_-]*):", line)
        if m:
            keys.add(m.group(1))
    return keys


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
    """Lines whose unquoted scalar value contains ': ' (colon-space).

    YAML reads a colon-space inside a plain scalar as a nested mapping and rejects the whole block,
    so at load time every frontmatter field is silently dropped. Quoting the value fixes it.
    """
    risky = []
    for line in block.splitlines():
        m = FRONTMATTER_SCALAR_RE.match(line)
        if m and m.group("val")[:1] not in ("'", '"') and ": " in m.group("val"):
            risky.append(line.strip())
    return risky


def check_frontmatter(path, findings):
    match = FRONTMATTER_RE.match(path.read_text(encoding="utf-8"))
    if match is None:
        findings.append(f"MISSING: {path} has no YAML frontmatter")
        return
    keys = frontmatter_keys(match.group(1))
    for key in SKILL_REQUIRED_KEYS:
        if key not in keys:
            findings.append(f"MISSING: {path} frontmatter lacks '{key}'")
    for line in frontmatter_yaml_risks(match.group(1)):
        findings.append(f"YAML: {path} frontmatter value has an unquoted ': ' that breaks YAML "
                        f"parsing (all fields silently dropped) — quote it: {line[:70]}")


def check_internal_paths(skill_dir, findings):
    sources = [skill_dir / "SKILL.md"] + sorted((skill_dir / "reference").glob("*.md"))
    for source in sources:
        if not source.is_file():
            continue
        for ref in sorted(set(INTERNAL_PATH_RE.findall(source.read_text(encoding="utf-8")))):
            if not (skill_dir / ref).is_file():
                findings.append(f"MISSING: {source} references '{ref}' which does not exist under {skill_dir}")


def validate(plugin_root):
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
        skill_md = skill_dir / "SKILL.md"
        if not skill_md.is_file():
            findings.append(f"MISSING: {skill_md} does not exist")
            continue
        check_frontmatter(skill_md, findings)
        check_internal_paths(skill_dir, findings)

    # Marketplace entries (only when the plugin sits inside a marketplace repo) — one catalog per
    # tool, both registering this same plugin tree by a resolving ./plugins/... source.
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
    return findings


def self_test():
    failures = []

    def expect(label, findings, needle):
        if not any(needle in f for f in findings):
            failures.append(f"self-test '{label}': expected a finding containing '{needle}', got {findings}")

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "broken-plugin"
        (root / ".claude-plugin").mkdir(parents=True)
        (root / ".cursor-plugin").mkdir(parents=True)
        # claude manifest: valid JSON, missing 'name', non-semver version:
        (root / ".claude-plugin" / "plugin.json").write_text('{"description": "d", "version": "1.0"}', encoding="utf-8")
        # cursor manifest: different version -> parity finding:
        (root / ".cursor-plugin" / "plugin.json").write_text('{"name": "x", "description": "d", "version": "0.2.0"}', encoding="utf-8")
        skill = root / "skills" / "demo"
        (skill / "reference").mkdir(parents=True)
        # Frontmatter missing 'description', dangling internal reference, and (in demo2) colon-space:
        (skill / "SKILL.md").write_text(
            "---\nname: demo\n---\nLoad `reference/missing.md`.\n", encoding="utf-8")
        skill2 = root / "skills" / "demo2"
        skill2.mkdir(parents=True)
        (skill2 / "SKILL.md").write_text(
            "---\nname: demo2\ndescription: Turn X into Y. Usage: run it\n---\nBody.\n", encoding="utf-8")
        findings = validate(root)
        expect("missing manifest field", findings, "lacks required field 'name'")
        expect("non-semver version", findings, "not MAJOR.MINOR.PATCH")
        expect("version parity", findings, "manifest versions differ")
        expect("missing frontmatter key", findings, "frontmatter lacks 'description'")
        expect("dangling internal ref", findings, "references 'reference/missing.md'")
        expect("colon-space yaml", findings, "YAML:")

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "bad-json-plugin"
        (root / ".claude-plugin").mkdir(parents=True)
        (root / ".claude-plugin" / "plugin.json").write_text("{not json", encoding="utf-8")
        expect("invalid JSON", validate(root), "is not valid JSON")

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
