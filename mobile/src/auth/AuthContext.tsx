import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type { Business } from '../api/business';
import {
  login as loginApi,
  logout as logoutApi,
  refresh as refreshApi,
  type AuthUser,
  type MeResponse,
} from '../api/auth';
import { api, ApiError, type RequestOptions } from '../api/client';
import { tokenStorage } from './storage';

// 'offline' is distinct from 'signedOut': stored tokens exist and are presumed still good, but the
// startup /me call couldn't be attempted or completed over the network. Treating that as signed-out
// would silently clear a perfectly valid session just because the app happened to open offline.
export type AuthStatus = 'bootstrapping' | 'signedOut' | 'signedIn' | 'offline';

type AuthContextValue = {
  status: AuthStatus;
  user: AuthUser | null;
  businesses: Business[];
  login: (mobile: string, secret: string) => Promise<MeResponse>;
  logout: () => Promise<void>;
  /** A token-attached, refresh-on-401-once fetch for any endpoint that needs a signed-in user. */
  authedFetch: <T>(path: string, options?: RequestOptions) => Promise<T>;
  /** Re-fetches /me and updates `user`/`businesses` — used after the wizard writes a business, so
   * the rest of the app sees the change without needing a fresh login. */
  refreshMe: () => Promise<MeResponse>;
  /** Re-attempts the startup /me check — what the `status === 'offline'` retry screen calls. */
  retryBootstrap: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('bootstrapping');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  // The tokens that actually go on the wire. Refs, not state — they're read inside callbacks that
  // must never see a stale closure, and reading them should never itself trigger a re-render.
  const accessRef = useRef<string | null>(null);
  const refreshRef = useRef<string | null>(null);

  const signOutLocally = useCallback(async () => {
    accessRef.current = null;
    refreshRef.current = null;
    await tokenStorage.clear();
    setUser(null);
    setBusinesses([]);
    setStatus('signedOut');
  }, []);

  // Attaches the current access token, retries exactly once after a refresh on a 401, and signs the
  // device out locally if that retry also fails — any authenticated call in the app goes through
  // this, not just /me.
  const authedFetch = useCallback(
    async function authedFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
      if (!accessRef.current) {
        throw new ApiError('server', 'Not signed in.');
      }
      try {
        return await api<T>(path, { ...options, token: accessRef.current });
      } catch (err) {
        if (err instanceof ApiError && err.status === 401 && refreshRef.current) {
          try {
            const pair = await refreshApi(refreshRef.current);
            accessRef.current = pair.access;
            refreshRef.current = pair.refresh;
            await tokenStorage.save(pair.access, pair.refresh);
            return await api<T>(path, { ...options, token: accessRef.current });
          } catch (refreshErr) {
            await signOutLocally();
            throw refreshErr;
          }
        }
        throw err;
      }
    },
    [signOutLocally],
  );

  const refreshMe = useCallback(async (): Promise<MeResponse> => {
    const response = await authedFetch<MeResponse>('/me/');
    setUser(response.user);
    setBusinesses(response.businesses);
    return response;
  }, [authedFetch]);

  const bootstrap = useCallback(async () => {
    setStatus('bootstrapping');
    const stored = await tokenStorage.load();
    if (!stored.access || !stored.refresh) {
      setStatus('signedOut');
      return;
    }
    accessRef.current = stored.access;
    refreshRef.current = stored.refresh;
    try {
      await refreshMe();
      setStatus('signedIn');
    } catch (err) {
      if (err instanceof ApiError && (err.kind === 'network' || err.kind === 'timeout')) {
        // Stored tokens are left alone — this isn't "signed out", just "couldn't check right now".
        setStatus('offline');
      } else {
        await signOutLocally();
      }
    }
  }, [refreshMe, signOutLocally]);

  useEffect(() => {
    bootstrap();
    // Runs once, at app start, regardless of later identity changes of the callbacks below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(
    async (mobile: string, secret: string): Promise<MeResponse> => {
      const pair = await loginApi(mobile, secret);
      accessRef.current = pair.access;
      refreshRef.current = pair.refresh;
      const response = await authedFetch<MeResponse>('/me/');
      await tokenStorage.save(pair.access, pair.refresh);
      setUser(response.user);
      setBusinesses(response.businesses);
      setStatus('signedIn');
      return response;
    },
    [authedFetch],
  );

  const logout = useCallback(async () => {
    const refreshToken = refreshRef.current;
    if (refreshToken) {
      try {
        await logoutApi(refreshToken);
      } catch {
        // Sign out locally either way — a refresh token that's already expired or blacklisted
        // still means this device is done being signed in.
      }
    }
    await signOutLocally();
  }, [signOutLocally]);

  const value = useMemo(
    () => ({
      status,
      user,
      businesses,
      login,
      logout,
      authedFetch,
      refreshMe,
      retryBootstrap: bootstrap,
    }),
    [status, user, businesses, login, logout, authedFetch, refreshMe, bootstrap],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside an AuthProvider');
  }
  return context;
}
