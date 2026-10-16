# Context: agent-log-query

**Feature**: `docs/roadmap/features/229-agent-log-query/feature.md`
**Product Spec**: `docs/roadmap/features/229-agent-log-query/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/229-agent-log-query/implementation-spec.md`

---

## Session 2026-10-16T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Owner decisions (operator chat, 2026-10-16): scope = app services + database host; log content
  reaching Anthropic as conversation context is acceptable; both environments, each agent confined to
  its own; store = Grafana Cloud Loki; permission = new dedicated role `log_reader`, not implied by admin.
- Database host taken as a native Postgres install on a home LXC/VM (owner answer "2?", matching
  `homelab-edge` `docs/runbooks/home-side.md` pgBackRest TLS server on `tag:db`) — confirm in design.
- Rejected before spec: mounting `/var/run/docker.sock` in the agent (root-equivalent on an
  internet-facing process); `docker-socket-proxy` with `CONTAINERS=1` (`GET /containers/{id}/json`
  leaks `Config.Env` secrets); a separate public log MCP server (widens the edge's public surface).
- Recon findings carried forward: deploy is DO App Platform per `.do/app*.yaml` while `homelab-edge`
  expects a home app VM — topology is mid-migration (owner: "Mixed / migrating"); OTel exports traces
  only; no permission/scope model beyond the three roles.
