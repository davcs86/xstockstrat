'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/authRedirect';
import { UserCircle } from '@phosphor-icons/react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface ProfileData {
  userId: string;
  email: string;
  phone: string | null;
  displayName: string | null;
  metadata: Record<string, unknown>;
  metadataUpdatedAt: string | null;
}

export default function ProfilePage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Read-only fields
  const [userId, setUserId] = useState('');
  const [email, setEmail] = useState('');

  // Editable fields
  const [phone, setPhone] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [metadataJson, setMetadataJson] = useState('');

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/accounts/api/profile');
      if (!res.ok) throw new Error(`Failed to load profile (${res.status})`);
      const data: ProfileData = await res.json();
      setUserId(data.userId);
      setEmail(data.email);
      setPhone(data.phone ?? '');
      setDisplayName(data.displayName ?? '');
      setMetadataJson(JSON.stringify(data.metadata ?? {}, null, 2));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  async function handleSave() {
    setError(null);
    setSuccess(null);

    // Validate metadata JSON before sending
    let parsedMetadata: Record<string, unknown> | undefined;
    if (metadataJson.trim()) {
      try {
        parsedMetadata = JSON.parse(metadataJson);
      } catch {
        setError('Metadata must be valid JSON');
        return;
      }
    }

    setSaving(true);
    try {
      const res = await apiFetch('/accounts/api/profile', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          phone: phone || undefined,
          displayName: displayName || undefined,
          metadata: parsedMetadata,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to save profile (${res.status})`);
      }
      const data: ProfileData = await res.json();
      setPhone(data.phone ?? '');
      setDisplayName(data.displayName ?? '');
      setMetadataJson(JSON.stringify(data.metadata ?? {}, null, 2));
      setSuccess('Profile updated');
      setTimeout(() => setSuccess(null), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center gap-2">
        <UserCircle className="h-5 w-5 text-primary" weight="bold" />
        <h1 className="text-xl font-semibold">My Profile</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Account details</CardTitle>
          <CardDescription>
            Your user ID and email are read-only. Edit your display name, phone, and custom metadata
            below.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && <p className="text-sm text-destructive">{error}</p>}
          {success && <p className="text-sm text-buy">{success}</p>}

          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <>
              {/* Read-only fields */}
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">User ID</label>
                <Input value={userId} readOnly disabled aria-label="User ID" />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Email</label>
                <Input value={email} readOnly disabled aria-label="Email" />
              </div>

              {/* Editable fields */}
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Display name</label>
                <Input
                  placeholder="Display name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  aria-label="Display name"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Phone</label>
                <Input
                  placeholder="Phone number"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  aria-label="Phone"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Metadata (JSON)</label>
                <textarea
                  className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
                  rows={4}
                  placeholder="{}"
                  value={metadataJson}
                  onChange={(e) => setMetadataJson(e.target.value)}
                  aria-label="Metadata"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <Button size="sm" onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving…' : 'Save'}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
