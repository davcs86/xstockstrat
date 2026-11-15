# Product Spec: fix-commsgun-email-channel

**Type**: bug
**GitHub Issue**: none (Issues disabled) — report: `services/xstockstrat-notify/docs/context-constitution-findings.md`
**Severity**: SEV-3
**Created**: 2026-11-15

---

## Problem Statement

Feature 338 (commsgun email provider, on `main-dev` only) shipped with these defects:

1. **`commsgun.enqueue_url` is not checked for `https:`.** It is documented as a "Full HTTPS URL" but only
   trimmed (`src/fanout/emailProvider.ts#commsgunSettings`). `src/fanout/commsgunClient.ts#send` POSTs the
   bearer app key to any scheme, so a mis-set `http://` URL sends the key in clear text.
   *Expected:* a URL whose scheme is not `https:` counts as an unset URL: the base is not configured
   (`unconfigured` in pinned mode, SendGrid in `auto`), and no request is made. This matches the webhook URL rule.
2. **Subjects are not sanitised.** `src/fanout/emailRender.ts#renderEmail` builds `[severity] title` with no
   CR/LF stripping and no length cap. commsgun rejects a subject over 998 characters, or one containing
   CR/LF, with a permanent 422 `invalid_subject`.
   *Expected:* the shared renderer replaces CR/LF with a space and caps the subject at 998, so SendGrid and
   commsgun get the same subject. Rows already queued keep their stored subject (NOTIFY-17).
3. **No standing incident in pinned mode.** With `fanout.email_provider = commsgun`, the base set and the
   app key absent (or unreadable twice in a row), no standing incident is raised. The incident fires only
   in `auto` (`src/fanout/commsgunWorker.ts#standingIncidents`). Owner (2026-11-15): this is a bug.
   *Expected:* the standing "app key not available" incident fires in pinned `commsgun` mode too.
4. **408 is permanent.** `src/fanout/commsgunClient.ts#classifyStatus` ends a row on 408, but webhooks retry it
   (`webhookWorker.ts#RETRYABLE_STATUSES`), and Caddy in front of commsgun can send 408.
   Owner (2026-11-15): retry it.
   *Expected:* 408 is retried, and `docs/email-providers.md` lists it with the retry classes.
5. **Doc-lies in `services/xstockstrat-notify/CLAUDE.md`.** Three places say email needs SendGrid, but
   commsgun email needs neither the key nor the SendGrid addresses: the feature-020 line, the
   `fanout.sendgrid_{from,to}_email` rows, and the `SENDGRID_API_KEY=` comment.
   *Expected:* each says "SendGrid email …".

6. **Email text is uncapped** (found in review against commsgun `4e3e58d`). commsgun refuses a request over
   256 KiB (`MaxBodyBytes`) with a permanent 413.
   *Expected:* the shared renderer cuts the text, counted as JSON-escaped bytes, so the whole commsgun request
   fits, and marks the cut with a `[truncated]` line.

Defect 1 widened in review: the enqueue URL must pass the whole webhook URL rule except its allowlist (no
userinfo, no control characters, no trailing-dot host, at most 2048 characters), not only the `https:` check.

## Reproduction Steps

1. Set `notify.commsgun.enqueue_url=http://comms.example/enqueue` (plus app id and recipient) → the worker POSTs `Authorization: Bearer <key>` over http.
2. Emit a qualifying alert whose title contains `\n`, or is longer than 998 characters → the commsgun row ends `undelivered` with error class `422`.
3. Set `fanout.email_provider=commsgun`, set the base, leave `commsgun.app_key` unset → no standing alert. Rows retry as `no_app_key` until they run out of attempts.
4. commsgun's edge answers 408 → the row ends `undelivered` at once.

## Root Cause Hypothesis

Confirmed by reading the code (see the findings rows): each defect sits at the single symbol named above.

## Affected Services

xstockstrat-notify only.

## Fix Scope

- [x] No proto changes anticipated
- [x] No database migrations anticipated
- [x] No config key changes anticipated (seeded description of `commsgun.enqueue_url` already says "HTTPS")

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
- A per-request scheme check in `CommsgunClient#send` (a second guard of the same rule; `commsgunSettings` is read on every attempt)
