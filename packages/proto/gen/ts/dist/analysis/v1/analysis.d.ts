import { BinaryReader, BinaryWriter } from "@bufbuild/protobuf/wire";
import { type CallOptions, type ChannelCredentials, Client, type ClientOptions, type ClientUnaryCall, type handleUnaryCall, type Metadata, type ServiceError, type UntypedServiceImplementation } from "@grpc/grpc-js";
import { PageRequest, PageResponse, TimeRange } from "../../common/v1/common";
export declare const protobufPackage = "xstockstrat.analysis.v1";
export interface RunBacktestRequest {
    strategyId: string;
    range?: TimeRange | undefined;
    symbols: string[];
    initialCapital: number;
    strategyParams?: {
        [key: string]: any;
    } | undefined;
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
export declare const RunBacktestRequest: MessageFns<RunBacktestRequest>;
export declare const BacktestResult: MessageFns<BacktestResult>;
export declare const TradeRecord: MessageFns<TradeRecord>;
export declare const ScoreStrategyRequest: MessageFns<ScoreStrategyRequest>;
export declare const StrategyScore: MessageFns<StrategyScore>;
export declare const StrategyScore_ComponentScoresEntry: MessageFns<StrategyScore_ComponentScoresEntry>;
export declare const StrategyReport: MessageFns<StrategyReport>;
export declare const ListStrategiesRequest: MessageFns<ListStrategiesRequest>;
export declare const ListStrategiesResponse: MessageFns<ListStrategiesResponse>;
export declare const GetStrategyReportRequest: MessageFns<GetStrategyReportRequest>;
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
};
export interface AnalysisServiceServer extends UntypedServiceImplementation {
    runBacktest: handleUnaryCall<RunBacktestRequest, BacktestResult>;
    scoreStrategy: handleUnaryCall<ScoreStrategyRequest, StrategyScore>;
    listStrategies: handleUnaryCall<ListStrategiesRequest, ListStrategiesResponse>;
    getStrategyReport: handleUnaryCall<GetStrategyReportRequest, StrategyReport>;
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
