# docs/ — xstockstrat Platform Documentation

Operational runbooks, one-time setup guides, and implementation roadmap for the xstockstrat platform. Three subdirectories, each with its own CLAUDE.md index.

---

## Quick Reference

| Directory | What's inside | Use when |
|---|---|---|
| [`runbooks/`](runbooks/CLAUDE.md) | Operational procedures for day-to-day platform tasks | Adding a data source, rolling out a config change, backfilling data, building an indicator, managing proto versions |
| [`setup/`](setup/CLAUDE.md) | One-time setup guides for external services | First-time Alpaca, DigitalOcean, Grafana Cloud, or n8n setup |
| [`roadmap/`](roadmap/CLAUDE.md) | Implementation roadmap and per-phase deviation notes | Understanding what was built, why a decision was made, or what's left to implement |

---

## Common Scenarios → Right File

| I need to… | File |
|---|---|
| Roll out a config change safely | `runbooks/config-rollout.md` |
| Understand the approval process for proto/config changes | `runbooks/approval-flow.md` |
| Add Polygon, Tiingo, or a newsletter signal source | `runbooks/add-data-source.md` |
| Backfill historical OHLCV bars | `runbooks/historical-backfill.md` |
| Build and register a custom indicator formula | `runbooks/indicator-builder.md` |
| Manage a v1→v2 proto migration | `runbooks/proto-versioning.md` |
| Start a new feature branch or deploy to production | `runbooks/feature-workflow.md` |
| Seed golang-migrate state on an existing database | `runbooks/db-seed-migration-state.md` |
| Set up Alpaca API keys | `setup/alpaca.md` |
| Create DO App Platform dev/prod apps | `setup/digitalocean.md` |
| Wire OpenTelemetry to Grafana Cloud | `setup/grafana-cloud.md` |
| Import and configure n8n workflows | `setup/n8n.md` |
| See the full implementation plan and phase status | `roadmap/implementation-roadmap.md` |
| Understand why a Phase 3–6 service was built a certain way | `roadmap/phase[3-6]-deviations.md` |
