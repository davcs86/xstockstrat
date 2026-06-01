'use client';

import { useState } from 'react';
import { ConnectError } from '@connectrpc/connect';
import type { JsonObject } from '@bufbuild/protobuf';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import { useSignalSources } from '@/app/config-ui/hooks/useSignalSources';
import { useManageSignalSource } from '@/app/config-ui/hooks/useSignalSourceMutations';
import type { SignalSource } from '@xstockstrat/proto/ingest/v1/ingest_pb';

const SOURCE_TYPES = [
  'simple_email', 'email_attachment', 'linked_email',
  'simple_website', 'authenticated_website',
  'mediated_simple_email', 'mediated_email_attachment', 'mediated_linked_email',
  'mediated_simple_website', 'mediated_authenticated_website',
] as const;

type SourceType = typeof SOURCE_TYPES[number];

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
  return ['simple_email', 'email_attachment', 'linked_email',
    'mediated_simple_email', 'mediated_email_attachment', 'mediated_linked_email'].includes(t);
}

function isWebsiteType(t: SourceType) {
  return ['simple_website', 'authenticated_website',
    'mediated_simple_website', 'mediated_authenticated_website'].includes(t);
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
  return s.split(',').map((x) => x.trim()).filter(Boolean);
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
    const req = src.active
      ? { source: { slug: src.slug }, operation: 'deactivate' }
      : {
          source: {
            slug: src.slug,
            displayName: src.displayName,
            sourceType: src.sourceType,
            extractorModule: src.extractorModule,
            active: true,
            configJson: src.configJson,
          },
          operation: 'update',
        };
    manageMutate(req);
  }

  function handleSave() {
    setSaveError(null);
    const isNew = editingSlug === '__new__';
    const configJson = buildConfigJson(form);
    const req = {
      source: {
        slug: form.slug,
        displayName: form.displayName,
        sourceType: form.sourceType,
        extractorModule: form.extractorModule,
        active: form.active,
        configJson,
      },
      operation: isNew ? 'register' : 'update',
      ...(form.credentialsRef ? { credentialsRef: form.credentialsRef } : {}),
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
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Signal Sources</h1>
        <Button size="sm" onClick={openNew}>Register New Source</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Slug</TableHead>
                <TableHead>Display Name</TableHead>
                <TableHead>Source Type</TableHead>
                <TableHead>Active</TableHead>
                <TableHead>Weight</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sources.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
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
                  <TableCell>{weights[src.slug] ?? 1.0}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={saving}
                        onClick={() => handleToggle(src)}
                      >
                        {src.active ? 'Disable' : 'Enable'}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openEdit(src)}
                      >
                        Edit
                      </Button>
                    </div>
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
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SOURCE_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
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
                  <label className="text-xs text-muted-foreground">Sender Patterns (comma-separated)</label>
                  <Input
                    placeholder="*@unusualwhales.com, noreply@*"
                    value={form.senderPatterns}
                    onChange={(e) => setField('senderPatterns', e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Subject Patterns (comma-separated)</label>
                  <Input
                    placeholder="Daily Flow, *Alert*"
                    value={form.subjectPatterns}
                    onChange={(e) => setField('subjectPatterns', e.target.value)}
                  />
                </div>
                {isAttachmentType(form.sourceType) && (
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Attachment MIME Types (comma-separated)</label>
                    <Input
                      placeholder="application/pdf, text/csv"
                      value={form.attachmentMimeTypes}
                      onChange={(e) => setField('attachmentMimeTypes', e.target.value)}
                    />
                  </div>
                )}
                {isLinkedEmailType(form.sourceType) && (
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">URL Patterns (comma-separated)</label>
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
                        <Badge variant="info" className="ml-2">configured</Badge>
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
              <input
                type="checkbox"
                id="active-toggle"
                checked={form.active}
                onChange={(e) => setField('active', e.target.checked)}
                className="h-4 w-4"
              />
              <label htmlFor="active-toggle" className="text-sm">Active</label>
            </div>

            {saveError && (
              <p className="text-xs text-destructive">{saveError}</p>
            )}

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
