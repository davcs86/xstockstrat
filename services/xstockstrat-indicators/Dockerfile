FROM python:3.13-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app
# libseccomp: libseccomp2 (runtime, kept) + libseccomp-dev/gcc (build the pyseccomp binding, purged).
# The formula sandbox loads a seccomp-BPF filter in each child (feature 207/209 — SSRF/RCE containment).
# DL3008 ignored: pinning these system libs to base-image versions would break on a slim refresh.
# hadolint ignore=DL3008
RUN apt-get update \
    && apt-get install -y --no-install-recommends libseccomp2 libseccomp-dev gcc \
    && rm -rf /var/lib/apt/lists/*
COPY services/xstockstrat-indicators/pyproject.toml services/xstockstrat-indicators/uv.lock ./
RUN uv sync --frozen --no-dev \
    && apt-get purge -y libseccomp-dev gcc \
    && apt-get autoremove -y \
    && apt-get clean

COPY packages/proto/gen/python /proto/gen/python
RUN uv pip install -e /proto/gen/python

# Expose gen/ as a Python namespace package so "from gen.xxx.v1 import" works
RUN ln -s /proto/gen/python /app/gen

COPY services/xstockstrat-indicators/ .
COPY scripts/wait-for-deps.sh /usr/local/bin/wait-for-deps.sh
COPY scripts/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /usr/local/bin/wait-for-deps.sh /docker-entrypoint.sh
EXPOSE 50054
ENV PATH="/app/.venv/bin:$PATH"
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["python", "-m", "app.main"]
