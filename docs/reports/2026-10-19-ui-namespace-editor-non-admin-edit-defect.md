# Defect: Config-UI namespace editor shows Edit/Save to non-admins

**Recorded**: 2026-10-19
**Severity**: SEV-3
**Impact type**: misleading-ui-affordance
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: xstockstrat-ui
**Config-only fix possible**: no
**Source**: `services/xstockstrat-ui/docs/context-constitution-findings.md` § Latent bugs, "Non-admin users still see a functional config-ui Edit/Save affordance"

## Observed
`SetConfig` is admin-gated at the BFF (`requireAdminScope`), but `NamespaceEditor` renders the
per-row Edit action for every user; it never consults `useIsAdmin()`. A viewer/trader can open the
editor, type a value and a reason, and only learns on submit via a raw
"Save error: Admin scope required". Not an authorization hole — the BFF and config backend refuse.
Sibling pages in the same segment (`config-ui/sources`, `config-ui/templates`) already gate on
`useIsAdmin` with an "Admin only" notice.

## Expected
Non-admins see no Edit affordance (or an "Admin only" notice), matching the sibling pages.

## Reproduction
1. Log in as a non-admin (viewer) user.
2. Open `/config-ui/<namespace>`, open a row's Actions menu, choose Edit.
3. Enter a value + reason, Save — observe "Save error: Admin scope required".

## Evidence
`services/xstockstrat-ui/src/app/config-ui/[namespace]/NamespaceEditor.tsx:165`
> `            <DropdownMenuItem onClick={() => startEdit(k)}>Edit</DropdownMenuItem>`

`services/xstockstrat-ui/src/app/config-ui/[namespace]/NamespaceEditor.tsx:358`
> `          <p className="text-destructive text-sm">Save error: {errMessage(saveError)}</p>`

`services/xstockstrat-ui/src/lib/configUiBff.ts:38`
> `    requireAdminScope(claims);`

`services/xstockstrat-ui/src/app/config-ui/sources/page.tsx:51` (sibling that does gate)
> `  const { data: isAdmin, isLoading: adminLoading } = useIsAdmin();`

## Root cause hypothesis
Feature 074 added the server-side admin gate without a matching UI gate; the shadcn migration
(features 119/120) moved the logic into `NamespaceEditor.tsx` unchanged. `useIsAdmin` is never imported there.

## Confidence
high
