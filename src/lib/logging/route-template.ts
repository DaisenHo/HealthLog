/**
 * The route template a request matched, for the wide event's `http.route`.
 *
 * `http.route` carried the concrete pathname, so `/api/medications/<cuid>`
 * was a fresh route for every medication: a dashboard grouping by route
 * counted thousands of one-request "routes" and could not answer the one
 * question the field exists for — which handler is slow, which one fails.
 * `http.path` keeps the concrete path; this field now names the handler.
 *
 * Next.js does not hand a route handler its template, but it does hand a
 * dynamic one its `params`, and every dynamic segment's value is in there.
 * So the template is recovered by putting each param's name back where its
 * value sits: `[id]` for a single segment, `[...path]` for a catch-all run.
 * Params are matched right to left, the order the segments appear in reverse,
 * so a value that happens to equal an earlier static segment (`/api/x/x`) is
 * placed on the dynamic segment rather than the static one.
 *
 * A static route has no params and its pathname already is its template. When
 * a value cannot be found (a malformed encoding, a placeholder request in a
 * test), the pathname is returned unchanged rather than a guess: redaction of
 * path secrets runs on this field either way (`setHttp` → `redactSecrets`), so
 * a fallback never carries a secret a template would have hidden.
 */

type Params = Record<string, unknown>;

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** Put param names back in place of their values. Pure, for tests. */
export function templatePath(pathname: string, params: Params): string {
  const segments = pathname.split("/");
  const decoded = segments.map(decodeSegment);
  const out: Array<string | null> = [...segments];
  // Index 0 is the empty string before the leading slash; never a param.
  let cursor = segments.length;

  for (const [key, value] of Object.entries(params).reverse()) {
    if (Array.isArray(value)) {
      const run = value.filter((v): v is string => typeof v === "string");
      if (run.length === 0) continue;
      for (let start = cursor - run.length; start >= 1; start--) {
        if (run.every((v, i) => decoded[start + i] === v)) {
          out[start] = `[...${key}]`;
          for (let i = 1; i < run.length; i++) out[start + i] = null;
          cursor = start;
          break;
        }
      }
    } else if (typeof value === "string" && value.length > 0) {
      for (let i = cursor - 1; i >= 1; i--) {
        if (decoded[i] === value) {
          out[i] = `[${key}]`;
          cursor = i;
          break;
        }
      }
    }
  }

  return out.filter((s): s is string => s !== null).join("/");
}

/**
 * The template for a request, from the route handler's second argument.
 * Awaits `params` (a Promise since Next.js 15; a plain object in some tests).
 */
export async function routeTemplateFor(
  pathname: string,
  context: unknown,
): Promise<string> {
  const raw =
    context && typeof context === "object"
      ? (context as { params?: unknown }).params
      : undefined;
  if (!raw) return pathname;
  let params: unknown;
  try {
    params = await raw;
  } catch {
    return pathname;
  }
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return pathname;
  }
  return templatePath(pathname, params as Params);
}
