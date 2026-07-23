<!-- ⚠ AI-GENERATED TRIAGE — UNVERIFIED. Produced by constitution-forge (https://github.com/davcs86/agent-plugins) from static code + git-history analysis. These are CANDIDATE defects, doc-gaps, and security-boundary concerns flagged by automated analysis — NOT confirmed by a human or by running the code; some are explicitly open questions. Do not treat as authoritative: verify each (path:line/commit cited) before acting. Refresh by re-running /constitution. -->
# xstockstrat-ui — Constitution Findings

Module-specific defects (repo-wide ones live in the root findings). `⚠` = security boundary; most-severe first.

## ⚠ Security-boundary defects
- ⚠ `config-ui/api/audit` comment says "Admin-only" but checks only an authenticated session → any user reads all config-change history (sole non-gRPC path, `pg.Pool`). `config-ui/api/audit/route.ts:11,22`. Action: add `hasAdminScope` or confirm single-tenant + fix the comment.

## Latent bugs
- admin Backfills unreachable on mobile (runtime-appended to subnav; mobile renders static `PLATFORM_SUBNAV`). `PlatformHeader.tsx:204`.
- segment health routes sit behind the auth redirect (matcher whitelists only non-existent root `api/health`). scar `778ddb2`(#635).
