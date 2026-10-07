'use client';

import { useMemo, useState, type ChangeEvent } from 'react';
import { ConnectError } from '@connectrpc/connect';
import {
  clone,
  create,
  fromJson,
  toJson,
  type DescMessage,
  type JsonObject,
  type JsonValue,
  type MessageShape,
} from '@bufbuild/protobuf';
import type { ColumnDef } from '@tanstack/react-table';
import { TemplateKind, TemplateOperation } from '@xstockstrat/proto/common/v1/common_pb';
import {
  StrategyComponentSchema,
  StrategyDefinitionSchema,
} from '@xstockstrat/proto/analysis/v1/analysis_pb';
import { RegisterFormulaRequestSchema } from '@xstockstrat/proto/indicators/v1/indicators_pb';
import { SignalSourceSchema } from '@xstockstrat/proto/ingest/v1/ingest_pb';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { DataTable } from '@/components/ui/data-table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { FormDialog } from '@/components/shared/FormDialog';
import { CardNotice } from '@/components/shared/CardNotice';
import { QueryStateMessages } from '@/components/shared/QueryStateMessages';
import { EmptyState } from '@/components/shared/EmptyState';
import { RowActionsMenu } from '@/components/shared/RowActionsMenu';
import { useIsAdmin } from '@/hooks/useLiveStrategies';
import {
  CATALOG_KINDS,
  TEMPLATE_KIND_LABEL,
  useManageTemplate,
  useTemplates,
  type CatalogKind,
  type CatalogTemplate,
  type ManageTemplateInput,
} from '@/hooks/useTemplates';

interface FieldDef {
  key: string;
  label: string;
  multiline?: boolean;
  placeholder?: string;
}

type FormState = Record<string, string>;

const META_FIELDS: FieldDef[] = [
  { key: 'templateId', label: 'Template ID', placeholder: 'e.g. tpl-zscore' },
  { key: 'name', label: 'Name' },
  { key: 'description', label: 'Description' },
];

// The payload is edited as structured fields per kind; fields not shown here are preserved on edit.
const PAYLOAD_FIELDS: Record<CatalogKind, FieldDef[]> = {
  [TemplateKind.FORMULA]: [
    { key: 'source', label: 'Formula source', multiline: true },
    { key: 'warmupPeriod', label: 'Warm-up period (bars)', placeholder: '0' },
  ],
  [TemplateKind.STRATEGY]: [
    { key: 'strategyId', label: 'Strategy ID', placeholder: 'e.g. mean_reversion' },
    { key: 'displayName', label: 'Display name' },
    {
      key: 'components',
      label: 'Components (JSON array; formulaId holds a formula template ID)',
      multiline: true,
      placeholder: '[{"refName": "z", "formulaId": "tpl-zscore"}]',
    },
    { key: 'entryRule', label: 'Entry rule' },
    { key: 'exitRule', label: 'Exit rule' },
  ],
  [TemplateKind.SIGNAL_SOURCE]: [
    { key: 'slug', label: 'Default slug' },
    { key: 'displayName', label: 'Display name' },
    { key: 'sourceType', label: 'Source type', placeholder: 'e.g. simple_website' },
    { key: 'extractorModule', label: 'Extractor module' },
    { key: 'reliabilityWeight', label: 'Reliability weight (0–1)', placeholder: '1' },
    { key: 'configJson', label: 'Config (JSON object)', multiline: true, placeholder: '{}' },
  ],
};

function parseJson(raw: string, field: string, fallback: JsonValue): JsonValue {
  if (raw.trim() === '') return fallback;
  try {
    return JSON.parse(raw) as JsonValue;
  } catch {
    throw new Error(`${field} is not valid JSON`);
  }
}

/** A fresh payload seeded from the edited template's (so unshown fields survive), never mutating it. */
function payloadFrom<D extends DescMessage>(
  schema: D,
  prior: MessageShape<D> | undefined,
  fields: Partial<MessageShape<D>>,
): MessageShape<D> {
  return Object.assign(prior ? clone(schema, prior) : create(schema), fields);
}

function formFromTemplate(row: CatalogTemplate): FormState {
  const meta = row.template.meta;
  const base = {
    templateId: meta?.templateId ?? '',
    name: meta?.name ?? '',
    description: meta?.description ?? '',
  };
  switch (row.kind) {
    case TemplateKind.FORMULA: {
      const p = row.template.payload;
      return { ...base, source: p?.source ?? '', warmupPeriod: String(p?.warmupPeriod ?? 0) };
    }
    case TemplateKind.STRATEGY: {
      const p = row.template.payload;
      const components = (p?.components ?? []).map((c) => toJson(StrategyComponentSchema, c));
      return {
        ...base,
        strategyId: p?.strategyId ?? '',
        displayName: p?.displayName ?? '',
        components: JSON.stringify(components, null, 2),
        entryRule: p?.entryRule ?? '',
        exitRule: p?.exitRule ?? '',
      };
    }
    case TemplateKind.SIGNAL_SOURCE: {
      const p = row.template.payload;
      return {
        ...base,
        slug: p?.slug ?? '',
        displayName: p?.displayName ?? '',
        sourceType: p?.sourceType ?? '',
        extractorModule: p?.extractorModule ?? '',
        reliabilityWeight: p?.reliabilityWeight !== undefined ? String(p.reliabilityWeight) : '',
        configJson: JSON.stringify(p?.configJson ?? {}, null, 2),
      };
    }
  }
}

/** Throws an Error with a user-facing message when a field doesn't parse. */
function buildInput(
  kind: CatalogKind,
  operation: TemplateOperation,
  form: FormState,
  existing: CatalogTemplate | null,
): ManageTemplateInput {
  const meta = {
    templateId: form.templateId.trim(),
    kind,
    name: form.name,
    description: form.description,
  };
  switch (kind) {
    case TemplateKind.FORMULA: {
      const prior = existing?.kind === kind ? existing.template.payload : undefined;
      const warmup = Number(form.warmupPeriod || '0');
      if (!Number.isInteger(warmup) || warmup < 0) {
        throw new Error('Warm-up period must be a non-negative integer');
      }
      return {
        kind,
        operation,
        template: {
          meta,
          payload: payloadFrom(RegisterFormulaRequestSchema, prior, {
            name: form.name,
            description: form.description,
            source: form.source,
            warmupPeriod: warmup,
          }),
        },
      };
    }
    case TemplateKind.STRATEGY: {
      const prior = existing?.kind === kind ? existing.template.payload : undefined;
      const raw = parseJson(form.components, 'Components', []);
      if (!Array.isArray(raw)) throw new Error('Components must be a JSON array');
      let components;
      try {
        components = raw.map((c) => fromJson(StrategyComponentSchema, c));
      } catch (e) {
        throw new Error(`Components: ${e instanceof Error ? e.message : 'invalid component'}`);
      }
      return {
        kind,
        operation,
        template: {
          meta,
          payload: payloadFrom(StrategyDefinitionSchema, prior, {
            strategyId: form.strategyId.trim(),
            displayName: form.displayName,
            components,
            entryRule: form.entryRule,
            exitRule: form.exitRule,
          }),
        },
      };
    }
    case TemplateKind.SIGNAL_SOURCE: {
      const prior = existing?.kind === kind ? existing.template.payload : undefined;
      const config = parseJson(form.configJson, 'Config', {});
      if (config === null || typeof config !== 'object' || Array.isArray(config)) {
        throw new Error('Config must be a JSON object');
      }
      const weightRaw = form.reliabilityWeight.trim();
      const weight = weightRaw === '' ? undefined : Number(weightRaw);
      if (weight !== undefined && (Number.isNaN(weight) || weight < 0 || weight > 1)) {
        throw new Error('Reliability weight must be between 0 and 1');
      }
      return {
        kind,
        operation,
        template: {
          meta,
          payload: payloadFrom(SignalSourceSchema, prior, {
            slug: form.slug.trim(),
            displayName: form.displayName,
            sourceType: form.sourceType.trim(),
            extractorModule: form.extractorModule,
            configJson: config as JsonObject,
            reliabilityWeight: weight,
          }),
        },
      };
    }
  }
}

interface Editing {
  kind: CatalogKind;
  existing: CatalogTemplate | null;
}

function emptyForm(kind: CatalogKind): FormState {
  return Object.fromEntries(
    [...META_FIELDS, ...PAYLOAD_FIELDS[kind]].map((f) => [f.key, '']),
  ) as FormState;
}

function TemplateTable({
  kind,
  onCreate,
  onEdit,
  onRetire,
}: {
  kind: CatalogKind;
  onCreate: () => void;
  onEdit: (row: CatalogTemplate) => void;
  onRetire: (row: CatalogTemplate) => void;
}) {
  const { data, isLoading, error } = useTemplates(kind, 'config-ui');
  const rows = useMemo(() => data ?? [], [data]);
  const label = TEMPLATE_KIND_LABEL[kind];

  const columns = useMemo<ColumnDef<CatalogTemplate>[]>(
    () => [
      {
        id: 'templateId',
        header: 'Template ID',
        accessorFn: (r) => r.template.meta?.templateId ?? '',
        meta: { className: 'font-mono text-xs' },
      },
      { id: 'name', header: 'Name', accessorFn: (r) => r.template.meta?.name ?? '' },
      {
        id: 'version',
        header: 'Version',
        accessorFn: (r) => r.template.meta?.version ?? 0,
        meta: { className: 'font-mono text-xs text-muted-foreground' },
        cell: ({ row }) => `v${row.original.template.meta?.version ?? 0}`,
      },
      {
        id: 'actions',
        header: '',
        meta: { className: 'text-right' },
        cell: ({ row }) => {
          const r = row.original;
          const name = r.template.meta?.name || r.template.meta?.templateId || '';
          return (
            <RowActionsMenu
              triggerLabel={`Actions for template ${name}`}
              actions={[
                { label: 'Edit', onSelect: () => onEdit(r) },
                {
                  label: 'Retire',
                  destructive: true,
                  onSelect: () => onRetire(r),
                  confirm: {
                    title: `Retire template ${name}?`,
                    description:
                      'It disappears from the catalog and can no longer be used. Copies users already made are untouched.',
                    confirmLabel: 'Retire',
                  },
                },
              ]}
            />
          );
        },
      },
    ],
    [onEdit, onRetire],
  );

  return (
    <Card>
      <CardContent className="space-y-3 pt-5">
        <div className="flex justify-end">
          <Button size="sm" onClick={onCreate}>
            New {label.toLowerCase()} template
          </Button>
        </div>
        <QueryStateMessages
          isLoading={isLoading}
          error={error}
          loadingText={`Loading ${label.toLowerCase()} templates…`}
          errorText={`${label} templates unavailable`}
        />
        {!isLoading && !error && rows.length === 0 && (
          <EmptyState
            title={`No ${label.toLowerCase()} templates`}
            description="The catalog starts empty. Create a template to offer it to every user."
          />
        )}
        {!isLoading && !error && rows.length > 0 && (
          <DataTable
            columns={columns}
            data={rows}
            getRowId={(r) => r.template.meta?.templateId ?? ''}
          />
        )}
      </CardContent>
    </Card>
  );
}

export default function TemplatesAdminPage() {
  const { data: isAdmin, isLoading: adminLoading } = useIsAdmin();
  const manage = useManageTemplate();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [form, setForm] = useState<FormState>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const errorMessage = (err: unknown) =>
    err instanceof ConnectError ? err.rawMessage : err instanceof Error ? err.message : 'Failed';

  const openCreate = (kind: CatalogKind) => {
    setEditing({ kind, existing: null });
    setForm(emptyForm(kind));
    setFormError(null);
  };
  const openEdit = (row: CatalogTemplate) => {
    setEditing({ kind: row.kind, existing: row });
    setForm(formFromTemplate(row));
    setFormError(null);
  };
  const retire = (row: CatalogTemplate) => {
    manage.mutate(
      {
        kind: row.kind,
        operation: TemplateOperation.RETIRE,
        template: { meta: { templateId: row.template.meta?.templateId ?? '', kind: row.kind } },
      } as ManageTemplateInput,
      {
        onSuccess: () => setActionError(null),
        onError: (err) => setActionError(errorMessage(err)),
      },
    );
  };

  const save = () => {
    if (!editing) return;
    let input: ManageTemplateInput;
    try {
      input = buildInput(
        editing.kind,
        editing.existing ? TemplateOperation.UPDATE : TemplateOperation.CREATE,
        form,
        editing.existing,
      );
    } catch (e) {
      setFormError(errorMessage(e));
      return;
    }
    manage.mutate(input, {
      onSuccess: () => {
        setEditing(null);
        setActionError(null);
      },
      onError: (err) => setFormError(errorMessage(err)),
    });
  };

  if (adminLoading) return <QueryStateMessages isLoading errorText="" />;
  if (!isAdmin) return <CardNotice>Admin only</CardNotice>;

  const fields = editing ? [...META_FIELDS, ...PAYLOAD_FIELDS[editing.kind]] : [];

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Templates</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Author the template catalog. Updates bump the version; retiring hides a template without
          touching copies users already made.
        </p>
      </div>

      {actionError && <CardNotice variant="error">{actionError}</CardNotice>}

      <Tabs defaultValue={String(TemplateKind.FORMULA)}>
        <TabsList>
          {CATALOG_KINDS.map((k) => (
            <TabsTrigger key={k} value={String(k)}>
              {TEMPLATE_KIND_LABEL[k]}
            </TabsTrigger>
          ))}
        </TabsList>
        {CATALOG_KINDS.map((k) => (
          <TabsContent key={k} value={String(k)}>
            <TemplateTable
              kind={k}
              onCreate={() => openCreate(k)}
              onEdit={openEdit}
              onRetire={retire}
            />
          </TabsContent>
        ))}
      </Tabs>

      <FormDialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        title={
          editing
            ? `${editing.existing ? 'Edit' : 'New'} ${TEMPLATE_KIND_LABEL[editing.kind].toLowerCase()} template`
            : 'Template'
        }
        className="max-h-[90vh] overflow-y-auto"
      >
        <div className="space-y-4">
          {fields.map((f) => {
            const id = `template-${f.key}`;
            const common = {
              id,
              value: form[f.key] ?? '',
              placeholder: f.placeholder,
              onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
                setForm((s) => ({ ...s, [f.key]: e.target.value })),
            };
            return (
              <div key={f.key} className="space-y-1.5">
                <Label htmlFor={id}>{f.label}</Label>
                {f.multiline ? (
                  <Textarea {...common} rows={6} className="font-mono text-xs" />
                ) : (
                  <Input
                    {...common}
                    disabled={f.key === 'templateId' && editing?.existing !== null}
                  />
                )}
              </div>
            );
          })}
          {formError && <CardNotice variant="error">{formError}</CardNotice>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={manage.isPending || (form.templateId ?? '').trim() === ''}
              onClick={save}
            >
              {manage.isPending ? 'Saving…' : 'Save template'}
            </Button>
          </div>
        </div>
      </FormDialog>
    </div>
  );
}
