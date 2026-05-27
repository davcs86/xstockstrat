FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app
COPY services/xstockstrat-ingest/pyproject.toml services/xstockstrat-ingest/uv.lock ./
RUN uv sync --frozen --no-dev

COPY packages/proto/gen/python /proto/gen/python
RUN uv pip install -e /proto/gen/python

# Expose gen/ as a Python namespace package so "from gen.xxx.v1 import" works
RUN ln -s /proto/gen/python /app/gen

COPY services/xstockstrat-ingest/ .
EXPOSE 50055
EXPOSE 8055
ENV PATH="/app/.venv/bin:$PATH"
CMD ["python", "-m", "app.main"]
