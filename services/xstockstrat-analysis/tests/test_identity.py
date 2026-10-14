"""Feature 225 — ``app.identity.owner_metadata`` is the only builder of an owner ``x-user-id``
2-tuple in analysis (FR-1 addendum): it fails closed on an empty or ``system`` owner."""

import ast
import pathlib

import pytest

_APP = pathlib.Path(__file__).resolve().parents[1] / "app"
_IDENTITY = _APP / "identity.py"


def test_owner_metadata_rejects_empty_and_system_and_builds_owner():
    from app.identity import owner_metadata

    for bad in ("", "system"):
        with pytest.raises(ValueError):
            owner_metadata(bad)
    assert owner_metadata("bob") == [("x-user-id", "bob")]


def test_single_owner_header_builder():
    offenders = []
    for path in sorted(_APP.rglob("*.py")):
        if path == _IDENTITY:
            continue
        for node in ast.walk(ast.parse(path.read_text(), filename=str(path))):
            if not (isinstance(node, ast.Tuple) and len(node.elts) == 2):
                continue
            key, value = node.elts
            if not (isinstance(key, ast.Constant) and key.value == "x-user-id"):
                continue
            if isinstance(value, ast.Name) and value.id == "SYSTEM_IDENTITY":
                continue
            offenders.append(f"{path.relative_to(_APP.parent)}:{node.lineno}")
    assert not offenders, f"hand-built owner x-user-id tuples (use owner_metadata): {offenders}"


def test_identity_imports_nothing_from_app():
    tree = ast.parse(_IDENTITY.read_text())
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            assert node.module and not node.module.startswith("app"), node.module
        elif isinstance(node, ast.Import):
            assert not any(a.name.startswith("app") for a in node.names), node.names
