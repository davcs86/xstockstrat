# SDD Suite

xstockstrat's **Spec-Driven Development** toolchain, published for **Claude Code** and **Cursor**
from one shared tree. It bundles the `/sdd-*` lifecycle skills and the read-only advisory subagents
they orchestrate.

> **Repo-specific.** Like `strat-lab`, this plugin is not repo-agnostic: the skills read
> `docs/sdd/` (the Constitution and business rules), `docs/roadmap/` (features + ledger), and
> project conventions of the **host xstockstrat repository**. Installed anywhere else, they have
> nothing to read.

## What's inside

- **Skills** (`skills/`): `sdd-story`, `sdd-review`, `sdd-design`, `sdd-spec`, `sdd-execute`,
  `sdd-status`, `sdd-sync`, `sdd-qa`, `sdd-triage`, `sdd-distill`, `sdd-archiver`.
- **Subagents** (`agents/`): `design-proposer`, `design-adversary`, `spec-reviewer`,
  `feature-overlap`, `codebase-discovery`, `service-briefing`, `qa-tester`, `scenario-recon`,
  `scenario-promoter`, `feature-synthesizer`, `context-distiller`.

The `dry-reviewer` subagent deliberately stays in the host repo's `.claude/agents/` — it backs the
repo-wide **DRY guard rail** (pre-commit hook + `scripts/check-duplication.sh`), not just SDD, so it
is host infrastructure rather than an SDD component.

## Plugin dependency — context-forge

The SDD lifecycle's teardown step runs `/context-forge:context-constitution refresh`, so this plugin
declares a **cross-marketplace dependency** on `context-forge`, which lives in the separate
`davcs86-agent-plugins` marketplace:

```json
"dependencies": [
  { "name": "context-forge", "marketplace": "davcs86-agent-plugins" }
]
```

Claude Code refuses to auto-install a dependency from a *different* marketplace unless the **root**
marketplace explicitly allows it, so the repo's `.claude-plugin/marketplace.json` carries:

```json
"allowCrossMarketplaceDependenciesOn": ["davcs86-agent-plugins"]
```

Enabling `sdd-suite@davcs86-xstockstrat` therefore pulls in `context-forge@davcs86-agent-plugins`
automatically (that marketplace is already registered via `.claude/settings.json`
`extraKnownMarketplaces`). The dependency + allowlist are **Claude Code** features; the Cursor
manifest intentionally omits them.

## Invocation

Skill names are unchanged (`sdd-story`, `sdd-design`, …). As plugin skills their canonical form is
`/sdd-suite:sdd-story`; a bare `/sdd-story` still resolves when the name is unambiguous.

## Install

Published from **this repository**, which is its own marketplace:

```shell
/plugin marketplace add davcs86/xstockstrat
/plugin install sdd-suite@davcs86-xstockstrat
```

In this repo it is enabled by default via `.claude/settings.json` (`enabledPlugins`).

## Validate

```shell
python3 plugins/sdd-suite/scripts/validate.py --self-test
python3 plugins/sdd-suite/scripts/validate.py
```

The validator checks both manifests, every skill's frontmatter and internal links, the
marketplace registration, **and** dependency integrity — that the `context-forge` dependency and the
root marketplace's `allowCrossMarketplaceDependenciesOn` allowlist agree.
