FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
ENV UV_SYSTEM_PYTHON=1

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY ../../packages/proto/gen/python /proto/gen/python
RUN uv pip install --system -e /proto/gen/python

COPY . .
EXPOSE 50054
EXPOSE 8054
CMD ["python", "-m", "app.main"]
