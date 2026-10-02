'use client';

import { useRouter } from 'next/navigation';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { configUiHref, KNOWN_NAMESPACES } from '@/lib/configNamespaces';

/** Namespace picker for the config-ui editor; switching navigates and keeps env + user scope. */
export function NamespaceSelect({
  namespace,
  env,
  user,
}: {
  namespace: string;
  env: string;
  user: string;
}) {
  const router = useRouter();
  const options = KNOWN_NAMESPACES.includes(namespace)
    ? KNOWN_NAMESPACES
    : [...KNOWN_NAMESPACES, namespace];

  return (
    <Select
      value={namespace}
      onValueChange={(ns) => router.push(configUiHref(`/config-ui/${ns}`, env, user))}
    >
      <SelectTrigger className="h-8 w-48" aria-label="Namespace">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((ns) => (
          <SelectItem key={ns} value={ns}>
            {ns}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
