"""CI lint over check modules: `python -m tools.lint_checks <dir>` exits 1 naming each problem."""

import pathlib
import sys

from app.catalog import lint_source


def main(argv: list[str]) -> int:
    problems = []
    for root in map(pathlib.Path, argv or ["checks"]):
        for path in sorted(root.rglob("*.py")):
            module = ".".join((root.name, *path.relative_to(root).with_suffix("").parts))
            try:
                problems += lint_source(path.read_text(), module)
            except SyntaxError as e:
                problems.append(f"{module}:{e.lineno}: SyntaxError {e.msg}")
    for p in problems:
        print(p)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
