#!/usr/bin/env python3
"""Integrity validator for the design-buddy plugin.

Python 3 stdlib only (plugin script policy: Python, never Bash). Checks:
  1. plugin.json (and the repo marketplace.json, when present) parse and carry required fields;
  2. every skill SKILL.md and agent .md has YAML frontmatter with the required keys;
  3. every reference/... and templates/... path named in a skill's markdown resolves to a file;
  4. no host-repo-specific strings leak into the plugin (portability guard).

Usage:
  python3 validate.py [--plugin-root PATH]   # validate (default root: this script's parent dir)
  python3 validate.py --self-test            # run the built-in negative-fixture tests

Exit 0 when clean; exit 1 with one MISSING:/LEAK:/ERROR: line per finding.
"""

import argparse
import json
import re
import sys
import tempfile
from pathlib import Path

FRONTMATTER_RE = re.compile(r"\A---\n(.*?)\n---\n", re.DOTALL)
INTERNAL_PATH_RE = re.compile(r"(?:reference|templates)/[A-Za-z0-9_./-]+\.md")
LEAK_PATTERNS = ("xstockstrat", "docs/roadmap", "docs/sdd", "services/")
# README may name the hosting marketplace in install instructions.
LEAK_ALLOWED_LINE_RE = re.compile(r"davcs86/xstockstrat|@xstockstrat")
SKILL_REQUIRED_KEYS = ("name", "description")
AGENT_REQUIRED_KEYS = ("name", "description", "tools", "model")


def frontmatter_keys(text):
    match = FRONTMATTER_RE.match(text)
    if match is None:
        return None
    keys = set()
    for line in match.group(1).splitlines():
        key_match = re.match(r"^([A-Za-z][A-Za-z0-9_-]*):", line)
        if key_match:
            keys.add(key_match.group(1))
    return keys


def check_manifest(path, required, findings):
    if not path.is_file():
        findings.append(f"MISSING: {path} does not exist")
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        findings.append(f"ERROR: {path} is not valid JSON ({exc})")
        return None
    for field in required:
        if field not in data:
            findings.append(f"MISSING: {path} lacks required field '{field}'")
    return data


def check_frontmatter(path, required, findings):
    keys = frontmatter_keys(path.read_text(encoding="utf-8"))
    if keys is None:
        findings.append(f"MISSING: {path} has no YAML frontmatter")
        return
    for key in required:
        if key not in keys:
            findings.append(f"MISSING: {path} frontmatter lacks '{key}'")


def check_internal_paths(skill_dir, findings):
    sources = [skill_dir / "SKILL.md"] + sorted((skill_dir / "reference").glob("*.md"))
    for source in sources:
        if not source.is_file():
            continue
        for ref in sorted(set(INTERNAL_PATH_RE.findall(source.read_text(encoding="utf-8")))):
            if not (skill_dir / ref).is_file():
                findings.append(f"MISSING: {source} references '{ref}' which does not exist under {skill_dir}")


def check_leakage(plugin_root, findings):
    for path in sorted(plugin_root.rglob("*")):
        if not path.is_file() or path.suffix not in (".md", ".json", ".py"):
            continue
        if path.name == "validate.py":
            continue  # the patterns themselves live here
        for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            for pattern in LEAK_PATTERNS:
                if pattern in line and not LEAK_ALLOWED_LINE_RE.search(line):
                    findings.append(f"LEAK: {path}:{lineno} contains host-repo string '{pattern}'")


def validate(plugin_root):
    findings = []
    check_manifest(plugin_root / ".claude-plugin" / "plugin.json", ("name", "description", "version"), findings)

    skills_dir = plugin_root / "skills"
    skill_dirs = sorted(d for d in skills_dir.glob("*") if d.is_dir()) if skills_dir.is_dir() else []
    if not skill_dirs:
        findings.append(f"MISSING: no skills found under {skills_dir}")
    for skill_dir in skill_dirs:
        skill_md = skill_dir / "SKILL.md"
        if not skill_md.is_file():
            findings.append(f"MISSING: {skill_md} does not exist")
            continue
        check_frontmatter(skill_md, SKILL_REQUIRED_KEYS, findings)
        check_internal_paths(skill_dir, findings)

    agent_files = sorted((plugin_root / "agents").glob("*.md"))
    if not agent_files:
        findings.append(f"MISSING: no agents found under {plugin_root / 'agents'}")
    for agent_file in agent_files:
        check_frontmatter(agent_file, AGENT_REQUIRED_KEYS, findings)

    check_leakage(plugin_root, findings)

    # Marketplace entry (only when the plugin sits inside a marketplace repo).
    marketplace = plugin_root.parent.parent / ".claude-plugin" / "marketplace.json"
    if marketplace.is_file():
        data = check_manifest(marketplace, ("name", "owner", "plugins"), findings)
        if data and isinstance(data.get("plugins"), list):
            for entry in data["plugins"]:
                source = entry.get("source", "")
                if isinstance(source, str) and source.startswith("./"):
                    if not (marketplace.parent.parent / source).is_dir():
                        findings.append(f"MISSING: {marketplace} plugin source '{source}' does not resolve")
    return findings


def self_test():
    failures = []

    def expect(label, findings, needle):
        if not any(needle in f for f in findings):
            failures.append(f"self-test '{label}': expected a finding containing '{needle}', got {findings}")

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "broken-plugin"
        (root / ".claude-plugin").mkdir(parents=True)
        # Valid JSON missing required fields:
        (root / ".claude-plugin" / "plugin.json").write_text('{"version": "0.0.1"}', encoding="utf-8")
        skill = root / "skills" / "demo"
        (skill / "reference").mkdir(parents=True)
        # Frontmatter missing 'description'; dangling internal reference; host-repo leakage:
        (skill / "SKILL.md").write_text(
            "---\nname: demo\n---\nLoad `reference/missing.md` and copy from services/foo.\n",
            encoding="utf-8",
        )
        (root / "agents").mkdir()
        (root / "agents" / "bare.md").write_text("No frontmatter here.\n", encoding="utf-8")
        findings = validate(root)
        expect("missing manifest field", findings, "lacks required field 'name'")
        expect("missing frontmatter key", findings, "frontmatter lacks 'description'")
        expect("dangling internal ref", findings, "references 'reference/missing.md'")
        expect("agent frontmatter", findings, "bare.md has no YAML frontmatter")
        expect("leakage", findings, "host-repo string 'services/'")

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
