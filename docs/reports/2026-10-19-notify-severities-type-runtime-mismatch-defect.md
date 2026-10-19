# Defect: StreamAlerts severities filter typed number[] but carries string enums at runtime

**Recorded**: 2026-10-19
**Severity**: SEV-3
**Impact type**: silent-filter-break-risk
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: xstockstrat-notify
**Config-only fix possible**: no
**Source**: `services/xstockstrat-notify/docs/context-constitution-findings.md` § Latent bugs row 1; constitution § Gotchas

## Observed
`StreamSubscriber.severities` is declared `number[]`. Under ts-proto `stringEnums`, both the
request's `severities` and `alert.severity` are strings (`"ALERT_SEVERITY_WARNING"`), so the
`includes` comparison works today only by accident of matching runtime types. The only unit test
drives numeric values (`[1, 2]`), so a change that numeric-converts one side to "match the type"
passes CI and silently stops severity-filtered subscribers from receiving any alert.

## Expected
Type the field as the ts-proto `AlertSeverity` string enum, and test the filter with the string form that arrives on the wire.

## Reproduction
1. Read `notifyServiceImpl.ts:14` and `:280`.
2. Compare with the test at `notifyServiceImpl.test.ts:610`.
3. Convert `alert.severity` with `alertSeverityToNumber` in `matchesSubscriber`; the test still passes while real string-enum subscribers match nothing.

## Evidence
`services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts:14`
> `  severities: number[];`

`services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts:280`
> `    if (sub.severities.length > 0 && !sub.severities.includes(alert.severity)) {`

`services/xstockstrat-notify/src/__tests__/notifyServiceImpl.test.ts:610`
> `    const sub = { userId: '', categories: [], severities: [1, 2], includeAcknowledged: false, call: {} };`

## Root cause hypothesis
The interface was hand-typed from the proto's numeric enum before `stringEnums` was adopted, and handlers are untyped (`any`), so the compiler never flags it.

## Confidence
high
