"""Outbound gRPC for checks: every call is policy-checked before any channel opens and carries the
header trio as the non-admin smoke user."""

from google.protobuf import message_factory

ACCESS_SCOPE_READ = 0x01


class SmokeUserUnset(Exception):
    pass


class MutatingRpcRefused(Exception):
    pass


class BenignReadRefused(Exception):
    pass


class Rpc:
    def __init__(self, *, user_id, trace_id, endpoints, channel_factory, policy):
        self.user_id = user_id
        self.trace_id = trace_id
        self._endpoints = endpoints
        self._channel_factory = channel_factory
        self._policy = policy
        self._channels: dict[str, object] = {}
        self.invoked: list[str] = []
        self.writes: list[str] = []

    async def call(self, full_method: str, request, *, timeout: float = 10.0):
        if not self.user_id:
            raise SmokeUserUnset("smoke.rpc.user_id unset")
        decision = self._policy(full_method, request=request)
        if not decision.allowed:
            raise MutatingRpcRefused(decision.reason)
        if decision.guard is not None:
            refusal = await decision.guard(self)
            if refusal:
                raise BenignReadRefused(f"{full_method}: {refusal}")
        service, _, method = full_method.partition("/")
        svc = service.split(".")[1]
        endpoint = self._endpoints.get(svc)
        if not endpoint:
            raise RuntimeError(f"no endpoint for {svc} ({svc.upper()}_ENDPOINT unset)")
        pool = request.DESCRIPTOR.file.pool
        output = pool.FindServiceByName(service).FindMethodByName(method).output_type
        if svc not in self._channels:
            self._channels[svc] = self._channel_factory(endpoint, f"xstockstrat-{svc}")
        stub = self._channels[svc].unary_unary(
            f"/{full_method}",
            request_serializer=type(request).SerializeToString,
            response_deserializer=message_factory.GetMessageClass(output).FromString,
        )
        self.invoked.append(full_method)
        if decision.write:
            self.writes.append(full_method)
        return await stub(
            request,
            timeout=timeout,
            metadata=(
                ("x-user-id", self.user_id),
                ("x-access-scope", str(ACCESS_SCOPE_READ)),
                ("x-trace-id", self.trace_id),
            ),
        )

    async def close(self) -> None:
        for channel in self._channels.values():
            await channel.close()
        self._channels.clear()
