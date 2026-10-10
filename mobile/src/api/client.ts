/**
 * A thin fetch wrapper. It knows three things the rest of the app shouldn't have to: where the API
 * lives, how long to wait before giving up, and how to turn whatever went wrong into one typed shape.
 */

const DEFAULT_API_URL = 'http://127.0.0.1:8000/api/v1';
const TIMEOUT_MS = 10_000;

export const API_URL: string = process.env.EXPO_PUBLIC_API_URL ?? DEFAULT_API_URL;

export type ApiErrorKind = 'network' | 'timeout' | 'server';

export class ApiError extends Error {
  kind: ApiErrorKind;
  status?: number;
  code?: string;

  constructor(kind: ApiErrorKind, message: string, status?: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
};

/**
 * Calls the API and returns the parsed JSON body, or throws an ApiError.
 *
 * Three distinct failure shapes, because the screen needs to say something different for each: the
 * request never reached a server at all (network), it reached one but took too long (timeout), or a
 * server answered with an error it described itself (server — using the backend's own
 * {"error": {"code", "message"}} shape when present).
 */
export async function api<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: options.method ?? 'GET',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
  } catch {
    if (controller.signal.aborted) {
      throw new ApiError('timeout', "Can't reach the server. Is the backend running?");
    }
    throw new ApiError('network', "Can't reach the server. Is the backend running?");
  } finally {
    clearTimeout(timeout);
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // A non-JSON body (e.g. a proxy error page) still needs a message below.
  }

  if (!response.ok) {
    const shaped = body as { error?: { code?: string; message?: string } } | null;
    const message = shaped?.error?.message ?? `The server returned an error (${response.status}).`;
    throw new ApiError('server', message, response.status, shaped?.error?.code);
  }

  return body as T;
}
