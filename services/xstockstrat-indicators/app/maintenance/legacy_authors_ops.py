"""Operator workflow for the legacy-author repair: report -> confirm -> apply.

Runs in the indicators image (DO console) or locally with only asyncpg + the stdlib:
    python -m app.maintenance.legacy_authors_ops report
    python -m app.maintenance.legacy_authors_ops confirm
    python -m app.maintenance.legacy_authors_ops apply --confirm-digest <sha256 from confirm>
Runbook: docs/runbooks/legacy-formula-authors.md. A console filesystem does not survive the restart
the runbook requires after apply, so `apply` echoes the full result to stdout.
"""

import argparse
import asyncio
import json
import os
import sys
import tempfile
import uuid
from pathlib import Path
from urllib.parse import urlsplit

from app.maintenance import legacy_authors as la

DEFAULT_WORK_DIR = Path(tempfile.gettempdir()) / "legacy-authors"
# identity.users shares the database (runbook §4); only the email local part leaves this module.
USERS_SQL = "SELECT user_id, email, is_active FROM identity.users ORDER BY created_at"
_UNRESOLVED = la.APPLY_STATUSES - {"confirmed"}
_PICK_ATTEMPTS = 3


def _write_private(path: Path, text: str) -> None:
    path.write_text(text)
    path.chmod(0o600)


def _work_dir(path) -> Path:
    work = Path(path)
    work.mkdir(mode=0o700, parents=True, exist_ok=True)
    return work


def _load_plan(path: Path) -> dict:
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError) as exc:
        raise SystemExit(f"cannot read plan {path}: {exc} (run `report` first)") from exc


def _users_by_id(path: Path) -> dict:
    try:
        return {u["user_id"]: u["email_local"] for u in json.loads(path.read_text())}
    except (OSError, ValueError, KeyError, TypeError):
        return {}


def format_plan(plan: dict, users: dict) -> str:
    lines = [f"plan {plan.get('run_id', '?')} target={plan.get('target')}"]
    for e in plan["entries"]:
        new = e.get("new_author")
        who = f"{users.get(new, '?')} ({new})" if new else "-"
        lines.append(f"  {e['formula_id']}  {e['old_author']} -> {who}  [{e['status']}]")
    lines.append(f"counts {plan.get('counts')}")
    return "\n".join(lines)


async def export_users(conn) -> list[dict]:
    rows = await conn.fetch(USERS_SQL)
    return [
        {
            "user_id": str(r["user_id"]),
            "email_local": r["email"].split("@", 1)[0],
            "is_active": bool(r["is_active"]),
        }
        for r in rows
    ]


async def report(conn, target, work: Path, *, users_file=None, run_id=None) -> dict:
    run_id = run_id or str(uuid.uuid4())
    users_path, plan_path = work / "users.json", work / "plan.json"
    if users_file:
        _write_private(users_path, Path(users_file).read_text())
    else:
        _write_private(users_path, json.dumps(await export_users(conn)))
    plan = await la.run_report(
        conn, la.load_users(users_path), plan_path, run_id=run_id, target=target
    )
    plan_path.chmod(0o600)
    print(format_plan(plan, _users_by_id(users_path)))
    return plan


def _candidates(author: str, users: dict) -> list[str]:
    # Must mirror la.classify's candidate rule (legacy_authors.py is frozen, FR-7); parity-tested.
    return [
        uid
        for uid, u in users.items()
        if u["is_active"] and u["email_local"].lower() == author.lower()
    ]


def _parse_maps(maps, unresolved: list[dict], users: dict) -> tuple[dict, list[str]]:
    mapping: dict[str, str] = {}
    reasons: list[str] = []
    for raw in maps:
        author, sep, uid = raw.rpartition("=")
        rows = [e for e in unresolved if e["old_author"] == author]
        if not (sep and author and uid):
            reasons.append(f"--map {raw}: expected LEGACY_AUTHOR=USER_ID")
        elif not la.is_uuid(uid):
            reasons.append(f"--map {raw}: {uid!r} is not a user id (UUID)")
        elif uid not in users:
            reasons.append(f'--map "{author}": user {uid} is not in users.json')
        elif not users[uid]["is_active"]:
            reasons.append(f'--map "{author}": user {uid} is inactive')
        elif not rows:
            reasons.append(f'no unresolved row has old_author "{author}"')
        elif any(e["status"] == "ambiguous" for e in rows) and uid not in _candidates(
            author, users
        ):
            reasons.append(f'user {uid} is not a candidate for "{author}"')
        elif mapping.get(author, uid) != uid:
            reasons.append(f'"{author}" is mapped to two different users')
        else:
            mapping[author] = uid
    return mapping, reasons


def _pick(unresolved: list[dict], chosen: dict, users: dict, ask) -> dict:
    groups: dict[str, list[dict]] = {}
    for e in unresolved:
        if e["old_author"] not in chosen:
            groups.setdefault(e["old_author"], []).append(e)
    picks: dict[str, str] = {}
    for author, rows in groups.items():
        ambiguous = any(e["status"] == "ambiguous" for e in rows)
        options = (
            _candidates(author, users)
            if ambiguous
            else [uid for uid, u in users.items() if u["is_active"]]
        )
        if not options:
            print(f'Skipped: there is no eligible user for "{author}".')
            continue
        kind = "ambiguous" if ambiguous else "unmappable"
        print(f'"{author}": {len(rows)} {kind} row(s) - choose its owner:')
        for i, uid in enumerate(options, 1):
            print(f"  {i}) {users[uid]['email_local']} ({uid})")
        for _ in range(_PICK_ATTEMPTS):
            try:
                answer = (
                    ask(f'Owner for "{author}" [1-{len(options)}, s to skip]: ').strip().lower()
                )
            except EOFError:
                return picks
            if answer in ("", "s"):
                break
            if answer.isdecimal() and 1 <= int(answer) <= len(options):
                picks[author] = options[int(answer) - 1]
                break
        else:
            print(f'No valid answer for "{author}" after {_PICK_ATTEMPTS} attempts; skipped.')
    return picks


def confirm(work: Path, *, yes: bool, ask=input) -> tuple[int, str | None]:
    plan_path = work / "plan.json"
    plan = _load_plan(plan_path)
    suggested = [e for e in plan["entries"] if e["status"] == "suggested"]
    if not suggested:
        print("No suggested rows to confirm.")
        return 0, None
    print(format_plan(plan, _users_by_id(work / "users.json")))
    if not yes:
        try:
            answer = ask(f"Confirm {len(suggested)} suggested rewrite(s)? [y/N] ")
        except EOFError:
            answer = ""
        if answer.strip().lower() not in ("y", "yes"):
            return 0, None
    for e in suggested:
        e["status"] = "confirmed"
    _write_private(plan_path, json.dumps(plan, indent=2) + "\n")
    return len(suggested), la.plan_digest(plan_path)


async def apply(conn, target, work: Path, digest: str, *, run_id=None) -> dict:
    run_id = run_id or str(uuid.uuid4())
    plan_path = work / "plan.json"
    result = await la.run_apply(
        conn, la.load_users(work / "users.json"), plan_path, digest, run_id=run_id, target=target
    )
    result_path = plan_path.with_suffix(".result.json")
    result_path.chmod(0o600)  # run_apply writes it world-readable; it holds PII
    print(f"\n=== {result_path.name}: copy into the change record BEFORE any restart ===")
    print(result_path.read_text())
    return result


def _confirmed_count(plan: dict) -> int:
    return sum(1 for e in plan["entries"] if e["status"] == "confirmed")


async def _with_conn(run_id: str, fn):
    conn, target = await la.connect(run_id=run_id)
    try:
        return await fn(conn, target)
    finally:
        await conn.close()


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.maintenance.legacy_authors_ops")
    parser.add_argument("--work-dir", default=str(DEFAULT_WORK_DIR))
    sub = parser.add_subparsers(dest="cmd", required=True)
    p_report = sub.add_parser("report", help="export users, run the read-only report")
    p_report.add_argument("--users", help="use this users JSON instead of reading identity.users")
    for name in ("confirm", "apply"):
        p = sub.add_parser(name)
        p.add_argument("--yes", "-y", action="store_true", help="skip the prompt")
    sub.choices["apply"].add_argument("--confirm-digest", required=True)
    args = parser.parse_args(argv)
    work, run_id = _work_dir(args.work_dir), str(uuid.uuid4())

    if args.cmd == "confirm":
        n, digest = confirm(work, yes=args.yes)
        if digest:
            print(f"\nConfirmed {n} row(s). Record this digest in the DBA change record:")
            print(f"  {digest}\n\nThen: apply --confirm-digest {digest}")
        return 0 if digest or n == 0 else 1

    if args.cmd == "report":
        asyncio.run(
            _with_conn(
                run_id,
                lambda c, t: report(c, t, work, users_file=args.users, run_id=run_id),
            )
        )
        print(f"\nNext: review, then `confirm` (work dir: {work})")
        return 0

    plan = _load_plan(work / "plan.json")
    url = urlsplit(os.environ.get("DATABASE_URL", ""))
    print(
        f"Plan target {plan.get('target')}; connecting to host={url.hostname} "
        f"db={url.path.lstrip('/')}; {_confirmed_count(plan)} confirmed row(s)."
    )
    if not args.yes and input("Apply to this database? [y/N] ").strip().lower() not in ("y", "yes"):
        return 1
    try:
        asyncio.run(
            _with_conn(
                run_id,
                lambda c, t: apply(c, t, work, args.confirm_digest, run_id=run_id),
            )
        )
    except la.ApplyRefused as exc:
        for reason in exc.reasons:
            la.log(run_id, f"refused: {reason}")
        return la.ApplyRefused.exit_code
    print("Now restart every indicators instance and verify as the owner (runbook §8).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
