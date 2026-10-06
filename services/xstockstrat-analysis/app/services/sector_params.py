"""Per-sector component-param overrides (feature 217).

A strategy's ``sector_param_overrides`` (StrategyDefinition field 15) override individual
``components[ref].params[name]`` by the evaluated symbol's sector. Backtests resolve the sector
as-of each bar from a ``GetSectorHistory`` snapshot (no look-ahead); live surfaces use the current
sector. An unclassified bar/symbol uses the override's ``default_value`` — never a carry-forward of
another sector.
"""

from __future__ import annotations

import bisect
import logging
import math

import grpc
from gen.analysis.v1 import analysis_pb2
from gen.common.v1 import common_pb2
from gen.marketdata.v1 import marketdata_pb2

log = logging.getLogger(__name__)

UNSPECIFIED = common_pb2.Sector.SECTOR_UNSPECIFIED

SEED_SPAN_WARNING = (
    "sector-classification seed span: bars for {symbols} were resolved against an epoch-seeded "
    "sector (today's sector applied to pre-go-live history — a bounded, documented look-ahead)"
)
SECTOR_UNAVAILABLE_WARNING = (
    "sector classification unavailable ({error}); per-sector overrides fell back to default values"
)


def has_overrides(definition) -> bool:
    return len(definition.sector_param_overrides) > 0


def validate_overrides(definition) -> None:
    """Raise ValueError for an override that cannot apply (write-time FR-6 validation)."""
    comps = {c.ref_name: c for c in definition.components}
    seen: set[tuple[str, str]] = set()
    for ov in definition.sector_param_overrides:
        comp = comps.get(ov.component_ref)
        if comp is None:
            raise ValueError(
                f"sector_param_overrides: component_ref '{ov.component_ref}' matches no component"
            )
        if comp.kind == analysis_pb2.COMPONENT_KIND_FUNDAMENTAL:
            raise ValueError(
                f"sector_param_overrides: component '{ov.component_ref}' is a fundamental "
                "operand and has no params"
            )
        if not ov.param_name:
            raise ValueError("sector_param_overrides: param_name is required")
        key = (ov.component_ref, ov.param_name)
        if key in seen:
            raise ValueError(
                f"sector_param_overrides: duplicate override for {ov.component_ref}.{ov.param_name}"
            )
        seen.add(key)
        if not math.isfinite(ov.default_value):
            raise ValueError(f"sector_param_overrides: {ov.param_name} default must be finite")
        sectors: set[int] = set()
        for sv in ov.by_sector:
            if sv.sector == UNSPECIFIED:
                raise ValueError(
                    "sector_param_overrides: by_sector may not use SECTOR_UNSPECIFIED "
                    "(that bucket is default_value)"
                )
            if sv.sector in sectors:
                raise ValueError(
                    f"sector_param_overrides: duplicate sector {common_pb2.Sector.Name(sv.sector)} "
                    f"for {ov.component_ref}.{ov.param_name}"
                )
            sectors.add(sv.sector)
            if not math.isfinite(sv.value):
                raise ValueError(f"sector_param_overrides: {ov.param_name} values must be finite")


def resolved_params(definition, sector: int) -> dict[str, dict[str, float]]:
    """``{ref_name: {param: value}}`` the overrides resolve to for one sector."""
    out: dict[str, dict[str, float]] = {}
    for ov in definition.sector_param_overrides:
        value = ov.default_value
        for sv in ov.by_sector:
            if sv.sector == sector and sector != UNSPECIFIED:
                value = sv.value
                break
        out.setdefault(ov.component_ref, {})[ov.param_name] = float(value)
    return out


def component_with_params(comp, params: dict[str, float]):
    """A copy of ``comp`` with ``params`` overlaid (the original is never mutated)."""
    out = analysis_pb2.StrategyComponent()
    out.CopyFrom(comp)
    for name, value in params.items():
        out.params[name] = value
    return out


def apply_sector(definition, sector: int):
    """Live-snapshot resolution: a copy of the definition with every override applied for one
    sector. A definition without overrides is returned unchanged (same object)."""
    if not has_overrides(definition):
        return definition
    params = resolved_params(definition, sector)
    out = analysis_pb2.StrategyDefinition()
    out.CopyFrom(definition)
    for comp in out.components:
        for name, value in params.get(comp.ref_name, {}).items():
            comp.params[name] = value
    return out


def variant_definitions(definition) -> list:
    """Every distinct sector resolution of ``definition`` (default bucket + each named sector),
    overrides stripped — so a pure consumer (e.g. warm-up sizing) can take the max across them."""
    sectors = {UNSPECIFIED}
    for ov in definition.sector_param_overrides:
        sectors.update(sv.sector for sv in ov.by_sector)
    out = []
    for sector in sorted(sectors):
        v = apply_sector(definition, sector)
        if v is definition:
            v = analysis_pb2.StrategyDefinition()
            v.CopyFrom(definition)
        del v.sector_param_overrides[:]
        out.append(v)
    return out


def sector_by_bar(rows, bars) -> tuple[list[int], bool]:
    """Resolve each bar's sector as-of ``bar.time`` from one symbol's SectorHistoryRow list.

    ``valid_from`` inclusive, ``valid_to`` exclusive (unset = open). A bar no version covers is
    UNSPECIFIED (→ default bucket). Returns (per-bar sectors, any bar resolved against a seed row).
    """
    ordered = sorted(rows, key=lambda r: r.valid_from.seconds)
    starts = [r.valid_from.seconds for r in ordered]
    sectors: list[int] = []
    used_seed = False
    for bar in bars:
        t = bar.time.seconds
        idx = bisect.bisect_right(starts, t) - 1
        if idx < 0:
            sectors.append(UNSPECIFIED)
            continue
        row = ordered[idx]
        if row.HasField("valid_to") and t >= row.valid_to.seconds:
            sectors.append(UNSPECIFIED)
            continue
        sectors.append(row.sector)
        used_seed = used_seed or row.source == "seed"
    return sectors, used_seed


def component_variants(definition, comp, sectors: list[int]) -> list[tuple[object, list[int]]]:
    """Group bar indices by the distinct param dict ``comp`` resolves to across ``sectors``.

    Returns ``[(component_variant, [bar indices])]``; a component no override touches returns a
    single ``(comp, all indices)`` entry so the caller computes it exactly once.
    """
    n = len(sectors)
    if not any(ov.component_ref == comp.ref_name for ov in definition.sector_param_overrides):
        return [(comp, list(range(n)))]
    by_key: dict[tuple, tuple[dict[str, float], list[int]]] = {}
    cache: dict[int, dict[str, float]] = {}
    for i, sector in enumerate(sectors):
        params = cache.get(sector)
        if params is None:
            params = resolved_params(definition, sector).get(comp.ref_name, {})
            cache[sector] = params
        key = tuple(sorted(params.items()))
        by_key.setdefault(key, (params, []))[1].append(i)
    return [(component_with_params(comp, params), idxs) for params, idxs in by_key.values()]


async def fetch_current_sector(marketdata_stub, symbol: str, metadata=()) -> tuple[int, bool]:
    """``(sector, ok)`` for ``symbol``'s open classification row; an RPC failure → (UNSPECIFIED,
    False) so the caller uses the default bucket and never fails evaluation."""
    try:
        resp = await marketdata_stub.GetCurrentSector(
            marketdata_pb2.GetCurrentSectorRequest(symbols=[symbol.upper()]), metadata=metadata
        )
    except grpc.RpcError as e:
        log.warning("GetCurrentSector(%s) failed; overrides use defaults: %s", symbol, e)
        return UNSPECIFIED, False
    return (resp.sectors[0].sector if resp.sectors else UNSPECIFIED), True
