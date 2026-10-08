/**
 * The HTTP layer.
 *
 * Deliberately thin: the server owns every formula and every permission decision (non-negotiables #2
 * and #5), so this file's whole job is attaching the token, refreshing it once on a 401, and turning
 * the API's single error shape into an Error the screens can show.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

const ACCESS_KEY = 'ek.access';
const REFRESH_KEY = 'ek.refresh';

export const API_URL: string =
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ??
  'http://127.0.0.1:8000/api';

export class ApiError extends Error {
  code: string;
  status: number;
  detail: Record<string, unknown>;

  constructor(message: string, code: string, status: number, detail: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

let accessToken: string | null = null;
let refreshToken: string | null = null;
let onUnauthenticated: (() => void) | null = null;

export function setUnauthenticatedHandler(handler: () => void) {
  onUnauthenticated = handler;
}

export async function loadTokens() {
  const [[, access], [, refresh]] = await AsyncStorage.multiGet([ACCESS_KEY, REFRESH_KEY]);
  accessToken = access;
  refreshToken = refresh;
  return { accessToken, refreshToken };
}

export async function saveTokens(access: string, refresh: string) {
  accessToken = access;
  refreshToken = refresh;
  await AsyncStorage.multiSet([
    [ACCESS_KEY, access],
    [REFRESH_KEY, refresh],
  ]);
}

export async function clearTokens() {
  accessToken = null;
  refreshToken = null;
  await AsyncStorage.multiRemove([ACCESS_KEY, REFRESH_KEY]);
}

export function hasToken() {
  return accessToken !== null;
}

type Options = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** FormData for uploads — Content-Type is left to the runtime so the boundary is correct. */
  form?: FormData;
  retryOn401?: boolean;
};

async function parseError(response: Response): Promise<ApiError> {
  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    // Non-JSON error (nginx 502, Django debug page). Report the status honestly rather than guessing.
    return new ApiError(`Request failed (${response.status}).`, 'http_error', response.status);
  }
  const error = payload?.error;
  if (error) {
    return new ApiError(error.message ?? 'Request failed.', error.code ?? 'error', response.status, error.detail ?? {});
  }
  if (payload?.detail) {
    return new ApiError(String(payload.detail), 'error', response.status);
  }
  return new ApiError('Request failed.', 'error', response.status, payload ?? {});
}

async function refresh(): Promise<boolean> {
  if (!refreshToken) return false;
  const response = await fetch(`${API_URL}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh: refreshToken }),
  });
  if (!response.ok) return false;
  const data = await response.json();
  // Rotation is on server-side, so a refresh may return a new refresh token too.
  await saveTokens(data.access, data.refresh ?? refreshToken);
  return true;
}

export async function api<T = any>(path: string, options: Options = {}): Promise<T> {
  const { method = 'GET', body, form, retryOn401 = true } = options;

  const headers: Record<string, string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });

  if (response.status === 401 && retryOn401 && refreshToken) {
    if (await refresh()) {
      return api<T>(path, { ...options, retryOn401: false });
    }
    await clearTokens();
    onUnauthenticated?.();
    throw new ApiError('Your session has ended. Sign in again.', 'session_expired', 401);
  }

  if (response.status === 401) {
    await clearTokens();
    onUnauthenticated?.();
  }

  if (!response.ok) throw await parseError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const get = <T = any>(path: string) => api<T>(path);
export const post = <T = any>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body });
export const patch = <T = any>(path: string, body?: unknown) => api<T>(path, { method: 'PATCH', body });
export const del = <T = any>(path: string) => api<T>(path, { method: 'DELETE' });
export const upload = <T = any>(path: string, form: FormData) => api<T>(path, { method: 'POST', form });
