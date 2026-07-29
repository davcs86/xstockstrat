"""Role → access-scope bitmask for outbound platform calls.

A Python port of ``rolesToAccessScope`` in services/xstockstrat-ui/src/lib/auth.ts. It is a port
rather than an import because that helper is TypeScript in another service; the bit values are the
platform contract, mirrored server-side in services/xstockstrat-config/src/grpc/authz.ts
(``ADMIN_SCOPE = 0x04``) and in the Python servicers' ``_has_admin_scope``.

Note there are two "admin" numbers in this codebase and they are both correct:
  * 15 — a real admin session's full scope (READ|WRITE|ADMIN|TRADING), produced here
  * 7  — the legacy hardcoded tuple in client._admin_metadata(), used by the other management
         tools (invariant AGENT-3). Both carry the ADMIN bit, so both pass a 0x04 check.
"""

#: ASGI ``scope["state"]`` key under which app/main.py's `_authorized` publishes the verified
#: caller claims for the current request, and from which app/tools.py reads them. Defined here so
#: neither module has to import the other. Present on every tool-call request, since feature
#: 079 removed the legacy SSE transport whose `POST /messages` bypassed `_authorized`.
MCP_CLAIMS_SCOPE_KEY = "mcp_claims"

_READ = 0x01
_WRITE = 0x02
_ADMIN = 0x04
_TRADING = 0x08


def roles_to_access_scope(roles: list[str] | None) -> int:
    """Map identity roles to the platform's access-scope bitmask.

    Mirrors the UI's mapping exactly: viewer→READ; trader→READ|WRITE|TRADING;
    admin→READ|WRITE|ADMIN|TRADING. Unknown roles contribute nothing, and no roles means 0 —
    which every consumer's ``& 0x04`` check treats as denied.
    """
    scope = 0
    for role in roles or []:
        if role == "viewer":
            scope |= _READ
        elif role == "trader":
            scope |= _READ | _WRITE | _TRADING
        elif role == "admin":
            scope |= _READ | _WRITE | _ADMIN | _TRADING
    return scope
