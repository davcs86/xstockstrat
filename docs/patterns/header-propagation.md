# Header Propagation Convention

Every service that receives **inbound** gRPC calls **must** extract and forward the three propagation headers on all **outbound** calls. This convention was established by feature `wire-fe-auth`.

| Header | Carries | Set by |
|---|---|---|
| `x-user-id` | Authenticated user ID from JWT | Frontend middlewares; propagated by all backend services |
| `x-access-scope` | Bitmap of user roles | Frontend API routes; propagated by all backend services |
| `x-trace-id` | Request trace identifier | Frontend `middleware.ts` (generates if absent); propagated by all backend services |

Nginx strips all three headers from **inbound external requests** so internal services can trust them as platform-generated values.

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
