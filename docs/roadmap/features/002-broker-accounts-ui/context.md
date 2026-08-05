# Context: broker-accounts-ui  (archived 2026-08-05)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-05 — /sdd-archiver

**What**: Shipped the UI half of `add-ikbr-account-support` — account selector in trader's global header, an account management panel (add/remove broker accounts with credentials), and a per-account portfolio selector in insights with URL-persisted state. Pure frontend; zero proto/DB/config changes.
**Why (irrecoverable rationale)**: Account Management Panel (FR-9–12) was originally scoped out, then explicitly reversed into scope during OQ resolution: "Personal-use context makes the security tradeoff acceptable" (context.md:17) — credential-handling UI over plain HTTP was accepted only because this is a personal-use platform. SSL/TLS deliberately kept out of scope as a deployment concern (context.md:18, product-spec.md:54).
**Rejected alternatives**:
- Per-page account fetch/prop-drilling — lost to a single global-header selector + React context, avoiding fetch duplication (context.md:15).
- Server-side portfolio aggregation across accounts — lost to client-side summation; explicitly out of scope (product-spec.md:50).
**Scars & gotchas**:
- Radix `<SelectItem value="">` throws at runtime — fixed with an `__all__` sentinel mapped to `""` at the Select boundary (context.md:154, implementation-spec.md deviation log L908-911).
- ESLint `no-unused-vars` (no `argsIgnorePattern`) rejects `_req`; only single `_` accepted (context.md:68, deviation log L893-896).
- Sandbox couldn't download Playwright browser 1217 (403 from `cdn.playwright.dev`); worked around via symlinking installed 1194 headless-shell to the 1217 path plus an inert `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` escape hatch (context.md:138-144, 154).
- `connectTransport.ts` in insights had a pre-existing broken export discovered only mid-Step-7; fixed inline (context.md:112).
- Next.js 14 requires `<Suspense>` around any `useSearchParams()` user or static generation fails (context.md:112).
- Generalizable pattern: adding `AccountSelector` (a second `<Select>`) to the shared trader header broke Playwright strict-mode locators in an unrelated, pre-existing spec file (`order-form.spec.ts`) — 3 combobox tests needed `.last()` + `exact: true`, plus the BUY/SELL button test needed `exact: true` (context.md:141, restated implementation-spec.md L906). The causal lesson — a new global-header Select/combobox is not neutral for existing E2E specs elsewhere on the same page, and strict-mode locator breakage should be anticipated whenever shared-layout UI gains a new interactive element — is only recoverable from this prose; the shipped `.last()`/`exact: true` calls show the fix but not why to expect it next time.
**Permanent deviations**: - design implied `PortfolioPanel` would forward `trading_mode` -> shipped with it omitted entirely -> because `ListPortfoliosRequest` proto has no such field (proto L109); forwarding would be a no-op (context.md:101, deviation log L888-891).
**Cross-feature signal**: - Triggered a permanent process change: `.claude/skills/sdd-execute/SKILL.md`'s gap-resolution rule now requires explicit user A/B/C reply before proceeding — auto-selecting an option no longer permitted (context.md:143).
**Deferred follow-ons**: Server-side cross-account portfolio aggregation, candidate for a later feature if account counts grow (product-spec.md:50).
**Ledger entries written**: insights.md (3), fails.md (1) — see the 2026-08-05 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none
**Pruned artifacts**: product-spec.md, implementation-spec.md — last present at 33ff5dc.
