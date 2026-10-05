"""Client interceptor asserting analysis's x-internal-caller identity on outbound unary calls."""

import grpc

HEADER_INTERNAL_CALLER = "x-internal-caller"
INTERNAL_CALLER_ID = "analysis"


class InternalCallerInterceptor(grpc.aio.UnaryUnaryClientInterceptor):
    """Appends ``x-internal-caller: analysis`` — indicators lets it read/execute formulas the
    propagated x-user-id does not own (strategy formulas run on behalf of their owner)."""

    async def intercept_unary_unary(self, continuation, client_call_details, request):
        metadata = list(client_call_details.metadata or [])
        metadata.append((HEADER_INTERNAL_CALLER, INTERNAL_CALLER_ID))
        return await continuation(client_call_details._replace(metadata=metadata), request)
