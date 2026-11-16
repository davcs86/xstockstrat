# docs/ — xstockstrat Platform Documentation

Operational runbooks, one-time setup guides, implementation roadmap, and reusable implementation patterns for the xstockstrat platform. Four subdirectories, each with its own CLAUDE.md index.

---

## Quick Reference

| Directory | What's inside | Use when |
|---|---|---|
| [`patterns/`](patterns/CLAUDE.md) | Reusable implementation patterns for new services | Creating a new frontend or backend service, or wiring auth/header-propagation |
| [`runbooks/`](runbooks/CLAUDE.md) | Operational procedures for day-to-day platform tasks | Adding a data source, rolling out a config change, backfilling data, building an indicator, managing proto versions |
| [`setup/`](setup/CLAUDE.md) | One-time setup guides for external services | First-time Alpaca, DigitalOcean, Grafana Cloud, or n8n setup |
| [`roadmap/`](roadmap/CLAUDE.md) | Implementation roadmap and per-phase deviation notes | Understanding what was built, why a decision was made, or what's left to implement |
| `reports/` | Dated point-in-time reports and defect write-ups (GitHub Issues are disabled; each defect has a `<basename>.status` sidecar — format in `.claude/skills/sdd-qa/reference/defect-filing.md`) | Reviewing what was registered or found on a given date; recording a new defect |
