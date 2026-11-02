"""Python config-key read extraction for scripts/check-config-wiring.mjs (feature 278).

Usage: python3 -I scripts/config-wiring-py-reads.py <root> <forwarders-json>
Prints {"reads": [...], "dynamic": [...]} as JSON; stdlib only, never prints config values.
"""

import ast
import json
import sys
from pathlib import Path

GETTERS = frozenset(
    {"get_str", "get_int", "get_int_present", "get_bool", "get_float", "get_float_present", "get_str_present"}
)
SKIP_DIRS = frozenset({"tests", "test", "__pycache__", ".venv"})


def module_consts(tree):
    out = {}
    for node in tree.body:
        if isinstance(node, ast.Assign):
            targets, value = node.targets, node.value
        elif isinstance(node, ast.AnnAssign) and node.value is not None:
            targets, value = [node.target], node.value
        else:
            continue
        if isinstance(value, ast.Constant) and isinstance(value.value, str):
            for t in targets:
                if isinstance(t, ast.Name):
                    out[t.id] = value.value
    return out


class Reads(ast.NodeVisitor):
    def __init__(self, rel, consts, forwarders, own_defs):
        self.rel = rel
        self.consts = consts
        self.forwarders = forwarders
        self.own_defs = own_defs
        self.scope = []
        self.passthrough = [None]
        self.reads = []
        self.dynamic = []

    def _scoped(self, node, param=None):
        self.scope.append(node.name)
        self.passthrough.append(param)
        self.generic_visit(node)
        self.passthrough.pop()
        self.scope.pop()

    def visit_ClassDef(self, node):
        self._scoped(node, self.passthrough[-1])

    def visit_FunctionDef(self, node):
        param = None
        if node.name in self.own_defs:
            params = node.args.posonlyargs + node.args.args
            idx = self.own_defs[node.name]
            param = params[idx].arg if idx < len(params) else None
        self._scoped(node, param)

    visit_AsyncFunctionDef = visit_FunctionDef

    def _record(self, arg, line):
        if isinstance(arg, ast.Name) and arg.id == self.passthrough[-1]:
            return
        key = None
        if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
            key = arg.value
        elif isinstance(arg, ast.Name):
            key = self.consts.get(arg.id)
        if key is not None:
            self.reads.append({"file": self.rel, "line": line, "key": key})
        else:
            symbol = ".".join(self.scope) or "<module>"
            self.dynamic.append({"file": self.rel, "symbol": symbol, "line": line, "dynamic": True})

    def visit_Call(self, node):
        func = node.func
        callee = func.id if isinstance(func, ast.Name) else func.attr if isinstance(func, ast.Attribute) else None
        idx = None
        if callee in GETTERS:
            idx = 0
        elif callee in self.forwarders:
            idx = self.forwarders[callee]
        elif callee == "get" and isinstance(func.value, ast.Attribute) and func.value.attr == "values":
            idx = 0
        if idx is not None:
            kw = next((k.value for k in node.keywords if k.arg == "key"), None)
            arg = kw if kw is not None else node.args[idx] if idx < len(node.args) else None
            if arg is not None:
                self._record(arg, node.lineno)
        self.generic_visit(node)

    def visit_Subscript(self, node):
        if isinstance(node.ctx, ast.Load) and isinstance(node.value, ast.Attribute) and node.value.attr == "values":
            self._record(node.slice, node.lineno)
        self.generic_visit(node)


def main(root, forwarders):
    by_service = {}
    for f in forwarders:
        service = f["file"].split("/")[1]
        by_service.setdefault(service, {})[f["symbol"]] = f["keyArg"]
    reads, dynamic = [], []
    for path in sorted(Path(root, "services").glob("*/app/**/*.py")):
        rel = path.relative_to(root).as_posix()
        if SKIP_DIRS.intersection(rel.split("/")[2:]):
            continue
        service = rel.split("/")[1]
        own = {f["symbol"]: f["keyArg"] for f in forwarders if f["file"] == rel}
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=rel)
        visitor = Reads(rel, module_consts(tree), by_service.get(service, {}), own)
        visitor.visit(tree)
        reads += visitor.reads
        dynamic += visitor.dynamic
    json.dump({"reads": reads, "dynamic": dynamic}, sys.stdout)


if __name__ == "__main__":
    main(sys.argv[1], json.loads(sys.argv[2]) if len(sys.argv) > 2 else [])
