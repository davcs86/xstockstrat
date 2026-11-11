# Context: webhook-fanout-callback

**Feature**: `docs/roadmap/features/334-webhook-fanout-callback/feature.md`
**Product Spec**: `docs/roadmap/features/334-webhook-fanout-callback/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/334-webhook-fanout-callback/implementation-spec.md`

---

## Session 2026-11-11 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Number 334 reserved through `scripts/sdd-allocate-feature-number.py` (`sdd/feature-cursor`).
- **Origin of the request.** Publisher side of the three-repo `webhooks-mcp` project. Input is section 8
  of the owner-approved design `docs/superpowers/specs/2026-11-11-webhooks-mcp-design.md` in the public
  repo `davcs86/webhooks-mcp` (read at commit `ad7e0ec`), plus section 7 of
  `docs/superpowers/plans/2026-11-11-orchestration.md` there (brief, expected step order, S7 check).
- **Owner authorizations for this feature (relayed in the session task, 2026-11-11):** the
  `feature/webhook-fanout-callback` branch, SDD step branches, and the feature-cursor reservation push;
  "start the full implementation" is the operator confirmation for in-scope SDD steps. The integration
  PR targets `main-dev` and is **not** merged by this session. The staging end-to-end (upstream S7) is
  **not** run until this session is told the listener is live.
- **Fixed by the owner — stop and report instead of changing:** RPC name `FanoutWebhook`; the wire
  format (product-spec FR-10 / upstream 8.3); delivery lives in notify; no ledger tail and no
  notify → ledger dependency.
- **Left to `/sdd-design`:** how `trigger_backfill` rejects a disallowed URL up front; whether
  `FanoutWebhook` needs an `x-internal-caller` allow-list.
- **Story-level readings of the upstream design, to be confirmed or overturned in design:**
  - Event names for FAILED / CANCELED hand-offs are written in AC-17 as `ingest.backfill.failed` /
    `ingest.backfill.canceled`. The upstream design only fixes that PARTIAL uses
    `ingest.backfill.completed`; recon must confirm the names ingest's existing ledger events use.
  - Redirects are never followed (AC-16) — the reading of "allowlist enforced on every delivery".
  - A hand-off notify rejects with `INVALID_ARGUMENT` at job end stops being retried and raises a
    WARNING (AC-20) — the upstream design says only "the publisher must not retry it".
  - Config key names in the product spec are proposals.

## Session 2026-11-11 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready. Tree: `main-dev` @ `0481498` (= `origin/main-dev`).
- Reviewer verdict PASS WITH WARNINGS, no Floor breach. Folded into the spec before the gate: FR-4 now
  matches AC-20; FR-3 requires every terminal path to hand off (C-10) and names the failed / canceled
  event names (confirmed in `services/xstockstrat-ingest/app/handlers/servicer.py`); proposed code
  defaults for all keys; migration run order; AC-5 extra negatives, AC-23 (case), AC-24 (persist before
  ack); open questions 3 and 4 ticked.
- Warnings carried to design / spec:
  - C-05: reader `path:symbol` and seed migration number are fixed at `/sdd-spec`.
  - FR-6 "internal only" has no negative scenario until design settles the `x-internal-caller` question.
  - C-03: identity / headers on the sweep-initiated call.
  - Notify single DB connection must not be held across an HTTP call.
  - C-09: pin the `callback_url` field number at `/sdd-spec` (trunk max on `TriggerBackfillRequest` is 7).
- Overlap findings: no FAIL. WARN: `notifyServiceImpl.ts` shared with 312 and 316 (rebase-only);
  config seed migration number races 330 / 280 / 299 (trunk tip 047 — re-derive at merge); agent
  `tools.py` / `client.py` shared with 314 / 319 / 322 / 328 / 331 / 299 (textual). Trunk tips: notify
  migrations 003, ingest migrations 014.
- Recommended design depth: full (proto change, DB migrations, 4 affected services, warning-level
  overlap). **The owner's brief for this feature specifies `/sdd-design quick`** — the architecture was
  already debated and approved upstream (design sections 4, 5, 8), so the remaining debate is the two
  delegated points. Running `quick`; the post-Recon escalation gate still applies.
