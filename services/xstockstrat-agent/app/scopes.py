"""Role → access-scope bitmask + config-scope resolution for outbound platform calls.

A Python port of ``rolesToAccessScope`` in services/xstockstrat-ui/src/lib/auth.ts. It is a port
rather than an import because that helper is TypeScript in another service; the bit values are the
platform contract, mirrored server-side in services/xstockstrat-config/src/grpc/authz.ts
(``ADMIN_SCOPE = 0x04``) and in the Python servicers' ``_has_admin_scope``.

A real admin session's full scope is ``15`` (READ|WRITE|ADMIN|TRADING). Feature 092 removed the
legacy hardcoded ``x-access-scope=7`` tuple (``client._admin_metadata()``): every management write
tool now forwards the caller's real derived scope from here, so the backend's ``0x04`` role check
verifies admin instead of trusting an asserted constant.
"""

import os

#: ASGI ``scope["state"]`` key under which app/main.py's `_authorized` publishes the verified
#: caller claims for the current request, and from which app/tools.py reads them. Defined here so
#: neither module has to import the other. Present on every tool-call request, since feature
#: 079 removed the legacy SSE transport whose `POST /messages` bypassed `_authorized`.
MCP_CLAIMS_SCOPE_KEY = "mcp_claims"


def resolve_scope(environment: str, trading_mode: str) -> tuple[str, str]:
    """Resolve the (environment, trading_mode) config scope for an outbound read/write.

    Scope resolution: explicit parameter → this agent deployment's APPLICATION_ENV / TRADING_MODE →
    those env vars' own defaults. Never the proto zero-value: environment/trading_mode are
    deployment properties in env vars (confirmed with the user), so a production agent must not
    read/write a dev row when the caller omits them. Lifted here (feature 092/093) from the
    ``tools.py`` ``_resolve_scope`` closure so ``oauth_server.py`` can share it.
    """
    env = environment or os.environ.get("APPLICATION_ENV", "development")
    env = "production" if env == "production" else "dev"
    mode = trading_mode or os.environ.get("TRADING_MODE", "paper")
    mode = mode if mode in ("paper", "live", "all") else "all"
    return env, mode


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
