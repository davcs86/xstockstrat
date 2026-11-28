"""Pipeline job handlers (feature 367); `job.db()` is a handler's only database access."""

from app.engine.job_graph import PRUNE_KIND, HandlerRegistry
from app.jobs.retention_prune import make_handler as make_retention_prune


def build_registry(settings) -> HandlerRegistry:
    registry = HandlerRegistry()
    registry.register(PRUNE_KIND, make_retention_prune(settings))
    registry.validate()
    return registry
