'use client';
import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ConnectError } from '@connectrpc/connect';
import type { ColumnDef } from '@tanstack/react-table';
import { TemplateKind } from '@xstockstrat/proto/common/v1/common_pb';
import { AppShell } from '@/components/insights/AppShell';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { PageBreadcrumb } from '@/components/shared/PageBreadcrumb';
import { QueryStateMessages } from '@/components/shared/QueryStateMessages';
import { EmptyState } from '@/components/shared/EmptyState';
import { CardNotice } from '@/components/shared/CardNotice';
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

const BEARER_REASON =
  'This MCP source needs your own bearer token; instantiating it from the catalog is not available yet.';

function TemplateCatalog({ kind }: { kind: CatalogKind }) {
  const router = useRouter();
  const { data, isLoading, error } = useTemplates(kind);
  const rows = useMemo(() => data ?? [], [data]);
  const instantiate = useInstantiateTemplate();
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
            const reasonId = `bearer-reason-${templateId}`;
            return (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    {/* A disabled button gets no pointer/focus events; the span carries the tooltip. */}
                    <span tabIndex={0} className="inline-block">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled
                        aria-label={accessibleName}
                        aria-describedby={reasonId}
                      >
                        Use template
                      </Button>
                      <span id={reasonId} className="sr-only">
                        {BEARER_REASON}
                      </span>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{BEARER_REASON}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
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
    [kind, router, instantiate],
  );

  const instantiateError =
    instantiate.error instanceof ConnectError
      ? instantiate.error.rawMessage
      : (instantiate.error?.message ?? null);

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
