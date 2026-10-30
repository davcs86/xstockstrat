FROM python:3.13-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

ARG SMOKE_GIT_SHA
RUN test -n "$SMOKE_GIT_SHA"
ENV SMOKE_GIT_SHA=$SMOKE_GIT_SHA

WORKDIR /app
COPY services/xstockstrat-smoke/pyproject.toml services/xstockstrat-smoke/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY packages/proto/gen/python /proto/gen/python
RUN uv pip install -e /proto/gen/python

# Expose gen/ as a Python namespace package so "from gen.xxx.v1 import" works
RUN ln -s /proto/gen/python /app/gen

COPY services/xstockstrat-smoke/ .
COPY scripts/wait-for-deps.sh /usr/local/bin/wait-for-deps.sh
COPY scripts/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /usr/local/bin/wait-for-deps.sh /docker-entrypoint.sh
EXPOSE 9110
ENV PATH="/app/.venv/bin:$PATH"
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["python", "-m", "app.main"]
