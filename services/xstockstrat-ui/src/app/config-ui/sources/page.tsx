'use client';

import { useState } from 'react';
import { EllipsisVertical } from 'lucide-react';
import { ConnectError } from '@connectrpc/connect';
import type { JsonObject } from '@bufbuild/protobuf';
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
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { useSignalSources } from '@/app/config-ui/hooks/useSignalSources';
import { useManageSignalSource } from '@/app/config-ui/hooks/useSignalSourceMutations';
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
  };
}

export default function SourcesPage() {
  const { sources, weights, isLoading: loading, error } = useSignalSources();
  const { mutate: manageMutate, isPending: saving } = useManageSignalSource();

  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saveError, setSaveError] = useState<string | null>(null);

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
    // Feature 088: reactivation is its own honest verb, decoupled from update (which no longer
    // touches `active`). Deactivate stays a distinct verb.
    const req = src.active
      ? { source: { slug: src.slug }, operation: 'deactivate' }
      : { source: { slug: src.slug }, operation: 'reactivate' };
    manageMutate(req);
  }

  function handleSave() {
    setSaveError(null);
    const isNew = editingSlug === '__new__';
    const configJson = buildConfigJson(form);
    const base = {
      source: {
        slug: form.slug,
        displayName: form.displayName,
        sourceType: form.sourceType,
        extractorModule: form.extractorModule,
        active: form.active,
        configJson,
      },
      ...(form.credentialsRef ? { credentialsRef: form.credentialsRef } : {}),
    };
    // Feature 088: on update, derive an AIP-161 update_mask so an omitted secret is PRESERVED.
    // Always submit the editable text fields; include credentials_ref only when a new secret was
    // typed. Paths are the backend's snake_case field names. `active`/`slug` are never masked
    // (column-authoritative; lifecycle uses the reactivate/deactivate verbs).
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
              ...(form.credentialsRef ? ['credentials_ref'] : []),
            ],
          },
        };
    manageMutate(req, {
      onSuccess: () => closeForm(),
      onError: (e) => setSaveError(errMessage(e)),
    });
  }

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

      {/* Health stat row (feature 083) — from ListSignalSources health/signals_fed. */}
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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Slug</TableHead>
                <TableHead>Display Name</TableHead>
                <TableHead>Source Type</TableHead>
                <TableHead>Active</TableHead>
                {/* feature 083 — source health + lifetime fed count. */}
                <TableHead>Health</TableHead>
                <TableHead>Fed</TableHead>
                <TableHead>Weight</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sources.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-6">
                    No sources registered yet.
                  </TableCell>
                </TableRow>
              )}
              {sources.map((src) => (
                <TableRow key={src.slug}>
                  <TableCell className="font-mono">{src.slug}</TableCell>
                  <TableCell>{src.displayName}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <span>{src.sourceType}</span>
                      {isMediatedType(src.sourceType as SourceType) && (
                        <Badge variant="info">Claude-mediated</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={src.active ? 'default' : 'secondary'}>
                      {src.active ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell title={src.lastError || undefined}>
                    <EnumBadge render={SOURCE_HEALTH[src.health]} />
                  </TableCell>
                  <TableCell className="font-mono tabular-nums">
                    {src.signalsFed ? src.signalsFed.toString() : '—'}
                  </TableCell>
                  <TableCell>{weights[src.slug] ?? 1.0}</TableCell>
                  <TableCell>
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
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
              <Button size="sm" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : editingSlug === '__new__' ? 'Register' : 'Save'}
              </Button>
              <Button size="sm" variant="ghost" onClick={closeForm} disabled={saving}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
