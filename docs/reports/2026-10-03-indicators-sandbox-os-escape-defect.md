# Defect: Formula sandbox import guard lets formula code reach the real os module and read image files

**Recorded**: 2026-10-03
**Severity**: SEV-2
**Impact type**: sandbox-escape-file-read
**Environment**: production (main)
**Affected service(s)**: xstockstrat-indicators
**Config-only fix possible**: no

## Observed

The formula sandbox's language-level guard has three properties that combine:

- `_safe_import` checks only the top-level package name and then returns the real module.
- The allowed modules (numpy, pandas, …) are imported before seccomp loads, and their attributes are
  not filtered.
- `getattr` is in the safe-builtins list.

Formula code can therefore walk module attributes to the real `os` module (for example
`numpy.lib._datasource.os`). The seccomp allow-list includes `openat` and `read`. The 2026-10-02
verification confirmed that `os.open('/etc/passwd')` + `os.read` and `os.listdir('/etc')` succeed in
the child, so a formula can read any world-readable file in the image: app source, the venv, `/etc`
and `/proc/self`.

The OS layer still holds. The child runs as uid 65534 with no network and no writable filesystem, the
parent's `/proc/<pid>/environ` is mode 0400, and no secrets are on disk. Exposure is limited to
world-readable image contents, but the language guard that feature 209 documents is bypassable.

## Expected

Formula code cannot reach `os` or filesystem-read primitives. Either modules are exposed through
attribute-filtered proxies (or an allow-list of callables), or seccomp denies `openat` on paths
outside an explicit allow-list after imports finish.

## Reproduction

1. Call `ExecuteFormula` (or the MCP `test_formula` tool) with inline source that reaches `os` through
   an allowed module's attributes and lists `/etc`.
2. The formula returns the directory listing with `success=true`.

## Evidence

`services/xstockstrat-indicators/app/services/sandbox.py:61-63`
> _SECCOMP_ALLOW = (
>     "openat",
>     "read",

`services/xstockstrat-indicators/app/services/sandbox.py:148`
> "getattr",

`services/xstockstrat-indicators/app/services/sandbox.py:204-208`
> base = name.split('.')[0]
> if base not in _allowed:
> ...
> return _real_import(name, ...)

## Root cause hypothesis

The guard filters import names, not object reachability. Once a real module object is exposed,
attribute traversal reaches everything it imported. Fix: a deny-by-default seccomp `openat` filter
after imports, or attribute-filtered module proxies.

## Confidence

high
