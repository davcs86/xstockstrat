'use client';

import { useMemo, useState } from 'react';
import { EllipsisVertical } from 'lucide-react';
import { ConnectError } from '@connectrpc/connect';
import type { JsonObject } from '@bufbuild/protobuf';
import type { ColumnDef } from '@tanstack/react-table';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { DataTable } from '@/components/ui/data-table';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { useSignalSources } from '@/app/config-ui/hooks/useSignalSources';
import {
  useManageSignalSource,
  useRegisterMcpClientSource,
} from '@/app/config-ui/hooks/useSignalSourceMutations';
import type { SignalSource } from '@xstockstrat/proto/ingest/v1/ingest_pb';
import { SourceHealthStatus } from '@xstockstrat/proto/ingest/v1/ingest_pb';
import { SOURCE_HEALTH, EnumBadge } from '@/lib/opportunityShared';
import { StatTile } from '@/components/shared/StatTile';

const SOURCE_TYPES = [
  'simple_email',
  'email_attachment',
  'linked_email',
  'simple_website',
  'authenticated_website',
  'mediated_simple_email',
  'mediated_email_attachment',
  'mediated_linked_email',
  'mediated_simple_website',
  'mediated_authenticated_website',
  'mcp_client',
] as const;

type SourceType = (typeof SOURCE_TYPES)[number];

interface FormState {
  slug: string;
  displayName: string;
  sourceType: SourceType;
  extractorModule: string;
  active: boolean;
  senderPatterns: string;
  subjectPatterns: string;
  attachmentMimeTypes: string;
  urlPatterns: string;
  url: string;
  scrapeSelector: string;
  credentialsRef: string;
  reliabilityWeight: string;
  // mcp_client fields. The bearer token is WRITE-ONLY (never rendered back).
  mcpEndpoint: string;
  mcpTool: string;
  bearerToken: string;
}

const EMPTY_FORM: FormState = {
  slug: '',
  displayName: '',
  sourceType: 'simple_email',
  extractorModule: '',
  active: true,
  senderPatterns: '',
  subjectPatterns: '',
  attachmentMimeTypes: '',
  urlPatterns: '',
  url: '',
  scrapeSelector: '',
  credentialsRef: '',
  reliabilityWeight: '1', // default 1.0 (neutral)
  mcpEndpoint: '',
  mcpTool: '',
  bearerToken: '',
};

function isEmailType(t: SourceType) {
  return [
    'simple_email',
    'email_attachment',
    'linked_email',
    'mediated_simple_email',
    'mediated_email_attachment',
    'mediated_linked_email',
  ].includes(t);
}

function isWebsiteType(t: SourceType) {
  return [
    'simple_website',
    'authenticated_website',
    'mediated_simple_website',
    'mediated_authenticated_website',
  ].includes(t);
}

function isAttachmentType(t: SourceType) {
  return ['email_attachment', 'mediated_email_attachment'].includes(t);
}

function isLinkedEmailType(t: SourceType) {
  return ['linked_email', 'mediated_linked_email'].includes(t);
}

function isAuthWebsiteType(t: SourceType) {
  return ['authenticated_website', 'mediated_authenticated_website'].includes(t);
}

function isMediatedType(t: SourceType) {
  return t.startsWith('mediated_');
}

function isMcpClientType(t: SourceType) {
  return t === 'mcp_client';
}

function splitPatterns(s: string): string[] {
  return s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

function errMessage(err: unknown): string {
  return err instanceof ConnectError ? err.rawMessage : (err as Error).message;
}

function buildConfigJson(form: FormState): JsonObject {
  if (isEmailType(form.sourceType)) {
    const cfg: JsonObject = {
      sender_patterns: splitPatterns(form.senderPatterns),
      subject_patterns: splitPatterns(form.subjectPatterns),
    };
    if (isAttachmentType(form.sourceType)) {
      cfg.attachment_mime_types = splitPatterns(form.attachmentMimeTypes);
    }
    if (isLinkedEmailType(form.sourceType)) {
      cfg.url_patterns = splitPatterns(form.urlPatterns);
    }
    return cfg;
  }
  if (isWebsiteType(form.sourceType)) {
    return { url: form.url, scrape_selector: form.scrapeSelector };
  }
  if (isMcpClientType(form.sourceType)) {
    // Only the endpoint + tool ride config_json; the bearer is NEVER here (written separately as an
    // encrypted config secret).
    return { mcp_endpoint: form.mcpEndpoint, mcp_tool: form.mcpTool };
  }
  return {};
}

function formFromSource(src: SignalSource): FormState {
  const cfg = src.configJson ?? {};
  const arrToStr = (v: unknown) =>
    Array.isArray(v) ? (v as string[]).join(', ') : String(v ?? '');
  return {
    slug: src.slug,
    displayName: src.displayName,
    sourceType: src.sourceType as SourceType,
    extractorModule: src.extractorModule,
    active: src.active,
    senderPatterns: arrToStr(cfg.sender_patterns),
    subjectPatterns: arrToStr(cfg.subject_patterns),
    attachmentMimeTypes: arrToStr(cfg.attachment_mime_types),
    urlPatterns: arrToStr(cfg.url_patterns),
    url: String(cfg.url ?? ''),
    scrapeSelector: String(cfg.scrape_selector ?? ''),
    credentialsRef: '',
    reliabilityWeight: String(src.reliabilityWeight ?? 1.0),
    mcpEndpoint: String(cfg.mcp_endpoint ?? ''),
    mcpTool: String(cfg.mcp_tool ?? ''),
    bearerToken: '', // write-only — never populated from a stored source
  };
}

export default function SourcesPage() {
  const { sources, isLoading: loading, error } = useSignalSources();
  const { mutate: manageMutate, isPending: saving } = useManageSignalSource();
  const { mutate: registerMcpMutate, isPending: savingMcp } = useRegisterMcpClientSource();

  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Inline reliability-weight cell editing (separate from the full edit modal).
  const [editingWeightSlug, setEditingWeightSlug] = useState<string | null>(null);
  const [weightValue, setWeightValue] = useState('');
  const [weightError, setWeightError] = useState<string | null>(null);

  function openWeightEdit(slug: string, current: number) {
    setEditingWeightSlug(slug);
    setWeightValue(String(current));
    setWeightError(null);
  }

  function saveWeight(slug: string) {
    // Bespoke [0,1] scalar check — NOT validateFloatMap (that JSON.parses a map, not a scalar).
    const parsed = Number(weightValue);
    if (weightValue.trim() === '' || Number.isNaN(parsed) || parsed < 0 || parsed > 1) {
      setWeightError('Weight must be a number in [0, 1]');
      return;
    }
    manageMutate(
      {
        operation: 'update',
        source: { slug, reliabilityWeight: parsed },
        updateMask: { paths: ['reliability_weight'] },
      },
      {
        onSuccess: () => setEditingWeightSlug(null),
        onError: (e) => setWeightError(errMessage(e)),
      },
    );
  }

  function openEdit(src: SignalSource) {
    setForm(formFromSource(src));
    setEditingSlug(src.slug);
    setSaveError(null);
  }

  function openNew() {
    setForm(EMPTY_FORM);
    setEditingSlug('__new__');
    setSaveError(null);
  }

  function closeForm() {
    setEditingSlug(null);
    setSaveError(null);
  }

  function setField<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function handleToggle(src: SignalSource) {
    // Reactivation and deactivation are distinct verbs; update does not touch `active`.
    const req = src.active
      ? { source: { slug: src.slug }, operation: 'deactivate' }
      : { source: { slug: src.slug }, operation: 'reactivate' };
    manageMutate(req);
  }

  function handleSave() {
    setSaveError(null);
    // Validate the reliability weight with the same [0,1] scalar shape as the inline editor
    // (NOT validateFloatMap, which parses a JSON map). Blocks the write on a bad value.
    const weight = Number(form.reliabilityWeight);
    if (form.reliabilityWeight.trim() === '' || Number.isNaN(weight) || weight < 0 || weight > 1) {
      setSaveError('Reliability weight must be a number in [0, 1]');
      return;
    }
    const isNew = editingSlug === '__new__';
    const configJson = buildConfigJson(form);
    // Registering an mcp_client source is a secret-first two-write: the bearer goes to an encrypted
    // config secret, then the source registers with credentials_ref (never the token in config_json).
    if (isNew && isMcpClientType(form.sourceType)) {
      if (!form.bearerToken.trim()) {
        setSaveError('A bearer token is required to register an MCP client source');
        return;
      }
      registerMcpMutate(
        {
          slug: form.slug,
          bearerToken: form.bearerToken,
          source: {
            slug: form.slug,
            displayName: form.displayName,
            sourceType: form.sourceType,
            extractorModule: form.extractorModule,
            active: form.active,
            configJson,
            reliabilityWeight: weight,
          },
        },
        { onSuccess: () => closeForm(), onError: (e) => setSaveError(errMessage(e)) },
      );
      return;
    }
    const base = {
      source: {
        slug: form.slug,
        displayName: form.displayName,
        sourceType: form.sourceType,
        extractorModule: form.extractorModule,
        active: form.active,
        configJson,
        reliabilityWeight: weight,
      },
      ...(form.credentialsRef ? { credentialsRef: form.credentialsRef } : {}),
    };
    // On update, derive an AIP-161 update_mask so an omitted secret is PRESERVED; include
    // credentials_ref only when a new secret was typed. `active`/`slug` are never masked.
    const req = isNew
      ? { ...base, operation: 'register' }
      : {
          ...base,
          operation: 'update',
          updateMask: {
            paths: [
              'display_name',
              'source_type',
              'extractor_module',
              'config_json',
              'reliability_weight', // persist the weight edited on the form
              ...(form.credentialsRef ? ['credentials_ref'] : []),
            ],
          },
        };
    manageMutate(req, {
      onSuccess: () => closeForm(),
      onError: (e) => setSaveError(errMessage(e)),
    });
  }

  const columns = useMemo<ColumnDef<SignalSource>[]>(
    () => [
      {
        accessorKey: 'slug',
        header: 'Slug',
        meta: { className: 'font-mono' },
      },
      {
        accessorKey: 'displayName',
        header: 'Display Name',
      },
      {
        id: 'sourceType',
        header: 'Source Type',
        accessorFn: (src) => src.sourceType,
        cell: ({ row }) => {
          const src = row.original;
          return (
            <div className="flex items-center gap-1.5">
              <span>{src.sourceType}</span>
              {isMediatedType(src.sourceType as SourceType) && (
                <Badge variant="info">Claude-mediated</Badge>
              )}
            </div>
          );
        },
      },
      {
        id: 'active',
        header: 'Active',
        accessorFn: (src) => src.active,
        cell: ({ row }) => (
          <Badge variant={row.original.active ? 'default' : 'secondary'}>
            {row.original.active ? 'Active' : 'Inactive'}
          </Badge>
        ),
      },
      {
        id: 'health',
        header: 'Health',
        accessorFn: (src) => src.health,
        cell: ({ row }) => (
          <span title={row.original.lastError || undefined}>
            <EnumBadge render={SOURCE_HEALTH[row.original.health]} />
          </span>
        ),
      },
      {
        id: 'fed',
        header: 'Fed',
        accessorFn: (src) => Number(src.signalsFed ?? 0),
        meta: { className: 'font-mono tabular-nums' },
        cell: ({ row }) => (row.original.signalsFed ? row.original.signalsFed.toString() : '—'),
      },
      {
        id: 'weight',
        header: 'Weight',
        accessorFn: (src) => src.reliabilityWeight ?? 1.0,
        cell: ({ row }) => {
          const src = row.original;
          return editingWeightSlug === src.slug ? (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5">
                <Input
                  type="number"
                  step="0.1"
                  min={0}
                  max={1}
                  value={weightValue}
                  onChange={(e) => setWeightValue(e.target.value)}
                  className="h-8 w-20"
                  aria-label={`Weight for ${src.slug}`}
                />
                <Button size="sm" disabled={saving} onClick={() => saveWeight(src.slug)}>
                  Save
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditingWeightSlug(null)}>
                  Cancel
                </Button>
                {weightError && <span className="text-xs text-destructive">{weightError}</span>}
              </div>
              <p className="text-muted-foreground text-xs mt-0.5">
                Ranking multiplier in [0, 1] (default 1.0). Higher = this source&apos;s signals rank
                higher; 0 ignores the source.
              </p>
            </div>
          ) : (
            <button
              type="button"
              className="tabular-nums hover:underline"
              data-testid={`weight-${src.slug}`}
              onClick={() => openWeightEdit(src.slug, src.reliabilityWeight ?? 1.0)}
            >
              {src.reliabilityWeight ?? 1.0}
            </button>
          );
        },
      },
      {
        id: 'actions',
        header: 'Actions',
        enableSorting: false,
        cell: ({ row }) => {
          const src = row.original;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Actions"
                  data-testid={`actions-${src.slug}`}
                >
                  <EllipsisVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled={saving} onClick={() => handleToggle(src)}>
                  {src.active ? 'Disable' : 'Enable'}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => openEdit(src)}>Edit</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    [
      editingWeightSlug,
      weightValue,
      weightError,
      saving,
      handleToggle,
      openEdit,
      openWeightEdit,
      saveWeight,
    ],
  );

  if (loading) return <div className="text-sm text-muted-foreground">Loading sources…</div>;
  if (error) return <div className="text-sm text-destructive">Error: {errMessage(error)}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-semibold">Signal Sources</h1>
          <p className="text-sm text-muted-foreground">
            Inputs the strategies evaluate against, and whether they are fresh enough to trust.
          </p>
        </div>
        <Button size="sm" onClick={openNew}>
          Register New Source
        </Button>
      </div>

      {sources.length > 0 &&
        (() => {
          const live = sources.filter((s) => s.health === SourceHealthStatus.LIVE).length;
          const attention = sources.filter(
            (s) => s.health === SourceHealthStatus.STALE || s.health === SourceHealthStatus.DOWN,
          );
          const activeCount = sources.filter((s) => s.active).length;
          const fed = sources.reduce((sum, s) => sum + Number(s.signalsFed ?? 0), 0);
          return (
            <div className="grid grid-cols-2 overflow-hidden rounded-md border border-border sm:grid-cols-5">
              <StatTile
                label="Sources live"
                value={live}
                tone="gain"
                sub={`of ${sources.length} configured`}
              />
              <StatTile
                label="Needs attention"
                value={attention.length}
                tone={attention.length > 0 ? 'loss' : undefined}
                sub={attention[0]?.slug}
              />
              <StatTile label="Configured" value={sources.length} sub="registered" />
              <StatTile label="Signals fed" value={fed} tone="accent" sub="lifetime" />
              <StatTile label="Active feeds" value={activeCount} sub="evaluating" />
            </div>
          );
        })()}

      <Card>
        <CardContent className="p-0">
          <DataTable columns={columns} data={sources} emptyMessage="No sources registered yet." />
        </CardContent>
      </Card>

      {editingSlug !== null && (
        <Card>
          <CardContent className="pt-4 space-y-3">
            <h2 className="text-sm font-semibold">
              {editingSlug === '__new__' ? 'Register New Source' : `Edit: ${editingSlug}`}
            </h2>

            {editingSlug === '__new__' && (
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Slug</label>
                <Input
                  placeholder="e.g. unusual_whales"
                  value={form.slug}
                  onChange={(e) => setField('slug', e.target.value)}
                />
              </div>
            )}

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Display Name</label>
              <Input
                placeholder="Display name"
                value={form.displayName}
                onChange={(e) => setField('displayName', e.target.value)}
              />
            </div>

            {editingSlug === '__new__' && (
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Source Type</label>
                <Select
                  value={form.sourceType}
                  onValueChange={(v) => setField('sourceType', v as SourceType)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SOURCE_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Extractor Module</label>
              <Input
                placeholder="e.g. app.extractors.example_simple_email"
                value={form.extractorModule}
                disabled={editingSlug !== '__new__'}
                onChange={(e) => setField('extractorModule', e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Reliability Weight</label>
              <Input
                type="number"
                step="0.1"
                min={0}
                max={1}
                value={form.reliabilityWeight}
                onChange={(e) => setField('reliabilityWeight', e.target.value)}
                aria-label="Reliability weight"
              />
              <p className="text-muted-foreground text-xs mt-0.5">
                Ranking multiplier in [0, 1] (default 1.0). Higher weights rank this source&apos;s
                signals higher; 0 effectively ignores the source.
              </p>
            </div>

            {isEmailType(form.sourceType) && (
              <>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">
                    Sender Patterns (comma-separated)
                  </label>
                  <Input
                    placeholder="*@unusualwhales.com, noreply@*"
                    value={form.senderPatterns}
                    onChange={(e) => setField('senderPatterns', e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">
                    Subject Patterns (comma-separated)
                  </label>
                  <Input
                    placeholder="Daily Flow, *Alert*"
                    value={form.subjectPatterns}
                    onChange={(e) => setField('subjectPatterns', e.target.value)}
                  />
                </div>
                {isAttachmentType(form.sourceType) && (
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">
                      Attachment MIME Types (comma-separated)
                    </label>
                    <Input
                      placeholder="application/pdf, text/csv"
                      value={form.attachmentMimeTypes}
                      onChange={(e) => setField('attachmentMimeTypes', e.target.value)}
                    />
                  </div>
                )}
                {isLinkedEmailType(form.sourceType) && (
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">
                      URL Patterns (comma-separated)
                    </label>
                    <Input
                      placeholder="https://unusualwhales.com/*, https://example.com/signals/*"
                      value={form.urlPatterns}
                      onChange={(e) => setField('urlPatterns', e.target.value)}
                    />
                  </div>
                )}
              </>
            )}

            {isWebsiteType(form.sourceType) && (
              <>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">URL</label>
                  <Input
                    placeholder="https://example.com/signals"
                    value={form.url}
                    onChange={(e) => setField('url', e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Scrape Selector</label>
                  <Input
                    placeholder=".signal-row, #trades-table tr"
                    value={form.scrapeSelector}
                    onChange={(e) => setField('scrapeSelector', e.target.value)}
                  />
                </div>
                {isAuthWebsiteType(form.sourceType) && (
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">
                      Credentials Ref (secret.* key name)
                      {form.active && editingSlug !== '__new__' && (
                        <Badge variant="info" className="ml-2">
                          configured
                        </Badge>
                      )}
                    </label>
                    <Input
                      placeholder="secret.my_source_credentials"
                      value={form.credentialsRef}
                      onChange={(e) => setField('credentialsRef', e.target.value)}
                    />
                  </div>
                )}
              </>
            )}

            {isMcpClientType(form.sourceType) && (
              <>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">MCP Endpoint</label>
                  <Input
                    placeholder="https://mcp.acme.example/mcp"
                    value={form.mcpEndpoint}
                    onChange={(e) => setField('mcpEndpoint', e.target.value)}
                    aria-label="MCP endpoint"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Tool Name</label>
                  <Input
                    placeholder="get_signals"
                    value={form.mcpTool}
                    onChange={(e) => setField('mcpTool', e.target.value)}
                    aria-label="MCP tool name"
                  />
                </div>
                {editingSlug === '__new__' && (
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Bearer Token</label>
                    <Input
                      type="password"
                      placeholder="Enter the MCP bearer token"
                      value={form.bearerToken}
                      onChange={(e) => setField('bearerToken', e.target.value)}
                      aria-label="Bearer token"
                    />
                    <p className="text-muted-foreground text-xs mt-0.5">
                      Stored encrypted at rest and never shown again. Required to register.
                    </p>
                  </div>
                )}
              </>
            )}

            <div className="flex items-center gap-2">
              <Switch
                id="active-toggle"
                checked={form.active}
                onCheckedChange={(v) => setField('active', v)}
              />
              <label htmlFor="active-toggle" className="text-sm">
                Active
              </label>
            </div>

            {saveError && <p className="text-xs text-destructive">{saveError}</p>}

            <div className="flex items-center gap-2 pt-1">
              <Button size="sm" onClick={handleSave} disabled={saving || savingMcp}>
                {saving || savingMcp ? 'Saving…' : editingSlug === '__new__' ? 'Register' : 'Save'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={closeForm}
                disabled={saving || savingMcp}
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
