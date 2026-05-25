# Context: unified-login-page

**Feature**: `docs/roadmap/features/019-unified-login-page/feature.md`
**Product Spec**: `docs/roadmap/features/019-unified-login-page/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/019-unified-login-page/implementation-spec.md`

---

## Session 2026-05-25 — idea capture

- Feature directory created as follow-up to 018-agent-mcp-oauth.
- During 018 product spec review, operator noted that having 4 login pages (3 Next.js frontends + identity /login from 018) is maintenance debt and asked about a unified login page.
- Decision: scope minimal identity form into 018 only; consolidation deferred here.
- Preliminary product spec written at idea stage — not yet reviewed. Captures the problem, preliminary FRs, and the key architectural decision (Option A cookie exchange vs Option B shared JWT) that must be resolved before /sdd-story formalizes it.
- Dependency documented: this feature must follow 018 being launched.
