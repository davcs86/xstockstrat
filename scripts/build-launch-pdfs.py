#!/usr/bin/env python3
"""Build the launch PDFs from docs/launch-pdfs/*.md using markdown_pdf."""

import sys
from pathlib import Path
from markdown_pdf import MarkdownPdf, Section

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "docs" / "launch-pdfs"

CSS = """
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
       font-size: 11pt; line-height: 1.5; color: #1f2328; }
h1 { font-size: 22pt; border-bottom: 2px solid #d0d7de; padding-bottom: 6pt; margin-top: 18pt; }
h2 { font-size: 15pt; border-bottom: 1px solid #d0d7de; padding-bottom: 4pt; margin-top: 16pt; }
h3 { font-size: 13pt; margin-top: 12pt; }
table { border-collapse: collapse; margin: 8pt 0; width: 100%; }
th, td { border: 1px solid #d0d7de; padding: 4pt 8pt; text-align: left; vertical-align: top; }
th { background: #f6f8fa; font-weight: 600; }
code { background: #f6f8fa; padding: 1pt 4pt; border-radius: 3pt;
       font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 9.5pt; }
pre { background: #f6f8fa; padding: 8pt; border-radius: 4pt; overflow-x: auto;
      font-size: 9pt; line-height: 1.4; }
pre code { background: transparent; padding: 0; }
blockquote { border-left: 3pt solid #d0d7de; padding-left: 10pt; color: #57606a; margin: 8pt 0; }
hr { border: none; border-top: 1px solid #d0d7de; margin: 14pt 0; }
"""


def build(slug: str, title: str) -> Path:
    src = SRC / f"{slug}.md"
    out = SRC / f"{slug}.pdf"
    pdf = MarkdownPdf(toc_level=2, optimize=True)
    pdf.meta["title"] = title
    pdf.meta["author"] = "xstockstrat"
    pdf.add_section(Section(src.read_text(encoding="utf-8"), toc=True), user_css=CSS)
    pdf.save(out)
    return out


def main():
    targets = [
        ("sdd-flow", "Spec-Driven Development on xstockstrat"),
        ("product-features", "xstockstrat — Product Features"),
        ("infra-ci", "xstockstrat — CI and Local/Cloud Infrastructure"),
    ]
    requested = sys.argv[1:] or [t[0] for t in targets]
    for slug, title in targets:
        if slug not in requested:
            continue
        if not (SRC / f"{slug}.md").exists():
            print(f"[skip] {slug}.md not found")
            continue
        out = build(slug, title)
        size_kb = out.stat().st_size / 1024
        print(f"[ok]   {out.relative_to(ROOT)}  ({size_kb:.1f} KB)")


if __name__ == "__main__":
    main()
