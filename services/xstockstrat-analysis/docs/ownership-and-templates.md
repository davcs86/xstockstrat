# Owner-keyed evidence, identity threading & templates (feature 224)

> On-demand detail relocated from `CLAUDE.md` (context-forge just-in-time move). Owner-keyed evidence, identity threading, unreadable-formula verdicts, the blend-id guard, seeded templates and the template saga.

- **Migration `026_owner_dimension_templates`** (`-- requires-env: SEED_USER_ID`): backfills
  `backtest_runs.user_id` (a legacy run gets its strategy's owner when exactly one owner holds that
  `strategy_id`, else `SEED_USER_ID`; `027` re-applies it and sets NOT NULL), adds `user_id` to
  `backtest_run_symbols`/`backtest_details`, creates `strategy_scores_v2` (SQL-seeded only for
  unambiguous ids; ambiguous `(user_id, strategy_id)` pairs are recomputed at boot, at most
  `_BOOT_RECOMPUTE_MAX_PAIRS` = 50 per pass), `strategy_templates`, `template_intents`, and the
  strategy `origin_template_*` columns.
- **Evidence and run history are owner-scoped** (eligibility, `ListBacktests`,
  `GetStrategyAnalytics`). `GetBacktest` of a run the caller does not own (or an ownerless run) →
  `PERMISSION_DENIED` for every caller, admins included. ADMIN foreign reads of strategies emit
  `audit.admin_read` and fail closed `UNAVAILABLE` if the ledger append fails.
- **Identity threading.** Every analysis → ingest / indicators call carries a non-empty owner
  `x-user-id`, or the SAN-bound `system` identity (fundsignal: `analysis-fundsignal`; the live loop's
  system-signal drain: `analysis-system-read`). The former whole-channel `x-internal-caller: analysis`
  interceptor is gone.
- **Unreadable formula.** An indicators refusal of a formula is `UNREADABLE_FORMULA_CODES`
  (`NOT_FOUND` **or** `PERMISSION_DENIED` on `ExecuteFormula`), logged once per evaluator
  (`unreadable_formulas`).
  - A backtest raises `FormulaExecutionError` (`FORMULA_ERROR`, excluded from evidence), with the
    run warning `backtest symbol <SYM> not evaluated: <CODE>`. Unchanged.
  - Every non-backtest path that traces readiness (`_compute_opportunities`, `EvaluateReadiness`,
    the kick / `GetWatchlistReadiness`, the materializer, the daily refresh, the heal) passes a
    private per-call sink. A refused formula that the traced rule references yields a RESOLVED
    0-of-0 `formula_unreadable` verdict (`bar_epoch >= 0`; feature 289). An unreferenced refused
    component is skipped. A real `FormulaExecutionError` or outage `RpcError` still propagates.
  - The live loop has no sink: `NOT_FOUND` skips the component and `PERMISSION_DENIED` isolates the
    pair. On an OR rule it may therefore fire while the queue shows "formula not readable"
    (recorded Open Risk, `@AC-5 @feature-224`). Outage batch loss in the kick / materializer / heal
    is the open defect `docs/reports/2026-11-05-analysis-readiness-batch-loss-on-indicator-outage-defect.md`.
- **Blend-id guard.** `_require_admin_for_blend_id` refuses a non-admin REGISTER or
  `InstantiateTemplate` of the configured blend id (`FAILED_PRECONDITION`, checked on the final id);
  `blend_strategy_id(cfg)` is the sole reader of `analysis.engine.fundamentals_blend_strategy_id`.
- **Seeded templates and the seeded blend (feature 335).** `028_seed_strategy_templates` seeds 14
  `created_by = 'system'` strategy templates whose formula components name formula **template** ids
  seeded by indicators `008` (its down runs before that one's). System templates are read-only:
  `ManageTemplate` refuses UPDATE / RETIRE (`PERMISSION_DENIED`) even for admins, and
  `TemplateMeta.read_only` reports it; a catalog change ships as a new version-guarded migration, never
  a `DELETE`. The blend template instantiates as `fundamentals_macd_blend_copy` — an ordinary strategy,
  not governed by the fundamentals universe.
  `029_seed_fundamentals_blend_strategy` inserts `fundamentals_macd_blend` for the user
  `admin@localhost`, active and not live, and nothing when that user is missing or already owns it; its
  down is a no-op. It reads `identity.users(email, user_id)` — the one migration-time cross-schema
  read, so identity must migrate first. Consequences to know before touching that row: it can never be
  deactivated through the API (the blend protection), one `SetStrategyLive(true)` by that account makes a
  second permanently-live governed blend (only SQL or `engine.fundamentals_blend_enabled` undoes it),
  and while two users hold the id it is "ambiguous" for the boot recompute, which is harmless.
- **Strategy templates + saga.** `ListTemplates` / `ManageTemplate` (ADMIN only; system templates are
  read-only to admins too) /
  `InstantiateTemplate` over `analysis.strategy_templates`; a caller-chosen `strategy_id` the caller
  already owns → `ALREADY_EXISTS` before anything is written. A template with formula components runs a
  saga: a `template_intents` row (`PENDING`) → indicators `InstantiateTemplate` copies the formula
  templates as hidden pending rows → CAS `PENDING→COMMITTED` inside the strategy transaction → indicators
  `ResolveTemplateIntent` un-hides them; on failure `ABORTING` and the copies are hard-deleted. Saga
  calls to indicators carry `x-internal-caller: analysis-template-saga` (`_TEMPLATE_SAGA_CALLER` — a
  dedicated grant that outlives the `analysis` reader bypass). A `DurableSchedule` sweep
  (`run_template_intent_sweep_forever`, every `_INTENT_SWEEP_SECONDS` = 300) resolves `ABORTING`/
  `COMMITTED` intents and `PENDING` ones older than `_INTENT_STALE_SECONDS` = 900 (fixed invariants,
  not config keys).
