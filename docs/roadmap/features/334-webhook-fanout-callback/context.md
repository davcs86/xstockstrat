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

## Session 2026-11-11 — sdd-design (Phase 0 Recon)

- Tree: `main-dev@0481498 ≡ origin/main-dev` (working branch `feature/webhook-fanout-callback`, same tree
  plus this feature's docs). Wrote recon.md from four `codebase-discovery` digests + `scenario-recon`.
- C-16: no CHANGE verdict on any existing `@AC-*` rule (all PRESERVE / EXTEND).
- Post-Recon escalation: the rubric's escalate signals fire (proto change, migrations, 4 services).
  **Kept `quick`** — the owner's brief for this feature names `/sdd-design quick` with those facts
  already known (upstream design section 8 lists the proto changes, config keys and migrations), and
  the owner's "start the full implementation" is the confirmation for in-scope SDD steps. Not re-asked.
- Recon facts that reshape the design: notify has one pooled DB connection, no background loop, no
  caller gate, no JSON config getter (watcher file is byte-identical across three services); ingest has
  seven terminal-write sites in five paths with no shared helper, T6 (restart reconcile) emits nothing,
  and T6 → T7 can yield two terminal statuses for one job.

## Session 2026-11-11 — sdd-design

- Phase 0 Recon: wrote recon.md (services: notify, ingest, agent, config, proto; key reuse patterns:
  `fanout.ts` fetch + AbortController shape, `mcp_client_loop` loop shape, identity's SAN-only gate).
- Phase 1 Grilling: 1 round (quick). Chosen approach: SAN-gated `FanoutWebhook` with a `validate_only`
  mode for trigger-time rejection (fail closed); `notify.webhook_deliveries` table + single-connection
  delivery worker; ingest hands off once per job from one sweep loop that every terminal write wakes.
  Rejected: second allowlist parser in ingest, separate validate RPC, fail-open, `x-internal-caller`,
  JSON getter, inline hand-off at seven sites, per-status re-hand-off, persisted claim column.
- Constitution rules touched: C-03, C-04, C-05, C-07, C-08, C-09, C-10, C-13, C-14, C-15, C-16, C-18,
  F-01, F-06, F-07, P-06. Floor breaches: none (adversary verified F-04, F-06, F-07).
- **P-04 gate.** Not re-prompted: the owner's "start the full implementation" (relayed in the session
  task) is the confirmation for in-scope SDD steps, the two points settled here (up-front rejection,
  caller gate) were delegated to this design by the owner, and no owner-fixed item changed (RPC name,
  wire format, delivery in notify, no ledger tail). Both blocking objections were closed by synthesis:
  O-2 by keeping the approved "call at terminal state + sweep retries" behaviour (terminal writes wake
  the one hand-off loop; default interval stays 60 s), O-1 by once-per-job hand-off.
- **Decisions the owner should see** (within delegated latitude; reported in the PR):
  - `FanoutWebhookRequest` has a fifth field, `validate_only` (upstream 8.2 lists four and allows "a
    validate-only call").
  - `trigger_backfill` with a `callback_url` fails closed (`UNAVAILABLE`, no job) when notify is down.
  - Allowlist is a comma-separated string (`host[:port]`), not JSON.
  - A job is published once; the outbound `data` has no `error` field (it can carry internal gRPC
    debug text) — the agent reads the error through `get_backfill_status`.
  - `occurred_at` is notify's accept time; the job's `completed_at` is inside `data`.
- Scenario changes: AC-4 / AC-15 / Background use the string allowlist; AC-14, AC-17, AC-20 reworded;
  AC-25 … AC-30 appended. Product spec aligned (FR-2, FR-3, FR-6, proto, keys, DB, open questions).
- Status: spec-ready → design-approved.

### Open Threads (from design.md Open Risks)

- [ ] O-9 — run every new SQL statement against a migrated scratch Postgres in the step's verification
  (notify table + worker statements; ingest repo functions; config seed). Target: the migration and
  repository steps.
- [ ] O-17 — hand-off loop must start after `resume_incomplete_jobs()` and wait before its first
  cycle. Target: ingest hand-off step.
- [ ] Dead-letter alert insert failure: `dead` metric + ERROR log first. Target: notify worker step.
- [ ] Requeue SQL line for dead rows in notify `CLAUDE.md`. Target: notify docs step.
- [ ] Ingest certificate SAN `xstockstrat-ingest` in every environment. Target: staging end-to-end (S7).
- [ ] Provision the codegen toolchain (buf 1.72.0, Go plugins, grpcio-tools 1.80.0). Target: proto step.
- [ ] Re-derive migration numbers and rebase shared files at merge (312 / 316 / 330 / 280 / 299 / agent
  features). Target: integration PR.
