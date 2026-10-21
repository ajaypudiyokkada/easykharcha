/**
 * A thin fetch wrapper. It knows three things the rest of the app shouldn't have to: where the API
 * lives, how long to wait before giving up, and how to turn whatever went wrong into one typed shape.
 */

const TIMEOUT_MS = 10_000;

// On web, falls back to whatever host the page itself was loaded from (so opening the app at a LAN
// IP — e.g. http://192.168.1.5:8081, printed by `npm run dev` — talks to the backend at that same
// IP, with nothing hardcoded) rather than always 127.0.0.1, which from a phone means "this phone",
// not the dev machine. Native has no `window`, so it keeps the previous hardcoded default.
function defaultApiUrl(): string {
  if (typeof window !== 'undefined' && window.location?.hostname) {
    return `http://${window.location.hostname}:8000/api/v1`;
  }
  return 'http://127.0.0.1:8000/api/v1';
}

export const API_URL: string = process.env.EXPO_PUBLIC_API_URL ?? defaultApiUrl();

export type ApiErrorKind = 'network' | 'timeout' | 'server' | 'offline';

export type RowError = { row: number; field: string; message: string };

/** Present only on businesses/'s items_decision_needed (409) — see
 * businesses/exceptions.py's ItemsDecisionNeeded. */
export type ItemsSummary = {
  stock_items: string[];
  sell_items: string[];
  total_count: number;
};

export class ApiError extends Error {
  kind: ApiErrorKind;
  status?: number;
  code?: string;
  /** Present only for bulk-save endpoints that rejected specific rows — see stock/exceptions.py's
   * BulkValidationError. */
  rowErrors?: RowError[];
  /** Present only for counts/'s needs_confirmation (409) — the stock item ids whose typed value
   * looks unusual. Never a number, by design — see counts/exceptions.py's NeedsConfirmation. */
  itemIds?: number[];
  itemsSummary?: ItemsSummary;

  constructor(
    kind: ApiErrorKind,
    message: string,
    status?: number,
    code?: string,
    rowErrors?: RowError[],
    itemIds?: number[],
    itemsSummary?: ItemsSummary,
  ) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.code = code;
    this.rowErrors = rowErrors;
    this.itemIds = itemIds;
    this.itemsSummary = itemsSummary;
  }
}

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** A `FormData` body (e.g. a file upload) is sent as-is, with no `Content-Type` set — the browser
   * fills in the multipart boundary itself. Anything else is JSON-encoded. */
  body?: unknown;
  /** Sent as `Authorization: Bearer <token>` when present. */
  token?: string;
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
  const method = options.method ?? 'GET';
  // Writes are blocked before a request is even attempted while offline — reads are still allowed
  // through (and fail, if they fail, the ordinary network/timeout way below) so a screen backed by
  // already-cached data can keep working. `navigator.onLine` is web-only; it's simply absent on
  // native, so this never fires there.
  if (
    method !== 'GET' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.onLine === 'boolean' &&
    !navigator.onLine
  ) {
    throw new ApiError('offline', "You're offline. Try again when you're back online.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(isFormData ? null : { 'Content-Type': 'application/json' }),
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : null),
      },
      body:
        options.body === undefined
          ? undefined
          : isFormData
            ? (options.body as FormData)
            : JSON.stringify(options.body),
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
    const shaped = body as {
      error?: { code?: string; message?: string };
      row_errors?: RowError[];
      item_ids?: number[];
      items_summary?: ItemsSummary;
    } | null;
    const message = shaped?.error?.message ?? `The server returned an error (${response.status}).`;
    throw new ApiError(
      'server',
      message,
      response.status,
      shaped?.error?.code,
      shaped?.row_errors,
      shaped?.item_ids,
      shaped?.items_summary,
    );
  }

  return body as T;
}
