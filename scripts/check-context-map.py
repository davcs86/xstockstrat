#!/usr/bin/env python3
"""Validate the AI-tooling context map and the doc references around it.

Usage: check-context-map.py
1. Every concrete path in .claude/context-map.yaml must exist.
2. Every docs/*.md or .claude/**/*.md reference in CLAUDE.md files, skill routers, skill reference
   files and agent definitions must resolve.
Placeholder paths (containing <, ..., path/to, exact/ or *) are skipped. Exit 0 = all resolve, 1 = not.
"""

import os
import re
import sys

MAP = ".claude/context-map.yaml"
MAP_REF = re.compile(
    r"(?:\.claude|docs|scripts)/[A-Za-z0-9._/<>-]+\.(?:md|ya?ml|sh|py|m?js)"
)
DOC_REF = re.compile(r"(?:\.claude|docs)/[A-Za-z0-9._/-]+\.md")
URL = re.compile(r"https?://[^\s)]*")
PLACEHOLDER_MARKS = ("<", "...", "path/to", "exact/", "*")


def is_placeholder(path):
    return any(mark in path for mark in PLACEHOLDER_MARKS)


def source_files(root):
    """CLAUDE.md files, skill routers and reference files, and agent definitions under root."""
    found = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in ("node_modules", ".git")]
        rel = os.path.relpath(dirpath, root).replace(os.sep, "/")
        for name in filenames:
            in_skills = rel == ".claude/skills" or rel.startswith(".claude/skills/")
            in_agents = rel == ".claude/agents" or rel.startswith(".claude/agents/")
            if (
                name == "CLAUDE.md"
                or (in_skills and name == "SKILL.md")
                or (in_skills and name.endswith(".md") and rel.endswith("/reference"))
                or (in_agents and name.endswith(".md"))
            ):
                found.append(os.path.join(dirpath, name))
    return found


def references(root):
    """Every path the map and the source files point at, placeholders included."""
    with open(os.path.join(root, MAP), encoding="utf-8") as f:
        refs = set(MAP_REF.findall(f.read()))
    for path in source_files(root):
        with open(path, encoding="utf-8") as f:
            refs.update(DOC_REF.findall(URL.sub("", f.read())))
    return refs


def missing(root):
    return sorted(
        ref
        for ref in references(root)
        if not is_placeholder(ref) and not os.path.exists(os.path.join(root, ref))
    )


def main(root=None):
    root = root or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if not os.path.isfile(os.path.join(root, MAP)):
        print(f"MISSING: {MAP}")
        return 1
    gone = missing(root)
    for ref in gone:
        print(f"  MISSING: {ref}")
    if gone:
        print(
            "FAILED - fix the MISSING references above (or mark them as placeholders)."
        )
        return 1
    print("OK - all context-map and doc references resolve.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
