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

#: ASGI ``scope["state"]`` key carrying the verified caller claims from app/main.py's `_authorized`
#: to app/tools.py. Defined here so neither module imports the other.
MCP_CLAIMS_SCOPE_KEY = "mcp_claims"


def resolve_scope(environment: str) -> str:
    """Resolve the config `environment` scope ('production' | 'staging') for an outbound read/write.

    Scope resolution: explicit parameter → this agent deployment's APPLICATION_ENV → its default.
    Never the proto zero-value: environment is a deployment property, so a production agent must
    not read/write a staging row when the caller omits it. Feature 147 removed the trading_mode
    axis (paper/live is derived from environment) and renamed dev→staging.
    """
    env = environment or os.environ.get("APPLICATION_ENV", "development")
    return "production" if env == "production" else "staging"


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
