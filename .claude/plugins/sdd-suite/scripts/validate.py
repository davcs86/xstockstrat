#!/usr/bin/env python3
"""Integrity validator for the sdd-suite plugin.

sdd-suite is a dual-tool plugin (Claude Code + Cursor) that also declares a CROSS-MARKETPLACE
dependency on context-forge (from the davcs86-agent-plugins marketplace). Python 3 stdlib only
(plugin script policy: Python, never Bash). Checks:
  1. both plugin manifests parse, carry the required fields, and share a byte-identical semver
     `version`;
  2. every skill SKILL.md has YAML frontmatter with the required keys and no unquoted ': ' that
     would make the stdlib-less YAML loader silently drop the whole block;
  3. every internal path a skill/reference names resolves — both relative `reference|templates/...`
     refs (against the skill dir) and repo-rooted `.claude/plugins/sdd-suite/...` cross-refs;
  4. DEPENDENCY INTEGRITY: the Claude manifest declares the context-forge dependency naming
     marketplace `davcs86-agent-plugins`, AND the repo's root Claude marketplace.json lists that
     marketplace in `allowCrossMarketplaceDependenciesOn` — without that allowlist entry Claude
     Code refuses to auto-install the cross-marketplace dependency, so the two must agree;
  5. each marketplace catalog at the repo root registers this plugin with a resolving source.

Usage:
  python3 validate.py [--plugin-root PATH]
  python3 validate.py --self-test
Exit 0 when clean; exit 1 with one finding per line.
"""

import argparse
import json
import re
import sys
import tempfile
from pathlib import Path

FRONTMATTER_RE = re.compile(r"\A---\n(.*?)\n---\n", re.DOTALL)
RELATIVE_REF_RE = re.compile(r"(?:reference|templates)/[A-Za-z0-9_./-]+\.md")
REPO_REF_RE = re.compile(r"\.claude/plugins/sdd-suite/[A-Za-z0-9_./-]+\.md")
FRONTMATTER_SCALAR_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_-]*:\s+(?P<val>\S.*)$")
SEMVER_RE = re.compile(r"^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$")
MANIFEST_REQUIRED = ("name", "description", "version")
SKILL_REQUIRED_KEYS = ("name", "description")
DEP_NAME = "context-forge"
DEP_MARKETPLACE = "davcs86-agent-plugins"


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


def check_skill(skill_dir, repo_root, findings):
    skill_md = skill_dir / "SKILL.md"
    if not skill_md.is_file():
        findings.append(f"MISSING: {skill_md} does not exist")
        return
    match = FRONTMATTER_RE.match(skill_md.read_text(encoding="utf-8"))
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

    sources = [skill_md] + sorted((skill_dir / "reference").glob("*.md"))
    for source in sources:
        text = source.read_text(encoding="utf-8")
        # Repo-rooted cross-skill refs first; then strip them so their trailing
        # 'reference/...'/'templates/...' segment is not re-matched as a (wrong) relative ref.
        repo_refs = sorted(set(REPO_REF_RE.findall(text)))
        for ref in repo_refs:
            if not (repo_root / ref).is_file():
                findings.append(f"MISSING: {source} references '{ref}' (not found under repo root)")
        stripped = REPO_REF_RE.sub("", text)
        for ref in sorted(set(RELATIVE_REF_RE.findall(stripped))):
            if not (skill_dir / ref).is_file():
                findings.append(f"MISSING: {source} references '{ref}' (not found under {skill_dir})")


def check_dependency_integrity(plugin_root, claude_manifest, findings):
    """The declared cross-marketplace dependency and the root allowlist must agree."""
    deps = (claude_manifest or {}).get("dependencies", [])
    dep = None
    for d in deps:
        if isinstance(d, dict) and d.get("name") == DEP_NAME:
            dep = d
            break
        if isinstance(d, str) and d.split("@")[0] == DEP_NAME:
            dep = {"name": DEP_NAME, "marketplace": d.split("@")[1] if "@" in d else None}
            break
    if dep is None:
        findings.append(f"DEP: .claude-plugin/plugin.json does not declare a '{DEP_NAME}' dependency")
        return
    if dep.get("marketplace") != DEP_MARKETPLACE:
        findings.append(f"DEP: '{DEP_NAME}' dependency must name marketplace '{DEP_MARKETPLACE}', "
                        f"got {dep.get('marketplace')!r}")

    repo_root = plugin_root.parents[2]
    mp = repo_root / ".claude-plugin" / "marketplace.json"
    if not mp.is_file():
        findings.append(f"MISSING: {mp} (root marketplace) does not exist")
        return
    try:
        data = json.loads(mp.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        findings.append(f"ERROR: {mp} is not valid JSON ({exc})")
        return
    allow = data.get("allowCrossMarketplaceDependenciesOn", [])
    if DEP_MARKETPLACE not in allow:
        findings.append(f"DEP: root {mp} must list '{DEP_MARKETPLACE}' in "
                        f"allowCrossMarketplaceDependenciesOn (else the cross-marketplace "
                        f"dependency is blocked); got {allow!r}")


def check_marketplaces(plugin_root, findings):
    repo_root = plugin_root.parents[2]
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


def validate(plugin_root):
    findings = []
    repo_root = plugin_root.parents[2]
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
        check_skill(skill_dir, repo_root, findings)

    check_dependency_integrity(plugin_root, claude, findings)
    check_marketplaces(plugin_root, findings)
    return findings


def self_test():
    failures = []

    def expect(label, findings, needle):
        if not any(needle in f for f in findings):
            failures.append(f"self-test '{label}': expected '{needle}', got {findings}")

    with tempfile.TemporaryDirectory() as tmp:
        repo = Path(tmp)
        (repo / ".claude-plugin").mkdir(parents=True)
        (repo / ".cursor-plugin").mkdir(parents=True)
        # root marketplace WITHOUT the allowlist and WITHOUT registering the plugin:
        (repo / ".claude-plugin" / "marketplace.json").write_text(
            '{"name":"m","owner":{"name":"x"},"plugins":[]}', encoding="utf-8")
        root = repo / ".claude" / "plugins" / "sdd-suite"
        (root / ".claude-plugin").mkdir(parents=True)
        (root / ".cursor-plugin").mkdir(parents=True)
        # claude manifest: dependency present but WRONG marketplace; cursor: version drift
        (root / ".claude-plugin" / "plugin.json").write_text(
            '{"name":"sdd-suite","description":"d","version":"0.1.0",'
            '"dependencies":[{"name":"context-forge","marketplace":"wrong-mp"}]}', encoding="utf-8")
        (root / ".cursor-plugin" / "plugin.json").write_text(
            '{"name":"sdd-suite","description":"d","version":"0.2.0"}', encoding="utf-8")
        skill = root / "skills" / "sdd-x"
        skill.mkdir(parents=True)
        (skill / "SKILL.md").write_text(
            "---\nname: sdd-x\ndescription: Turn X into Y. Usage: run it\n---\n"
            "See `reference/missing.md`.\n", encoding="utf-8")
        findings = validate(root)
        expect("version parity", findings, "manifest versions differ")
        expect("colon-space yaml", findings, "YAML:")
        expect("dangling internal ref", findings, "reference/missing.md")
        expect("wrong dep marketplace", findings, "must name marketplace")
        expect("missing allowlist", findings, "allowCrossMarketplaceDependenciesOn")
        expect("not registered", findings, "has no entry named 'sdd-suite'")

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
