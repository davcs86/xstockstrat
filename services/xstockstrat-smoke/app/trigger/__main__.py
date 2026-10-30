"""CLI: trigger a smoke run, record the run file, and map the outcome to an exit code."""

import argparse
import logging
import sys
import tempfile

from app.trigger import client as trigger_client
from app.trigger import pending, record

log = logging.getLogger("xstockstrat-smoke-trigger")


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="python -m app.trigger")
    p.add_argument("--mode", choices=("strict", "record-only"), required=True)
    p.add_argument("--endpoint", required=True, help="host:port of the smoke API")
    p.add_argument("--env", required=True, help="environment label (homelab-staging | do-dev)")
    p.add_argument("--checks", help="comma-separated ids; default: the pending checks")
    p.add_argument(
        "--out", help="working directory for run files (default: a temp dir with a remote, else .)"
    )
    p.add_argument("--git-remote", help="push the run file to this repo's smoke-results branch")
    return p


def _execute(args, environ) -> int:
    cli = trigger_client.Client(
        args.endpoint,
        cert_pem=environ["MTLS_CERT"],
        key_pem=environ["MTLS_KEY"],
        ca_pem=environ["MTLS_CA_CERT"],
    )
    out = args.out or (tempfile.mkdtemp(prefix="smoke-") if args.git_remote else ".")
    ids = args.checks.split(",") if args.checks else None
    prepared = False
    try:
        if ids is None:
            if args.git_remote:
                record.checkout_results(out, args.git_remote)
                prepared = True
            ids = pending.pending(cli.checks(), pending.read_recorded(out), args.env)
            if not ids:
                log.info("nothing pending for %s", args.env)
                return 0
    except trigger_client.TriggerError as e:
        log.error("SMOKE_TRIGGER_FAILED: %s", e)
        return 1
    except Exception as e:
        log.error("SMOKE_RECORD_FAILED: %s", e)
        return 1
    try:
        body = cli.wait_for_run(cli.start_run(ids))
    except trigger_client.RunLost as e:
        log.error("SMOKE_RUN_LOST: %s", e)
        return 1
    except Exception as e:
        log.error("SMOKE_TRIGGER_FAILED: %s", e)
        return 1
    try:
        if args.git_remote and not prepared:
            record.checkout_results(out, args.git_remote)
        path = record.write_run_file(out, body)
        if args.git_remote:
            record.push_with_retry(out, [path])
    except Exception as e:
        log.error("SMOKE_RECORD_FAILED: %s", e)
        return 1
    return 0 if all(r["outcome"] == "PASS" for r in body["records"]) else 1


def main(argv=None, environ=None) -> int:
    args = _parser().parse_args(argv)
    if environ is None:
        import os

        environ = os.environ
    rc = _execute(args, environ)
    return rc if args.mode == "strict" else 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    sys.exit(main())
