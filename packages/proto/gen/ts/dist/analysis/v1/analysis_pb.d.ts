import type { GenFile, GenMessage, GenService } from "@bufbuild/protobuf/codegenv2";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import type { PageRequest, PageResponse, TimeRange } from "../../common/v1/common_pb";
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
};
/**
 * Describes the message xstockstrat.analysis.v1.RunBacktestRequest.
 * Use `create(RunBacktestRequestSchema)` to create a new message.
 */
export declare const RunBacktestRequestSchema: GenMessage<RunBacktestRequest>;
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
}>;
