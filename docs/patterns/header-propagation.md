# Header Propagation Convention

Every service that receives **inbound** gRPC calls **must** extract and forward the three propagation headers on all **outbound** calls. This convention was established by feature `wire-fe-auth`.

| Header | Carries | Set by |
|---|---|---|
| `x-user-id` | Authenticated user ID from JWT | Frontend middlewares; propagated by all backend services |
| `x-access-scope` | Bitmap of user roles | Frontend API routes; propagated by all backend services |
| `x-trace-id` | Request trace identifier | Frontend `middleware.ts` (generates if absent); propagated by all backend services |

The platform entry points strip these headers from **inbound external requests** and re-set them from
authenticated context, so internal services can trust them as platform-generated values. (nginx was
removed by feature 045; the entry points are now the `xstockstrat-ui` BFF and the MCP agent SSE layer.)

## Authorization model: entry authenticates, internal services role-check

Authentication/authorization happens **once, at the entry point**; internal backend services do **not**
re-authenticate — at most they perform a **role check** on the propagated `x-access-scope`:

- **Entry points authenticate.** The `xstockstrat-ui` BFF validates the JWT and sets
  `x-user-id` / `x-access-scope` from the verified claims. The **MCP agent** SSE layer authenticates the
  caller (OAuth 2.1 audience-bound JWT or a legacy API key) and, for admin-scoped tools, validates the
  admin role at the agent entry (`client.validate_admin`) before forwarding `x-access-scope`.
- **Internal services role-check only.** Admin-gated RPCs check the ADMIN bit on the propagated scope:
  `int(x-access-scope) & 0x04`. They abort `PERMISSION_DENIED` ("admin scope required") rather than
  calling identity to re-validate a credential. Reference helper: `_has_admin_scope` in
  `xstockstrat-analysis`, `xstockstrat-ingest`, and `xstockstrat-indicators` servicers (feature 049
  unified these onto the single model).

### Documented exception: indicators formula author-ownership

`xstockstrat-indicators` formula management (`UpdateFormula` / `DeleteFormula`) keeps a distinct
**author-ownership** check (`row.author == request.user_id`) as its primary authorization model — a
deliberate, documented exception to the pure role-check model. Feature 049 added an **admin-scope
override** (`x-access-scope & 0x04`) so platform admins can manage any formula, and closed the
`RegisterFormula` gap (the author now defaults to the propagated `x-user-id`, required — no silent
`"dev-user"` default).

## Go services

Reference implementation: `services/xstockstrat-trading/internal/middleware/propagation.go`

Create `internal/middleware/propagation.go`:

```go
type propagationKey struct{ name string }
var userIDKey      = propagationKey{"x-user-id"}
var accessScopeKey = propagationKey{"x-access-scope"}
var traceIDKey     = propagationKey{"x-trace-id"}

// PropagationUnaryInterceptor extracts the three headers from incoming gRPC
// metadata and stashes them in the context for outbound call forwarding.
func PropagationUnaryInterceptor(
    ctx context.Context, req any, _ *grpc.UnaryServerInfo, handler grpc.UnaryHandler,
) (any, error) {
    if md, ok := metadata.FromIncomingContext(ctx); ok {
        ctx = context.WithValue(ctx, userIDKey,      first(md["x-user-id"]))
        ctx = context.WithValue(ctx, accessScopeKey, first(md["x-access-scope"]))
        ctx = context.WithValue(ctx, traceIDKey,     first(md["x-trace-id"]))
    }
    return handler(ctx, req)
}

func UserID(ctx context.Context) string      { return strVal(ctx, userIDKey) }
func AccessScope(ctx context.Context) string { return strVal(ctx, accessScopeKey) }
func TraceID(ctx context.Context) string     { return strVal(ctx, traceIDKey) }
```

Register in `grpc.NewServer`:
```go
grpc.NewServer(grpc.ChainUnaryInterceptor(middleware.PropagationUnaryInterceptor, ...))
```

Forward on outbound calls:
```go
outMD := metadata.Pairs(
    "x-user-id",      middleware.UserID(ctx),
    "x-access-scope", middleware.AccessScope(ctx),
    "x-trace-id",     middleware.TraceID(ctx),
)
stub.SomeRPC(metadata.NewOutgoingContext(ctx, outMD), req)
```

## Python services (grpc.aio)

Extract at the top of every handler method, then pass `metadata=propagation_meta` to all downstream stub calls:

```python
propagation_meta = [
    (k, v)
    for k, v in context.invocation_metadata()
    if k in ("x-user-id", "x-access-scope", "x-trace-id")
]
# ...
await self._some_stub.SomeRPC(request, metadata=propagation_meta)
```

**Background tasks**: `asyncio.create_task` detaches from the gRPC context — extract `propagation_meta` **before** spawning the task and pass it as an explicit parameter:

```python
propagation_meta = [(k, v) for k, v in context.invocation_metadata()
                    if k in ("x-user-id", "x-access-scope", "x-trace-id")]
asyncio.create_task(self._background_task(arg, propagation_meta))

async def _background_task(self, arg, propagation_meta=()):
    await self._stub.SomeRPC(req, metadata=propagation_meta)
```

## Node.js services (gRPC)

Backend Node.js services are **gRPC-only** (`@grpc/grpc-js`). Use `AsyncLocalStorage` to carry
the three headers from the inbound gRPC call's metadata to any outbound gRPC clients.

Reference store: `services/xstockstrat-ledger/src/middleware/propagation.ts`

```typescript
import { AsyncLocalStorage } from 'async_hooks';
import type { Metadata } from '@grpc/grpc-js';

export interface PropagationContext {
  userId: string;
  accessScope: string;
  traceId: string;
}

export const propagationStore = new AsyncLocalStorage<PropagationContext>();

export function extractFromMetadata(md: Metadata): PropagationContext {
  const get = (k: string) => (md.get(k)[0] as string) ?? '';
  return {
    userId:      get('x-user-id'),
    accessScope: get('x-access-scope') || '0',
    traceId:     get('x-trace-id'),
  };
}
```

In each gRPC handler (or a shared wrapper), run the body inside the store using the call's
metadata, then attach it to outbound metadata on downstream gRPC calls:

```typescript
propagationStore.run(extractFromMetadata(call.metadata), () => handle(call, callback));
```

> Note: sink/source services (ledger, config) and auth (identity) make few or no authenticated
> outbound calls, so they may keep the store unused. Wire the interceptor when a service starts
> making outbound calls that must carry user/trace context.
