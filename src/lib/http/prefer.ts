/**
 * RFC 7240 `Prefer` header reading. A preference is the token before its
 * first `;` (parameters follow it), several preferences are comma-separated,
 * and a token without `=` stands alone (`respond-async`) while one with `=`
 * carries a value (`return=representation`). Compared case-insensitively.
 */
export function hasPreference(request: Request, preference: string): boolean {
  const header = request.headers.get("prefer");
  if (!header) return false;
  const wanted = preference.toLowerCase();
  return header.split(",").some(
    (entry) =>
      entry
        .split(";")[0]
        ?.trim()
        .toLowerCase()
        .replace(/\s*=\s*/, "=") === wanted,
  );
}

/** `Prefer: return=representation`: answer a write with what it changed. */
export const RETURN_REPRESENTATION = "return=representation";
