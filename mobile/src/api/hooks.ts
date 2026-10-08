import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useSession } from '../state/session';
import { api, del, get, patch, post } from './client';

/** Every tenant-scoped path goes through here so no screen can forget the tenant prefix. */
export function useTenantPath() {
  const { tenant } = useSession();
  return (suffix: string) => `/tenants/${tenant?.id}${suffix}`;
}

/**
 * Cache key for a tenant-scoped request.
 *
 * The user id is part of the key, not just the tenant id. Two roles at the same tenant get different
 * payloads from the same URL — a Head Chef's /home is blind where an Owner's is not — so a
 * tenant-only key lets one user's response be served to another.
 */
export function tenantKey(userId: number | undefined, tenantId: number | undefined, suffix?: string) {
  return suffix === undefined ? ['tenant', userId, tenantId] : ['tenant', userId, tenantId, suffix];
}

export function useTenantQuery<T = any>(suffix: string, options: { enabled?: boolean } = {}) {
  const { tenant, user } = useSession();
  const path = useTenantPath();
  return useQuery<T>({
    queryKey: tenantKey(user?.id, tenant?.id, suffix),
    queryFn: () => get<T>(path(suffix)),
    enabled: Boolean(tenant) && (options.enabled ?? true),
  });
}

export function useTenantMutation<TVariables = any, TData = any>(
  build: (variables: TVariables) => { suffix: string; method?: 'POST' | 'PATCH' | 'DELETE'; body?: unknown },
  invalidate: string[] = [],
) {
  const { tenant, user } = useSession();
  const path = useTenantPath();
  const client = useQueryClient();

  return useMutation<TData, Error, TVariables>({
    mutationFn: async (variables) => {
      const { suffix, method = 'POST', body } = build(variables);
      const url = path(suffix);
      if (method === 'DELETE') return del(url);
      if (method === 'PATCH') return patch(url, body);
      return post(url, body);
    },
    onSuccess: () => {
      // Broad invalidation on purpose: one entry changes stock, alerts, home and the report at once,
      // and a stale cost figure is worse than a refetch.
      client.invalidateQueries({ queryKey: tenantKey(user?.id, tenant?.id) });
      invalidate.forEach((key) =>
        client.invalidateQueries({ queryKey: tenantKey(user?.id, tenant?.id, key) }),
      );
    },
  });
}

export function useUpload<TData = any>(suffix: string) {
  const { tenant, user } = useSession();
  const path = useTenantPath();
  const client = useQueryClient();
  return useMutation<TData, Error, FormData>({
    mutationFn: (form) => api<TData>(path(suffix), { method: 'POST', form }),
    onSuccess: () => client.invalidateQueries({ queryKey: tenantKey(user?.id, tenant?.id) }),
  });
}

export type Bootstrap = {
  business: any;
  role: string;
  role_label: string;
  capabilities: string[];
  ingredients: any[];
  vendors: any[];
  dishes: any[];
  alerts: { severity: string; code: string; message: string }[];
  today: string;
};

export function useBootstrap() {
  return useTenantQuery<Bootstrap>('/bootstrap');
}

export function useAlerts(range?: { start: string; end: string }) {
  const suffix = range ? `/alerts?start=${range.start}&end=${range.end}` : '/alerts';
  return useTenantQuery<{ severity: string; code: string; message: string }[]>(suffix);
}
