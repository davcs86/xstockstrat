# Debate Register: fix-agent-mcp-transport-fallthrough

**State**: in-debate
**Mode**: full
**Rounds run**: 2 (round numbers continue across runs; the mode's 2–5 / 1 bounds count this run only)

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-20 | /sdd-batch | 5 | 5 | 0 | 3 | 0 | yes |
| 2 | 2026-11-20 | /sdd-batch | 0 | 2 | 2 | 2 | 0 | yes |

## Settled Decisions

<!-- Status: settled → superseded by D-m (only after a user-approved REOPEN) -->
| ID | Round | Decision | Evidence | Status |
|---|---|---|---|---|
| D-1 | 1 | Unrecognized `MCP_TRANSPORT` fails closed by raising `RuntimeError` (message names `MCP_TRANSPORT` and the repr of the value) inside `resolve_transport()`; `main()` is unchanged. | `services/xstockstrat-agent/app/main.py:61-65,286` (the raise precedes runner coroutine creation); fail-closed convention at `app/mtls.py:25-26`; proposer and adversary agree. | settled |
| D-2 | 1 | Default for unset `MCP_TRANSPORT` is `http`; stdio must be set explicitly. | Operator decision at `docs/roadmap/features/331-fix-agent-mcp-transport-fallthrough/context.md:24`; `main.py:54`; `claude_mcp_config.json:11` already sets stdio. | settled |
| D-3 | 1 | `MCP_TRANSPORT=""` is unrecognized and fails closed, with no normalization (no case folding or stripping). This is a deliberate asymmetry with the port vars' empty-means-absent rule. | Operator decision "any other value → exit non-zero" at `context.md:24`; all four deploy specs set a literal `http` (`docker-compose.yml:573`, `.do/app.yaml:384`, `.do/app.dev.yaml:386`, `deploy/homelab/compose.yml:320`); port convention at `tests/test_transport_config.py:97-102`. | settled |
| D-4 | 1 | The feature-079 AC-4 reversal is a sign-off-only C-16 CHANGE: no promoted scenario exists to supersede, so there is no suite edit. `design.md` corrects product-spec Open Question 1. | Recon § Existing Business Rules (no promoted 079 scenario); operator sign-off at `context.md:24`. | settled |
| D-5 | 1 | `supervisord.conf` and the DO `health_check` are not changed by this feature. | Operator decision that the DO health_check is out of scope, `context.md:24`; `services/xstockstrat-agent/supervisord.conf:5-8`. | settled |

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 1 | `SystemExit` / `log.error` + `sys.exit(2)` as the exit mechanism | Departs from the `mtls.py` raise convention and complicates tests; the gain is only cleaner logs. | locked |
| R-2 | 1 | Validation in `main()` instead of `resolve_transport()` | Splits the recognized-set knowledge across two functions with no benefit. | locked |
| R-3 | 1 | Empty `MCP_TRANSPORT` treated as unset (falls to http) | Silent start on a blanked variable is the defect class being fixed. | locked |
| R-4 | 1 | Explicit `startsecs`/`startretries` in `supervisord.conf` | Marginal without the out-of-scope health check; widens the diff. | locked |
| R-5 | 1 | A grep-based gate for stale doc strings | Ledger `fails.md:138-157`: grep gates are a recorded recurring failure. | locked |
| R-6 | 2 | Subprocess AC-1 stderr assertion on the token `MCP_TRANSPORT='htp'` | Today's warning at `app/main.py:64` prints the same token to stderr (`:44`), so it does not tell buggy code from fixed code. | locked |
| R-7 | 2 | Child entry via `-c "import app.main as m; m.main()"` with a traceback check | No more discriminating than the unique-token assertion, and it skips the real `-m app.main` `__main__` path. | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | [P-06] The subprocess AC-1 test must use `stdin=DEVNULL`, `capture_output`, a timeout with `TimeoutExpired` turned into `pytest.fail`, and a mandatory stderr match, with `OTEL_ENABLED` off in the child. The red run is documented as timeout or exit 0. The proposer must confirm this and confirm the child can import `app.main`. | yes | closed @ round 2 (The proposer confirmed the hang guard (`stdin=DEVNULL`, `capture_output`, 20s timeout, `TimeoutExpired` to `pytest.fail`, `OTEL_ENABLED=false`) and that the child imports `app.main` without the conftest `gen` setup: the only top-level `gen` import in `app/` is `app/auth.py:13`, which loads lazily. The remaining stderr-discriminator defect is carried by a new blocking objection.) |
| O-2 | 1 | [P-03/C-15] AC-1's Given says "container" but the proof is process-level, and supervisord keeps the container alive. The operator should confirm the process reading and the rewording of the Given to "the agent process starts". | no | open |
| O-3 | 1 | Merge order: verify whether `fix-mcp-deadline-budget` or `fix-agent-bearer-secret-orphan` touch `app/main.py`, `tests/test_transport_config.py`, `tests/conftest.py` or the agent docs before spec. | no | closed @ round 2 (No file overlap with features 314 and 328: their shared file is `app/tools.py`, which this feature does not touch. The spec carries a re-run note naming the conftest `MCP_TRANSPORT`, `CONFIG_ENDPOINT` and `MTLS_*` defaults (`tests/conftest.py:126,128,132-134`). The adversary agrees.) |
| O-4 | 2 | [P-06/C-15] The subprocess AC-1 test must assert `"expected 'http' or 'stdio'"` in stderr and `"falling back to stdio"` not in stderr, since `MCP_TRANSPORT='htp'` already appears on today's code (`app/main.py:44,64`). The red outcome is restated as a timeout or an exit with the old warning, never the new error text. The proposer must confirm. | yes | open |
| O-5 | 2 | [C-15] If the subprocess test is dropped as flaky, record a P-03 deviation in `context.md`. The in-process `pytest.raises` through `main()` is the primary AC-1 proof and must exist either way. | no | open |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
