"""
Shared async HTTP and gRPC client for xstockstrat-agent.
All downstream HTTP calls include x-mcp-secret header when MCP_AGENT_SECRET is set.
GetConfigValue() makes a one-shot gRPC call to xstockstrat-config to resolve credentials.
"""
import os
from typing import Any

import grpc
import httpx

INGEST_HTTP_ENDPOINT = os.environ.get("INGEST_HTTP_ENDPOINT", "http://xstockstrat-ingest:8055")
NOTIFY_HTTP_ENDPOINT = os.environ.get("NOTIFY_HTTP_ENDPOINT", "http://xstockstrat-notify:8059")
ANALYSIS_HTTP_ENDPOINT = os.environ.get("ANALYSIS_HTTP_ENDPOINT", "http://xstockstrat-analysis:8056")
MCP_AGENT_SECRET = os.environ.get("MCP_AGENT_SECRET", "")
CONFIG_ENDPOINT = os.environ.get("CONFIG_ENDPOINT", "xstockstrat-config:50060")


def _headers() -> dict[str, str]:
    h = {"Content-Type": "application/json"}
    if MCP_AGENT_SECRET:
        h["x-mcp-secret"] = MCP_AGENT_SECRET
    return h


async def post_ingest(path: str, payload: dict[str, Any]) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=30.0) as c:
        r = await c.post(f"{INGEST_HTTP_ENDPOINT}{path}", json=payload, headers=_headers())
        r.raise_for_status()
        return r.json()


async def post_notify(path: str, payload: dict[str, Any]) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=30.0) as c:
        r = await c.post(f"{NOTIFY_HTTP_ENDPOINT}{path}", json=payload, headers=_headers())
        r.raise_for_status()
        return r.json()


async def post_analysis(path: str, payload: dict[str, Any]) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=30.0) as c:
        r = await c.post(f"{ANALYSIS_HTTP_ENDPOINT}{path}", json=payload, headers=_headers())
        r.raise_for_status()
        return r.json()


async def get_config_value(key: str) -> str | None:
    """
    Resolve a config key value via one-shot GetConfig gRPC call to xstockstrat-config.
    Used by extract_email_content / extract_website_content to resolve credentials_ref.
    Returns None if the key is absent or the call fails.
    """
    try:
        from gen.config.v1 import config_pb2, config_pb2_grpc  # noqa: PLC0415

        async with grpc.aio.insecure_channel(CONFIG_ENDPOINT) as channel:
            stub = config_pb2_grpc.ConfigServiceStub(channel)
            snapshot = await stub.GetConfig(config_pb2.GetConfigRequest(namespace="agent"))
            v = snapshot.values.get(key)
            if v is None:
                return None
            return v.string_val or None
    except Exception:
        return None
