# Defect: WEBPUSH_HTTP_TIMEOUT_MS is consumed as the Web Push message TTL, not an HTTP timeout

**Recorded**: 2026-09-03
**Severity**: SEV-3
**Impact type**: notifications-silently-dropped
**Environment**: production
**Affected service(s)**: xstockstrat-notify
**Config-only fix possible**: no

## Observed

`WEBPUSH_HTTP_TIMEOUT_MS` is named and commented as an outbound HTTP request timeout, but it is passed
straight into the Web Push `TTL` option (divided by 1000), giving a **10-second message TTL**. Two
consequences: (a) no real HTTP/send timeout is enforced on push delivery despite the name/comment
implying push endpoints are "slower than Slack"; (b) any device offline for more than ~10 seconds
never receives the notification, because the push service expires it.

## Expected

A deliberate, separately-chosen push message TTL appropriate for OS-level alerts (typically minutes to
hours, so a briefly-offline device still receives the alert on reconnect), AND — if a send timeout is
intended — a real per-request timeout distinct from the TTL.

## Reproduction

1. Register a Web Push subscription for a user, then put the device offline (or close the browser).
2. Emit an alert at or above `notify.push.min_severity` targeted at that user.
3. Bring the device back online after >10 seconds — the push never arrives (TTL expired).

## Evidence

`services/xstockstrat-notify/src/fanout/webPush.ts:25`
> `WEBPUSH_HTTP_TIMEOUT_MS = 10000`  (named/commented as an HTTP timeout)

`services/xstockstrat-notify/src/fanout/webPush.ts:139`
> `webpush.sendNotification(..., { TTL: WEBPUSH_HTTP_TIMEOUT_MS / 1000 })`  → TTL = 10 seconds

## Root cause hypothesis

A single constant is doing double duty: it is named for an HTTP timeout but wired as the push TTL.
Separate the two concerns — pick a deliberate TTL value (needs a maintainer decision on the intended
window) and, if a send timeout is wanted, enforce it independently. Add a test asserting the TTL sent
to `sendNotification`.

## Confidence

high
