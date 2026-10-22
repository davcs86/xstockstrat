# Defect: ManageTemplate UPDATE silently drops name/description for formula and strategy templates, and the three template repositories disagree on RETIRE and CREATE

**Recorded**: 2026-10-21
**Severity**: SEV-2
**Impact type**: template-update-silently-ignored
**Environment**: dev (main-dev) @ a053b0e
**Affected service(s)**: xstockstrat-indicators, xstockstrat-analysis, xstockstrat-ingest
**Config-only fix possible**: no
**Source**: repo-surveyor debt-radar scan (`docs/repo-surveyor/debt-radar-findings.md` @ 4535695), finding D-41. Re-verified against main-dev @ a053b0e.

## Observed

### D-41 — `ManageTemplate` UPDATE drops `name`/`description` (indicators + analysis)

`ManageTemplate` accepts a full `TemplateMeta` (id, kind, name, description) plus a payload. On
`TEMPLATE_OPERATION_UPDATE`, indicators and analysis pass only the template id and payload to their
repository `update`, whose SQL sets `payload`, `version = version + 1` and `updated_at`. `name` and
`description` are never written. The RPC returns the row, so an admin rename from the config-ui
templates page (`/config-ui/templates`) "succeeds" and bumps `version`, which shows "update available"
to every instance holder, yet the name and description do not change. Ingest's source-template
repository does write `name` and `description` on update, so the same admin action behaves differently
per kind.

### D-41 (divergence) — RETIRE semantics differ

Indicators and analysis keep the first retirement timestamp (`retired_at = COALESCE(retired_at, NOW())`);
ingest overwrites it (`retired_at = NOW()`) on every RETIRE call. Indicators' retire also does not
touch `updated_at`, while analysis and ingest set it.

### D-41 (divergence) — CREATE with an empty `template_id` differs

Ingest mints a uuid when `meta.template_id` is empty; indicators and analysis reject the request with
`INVALID_ARGUMENT`.

## Expected

A single, documented contract for the three template repositories:

- UPDATE writes `name` and `description` from `TemplateMeta` (or the RPC rejects a metadata change
  explicitly, if design decides metadata is immutable) — never a silent drop with a version bump.
- RETIRE has one semantics for `retired_at` (first-wins or last-wins) and for `updated_at`, the same in
  all three services.
- CREATE with an empty `template_id` behaves the same in all three services (mint or reject).

## Reproduction

1. As an admin, `ManageTemplate(operation=CREATE, template={meta: {template_id: "t-1", kind: FORMULA,
   name: "Old", description: "d1"}, payload: <valid>})` against indicators.
2. `ManageTemplate(operation=UPDATE, template={meta: {template_id: "t-1", name: "New", description:
   "d2"}, payload: <same>})`. The response and `ListTemplates` show `name: "Old"`, `description: "d1"`,
   `version: 2`.
3. Repeat with analysis (`kind: STRATEGY`): same result. Repeat with ingest (`kind: SIGNAL_SOURCE`): `name`
   becomes `"New"`.
4. RETIRE `t-1` twice in each service: indicators/analysis keep the first `retired_at`; ingest's moves.
5. CREATE with `template_id: ""`: ingest succeeds with a uuid id; indicators and analysis return
   `INVALID_ARGUMENT`.

## Evidence

### D-41 — UPDATE drops name/description

`services/xstockstrat-indicators/app/handlers/servicer.py:652` (scan cited `:644-645`)
> row = await self._templates_repo.update(meta.template_id, payload)

`services/xstockstrat-indicators/app/services/formula_templates_repository.py:50-62`
> UPDATE indicators.formula_templates
>    SET payload = $2::jsonb, version = version + 1, updated_at = NOW()
>  WHERE template_id = $1 AND retired_at IS NULL

`services/xstockstrat-analysis/app/handlers/servicer.py:3581` →
`services/xstockstrat-analysis/app/repositories/strategy_templates.py:54-66`
> SET payload = $2::jsonb, version = version + 1, updated_at = NOW()

`services/xstockstrat-ingest/app/handlers/servicer.py:1533-1535` →
`services/xstockstrat-ingest/app/repositories/source_templates.py:50-65`
> " SET name = $2, description = $3, payload = $4,"

UI sends the metadata on UPDATE: `services/xstockstrat-ui/src/app/config-ui/templates/page.tsx:153-158`
(`meta = { templateId, kind, name: form.name, description: form.description }`) and `:382`
(`editing.existing ? TemplateOperation.UPDATE : TemplateOperation.CREATE`).

### D-41 (divergence) — RETIRE

`services/xstockstrat-indicators/app/services/formula_templates_repository.py:64-75`
> SET retired_at = COALESCE(retired_at, NOW())

`services/xstockstrat-analysis/app/repositories/strategy_templates.py:68-75`
> SET retired_at = COALESCE(retired_at, NOW()), updated_at = NOW()

`services/xstockstrat-ingest/app/repositories/source_templates.py:67-75`
> " SET retired_at = NOW(), updated_at = NOW()"

### D-41 (divergence) — CREATE with empty id

`services/xstockstrat-ingest/app/handlers/servicer.py:1540`
> template_id=meta.template_id or str(uuid.uuid4()),

`services/xstockstrat-indicators/app/handlers/servicer.py:633-635` (scan cited `:627`)
> if not meta.template_id:
>     await context.abort(grpc.StatusCode.INVALID_ARGUMENT, "template_id required")

`services/xstockstrat-analysis/app/handlers/servicer.py:3544-3552`: also rejects an empty `template_id`.

The `name` and `description` columns already exist in all three tables (each `create` writes them),
so no schema change is implied.

## Root cause hypothesis

The three template repositories were written per service with no shared contract (the debt-radar D-20
duplication family). Indicators and analysis modelled UPDATE as a payload-only version bump; ingest
modelled it as a full replace. Nothing in the proto or a shared test pins which is intended.

## Confidence

high
