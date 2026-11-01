"""Feature 244 read-classification guard (design §7).

Every int/float/str config read in `app/` is either a plain read that honours a stored 0/""
(`HONOUR_KEYS`) or an FR-3 clamp that reads a stored value <= 0 / "" as the default (`FR3_KEYS`).
A new read must be classified here, so a zero-sensitive key cannot slip back to an unclamped read.
"""

import ast
import re
from pathlib import Path
from typing import NamedTuple

import pytest

TESTS_DIR = Path(__file__).resolve().parent
APP_DIR = TESTS_DIR.parent / "app"

# Getter signature defaults; the *_present aliases share them.
_READ_SIGNATURE_DEFAULTS = {"get_int": "0", "get_float": "0.0", "get_str": "''"}
READ_NAMES = frozenset(
    {*_READ_SIGNATURE_DEFAULTS, *(f"{n}_present" for n in _READ_SIGNATURE_DEFAULTS)}
)
CLAMP_NAMES = frozenset({"int_positive", "float_positive", "str_nonempty"})

FR3_KEYS = frozenset(
    {
        "analysis.engine.eval_interval_seconds",
        "analysis.engine.max_strategies_per_cycle",
        "analysis.engine.fundamentals_blend_strategy_id",
        "analysis.fundsignal.source_slug",
        "analysis.fundsignal.run_interval_hours",
        "analysis.fundsignal.max_symbols_per_run",
        "analysis.fundsignal.daily_call_budget",
        "analysis.fundsignal.valid_days",
        "analysis.strategy.max_concurrent_entry_backfill",
        "analysis.strategy.default_cooldown_days",
        "analysis.series.max_concurrent_components",
        "analysis.opportunity.max_concurrent_bars_fetches",
        "analysis.opportunity.max_concurrent_candidates",
        "analysis.compute.max_worker_threads",
        "analysis.readiness_materializer.max_concurrent_bars_fetches",
        "analysis.backtest.portfolio_max_concurrent",
        "analysis.backtest.portfolio_position_weight",
        "analysis.backtest.detail_retention_per_strategy",
        "analysis.backtest.max_range_days",
        "analysis.screener.max_concurrent_formula_evals",
        "analysis.screener.max_duration_seconds",
        "analysis.screener.max_universe_size",
        "analysis.scoring.shrinkage_days",
        "analysis.snapshot.indicator_timeout_ms",
        "analysis.snapshot.signal_timeout_ms",
        "analysis.patterns.indicator_bucket_count",
        "analysis.opportunity.max_universe_size",
        "analysis.opportunity.max_live_strategies_per_symbol",
        "analysis.opportunity.max_live_held_symbols_per_compute",
        "analysis.opportunity.max_live_only_symbols_per_compute",
        "analysis.opportunity.valid_window_hours",
        "analysis.opportunity.snooze_default_hours",
        "analysis.opportunity.read_db_budget_ms",
        "analysis.opportunity.live_enrich_timeout_ms",
    }
)

HONOUR_KEYS = frozenset(
    {
        "analysis.backtest.default_commission_pct",
        "analysis.backtest.default_slippage_pct",
        "analysis.backtest.default_fill_model",
        "analysis.backtest.max_duration_seconds",
        "analysis.opportunity.signal_rank_weight",
        "analysis.engine.alert_throttle_seconds",
        "analysis.scoring.sharpe_weight",
        "analysis.scoring.drawdown_weight",
        "analysis.scoring.win_rate_weight",
        "analysis.scoring.min_evidence_symbols",
        "analysis.scoring.min_evidence_days",
        "analysis.scoring.signal_decay_half_life_hours",
        "analysis.scoring.composite_shrinkage_k",
        "analysis.scoring.composite_weight_readiness",
        "analysis.scoring.composite_weight_signal",
        "analysis.scoring.symbol_score_decay",
        "analysis.scoring.strategy_weight_floor",
        "analysis.fundsignal.buy_quantile",
        "analysis.fundsignal.sell_quantile",
        "analysis.fundsignal.min_conviction_to_emit",
        "analysis.fundsignal.universe_source",
        "analysis.fundsignal.explicit_symbols",
        "analysis.fundsignal.scoring_formula_id",
        "analysis.fundsignal.retry_seconds",
        "analysis.fundsignal.startup_jitter_seconds",
        "marketdata.fundamentals.provider",
        "analysis.screener.default_rank_limit",
        "analysis.patterns.min_sample_count",
        "analysis.strategy.default_exit_cooldown_days",
        "analysis.readiness.stale_after_seconds",
        "analysis.readiness_materializer.valid_window_hours",
        "analysis.readiness_materializer.refresh_hour_utc",
        "analysis.opportunity.live_enrich_ttl_seconds",
        "analysis.opportunity.empty_recompute_ttl_seconds",
        "analysis.opportunity.refresh_hour_utc",
        "analysis.opportunity.retry_seconds",
        "analysis.opportunity.startup_jitter_seconds",
    }
)

ZERO_IS_LEGIT = {
    "analysis.engine.alert_throttle_seconds": "0 = no throttle; the < 0 check never suppresses",
    "analysis.readiness.stale_after_seconds": "0 = always stale; config bounds [0, 86399]",
    "analysis.opportunity.live_enrich_ttl_seconds": "0 disables the live-enrich memo",
    "analysis.opportunity.empty_recompute_ttl_seconds": "consumer max(1, …) floor kept",
    "analysis.opportunity.retry_seconds": "max(1, …) floor kept, feature-158 @AC-9",
    "analysis.opportunity.startup_jitter_seconds": "0 disables jitter",
    "analysis.fundsignal.retry_seconds": "max(1, …) floor kept, feature-156 @AC-4",
    "analysis.fundsignal.startup_jitter_seconds": "0 disables jitter",
    "analysis.backtest.max_duration_seconds": "0 = no limit (feature-272 @AC-5)",
}

_ZERO_SENSITIVE = re.compile(
    r"max_concurrent|timeout|interval|budget|max_universe|_per_cycle|_ms$|_seconds$"
)


class Scan(NamedTuple):
    """`reads`/`clamps` map each key to its set of `(module_dotted_path, default_source)`."""

    reads: dict[str, set[tuple[str, str]]]
    clamps: dict[str, set[tuple[str, str]]]
    errors: list[str]


def _bind(call: ast.Call, key_pos: int, default_pos: int):
    """Return (key_node, default_node); either is None when the call does not pass it."""
    if any(isinstance(a, ast.Starred) for a in call.args) or any(
        kw.arg is None for kw in call.keywords
    ):
        raise ValueError("starred/** arguments cannot be bound")
    kws = {kw.arg: kw.value for kw in call.keywords}
    key = call.args[key_pos] if len(call.args) > key_pos else kws.get("key")
    default = call.args[default_pos] if len(call.args) > default_pos else kws.get("default")
    return key, default


def collect(app_dir: Path) -> Scan:
    """Scan `app_dir` for config reads and clamps; `errors` lists `path:line: reason` for every
    call whose key is not a bindable string constant."""
    scan = Scan({}, {}, [])

    class _Visitor(ast.NodeVisitor):
        def __init__(self, rel_path: str, module: str):
            self._rel_path = rel_path
            self._module = module

        def _skip_def(self, node):
            if node.name in READ_NAMES or node.name in CLAMP_NAMES:
                return
            self.generic_visit(node)

        visit_FunctionDef = _skip_def
        visit_AsyncFunctionDef = _skip_def

        def visit_Call(self, node: ast.Call):
            func = node.func
            if isinstance(func, ast.Attribute) and func.attr in READ_NAMES:
                self._record(node, scan.reads, 0, 1, func.attr.removesuffix("_present"))
            elif isinstance(func, ast.Name) and func.id in CLAMP_NAMES:
                self._record(node, scan.clamps, 1, 2, None)
            self.generic_visit(node)

        def _record(self, node, sink, key_pos, default_pos, getter):
            where = f"{self._rel_path}:{node.lineno}"
            try:
                key, default = _bind(node, key_pos, default_pos)
            except ValueError as e:
                scan.errors.append(f"{where}: {e}")
                return
            if not (isinstance(key, ast.Constant) and isinstance(key.value, str)):
                scan.errors.append(f"{where}: key is not a string constant")
                return
            if default is not None:
                default_src = ast.unparse(default)
            elif getter is not None:
                default_src = _READ_SIGNATURE_DEFAULTS[getter]
            else:
                scan.errors.append(f"{where}: clamp call without a default")
                return
            sink.setdefault(key.value, set()).add((self._module, default_src))

    for path in sorted(app_dir.rglob("*.py")):
        rel = path.relative_to(app_dir.parent)
        module = ".".join(rel.with_suffix("").parts).removesuffix(".__init__")
        tree = ast.parse(path.read_text(), filename=str(path))
        _Visitor(str(rel), module).visit(tree)
    return scan


@pytest.fixture(scope="module")
def scan():
    return collect(APP_DIR)


def test_rule1_every_key_is_a_bindable_constant(scan):
    assert scan.errors == []


def test_rule2_key_sets_match_classification(scan):
    read_keys = set(scan.reads)
    clamp_keys = set(scan.clamps)
    assert read_keys - HONOUR_KEYS == set(), "unclassified plain reads"
    assert HONOUR_KEYS - read_keys == set(), "HONOUR_KEYS entries no longer read"
    assert clamp_keys - FR3_KEYS == set(), "unclassified clamp reads"
    assert FR3_KEYS - clamp_keys == set(), "FR3_KEYS entries no longer clamped"


def test_rule3_read_and_clamp_sets_are_disjoint(scan):
    assert set(scan.reads) & set(scan.clamps) == set()


def test_rule4_each_key_has_one_default(scan):
    defaults: dict[str, set[str]] = {}
    for sites in (scan.reads, scan.clamps):
        for key, entries in sites.items():
            defaults.setdefault(key, set()).update(d for _, d in entries)
    assert {k: d for k, d in defaults.items() if len(d) > 1} == {}


def test_rule5_zero_sensitive_honour_keys_are_justified():
    sensitive = {k for k in HONOUR_KEYS if _ZERO_SENSITIVE.search(k)}
    assert sensitive - ZERO_IS_LEGIT.keys() == set()
    assert ZERO_IS_LEGIT.keys() - HONOUR_KEYS == set()


def test_rule6_every_fr3_key_has_a_test_literal():
    this_file = Path(__file__).resolve()
    corpus = "\n".join(
        p.read_text() for p in sorted(TESTS_DIR.glob("*.py")) if p.resolve() != this_file
    )
    assert {k for k in FR3_KEYS if f'"{k}"' not in corpus} == set()
