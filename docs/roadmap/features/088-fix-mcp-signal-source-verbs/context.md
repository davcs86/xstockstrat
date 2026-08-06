# Context: fix-mcp-signal-source-verbs  (archived 2026-08-06)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-06 — /sdd-archiver

**What**: `manage_signal_source`'s register/update/deactivate blind full-replace upsert was split into honest AIP-161 verbs (strict register, masked update, decoupled reactivate) mirroring feature-070 `ManageStrategy`, and — after the design debate itself found a live instance of the bug — the config-ui sources page was pulled into scope because it was *also* a maskless update caller silently NULLing `credentials_ref` on a display-name edit (context.md session 2026-08-02 sdd-design).
**Why (irrecoverable rationale)**: The scope pull beyond product-spec's stated Affected Services (ingest/agent/analysis) was a direct application of the user's prior "fix every caller, don't defer" precedent from feature 086, not a spec requirement — recorded only in context.md (line 29) and design.md's Open Risks (§ "Scope expanded"), not derivable from the shipped diff.
**Rejected alternatives**:
- Keep `operation` as string, waive C-04 — lost: a Commandment waiver needs explicit user sign-off; the additive enum paid the debt for free (design.md:84-85).
- `credentials_ref` presence-by-non-empty-string — lost: can set but never clear, re-introducing the exact omit-vs-clear ambiguity that *is* the bug (design.md:86-87).
- `active` maskable-but-preserved-when-omitted — lost: still lets a caller list `active` in the mask and re-couple reactivation into update (design.md:88-89).
- Internal `register_if_absent` RPC for the analysis producer — lost: adds proto surface for one caller vs. coded ALREADY_EXISTS tolerance (design.md:90-91).
- Slug format validation — deferred as scope-creep; also risked rejecting an already-registered operator slug with a guessed regex ("ledger 080 absence-claim trap", design.md:92-93).
**Scars & gotchas**:
- Making register strict breaks internal idempotent "ensure-registered" callers: the analysis producer's `_ensure_source_registered` needed its `except` narrowed to tolerate `ALREADY_EXISTS` specifically (not blanket-swallow) or it would re-attempt/warn every cycle (recon.md:68-72, design.md §4). Generalizable trap for any future blind-upsert→strict-register conversion.
- No dedicated execute-phase context.md session was written beyond the CI promotion line — deviation/build notes for steps 1-11 live only in PR #844, not in context.md.
**Permanent deviations**: none — implementation-spec.md marks all 11 steps `done` matching design.md's chosen approach; no divergence recorded in context.md.
**Cross-feature signal**: This is the second occurrence (after feature-070) of "blind full-replace upsert masquerading as safe verbs" — the RC-2 finding notes the 070 partial-merge fix "never propagated" to this RPC (recon.md:75-76). Same-shaped mutation RPCs elsewhere in the platform likely carry the same latent bug until audited.
**Deferred follow-ons**:
- Slug format validation (explicitly deferred, not in AC).
- Broader credential-storage redesign — routed to feature 093 (`ResolveSourceCredential` RPC), which also needed field-number coordination against this feature's proto additions (design.md:101-102).
**Ledger entries written**: insights.md (3), fails.md (0) — see the 2026-08-06 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none
**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at f871138.
