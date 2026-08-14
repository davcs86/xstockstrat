import type { GenEnum, GenFile, GenMessage, GenService } from "@bufbuild/protobuf/codegenv2";
import type { FieldMask, Timestamp } from "@bufbuild/protobuf/wkt";
import type { PageRequest, PageResponse, Timeframe, TimeRange } from "../../common/v1/common_pb";
import type { JsonObject, Message } from "@bufbuild/protobuf";
/**
 * Describes the file analysis/v1/analysis.proto.
 */
export declare const file_analysis_v1_analysis: GenFile;
/**
 * @generated from message xstockstrat.analysis.v1.RunBacktestRequest
 */
export type RunBacktestRequest = Message<"xstockstrat.analysis.v1.RunBacktestRequest"> & {
    /**
     * @generated from field: string strategy_id = 1;
     */
    strategyId: string;
    /**
     * @generated from field: xstockstrat.common.v1.TimeRange range = 2;
     */
    range?: TimeRange | undefined;
    /**
     * @generated from field: repeated string symbols = 3;
     */
    symbols: string[];
    /**
     * @generated from field: double initial_capital = 4;
     */
    initialCapital: number;
    /**
     * @generated from field: google.protobuf.Struct strategy_params = 5;
     */
    strategyParams?: JsonObject | undefined;
    /**
     * field 6 — resolve definition from DB; legacy strategy_params (field 5) remains supported
     *
     * @generated from field: string strategy_id_ref = 6;
     */
    strategyIdRef: string;
    /**
     * field 7 — inline definition; takes precedence over strategy_id_ref if both supplied
     *
     * @generated from field: xstockstrat.analysis.v1.StrategyDefinition inline_definition = 7;
     */
    inlineDefinition?: StrategyDefinition | undefined;
};
/**
 * Describes the message xstockstrat.analysis.v1.RunBacktestRequest.
 * Use `create(RunBacktestRequestSchema)` to create a new message.
 */
export declare const RunBacktestRequestSchema: GenMessage<RunBacktestRequest>;
/**
 * @generated from message xstockstrat.analysis.v1.CoverageGap
 */
export type CoverageGap = Message<"xstockstrat.analysis.v1.CoverageGap"> & {
    /**
     * @generated from field: string symbol = 1;
     */
    symbol: string;
    /**
     * @generated from field: xstockstrat.common.v1.Timeframe timeframe = 2;
     */
    timeframe: Timeframe;
    /**
     * @generated from field: xstockstrat.common.v1.TimeRange requested_range = 3;
     */
    requestedRange?: TimeRange | undefined;
    /**
     * @generated from field: int64 bars_have = 4;
     */
    barsHave: bigint;
    /**
     * @generated from field: int64 bars_need = 5;
     */
    barsNeed: bigint;
    /**
     * The range a caller should backfill to satisfy this backtest.
     *
     * @generated from field: xstockstrat.common.v1.TimeRange gap = 6;
     */
    gap?: TimeRange | undefined;
};
/**
 * Describes the message xstockstrat.analysis.v1.CoverageGap.
 * Use `create(CoverageGapSchema)` to create a new message.
 */
export declare const CoverageGapSchema: GenMessage<CoverageGap>;
/**
 * NOTE: this message's wire bytes are persisted verbatim in analysis.backtest_details
 * (feature 068, "store what you serve") — renumbering or retyping any field here or in
 * BarDiagnostic silently corrupts previously persisted runs. Additive changes only;
 * buf breaking guards this on every PR.
 *
 * @generated from message xstockstrat.analysis.v1.BacktestResult
 */
export type BacktestResult = Message<"xstockstrat.analysis.v1.BacktestResult"> & {
    /**
     * @generated from field: string backtest_id = 1;
     */
    backtestId: string;
    /**
     * @generated from field: string strategy_id = 2;
     */
    strategyId: string;
    /**
     * @generated from field: double total_return = 3;
     */
    totalReturn: number;
    /**
     * @generated from field: double annualized_return = 4;
     */
    annualizedReturn: number;
    /**
     * @generated from field: double sharpe_ratio = 5;
     */
    sharpeRatio: number;
    /**
     * @generated from field: double max_drawdown = 6;
     */
    maxDrawdown: number;
    /**
     * @generated from field: double win_rate = 7;
     */
    winRate: number;
    /**
     * @generated from field: int32 total_trades = 8;
     */
    totalTrades: number;
    /**
     * @generated from field: double profit_factor = 9;
     */
    profitFactor: number;
    /**
     * @generated from field: google.protobuf.Timestamp completed_at = 10;
     */
    completedAt?: Timestamp | undefined;
    /**
     * @generated from field: repeated xstockstrat.analysis.v1.TradeRecord trades = 11;
     */
    trades: TradeRecord[];
    /**
     * @generated from field: xstockstrat.analysis.v1.BacktestStatus status = 12;
     */
    status: BacktestStatus;
    /**
     * populated per-symbol when status == INSUFFICIENT_DATA
     *
     * @generated from field: repeated xstockstrat.analysis.v1.CoverageGap coverage_gaps = 13;
     */
    coverageGaps: CoverageGap[];
    /**
     * per-bar debug data for every simulated symbol (feature 064)
     *
     * @generated from field: repeated xstockstrat.analysis.v1.SymbolDiagnostics diagnostics = 14;
     */
    diagnostics: SymbolDiagnostics[];
    /**
     * Effective starting capital the engine seeded the simulation with (the 100k default
     * when the request omitted it) — required to rebuild the equity curve for a
     * historical run (feature 068).
     *
     * @generated from field: double initial_capital = 15;
     */
    initialCapital: number;
    /**
     * Human-readable run warnings surfaced to the user (feature 086), e.g. a strategy referenced a
     * formula that has since been soft-deleted — the run still completed using its last-saved
     * definition. Empty on a clean run.
     *
     * @generated from field: repeated string warnings = 16;
     */
    warnings: string[];
};
/**
 * Describes the message xstockstrat.analysis.v1.BacktestResult.
 * Use `create(BacktestResultSchema)` to create a new message.
 */
export declare const BacktestResultSchema: GenMessage<BacktestResult>;
/**
 * @generated from message xstockstrat.analysis.v1.TradeRecord
 */
export type TradeRecord = Message<"xstockstrat.analysis.v1.TradeRecord"> & {
    /**
     * @generated from field: string symbol = 1;
     */
    symbol: string;
    /**
     * @generated from field: string side = 2;
     */
    side: string;
    /**
     * @generated from field: double qty = 3;
     */
    qty: number;
    /**
     * @generated from field: double entry_price = 4;
     */
    entryPrice: number;
    /**
     * @generated from field: double exit_price = 5;
     */
    exitPrice: number;
    /**
     * @generated from field: double pnl = 6;
     */
    pnl: number;
    /**
     * @generated from field: google.protobuf.Timestamp entry_time = 7;
     */
    entryTime?: Timestamp | undefined;
    /**
     * @generated from field: google.protobuf.Timestamp exit_time = 8;
     */
    exitTime?: Timestamp | undefined;
};
/**
 * Describes the message xstockstrat.analysis.v1.TradeRecord.
 * Use `create(TradeRecordSchema)` to create a new message.
 */
export declare const TradeRecordSchema: GenMessage<TradeRecord>;
/**
 * One row of day-by-day backtest diagnostics for a single bar.
 *
 * @generated from message xstockstrat.analysis.v1.BarDiagnostic
 */
export type BarDiagnostic = Message<"xstockstrat.analysis.v1.BarDiagnostic"> & {
    /**
     * @generated from field: string symbol = 1;
     */
    symbol: string;
    /**
     * @generated from field: int32 bar_index = 2;
     */
    barIndex: number;
    /**
     * @generated from field: google.protobuf.Timestamp timestamp = 3;
     */
    timestamp?: Timestamp | undefined;
    /**
     * @generated from field: double open = 4;
     */
    open: number;
    /**
     * @generated from field: double high = 5;
     */
    high: number;
    /**
     * @generated from field: double low = 6;
     */
    low: number;
    /**
     * @generated from field: double close = 7;
     */
    close: number;
    /**
     * @generated from field: int64 volume = 8;
     */
    volume: bigint;
    /**
     * @generated from field: double vwap = 9;
     */
    vwap: number;
    /**
     * present-only: a series is absent during its warm-up
     *
     * @generated from field: map<string, double> indicators = 10;
     */
    indicators: {
        [key: string]: number;
    };
    /**
     * @generated from field: bool warmup = 11;
     */
    warmup: boolean;
    /**
     * @generated from field: double signal_score = 12;
     */
    signalScore: number;
    /**
     * @generated from field: double conviction = 13;
     */
    conviction: number;
    /**
     * @generated from field: xstockstrat.analysis.v1.BarAction action = 14;
     */
    action: BarAction;
    /**
     * Portfolio value (cash + position * close) after this bar — the per-bar equity
     * point the time-based equity curve plots (feature 068).
     *
     * @generated from field: double equity = 15;
     */
    equity: number;
};
/**
 * Describes the message xstockstrat.analysis.v1.BarDiagnostic.
 * Use `create(BarDiagnosticSchema)` to create a new message.
 */
export declare const BarDiagnosticSchema: GenMessage<BarDiagnostic>;
/**
 * Per-symbol diagnostics bundle attached to a BacktestResult.
 *
 * @generated from message xstockstrat.analysis.v1.SymbolDiagnostics
 */
export type SymbolDiagnostics = Message<"xstockstrat.analysis.v1.SymbolDiagnostics"> & {
    /**
     * @generated from field: string symbol = 1;
     */
    symbol: string;
    /**
     * @generated from field: repeated xstockstrat.analysis.v1.BarDiagnostic bars = 2;
     */
    bars: BarDiagnostic[];
    /**
     * @generated from field: xstockstrat.analysis.v1.NoTradeReason no_trade_reason = 3;
     */
    noTradeReason: NoTradeReason;
    /**
     * @generated from field: int32 bars_total = 4;
     */
    barsTotal: number;
    /**
     * @generated from field: int32 warmup_bars = 5;
     */
    warmupBars: number;
};
/**
 * Describes the message xstockstrat.analysis.v1.SymbolDiagnostics.
 * Use `create(SymbolDiagnosticsSchema)` to create a new message.
 */
export declare const SymbolDiagnosticsSchema: GenMessage<SymbolDiagnostics>;
/**
 * @generated from message xstockstrat.analysis.v1.ScoreStrategyRequest
 */
export type ScoreStrategyRequest = Message<"xstockstrat.analysis.v1.ScoreStrategyRequest"> & {
    /**
     * @generated from field: string strategy_id = 1;
     */
    strategyId: string;
    /**
     * @generated from field: xstockstrat.common.v1.TimeRange range = 2;
     */
    range?: TimeRange | undefined;
};
/**
 * Describes the message xstockstrat.analysis.v1.ScoreStrategyRequest.
 * Use `create(ScoreStrategyRequestSchema)` to create a new message.
 */
export declare const ScoreStrategyRequestSchema: GenMessage<ScoreStrategyRequest>;
/**
 * @generated from message xstockstrat.analysis.v1.StrategyScore
 */
export type StrategyScore = Message<"xstockstrat.analysis.v1.StrategyScore"> & {
    /**
     * @generated from field: string strategy_id = 1;
     */
    strategyId: string;
    /**
     * @generated from field: double overall_score = 2;
     */
    overallScore: number;
    /**
     * e.g. sharpe, drawdown, consistency
     *
     * @generated from field: map<string, double> component_scores = 3;
     */
    componentScores: {
        [key: string]: number;
    };
    /**
     * A/B/C/D/F
     *
     * @generated from field: string rating = 4;
     */
    rating: string;
    /**
     * Evidence provenance for the derived cross-stock headline grade (feature 065).
     *
     * distinct symbols contributing eligible evidence cells
     *
     * @generated from field: int32 evidence_symbols = 5;
     */
    evidenceSymbols: number;
    /**
     * total trading days of evidence across those symbols
     *
     * @generated from field: int32 evidence_days = 6;
     */
    evidenceDays: number;
    /**
     * true when evidence is below the symbol/day floor
     *
     * @generated from field: bool provisional = 7;
     */
    provisional: boolean;
};
/**
 * Describes the message xstockstrat.analysis.v1.StrategyScore.
 * Use `create(StrategyScoreSchema)` to create a new message.
 */
export declare const StrategyScoreSchema: GenMessage<StrategyScore>;
/**
 * @generated from message xstockstrat.analysis.v1.StrategyReport
 */
export type StrategyReport = Message<"xstockstrat.analysis.v1.StrategyReport"> & {
    /**
     * @generated from field: string strategy_id = 1;
     */
    strategyId: string;
    /**
     * @generated from field: xstockstrat.analysis.v1.BacktestResult latest_backtest = 2;
     */
    latestBacktest?: BacktestResult | undefined;
    /**
     * @generated from field: xstockstrat.analysis.v1.StrategyScore score = 3;
     */
    score?: StrategyScore | undefined;
    /**
     * @generated from field: google.protobuf.Struct metadata = 4;
     */
    metadata?: JsonObject | undefined;
};
/**
 * Describes the message xstockstrat.analysis.v1.StrategyReport.
 * Use `create(StrategyReportSchema)` to create a new message.
 */
export declare const StrategyReportSchema: GenMessage<StrategyReport>;
/**
 * @generated from message xstockstrat.analysis.v1.ListBacktestsRequest
 */
export type ListBacktestsRequest = Message<"xstockstrat.analysis.v1.ListBacktestsRequest"> & {
    /**
     * @generated from field: string strategy_id = 1;
     */
    strategyId: string;
    /**
     * 0 → server default (most recent 20)
     *
     * @generated from field: int32 limit = 2;
     */
    limit: number;
};
/**
 * Describes the message xstockstrat.analysis.v1.ListBacktestsRequest.
 * Use `create(ListBacktestsRequestSchema)` to create a new message.
 */
export declare const ListBacktestsRequestSchema: GenMessage<ListBacktestsRequest>;
/**
 * @generated from message xstockstrat.analysis.v1.BacktestRunSummary
 */
export type BacktestRunSummary = Message<"xstockstrat.analysis.v1.BacktestRunSummary"> & {
    /**
     * @generated from field: string backtest_id = 1;
     */
    backtestId: string;
    /**
     * @generated from field: string strategy_id = 2;
     */
    strategyId: string;
    /**
     * @generated from field: xstockstrat.analysis.v1.BacktestStatus status = 3;
     */
    status: BacktestStatus;
    /**
     * @generated from field: double total_return = 4;
     */
    totalReturn: number;
    /**
     * @generated from field: double annualized_return = 5;
     */
    annualizedReturn: number;
    /**
     * @generated from field: double sharpe_ratio = 6;
     */
    sharpeRatio: number;
    /**
     * @generated from field: double max_drawdown = 7;
     */
    maxDrawdown: number;
    /**
     * @generated from field: double win_rate = 8;
     */
    winRate: number;
    /**
     * @generated from field: int32 total_trades = 9;
     */
    totalTrades: number;
    /**
     * @generated from field: double profit_factor = 10;
     */
    profitFactor: number;
    /**
     * @generated from field: repeated string symbols = 11;
     */
    symbols: string[];
    /**
     * 0 when the run earned no score (e.g. INSUFFICIENT_DATA)
     *
     * @generated from field: double overall_score = 12;
     */
    overallScore: number;
    /**
     * "" when the run earned no score
     *
     * @generated from field: string rating = 13;
     */
    rating: string;
    /**
     * @generated from field: google.protobuf.Timestamp completed_at = 14;
     */
    completedAt?: Timestamp | undefined;
    /**
     * Backtest range covered by this run (feature 065); unset on legacy rows.
     *
     * @generated from field: google.protobuf.Timestamp range_start = 15;
     */
    rangeStart?: Timestamp | undefined;
    /**
     * @generated from field: google.protobuf.Timestamp range_end = 16;
     */
    rangeEnd?: Timestamp | undefined;
};
/**
 * Describes the message xstockstrat.analysis.v1.BacktestRunSummary.
 * Use `create(BacktestRunSummarySchema)` to create a new message.
 */
export declare const BacktestRunSummarySchema: GenMessage<BacktestRunSummary>;
/**
 * @generated from message xstockstrat.analysis.v1.ListBacktestsResponse
 */
export type ListBacktestsResponse = Message<"xstockstrat.analysis.v1.ListBacktestsResponse"> & {
    /**
     * @generated from field: repeated xstockstrat.analysis.v1.BacktestRunSummary runs = 1;
     */
    runs: BacktestRunSummary[];
};
/**
 * Describes the message xstockstrat.analysis.v1.ListBacktestsResponse.
 * Use `create(ListBacktestsResponseSchema)` to create a new message.
 */
export declare const ListBacktestsResponseSchema: GenMessage<ListBacktestsResponse>;
/**
 * @generated from message xstockstrat.analysis.v1.GetBacktestRequest
 */
export type GetBacktestRequest = Message<"xstockstrat.analysis.v1.GetBacktestRequest"> & {
    /**
     * @generated from field: string backtest_id = 1;
     */
    backtestId: string;
};
/**
 * Describes the message xstockstrat.analysis.v1.GetBacktestRequest.
 * Use `create(GetBacktestRequestSchema)` to create a new message.
 */
export declare const GetBacktestRequestSchema: GenMessage<GetBacktestRequest>;
/**
 * @generated from message xstockstrat.analysis.v1.ListStrategiesRequest
 */
export type ListStrategiesRequest = Message<"xstockstrat.analysis.v1.ListStrategiesRequest"> & {
    /**
     * @generated from field: xstockstrat.common.v1.PageRequest page = 1;
     */
    page?: PageRequest | undefined;
    /**
     * @generated from field: string user_id = 2;
     */
    userId: string;
};
/**
 * Describes the message xstockstrat.analysis.v1.ListStrategiesRequest.
 * Use `create(ListStrategiesRequestSchema)` to create a new message.
 */
export declare const ListStrategiesRequestSchema: GenMessage<ListStrategiesRequest>;
/**
 * @generated from message xstockstrat.analysis.v1.ListStrategiesResponse
 */
export type ListStrategiesResponse = Message<"xstockstrat.analysis.v1.ListStrategiesResponse"> & {
    /**
     * @generated from field: repeated xstockstrat.analysis.v1.StrategyScore strategies = 1;
     */
    strategies: StrategyScore[];
    /**
     * @generated from field: xstockstrat.common.v1.PageResponse page = 2;
     */
    page?: PageResponse | undefined;
};
/**
 * Describes the message xstockstrat.analysis.v1.ListStrategiesResponse.
 * Use `create(ListStrategiesResponseSchema)` to create a new message.
 */
export declare const ListStrategiesResponseSchema: GenMessage<ListStrategiesResponse>;
/**
 * @generated from message xstockstrat.analysis.v1.GetStrategyReportRequest
 */
export type GetStrategyReportRequest = Message<"xstockstrat.analysis.v1.GetStrategyReportRequest"> & {
    /**
     * @generated from field: string strategy_id = 1;
     */
    strategyId: string;
};
/**
 * Describes the message xstockstrat.analysis.v1.GetStrategyReportRequest.
 * Use `create(GetStrategyReportRequestSchema)` to create a new message.
 */
export declare const GetStrategyReportRequestSchema: GenMessage<GetStrategyReportRequest>;
/**
 * @generated from message xstockstrat.analysis.v1.StrategyComponent
 */
export type StrategyComponent = Message<"xstockstrat.analysis.v1.StrategyComponent"> & {
    /**
     * @generated from field: string ref_name = 1;
     */
    refName: string;
    /**
     * @generated from field: xstockstrat.analysis.v1.ComponentKind kind = 2;
     */
    kind: ComponentKind;
    /**
     * used when kind == COMPONENT_KIND_BUILTIN_INDICATOR
     *
     * @generated from field: string indicator = 3;
     */
    indicator: string;
    /**
     * used when kind == COMPONENT_KIND_CUSTOM_FORMULA
     *
     * @generated from field: string formula_id = 4;
     */
    formulaId: string;
    /**
     * @generated from field: map<string, double> params = 5;
     */
    params: {
        [key: string]: number;
    };
};
/**
 * Describes the message xstockstrat.analysis.v1.StrategyComponent.
 * Use `create(StrategyComponentSchema)` to create a new message.
 */
export declare const StrategyComponentSchema: GenMessage<StrategyComponent>;
/**
 * @generated from message xstockstrat.analysis.v1.StrategyDefinition
 */
export type StrategyDefinition = Message<"xstockstrat.analysis.v1.StrategyDefinition"> & {
    /**
     * @generated from field: string strategy_id = 1;
     */
    strategyId: string;
    /**
     * @generated from field: string display_name = 2;
     */
    displayName: string;
    /**
     * @generated from field: repeated xstockstrat.analysis.v1.StrategyComponent components = 3;
     */
    components: StrategyComponent[];
    /**
     * JSON-encoded condition tree
     *
     * @generated from field: string entry_rule = 4;
     */
    entryRule: string;
    /**
     * JSON-encoded condition tree
     *
     * @generated from field: string exit_rule = 5;
     */
    exitRule: string;
    /**
     * @generated from field: google.protobuf.Struct signal_params = 6;
     */
    signalParams?: JsonObject | undefined;
    /**
     * @generated from field: bool active = 7;
     */
    active: boolean;
    /**
     * @generated from field: bool live_enabled = 8;
     */
    liveEnabled: boolean;
    /**
     * Per-symbol re-entry cooldown in calendar days (feature 069). optional = explicit presence:
     * unset → platform default (analysis.strategy.default_cooldown_days); explicit 0 → no cooldown
     * (immediate re-entry allowed); negative → rejected at write time (INVALID_ARGUMENT).
     *
     * @generated from field: optional int32 cooldown_days = 9;
     */
    cooldownDays?: number | undefined;
    /**
     * Human-readable status warnings surfaced to the user on read (feature 086), e.g. a component
     * references a formula that has been soft-deleted — the strategy still evaluates (live and in
     * backtests) using the formula's last-saved definition, but the deletion is flagged. Populated
     * by GetStrategy; empty elsewhere.
     *
     * @generated from field: repeated string warnings = 10;
     */
    warnings: string[];
    /**
     * Per-strategy minimum holding period in calendar days before exit_rule may fire a sell
     * (feature 116 — exit cooldown; mirrors cooldown_days but gates the exit transition).
     * optional = explicit presence: unset → platform default
     * (analysis.strategy.default_exit_cooldown_days); explicit 0 → no minimum hold (exit
     * permitted immediately, current behavior); negative → rejected at write time
     * (INVALID_ARGUMENT).
     *
     * @generated from field: optional int32 exit_cooldown_days = 11;
     */
    exitCooldownDays?: number | undefined;
    /**
     * Owning user (feature 133). Server-authoritative: populated from the propagated
     * x-user-id header on ManageStrategy REGISTER, never accepted from the request body
     * (mirrors ListOpportunitiesRequest / portfolio ownership convention). Field 12 is
     * reserved for feature 132's denied_symbols — do not reuse.
     *
     * @generated from field: string user_id = 13;
     */
    userId: string;
};
/**
 * Describes the message xstockstrat.analysis.v1.StrategyDefinition.
 * Use `create(StrategyDefinitionSchema)` to create a new message.
 */
export declare const StrategyDefinitionSchema: GenMessage<StrategyDefinition>;
/**
 * @generated from message xstockstrat.analysis.v1.ManageStrategyRequest
 */
export type ManageStrategyRequest = Message<"xstockstrat.analysis.v1.ManageStrategyRequest"> & {
    /**
     * @generated from field: xstockstrat.analysis.v1.StrategyOperation operation = 1;
     */
    operation: StrategyOperation;
    /**
     * @generated from field: xstockstrat.analysis.v1.StrategyDefinition definition = 2;
     */
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
     * exit_cooldown_days.
     * strategy_id/active/live_enabled are column-authoritative and rejected with INVALID_ARGUMENT.
     *
     * @generated from field: google.protobuf.FieldMask update_mask = 3;
     */
    updateMask?: FieldMask | undefined;
};
/**
 * Describes the message xstockstrat.analysis.v1.ManageStrategyRequest.
 * Use `create(ManageStrategyRequestSchema)` to create a new message.
 */
export declare const ManageStrategyRequestSchema: GenMessage<ManageStrategyRequest>;
/**
 * @generated from message xstockstrat.analysis.v1.GetStrategyRequest
 */
export type GetStrategyRequest = Message<"xstockstrat.analysis.v1.GetStrategyRequest"> & {
    /**
     * @generated from field: string strategy_id = 1;
     */
    strategyId: string;
};
/**
 * Describes the message xstockstrat.analysis.v1.GetStrategyRequest.
 * Use `create(GetStrategyRequestSchema)` to create a new message.
 */
export declare const GetStrategyRequestSchema: GenMessage<GetStrategyRequest>;
/**
 * @generated from message xstockstrat.analysis.v1.ListStrategyDefinitionsRequest
 */
export type ListStrategyDefinitionsRequest = Message<"xstockstrat.analysis.v1.ListStrategyDefinitionsRequest"> & {
    /**
     * @generated from field: bool include_inactive = 1;
     */
    includeInactive: boolean;
    /**
     * @generated from field: int32 page_size = 2;
     */
    pageSize: number;
    /**
     * @generated from field: int32 page_offset = 3;
     */
    pageOffset: number;
};
/**
 * Describes the message xstockstrat.analysis.v1.ListStrategyDefinitionsRequest.
 * Use `create(ListStrategyDefinitionsRequestSchema)` to create a new message.
 */
export declare const ListStrategyDefinitionsRequestSchema: GenMessage<ListStrategyDefinitionsRequest>;
/**
 * @generated from message xstockstrat.analysis.v1.ListStrategyDefinitionsResponse
 */
export type ListStrategyDefinitionsResponse = Message<"xstockstrat.analysis.v1.ListStrategyDefinitionsResponse"> & {
    /**
     * @generated from field: repeated xstockstrat.analysis.v1.StrategyDefinition definitions = 1;
     */
    definitions: StrategyDefinition[];
    /**
     * @generated from field: int32 total_count = 2;
     */
    totalCount: number;
};
/**
 * Describes the message xstockstrat.analysis.v1.ListStrategyDefinitionsResponse.
 * Use `create(ListStrategyDefinitionsResponseSchema)` to create a new message.
 */
export declare const ListStrategyDefinitionsResponseSchema: GenMessage<ListStrategyDefinitionsResponse>;
/**
 * @generated from message xstockstrat.analysis.v1.SetStrategyLiveRequest
 */
export type SetStrategyLiveRequest = Message<"xstockstrat.analysis.v1.SetStrategyLiveRequest"> & {
    /**
     * @generated from field: string strategy_id = 1;
     */
    strategyId: string;
    /**
     * @generated from field: bool live_enabled = 2;
     */
    liveEnabled: boolean;
};
/**
 * Describes the message xstockstrat.analysis.v1.SetStrategyLiveRequest.
 * Use `create(SetStrategyLiveRequestSchema)` to create a new message.
 */
export declare const SetStrategyLiveRequestSchema: GenMessage<SetStrategyLiveRequest>;
/**
 * @generated from message xstockstrat.analysis.v1.SetStrategyLiveResponse
 */
export type SetStrategyLiveResponse = Message<"xstockstrat.analysis.v1.SetStrategyLiveResponse"> & {
    /**
     * @generated from field: xstockstrat.analysis.v1.StrategyDefinition definition = 1;
     */
    definition?: StrategyDefinition | undefined;
};
/**
 * Describes the message xstockstrat.analysis.v1.SetStrategyLiveResponse.
 * Use `create(SetStrategyLiveResponseSchema)` to create a new message.
 */
export declare const SetStrategyLiveResponseSchema: GenMessage<SetStrategyLiveResponse>;
/**
 * @generated from message xstockstrat.analysis.v1.ScreenCriterion
 */
export type ScreenCriterion = Message<"xstockstrat.analysis.v1.ScreenCriterion"> & {
    /**
     * @generated from field: string ref_name = 1;
     */
    refName: string;
    /**
     * @generated from field: xstockstrat.analysis.v1.ScreenKind kind = 2;
     */
    kind: ScreenKind;
    /**
     * FUNDAMENTAL only (e.g. "pe_ratio")
     *
     * @generated from field: string metric_name = 3;
     */
    metricName: string;
    /**
     * reused, for TECHNICAL_* kinds
     *
     * @generated from field: xstockstrat.analysis.v1.StrategyComponent component = 4;
     */
    component?: StrategyComponent | undefined;
    /**
     * @generated from field: xstockstrat.analysis.v1.Comparator op = 5;
     */
    op: Comparator;
    /**
     * @generated from field: double threshold = 6;
     */
    threshold: number;
    /**
     * for COMPARATOR_BETWEEN
     *
     * @generated from field: double threshold_high = 7;
     */
    thresholdHigh: number;
    /**
     * contribution to the blended score
     *
     * @generated from field: double weight = 8;
     */
    weight: number;
    /**
     * true → failing this excludes the symbol
     *
     * @generated from field: bool hard_filter = 9;
     */
    hardFilter: boolean;
};
/**
 * Describes the message xstockstrat.analysis.v1.ScreenCriterion.
 * Use `create(ScreenCriterionSchema)` to create a new message.
 */
export declare const ScreenCriterionSchema: GenMessage<ScreenCriterion>;
/**
 * @generated from message xstockstrat.analysis.v1.ScreenResult
 */
export type ScreenResult = Message<"xstockstrat.analysis.v1.ScreenResult"> & {
    /**
     * @generated from field: string symbol = 1;
     */
    symbol: string;
    /**
     * @generated from field: double score = 2;
     */
    score: number;
    /**
     * per ref_name; skipped criteria are absent
     *
     * @generated from field: map<string, double> criterion_scores = 3;
     */
    criterionScores: {
        [key: string]: number;
    };
    /**
     * @generated from field: bool passed = 4;
     */
    passed: boolean;
    /**
     * @generated from field: xstockstrat.analysis.v1.ScreenResultStatus status = 5;
     */
    status: ScreenResultStatus;
    /**
     * populated when status == INSUFFICIENT_DATA
     *
     * @generated from field: xstockstrat.analysis.v1.CoverageGap gap = 6;
     */
    gap?: CoverageGap | undefined;
    /**
     * Raw column values surfaced on the screener results table (feature 083, FR-8).
     * rsi/atr come from the analysis→indicators edge; ATR is a close-only approximation
     * (indicators_engine.py) — surfaced as a known accuracy caveat, not exact.
     * rev_growth is best-effort from Fundamentals.extra_metrics (0 when FMP omits it).
     *
     * @generated from field: double pe = 7;
     */
    pe: number;
    /**
     * @generated from field: double rsi = 8;
     */
    rsi: number;
    /**
     * @generated from field: double atr = 9;
     */
    atr: number;
    /**
     * @generated from field: double rev_growth = 10;
     */
    revGrowth: number;
    /**
     * @generated from field: bool held = 11;
     */
    held: boolean;
};
/**
 * Describes the message xstockstrat.analysis.v1.ScreenResult.
 * Use `create(ScreenResultSchema)` to create a new message.
 */
export declare const ScreenResultSchema: GenMessage<ScreenResult>;
/**
 * @generated from message xstockstrat.analysis.v1.ScreenSymbolsRequest
 */
export type ScreenSymbolsRequest = Message<"xstockstrat.analysis.v1.ScreenSymbolsRequest"> & {
    /**
     * @generated from field: repeated string symbols = 1;
     */
    symbols: string[];
    /**
     * @generated from field: repeated xstockstrat.analysis.v1.ScreenCriterion criteria = 2;
     */
    criteria: ScreenCriterion[];
    /**
     * Blend params — same names the extracted scoring module reads (kept consistent with backtest).
     *
     * @generated from field: repeated string signal_sources = 3;
     */
    signalSources: string[];
    /**
     * @generated from field: double signal_weight = 4;
     */
    signalWeight: number;
    /**
     * @generated from field: double technical_weight = 5;
     */
    technicalWeight: number;
    /**
     * @generated from field: double min_conviction = 6;
     */
    minConviction: number;
    /**
     * @generated from field: int32 rank_limit = 7;
     */
    rankLimit: number;
    /**
     * Reserved/optional — historical as-of is deferred (OQ-060-e); latest bar is the default.
     *
     * @generated from field: xstockstrat.common.v1.TimeRange evaluation_window = 8;
     */
    evaluationWindow?: TimeRange | undefined;
};
/**
 * Describes the message xstockstrat.analysis.v1.ScreenSymbolsRequest.
 * Use `create(ScreenSymbolsRequestSchema)` to create a new message.
 */
export declare const ScreenSymbolsRequestSchema: GenMessage<ScreenSymbolsRequest>;
/**
 * @generated from message xstockstrat.analysis.v1.ScreenSymbolsResponse
 */
export type ScreenSymbolsResponse = Message<"xstockstrat.analysis.v1.ScreenSymbolsResponse"> & {
    /**
     * @generated from field: repeated xstockstrat.analysis.v1.ScreenResult results = 1;
     */
    results: ScreenResult[];
    /**
     * @generated from field: repeated xstockstrat.analysis.v1.CoverageGap coverage_gaps = 2;
     */
    coverageGaps: CoverageGap[];
};
/**
 * Describes the message xstockstrat.analysis.v1.ScreenSymbolsResponse.
 * Use `create(ScreenSymbolsResponseSchema)` to create a new message.
 */
export declare const ScreenSymbolsResponseSchema: GenMessage<ScreenSymbolsResponse>;
/**
 * @generated from message xstockstrat.analysis.v1.RunFundamentalsScanRequest
 */
export type RunFundamentalsScanRequest = Message<"xstockstrat.analysis.v1.RunFundamentalsScanRequest"> & {
    /**
     * ignore the day's idempotency guard / re-emit
     *
     * @generated from field: bool force = 1;
     */
    force: boolean;
    /**
     * score + report but do not emit or spend cache calls
     *
     * @generated from field: bool dry_run = 2;
     */
    dryRun: boolean;
    /**
     * optional explicit override of the computed universe
     *
     * @generated from field: repeated string symbols = 3;
     */
    symbols: string[];
};
/**
 * Describes the message xstockstrat.analysis.v1.RunFundamentalsScanRequest.
 * Use `create(RunFundamentalsScanRequestSchema)` to create a new message.
 */
export declare const RunFundamentalsScanRequestSchema: GenMessage<RunFundamentalsScanRequest>;
/**
 * @generated from message xstockstrat.analysis.v1.FundamentalsScanSummary
 */
export type FundamentalsScanSummary = Message<"xstockstrat.analysis.v1.FundamentalsScanSummary"> & {
    /**
     * @generated from field: string run_id = 1;
     */
    runId: string;
    /**
     * @generated from field: int32 symbols_processed = 2;
     */
    symbolsProcessed: number;
    /**
     * @generated from field: int32 signals_emitted = 3;
     */
    signalsEmitted: number;
    /**
     * @generated from field: int32 calls_spent = 4;
     */
    callsSpent: number;
    /**
     * @generated from field: int32 deferred_count = 5;
     */
    deferredCount: number;
    /**
     * "completed" | "budget_deferred" | "failed"
     *
     * @generated from field: string status = 6;
     */
    status: string;
    /**
     * @generated from field: google.protobuf.Timestamp finished_at = 7;
     */
    finishedAt?: Timestamp | undefined;
};
/**
 * Describes the message xstockstrat.analysis.v1.FundamentalsScanSummary.
 * Use `create(FundamentalsScanSummarySchema)` to create a new message.
 */
export declare const FundamentalsScanSummarySchema: GenMessage<FundamentalsScanSummary>;
/**
 * One ranked opportunity on the Decide queue. conviction is a deterministic
 * ordinal (passing/total leaves + normalized worst-distance-to-threshold), NOT a
 * probability — the UI renders "N/M conditions" + strength bars, never a fake %.
 *
 * @generated from message xstockstrat.analysis.v1.Opportunity
 */
export type Opportunity = Message<"xstockstrat.analysis.v1.Opportunity"> & {
    /**
     * @generated from field: string symbol = 1;
     */
    symbol: string;
    /**
     * @generated from field: xstockstrat.analysis.v1.OpportunityActionTag action = 2;
     */
    action: OpportunityActionTag;
    /**
     * @generated from field: double conviction = 3;
     */
    conviction: number;
    /**
     * @generated from field: int32 passing_conditions = 4;
     */
    passingConditions: number;
    /**
     * @generated from field: int32 total_conditions = 5;
     */
    totalConditions: number;
    /**
     * @generated from field: string thesis = 6;
     */
    thesis: string;
    /**
     * @generated from field: string strategy_id = 7;
     */
    strategyId: string;
    /**
     * @generated from field: string source = 8;
     */
    source: string;
    /**
     * @generated from field: google.protobuf.Timestamp valid_until = 9;
     */
    validUntil?: Timestamp | undefined;
    /**
     * server-authoritative opaque key = user|symbol_norm|strategy_id (feature 097). Client echoes it verbatim to SetOpportunityAction, never derives it.
     *
     * @generated from field: string opportunity_key = 10;
     */
    opportunityKey: string;
    /**
     * contributing origins for a de-duplicated row (signal source(s) / "position" / "watchlist")
     *
     * @generated from field: repeated string provenance = 11;
     */
    provenance: string[];
};
/**
 * Describes the message xstockstrat.analysis.v1.Opportunity.
 * Use `create(OpportunitySchema)` to create a new message.
 */
export declare const OpportunitySchema: GenMessage<Opportunity>;
/**
 * One evaluated condition leaf from the traced evaluator (feature 083).
 *
 * @generated from message xstockstrat.analysis.v1.ConditionEval
 */
export type ConditionEval = Message<"xstockstrat.analysis.v1.ConditionEval"> & {
    /**
     * @generated from field: string ref_name = 1;
     */
    refName: string;
    /**
     * @generated from field: double lhs_value = 2;
     */
    lhsValue: number;
    /**
     * @generated from field: double threshold = 3;
     */
    threshold: number;
    /**
     * >, <, >=, <=, crosses_above, crosses_below
     *
     * @generated from field: string fn = 4;
     */
    fn: string;
    /**
     * @generated from field: xstockstrat.analysis.v1.ConditionState state = 5;
     */
    state: ConditionState;
    /**
     * normalized
     *
     * @generated from field: double distance_to_threshold = 6;
     */
    distanceToThreshold: number;
};
/**
 * Describes the message xstockstrat.analysis.v1.ConditionEval.
 * Use `create(ConditionEvalSchema)` to create a new message.
 */
export declare const ConditionEvalSchema: GenMessage<ConditionEval>;
/**
 * Per-symbol readiness — the traced evaluation of a strategy's entry rule.
 *
 * @generated from message xstockstrat.analysis.v1.SymbolReadiness
 */
export type SymbolReadiness = Message<"xstockstrat.analysis.v1.SymbolReadiness"> & {
    /**
     * @generated from field: string symbol = 1;
     */
    symbol: string;
    /**
     * @generated from field: double conviction = 2;
     */
    conviction: number;
    /**
     * @generated from field: int32 passing_conditions = 3;
     */
    passingConditions: number;
    /**
     * @generated from field: int32 total_conditions = 4;
     */
    totalConditions: number;
    /**
     * @generated from field: repeated xstockstrat.analysis.v1.ConditionEval conditions = 5;
     */
    conditions: ConditionEval[];
};
/**
 * Describes the message xstockstrat.analysis.v1.SymbolReadiness.
 * Use `create(SymbolReadinessSchema)` to create a new message.
 */
export declare const SymbolReadinessSchema: GenMessage<SymbolReadiness>;
/**
 * Per-strategy analytics for the Engine → Strategies surface. expectancy and
 * max_drawdown derive from persisted analysis.backtest_runs (win_rate +
 * profit_factor); signals_30d from ingest QuerySignals; taken from trading
 * ListOrders; queue_share from the opportunity-queue join.
 *
 * @generated from message xstockstrat.analysis.v1.StrategyAnalytics
 */
export type StrategyAnalytics = Message<"xstockstrat.analysis.v1.StrategyAnalytics"> & {
    /**
     * @generated from field: string strategy_id = 1;
     */
    strategyId: string;
    /**
     * @generated from field: double expectancy = 2;
     */
    expectancy: number;
    /**
     * @generated from field: double blended_hit_rate = 3;
     */
    blendedHitRate: number;
    /**
     * @generated from field: double max_drawdown = 4;
     */
    maxDrawdown: number;
    /**
     * @generated from field: int32 signals_30d = 5;
     */
    signals30d: number;
    /**
     * @generated from field: int32 taken = 6;
     */
    taken: number;
    /**
     * @generated from field: double queue_share = 7;
     */
    queueShare: number;
};
/**
 * Describes the message xstockstrat.analysis.v1.StrategyAnalytics.
 * Use `create(StrategyAnalyticsSchema)` to create a new message.
 */
export declare const StrategyAnalyticsSchema: GenMessage<StrategyAnalytics>;
/**
 * user_id is intentionally absent — taken from the propagated x-user-id header
 * server-side (matching the portfolio watchlist convention), never from the wire.
 *
 * @generated from message xstockstrat.analysis.v1.ListOpportunitiesRequest
 */
export type ListOpportunitiesRequest = Message<"xstockstrat.analysis.v1.ListOpportunitiesRequest"> & {
    /**
     * @generated from field: xstockstrat.common.v1.PageRequest page = 1;
     */
    page?: PageRequest | undefined;
    /**
     * @generated from field: double min_conviction = 2;
     */
    minConviction: number;
};
/**
 * Describes the message xstockstrat.analysis.v1.ListOpportunitiesRequest.
 * Use `create(ListOpportunitiesRequestSchema)` to create a new message.
 */
export declare const ListOpportunitiesRequestSchema: GenMessage<ListOpportunitiesRequest>;
/**
 * @generated from message xstockstrat.analysis.v1.ListOpportunitiesResponse
 */
export type ListOpportunitiesResponse = Message<"xstockstrat.analysis.v1.ListOpportunitiesResponse"> & {
    /**
     * @generated from field: repeated xstockstrat.analysis.v1.Opportunity opportunities = 1;
     */
    opportunities: Opportunity[];
    /**
     * @generated from field: xstockstrat.common.v1.PageResponse page = 2;
     */
    page?: PageResponse | undefined;
};
/**
 * Describes the message xstockstrat.analysis.v1.ListOpportunitiesResponse.
 * Use `create(ListOpportunitiesResponseSchema)` to create a new message.
 */
export declare const ListOpportunitiesResponseSchema: GenMessage<ListOpportunitiesResponse>;
/**
 * @generated from message xstockstrat.analysis.v1.EvaluateReadinessRequest
 */
export type EvaluateReadinessRequest = Message<"xstockstrat.analysis.v1.EvaluateReadinessRequest"> & {
    /**
     * @generated from field: string strategy_id = 1;
     */
    strategyId: string;
    /**
     * @generated from field: repeated string symbols = 2;
     */
    symbols: string[];
};
/**
 * Describes the message xstockstrat.analysis.v1.EvaluateReadinessRequest.
 * Use `create(EvaluateReadinessRequestSchema)` to create a new message.
 */
export declare const EvaluateReadinessRequestSchema: GenMessage<EvaluateReadinessRequest>;
/**
 * @generated from message xstockstrat.analysis.v1.EvaluateReadinessResponse
 */
export type EvaluateReadinessResponse = Message<"xstockstrat.analysis.v1.EvaluateReadinessResponse"> & {
    /**
     * @generated from field: repeated xstockstrat.analysis.v1.SymbolReadiness readiness = 1;
     */
    readiness: SymbolReadiness[];
};
/**
 * Describes the message xstockstrat.analysis.v1.EvaluateReadinessResponse.
 * Use `create(EvaluateReadinessResponseSchema)` to create a new message.
 */
export declare const EvaluateReadinessResponseSchema: GenMessage<EvaluateReadinessResponse>;
/**
 * user_id is intentionally absent — taken from the propagated x-user-id header server-side
 * (match the ListOpportunitiesRequest convention), never from the wire.
 *
 * @generated from message xstockstrat.analysis.v1.SetOpportunityActionRequest
 */
export type SetOpportunityActionRequest = Message<"xstockstrat.analysis.v1.SetOpportunityActionRequest"> & {
    /**
     * the server-issued key, echoed verbatim
     *
     * @generated from field: string opportunity_key = 1;
     */
    opportunityKey: string;
    /**
     * @generated from field: xstockstrat.analysis.v1.OpportunityAction action = 2;
     */
    action: OpportunityAction;
    /**
     * set only for SNOOZE; a bounded "snooze until"
     *
     * @generated from field: google.protobuf.Timestamp snooze_until = 3;
     */
    snoozeUntil?: Timestamp | undefined;
};
/**
 * Describes the message xstockstrat.analysis.v1.SetOpportunityActionRequest.
 * Use `create(SetOpportunityActionRequestSchema)` to create a new message.
 */
export declare const SetOpportunityActionRequestSchema: GenMessage<SetOpportunityActionRequest>;
/**
 * @generated from message xstockstrat.analysis.v1.SetOpportunityActionResponse
 */
export type SetOpportunityActionResponse = Message<"xstockstrat.analysis.v1.SetOpportunityActionResponse"> & {};
/**
 * Describes the message xstockstrat.analysis.v1.SetOpportunityActionResponse.
 * Use `create(SetOpportunityActionResponseSchema)` to create a new message.
 */
export declare const SetOpportunityActionResponseSchema: GenMessage<SetOpportunityActionResponse>;
/**
 * @generated from message xstockstrat.analysis.v1.GetStrategyAnalyticsRequest
 */
export type GetStrategyAnalyticsRequest = Message<"xstockstrat.analysis.v1.GetStrategyAnalyticsRequest"> & {
    /**
     * @generated from field: string strategy_id = 1;
     */
    strategyId: string;
};
/**
 * Describes the message xstockstrat.analysis.v1.GetStrategyAnalyticsRequest.
 * Use `create(GetStrategyAnalyticsRequestSchema)` to create a new message.
 */
export declare const GetStrategyAnalyticsRequestSchema: GenMessage<GetStrategyAnalyticsRequest>;
/**
 * @generated from enum xstockstrat.analysis.v1.BacktestStatus
 */
export declare enum BacktestStatus {
    /**
     * @generated from enum value: BACKTEST_STATUS_UNSPECIFIED = 0;
     */
    UNSPECIFIED = 0,
    /**
     * @generated from enum value: BACKTEST_STATUS_OK = 1;
     */
    OK = 1,
    /**
     * @generated from enum value: BACKTEST_STATUS_INSUFFICIENT_DATA = 2;
     */
    INSUFFICIENT_DATA = 2
}
/**
 * Describes the enum xstockstrat.analysis.v1.BacktestStatus.
 */
export declare const BacktestStatusSchema: GenEnum<BacktestStatus>;
/**
 * The engine's decision for a single bar. Closed set → enum (C-04).
 *
 * @generated from enum xstockstrat.analysis.v1.BarAction
 */
export declare enum BarAction {
    /**
     * @generated from enum value: BAR_ACTION_UNSPECIFIED = 0;
     */
    UNSPECIFIED = 0,
    /**
     * bar within the strategy's warm-up window
     *
     * @generated from enum value: BAR_ACTION_WARMUP = 1;
     */
    WARMUP = 1,
    /**
     * flat, no entry this bar
     *
     * @generated from enum value: BAR_ACTION_HOLD_FLAT = 2;
     */
    HOLD_FLAT = 2,
    /**
     * opened a long position this bar
     *
     * @generated from enum value: BAR_ACTION_ENTER_LONG = 3;
     */
    ENTER_LONG = 3,
    /**
     * closed a long position this bar
     *
     * @generated from enum value: BAR_ACTION_EXIT_LONG = 4;
     */
    EXIT_LONG = 4,
    /**
     * holding an existing long, no exit this bar
     *
     * @generated from enum value: BAR_ACTION_HOLD_LONG = 5;
     */
    HOLD_LONG = 5
}
/**
 * Describes the enum xstockstrat.analysis.v1.BarAction.
 */
export declare const BarActionSchema: GenEnum<BarAction>;
/**
 * Why a symbol produced zero trades. Closed set → enum (C-04).
 *
 * @generated from enum xstockstrat.analysis.v1.NoTradeReason
 */
export declare enum NoTradeReason {
    /**
     * symbol traded, or not classified
     *
     * @generated from enum value: NO_TRADE_REASON_UNSPECIFIED = 0;
     */
    UNSPECIFIED = 0,
    /**
     * the whole range was warm-up
     *
     * @generated from enum value: NO_TRADE_REASON_ENTIRE_RANGE_WARMUP = 1;
     */
    ENTIRE_RANGE_WARMUP = 1,
    /**
     * entry condition never satisfied
     *
     * @generated from enum value: NO_TRADE_REASON_ENTRY_NEVER_TRUE = 2;
     */
    ENTRY_NEVER_TRUE = 2,
    /**
     * reserved; not emitted this version
     *
     * @generated from enum value: NO_TRADE_REASON_INSUFFICIENT_CAPITAL = 3;
     */
    INSUFFICIENT_CAPITAL = 3,
    /**
     * a custom-formula component failed to execute / returned an out-of-contract series
     *
     * @generated from enum value: NO_TRADE_REASON_FORMULA_ERROR = 4;
     */
    FORMULA_ERROR = 4
}
/**
 * Describes the enum xstockstrat.analysis.v1.NoTradeReason.
 */
export declare const NoTradeReasonSchema: GenEnum<NoTradeReason>;
/**
 * @generated from enum xstockstrat.analysis.v1.ComponentKind
 */
export declare enum ComponentKind {
    /**
     * @generated from enum value: COMPONENT_KIND_UNSPECIFIED = 0;
     */
    UNSPECIFIED = 0,
    /**
     * @generated from enum value: COMPONENT_KIND_BUILTIN_INDICATOR = 1;
     */
    BUILTIN_INDICATOR = 1,
    /**
     * @generated from enum value: COMPONENT_KIND_CUSTOM_FORMULA = 2;
     */
    CUSTOM_FORMULA = 2
}
/**
 * Describes the enum xstockstrat.analysis.v1.ComponentKind.
 */
export declare const ComponentKindSchema: GenEnum<ComponentKind>;
/**
 * @generated from enum xstockstrat.analysis.v1.StrategyOperation
 */
export declare enum StrategyOperation {
    /**
     * @generated from enum value: STRATEGY_OPERATION_UNSPECIFIED = 0;
     */
    UNSPECIFIED = 0,
    /**
     * @generated from enum value: STRATEGY_OPERATION_REGISTER = 1;
     */
    REGISTER = 1,
    /**
     * @generated from enum value: STRATEGY_OPERATION_UPDATE = 2;
     */
    UPDATE = 2,
    /**
     * @generated from enum value: STRATEGY_OPERATION_DEACTIVATE = 3;
     */
    DEACTIVATE = 3,
    /**
     * set active=TRUE; re-validates the stored definition (feature 089)
     *
     * @generated from enum value: STRATEGY_OPERATION_REACTIVATE = 4;
     */
    REACTIVATE = 4
}
/**
 * Describes the enum xstockstrat.analysis.v1.StrategyOperation.
 */
export declare const StrategyOperationSchema: GenEnum<StrategyOperation>;
/**
 * Comparator for a screen criterion's threshold test (closed set → enum).
 *
 * @generated from enum xstockstrat.analysis.v1.Comparator
 */
export declare enum Comparator {
    /**
     * @generated from enum value: COMPARATOR_UNSPECIFIED = 0;
     */
    UNSPECIFIED = 0,
    /**
     * @generated from enum value: COMPARATOR_LT = 1;
     */
    LT = 1,
    /**
     * @generated from enum value: COMPARATOR_LTE = 2;
     */
    LTE = 2,
    /**
     * @generated from enum value: COMPARATOR_GT = 3;
     */
    GT = 3,
    /**
     * @generated from enum value: COMPARATOR_GTE = 4;
     */
    GTE = 4,
    /**
     * threshold <= x <= threshold_high
     *
     * @generated from enum value: COMPARATOR_BETWEEN = 5;
     */
    BETWEEN = 5
}
/**
 * Describes the enum xstockstrat.analysis.v1.Comparator.
 */
export declare const ComparatorSchema: GenEnum<Comparator>;
/**
 * What a screen criterion evaluates.
 *
 * @generated from enum xstockstrat.analysis.v1.ScreenKind
 */
export declare enum ScreenKind {
    /**
     * @generated from enum value: SCREEN_KIND_UNSPECIFIED = 0;
     */
    UNSPECIFIED = 0,
    /**
     * a fundamental metric (metric_name)
     *
     * @generated from enum value: SCREEN_KIND_FUNDAMENTAL = 1;
     */
    FUNDAMENTAL = 1,
    /**
     * a custom formula (component)
     *
     * @generated from enum value: SCREEN_KIND_TECHNICAL_FORMULA = 2;
     */
    TECHNICAL_FORMULA = 2,
    /**
     * a built-in indicator (component)
     *
     * @generated from enum value: SCREEN_KIND_TECHNICAL_INDICATOR = 3;
     */
    TECHNICAL_INDICATOR = 3,
    /**
     * source-weighted signal blend
     *
     * @generated from enum value: SCREEN_KIND_SIGNAL = 4;
     */
    SIGNAL = 4
}
/**
 * Describes the enum xstockstrat.analysis.v1.ScreenKind.
 */
export declare const ScreenKindSchema: GenEnum<ScreenKind>;
/**
 * @generated from enum xstockstrat.analysis.v1.ScreenResultStatus
 */
export declare enum ScreenResultStatus {
    /**
     * @generated from enum value: SCREEN_RESULT_STATUS_UNSPECIFIED = 0;
     */
    UNSPECIFIED = 0,
    /**
     * @generated from enum value: SCREEN_RESULT_STATUS_OK = 1;
     */
    OK = 1,
    /**
     * @generated from enum value: SCREEN_RESULT_STATUS_INSUFFICIENT_DATA = 2;
     */
    INSUFFICIENT_DATA = 2
}
/**
 * Describes the enum xstockstrat.analysis.v1.ScreenResultStatus.
 */
export declare const ScreenResultStatusSchema: GenEnum<ScreenResultStatus>;
/**
 * The action a ranked opportunity suggests. Closed set → enum (C-04).
 * TRIM/EXIT are deliberately collapsed into REDUCE — the platform must not
 * synthesize a "fully exit vs trim" boundary on a row that opens a real order
 * ticket; the human chooses trim vs exit at the ticket (design.md § 1).
 *
 * @generated from enum xstockstrat.analysis.v1.OpportunityActionTag
 */
export declare enum OpportunityActionTag {
    /**
     * @generated from enum value: OPPORTUNITY_ACTION_TAG_UNSPECIFIED = 0;
     */
    UNSPECIFIED = 0,
    /**
     * buy signal, not currently held
     *
     * @generated from enum value: OPPORTUNITY_ACTION_TAG_ENTER = 1;
     */
    ENTER = 1,
    /**
     * buy signal, already held
     *
     * @generated from enum value: OPPORTUNITY_ACTION_TAG_ADD = 2;
     */
    ADD = 2,
    /**
     * sell signal, held (trim or exit — human decides)
     *
     * @generated from enum value: OPPORTUNITY_ACTION_TAG_REDUCE = 3;
     */
    REDUCE = 3
}
/**
 * Describes the enum xstockstrat.analysis.v1.OpportunityActionTag.
 */
export declare const OpportunityActionTagSchema: GenEnum<OpportunityActionTag>;
/**
 * Per-condition-leaf evaluation state. Closed set → enum (C-04).
 *
 * @generated from enum xstockstrat.analysis.v1.ConditionState
 */
export declare enum ConditionState {
    /**
     * @generated from enum value: CONDITION_STATE_UNSPECIFIED = 0;
     */
    UNSPECIFIED = 0,
    /**
     * leaf currently satisfied
     *
     * @generated from enum value: CONDITION_STATE_PASS = 1;
     */
    PASS = 1,
    /**
     * within the soft-band of the threshold but not passing
     *
     * @generated from enum value: CONDITION_STATE_SOFT = 2;
     */
    SOFT = 2,
    /**
     * not satisfied, outside the soft-band
     *
     * @generated from enum value: CONDITION_STATE_FAIL = 3;
     */
    FAIL = 3
}
/**
 * Describes the enum xstockstrat.analysis.v1.ConditionState.
 */
export declare const ConditionStateSchema: GenEnum<ConditionState>;
/**
 * The persisted per-user disposition of a queued opportunity (feature 097). Closed set → enum (C-04).
 *
 * @generated from enum xstockstrat.analysis.v1.OpportunityAction
 */
export declare enum OpportunityAction {
    /**
     * @generated from enum value: OPPORTUNITY_ACTION_UNSPECIFIED = 0;
     */
    UNSPECIFIED = 0,
    /**
     * hide until snooze_until (bounded)
     *
     * @generated from enum value: OPPORTUNITY_ACTION_SNOOZE = 1;
     */
    SNOOZE = 1,
    /**
     * hide indefinitely
     *
     * @generated from enum value: OPPORTUNITY_ACTION_DISMISS = 2;
     */
    DISMISS = 2,
    /**
     * user acted on it (feeds queue_share/taken reconciliation)
     *
     * @generated from enum value: OPPORTUNITY_ACTION_TAKE = 3;
     */
    TAKE = 3
}
/**
 * Describes the enum xstockstrat.analysis.v1.OpportunityAction.
 */
export declare const OpportunityActionSchema: GenEnum<OpportunityAction>;
/**
 * @generated from service xstockstrat.analysis.v1.AnalysisService
 */
export declare const AnalysisService: GenService<{
    /**
     * @generated from rpc xstockstrat.analysis.v1.AnalysisService.RunBacktest
     */
    runBacktest: {
        methodKind: "unary";
        input: typeof RunBacktestRequestSchema;
        output: typeof BacktestResultSchema;
    };
    /**
     * @generated from rpc xstockstrat.analysis.v1.AnalysisService.ScoreStrategy
     */
    scoreStrategy: {
        methodKind: "unary";
        input: typeof ScoreStrategyRequestSchema;
        output: typeof StrategyScoreSchema;
    };
    /**
     * @generated from rpc xstockstrat.analysis.v1.AnalysisService.ListStrategies
     */
    listStrategies: {
        methodKind: "unary";
        input: typeof ListStrategiesRequestSchema;
        output: typeof ListStrategiesResponseSchema;
    };
    /**
     * @generated from rpc xstockstrat.analysis.v1.AnalysisService.GetStrategyReport
     */
    getStrategyReport: {
        methodKind: "unary";
        input: typeof GetStrategyReportRequestSchema;
        output: typeof StrategyReportSchema;
    };
    /**
     * List past backtest runs (summary metrics + earned score) for a strategy, newest first.
     *
     * @generated from rpc xstockstrat.analysis.v1.AnalysisService.ListBacktests
     */
    listBacktests: {
        methodKind: "unary";
        input: typeof ListBacktestsRequestSchema;
        output: typeof ListBacktestsResponseSchema;
    };
    /**
     * Fetch the persisted full result (trades, per-bar equity, diagnostics) of a past run
     * (feature 068). NOT_FOUND when the run has no persisted detail (legacy/evicted/
     * INSUFFICIENT_DATA runs).
     *
     * @generated from rpc xstockstrat.analysis.v1.AnalysisService.GetBacktest
     */
    getBacktest: {
        methodKind: "unary";
        input: typeof GetBacktestRequestSchema;
        output: typeof BacktestResultSchema;
    };
    /**
     * @generated from rpc xstockstrat.analysis.v1.AnalysisService.ManageStrategy
     */
    manageStrategy: {
        methodKind: "unary";
        input: typeof ManageStrategyRequestSchema;
        output: typeof StrategyDefinitionSchema;
    };
    /**
     * @generated from rpc xstockstrat.analysis.v1.AnalysisService.GetStrategy
     */
    getStrategy: {
        methodKind: "unary";
        input: typeof GetStrategyRequestSchema;
        output: typeof StrategyDefinitionSchema;
    };
    /**
     * @generated from rpc xstockstrat.analysis.v1.AnalysisService.ListStrategyDefinitions
     */
    listStrategyDefinitions: {
        methodKind: "unary";
        input: typeof ListStrategyDefinitionsRequestSchema;
        output: typeof ListStrategyDefinitionsResponseSchema;
    };
    /**
     * @generated from rpc xstockstrat.analysis.v1.AnalysisService.SetStrategyLive
     */
    setStrategyLive: {
        methodKind: "unary";
        input: typeof SetStrategyLiveRequestSchema;
        output: typeof SetStrategyLiveResponseSchema;
    };
    /**
     * Screen a symbol universe against weighted criteria (feature 060)
     *
     * @generated from rpc xstockstrat.analysis.v1.AnalysisService.ScreenSymbols
     */
    screenSymbols: {
        methodKind: "unary";
        input: typeof ScreenSymbolsRequestSchema;
        output: typeof ScreenSymbolsResponseSchema;
    };
    /**
     * Manually trigger the fundamentals signal producer scan (feature 062, admin-scoped)
     *
     * @generated from rpc xstockstrat.analysis.v1.AnalysisService.RunFundamentalsScan
     */
    runFundamentalsScan: {
        methodKind: "unary";
        input: typeof RunFundamentalsScanRequestSchema;
        output: typeof FundamentalsScanSummarySchema;
    };
    /**
     * ── Opportunity queue + readiness + per-strategy analytics (feature 083) ─────
     * Ranked opportunity queue for the Decide surface. Aggregates ingest signals,
     * held positions, and the conviction/readiness evaluator (zero new edges).
     *
     * @generated from rpc xstockstrat.analysis.v1.AnalysisService.ListOpportunities
     */
    listOpportunities: {
        methodKind: "unary";
        input: typeof ListOpportunitiesRequestSchema;
        output: typeof ListOpportunitiesResponseSchema;
    };
    /**
     * Per-symbol live condition evaluation (traced): passing/soft/failing leaves +
     * distance-to-threshold. Feeds Signal-detail, Watchlist readiness, and the queue.
     *
     * @generated from rpc xstockstrat.analysis.v1.AnalysisService.EvaluateReadiness
     */
    evaluateReadiness: {
        methodKind: "unary";
        input: typeof EvaluateReadinessRequestSchema;
        output: typeof EvaluateReadinessResponseSchema;
    };
    /**
     * Persist a per-user disposition (snooze/dismiss/take) against a server-issued opportunity_key (feature 097).
     *
     * @generated from rpc xstockstrat.analysis.v1.AnalysisService.SetOpportunityAction
     */
    setOpportunityAction: {
        methodKind: "unary";
        input: typeof SetOpportunityActionRequestSchema;
        output: typeof SetOpportunityActionResponseSchema;
    };
    /**
     * Per-strategy analytics (expectancy / hit-rate / max-DD / signals / taken / queue-share).
     *
     * @generated from rpc xstockstrat.analysis.v1.AnalysisService.GetStrategyAnalytics
     */
    getStrategyAnalytics: {
        methodKind: "unary";
        input: typeof GetStrategyAnalyticsRequestSchema;
        output: typeof StrategyAnalyticsSchema;
    };
}>;
