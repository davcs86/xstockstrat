# Feature: config-ui-weight-validation

**Lifecycle Status**: `idea`
**Development Branch**: `feature/config-ui-weight-validation`
**Created**: 2026-05-23
**Last Updated**: 2026-05-23

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-23 | `idea` | backlog | Captured during 007-signal-source-weighting review |

---

## Summary

Add client-side validation to `xstockstrat-config-ui` so that when an operator edits a key whose value is a JSON weight map (e.g. `analysis.signals.source_weights`), the UI rejects values outside `[0.0, 1.0]` before calling `SetConfig`. Currently the generic inline editor accepts any string; bounds are only enforced server-side in the consuming service.

## Origin

Deferred from feature `007-signal-source-weighting` (Out of Scope). The analysis service clamps out-of-range weights at read time (FR-5), so this is a UX improvement, not a correctness fix.

## Notes

- Option A (simple): detect the key name in `[namespace]/page.tsx` and validate JSON values client-side — no backend changes.
- Option B (principled): add a `validation` field to the `ConfigKey` proto/response so the config service can declare allowed value formats per key; UI validates generically — requires proto + config service changes.
- Option A is sufficient unless multiple keys need format-specific validation.

## Next Action

`/sdd-story config-ui-weight-validation` — write a full product spec when this is prioritized.
