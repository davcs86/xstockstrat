"""CLI: trigger a smoke run, record the run file, and map the outcome to an exit code."""

import argparse
import logging
import os
import shutil
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


def _fail(marker, e, pat) -> int:
    log.error("%s: %s", marker, record.scrub(e, pat))
    return 1


def _execute(args, environ, out) -> int:
    pat = environ.get("SMOKE_RESULTS_PAT")
    cli = trigger_client.Client(
        args.endpoint,
        cert_pem=environ["MTLS_CERT"],
        key_pem=environ["MTLS_KEY"],
        ca_pem=environ["MTLS_CA_CERT"],
    )
    ids = args.checks.split(",") if args.checks else None
    prepared = False
    try:
        if ids is None:
            if args.git_remote:
                record.checkout_results(out, args.git_remote, pat)
                prepared = True
            ids = pending.pending(cli.checks(), pending.read_recorded(out), args.env)
            if not ids:
                log.info("nothing pending for %s", args.env)
                return 0
    except trigger_client.TriggerError as e:
        return _fail("SMOKE_TRIGGER_FAILED", e, pat)
    except Exception as e:
        return _fail("SMOKE_RECORD_FAILED", e, pat)
    try:
        body = cli.wait_for_run(cli.start_run(ids))
    except trigger_client.RunLost as e:
        return _fail("SMOKE_RUN_LOST", e, pat)
    except Exception as e:
        return _fail("SMOKE_TRIGGER_FAILED", e, pat)
    try:
        if args.git_remote and not prepared:
            record.checkout_results(out, args.git_remote, pat)
        path = record.write_run_file(out, body)
        if args.git_remote:
            record.push_with_retry(out, [path], pat=pat)
    except Exception as e:
        return _fail("SMOKE_RECORD_FAILED", e, pat)
    return 0 if all(r["outcome"] == "PASS" for r in body["records"]) else 1


def main(argv=None, environ=None) -> int:
    args = _parser().parse_args(argv)
    environ = os.environ if environ is None else environ
    tmp = None
    try:
        if not args.out and args.git_remote:
            tmp = tempfile.mkdtemp(prefix="smoke-")
        rc = _execute(args, environ, args.out or tmp or ".")
    except Exception as e:
        rc = _fail("SMOKE_TRIGGER_FAILED", e, environ.get("SMOKE_RESULTS_PAT"))
    finally:
        if tmp:
            shutil.rmtree(tmp, ignore_errors=True)
    return rc if args.mode == "strict" else 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    sys.exit(main())
