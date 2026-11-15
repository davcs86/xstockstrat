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
