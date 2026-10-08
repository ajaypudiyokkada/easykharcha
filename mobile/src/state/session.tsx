/**
 * Who is signed in, and which tenant they are looking at.
 *
 * Capabilities come from the server with every bootstrap. The client uses them only to decide what to
 * *show* — every one of them is re-checked server-side, so a tampered client gets a 403, not data.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { clearTokens, get, loadTokens, post, saveTokens, setUnauthenticatedHandler } from '../api/client';

const TENANT_KEY = 'ek.tenant';

export type Tenant = {
  id: number;
  name: string;
  tagline: string;
  business_type: string;
  business_type_label: string;
  primary_colour: string;
  accent_colour: string;
  logo: string | null;
  role: string | null;
  capabilities: string[];
};

export type User = {
  id: number;
  phone: string;
  name: string;
  active: boolean;
  must_change_pin: boolean;
};

type SessionValue = {
  ready: boolean;
  user: User | null;
  tenants: Tenant[];
  tenant: Tenant | null;
  isSuperAdmin: boolean;
  signIn: (phone: string, pin: string) => Promise<void>;
  signOut: () => Promise<void>;
  selectTenant: (id: number) => Promise<void>;
  refreshSession: () => Promise<void>;
  can: (capability: string) => boolean;
};

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState<number | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  const applySession = useCallback(async (payload: any) => {
    setUser(payload.user);
    setTenants(payload.tenants ?? []);
    setIsSuperAdmin(Boolean(payload.is_super_admin));

    const stored = await AsyncStorage.getItem(TENANT_KEY);
    const storedId = stored ? Number(stored) : null;
    const available: Tenant[] = payload.tenants ?? [];
    // One tenant means no picker (§2). More than one keeps whatever was last chosen, if still valid.
    const next =
      available.length === 1
        ? available[0].id
        : available.find((t) => t.id === storedId)?.id ?? null;
    setTenantId(next);
    if (next !== null) await AsyncStorage.setItem(TENANT_KEY, String(next));
  }, []);

  const signOut = useCallback(async () => {
    await clearTokens();
    await AsyncStorage.removeItem(TENANT_KEY);
    setUser(null);
    setTenants([]);
    setTenantId(null);
    setIsSuperAdmin(false);
  }, []);

  useEffect(() => {
    setUnauthenticatedHandler(() => {
      void signOut();
    });
  }, [signOut]);

  useEffect(() => {
    (async () => {
      const { accessToken } = await loadTokens();
      if (accessToken) {
        try {
          await applySession(await get('/auth/me'));
        } catch {
          await signOut();
        }
      }
      setReady(true);
    })();
  }, [applySession, signOut]);

  const signIn = useCallback(
    async (phone: string, pin: string) => {
      const payload = await post('/auth/login', { phone: phone.trim(), pin });
      await saveTokens(payload.access, payload.refresh);
      await applySession(payload);
    },
    [applySession],
  );

  const selectTenant = useCallback(async (id: number) => {
    setTenantId(id);
    await AsyncStorage.setItem(TENANT_KEY, String(id));
  }, []);

  const refreshSession = useCallback(async () => {
    applySession(await get('/auth/me'));
  }, [applySession]);

  const tenant = useMemo(
    () => tenants.find((candidate) => candidate.id === tenantId) ?? null,
    [tenants, tenantId],
  );

  const can = useCallback(
    (capability: string) => Boolean(tenant?.capabilities?.includes(capability)),
    [tenant],
  );

  const value: SessionValue = {
    ready,
    user,
    tenants,
    tenant,
    isSuperAdmin,
    signIn,
    signOut,
    selectTenant,
    refreshSession,
    can,
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside <SessionProvider>');
  return context;
}

/** The capability strings the server sends. Keep in sync with backend/core/roles.py. */
export const Cap = {
  WASTAGE_ADD: 'wastage.add',
  STOCK_CAPTURE: 'stock.capture',
  RECEIVE_GOODS: 'receive.add',
  REQUEST_RAISE: 'request.raise',
  REQUEST_FULFIL: 'request.fulfil',
  SALES_RECORD: 'sales.record',
  CONFIG_ADD: 'config.add',
  CONFIG_EDIT: 'config.edit',
  STAFF_MANAGE: 'staff.manage',
  TENANT_CREATE: 'tenant.create',
  TENANT_SETTINGS: 'tenant.settings',
  REPORTS_VIEW: 'reports.view',
  ENTRY_EDIT: 'entry.edit',
  AUDIT_VIEW: 'audit.view',
  AUDIT_VIEW_ALL: 'audit.view_all',
  TEMPLATE_MANAGE: 'template.manage',
  SEE_SALES: 'visibility.sales',
  SEE_VARIANCE: 'visibility.variance',
} as const;
