FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app
COPY services/xstockstrat-agent/pyproject.toml services/xstockstrat-agent/uv.lock ./
RUN uv sync --frozen --no-dev

COPY packages/proto/gen/python /proto/gen/python
RUN uv pip install -e /proto/gen/python

# Expose gen/ as a Python namespace package so "from gen.xxx.v1 import" works
RUN ln -s /proto/gen/python /app/gen

COPY services/xstockstrat-agent/ .
EXPOSE 9000
ENV PATH="/app/.venv/bin:$PATH"
CMD ["python", "-m", "app.main"]
