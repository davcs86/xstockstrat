'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent } from '@components/ui/card';
import { Badge } from '@components/ui/badge';
import { Button } from '@components/ui/button';
import { Input } from '@components/ui/input';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@components/ui/table';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@components/ui/select';
import { BASE_PATH } from '@/app/lib/basepath';

// ── Types ───────────────────────────────────────────────────────────────────

const SOURCE_TYPES = [
  'simple_email', 'email_attachment', 'linked_email',
  'simple_website', 'authenticated_website',
  'mediated_simple_email', 'mediated_email_attachment', 'mediated_linked_email',
  'mediated_simple_website', 'mediated_authenticated_website',
] as const;

type SourceType = typeof SOURCE_TYPES[number];

interface SignalSource {
  slug: string;
  displayName: string;
  sourceType: SourceType;
  extractorModule: string;
  active: boolean;
  hasCredentials: boolean;
  configJson: Record<string, unknown>;
}

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

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function buildConfigJson(form: FormState): Record<string, unknown> {
  if (isEmailType(form.sourceType)) {
    const cfg: Record<string, unknown> = {
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
    sourceType: src.sourceType,
    extractorModule: src.extractorModule,
    active: src.active,
    senderPatterns: arrToStr(cfg.sender_patterns),
    subjectPatterns: arrToStr(cfg.subject_patterns),
    attachmentMimeTypes: arrToStr(cfg.attachment_mime_types),
    urlPatterns: arrToStr(cfg.url_patterns),
    url: String(cfg.url ?? ''),
    scrapeSelector: String(cfg.scrape_selector ?? ''),
    credentialsRef: '', // never pre-filled — acceptance criterion 13
  };
}

// ── Component ────────────────────────────────────────────────────────────────

export default function SourcesPage() {
  const [sources, setSources] = useState<SignalSource[]>([]);
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const fetchSources = useCallback(() => {
    return fetch(`${BASE_PATH}/api/sources?include_inactive=true`)
      .then((r) => r.json())
      .then((data) => setSources(data.sources ?? []));
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchSources(),
      fetch(`${BASE_PATH}/api/config?namespace=analysis&env=dev&mode=paper`)
        .then((r) => r.json())
        .then((data) => {
          const weightKey = (data.keys ?? []).find(
            (k: { key: string; defaultValue: string }) => k.key === 'analysis.signals.source_weights',
          );
          if (weightKey) {
            try { setWeights(JSON.parse(weightKey.defaultValue)); } catch { /* no-op */ }
          }
        }),
    ])
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [fetchSources]);

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

  async function handleToggle(src: SignalSource) {
    setSaving(true);
    try {
      const body = src.active
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
      await fetch(`${BASE_PATH}/api/sources`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      await fetchSources();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    const isNew = editingSlug === '__new__';
    const configJson = buildConfigJson(form);
    const body: Record<string, unknown> = {
      source: {
        slug: form.slug,
        displayName: form.displayName,
        sourceType: form.sourceType,
        extractorModule: form.extractorModule,
        active: form.active,
        configJson,
      },
      operation: isNew ? 'register' : 'update',
    };
    if (form.credentialsRef) body.credentialsRef = form.credentialsRef;

    try {
      const res = await fetch(`${BASE_PATH}/api/sources`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.error) { setSaveError(data.error); return; }
      await fetchSources();
      closeForm();
    } catch (e: any) {
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) return <div className="text-sm text-muted-foreground">Loading sources…</div>;
  if (error) return <div className="text-sm text-destructive">Error: {error}</div>;

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
                      {isMediatedType(src.sourceType) && (
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

      {/* Edit / Register form */}
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

            {/* Email-type fields */}
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

            {/* Website-type fields */}
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

            {/* Active checkbox */}
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
