"""Feature 244 read-classification guard (design §7).

Every int/float/str config read in `app/` is either a plain read that honours a stored 0/""
(`HONOUR_KEYS`) or an FR-3 clamp that reads a stored value <= 0 as the default (`FR3_KEYS`).
A new read must be classified here, so a zero-sensitive key cannot slip back to an unclamped read.
"""

import ast
import re
from pathlib import Path

import pytest

TESTS_DIR = Path(__file__).resolve().parent
APP_DIR = TESTS_DIR.parent / "app"

# Getter signature defaults; the *_present aliases share them.
_READ_SIGNATURE_DEFAULTS = {"get_int": "0", "get_float": "0.0", "get_str": "''"}
READ_NAMES = frozenset(
    {*_READ_SIGNATURE_DEFAULTS, *(f"{n}_present" for n in _READ_SIGNATURE_DEFAULTS)}
)
CLAMP_NAMES = frozenset({"int_positive"})

FR3_KEYS = frozenset(
    {
        "indicators.sandbox.timeout_ms",
        "indicators.sandbox.memory_bytes",
        "indicators.sandbox.max_concurrent",
    }
)

HONOUR_KEYS = frozenset({"indicators.sandbox.allowed_imports"})

ZERO_IS_LEGIT: dict[str, str] = {}

_ZERO_SENSITIVE = re.compile(
    r"max_concurrent|timeout|interval|budget|max_universe|_per_cycle|_ms$|_seconds$"
)


def _bind(call: ast.Call, key_pos: int, default_pos: int):
    """Return (key_node, default_node); either is None when the call does not pass it."""
    if any(isinstance(a, ast.Starred) for a in call.args) or any(
        kw.arg is None for kw in call.keywords
    ):
        raise ValueError("starred/** arguments cannot be bound")
    kws = {kw.arg: kw.value for kw in call.keywords}
    key = call.args[key_pos] if len(call.args) > key_pos else kws.get("key")
    default = call.args[default_pos] if len(call.args) > default_pos else kws.get("default")
    return key, default


def collect(app_dir: Path):
    """Scan `app_dir` for config reads and clamps.

    Returns `(reads, clamps, errors)`: `reads`/`clamps` are lists of `(key, default_src, where)`,
    `errors` lists `where: reason` for every call whose key is not a bindable string constant.
    """
    reads, clamps, errors = [], [], []

    class _Visitor(ast.NodeVisitor):
        def __init__(self, where_prefix: str):
            self._where = where_prefix

        def _skip_def(self, node):
            if node.name in READ_NAMES or node.name in CLAMP_NAMES:
                return
            self.generic_visit(node)

        visit_FunctionDef = _skip_def
        visit_AsyncFunctionDef = _skip_def

        def visit_Call(self, node: ast.Call):
            where = f"{self._where}:{node.lineno}"
            func = node.func
            if isinstance(func, ast.Attribute) and func.attr in READ_NAMES:
                self._record(node, where, reads, 0, 1, func.attr.removesuffix("_present"))
            elif isinstance(func, ast.Name) and func.id in CLAMP_NAMES:
                self._record(node, where, clamps, 1, 2, None)
            self.generic_visit(node)

        def _record(self, node, where, sink, key_pos, default_pos, getter):
            try:
                key, default = _bind(node, key_pos, default_pos)
            except ValueError as e:
                errors.append(f"{where}: {e}")
                return
            if not (isinstance(key, ast.Constant) and isinstance(key.value, str)):
                errors.append(f"{where}: key is not a string constant")
                return
            if default is not None:
                default_src = ast.unparse(default)
            elif getter is not None:
                default_src = _READ_SIGNATURE_DEFAULTS[getter]
            else:
                errors.append(f"{where}: clamp call without a default")
                return
            sink.append((key.value, default_src, where))

    for path in sorted(app_dir.rglob("*.py")):
        tree = ast.parse(path.read_text(), filename=str(path))
        _Visitor(str(path.relative_to(app_dir.parent))).visit(tree)
    return reads, clamps, errors


@pytest.fixture(scope="module")
def scan():
    return collect(APP_DIR)


def test_rule1_every_key_is_a_bindable_constant(scan):
    _, _, errors = scan
    assert errors == []


def test_rule2_key_sets_match_classification(scan):
    reads, clamps, _ = scan
    read_keys = {k for k, _, _ in reads}
    clamp_keys = {k for k, _, _ in clamps}
    assert read_keys - HONOUR_KEYS == set(), "unclassified plain reads"
    assert HONOUR_KEYS - read_keys == set(), "HONOUR_KEYS entries no longer read"
    assert clamp_keys - FR3_KEYS == set(), "unclassified clamp reads"
    assert FR3_KEYS - clamp_keys == set(), "FR3_KEYS entries no longer clamped"


def test_rule3_read_and_clamp_sets_are_disjoint(scan):
    reads, clamps, _ = scan
    assert {k for k, _, _ in reads} & {k for k, _, _ in clamps} == set()


def test_rule4_each_key_has_one_default(scan):
    reads, clamps, _ = scan
    defaults: dict[str, set[str]] = {}
    for key, default_src, _ in reads + clamps:
        defaults.setdefault(key, set()).add(default_src)
    assert {k: d for k, d in defaults.items() if len(d) > 1} == {}


def test_rule5_zero_sensitive_honour_keys_are_justified():
    sensitive = {k for k in HONOUR_KEYS if _ZERO_SENSITIVE.search(k)}
    assert sensitive - ZERO_IS_LEGIT.keys() == set()
    assert ZERO_IS_LEGIT.keys() - HONOUR_KEYS == set()


def test_rule6_every_fr3_key_has_a_test_literal():
    this_file = Path(__file__).resolve()
    corpus = "\n".join(
        p.read_text() for p in sorted(TESTS_DIR.glob("*.py")) if p.resolve() != this_file
    )
    assert {k for k in FR3_KEYS if f'"{k}"' not in corpus} == set()
