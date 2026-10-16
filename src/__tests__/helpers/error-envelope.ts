/**
 * Error-envelope helpers for tests that compare whole response bodies.
 *
 * `apiHandler` stamps every error envelope with `meta.requestId`, a fresh id
 * per request. A test that proves two refusals are byte-identical (an
 * enumeration oracle check) compares everything else: the id is random, the
 * same for no two requests, and says nothing about the account.
 */

/** The body text with `meta.requestId` removed, `meta` dropped when empty. */
export function withoutRequestId(text: string): string {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return text;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return text;
  }
  const record = { ...(body as Record<string, unknown>) };
  const meta = record.meta;
  if (typeof meta === "object" && meta !== null && !Array.isArray(meta)) {
    const rest = { ...(meta as Record<string, unknown>) };
    delete rest.requestId;
    if (Object.keys(rest).length === 0) delete record.meta;
    else record.meta = rest;
  }
  return JSON.stringify(record);
}

/** A response's body text with `meta.requestId` removed. */
export async function bodyWithoutRequestId(res: Response): Promise<string> {
  return withoutRequestId(await res.text());
}
