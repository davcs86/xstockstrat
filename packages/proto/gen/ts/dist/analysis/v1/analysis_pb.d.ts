import type { GenEnum, GenFile, GenMessage, GenService } from "@bufbuild/protobuf/codegenv2";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
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
    DEACTIVATE = 3
}
/**
 * Describes the enum xstockstrat.analysis.v1.StrategyOperation.
 */
export declare const StrategyOperationSchema: GenEnum<StrategyOperation>;
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
     * Manually trigger the fundamentals signal producer scan (feature 062, admin-scoped)
     *
     * @generated from rpc xstockstrat.analysis.v1.AnalysisService.RunFundamentalsScan
     */
    runFundamentalsScan: {
        methodKind: "unary";
        input: typeof RunFundamentalsScanRequestSchema;
        output: typeof FundamentalsScanSummarySchema;
    };
}>;
