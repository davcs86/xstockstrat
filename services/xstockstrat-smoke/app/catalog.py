"""Loads the check catalog from the top-level `checks` package; a module that fails the AST lint
or fails to import becomes a load error instead of crashing the service."""

import ast
import hashlib
import importlib
import inspect
import pathlib
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

from app.check_api import CHECKS_API_VERSION

BANNED_IMPORTS = frozenset({"os", "subprocess", "socket", "grpc", "asyncpg", "importlib"})
BANNED_CALLS = frozenset({"time.sleep", "__import__"})
_DEFINITIONS = (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Import, ast.ImportFrom)


@dataclass(frozen=True)
class Check:
    id: str
    feature: str
    part: str
    timeout_s: float
    run: Callable[..., Awaitable[None]]
    check_hash: str


@dataclass(frozen=True)
class LoadError:
    module: str
    error: str


@dataclass
class Catalog:
    checks: dict[str, Check] = field(default_factory=dict)
    load_errors: list[LoadError] = field(default_factory=list)


def check_hash(fn) -> str:
    source = f"{CHECKS_API_VERSION}\n" + inspect.getsource(fn)
    return hashlib.sha256(source.encode()).hexdigest()


def from_function(fn) -> Check:
    meta = fn.__smoke_check__
    return Check(meta.id, meta.feature, meta.part, meta.timeout_s, fn, check_hash(fn))


def lint_source(source: str, module: str) -> list[str]:
    """Problems that make a check module unsafe to import into the shared event loop."""
    problems = []
    tree = ast.parse(source)
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names = [a.name for a in node.names]
        elif isinstance(node, ast.ImportFrom):
            names = [node.module or ""]
            if node.module == "time" and any(a.name == "sleep" for a in node.names):
                problems.append(f"{module}:{node.lineno}: import time.sleep")
        else:
            names = []
        for name in names:
            if name.split(".")[0] in BANNED_IMPORTS:
                problems.append(f"{module}:{node.lineno}: import {name.split('.')[0]}")
        if isinstance(node, ast.Call) and ast.unparse(node.func) in BANNED_CALLS:
            problems.append(f"{module}:{node.lineno}: blocking call {ast.unparse(node.func)}")
    for stmt in tree.body:
        if isinstance(stmt, _DEFINITIONS):
            continue
        for node in ast.walk(stmt):
            if isinstance(node, ast.Call):
                problems.append(f"{module}:{node.lineno}: top-level call {ast.unparse(node.func)}")
    return problems


def _module_name(package: str, root: pathlib.Path, path: pathlib.Path) -> str:
    parts = path.relative_to(root).with_suffix("").parts
    if parts[-1] == "__init__":
        parts = parts[:-1]
    return ".".join((package, *parts))


def load_catalog(package: str = "checks") -> Catalog:
    catalog = Catalog()
    root = pathlib.Path(importlib.import_module(package).__file__).parent
    blocked: list[pathlib.Path] = []
    for path in sorted(root.rglob("*.py")):
        module = _module_name(package, root, path)
        if any(b in path.parents for b in blocked):
            continue
        try:
            problems = lint_source(path.read_text(), module)
            if problems:
                raise ValueError("lint: " + "; ".join(problems))
            if path.name == "__init__.py":
                continue
            mod = importlib.import_module(module)
        except Exception as e:  # noqa: BLE001 — any failure is a load error, never a crash
            catalog.load_errors.append(LoadError(module, f"{type(e).__name__}: {e}"))
            if path.name == "__init__.py":
                blocked.append(path.parent)
            continue
        for fn in vars(mod).values():
            if getattr(fn, "__smoke_check__", None) is None or fn.__module__ != module:
                continue
            c = from_function(fn)
            if c.id in catalog.checks:
                catalog.load_errors.append(
                    LoadError(
                        module,
                        f"duplicate check id {c.id} (first: {catalog.checks[c.id].run.__module__})",
                    )
                )
                continue
            catalog.checks[c.id] = c
    return catalog
