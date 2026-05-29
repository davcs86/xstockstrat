#!/usr/bin/env python3
"""Build the launch PDFs from docs/launch-pdfs/*.md using markdown + WeasyPrint.

WeasyPrint produces standards-compliant PDF/A-compatible output that opens
cleanly in every modern viewer, unlike PyMuPDF-rendered PDFs which some
viewers refuse to open.
"""

import sys
from pathlib import Path
import markdown
from weasyprint import HTML, CSS

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "docs" / "launch-pdfs"

CSS_TEXT = """
@page {
  size: Letter;
  margin: 0.75in 0.7in 0.85in 0.7in;
  @bottom-center {
    content: counter(page) " / " counter(pages);
    font-family: -apple-system, "Segoe UI", Helvetica, sans-serif;
    font-size: 8pt;
    color: #57606a;
  }
}
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  font-size: 10.5pt;
  line-height: 1.5;
  color: #1f2328;
}
h1 {
  font-size: 22pt;
  border-bottom: 2px solid #d0d7de;
  padding-bottom: 6pt;
  margin-top: 0;
  page-break-after: avoid;
}
h2 {
  font-size: 15pt;
  border-bottom: 1px solid #d0d7de;
  padding-bottom: 4pt;
  margin-top: 18pt;
  page-break-after: avoid;
}
h3 {
  font-size: 12.5pt;
  margin-top: 14pt;
  page-break-after: avoid;
}
h4 {
  font-size: 11pt;
  margin-top: 10pt;
  page-break-after: avoid;
}
p, ul, ol {
  margin: 6pt 0;
}
ul, ol {
  padding-left: 22pt;
}
li {
  margin: 2pt 0;
}
table {
  border-collapse: collapse;
  margin: 10pt 0;
  width: 100%;
  page-break-inside: avoid;
  font-size: 9.5pt;
}
th, td {
  border: 1px solid #d0d7de;
  padding: 5pt 8pt;
  text-align: left;
  vertical-align: top;
}
th {
  background: #f6f8fa;
  font-weight: 600;
}
code {
  background: #f6f8fa;
  padding: 1pt 4pt;
  border-radius: 3pt;
  font-family: "SF Mono", Menlo, Consolas, monospace;
  font-size: 9pt;
}
pre {
  background: #f6f8fa;
  padding: 9pt 11pt;
  border-radius: 4pt;
  border: 1px solid #d0d7de;
  overflow-x: auto;
  font-size: 8.5pt;
  line-height: 1.4;
  page-break-inside: avoid;
}
pre code {
  background: transparent;
  padding: 0;
  font-size: inherit;
}
blockquote {
  border-left: 3pt solid #d0d7de;
  padding: 4pt 12pt;
  color: #57606a;
  margin: 10pt 0;
  background: #f6f8fa;
}
hr {
  border: none;
  border-top: 1px solid #d0d7de;
  margin: 16pt 0;
}
a {
  color: #0969da;
  text-decoration: none;
}
strong { font-weight: 600; }
"""

MD_EXTENSIONS = ["extra", "tables", "fenced_code", "sane_lists", "toc"]


def build(slug: str, title: str) -> Path:
    src = SRC / f"{slug}.md"
    out = SRC / f"{slug}.pdf"
    md_text = src.read_text(encoding="utf-8")
    body_html = markdown.markdown(md_text, extensions=MD_EXTENSIONS, output_format="html5")
    full_html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{title}</title>
</head>
<body>
{body_html}
</body>
</html>"""
    HTML(string=full_html, base_url=str(SRC)).write_pdf(
        target=str(out),
        stylesheets=[CSS(string=CSS_TEXT)],
    )
    return out


def main():
    targets = [
        ("sdd-flow", "Spec-Driven Development on xstockstrat"),
        ("sdd-lifecycle", "xstockstrat — SDD Feature Lifecycle (Status Transitions)"),
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
