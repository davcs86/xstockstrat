# Defect: marketdata toGRPCError maps only six codes; everything else becomes INTERNAL

**Recorded**: 2026-10-19
**Severity**: SEV-3
**Impact type**: wrong-error-code
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: xstockstrat-marketdata
**Config-only fix possible**: no
**Source**: `services/xstockstrat-marketdata/docs/context-constitution-findings.md` § Latent bugs, row 1; constitution MARKETDATA-N2

## Observed
Every gRPC adapter method passes handler errors through `toGRPCError`. It translates only
InvalidArgument, NotFound, PermissionDenied, FailedPrecondition, ResourceExhausted and Unavailable.
Any other connect code (`DeadlineExceeded`, `Canceled`, `AlreadyExists`, `Unimplemented`,
`Unauthenticated`, `Aborted`), and any raw non-connect error, becomes `codes.Internal`. The sector
RPCs, `GetEtfFlags`, `GetHistoricalFundamentals` and `BackfillFundamentals` return service errors
raw (MARKETDATA-N2's third behaviour). A caller deadline or cancellation on those RPCs therefore
reaches the caller as INTERNAL, indistinguishable from a server fault. The service raises no other
connect codes today, so the effect is limited to raw errors for now. Any future coded error hits
the same trap.

## Expected
The full connect→gRPC code mapping is preserved (e.g. `codes.Code(connect.CodeOf(err))`), and raw
context errors map via `status.FromContextError`.

## Reproduction
1. Call `GetSectorHistory` over gRPC with a 1ms client deadline against a cold DB.
2. Observe that the server-side error, if the handler returns `context.DeadlineExceeded`, is
   reported as `INTERNAL`.
3. Unit test: `toGRPCError(connect.NewError(connect.CodeDeadlineExceeded, e))` returns `codes.Internal`.

## Evidence
`services/xstockstrat-marketdata/internal/handler/marketdata_handler.go:496`
> func toGRPCError(err error) error {

`services/xstockstrat-marketdata/internal/handler/marketdata_handler.go:514`
> return status.Error(codes.Internal, err.Error())

`services/xstockstrat-marketdata/internal/handler/marketdata_handler.go:179-181`
> resp, err := h.svc.GetSectorHistory(ctx, req.Msg)
> if err != nil {
> return nil, err

`services/xstockstrat-marketdata/internal/handler/marketdata_handler.go:379`
> return nil, toGRPCError(err)

## Root cause hypothesis
The switch was written for the codes the screener and fundamentals consumers needed, with a
blanket Internal default, instead of a generic code passthrough.

## Confidence
high
