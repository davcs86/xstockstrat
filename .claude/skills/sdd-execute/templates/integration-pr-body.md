# INTEGRATION PR BODY (template)

Rendered by **ALL-DONE PATH** and by **SEQUENTIAL MODE §5.6** when opening the final integration PR
(`feature/<slug> → main-dev`). Substitute every `<placeholder>` before use.

---

**Title:** `feat(<slug>): <one-line feature summary from feature.md>`

## feat(<slug>): <one-line feature summary>

<one-paragraph summary of the feature, from product-spec.md / feature.md.>

**Steps (delivered as <stacked per-step PRs | commits> — merge bottom-up):**
<for each step in implementation-spec.md, one line: `N. <title>` (+ PR # if a step PR exists)>

**New migrations:** <list `NNN_*.up.sql` files added by any migration step, or "none">
**New env vars:** <list new env vars added to docker-compose / .do specs, or "none">

**Deviations:** <one-line summary of each `## Deviation Log` entry, or "none">

**Test plan**
- [ ] CI green (proto-freshness / lint / unit tests / e2e as applicable)
- [ ] <feature-specific manual check 1>
- [ ] <feature-specific manual check 2>

<!-- If a merge-order gate applied, note the blocking feature + that this fills out as the stack merges. -->
