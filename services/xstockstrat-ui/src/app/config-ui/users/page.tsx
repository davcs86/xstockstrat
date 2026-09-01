'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ConnectError } from '@connectrpc/connect';
import { timestampDate } from '@bufbuild/protobuf/wkt';
import type { ColumnDef } from '@tanstack/react-table';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { DataTable } from '@/components/ui/data-table';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { EllipsisVertical } from 'lucide-react';
import { FormDialog } from '@/components/shared/FormDialog';
import { CardNotice } from '@/components/shared/CardNotice';
import { QueryStateMessages } from '@/components/shared/QueryStateMessages';
import { EmptyState } from '@/components/shared/EmptyState';
import { configUiIdentityClient } from '@/lib/browserClients/configUiIdentityClient';
import { ROLE_LABELS, ASSIGNABLE_ROLES, rolesLabel } from '@/lib/roleLabels';
import { Role } from '@xstockstrat/proto/identity/v1/identity_pb';
import type { User } from '@xstockstrat/proto/identity/v1/identity_pb';

const USERS_KEY = ['config-ui-users'];

function RoleCheckboxes({
  selected,
  onToggle,
}: {
  selected: Role[];
  onToggle: (role: Role, checked: boolean) => void;
}) {
  return (
    <div className="flex flex-wrap gap-3">
      {ASSIGNABLE_ROLES.map((r) => {
        const id = `role-${r}`;
        return (
          <label key={r} htmlFor={id} className="flex items-center gap-2 text-sm">
            <Checkbox
              id={id}
              checked={selected.includes(r)}
              onCheckedChange={(c) => onToggle(r, c === true)}
            />
            {ROLE_LABELS[r]}
          </label>
        );
      })}
    </div>
  );
}

export default function UsersPage() {
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: USERS_KEY,
    queryFn: () => configUiIdentityClient.listUsers({}),
  });
  const users = useMemo(() => data?.users ?? [], [data]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: USERS_KEY });
  const onError = (err: unknown) =>
    setActionError(err instanceof ConnectError ? err.rawMessage : 'Action failed');

  // Create user dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRoles, setNewRoles] = useState<Role[]>([Role.TRADER]);

  // Per-user dialogs
  const [pwUser, setPwUser] = useState<User | null>(null);
  const [pwValue, setPwValue] = useState('');
  const [rolesUser, setRolesUser] = useState<User | null>(null);
  const [rolesDraft, setRolesDraft] = useState<Role[]>([]);

  const createMut = useMutation({
    mutationFn: () =>
      configUiIdentityClient.createUser({
        email: newEmail,
        password: newPassword,
        roles: newRoles,
      }),
    onSuccess: () => {
      setCreateOpen(false);
      setNewEmail('');
      setNewPassword('');
      setNewRoles([Role.TRADER]);
      setActionError(null);
      invalidate();
    },
    onError,
  });

  const passwordMut = useMutation({
    mutationFn: (userId: string) =>
      configUiIdentityClient.updatePassword({ userId, newPassword: pwValue }),
    onSuccess: () => {
      setPwUser(null);
      setPwValue('');
      setActionError(null);
    },
    onError,
  });

  const rolesMut = useMutation({
    mutationFn: (userId: string) =>
      configUiIdentityClient.setUserRoles({ userId, roles: rolesDraft }),
    onSuccess: () => {
      setRolesUser(null);
      setActionError(null);
      invalidate();
    },
    onError,
  });

  const activeMut = useMutation({
    mutationFn: (vars: { userId: string; active: boolean }) =>
      configUiIdentityClient.setUserActive(vars),
    onSuccess: () => {
      setActionError(null);
      invalidate();
    },
    onError,
  });

  const columns = useMemo<ColumnDef<User>[]>(
    () => [
      { accessorKey: 'email', header: 'Email', meta: { className: 'font-medium' } },
      {
        id: 'roles',
        header: 'Roles',
        cell: ({ row }) => rolesLabel(row.original.roles),
      },
      {
        id: 'status',
        header: 'Status',
        cell: ({ row }) =>
          row.original.isActive ? (
            <Badge variant="secondary">Active</Badge>
          ) : (
            <Badge variant="warning">Inactive</Badge>
          ),
      },
      {
        id: 'created',
        header: 'Created',
        meta: { className: 'text-muted-foreground hidden sm:table-cell' },
        cell: ({ row }) =>
          row.original.createdAt ? timestampDate(row.original.createdAt).toLocaleDateString() : '—',
      },
      {
        id: 'actions',
        header: '',
        meta: { className: 'text-right' },
        cell: ({ row }) => {
          const u = row.original;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={`Actions for ${u.email}`}>
                  <EllipsisVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => {
                    setPwUser(u);
                    setPwValue('');
                  }}
                >
                  Reset password
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setRolesUser(u);
                    setRolesDraft(u.roles);
                  }}
                >
                  Edit roles
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => activeMut.mutate({ userId: u.userId, active: !u.isActive })}
                >
                  {u.isActive ? 'Deactivate' : 'Reactivate'}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    [activeMut],
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Users</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Create users, reset passwords, and manage roles and access.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          Create user
        </Button>
      </div>

      {actionError && <CardNotice variant="error">{actionError}</CardNotice>}

      <Card>
        <CardContent className="pt-5">
          <QueryStateMessages
            isLoading={isLoading}
            error={error}
            loadingText="Loading users…"
            errorText="Users unavailable"
          />
          {!isLoading && !error && users.length === 0 && (
            <EmptyState title="No users" description="Create the first user to get started." />
          )}
          {!isLoading && !error && users.length > 0 && <DataTable columns={columns} data={users} />}
        </CardContent>
      </Card>

      {/* Create user */}
      <FormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="Create user"
        description="The password is set once here and is never displayed again."
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="new-email">Email</Label>
            <Input
              id="new-email"
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-password">Password</Label>
            <Input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Roles</Label>
            <RoleCheckboxes
              selected={newRoles}
              onToggle={(r, c) =>
                setNewRoles((prev) => (c ? [...prev, r] : prev.filter((x) => x !== r)))
              }
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createMut.mutate()}
              disabled={!newEmail || !newPassword || createMut.isPending}
            >
              Create
            </Button>
          </div>
        </div>
      </FormDialog>

      {/* Reset password */}
      <FormDialog
        open={pwUser !== null}
        onOpenChange={(o) => !o && setPwUser(null)}
        title={pwUser ? `Reset password — ${pwUser.email}` : 'Reset password'}
        description="Sets a new password and signs the user out of existing sessions."
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="reset-password">New password</Label>
            <Input
              id="reset-password"
              type="password"
              value={pwValue}
              onChange={(e) => setPwValue(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setPwUser(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => pwUser && passwordMut.mutate(pwUser.userId)}
              disabled={!pwValue || passwordMut.isPending}
            >
              Reset
            </Button>
          </div>
        </div>
      </FormDialog>

      {/* Edit roles */}
      <FormDialog
        open={rolesUser !== null}
        onOpenChange={(o) => !o && setRolesUser(null)}
        title={rolesUser ? `Edit roles — ${rolesUser.email}` : 'Edit roles'}
      >
        <div className="space-y-4">
          <RoleCheckboxes
            selected={rolesDraft}
            onToggle={(r, c) =>
              setRolesDraft((prev) => (c ? [...prev, r] : prev.filter((x) => x !== r)))
            }
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setRolesUser(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => rolesUser && rolesMut.mutate(rolesUser.userId)}
              disabled={rolesMut.isPending}
            >
              Save
            </Button>
          </div>
        </div>
      </FormDialog>
    </div>
  );
}
