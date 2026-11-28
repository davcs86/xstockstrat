"""Feature 367 handler database contract (design.md § Handler database contract) for `app/jobs/`."""

import ast
from pathlib import Path

import pytest

JOBS_DIR = Path(__file__).resolve().parent.parent / "app" / "jobs"

_FORBIDDEN_NAMES = {"db_pool", "control_pool"}
_FORBIDDEN_CATCH = {"BaseException", "CancelledError", "AttemptStopped"}


def _name(node) -> str | None:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return node.attr
    return None


def _dotted(node) -> str:
    if isinstance(node, ast.Attribute):
        return f"{_dotted(node.value)}.{node.attr}"
    return _name(node) or ""


def _is_db_call(node) -> bool:
    return isinstance(node, ast.Call) and _name(node.func) == "db"


def _contains_db(node) -> bool:
    return any(_is_db_call(n) for n in ast.walk(node))


def _awaits_in(body):
    """Awaits in a block body, not descending into nested function definitions."""
    stack = list(body)
    while stack:
        node = stack.pop()
        if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef | ast.Lambda):
            continue
        if isinstance(node, ast.Await):
            yield node
        stack.extend(ast.iter_child_nodes(node))


def violations(source: str) -> list[str]:
    tree = ast.parse(source)
    found: list[str] = []

    for node in ast.walk(tree):
        line = getattr(node, "lineno", 0)
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name.split(".")[0] == "asyncpg":
                    found.append(f"{line}: asyncpg import")
                if alias.name in ("app.repositories.read_budget", "app.repositories.pipeline_jobs"):
                    found.append(f"{line}: import of {alias.name}")
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            names = {a.name for a in node.names}
            if module.split(".")[0] == "asyncpg":
                found.append(f"{line}: asyncpg import")
            if module == "app.repositories.read_budget":
                found.append(f"{line}: import from app.repositories.read_budget")
            if module == "app.repositories.pipeline_jobs" and names - {"prune_batch"}:
                found.append(f"{line}: import from pipeline_jobs other than prune_batch")
            if module == "app.repositories" and names & {"read_budget", "pipeline_jobs"}:
                found.append(f"{line}: import of a job-graph repository module")
        elif isinstance(node, ast.Call) and _name(node.func) == "acquire":
            found.append(f"{line}: .acquire( call")
        elif isinstance(node, ast.Name | ast.Attribute) and _name(node) in _FORBIDDEN_NAMES:
            found.append(f"{line}: name {_name(node)}")
        elif isinstance(node, ast.ExceptHandler):
            if node.type is None:
                found.append(f"{line}: bare except")
            else:
                caught = node.type.elts if isinstance(node.type, ast.Tuple) else [node.type]
                for c in caught:
                    if _name(c) in _FORBIDDEN_CATCH:
                        found.append(f"{line}: catches {_name(c)}")
        if isinstance(node, ast.Attribute) and _dotted(node) == "asyncio.shield":
            found.append(f"{line}: asyncio.shield")
        if isinstance(node, ast.Call) and _name(node.func) == "wait_for" and _contains_db(node):
            found.append(f"{line}: wait_for around a .db( block")
        if isinstance(node, ast.AsyncWith):
            items = [i.context_expr for i in node.items]
            if any(isinstance(e, ast.Call) and _name(e.func) == "timeout" for e in items) and any(
                _contains_db(n) for n in node.body
            ):
                found.append(f"{line}: asyncio.timeout around a .db( block")
            for item in node.items:
                if _is_db_call(item.context_expr):
                    conn = (
                        item.optional_vars.id if isinstance(item.optional_vars, ast.Name) else None
                    )
                    for aw in _awaits_in(node.body):
                        call = aw.value
                        on_conn = (
                            isinstance(call, ast.Call)
                            and isinstance(call.func, ast.Attribute)
                            and isinstance(call.func.value, ast.Name)
                            and call.func.value.id == conn
                        )
                        passes_conn = isinstance(call, ast.Call) and any(
                            k.arg == "conn" for k in call.keywords
                        )
                        if not (on_conn or passes_conn):
                            found.append(f"{aw.lineno}: await inside job.db() not on conn")
    return found


_COMPLIANT = """
from app.engine.job_graph import Succeeded
from app.repositories.pipeline_jobs import prune_batch

async def handler(job):
    async with job.db(30) as conn:
        await conn.fetchval("SELECT 1")
        await prune_batch(conn=conn, state="succeeded", older_than_days=7)
    try:
        int("1")
    except ValueError:
        pass
    return Succeeded()
"""

_OFFENDING = {
    "asyncpg import": "import asyncpg\n",
    "asyncpg from-import": "from asyncpg import exceptions\n",
    "acquire": "async def h(job, pool):\n    await pool.acquire()\n",
    "db_pool": "def h(svc):\n    return svc.db_pool\n",
    "control_pool": "control_pool = None\n",
    "read_budget": "from app.repositories.read_budget import bounded_txn\n",
    "pipeline_jobs": "from app.repositories.pipeline_jobs import PipelineJobsRepository\n",
    "BaseException": "try:\n    pass\nexcept BaseException:\n    pass\n",
    "CancelledError": "import asyncio\ntry:\n    pass\nexcept asyncio.CancelledError:\n    pass\n",
    "AttemptStopped": "try:\n    pass\nexcept (ValueError, AttemptStopped):\n    pass\n",
    "bare except": "try:\n    pass\nexcept:\n    pass\n",
    "shield": "import asyncio\nasync def h(c):\n    await asyncio.shield(c)\n",
    "timeout around db": (
        "import asyncio\nasync def h(job):\n    async with asyncio.timeout(5):\n"
        "        async with job.db(5) as conn:\n            await conn.fetchval('x')\n"
    ),
    "wait_for around db": (
        "import asyncio\nasync def h(job):\n    await asyncio.wait_for(job.db(5).__aenter__(), 5)\n"
    ),
    "foreign await in db": (
        "import asyncio\nasync def h(job):\n    async with job.db(5) as conn:\n"
        "        await asyncio.sleep(1)\n"
    ),
}


def test_the_compliant_source_passes():
    assert violations(_COMPLIANT) == []


@pytest.mark.parametrize("rule", sorted(_OFFENDING))
def test_each_rule_fires_on_its_offending_source(rule):
    assert violations(_OFFENDING[rule]) != [], rule


@pytest.mark.parametrize("path", sorted(JOBS_DIR.rglob("*.py")), ids=lambda p: p.name)
def test_every_handler_module_honours_the_contract(path):
    assert violations(path.read_text()) == []
