## Promotion Checklist

- [ ] All services smoke-tested on dev (paper trading) environment
- [ ] No open incidents or active maintenance mode on dev
- [ ] Config keys for new features registered in prod config service (see docs/runbooks/config-rollout.md)
- [ ] Proto breaking changes signed off (if any — see docs/runbooks/proto-versioning.md)

## Changelog

<!-- Paste changelog entry here -->

---

> ⚠️ **Merge strategy: "Create a merge commit" — NEVER squash or rebase.**
> Squash-merging breaks git ancestry: the promoted main-dev commits never become ancestors of main, so the next promotion's diff re-shows changes that are already promoted.
> On GitHub: click the dropdown arrow next to the merge button and select
> **"Create a merge commit"**.
