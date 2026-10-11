import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  login as loginApi,
  logout as logoutApi,
  me as meApi,
  refresh as refreshApi,
  type AuthUser,
} from '../api/auth';
import { ApiError } from '../api/client';
import { tokenStorage } from './storage';

export type AuthStatus = 'bootstrapping' | 'signedOut' | 'signedIn';

type AuthContextValue = {
  status: AuthStatus;
  user: AuthUser | null;
  login: (mobile: string, secret: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('bootstrapping');
  const [user, setUser] = useState<AuthUser | null>(null);
  // The tokens that actually go on the wire. Refs, not state — they're read inside callbacks that
  // must never see a stale closure, and reading them should never itself trigger a re-render.
  const accessRef = useRef<string | null>(null);
  const refreshRef = useRef<string | null>(null);

  const signOutLocally = useCallback(async () => {
    accessRef.current = null;
    refreshRef.current = null;
    await tokenStorage.clear();
    setUser(null);
    setStatus('signedOut');
  }, []);

  // GET /me, refreshing the access token exactly once if it's expired. Any failure past that one
  // retry (expired refresh token, blacklisted, network down) propagates to the caller.
  const fetchMeWithRefresh = useCallback(async (): Promise<AuthUser> => {
    if (!accessRef.current) {
      throw new ApiError('server', 'Not signed in.');
    }
    try {
      const response = await meApi(accessRef.current);
      return response.user;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401 && refreshRef.current) {
        const pair = await refreshApi(refreshRef.current);
        accessRef.current = pair.access;
        refreshRef.current = pair.refresh;
        await tokenStorage.save(pair.access, pair.refresh);
        const response = await meApi(accessRef.current);
        return response.user;
      }
      throw err;
    }
  }, []);

  useEffect(() => {
    (async () => {
      const stored = await tokenStorage.load();
      if (!stored.access || !stored.refresh) {
        setStatus('signedOut');
        return;
      }
      accessRef.current = stored.access;
      refreshRef.current = stored.refresh;
      try {
        const freshUser = await fetchMeWithRefresh();
        setUser(freshUser);
        setStatus('signedIn');
      } catch {
        await signOutLocally();
      }
    })();
    // Runs once, at app start, regardless of later identity changes of the callbacks below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(
    async (mobile: string, secret: string) => {
      const pair = await loginApi(mobile, secret);
      accessRef.current = pair.access;
      refreshRef.current = pair.refresh;
      const freshUser = await fetchMeWithRefresh();
      await tokenStorage.save(pair.access, pair.refresh);
      setUser(freshUser);
      setStatus('signedIn');
    },
    [fetchMeWithRefresh],
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

  const value = useMemo(() => ({ status, user, login, logout }), [status, user, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside an AuthProvider');
  }
  return context;
}
