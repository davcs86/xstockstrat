"""FundamentalsSignalLoop — daily fundamentals signal producer (feature 062).

A background asyncio task (mirroring ``app/engine/live_loop.py``) that, each cycle:
builds a deduplicated symbol universe, reads cached fundamentals **only** via marketdata
``GetFundamentalsMulti`` (never FMP directly — the single FMP chokepoint), scores each
symbol, maps the score to a ``buy``/``sell``/``hold`` direction by cross-sectional
quantile, and emits an ``ExternalSignal`` per surviving symbol through ingest
``IngestSignal``. Re-emits are guarded by the ``analysis.fundsignal_emitted`` table
(ingest's ``IngestSignal`` does not dedup), so a same-day re-run spends zero cache calls.

The same ``run_once`` path backs both the scheduled loop and the manual
``RunFundamentalsScan`` RPC (feature 062, Step 9).
"""

import asyncio
import logging
import uuid
from datetime import UTC, datetime, timedelta

from gen.ingest.v1 import ingest_pb2
from gen.marketdata.v1 import marketdata_pb2
from gen.notify.v1 import notify_pb2
from google.protobuf.struct_pb2 import Struct
from google.protobuf.timestamp_pb2 import Timestamp

log = logging.getLogger(__name__)

# Fundamental metric → (good_endpoint, bad_endpoint) for the built-in default score.
# Lower-is-better when good < bad; higher-is-better when good > bad. Mirrors the spirit of
# the 063 value+quality formula but is a self-contained, deterministic built-in default
# (used when analysis.fundsignal.scoring_formula_id is empty).
_BUILTIN_BANDS = {
    "pe_ratio": (10.0, 35.0),  # lower better; <=0 handled specially
    "pb_ratio": (1.0, 5.0),  # lower better; <0 handled specially
    "roe": (0.25, 0.05),  # higher better
    "debt_to_equity": (0.3, 2.0),  # lower better; <0 handled specially
}


def _lin(x, good, bad):
    if good == bad:
        return 1.0
    if good < bad:
        if x <= good:
            return 1.0
        if x >= bad:
            return 0.0
        return (bad - x) / (bad - good)
    if x >= good:
        return 1.0
    if x <= bad:
        return 0.0
    return (x - bad) / (good - bad)


class FundamentalsSignalLoop:
    def __init__(
        self,
        config_watcher,
        db_pool,
        marketdata_stub,
        ingest_stub,
        portfolio_stub,
        indicators_stub,
        notify_stub,
        ledger_stub,
    ):
        self._cfg = config_watcher
        self._db = db_pool
        self._marketdata = marketdata_stub
        self._ingest = ingest_stub
        self._portfolio = portfolio_stub
        self._indicators = indicators_stub
        self._notify = notify_stub
        self._ledger = ledger_stub
        self._lock = asyncio.Lock()
        self._source_registered = False

    # ── scheduler ────────────────────────────────────────────────────────────

    async def run_forever(self):
        """Entry point — runs indefinitely. Call as asyncio.create_task(loop.run_forever())."""
        while True:
            interval_hours = self._cfg.get_int("analysis.fundsignal.run_interval_hours", default=24)
            await asyncio.sleep(max(1, interval_hours) * 3600)
            if not self._cfg.get_bool("analysis.fundsignal.enabled", default=False):
                continue
            if self._lock.locked():
                log.info("fundsignal: previous cycle still running — skipping")
                continue
            async with self._lock:
                try:
                    await self.run_once(force=False, dry_run=False, override_symbols=None)
                except Exception as e:  # never let one bad cycle kill the loop
                    log.error("fundsignal: cycle error: %s", e)

    # ── single run (shared by the loop and the RPC) ──────────────────────────

    async def run_once(self, force=False, dry_run=False, override_symbols=None, metadata=()):
        run_id = str(uuid.uuid4())
        source_slug = self._cfg.get_str("analysis.fundsignal.source_slug", "fundamentals")
        as_of_date = datetime.now(UTC).date()

        # Universe (dedup + cap).
        max_symbols = self._cfg.get_int("analysis.fundsignal.max_symbols_per_run", default=200)
        universe = override_symbols or await self._resolve_universe(metadata)
        universe = self._dedup(universe)[:max_symbols]

        await self._db.execute(
            "INSERT INTO analysis.fundsignal_runs (run_id, status, symbols_total) "
            "VALUES ($1::uuid, 'running', $2)",
            run_id,
            len(universe),
        )
        await self._emit_ledger(
            "analysis.fundsignal.run_started", run_id, {"symbols": len(universe)}
        )

        if dry_run:
            # Report what would be scanned without spending cache calls or emitting.
            return await self._finish(
                run_id, status="completed", symbols_done=len(universe), calls_spent=0, deferred=0
            )

        # Skip symbols already emitted today (no cache call) — unless force re-emits.
        if force:
            await self._db.execute(
                "DELETE FROM analysis.fundsignal_emitted WHERE source=$1 AND as_of_date=$2",
                source_slug,
                as_of_date,
            )
            to_process = list(universe)
        else:
            already = await self._already_emitted(source_slug, as_of_date)
            to_process = [s for s in universe if s not in already]

        # Paced, budget-bounded cached fundamentals fetch (never FMP directly).
        budget = self._cfg.get_int("analysis.fundsignal.daily_call_budget", default=200)
        fetched, deferred, calls_spent = await self._paced_fetch(to_process, budget, metadata)

        # Score → cross-sectional direction → drop below min conviction.
        scores = await self._score(fetched, metadata)
        buy_q = self._cfg.get_float("analysis.fundsignal.buy_quantile", default=0.80)
        sell_q = self._cfg.get_float("analysis.fundsignal.sell_quantile", default=0.20)
        min_conv = self._cfg.get_float("analysis.fundsignal.min_conviction_to_emit", default=0.0)
        directions = self._map_directions(scores, buy_q, sell_q)

        valid_days = self._cfg.get_int("analysis.fundsignal.valid_days", default=90)
        await self._ensure_source_registered(source_slug, metadata)

        emitted = 0
        for symbol in sorted(fetched):
            score = scores.get(symbol, 0.0)
            if score < min_conv:
                continue
            # Idempotent claim: only emit if this row is newly inserted.
            row = await self._db.fetchrow(
                "INSERT INTO analysis.fundsignal_emitted "
                "(symbol, source, as_of_date, score, direction, run_id) "
                "VALUES ($1,$2,$3,$4,$5,$6::uuid) "
                "ON CONFLICT (symbol, source, as_of_date) DO NOTHING RETURNING symbol",
                symbol,
                source_slug,
                as_of_date,
                score,
                directions[symbol],
                run_id,
            )
            if row is None:
                continue  # already emitted today
            signal_id = await self._emit_signal(
                source_slug, symbol, directions[symbol], score, valid_days, metadata
            )
            if signal_id is not None:
                await self._db.execute(
                    "UPDATE analysis.fundsignal_emitted SET signal_id=$4 "
                    "WHERE symbol=$1 AND source=$2 AND as_of_date=$3",
                    symbol,
                    source_slug,
                    as_of_date,
                    signal_id,
                )
            emitted += 1

        status = "budget_deferred" if deferred else "completed"
        if deferred:
            await self._emit_warning(
                f"fundsignal: deferred {len(deferred)} symbols — "
                f"daily call budget ({budget}) reached"
            )
        return await self._finish(
            run_id,
            status=status,
            symbols_done=len(fetched),
            calls_spent=calls_spent,
            deferred=len(deferred),
            signals_emitted=emitted,
        )

    # ── helpers (Step 8) ─────────────────────────────────────────────────────

    async def _resolve_universe(self, metadata):
        """Distinct symbol universe per analysis.fundsignal.universe_source (FR-3).

        watchlists global-union is pending a global portfolio RPC (058's ListWatchlists is
        user-scoped), so watchlists/both currently fall back to the explicit CSV and log it.
        """
        source = self._cfg.get_str("analysis.fundsignal.universe_source", "watchlists")
        explicit = self._parse_csv(self._cfg.get_str("analysis.fundsignal.explicit_symbols", ""))
        if source == "explicit":
            return explicit
        # watchlists | both — no global watchlist union available yet.
        log.info(
            "fundsignal: universe_source=%s but no global watchlist RPC — using explicit fallback",
            source,
        )
        return explicit

    @staticmethod
    def _parse_csv(raw):
        return [s.strip().upper() for s in (raw or "").split(",") if s.strip()]

    @staticmethod
    def _dedup(symbols):
        seen = set()
        out = []
        for s in symbols:
            u = s.strip().upper()
            if u and u not in seen:
                seen.add(u)
                out.append(u)
        return sorted(out)

    async def _already_emitted(self, source, as_of_date):
        rows = await self._db.fetch(
            "SELECT symbol FROM analysis.fundsignal_emitted WHERE source=$1 AND as_of_date=$2",
            source,
            as_of_date,
        )
        return {r["symbol"] for r in rows}

    async def _paced_fetch(self, symbols, budget, metadata, chunk_size=50):
        """Fetch fundamentals via marketdata GetFundamentalsMulti in budget-bounded chunks.

        This is the ONLY fundamentals access path — the producer never imports/calls FMP.
        One GetFundamentalsMulti call per chunk counts as one against the daily budget.
        """
        fetched = {}
        calls = 0
        i = 0
        while i < len(symbols):
            if calls >= budget:
                break  # remaining symbols are deferred
            chunk = symbols[i : i + chunk_size]
            try:
                resp = await self._marketdata.GetFundamentalsMulti(
                    marketdata_pb2.GetFundamentalsMultiRequest(symbols=chunk),
                    metadata=metadata,
                )
                for f in resp.fundamentals:
                    fetched[f.symbol.upper()] = f
            except Exception as e:  # noqa: BLE001 - one bad chunk should not abort the run
                log.warning("fundsignal: GetFundamentalsMulti failed for chunk: %s", e)
            calls += 1
            i += chunk_size
            await asyncio.sleep(0)  # cooperative pacing point
        deferred = symbols[i:]
        return fetched, deferred, calls

    async def _score(self, fundamentals_by_symbol, metadata):
        """Map each symbol's fundamentals to a score in [0,1]. Deterministic, run-local."""
        formula_id = self._cfg.get_str("analysis.fundsignal.scoring_formula_id", "")
        if formula_id and self._indicators is not None:
            return await self._score_via_formula(formula_id, fundamentals_by_symbol, metadata)
        return {sym: self._builtin_score(f) for sym, f in fundamentals_by_symbol.items()}

    @staticmethod
    def _builtin_score(f):
        parts = []
        pe = f.pe_ratio
        if pe:
            parts.append(0.0 if pe <= 0 else _lin(pe, *_BUILTIN_BANDS["pe_ratio"]))
        pb = f.pb_ratio
        if pb:
            parts.append(0.0 if pb < 0 else _lin(pb, *_BUILTIN_BANDS["pb_ratio"]))
        if f.roe:
            parts.append(_lin(f.roe, *_BUILTIN_BANDS["roe"]))
        de = f.debt_to_equity
        if de:
            parts.append(0.0 if de < 0 else _lin(de, *_BUILTIN_BANDS["debt_to_equity"]))
        if f.eps:
            parts.append(1.0 if f.eps > 0 else 0.0)
        return sum(parts) / len(parts) if parts else 0.5

    async def _score_via_formula(self, formula_id, fundamentals_by_symbol, metadata):
        # Reuse the 063 consumer helper (analysis-side) over the indicators ExecuteFormula RPC.
        from app.services.fundamentals_scoring import score_fundamentals

        out = {}
        for sym, f in fundamentals_by_symbol.items():
            fundamentals = {
                "pe_ratio": f.pe_ratio,
                "pb_ratio": f.pb_ratio,
                "dividend_yield": f.dividend_yield,
                "roe": f.roe,
                "debt_to_equity": f.debt_to_equity,
                "eps": f.eps,
            }
            try:
                scores = await score_fundamentals(
                    self._indicators, formula_id, fundamentals, metadata
                )
                out[sym] = float(scores.get("composite", 0.0))
            except Exception as e:  # noqa: BLE001 - fall back to built-in on formula failure
                log.warning("fundsignal: formula scoring failed for %s: %s", sym, e)
                out[sym] = self._builtin_score(f)
        return out

    @staticmethod
    def _map_directions(scores, buy_quantile, sell_quantile):
        """Cross-sectional quantile within the run: >= buy_q → buy, <= sell_q → sell, else hold."""
        if not scores:
            return {}
        ordered = sorted(scores.values())
        buy_cut = _quantile(ordered, buy_quantile)
        sell_cut = _quantile(ordered, sell_quantile)
        directions = {}
        for sym, s in scores.items():
            if s >= buy_cut:
                directions[sym] = "buy"
            elif s <= sell_cut:
                directions[sym] = "sell"
            else:
                directions[sym] = "hold"
        return directions

    async def _ensure_source_registered(self, source_slug, metadata):
        """Idempotently register the derived signal source (FR-7). Requires the ingest
        006_signal_source_type_derived migration (Step 13). Admin scope is needed; reuse the
        caller's propagated metadata when admin, else inject the admin bit for the loop path."""
        if self._source_registered:
            return
        meta = list(metadata) if metadata else []
        if not any(k == "x-access-scope" for k, _ in meta):
            meta.append(("x-access-scope", "4"))  # admin bit for the background loop path
        try:
            await self._ingest.ManageSignalSource(
                ingest_pb2.ManageSignalSourceRequest(
                    operation="register",
                    source=ingest_pb2.SignalSource(
                        slug=source_slug,
                        display_name="Fundamentals Signal Producer",
                        source_type="derived",
                        extractor_module="app.extractors.noop",
                        active=True,
                    ),
                ),
                metadata=meta,
            )
            self._source_registered = True
        except Exception as e:  # noqa: BLE001 - tolerate already-registered / transient
            log.warning("fundsignal: source registration failed (non-fatal): %s", e)

    async def _emit_signal(self, source, symbol, direction, conviction, valid_days, metadata):
        now = datetime.now(UTC)
        valid_from = Timestamp()
        valid_from.FromDatetime(now)
        valid_until = Timestamp()
        valid_until.FromDatetime(now + timedelta(days=valid_days))
        try:
            resp = await self._ingest.IngestSignal(
                ingest_pb2.IngestSignalRequest(
                    signal=ingest_pb2.ExternalSignal(
                        source=source,
                        symbol=symbol,
                        direction=direction,
                        conviction=float(conviction),
                        valid_from=valid_from,
                        valid_until=valid_until,
                    )
                ),
                metadata=metadata,
            )
            return resp.signal_id
        except Exception as e:  # noqa: BLE001 - one failed emit should not abort the run
            log.warning("fundsignal: IngestSignal failed for %s: %s", symbol, e)
            return None

    # ── run bookkeeping ──────────────────────────────────────────────────────

    async def _finish(self, run_id, status, symbols_done, calls_spent, deferred, signals_emitted=0):
        finished_at = datetime.now(UTC)
        await self._db.execute(
            "UPDATE analysis.fundsignal_runs SET finished_at=$2, status=$3, symbols_done=$4, "
            "calls_spent=$5, deferred_count=$6 WHERE run_id=$1::uuid",
            run_id,
            finished_at,
            status,
            symbols_done,
            calls_spent,
            deferred,
        )
        await self._emit_ledger(
            "analysis.fundsignal.run_completed",
            run_id,
            {"status": status, "symbols_done": symbols_done, "signals_emitted": signals_emitted},
        )
        ts = Timestamp()
        ts.FromDatetime(finished_at)
        from gen.analysis.v1 import analysis_pb2

        return analysis_pb2.FundamentalsScanSummary(
            run_id=run_id,
            symbols_processed=symbols_done,
            signals_emitted=signals_emitted,
            calls_spent=calls_spent,
            deferred_count=deferred,
            status=status,
            finished_at=ts,
        )

    async def _emit_ledger(self, event_type, run_id, payload):
        try:
            from gen.ledger.v1 import ledger_pb2

            p = Struct()
            p.update({"run_id": run_id, **{k: str(v) for k, v in payload.items()}})
            await self._ledger.AppendEvent(
                ledger_pb2.AppendEventRequest(
                    event_type=event_type,
                    source_service="xstockstrat-analysis",
                    stream_key=f"fundsignal:{run_id}",
                    payload=p,
                )
            )
        except Exception as e:  # noqa: BLE001 - ledger is best-effort
            log.warning("fundsignal: ledger emit failed: %s", e)

    async def _emit_warning(self, msg):
        try:
            ctx = Struct()
            ctx.update({"detail": msg})
            await self._notify.EmitAlert(
                notify_pb2.EmitAlertRequest(
                    severity=notify_pb2.AlertSeverity.ALERT_SEVERITY_WARNING,
                    category="system",
                    title="fundamentals signal producer",
                    body=msg,
                    source_service="xstockstrat-analysis",
                )
            )
        except Exception as e:  # noqa: BLE001 - notify is best-effort
            log.warning("fundsignal: notify emit failed: %s", e)


def _quantile(sorted_values, q):
    """Inclusive nearest-rank quantile of an ascending list."""
    if not sorted_values:
        return 0.0
    if q <= 0:
        return sorted_values[0]
    if q >= 1:
        return sorted_values[-1]
    idx = int(round(q * (len(sorted_values) - 1)))
    return sorted_values[idx]
