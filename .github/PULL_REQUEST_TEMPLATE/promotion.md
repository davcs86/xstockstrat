## Promotion Checklist

- [ ] All services smoke-tested on dev (paper trading) environment
- [ ] No open incidents or active maintenance mode on dev
- [ ] Config keys for new features registered in prod config service (see docs/runbooks/config-rollout.md)
- [ ] Proto breaking changes signed off (if any — see docs/runbooks/proto-versioning.md)

## Changelog

<!-- Paste changelog entry here -->

---

> ⚠️ **Merge strategy: "Create a merge commit" — NEVER squash or rebase.**
> Squash-merging a promotion PR breaks git ancestry: `main-dev` appears permanently
> ahead of `main` even after content is promoted, and future promotion diffs are polluted.
> On GitHub: click the dropdown arrow next to the merge button and select
> **"Create a merge commit"**.
