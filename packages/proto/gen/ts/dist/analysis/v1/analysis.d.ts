import { BinaryReader, BinaryWriter } from "@bufbuild/protobuf/wire";
import { type CallOptions, type ChannelCredentials, Client, type ClientOptions, type ClientUnaryCall, type handleUnaryCall, type Metadata, type ServiceError, type UntypedServiceImplementation } from "@grpc/grpc-js";
import { PageRequest, PageResponse, Timeframe, TimeRange } from "../../common/v1/common";
export declare const protobufPackage = "xstockstrat.analysis.v1";
export declare enum BacktestStatus {
    BACKTEST_STATUS_UNSPECIFIED = "BACKTEST_STATUS_UNSPECIFIED",
    BACKTEST_STATUS_OK = "BACKTEST_STATUS_OK",
    BACKTEST_STATUS_INSUFFICIENT_DATA = "BACKTEST_STATUS_INSUFFICIENT_DATA",
    UNRECOGNIZED = "UNRECOGNIZED"
}
export declare function backtestStatusFromJSON(object: any): BacktestStatus;
export declare function backtestStatusToJSON(object: BacktestStatus): string;
export declare function backtestStatusToNumber(object: BacktestStatus): number;
/**
 * Backtest capital-allocation model (feature 150). Closed set → enum (C-04).
 * A completed run records SIZING_MODE_LEGACY or SIZING_MODE_PORTFOLIO (never UNSPECIFIED);
 * UNSPECIFIED is a request-side "unset → legacy" default only.
 */
export declare enum SizingMode {
    /** SIZING_MODE_UNSPECIFIED - request default → the legacy serial per-symbol path */
    SIZING_MODE_UNSPECIFIED = "SIZING_MODE_UNSPECIFIED",
    /** SIZING_MODE_LEGACY - serial per-symbol compounding (the aggregate is Π(1+rᵢ)−1) */
    SIZING_MODE_LEGACY = "SIZING_MODE_LEGACY",
    /** SIZING_MODE_PORTFOLIO - one shared cash pool, concurrent positions, one equity curve */
    SIZING_MODE_PORTFOLIO = "SIZING_MODE_PORTFOLIO",
    UNRECOGNIZED = "UNRECOGNIZED"
}
export declare function sizingModeFromJSON(object: any): SizingMode;
export declare function sizingModeToJSON(object: SizingMode): string;
export declare function sizingModeToNumber(object: SizingMode): number;
/**
 * Which bar/price a backtest fills a signal at (feature 151). Closed set → enum (C-04).
 * A completed run records SAME_BAR_CLOSE or NEXT_BAR_OPEN (never UNSPECIFIED); UNSPECIFIED is a
 * request/config "not chosen" sentinel the servicer normalizes to SAME_BAR_CLOSE (legacy).
 */
export declare enum FillModel {
    /** FILL_MODEL_UNSPECIFIED - caller/config did not choose → resolves to SAME_BAR_CLOSE (legacy) */
    FILL_MODEL_UNSPECIFIED = "FILL_MODEL_UNSPECIFIED",
    /** FILL_MODEL_SAME_BAR_CLOSE - legacy: fill at bar i's close ± slippage (optimistically biased) */
    FILL_MODEL_SAME_BAR_CLOSE = "FILL_MODEL_SAME_BAR_CLOSE",
    /** FILL_MODEL_NEXT_BAR_OPEN - bias-free: fill a bar-i signal at bar (i+1)'s open ± slippage */
    FILL_MODEL_NEXT_BAR_OPEN = "FILL_MODEL_NEXT_BAR_OPEN",
    UNRECOGNIZED = "UNRECOGNIZED"
}
export declare function fillModelFromJSON(object: any): FillModel;
export declare function fillModelToJSON(object: FillModel): string;
export declare function fillModelToNumber(object: FillModel): number;
/** The engine's decision for a single bar. Closed set → enum (C-04). */
export declare enum BarAction {
    BAR_ACTION_UNSPECIFIED = "BAR_ACTION_UNSPECIFIED",
    /** BAR_ACTION_WARMUP - bar within the strategy's warm-up window */
    BAR_ACTION_WARMUP = "BAR_ACTION_WARMUP",
    /** BAR_ACTION_HOLD_FLAT - flat, no entry this bar */
    BAR_ACTION_HOLD_FLAT = "BAR_ACTION_HOLD_FLAT",
    /** BAR_ACTION_ENTER_LONG - opened a long position this bar */
    BAR_ACTION_ENTER_LONG = "BAR_ACTION_ENTER_LONG",
    /** BAR_ACTION_EXIT_LONG - closed a long position this bar */
    BAR_ACTION_EXIT_LONG = "BAR_ACTION_EXIT_LONG",
    /** BAR_ACTION_HOLD_LONG - holding an existing long, no exit this bar */
    BAR_ACTION_HOLD_LONG = "BAR_ACTION_HOLD_LONG",
    UNRECOGNIZED = "UNRECOGNIZED"
}
export declare function barActionFromJSON(object: any): BarAction;
export declare function barActionToJSON(object: BarAction): string;
export declare function barActionToNumber(object: BarAction): number;
/** Why a symbol produced zero trades. Closed set → enum (C-04). */
export declare enum NoTradeReason {
    /** NO_TRADE_REASON_UNSPECIFIED - symbol traded, or not classified */
    NO_TRADE_REASON_UNSPECIFIED = "NO_TRADE_REASON_UNSPECIFIED",
    /** NO_TRADE_REASON_ENTIRE_RANGE_WARMUP - the whole range was warm-up */
    NO_TRADE_REASON_ENTIRE_RANGE_WARMUP = "NO_TRADE_REASON_ENTIRE_RANGE_WARMUP",
    /** NO_TRADE_REASON_ENTRY_NEVER_TRUE - entry condition never satisfied */
    NO_TRADE_REASON_ENTRY_NEVER_TRUE = "NO_TRADE_REASON_ENTRY_NEVER_TRUE",
    /** NO_TRADE_REASON_INSUFFICIENT_CAPITAL - reserved; not emitted this version */
    NO_TRADE_REASON_INSUFFICIENT_CAPITAL = "NO_TRADE_REASON_INSUFFICIENT_CAPITAL",
    /** NO_TRADE_REASON_FORMULA_ERROR - a custom-formula component failed to execute / returned an out-of-contract series */
    NO_TRADE_REASON_FORMULA_ERROR = "NO_TRADE_REASON_FORMULA_ERROR",
    UNRECOGNIZED = "UNRECOGNIZED"
}
export declare function noTradeReasonFromJSON(object: any): NoTradeReason;
export declare function noTradeReasonToJSON(object: NoTradeReason): string;
export declare function noTradeReasonToNumber(object: NoTradeReason): number;
export declare enum ComponentKind {
    COMPONENT_KIND_UNSPECIFIED = "COMPONENT_KIND_UNSPECIFIED",
    COMPONENT_KIND_BUILTIN_INDICATOR = "COMPONENT_KIND_BUILTIN_INDICATOR",
    COMPONENT_KIND_CUSTOM_FORMULA = "COMPONENT_KIND_CUSTOM_FORMULA",
    UNRECOGNIZED = "UNRECOGNIZED"
}
export declare function componentKindFromJSON(object: any): ComponentKind;
export declare function componentKindToJSON(object: ComponentKind): string;
export declare function componentKindToNumber(object: ComponentKind): number;
export declare enum StrategyOperation {
    STRATEGY_OPERATION_UNSPECIFIED = "STRATEGY_OPERATION_UNSPECIFIED",
    STRATEGY_OPERATION_REGISTER = "STRATEGY_OPERATION_REGISTER",
    STRATEGY_OPERATION_UPDATE = "STRATEGY_OPERATION_UPDATE",
    STRATEGY_OPERATION_DEACTIVATE = "STRATEGY_OPERATION_DEACTIVATE",
    /** STRATEGY_OPERATION_REACTIVATE - set active=TRUE; re-validates the stored definition (feature 089) */
    STRATEGY_OPERATION_REACTIVATE = "STRATEGY_OPERATION_REACTIVATE",
    UNRECOGNIZED = "UNRECOGNIZED"
}
export declare function strategyOperationFromJSON(object: any): StrategyOperation;
export declare function strategyOperationToJSON(object: StrategyOperation): string;
export declare function strategyOperationToNumber(object: StrategyOperation): number;
/** Comparator for a screen criterion's threshold test (closed set → enum). */
export declare enum Comparator {
    COMPARATOR_UNSPECIFIED = "COMPARATOR_UNSPECIFIED",
    COMPARATOR_LT = "COMPARATOR_LT",
    COMPARATOR_LTE = "COMPARATOR_LTE",
    COMPARATOR_GT = "COMPARATOR_GT",
    COMPARATOR_GTE = "COMPARATOR_GTE",
    /** COMPARATOR_BETWEEN - threshold <= x <= threshold_high */
    COMPARATOR_BETWEEN = "COMPARATOR_BETWEEN",
    UNRECOGNIZED = "UNRECOGNIZED"
}
export declare function comparatorFromJSON(object: any): Comparator;
export declare function comparatorToJSON(object: Comparator): string;
export declare function comparatorToNumber(object: Comparator): number;
/** What a screen criterion evaluates. */
export declare enum ScreenKind {
    SCREEN_KIND_UNSPECIFIED = "SCREEN_KIND_UNSPECIFIED",
    /** SCREEN_KIND_FUNDAMENTAL - a fundamental metric (metric_name) */
    SCREEN_KIND_FUNDAMENTAL = "SCREEN_KIND_FUNDAMENTAL",
    /** SCREEN_KIND_TECHNICAL_FORMULA - a custom formula (component) */
    SCREEN_KIND_TECHNICAL_FORMULA = "SCREEN_KIND_TECHNICAL_FORMULA",
    /** SCREEN_KIND_TECHNICAL_INDICATOR - a built-in indicator (component) */
    SCREEN_KIND_TECHNICAL_INDICATOR = "SCREEN_KIND_TECHNICAL_INDICATOR",
    /** SCREEN_KIND_SIGNAL - source-weighted signal blend */
    SCREEN_KIND_SIGNAL = "SCREEN_KIND_SIGNAL",
    UNRECOGNIZED = "UNRECOGNIZED"
}
export declare function screenKindFromJSON(object: any): ScreenKind;
export declare function screenKindToJSON(object: ScreenKind): string;
export declare function screenKindToNumber(object: ScreenKind): number;
export declare enum ScreenResultStatus {
    SCREEN_RESULT_STATUS_UNSPECIFIED = "SCREEN_RESULT_STATUS_UNSPECIFIED",
    SCREEN_RESULT_STATUS_OK = "SCREEN_RESULT_STATUS_OK",
    SCREEN_RESULT_STATUS_INSUFFICIENT_DATA = "SCREEN_RESULT_STATUS_INSUFFICIENT_DATA",
    UNRECOGNIZED = "UNRECOGNIZED"
}
export declare function screenResultStatusFromJSON(object: any): ScreenResultStatus;
export declare function screenResultStatusToJSON(object: ScreenResultStatus): string;
export declare function screenResultStatusToNumber(object: ScreenResultStatus): number;
/**
 * The action a ranked opportunity suggests. Closed set → enum (C-04).
 * TRIM/EXIT are deliberately collapsed into REDUCE — the platform must not
 * synthesize a "fully exit vs trim" boundary on a row that opens a real order
 * ticket; the human chooses trim vs exit at the ticket (design.md § 1).
 */
export declare enum OpportunityActionTag {
    OPPORTUNITY_ACTION_TAG_UNSPECIFIED = "OPPORTUNITY_ACTION_TAG_UNSPECIFIED",
    /** OPPORTUNITY_ACTION_TAG_ENTER - buy signal, not currently held */
    OPPORTUNITY_ACTION_TAG_ENTER = "OPPORTUNITY_ACTION_TAG_ENTER",
    /** OPPORTUNITY_ACTION_TAG_ADD - buy signal, already held */
    OPPORTUNITY_ACTION_TAG_ADD = "OPPORTUNITY_ACTION_TAG_ADD",
    /** OPPORTUNITY_ACTION_TAG_REDUCE - sell signal, held (trim or exit — human decides) */
    OPPORTUNITY_ACTION_TAG_REDUCE = "OPPORTUNITY_ACTION_TAG_REDUCE",
    UNRECOGNIZED = "UNRECOGNIZED"
}
export declare function opportunityActionTagFromJSON(object: any): OpportunityActionTag;
export declare function opportunityActionTagToJSON(object: OpportunityActionTag): string;
export declare function opportunityActionTagToNumber(object: OpportunityActionTag): number;
/** Per-condition-leaf evaluation state. Closed set → enum (C-04). */
export declare enum ConditionState {
    CONDITION_STATE_UNSPECIFIED = "CONDITION_STATE_UNSPECIFIED",
    /** CONDITION_STATE_PASS - leaf currently satisfied */
    CONDITION_STATE_PASS = "CONDITION_STATE_PASS",
    /** CONDITION_STATE_SOFT - within the soft-band of the threshold but not passing */
    CONDITION_STATE_SOFT = "CONDITION_STATE_SOFT",
    /** CONDITION_STATE_FAIL - not satisfied, outside the soft-band */
    CONDITION_STATE_FAIL = "CONDITION_STATE_FAIL",
    UNRECOGNIZED = "UNRECOGNIZED"
}
export declare function conditionStateFromJSON(object: any): ConditionState;
export declare function conditionStateToJSON(object: ConditionState): string;
export declare function conditionStateToNumber(object: ConditionState): number;
/** Which rule tree EvaluateReadiness traces (feature 138). Closed set → enum (C-04). */
export declare enum ReadinessRule {
    /** READINESS_RULE_UNSPECIFIED - server treats as ENTRY (back-compat default) */
    READINESS_RULE_UNSPECIFIED = "READINESS_RULE_UNSPECIFIED",
    /** READINESS_RULE_ENTRY - trace the entry_rule (ENTER candidates, watchlist readiness) */
    READINESS_RULE_ENTRY = "READINESS_RULE_ENTRY",
    /** READINESS_RULE_EXIT - trace the exit_rule (held REDUCE/ADD opportunities) */
    READINESS_RULE_EXIT = "READINESS_RULE_EXIT",
    UNRECOGNIZED = "UNRECOGNIZED"
}
export declare function readinessRuleFromJSON(object: any): ReadinessRule;
export declare function readinessRuleToJSON(object: ReadinessRule): string;
export declare function readinessRuleToNumber(object: ReadinessRule): number;
/** The persisted per-user disposition of a queued opportunity (feature 097). Closed set → enum (C-04). */
export declare enum OpportunityAction {
    OPPORTUNITY_ACTION_UNSPECIFIED = "OPPORTUNITY_ACTION_UNSPECIFIED",
    /** OPPORTUNITY_ACTION_SNOOZE - hide until snooze_until (bounded) */
    OPPORTUNITY_ACTION_SNOOZE = "OPPORTUNITY_ACTION_SNOOZE",
    /** OPPORTUNITY_ACTION_DISMISS - hide indefinitely */
    OPPORTUNITY_ACTION_DISMISS = "OPPORTUNITY_ACTION_DISMISS",
    /** OPPORTUNITY_ACTION_TAKE - user acted on it (feeds queue_share/taken reconciliation) */
    OPPORTUNITY_ACTION_TAKE = "OPPORTUNITY_ACTION_TAKE",
    UNRECOGNIZED = "UNRECOGNIZED"
}
export declare function opportunityActionFromJSON(object: any): OpportunityAction;
export declare function opportunityActionToJSON(object: OpportunityAction): string;
export declare function opportunityActionToNumber(object: OpportunityAction): number;
/** The order-lifecycle event a snapshot was captured at. */
export declare enum SnapshotEventType {
    SNAPSHOT_EVENT_TYPE_UNSPECIFIED = "SNAPSHOT_EVENT_TYPE_UNSPECIFIED",
    SNAPSHOT_EVENT_TYPE_ORDER_CREATED = "SNAPSHOT_EVENT_TYPE_ORDER_CREATED",
    SNAPSHOT_EVENT_TYPE_ORDER_FILLED = "SNAPSHOT_EVENT_TYPE_ORDER_FILLED",
    SNAPSHOT_EVENT_TYPE_ORDER_PARTIALLY_FILLED = "SNAPSHOT_EVENT_TYPE_ORDER_PARTIALLY_FILLED",
    SNAPSHOT_EVENT_TYPE_ORDER_CANCELLED = "SNAPSHOT_EVENT_TYPE_ORDER_CANCELLED",
    UNRECOGNIZED = "UNRECOGNIZED"
}
export declare function snapshotEventTypeFromJSON(object: any): SnapshotEventType;
export declare function snapshotEventTypeToJSON(object: SnapshotEventType): string;
export declare function snapshotEventTypeToNumber(object: SnapshotEventType): number;
/** Whether an attribution factor is an indicator value-range or a signal presence. */
export declare enum FactorType {
    FACTOR_TYPE_UNSPECIFIED = "FACTOR_TYPE_UNSPECIFIED",
    FACTOR_TYPE_INDICATOR = "FACTOR_TYPE_INDICATOR",
    FACTOR_TYPE_SIGNAL = "FACTOR_TYPE_SIGNAL",
    UNRECOGNIZED = "UNRECOGNIZED"
}
export declare function factorTypeFromJSON(object: any): FactorType;
export declare function factorTypeToJSON(object: FactorType): string;
export declare function factorTypeToNumber(object: FactorType): number;
export interface RunBacktestRequest {
    strategyId: string;
    range?: TimeRange | undefined;
    symbols: string[];
    initialCapital: number;
    strategyParams?: {
        [key: string]: any;
    } | undefined;
    /** field 6 — resolve definition from DB; legacy strategy_params (field 5) remains supported */
    strategyIdRef: string;
    /** field 7 — inline definition; takes precedence over strategy_id_ref if both supplied */
    inlineDefinition?: StrategyDefinition | undefined;
    /**
     * field 8 — capital-allocation model (feature 150); unset/UNSPECIFIED → legacy serial per-symbol
     * path (no behavior change for existing callers).
     */
    sizingMode: SizingMode;
    /**
     * field 9 — fill model (feature 151); unset/UNSPECIFIED → server default (config
     * analysis.backtest.default_fill_model, else legacy same-bar-close). No behavior change for
     * existing callers.
     */
    fillModel: FillModel;
}
export interface CoverageGap {
    symbol: string;
    timeframe: Timeframe;
    requestedRange?: TimeRange | undefined;
    barsHave: number;
    barsNeed: number;
    /** The range a caller should backfill to satisfy this backtest. */
    gap?: TimeRange | undefined;
}
/**
 * NOTE: this message's wire bytes are persisted verbatim in analysis.backtest_details
 * (feature 068, "store what you serve") — renumbering or retyping any field here or in
 * BarDiagnostic silently corrupts previously persisted runs. Additive changes only;
 * buf breaking guards this on every PR.
 */
export interface BacktestResult {
    backtestId: string;
    strategyId: string;
    totalReturn: number;
    annualizedReturn: number;
    sharpeRatio: number;
    maxDrawdown: number;
    winRate: number;
    totalTrades: number;
    profitFactor: number;
    completedAt?: Date | undefined;
    trades: TradeRecord[];
    status: BacktestStatus;
    /** populated per-symbol when status == INSUFFICIENT_DATA */
    coverageGaps: CoverageGap[];
    /** per-bar debug data for every simulated symbol (feature 064) */
    diagnostics: SymbolDiagnostics[];
    /**
     * Effective starting capital the engine seeded the simulation with (the 100k default
     * when the request omitted it) — required to rebuild the equity curve for a
     * historical run (feature 068).
     */
    initialCapital: number;
    /**
     * Human-readable run warnings surfaced to the user (feature 086), e.g. a strategy referenced a
     * formula that has since been soft-deleted — the run still completed using its last-saved
     * definition. Empty on a clean run.
     */
    warnings: string[];
    /** ── Portfolio sizing (feature 150) ── additive; empty/legacy for pre-150 and legacy-mode runs. */
    sizingMode: SizingMode;
    /** portfolio mode only; empty in legacy */
    capitalSkips: PortfolioCapitalSkip[];
    /**
     * Portfolio-level daily equity curve (cash + Σ marked-to-market positions), portfolio mode only.
     * NOTE: per-symbol BarDiagnostic.equity (field 15 there) stays per-symbol in portfolio mode — the
     * portfolio contribution lives ONLY here; do not read per-symbol equity as portfolio contribution.
     */
    portfolioEquityCurve: EquityPoint[];
    /** Effective fill model the run actually used (feature 151); never UNSPECIFIED on a completed run. */
    fillModel: FillModel;
}
/**
 * One entry that portfolio mode could not open because the shared pool was fully committed
 * at the policy weight (feature 150, FR-5). Emitted instead of a silent zero-sized fill.
 */
export interface PortfolioCapitalSkip {
    symbol: string;
    timestamp?: Date | undefined;
    /** position_weight × initial_capital the entry would have needed */
    intendedWeight: number;
    /** cash on hand in the shared pool at that bar */
    availableCash: number;
}
/** One point of the portfolio-level daily equity curve (cash + Σ marked-to-market positions). */
export interface EquityPoint {
    timestamp?: Date | undefined;
    equity: number;
}
export interface TradeRecord {
    symbol: string;
    side: string;
    qty: number;
    entryPrice: number;
    exitPrice: number;
    pnl: number;
    entryTime?: Date | undefined;
    exitTime?: Date | undefined;
}
/** One row of day-by-day backtest diagnostics for a single bar. */
export interface BarDiagnostic {
    symbol: string;
    barIndex: number;
    timestamp?: Date | undefined;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    vwap: number;
    /** present-only: a series is absent during its warm-up */
    indicators: {
        [key: string]: number;
    };
    warmup: boolean;
    signalScore: number;
    conviction: number;
    action: BarAction;
    /**
     * Portfolio value (cash + position * close) after this bar — the per-bar equity
     * point the time-based equity curve plots (feature 068).
     */
    equity: number;
}
export interface BarDiagnostic_IndicatorsEntry {
    key: string;
    value: number;
}
/** Per-symbol diagnostics bundle attached to a BacktestResult. */
export interface SymbolDiagnostics {
    symbol: string;
    bars: BarDiagnostic[];
    noTradeReason: NoTradeReason;
    barsTotal: number;
    warmupBars: number;
}
export interface ScoreStrategyRequest {
    strategyId: string;
    range?: TimeRange | undefined;
}
export interface StrategyScore {
    strategyId: string;
    overallScore: number;
    /** e.g. sharpe, drawdown, consistency */
    componentScores: {
        [key: string]: number;
    };
    /** A/B/C/D/F */
    rating: string;
    /** Evidence provenance for the derived cross-stock headline grade (feature 065). */
    evidenceSymbols: number;
    /** total trading days of evidence across those symbols */
    evidenceDays: number;
    /** true when evidence is below the symbol/day floor */
    provisional: boolean;
}
export interface StrategyScore_ComponentScoresEntry {
    key: string;
    value: number;
}
export interface StrategyReport {
    strategyId: string;
    latestBacktest?: BacktestResult | undefined;
    score?: StrategyScore | undefined;
    metadata?: {
        [key: string]: any;
    } | undefined;
}
export interface ListBacktestsRequest {
    strategyId: string;
    /** 0 → server default (most recent 20) */
    limit: number;
}
export interface BacktestRunSummary {
    backtestId: string;
    strategyId: string;
    status: BacktestStatus;
    totalReturn: number;
    annualizedReturn: number;
    sharpeRatio: number;
    maxDrawdown: number;
    winRate: number;
    totalTrades: number;
    profitFactor: number;
    symbols: string[];
    /** 0 when the run earned no score (e.g. INSUFFICIENT_DATA) */
    overallScore: number;
    /** "" when the run earned no score */
    rating: string;
    completedAt?: Date | undefined;
    /** Backtest range covered by this run (feature 065); unset on legacy rows. */
    rangeStart?: Date | undefined;
    rangeEnd?: Date | undefined;
    /** capital-allocation model the run used (feature 150); UNSPECIFIED on pre-150 rows */
    sizingMode: SizingMode;
    /** fill model the run used (feature 151); UNSPECIFIED on pre-151 rows */
    fillModel: FillModel;
}
export interface ListBacktestsResponse {
    runs: BacktestRunSummary[];
}
export interface GetBacktestRequest {
    backtestId: string;
}
export interface ListStrategiesRequest {
    page?: PageRequest | undefined;
    /**
     * DEPRECATED: caller identity resolved from the x-user-id header; body value ignored (feature 133).
     *
     * @deprecated
     */
    userId: string;
}
export interface ListStrategiesResponse {
    strategies: StrategyScore[];
    page?: PageResponse | undefined;
}
export interface GetStrategyReportRequest {
    strategyId: string;
}
export interface StrategyComponent {
    refName: string;
    kind: ComponentKind;
    /** used when kind == COMPONENT_KIND_BUILTIN_INDICATOR */
    indicator: string;
    /** used when kind == COMPONENT_KIND_CUSTOM_FORMULA */
    formulaId: string;
    params: {
        [key: string]: number;
    };
    /**
     * optional benchmark/reference symbol (feature 152): when non-empty the component is
     * computed on this symbol's bars (e.g. "VOO") and its output series is aligned onto the
     * evaluated symbol's bar timeline; empty = computed on the evaluated symbol (unchanged).
     */
    sourceSymbol: string;
}
export interface StrategyComponent_ParamsEntry {
    key: string;
    value: number;
}
export interface StrategyDefinition {
    strategyId: string;
    displayName: string;
    components: StrategyComponent[];
    /** JSON-encoded condition tree */
    entryRule: string;
    /** JSON-encoded condition tree */
    exitRule: string;
    signalParams?: {
        [key: string]: any;
    } | undefined;
    active: boolean;
    liveEnabled: boolean;
    /**
     * Per-symbol re-entry cooldown in calendar days (feature 069). optional = explicit presence:
     * unset → platform default (analysis.strategy.default_cooldown_days); explicit 0 → no cooldown
     * (immediate re-entry allowed); negative → rejected at write time (INVALID_ARGUMENT).
     */
    cooldownDays?: number | undefined;
    /**
     * Human-readable status warnings surfaced to the user on read (feature 086), e.g. a component
     * references a formula that has been soft-deleted — the strategy still evaluates (live and in
     * backtests) using the formula's last-saved definition, but the deletion is flagged. Populated
     * by GetStrategy; empty elsewhere.
     */
    warnings: string[];
    /**
     * Per-strategy minimum holding period in calendar days before exit_rule may fire a sell
     * (feature 116 — exit cooldown; mirrors cooldown_days but gates the exit transition).
     * optional = explicit presence: unset → platform default
     * (analysis.strategy.default_exit_cooldown_days); explicit 0 → no minimum hold (exit
     * permitted immediately, current behavior); negative → rejected at write time
     * (INVALID_ARGUMENT).
     */
    exitCooldownDays?: number | undefined;
    /**
     * Normalized-uppercase symbols this strategy must never evaluate FOR ENTRY (feature 132 —
     * entry-only deny). A held position on a denied symbol keeps exit tracing (the deny suppresses
     * only the entry edge, so an operator can always exit a position they already hold). Rides
     * definition_json (no column); maskable via ManageStrategyRequest.update_mask.
     */
    deniedSymbols: string[];
    /**
     * Owning user (feature 133). Server-authoritative: populated from the propagated
     * x-user-id header on ManageStrategy REGISTER, never accepted from the request body
     * (mirrors ListOpportunitiesRequest / portfolio ownership convention).
     */
    userId: string;
    /**
     * Gates whether the platform-wide active-signal term joins this strategy's evaluation universe
     * (feature 132). Plain bool (no optional) is intentional: absent ≡ false ≡ explicit-false resolve
     * identically. A strategy that sets BOTH a non-empty signal_params.symbols allowlist AND
     * signal_eligible=true is rejected INVALID_ARGUMENT at write time (the allowlist is already an
     * explicit universe override; signals would be redundant/contradictory). Rides definition_json;
     * maskable.
     */
    signalEligible: boolean;
}
export interface ManageStrategyRequest {
    operation: StrategyOperation;
    definition?: StrategyDefinition | undefined;
    /**
     * Feature 070 — partial update. Applies to STRATEGY_OPERATION_UPDATE only; ignored for
     * REGISTER/DEACTIVATE.
     *
     *   present  → MERGE: only the listed top-level StrategyDefinition paths are taken from
     *              `definition`; every other stored field is preserved. A masked path whose value
     *              is absent from the request CLEARS that field (AIP-161 semantics) — that is the
     *              only way to express "erase this", since proto3 gives `components`/`entry_rule`/
     *              `exit_rule` no field presence.
     *   absent   → FULL REPLACE: byte-for-byte the pre-070 behavior, so existing clients (the
     *              StrategyWizard, which always sends a complete definition) are unaffected.
     *
     * Allowed paths: display_name, components, entry_rule, exit_rule, signal_params, cooldown_days,
     * exit_cooldown_days, denied_symbols, signal_eligible.
     * strategy_id/active/live_enabled are column-authoritative and rejected with INVALID_ARGUMENT.
     */
    updateMask?: string[] | undefined;
}
export interface GetStrategyRequest {
    strategyId: string;
}
export interface ListStrategyDefinitionsRequest {
    includeInactive: boolean;
    pageSize: number;
    pageOffset: number;
}
export interface ListStrategyDefinitionsResponse {
    definitions: StrategyDefinition[];
    totalCount: number;
}
export interface SetStrategyLiveRequest {
    strategyId: string;
    liveEnabled: boolean;
}
export interface SetStrategyLiveResponse {
    definition?: StrategyDefinition | undefined;
}
export interface ScreenCriterion {
    refName: string;
    kind: ScreenKind;
    /** FUNDAMENTAL only (e.g. "pe_ratio") */
    metricName: string;
    /** reused, for TECHNICAL_* kinds */
    component?: StrategyComponent | undefined;
    op: Comparator;
    threshold: number;
    /** for COMPARATOR_BETWEEN */
    thresholdHigh: number;
    /** contribution to the blended score */
    weight: number;
    /** true → failing this excludes the symbol */
    hardFilter: boolean;
}
export interface ScreenResult {
    symbol: string;
    score: number;
    /** per ref_name; skipped criteria are absent */
    criterionScores: {
        [key: string]: number;
    };
    passed: boolean;
    status: ScreenResultStatus;
    /** populated when status == INSUFFICIENT_DATA */
    gap?: CoverageGap | undefined;
    /**
     * Raw column values surfaced on the screener results table (feature 083, FR-8).
     * rsi/atr come from the analysis→indicators edge; ATR is a close-only approximation
     * (indicators_engine.py) — surfaced as a known accuracy caveat, not exact.
     * rev_growth is best-effort from Fundamentals.extra_metrics (0 when FMP omits it).
     */
    pe: number;
    rsi: number;
    atr: number;
    revGrowth: number;
    held: boolean;
    /**
     * Per-criterion raw readings + pass/fail, for single-symbol screening where the universe-relative
     * `score`/`criterion_scores` collapse to a content-free 0.5 (feature 125, FR-8). Populated from the
     * same engine-internal values `criterion_scores` already draws from, exposed directly instead of
     * normalized.
     */
    criterionRawValues: {
        [key: string]: number;
    };
    criterionPassed: {
        [key: string]: boolean;
    };
    /**
     * True when every criterion configured for this scan was skipped for this candidate (no
     * usable data for any of them, e.g. an ETF with no P/E ratio scanned against a `pe_ratio`
     * criterion) — `score`/`criterion_scores` still carry the same neutral-abstention values the
     * engine already used to keep the signal blend well-defined (`status` stays OK; this is the
     * soft-criterion sibling of the hard-filter null-as-zero fix, feature 144), but they are not a
     * real computed result and must not be treated as one (e.g. ranked/sorted as if genuine).
     */
    scoreUnavailable: boolean;
}
export interface ScreenResult_CriterionScoresEntry {
    key: string;
    value: number;
}
export interface ScreenResult_CriterionRawValuesEntry {
    key: string;
    value: number;
}
export interface ScreenResult_CriterionPassedEntry {
    key: string;
    value: boolean;
}
export interface ScreenSymbolsRequest {
    symbols: string[];
    criteria: ScreenCriterion[];
    /** Blend params — same names the extracted scoring module reads (kept consistent with backtest). */
    signalSources: string[];
    signalWeight: number;
    technicalWeight: number;
    minConviction: number;
    rankLimit: number;
    /** Reserved/optional — historical as-of is deferred (OQ-060-e); latest bar is the default. */
    evaluationWindow?: TimeRange | undefined;
}
export interface ScreenSymbolsResponse {
    results: ScreenResult[];
    coverageGaps: CoverageGap[];
}
export interface RunFundamentalsScanRequest {
    /** ignore the day's idempotency guard / re-emit */
    force: boolean;
    /** score + report but do not emit or spend cache calls */
    dryRun: boolean;
    /** optional explicit override of the computed universe */
    symbols: string[];
}
export interface FundamentalsScanSummary {
    runId: string;
    symbolsProcessed: number;
    signalsEmitted: number;
    callsSpent: number;
    deferredCount: number;
    /** "completed" | "budget_deferred" | "failed" */
    status: string;
    finishedAt?: Date | undefined;
}
/**
 * One ranked opportunity on the Decide queue. conviction is a deterministic
 * ordinal (passing/total leaves + normalized worst-distance-to-threshold), NOT a
 * probability — the UI renders "N/M conditions" + strength bars, never a fake %.
 */
export interface Opportunity {
    symbol: string;
    action: OpportunityActionTag;
    conviction: number;
    passingConditions: number;
    totalConditions: number;
    thesis: string;
    strategyId: string;
    source: string;
    validUntil?: Date | undefined;
    /** server-authoritative opaque key = user|symbol_norm|strategy_id (feature 097). Client echoes it verbatim to SetOpportunityAction, never derives it. */
    opportunityKey: string;
    /** contributing origins for a de-duplicated row (signal source(s) / "position" / "watchlist") */
    provenance: string[];
    /** feature 132 — the (symbol, strategy) pair is on the strategy's deny list; surfaced as an explicit muted row (never conviction=0) */
    muted: boolean;
    /**
     * Live-market enrichment (feature 095). 13/14/17 are READ-TIME live-market fields (set in
     * ListOpportunities after ranking — never in the ranking hot path, FR-8/AC-14); 15/16/18 are
     * COMPUTE-TIME strategy-derived fields (persisted in the row JSONB, carried by _row_to_opportunity).
     * 15/16 stay unset until the named `strategy-target-stop-authoring` follow-up populates
     * StrategyDefinition.signal_params.{target,stop}. All explicit-presence — an unset optional models
     * "unavailable", never a fabricated 0 (P-03, AC-8/AC-11).
     */
    livePrice?: number | undefined;
    changePct?: number | undefined;
    targetPrice?: number | undefined;
    stopPrice?: number | undefined;
    sparkline: SparklinePoint[];
    conditions: ConditionEval[];
}
/**
 * One recent daily-bar close for the Decide-surface sparkline (feature 095). Explicit presence — an
 * unset `close` models a warm-up/absent bar, never NaN/0 (mirrors IndicatorValue; P-03).
 */
export interface SparklinePoint {
    close?: number | undefined;
}
/** One evaluated condition leaf from the traced evaluator (feature 083). */
export interface ConditionEval {
    refName: string;
    lhsValue: number;
    threshold: number;
    /** >, <, >=, <=, crosses_above, crosses_below */
    fn: string;
    state: ConditionState;
    /** normalized */
    distanceToThreshold: number;
}
/** Per-symbol readiness — the traced evaluation of a strategy's entry rule. */
export interface SymbolReadiness {
    symbol: string;
    conviction: number;
    passingConditions: number;
    totalConditions: number;
    conditions: ConditionEval[];
}
/**
 * Per-strategy analytics for the Engine → Strategies surface. expectancy and
 * max_drawdown derive from persisted analysis.backtest_runs (win_rate +
 * profit_factor); signals_30d from ingest QuerySignals; taken from trading
 * ListOrders; queue_share from the opportunity-queue join.
 */
export interface StrategyAnalytics {
    strategyId: string;
    expectancy: number;
    blendedHitRate: number;
    maxDrawdown: number;
    signals30d: number;
    taken: number;
    queueShare: number;
}
/**
 * user_id is intentionally absent — taken from the propagated x-user-id header
 * server-side (matching the portfolio watchlist convention), never from the wire.
 */
export interface ListOpportunitiesRequest {
    page?: PageRequest | undefined;
    minConviction: number;
}
export interface ListOpportunitiesResponse {
    opportunities: Opportunity[];
    page?: PageResponse | undefined;
}
export interface EvaluateReadinessRequest {
    strategyId: string;
    symbols: string[];
    /**
     * feature 138 — which rule tree to trace. UNSPECIFIED == ENTRY (back-compat). The Signal-detail
     * "Why this fired" panel requests EXIT for a held (REDUCE/ADD) opportunity so it explains the
     * exit rule that actually fired, reconciling with the queue's exit-derived conviction; every
     * other caller (watchlist readiness) leaves it unset and keeps entry-rule tracing.
     */
    rule: ReadinessRule;
}
export interface EvaluateReadinessResponse {
    readiness: SymbolReadiness[];
}
/**
 * user_id is intentionally absent — taken from the propagated x-user-id header server-side
 * (match the ListOpportunitiesRequest convention), never from the wire.
 */
export interface SetOpportunityActionRequest {
    /** the server-issued key, echoed verbatim */
    opportunityKey: string;
    action: OpportunityAction;
    /** set only for SNOOZE; a bounded "snooze until" */
    snoozeUntil?: Date | undefined;
}
export interface SetOpportunityActionResponse {
}
export interface GetStrategyAnalyticsRequest {
    strategyId: string;
}
export interface GetIndicatorSeriesRequest {
    strategyId: string;
    symbol: string;
    /**
     * The caller's own already-fetched candlestick closes + their timestamps (the page passes the
     * exact bars it drew, so the x-axis is parity-aligned and no server re-fetch happens). closes
     * and times are index-aligned and equal length.
     */
    closes: number[];
    times: Date[];
}
export interface GetIndicatorSeriesResponse {
    /** Echoes the request times, index-aligned across every series in every component. */
    times: Date[];
    components: ComponentSeries[];
}
export interface ComponentSeries {
    refName: string;
    kind: ComponentKind;
    series: NamedSeries[];
    /**
     * Non-empty when this component failed to compute (soft-deleted formula, sandbox timeout, NaN
     * output); series is then empty and the UI renders a per-panel error state. Per-component fault
     * isolation — one bad component never fails the whole RPC.
     */
    error: string;
}
export interface NamedSeries {
    /**
     * "value" (primary) plus each secondary the component emits (bb.upper/bb.lower,
     * macd.signal/macd.histogram, stoch.d, or custom-formula output keys).
     */
    name: string;
    /**
     * Index-aligned with the response times. Each point is an IndicatorValue whose `value` is UNSET
     * for a warm-up-head or mid-series None, so a gap never round-trips as a fabricated 0.0 (feature
     * 125, AC-4a/P-03). A bare `google.protobuf.DoubleValue` element cannot do this — in a repeated
     * field an empty DoubleValue is byte-identical to DoubleValue(0.0) and serializes to JSON `0`, so
     * the wrapper is a message with a proto3 `optional double` (explicit presence: HasField works and
     * JSON omits an unset value) instead.
     */
    values: IndicatorValue[];
}
/** One point of an indicator series. `value` unset == a gap (warm-up head / NaN / None), never 0.0. */
export interface IndicatorValue {
    value?: number | undefined;
}
/** One signal active for the symbol at snapshot time; `value` is the ingest conviction (0.0–1.0). */
export interface SignalEntry {
    name: string;
    value: number;
    source: string;
}
/** A point-in-time capture of the indicator/signal/market context at an order event. */
export interface OrderSnapshot {
    orderId: string;
    positionId: string;
    symbol: string;
    eventType: SnapshotEventType;
    eventTs?: Date | undefined;
    side: string;
    quantity: number;
    price: number;
    ohlcvBar?: {
        [key: string]: any;
    } | undefined;
    indicatorValues: {
        [key: string]: number;
    };
    signals: SignalEntry[];
}
export interface OrderSnapshot_IndicatorValuesEntry {
    key: string;
    value: number;
}
/** A ranked attribution factor: an indicator value-range or a signal, with its avg realized-P&L impact. */
export interface PnLPatternFactor {
    factorName: string;
    factorType: FactorType;
    valueRangeLow: number;
    valueRangeHigh: number;
    sampleCount: number;
    avgPnlImpact: number;
}
export interface QueryPnLPatternsRequest {
    symbol: string;
    strategyId: string;
    fromTs?: Date | undefined;
    toTs?: Date | undefined;
    limit: number;
}
export interface QueryPnLPatternsResponse {
    positiveFactors: PnLPatternFactor[];
    negativeFactors: PnLPatternFactor[];
}
/** ── Signal-performance attribution (feature 029) ─────────────────────────────── */
export interface GetAttributionRequest {
    start?: Date | undefined;
    end?: Date | undefined;
    /** optional filter — the signal_sources.slug; empty = all sources (open registry, C-04: string not enum) */
    sourceId: string;
}
/**
 * Per-source metrics. trade_count/win_count are DOUBLE (not int32): FR-3's exact-tie case
 * contributes 0.5 to each tied source (AC-5); winner-takes-all contributes 1.0. total_pnl is
 * NET of fees (realized_pnl − fees_total). avg_return is a percent over an approximate cost basis.
 */
export interface SourceAttribution {
    /** signal_sources.slug (the snapshot's signal source) */
    sourceId: string;
    /** resolved via ingest ListSignalSources; falls back to the slug */
    sourceName: string;
    tradeCount: number;
    winCount: number;
    /** win_count / trade_count */
    winRate: number;
    /** mean per-trade net_pnl / cost_basis (percent, v1 approximation) */
    avgReturn: number;
    /** net of fees */
    totalPnl: number;
}
export interface GetAttributionResponse {
    attributions: SourceAttribution[];
}
export declare const RunBacktestRequest: MessageFns<RunBacktestRequest>;
export declare const CoverageGap: MessageFns<CoverageGap>;
export declare const BacktestResult: MessageFns<BacktestResult>;
export declare const PortfolioCapitalSkip: MessageFns<PortfolioCapitalSkip>;
export declare const EquityPoint: MessageFns<EquityPoint>;
export declare const TradeRecord: MessageFns<TradeRecord>;
export declare const BarDiagnostic: MessageFns<BarDiagnostic>;
export declare const BarDiagnostic_IndicatorsEntry: MessageFns<BarDiagnostic_IndicatorsEntry>;
export declare const SymbolDiagnostics: MessageFns<SymbolDiagnostics>;
export declare const ScoreStrategyRequest: MessageFns<ScoreStrategyRequest>;
export declare const StrategyScore: MessageFns<StrategyScore>;
export declare const StrategyScore_ComponentScoresEntry: MessageFns<StrategyScore_ComponentScoresEntry>;
export declare const StrategyReport: MessageFns<StrategyReport>;
export declare const ListBacktestsRequest: MessageFns<ListBacktestsRequest>;
export declare const BacktestRunSummary: MessageFns<BacktestRunSummary>;
export declare const ListBacktestsResponse: MessageFns<ListBacktestsResponse>;
export declare const GetBacktestRequest: MessageFns<GetBacktestRequest>;
export declare const ListStrategiesRequest: MessageFns<ListStrategiesRequest>;
export declare const ListStrategiesResponse: MessageFns<ListStrategiesResponse>;
export declare const GetStrategyReportRequest: MessageFns<GetStrategyReportRequest>;
export declare const StrategyComponent: MessageFns<StrategyComponent>;
export declare const StrategyComponent_ParamsEntry: MessageFns<StrategyComponent_ParamsEntry>;
export declare const StrategyDefinition: MessageFns<StrategyDefinition>;
export declare const ManageStrategyRequest: MessageFns<ManageStrategyRequest>;
export declare const GetStrategyRequest: MessageFns<GetStrategyRequest>;
export declare const ListStrategyDefinitionsRequest: MessageFns<ListStrategyDefinitionsRequest>;
export declare const ListStrategyDefinitionsResponse: MessageFns<ListStrategyDefinitionsResponse>;
export declare const SetStrategyLiveRequest: MessageFns<SetStrategyLiveRequest>;
export declare const SetStrategyLiveResponse: MessageFns<SetStrategyLiveResponse>;
export declare const ScreenCriterion: MessageFns<ScreenCriterion>;
export declare const ScreenResult: MessageFns<ScreenResult>;
export declare const ScreenResult_CriterionScoresEntry: MessageFns<ScreenResult_CriterionScoresEntry>;
export declare const ScreenResult_CriterionRawValuesEntry: MessageFns<ScreenResult_CriterionRawValuesEntry>;
export declare const ScreenResult_CriterionPassedEntry: MessageFns<ScreenResult_CriterionPassedEntry>;
export declare const ScreenSymbolsRequest: MessageFns<ScreenSymbolsRequest>;
export declare const ScreenSymbolsResponse: MessageFns<ScreenSymbolsResponse>;
export declare const RunFundamentalsScanRequest: MessageFns<RunFundamentalsScanRequest>;
export declare const FundamentalsScanSummary: MessageFns<FundamentalsScanSummary>;
export declare const Opportunity: MessageFns<Opportunity>;
export declare const SparklinePoint: MessageFns<SparklinePoint>;
export declare const ConditionEval: MessageFns<ConditionEval>;
export declare const SymbolReadiness: MessageFns<SymbolReadiness>;
export declare const StrategyAnalytics: MessageFns<StrategyAnalytics>;
export declare const ListOpportunitiesRequest: MessageFns<ListOpportunitiesRequest>;
export declare const ListOpportunitiesResponse: MessageFns<ListOpportunitiesResponse>;
export declare const EvaluateReadinessRequest: MessageFns<EvaluateReadinessRequest>;
export declare const EvaluateReadinessResponse: MessageFns<EvaluateReadinessResponse>;
export declare const SetOpportunityActionRequest: MessageFns<SetOpportunityActionRequest>;
export declare const SetOpportunityActionResponse: MessageFns<SetOpportunityActionResponse>;
export declare const GetStrategyAnalyticsRequest: MessageFns<GetStrategyAnalyticsRequest>;
export declare const GetIndicatorSeriesRequest: MessageFns<GetIndicatorSeriesRequest>;
export declare const GetIndicatorSeriesResponse: MessageFns<GetIndicatorSeriesResponse>;
export declare const ComponentSeries: MessageFns<ComponentSeries>;
export declare const NamedSeries: MessageFns<NamedSeries>;
export declare const IndicatorValue: MessageFns<IndicatorValue>;
export declare const SignalEntry: MessageFns<SignalEntry>;
export declare const OrderSnapshot: MessageFns<OrderSnapshot>;
export declare const OrderSnapshot_IndicatorValuesEntry: MessageFns<OrderSnapshot_IndicatorValuesEntry>;
export declare const PnLPatternFactor: MessageFns<PnLPatternFactor>;
export declare const QueryPnLPatternsRequest: MessageFns<QueryPnLPatternsRequest>;
export declare const QueryPnLPatternsResponse: MessageFns<QueryPnLPatternsResponse>;
export declare const GetAttributionRequest: MessageFns<GetAttributionRequest>;
export declare const SourceAttribution: MessageFns<SourceAttribution>;
export declare const GetAttributionResponse: MessageFns<GetAttributionResponse>;
export type AnalysisServiceService = typeof AnalysisServiceService;
export declare const AnalysisServiceService: {
    readonly runBacktest: {
        readonly path: "/xstockstrat.analysis.v1.AnalysisService/RunBacktest";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: RunBacktestRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => RunBacktestRequest;
        readonly responseSerialize: (value: BacktestResult) => Buffer;
        readonly responseDeserialize: (value: Buffer) => BacktestResult;
    };
    readonly scoreStrategy: {
        readonly path: "/xstockstrat.analysis.v1.AnalysisService/ScoreStrategy";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: ScoreStrategyRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => ScoreStrategyRequest;
        readonly responseSerialize: (value: StrategyScore) => Buffer;
        readonly responseDeserialize: (value: Buffer) => StrategyScore;
    };
    readonly listStrategies: {
        readonly path: "/xstockstrat.analysis.v1.AnalysisService/ListStrategies";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: ListStrategiesRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => ListStrategiesRequest;
        readonly responseSerialize: (value: ListStrategiesResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => ListStrategiesResponse;
    };
    readonly getStrategyReport: {
        readonly path: "/xstockstrat.analysis.v1.AnalysisService/GetStrategyReport";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: GetStrategyReportRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => GetStrategyReportRequest;
        readonly responseSerialize: (value: StrategyReport) => Buffer;
        readonly responseDeserialize: (value: Buffer) => StrategyReport;
    };
    /** List past backtest runs (summary metrics + earned score) for a strategy, newest first. */
    readonly listBacktests: {
        readonly path: "/xstockstrat.analysis.v1.AnalysisService/ListBacktests";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: ListBacktestsRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => ListBacktestsRequest;
        readonly responseSerialize: (value: ListBacktestsResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => ListBacktestsResponse;
    };
    /**
     * Fetch the persisted full result (trades, per-bar equity, diagnostics) of a past run
     * (feature 068). NOT_FOUND when the run has no persisted detail (legacy/evicted/
     * INSUFFICIENT_DATA runs).
     */
    readonly getBacktest: {
        readonly path: "/xstockstrat.analysis.v1.AnalysisService/GetBacktest";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: GetBacktestRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => GetBacktestRequest;
        readonly responseSerialize: (value: BacktestResult) => Buffer;
        readonly responseDeserialize: (value: Buffer) => BacktestResult;
    };
    readonly manageStrategy: {
        readonly path: "/xstockstrat.analysis.v1.AnalysisService/ManageStrategy";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: ManageStrategyRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => ManageStrategyRequest;
        readonly responseSerialize: (value: StrategyDefinition) => Buffer;
        readonly responseDeserialize: (value: Buffer) => StrategyDefinition;
    };
    readonly getStrategy: {
        readonly path: "/xstockstrat.analysis.v1.AnalysisService/GetStrategy";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: GetStrategyRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => GetStrategyRequest;
        readonly responseSerialize: (value: StrategyDefinition) => Buffer;
        readonly responseDeserialize: (value: Buffer) => StrategyDefinition;
    };
    readonly listStrategyDefinitions: {
        readonly path: "/xstockstrat.analysis.v1.AnalysisService/ListStrategyDefinitions";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: ListStrategyDefinitionsRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => ListStrategyDefinitionsRequest;
        readonly responseSerialize: (value: ListStrategyDefinitionsResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => ListStrategyDefinitionsResponse;
    };
    readonly setStrategyLive: {
        readonly path: "/xstockstrat.analysis.v1.AnalysisService/SetStrategyLive";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: SetStrategyLiveRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => SetStrategyLiveRequest;
        readonly responseSerialize: (value: SetStrategyLiveResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => SetStrategyLiveResponse;
    };
    /** Screen a symbol universe against weighted criteria (feature 060) */
    readonly screenSymbols: {
        readonly path: "/xstockstrat.analysis.v1.AnalysisService/ScreenSymbols";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: ScreenSymbolsRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => ScreenSymbolsRequest;
        readonly responseSerialize: (value: ScreenSymbolsResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => ScreenSymbolsResponse;
    };
    /** Manually trigger the fundamentals signal producer scan (feature 062, admin-scoped) */
    readonly runFundamentalsScan: {
        readonly path: "/xstockstrat.analysis.v1.AnalysisService/RunFundamentalsScan";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: RunFundamentalsScanRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => RunFundamentalsScanRequest;
        readonly responseSerialize: (value: FundamentalsScanSummary) => Buffer;
        readonly responseDeserialize: (value: Buffer) => FundamentalsScanSummary;
    };
    /**
     * ── Opportunity queue + readiness + per-strategy analytics (feature 083) ─────
     * Ranked opportunity queue for the Decide surface. Aggregates ingest signals,
     * held positions, and the conviction/readiness evaluator (zero new edges).
     */
    readonly listOpportunities: {
        readonly path: "/xstockstrat.analysis.v1.AnalysisService/ListOpportunities";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: ListOpportunitiesRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => ListOpportunitiesRequest;
        readonly responseSerialize: (value: ListOpportunitiesResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => ListOpportunitiesResponse;
    };
    /**
     * Per-symbol live condition evaluation (traced): passing/soft/failing leaves +
     * distance-to-threshold. Feeds Signal-detail, Watchlist readiness, and the queue.
     */
    readonly evaluateReadiness: {
        readonly path: "/xstockstrat.analysis.v1.AnalysisService/EvaluateReadiness";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: EvaluateReadinessRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => EvaluateReadinessRequest;
        readonly responseSerialize: (value: EvaluateReadinessResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => EvaluateReadinessResponse;
    };
    /** Persist a per-user disposition (snooze/dismiss/take) against a server-issued opportunity_key (feature 097). */
    readonly setOpportunityAction: {
        readonly path: "/xstockstrat.analysis.v1.AnalysisService/SetOpportunityAction";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: SetOpportunityActionRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => SetOpportunityActionRequest;
        readonly responseSerialize: (value: SetOpportunityActionResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => SetOpportunityActionResponse;
    };
    /** Per-strategy analytics (expectancy / hit-rate / max-DD / signals / taken / queue-share). */
    readonly getStrategyAnalytics: {
        readonly path: "/xstockstrat.analysis.v1.AnalysisService/GetStrategyAnalytics";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: GetStrategyAnalyticsRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => GetStrategyAnalyticsRequest;
        readonly responseSerialize: (value: StrategyAnalytics) => Buffer;
        readonly responseDeserialize: (value: Buffer) => StrategyAnalytics;
    };
    /**
     * Per-component historical indicator series for a strategy over a caller-supplied bar window,
     * for the unified Symbol page's overlay panels (feature 125, FR-6). Reuses the analysis
     * evaluator's own _compute_component per declared component in a dedicated handler loop — never
     * the shared evaluate_conditions_traced (which ListOpportunities' exit trace depends on).
     */
    readonly getIndicatorSeries: {
        readonly path: "/xstockstrat.analysis.v1.AnalysisService/GetIndicatorSeries";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: GetIndicatorSeriesRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => GetIndicatorSeriesRequest;
        readonly responseSerialize: (value: GetIndicatorSeriesResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => GetIndicatorSeriesResponse;
    };
    /**
     * Ranked P&L-attribution factors (feature 042): which indicator value-ranges and signals
     * correlate with positive vs negative realized P&L, scoped by symbol/strategy/time window.
     */
    readonly queryPnLPatterns: {
        readonly path: "/xstockstrat.analysis.v1.AnalysisService/QueryPnLPatterns";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: QueryPnLPatternsRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => QueryPnLPatternsRequest;
        readonly responseSerialize: (value: QueryPnLPatternsResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => QueryPnLPatternsResponse;
    };
    /**
     * Per-source trading-performance attribution over closed positions (feature 029). Read-only;
     * aggregates 042's analysis.pnl_positions + order_snapshots.signals. Owner-scoped via x-user-id.
     */
    readonly getAttribution: {
        readonly path: "/xstockstrat.analysis.v1.AnalysisService/GetAttribution";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: GetAttributionRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => GetAttributionRequest;
        readonly responseSerialize: (value: GetAttributionResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => GetAttributionResponse;
    };
};
export interface AnalysisServiceServer extends UntypedServiceImplementation {
    runBacktest: handleUnaryCall<RunBacktestRequest, BacktestResult>;
    scoreStrategy: handleUnaryCall<ScoreStrategyRequest, StrategyScore>;
    listStrategies: handleUnaryCall<ListStrategiesRequest, ListStrategiesResponse>;
    getStrategyReport: handleUnaryCall<GetStrategyReportRequest, StrategyReport>;
    /** List past backtest runs (summary metrics + earned score) for a strategy, newest first. */
    listBacktests: handleUnaryCall<ListBacktestsRequest, ListBacktestsResponse>;
    /**
     * Fetch the persisted full result (trades, per-bar equity, diagnostics) of a past run
     * (feature 068). NOT_FOUND when the run has no persisted detail (legacy/evicted/
     * INSUFFICIENT_DATA runs).
     */
    getBacktest: handleUnaryCall<GetBacktestRequest, BacktestResult>;
    manageStrategy: handleUnaryCall<ManageStrategyRequest, StrategyDefinition>;
    getStrategy: handleUnaryCall<GetStrategyRequest, StrategyDefinition>;
    listStrategyDefinitions: handleUnaryCall<ListStrategyDefinitionsRequest, ListStrategyDefinitionsResponse>;
    setStrategyLive: handleUnaryCall<SetStrategyLiveRequest, SetStrategyLiveResponse>;
    /** Screen a symbol universe against weighted criteria (feature 060) */
    screenSymbols: handleUnaryCall<ScreenSymbolsRequest, ScreenSymbolsResponse>;
    /** Manually trigger the fundamentals signal producer scan (feature 062, admin-scoped) */
    runFundamentalsScan: handleUnaryCall<RunFundamentalsScanRequest, FundamentalsScanSummary>;
    /**
     * ── Opportunity queue + readiness + per-strategy analytics (feature 083) ─────
     * Ranked opportunity queue for the Decide surface. Aggregates ingest signals,
     * held positions, and the conviction/readiness evaluator (zero new edges).
     */
    listOpportunities: handleUnaryCall<ListOpportunitiesRequest, ListOpportunitiesResponse>;
    /**
     * Per-symbol live condition evaluation (traced): passing/soft/failing leaves +
     * distance-to-threshold. Feeds Signal-detail, Watchlist readiness, and the queue.
     */
    evaluateReadiness: handleUnaryCall<EvaluateReadinessRequest, EvaluateReadinessResponse>;
    /** Persist a per-user disposition (snooze/dismiss/take) against a server-issued opportunity_key (feature 097). */
    setOpportunityAction: handleUnaryCall<SetOpportunityActionRequest, SetOpportunityActionResponse>;
    /** Per-strategy analytics (expectancy / hit-rate / max-DD / signals / taken / queue-share). */
    getStrategyAnalytics: handleUnaryCall<GetStrategyAnalyticsRequest, StrategyAnalytics>;
    /**
     * Per-component historical indicator series for a strategy over a caller-supplied bar window,
     * for the unified Symbol page's overlay panels (feature 125, FR-6). Reuses the analysis
     * evaluator's own _compute_component per declared component in a dedicated handler loop — never
     * the shared evaluate_conditions_traced (which ListOpportunities' exit trace depends on).
     */
    getIndicatorSeries: handleUnaryCall<GetIndicatorSeriesRequest, GetIndicatorSeriesResponse>;
    /**
     * Ranked P&L-attribution factors (feature 042): which indicator value-ranges and signals
     * correlate with positive vs negative realized P&L, scoped by symbol/strategy/time window.
     */
    queryPnLPatterns: handleUnaryCall<QueryPnLPatternsRequest, QueryPnLPatternsResponse>;
    /**
     * Per-source trading-performance attribution over closed positions (feature 029). Read-only;
     * aggregates 042's analysis.pnl_positions + order_snapshots.signals. Owner-scoped via x-user-id.
     */
    getAttribution: handleUnaryCall<GetAttributionRequest, GetAttributionResponse>;
}
export interface AnalysisServiceClient extends Client {
    runBacktest(request: RunBacktestRequest, callback: (error: ServiceError | null, response: BacktestResult) => void): ClientUnaryCall;
    runBacktest(request: RunBacktestRequest, metadata: Metadata, callback: (error: ServiceError | null, response: BacktestResult) => void): ClientUnaryCall;
    runBacktest(request: RunBacktestRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: BacktestResult) => void): ClientUnaryCall;
    scoreStrategy(request: ScoreStrategyRequest, callback: (error: ServiceError | null, response: StrategyScore) => void): ClientUnaryCall;
    scoreStrategy(request: ScoreStrategyRequest, metadata: Metadata, callback: (error: ServiceError | null, response: StrategyScore) => void): ClientUnaryCall;
    scoreStrategy(request: ScoreStrategyRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: StrategyScore) => void): ClientUnaryCall;
    listStrategies(request: ListStrategiesRequest, callback: (error: ServiceError | null, response: ListStrategiesResponse) => void): ClientUnaryCall;
    listStrategies(request: ListStrategiesRequest, metadata: Metadata, callback: (error: ServiceError | null, response: ListStrategiesResponse) => void): ClientUnaryCall;
    listStrategies(request: ListStrategiesRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: ListStrategiesResponse) => void): ClientUnaryCall;
    getStrategyReport(request: GetStrategyReportRequest, callback: (error: ServiceError | null, response: StrategyReport) => void): ClientUnaryCall;
    getStrategyReport(request: GetStrategyReportRequest, metadata: Metadata, callback: (error: ServiceError | null, response: StrategyReport) => void): ClientUnaryCall;
    getStrategyReport(request: GetStrategyReportRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: StrategyReport) => void): ClientUnaryCall;
    /** List past backtest runs (summary metrics + earned score) for a strategy, newest first. */
    listBacktests(request: ListBacktestsRequest, callback: (error: ServiceError | null, response: ListBacktestsResponse) => void): ClientUnaryCall;
    listBacktests(request: ListBacktestsRequest, metadata: Metadata, callback: (error: ServiceError | null, response: ListBacktestsResponse) => void): ClientUnaryCall;
    listBacktests(request: ListBacktestsRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: ListBacktestsResponse) => void): ClientUnaryCall;
    /**
     * Fetch the persisted full result (trades, per-bar equity, diagnostics) of a past run
     * (feature 068). NOT_FOUND when the run has no persisted detail (legacy/evicted/
     * INSUFFICIENT_DATA runs).
     */
    getBacktest(request: GetBacktestRequest, callback: (error: ServiceError | null, response: BacktestResult) => void): ClientUnaryCall;
    getBacktest(request: GetBacktestRequest, metadata: Metadata, callback: (error: ServiceError | null, response: BacktestResult) => void): ClientUnaryCall;
    getBacktest(request: GetBacktestRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: BacktestResult) => void): ClientUnaryCall;
    manageStrategy(request: ManageStrategyRequest, callback: (error: ServiceError | null, response: StrategyDefinition) => void): ClientUnaryCall;
    manageStrategy(request: ManageStrategyRequest, metadata: Metadata, callback: (error: ServiceError | null, response: StrategyDefinition) => void): ClientUnaryCall;
    manageStrategy(request: ManageStrategyRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: StrategyDefinition) => void): ClientUnaryCall;
    getStrategy(request: GetStrategyRequest, callback: (error: ServiceError | null, response: StrategyDefinition) => void): ClientUnaryCall;
    getStrategy(request: GetStrategyRequest, metadata: Metadata, callback: (error: ServiceError | null, response: StrategyDefinition) => void): ClientUnaryCall;
    getStrategy(request: GetStrategyRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: StrategyDefinition) => void): ClientUnaryCall;
    listStrategyDefinitions(request: ListStrategyDefinitionsRequest, callback: (error: ServiceError | null, response: ListStrategyDefinitionsResponse) => void): ClientUnaryCall;
    listStrategyDefinitions(request: ListStrategyDefinitionsRequest, metadata: Metadata, callback: (error: ServiceError | null, response: ListStrategyDefinitionsResponse) => void): ClientUnaryCall;
    listStrategyDefinitions(request: ListStrategyDefinitionsRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: ListStrategyDefinitionsResponse) => void): ClientUnaryCall;
    setStrategyLive(request: SetStrategyLiveRequest, callback: (error: ServiceError | null, response: SetStrategyLiveResponse) => void): ClientUnaryCall;
    setStrategyLive(request: SetStrategyLiveRequest, metadata: Metadata, callback: (error: ServiceError | null, response: SetStrategyLiveResponse) => void): ClientUnaryCall;
    setStrategyLive(request: SetStrategyLiveRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: SetStrategyLiveResponse) => void): ClientUnaryCall;
    /** Screen a symbol universe against weighted criteria (feature 060) */
    screenSymbols(request: ScreenSymbolsRequest, callback: (error: ServiceError | null, response: ScreenSymbolsResponse) => void): ClientUnaryCall;
    screenSymbols(request: ScreenSymbolsRequest, metadata: Metadata, callback: (error: ServiceError | null, response: ScreenSymbolsResponse) => void): ClientUnaryCall;
    screenSymbols(request: ScreenSymbolsRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: ScreenSymbolsResponse) => void): ClientUnaryCall;
    /** Manually trigger the fundamentals signal producer scan (feature 062, admin-scoped) */
    runFundamentalsScan(request: RunFundamentalsScanRequest, callback: (error: ServiceError | null, response: FundamentalsScanSummary) => void): ClientUnaryCall;
    runFundamentalsScan(request: RunFundamentalsScanRequest, metadata: Metadata, callback: (error: ServiceError | null, response: FundamentalsScanSummary) => void): ClientUnaryCall;
    runFundamentalsScan(request: RunFundamentalsScanRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: FundamentalsScanSummary) => void): ClientUnaryCall;
    /**
     * ── Opportunity queue + readiness + per-strategy analytics (feature 083) ─────
     * Ranked opportunity queue for the Decide surface. Aggregates ingest signals,
     * held positions, and the conviction/readiness evaluator (zero new edges).
     */
    listOpportunities(request: ListOpportunitiesRequest, callback: (error: ServiceError | null, response: ListOpportunitiesResponse) => void): ClientUnaryCall;
    listOpportunities(request: ListOpportunitiesRequest, metadata: Metadata, callback: (error: ServiceError | null, response: ListOpportunitiesResponse) => void): ClientUnaryCall;
    listOpportunities(request: ListOpportunitiesRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: ListOpportunitiesResponse) => void): ClientUnaryCall;
    /**
     * Per-symbol live condition evaluation (traced): passing/soft/failing leaves +
     * distance-to-threshold. Feeds Signal-detail, Watchlist readiness, and the queue.
     */
    evaluateReadiness(request: EvaluateReadinessRequest, callback: (error: ServiceError | null, response: EvaluateReadinessResponse) => void): ClientUnaryCall;
    evaluateReadiness(request: EvaluateReadinessRequest, metadata: Metadata, callback: (error: ServiceError | null, response: EvaluateReadinessResponse) => void): ClientUnaryCall;
    evaluateReadiness(request: EvaluateReadinessRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: EvaluateReadinessResponse) => void): ClientUnaryCall;
    /** Persist a per-user disposition (snooze/dismiss/take) against a server-issued opportunity_key (feature 097). */
    setOpportunityAction(request: SetOpportunityActionRequest, callback: (error: ServiceError | null, response: SetOpportunityActionResponse) => void): ClientUnaryCall;
    setOpportunityAction(request: SetOpportunityActionRequest, metadata: Metadata, callback: (error: ServiceError | null, response: SetOpportunityActionResponse) => void): ClientUnaryCall;
    setOpportunityAction(request: SetOpportunityActionRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: SetOpportunityActionResponse) => void): ClientUnaryCall;
    /** Per-strategy analytics (expectancy / hit-rate / max-DD / signals / taken / queue-share). */
    getStrategyAnalytics(request: GetStrategyAnalyticsRequest, callback: (error: ServiceError | null, response: StrategyAnalytics) => void): ClientUnaryCall;
    getStrategyAnalytics(request: GetStrategyAnalyticsRequest, metadata: Metadata, callback: (error: ServiceError | null, response: StrategyAnalytics) => void): ClientUnaryCall;
    getStrategyAnalytics(request: GetStrategyAnalyticsRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: StrategyAnalytics) => void): ClientUnaryCall;
    /**
     * Per-component historical indicator series for a strategy over a caller-supplied bar window,
     * for the unified Symbol page's overlay panels (feature 125, FR-6). Reuses the analysis
     * evaluator's own _compute_component per declared component in a dedicated handler loop — never
     * the shared evaluate_conditions_traced (which ListOpportunities' exit trace depends on).
     */
    getIndicatorSeries(request: GetIndicatorSeriesRequest, callback: (error: ServiceError | null, response: GetIndicatorSeriesResponse) => void): ClientUnaryCall;
    getIndicatorSeries(request: GetIndicatorSeriesRequest, metadata: Metadata, callback: (error: ServiceError | null, response: GetIndicatorSeriesResponse) => void): ClientUnaryCall;
    getIndicatorSeries(request: GetIndicatorSeriesRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: GetIndicatorSeriesResponse) => void): ClientUnaryCall;
    /**
     * Ranked P&L-attribution factors (feature 042): which indicator value-ranges and signals
     * correlate with positive vs negative realized P&L, scoped by symbol/strategy/time window.
     */
    queryPnLPatterns(request: QueryPnLPatternsRequest, callback: (error: ServiceError | null, response: QueryPnLPatternsResponse) => void): ClientUnaryCall;
    queryPnLPatterns(request: QueryPnLPatternsRequest, metadata: Metadata, callback: (error: ServiceError | null, response: QueryPnLPatternsResponse) => void): ClientUnaryCall;
    queryPnLPatterns(request: QueryPnLPatternsRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: QueryPnLPatternsResponse) => void): ClientUnaryCall;
    /**
     * Per-source trading-performance attribution over closed positions (feature 029). Read-only;
     * aggregates 042's analysis.pnl_positions + order_snapshots.signals. Owner-scoped via x-user-id.
     */
    getAttribution(request: GetAttributionRequest, callback: (error: ServiceError | null, response: GetAttributionResponse) => void): ClientUnaryCall;
    getAttribution(request: GetAttributionRequest, metadata: Metadata, callback: (error: ServiceError | null, response: GetAttributionResponse) => void): ClientUnaryCall;
    getAttribution(request: GetAttributionRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: GetAttributionResponse) => void): ClientUnaryCall;
}
export declare const AnalysisServiceClient: {
    new (address: string, credentials: ChannelCredentials, options?: Partial<ClientOptions>): AnalysisServiceClient;
    service: typeof AnalysisServiceService;
    serviceName: string;
};
type Builtin = Date | Function | Uint8Array | string | number | boolean | undefined;
export type DeepPartial<T> = T extends Builtin ? T : T extends globalThis.Array<infer U> ? globalThis.Array<DeepPartial<U>> : T extends ReadonlyArray<infer U> ? ReadonlyArray<DeepPartial<U>> : T extends {} ? {
    [K in keyof T]?: DeepPartial<T[K]>;
} : Partial<T>;
type KeysOfUnion<T> = T extends T ? keyof T : never;
export type Exact<P, I extends P> = P extends Builtin ? P : P & {
    [K in keyof P]: Exact<P[K], I[K]>;
} & {
    [K in Exclude<keyof I, KeysOfUnion<P>>]: never;
};
export interface MessageFns<T> {
    encode(message: T, writer?: BinaryWriter): BinaryWriter;
    decode(input: BinaryReader | Uint8Array, length?: number): T;
    fromJSON(object: any): T;
    toJSON(message: T): unknown;
    create<I extends Exact<DeepPartial<T>, I>>(base?: I): T;
    fromPartial<I extends Exact<DeepPartial<T>, I>>(object: I): T;
}
export {};
