"""Scheduled server-side MCP query loop for mcp_client signal sources (feature 166).

A single paced asyncio background task started at ingest boot. Each cycle lists the active
`mcp_client` sources, resolves each source's bearer via GetSecret, calls its external MCP tool over
Streamable HTTP, parses the fixed xstockstrat contract into ExternalSignals, and ingests them
through the shared `IngestServicer._ingest_external_signal` path (dedup + health preserved, AC-4). A
per-source failure records source health (`mark_source_error`, AC-5) and the loop proceeds to the
next source — it never crashes the loop or the service.
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from typing import Any

from gen.ingest.v1 import ingest_pb2
from google.protobuf.timestamp_pb2 import Timestamp

from app.config.watcher import split_credentials_ref
from app.extractors.base import McpClientInput
from app.extractors.mcp_client import McpClientExtractor
from app.handlers.servicer import _cfg_to_dict
from app.mcp_client import McpClientProtocol
from app.repositories.signal_sources import list_all_sources, mark_source_error

log = logging.getLogger(__name__)

_DEFAULT_POLL_INTERVAL_SECONDS = 300
_DEFAULT_REQUEST_TIMEOUT_SECONDS = 30


def _extract_result_items(result: Any) -> list[dict]:
    """Pull the JSON list of signal objects from a CallToolResult: prefer structured_content
    (a list, or a dict wrapping the list), fall back to JSON-decoding the first text content block.
    Non-list/non-dict content yields []; the extractor then skips whatever is malformed."""
    sc = getattr(result, "structured_content", None)
    if isinstance(sc, list):
        return sc
    if isinstance(sc, dict):
        for value in sc.values():
            if isinstance(value, list):
                return value
        return [sc]
    content = getattr(result, "content", None) or []
    if content:
        text = getattr(content[0], "text", None)
        if text:
            decoded = json.loads(text)
            return decoded if isinstance(decoded, list) else [decoded]
    return []


def _parse_ts(value: Any) -> Timestamp | None:
    """Best-effort RFC3339/ISO-8601 string → protobuf Timestamp; None on absent/unparseable."""
    if not value or not isinstance(value, str):
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    ts = Timestamp()
    ts.FromDatetime(dt)
    return ts


def _build_external_signal(slug: str, item: dict) -> ingest_pb2.ExternalSignal:
    """Build an ExternalSignal from one parsed contract item (source = the source slug)."""
    signal = ingest_pb2.ExternalSignal(
        source=slug,
        symbol=item["symbol"],
        direction=item["direction"],
        conviction=item["conviction"],
    )
    if item.get("headline"):
        signal.headline = item["headline"]
    if item.get("raw_url"):
        signal.raw_url = item["raw_url"]
    if item.get("tags"):
        signal.tags.extend(item["tags"])
    valid_from = _parse_ts(item.get("valid_from"))
    signal.valid_from.CopyFrom(valid_from if valid_from else _now_ts())
    valid_until = _parse_ts(item.get("valid_until"))
    if valid_until:
        signal.valid_until.CopyFrom(valid_until)
    return signal


def _now_ts() -> Timestamp:
    ts = Timestamp()
    ts.FromDatetime(datetime.now(UTC))
    return ts


async def poll_one_source(
    servicer, cfg_watcher, mcp_client, extractor, src, timeout_seconds
) -> None:
    """Run one mcp_client source: resolve bearer, fetch, parse, and ingest each signal. Raises on
    an unexpected failure so the caller records source health; a missing bearer is a soft-degrade
    (marks the source and returns without raising)."""
    slug = src["slug"]
    cfg = _cfg_to_dict(src.get("config_json")) or {}
    endpoint = cfg.get("mcp_endpoint")
    tool = cfg.get("mcp_tool")
    arguments = cfg.get("mcp_arguments") or {}
    if not endpoint or not tool:
        raise RuntimeError("mcp_endpoint/mcp_tool missing from config_json")

    credentials_ref = src.get("credentials_ref")
    if not credentials_ref:
        await mark_source_error(servicer._db, slug, "bearer not configured")
        return
    _namespace, key = split_credentials_ref(credentials_ref)
    bearer, found = await cfg_watcher.resolve_secret(key)
    if not found:
        await mark_source_error(servicer._db, slug, "bearer not configured")
        return

    result = await mcp_client.fetch(endpoint, tool, arguments, bearer, float(timeout_seconds))
    items = _extract_result_items(result)
    parsed = await extractor.extract(McpClientInput(result_items=items))
    for item in parsed:
        await servicer._ingest_external_signal(_build_external_signal(slug, item))


async def run_one_cycle(servicer, cfg_watcher, mcp_client: McpClientProtocol) -> None:
    """One full pass over the active mcp_client sources — extracted so tests can drive a single
    cycle deterministically (Step 11) without the sleep loop."""
    extractor = McpClientExtractor()
    sources = await list_all_sources(servicer._db, include_inactive=False)
    timeout = max(
        cfg_watcher.get_int(
            "ingest.mcp_client.request_timeout_seconds", _DEFAULT_REQUEST_TIMEOUT_SECONDS
        ),
        1,
    )
    for src in sources:
        if src.get("source_type") != "mcp_client":
            continue
        slug = src["slug"]
        try:
            await poll_one_source(servicer, cfg_watcher, mcp_client, extractor, src, timeout)
        except Exception as e:
            log.warning("mcp_client loop: source %s failed: %s", slug, e)
            try:
                await mark_source_error(servicer._db, slug, str(e))
            except Exception as bookkeeping_err:
                log.warning(
                    "mcp_client loop: failed to record error for %s: %s", slug, bookkeeping_err
                )


async def run_mcp_client_loop(servicer, cfg_watcher, mcp_client: McpClientProtocol) -> None:
    """The paced background loop. Sleeps `ingest.mcp_client.poll_interval_seconds` (clamped ≥ 1 so a
    settable 0 cannot busy-loop) between cycles; a cycle-level failure is logged and retried next
    tick — the loop never exits."""
    import asyncio

    while True:
        interval = max(
            cfg_watcher.get_int(
                "ingest.mcp_client.poll_interval_seconds", _DEFAULT_POLL_INTERVAL_SECONDS
            ),
            1,
        )
        await asyncio.sleep(interval)
        try:
            await run_one_cycle(servicer, cfg_watcher, mcp_client)
        except Exception as e:  # a whole-cycle failure (e.g. listing sources) — retry next tick
            log.warning("mcp_client loop cycle failed: %s", e)
