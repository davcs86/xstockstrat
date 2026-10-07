'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ConnectError } from '@connectrpc/connect';
import type { ColumnDef } from '@tanstack/react-table';
import { TemplateKind } from '@xstockstrat/proto/common/v1/common_pb';
import { AppShell } from '@/components/insights/AppShell';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DataTable } from '@/components/ui/data-table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { PageBreadcrumb } from '@/components/shared/PageBreadcrumb';
import { QueryStateMessages } from '@/components/shared/QueryStateMessages';
import { EmptyState } from '@/components/shared/EmptyState';
import { CardNotice } from '@/components/shared/CardNotice';
import { FormDialog } from '@/components/shared/FormDialog';
import { useInstantiateMcpSourceTemplate } from '@/app/config-ui/hooks/useSignalSourceMutations';
import {
  CATALOG_KINDS,
  TEMPLATE_KIND_LABEL,
  instanceHref,
  needsBearer,
  useInstantiateTemplate,
  useTemplates,
  type CatalogKind,
  type CatalogTemplate,
} from '@/hooks/useTemplates';

function errorText(err: Error | null): string | null {
  return err instanceof ConnectError ? err.rawMessage : (err?.message ?? null);
}

function TemplateCatalog({ kind }: { kind: CatalogKind }) {
  const router = useRouter();
  const { data, isLoading, error } = useTemplates(kind);
  const rows = useMemo(() => data ?? [], [data]);
  const instantiate = useInstantiateTemplate();
  const instantiateMcp = useInstantiateMcpSourceTemplate();
  const [bearerFor, setBearerFor] = useState<CatalogTemplate | null>(null);
  const [bearer, setBearer] = useState('');
  const label = TEMPLATE_KIND_LABEL[kind].toLowerCase();

  const columns = useMemo<ColumnDef<CatalogTemplate>[]>(
    () => [
      {
        id: 'name',
        header: 'Template',
        accessorFn: (r) => r.template.meta?.name ?? '',
        cell: ({ row }) => {
          const meta = row.original.template.meta;
          return (
            <div className="max-w-md">
              <p className="font-medium text-foreground">{meta?.name}</p>
              {meta?.description && (
                <p className="mt-0.5 text-xs text-muted-foreground">{meta.description}</p>
              )}
            </div>
          );
        },
      },
      {
        id: 'version',
        header: 'Version',
        accessorFn: (r) => r.template.meta?.version ?? 0,
        meta: { className: 'font-mono text-xs text-muted-foreground' },
        cell: ({ row }) => `v${row.original.template.meta?.version ?? 0}`,
      },
      {
        id: 'use',
        header: '',
        meta: { className: 'text-right' },
        cell: ({ row }) => {
          const r = row.original;
          const templateId = r.template.meta?.templateId ?? '';
          const name = r.template.meta?.name || templateId;
          const accessibleName = `Use template ${name}`;
          if (needsBearer(r)) {
            return (
              <Button
                size="sm"
                aria-label={accessibleName}
                disabled={instantiateMcp.isPending}
                onClick={() => {
                  instantiateMcp.reset();
                  setBearer('');
                  setBearerFor(r);
                }}
              >
                Use template
              </Button>
            );
          }
          const pending = instantiate.isPending && instantiate.variables?.templateId === templateId;
          return (
            <Button
              size="sm"
              aria-label={accessibleName}
              disabled={instantiate.isPending}
              onClick={() =>
                instantiate.mutate(
                  { kind, templateId },
                  { onSuccess: (id) => router.push(instanceHref(kind, id)) },
                )
              }
            >
              {pending ? 'Creating…' : 'Use template'}
            </Button>
          );
        },
      },
    ],
    [kind, router, instantiate, instantiateMcp],
  );

  const instantiateError = errorText(instantiate.error);
  const bearerTemplateId = bearerFor?.template.meta?.templateId ?? '';

  const submitBearer = () => {
    if (!bearer.trim()) return;
    instantiateMcp.mutate(
      { templateId: bearerTemplateId, bearerToken: bearer },
      {
        onSuccess: (slug) => {
          setBearer('');
          setBearerFor(null);
          router.push(instanceHref(kind, slug));
        },
      },
    );
  };

  return (
    <div className="space-y-3">
      {instantiateError && <CardNotice variant="error">{instantiateError}</CardNotice>}
      <Card>
        <CardContent className="pt-5">
          <QueryStateMessages
            isLoading={isLoading}
            error={error}
            loadingText={`Loading ${label} templates…`}
            errorText={`${TEMPLATE_KIND_LABEL[kind]} templates unavailable`}
          />
          {!isLoading && !error && rows.length === 0 && (
            <EmptyState
              title={`No ${label} templates yet`}
              description="Admins publish templates here; using one makes a private copy you own."
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
      <FormDialog
        open={bearerFor !== null}
        onOpenChange={(open) => {
          if (!open) setBearerFor(null);
        }}
        title={`Use template ${bearerFor?.template.meta?.name || bearerTemplateId}`}
        description="This MCP source needs your own bearer token. It is stored encrypted under your account and never shown again."
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submitBearer();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="template-bearer">Bearer token</Label>
            <Input
              id="template-bearer"
              type="password"
              autoComplete="off"
              value={bearer}
              onChange={(e) => setBearer(e.target.value)}
            />
          </div>
          {instantiateMcp.error && (
            <CardNotice variant="error">{errorText(instantiateMcp.error)}</CardNotice>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={instantiateMcp.isPending}
              onClick={() => setBearerFor(null)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={instantiateMcp.isPending || !bearer.trim()}>
              {instantiateMcp.isPending ? 'Creating…' : 'Create source'}
            </Button>
          </div>
        </form>
      </FormDialog>
    </div>
  );
}

export default function TemplatesPage() {
  return (
    <AppShell>
      <div className="p-4 sm:p-6 space-y-4">
        <div className="space-y-1">
          <PageBreadcrumb ariaLabel="Templates path" items={[{ label: 'Templates' }]} />
          <h1 className="text-xl font-bold tracking-tight">Templates</h1>
          <p className="text-sm text-muted-foreground">
            Start from a curated template. Each use creates a private copy you own; later template
            updates never change it.
          </p>
        </div>
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
              <TemplateCatalog kind={k} />
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </AppShell>
  );
}
