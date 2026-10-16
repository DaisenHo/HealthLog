/**
 * Error ids: the short handle a person reads out when something failed.
 *
 * Every API error envelope carries the request id (`meta.requestId`, and the
 * `x-request-id` header). The web shows its first 8 characters with a copy
 * button on a server failure (5xx) or an unexpected one, and the operator
 * finds the event with it under Admin, App logs. A render failure that never
 * reached the API has no request id; for one the server rendered, Next's
 * `digest` is the handle the server log prints beside the stack.
 *
 * The last few ids of this browser session are kept for the "Copy support
 * info" text in Settings, About, so a person filing an issue later still has
 * them. Session storage, not local: they belong to this visit.
 *
 * Every error display goes through this module (toasts through
 * `showErrorToast`, boundaries through `ErrorIdLine`); the guard is
 * `src/__tests__/error-display-helper-guard.test.ts`.
 */

/** How many characters of the id are shown. */
export const ERROR_ID_LENGTH = 8;

/** How many ids the session keeps for the support info. */
export const RECENT_ERROR_IDS_MAX = 5;

const STORAGE_KEY = "healthlog-recent-error-ids";

let memory: string[] = [];

/** The displayed form of an id. */
export function shortErrorId(id: string): string {
  return id.slice(0, ERROR_ID_LENGTH);
}

function readStored(): string[] {
  if (typeof window === "undefined") return memory;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (
      Array.isArray(parsed) &&
      parsed.every((v) => typeof v === "string" && v.length <= 64)
    ) {
      return parsed.slice(0, RECENT_ERROR_IDS_MAX);
    }
  } catch {
    /* storage blocked or malformed: memory is the fallback */
  }
  return memory;
}

/** Remember an id for this session's support info, newest first. */
export function recordErrorId(id: string): void {
  if (!id) return;
  const next = [id, ...readStored().filter((v) => v !== id)].slice(
    0,
    RECENT_ERROR_IDS_MAX,
  );
  memory = next;
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* the in-memory copy still serves this page */
  }
}

/** The ids this session saw, newest first, at most `RECENT_ERROR_IDS_MAX`. */
export function recentErrorIds(): string[] {
  return [...readStored()];
}

/** Test helper. */
export function _resetRecentErrorIdsForTests(): void {
  memory = [];
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to clear */
  }
}

interface ApiLikeError {
  status: number;
  requestId: string | null;
}

function isApiLike(error: unknown): error is ApiLikeError {
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { status?: unknown }).status === "number" &&
    "requestId" in error
  );
}

/**
 * The id to show for a failure, or null when there is none worth showing.
 *
 *   - An API failure shows its request id when the server failed (5xx). A
 *     4xx is an answer the person can act on and its message says how,
 *     unless it reached an error boundary (`unexpected`), where nothing is
 *     an expected answer any more.
 *   - Any other error is unexpected; it shows Next's `digest` when the
 *     server rendered it, and nothing when there is no id to find it by.
 */
export function errorIdOf(
  error: unknown,
  options: { unexpected?: boolean } = {},
): string | null {
  // A raw `Response` from `apiFetchRaw`, for the call sites that branch on
  // `res.ok` themselves: the id rides the header.
  if (typeof Response !== "undefined" && error instanceof Response) {
    const id = error.headers.get("x-request-id");
    const shown = options.unexpected === true || error.status >= 500;
    return shown && id ? id : null;
  }
  if (isApiLike(error)) {
    // Inside an error boundary every failure is unexpected, a 4xx included.
    const shown = options.unexpected === true || error.status >= 500;
    return shown && error.requestId ? error.requestId : null;
  }
  if (typeof error === "object" && error !== null) {
    const digest = (error as { digest?: unknown }).digest;
    if (typeof digest === "string" && digest.length > 0) return digest;
  }
  return null;
}
