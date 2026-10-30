"""Run-file writer and the orphan-branch pusher (git CLI; never forces)."""

import json
import pathlib
import subprocess
from datetime import UTC, datetime

BRANCH = "smoke-results"
SCHEMA = pathlib.Path(__file__).resolve().parents[2] / "schema" / "run-file.v1.json"


class PushError(Exception):
    pass


def record_path(env: str, started_at: str, run_id: str) -> str:
    ts = datetime.fromisoformat(started_at).astimezone(UTC)
    return f"smoke-results/{env}/{ts:%Y%m%dT%H%M%SZ}-{run_id}.json"


def write_run_file(out_dir, body: dict) -> pathlib.Path:
    try:
        import jsonschema  # dev-only dependency; the runtime image stays stdlib-only
    except ImportError:
        jsonschema = None
    if jsonschema is not None:
        jsonschema.validate(body, json.loads(SCHEMA.read_text()))
    path = pathlib.Path(out_dir) / record_path(body["env"], body["started_at"], body["run_id"])
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "x") as f:
        json.dump(body, f, indent=2)
    return path


def _git(repo, *args, check=True):
    cmd = [
        "git", "-C", str(repo), "-c", "user.name=xstockstrat-smoke-recorder",
        "-c", "user.email=smoke-recorder@xstockstrat.invalid", *args,
    ]  # fmt: skip
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if check and p.returncode:
        raise PushError(f"git {args[0]} failed: {p.stderr.strip()}")
    return p


def _fetch(repo):
    _git(repo, "fetch", "-q", "origin", f"+refs/heads/{BRANCH}:refs/remotes/origin/{BRANCH}")


def checkout_results(repo, remote: str) -> None:
    """Make repo a working copy of the results branch (unborn if the remote has none)."""
    repo = pathlib.Path(repo)
    repo.mkdir(parents=True, exist_ok=True)
    if not (repo / ".git").exists():
        _git(repo, "init", "-q")
        _git(repo, "remote", "add", "origin", remote)
    ls = _git(repo, "ls-remote", "--exit-code", "--heads", "origin", BRANCH, check=False)
    if ls.returncode == 0:
        _fetch(repo)
        _git(repo, "checkout", "-q", "-B", BRANCH, f"origin/{BRANCH}")
    elif ls.returncode != 2:
        raise PushError(f"git ls-remote failed: {ls.stderr.strip()}")


def _ensure_branch(repo):
    def has(ref):
        return _git(repo, "rev-parse", "-q", "--verify", ref, check=False).returncode == 0

    if has(f"refs/heads/{BRANCH}"):
        _git(repo, "checkout", "-q", BRANCH)
    elif has(f"refs/remotes/origin/{BRANCH}"):
        _git(repo, "checkout", "-q", "-B", BRANCH, f"origin/{BRANCH}")
    else:
        _git(repo, "symbolic-ref", "HEAD", f"refs/heads/{BRANCH}")
        _git(repo, "read-tree", "--empty")


def push_with_retry(repo_dir, paths, *, attempts=5) -> None:
    _ensure_branch(repo_dir)
    _git(repo_dir, "add", "--", *map(str, paths))
    _git(repo_dir, "commit", "-q", "-m", "smoke: record run")
    for _ in range(attempts):
        if _git(repo_dir, "push", "-q", "origin", BRANCH, check=False).returncode == 0:
            return
        _fetch(repo_dir)
        if _git(repo_dir, "rebase", "-q", f"origin/{BRANCH}", check=False).returncode:
            _git(repo_dir, "rebase", "--abort", check=False)
            raise PushError("rebase onto the remote results branch failed")
    raise PushError(f"push still rejected after {attempts} attempts")
