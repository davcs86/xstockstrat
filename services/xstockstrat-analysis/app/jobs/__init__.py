"""Pipeline job handlers (feature 367); `job.db()` is a handler's only database access."""

from app.engine.job_graph import HandlerRegistry


def build_registry(settings) -> HandlerRegistry:
    registry = HandlerRegistry()
    registry.validate()
    return registry
