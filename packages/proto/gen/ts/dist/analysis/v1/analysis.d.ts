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
export interface ListStrategiesRequest {
    page?: PageRequest | undefined;
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
}
export interface ManageStrategyRequest {
    operation: StrategyOperation;
    definition?: StrategyDefinition | undefined;
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
}
export interface ScreenResult_CriterionScoresEntry {
    key: string;
    value: number;
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
export declare const RunBacktestRequest: MessageFns<RunBacktestRequest>;
export declare const CoverageGap: MessageFns<CoverageGap>;
export declare const BacktestResult: MessageFns<BacktestResult>;
export declare const TradeRecord: MessageFns<TradeRecord>;
export declare const ScoreStrategyRequest: MessageFns<ScoreStrategyRequest>;
export declare const StrategyScore: MessageFns<StrategyScore>;
export declare const StrategyScore_ComponentScoresEntry: MessageFns<StrategyScore_ComponentScoresEntry>;
export declare const StrategyReport: MessageFns<StrategyReport>;
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
export declare const ScreenSymbolsRequest: MessageFns<ScreenSymbolsRequest>;
export declare const ScreenSymbolsResponse: MessageFns<ScreenSymbolsResponse>;
export declare const RunFundamentalsScanRequest: MessageFns<RunFundamentalsScanRequest>;
export declare const FundamentalsScanSummary: MessageFns<FundamentalsScanSummary>;
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
};
export interface AnalysisServiceServer extends UntypedServiceImplementation {
    runBacktest: handleUnaryCall<RunBacktestRequest, BacktestResult>;
    scoreStrategy: handleUnaryCall<ScoreStrategyRequest, StrategyScore>;
    listStrategies: handleUnaryCall<ListStrategiesRequest, ListStrategiesResponse>;
    getStrategyReport: handleUnaryCall<GetStrategyReportRequest, StrategyReport>;
    manageStrategy: handleUnaryCall<ManageStrategyRequest, StrategyDefinition>;
    getStrategy: handleUnaryCall<GetStrategyRequest, StrategyDefinition>;
    listStrategyDefinitions: handleUnaryCall<ListStrategyDefinitionsRequest, ListStrategyDefinitionsResponse>;
    setStrategyLive: handleUnaryCall<SetStrategyLiveRequest, SetStrategyLiveResponse>;
    /** Screen a symbol universe against weighted criteria (feature 060) */
    screenSymbols: handleUnaryCall<ScreenSymbolsRequest, ScreenSymbolsResponse>;
    /** Manually trigger the fundamentals signal producer scan (feature 062, admin-scoped) */
    runFundamentalsScan: handleUnaryCall<RunFundamentalsScanRequest, FundamentalsScanSummary>;
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
