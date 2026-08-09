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
| `reports/` | Dated point-in-time reports — registered-asset catalogs, validation findings, and defect write-ups. GitHub Issues are disabled on this repo (`POST /issues` → `410`), so this is where a defect is recorded before `/sdd-triage --from-report` routes it | Reviewing what was registered or found on a given date; recording a new defect |

---

## Finding the Right File

Every scenario below routed to one file inside one of the four subdirectories above — and each of
those subdirectories' own `CLAUDE.md` index already maps its files to use cases at least as
specifically. Open the subdirectory that matches your task (Quick Reference table above) and read
its index rather than a separate scenario table here.
