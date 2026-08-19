# Context: notify-external-fanout

**Feature**: `docs/roadmap/features/020-notify-external-fanout/feature.md`
**Product Spec**: `docs/roadmap/features/020-notify-external-fanout/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/020-notify-external-fanout/implementation-spec.md`

---

## Session 2026-05-26T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Feature number assigned: 020.
- No proto changes required; config-only + notify service HTTP client additions.
- Dedup window and secret key storage noted as open questions for /sdd-spec phase.

## Session 2026-08-19 — sdd-review product-spec (+ owner-approved scope reduction)

- Review verdict was FAIL (3 blockers). Status: draft → spec-ready after fixes.
- **Scope reduction — explicitly surfaced to and approved by the feature owner (2026-08-19), per the
  CLAUDE.md "don't reduce scope without letting me know" rule:**
  - Blocker C-05: the spec stored the SendGrid API key and Slack webhook URL as config keys (one even
    used the retired `secret.*` prefix). Config governance forbids a vendor credential as a config key
    (the `secret.*`/`is_secret` mechanism was reversed by feature 076 — migration
    `009_drop_fmp_api_key_config`); credentials are `type: SECRET` env vars wired through deploy.
  - The only compliant fix moves both credentials to env vars (`SENDGRID_API_KEY`, `SLACK_WEBHOOK_URL`),
    which removes the "runtime credential rotation, no redeploy" capability FR-4/AC-1–3 promised.
  - Owner decision (AskUserQuestion): **Accept the scope reduction.** Credential rotation now requires
    a redeploy; only the two credentials moved — all non-credential knobs (threshold, dedup window,
    from/to email, per-channel enable-via-credential-presence) remain runtime config-driven.
  - Spec edits: rewrote FR-4; moved the two credentials out of Config Key Changes into a new Env Var
    Changes section (`type: SECRET`, wired per add-data-source.md); reworded AC-1–3; kept "No schema
    changes" valid via the in-memory dedup resolution.
- Other blockers fixed (scope-preserving):
  - C-14: added the `## Consumer Surface(s)` section (UI = none; the `notify.fanout.*` non-credential
    keys surface via the existing `/config-ui` segment; fanout targets are external Slack/SendGrid).
  - P-03 open questions: both resolved — credential storage → env var (above); dedup store → in-memory
    map for V1 (low alert volume), keeping the no-migration claim intact.
- Overlap: CLEAN (no duplicate config key / proto field / migration NNN). Soft/rebase-only overlap on
  `xstockstrat-notify`'s `emitAlert` with already-`code-completed` feature 094 (input-validation guard
  at the top of the same method) — semantically disjoint from the post-emit fanout side-channel; 020
  simply rebases onto 094's landed guard. No merge-order row required.
