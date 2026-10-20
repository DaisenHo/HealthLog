/**
 * RFC 9728 — OAuth Protected Resource Metadata for the `/mcp` resource.
 *
 * Public, unauthenticated discovery (added to the proxy `.well-known` allowlist).
 * A remote MCP client reads this after the `/mcp` 401 to learn which
 * Authorization Server backs the resource and what scopes it accepts. The
 * `resource` value is the canonical `/mcp` URI and MUST match the URL the user
 * pasted into Claude.ai / ChatGPT.
 */
import { protectedResourceMetadata } from "@/lib/mcp/oauth/metadata";
import { isMcpOriginConfigured } from "@/lib/mcp/oauth/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request): Response {
  // Fail closed when no origin is pinned; never derive the `resource` /
  // authorization-server URLs from the attacker-influenceable Host header.
  if (!isMcpOriginConfigured()) {
    return Response.json(
      { error: "not_found" },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }
  return Response.json(protectedResourceMetadata(request.url), {
    // `private, no-store`: the document is host-derived, so a shared cache
    // keyed on path (ignoring Host) must never serve it cross-tenant.
    headers: { "Cache-Control": "private, no-store" },
  });
}
