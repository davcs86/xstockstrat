# Context Log: fix-commsgun-email-channel

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-15 (/sdd-triage)

- Bug reported via the notify findings log (Issues disabled; clustered triage): the six rows marked "found 2026-11-15" in `services/xstockstrat-notify/docs/context-constitution-findings.md` (merged in #1543 @ `d1c9727`), grouped as five defects.
- Severity: SEV-3. Per `docs/runbooks/bug-triage.md` severity definitions the defects are non-financial. The ⚠ https row is a credential-exposure risk on misconfiguration only. Feature 338 is not on `main` (`git show origin/main:…/commsgunClient.ts` fails), so this is a dev-only bug → Track C.
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..AC-4), context.md. No `docs/reports/` sidecar exists for a findings-log source.
- Affected services: xstockstrat-notify
- Root cause: confirmed at the cited symbols (product-spec § Problem Statement)
- Owner decisions carried from the task (2026-11-15): pinned-mode missing key is a bug (raise the incident); 408 must retry.
- https vs tailnet: the enqueue host is always served over TLS. The edge serves `*.<magicdns_base_domain>` with the ACME wildcard certificate, and the policy grants only tcp:443 (feature 338 `recon.md` § Tailnet path; `operations.md` first-deploy check). So requiring `https:` cannot break a valid deployment, and no question to the owner is needed.
- Recommended design depth: skip → `/sdd-spec fix-commsgun-email-channel` (rationale: SEV-3, single service, no proto/migration/config change, clear root cause)
- Development branch: feature/fix-commsgun-email-channel

## Session 2026-11-15 (fix — TDD, single integration PR)

- Deviation (recorded): `/sdd-review` → `/sdd-spec` → `/sdd-execute` were collapsed into one TDD pass with one commit series and one PR to `main-dev`. The task asked for exactly that, and the design depth is `skip` (five single-symbol fixes in one service). No `implementation-spec.md`.
- RED on `d1c9727` + triage: 6 new cases failed (AC-1 ×2, AC-2, AC-3 ×2, AC-4), 393 passed. GREEN: 399/399; `test:coverage` 90.62 % lines; lint 0 errors (369 warnings, unchanged); `node scripts/check-config-wiring.mjs` exit 0.
- Decisions:
  - https rule lives once in `emailProvider.ts#commsgunSettings` (read on every dispatch and every attempt). A URL that is not `https:` reads as `''`, so it routes like an unset URL: `unconfigured` pinned / SendGrid in `auto` / `no_endpoint` retry. No second check in `CommsgunClient#send` (product-spec § Out of Scope).
  - Subject cap is 998 **UTF-8 bytes** on a code-point boundary. The producer's `SubjectMaxLen` could not be read from this session (scope limited to this repo), and bytes ≤ 998 also implies runes ≤ 998. CR/LF runs become one space; the body text is not touched.
  - Pinned-mode stalled-key incident reuses the `auto` trigger (absent, or two consecutive resolve failures) and title; the body says the rows stay queued instead of "goes through SendGrid".
  - 408 retries with error class `408` (outcome `http_error`), the same as the webhook worker.
  - Existing @AC-25 (pinned, absent key) now expects 2 alerts: the row's own alert plus the new standing incident.
- Prettier `--check` fails on the touched files at `main-dev` already and is not a CI job; not reformatted (surgical diff).
- Constitution: NOTIFY-17 retry set widened to 408, and the `invalid_subject` rule added. `email-providers.md` and `CLAUDE.md` updated. Findings rows moved to `## Resolved`.

## Session 2026-11-15 (follow-up — producer contract read)

- Read `davcs86/commsgun` @ `5c0c129` (public; anonymous clone). `api/internal/enqueue/validate.go#emailContent` rejects a subject that is empty, contains CR or LF (`ContainsAny(subject, "\r\n")`), or has `utf8.RuneCountInString(subject) > constants.SubjectMaxLen` (998).
- Supersedes the prior session's byte-cap decision: the cap is now **998 code points** (JS `for…of` / spread iterates the same code points Go counts as runes), so non-ASCII titles are no longer over-truncated. RED → GREEN on the updated @AC-2 test. An empty subject cannot occur, because the subject always starts with `[severity] `.

## Session 2026-11-15 (review against commsgun `4e3e58d` and webhooks-mcp `c04b851`)

- Review found no conflict with either producer. commsgun's enqueue code changed only by refactors since `5c0c129`. webhooks-mcp C3 (retry 503; 404/413/422 final) is covered by notify's webhook classification.
- Owner: "fix all, even the https check". Fixed in this PR, each test-first (6 new cases RED, then 406/406 GREEN):
  - The pinned-mode alert now explains the https rule only when `commsgun.enqueue_url` is the missing key.
  - The https check is widened to the whole webhook URL rule minus its allowlist. `checkHttpsUrl` is extracted from `webhookUrlRule.ts#checkCallbackUrl` (no duplicate rule); the existing webhook URL-rule tests are unchanged and green. NOTIFY-14 now names the shared helper.
  - Email text is capped. The text gets 256 KiB − 8 KiB of JSON-escaped bytes plus a `[truncated]` line. The 8 KiB reserve covers a 998-code-point subject at ≤ 6 escaped bytes (5988), a ≤ 254-character recipient at ≤ 6 (1524) and the keys (~60). The cut is in the shared renderer, so SendGrid gets the same text. NOTIFY-17 now names the 413 rule.
  - Findings citation re-stamped to commsgun `4e3e58d`.

## Session 2026-11-15 (CI: feature status automation)

- Promotion PR #1546 merged to main
- Feature promoted and committed: 6936191e738e267c5507f042b22bc3e785fe9419
- Status updated: `code-completed` → `launched`
- Launched date: 2026-11-15
