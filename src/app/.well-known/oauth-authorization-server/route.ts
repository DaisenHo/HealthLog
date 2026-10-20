/**
 * RFC 8414 — OAuth Authorization Server Metadata for the built-in bridge AS.
 *
 * Public, unauthenticated discovery (added to the proxy `.well-known` allowlist).
 * Advertises the authorize / token / register endpoints, `S256`-only PKCE, and
 * CIMD support (`client_id_metadata_document_supported: true` + `none` auth) so
 * Claude.ai / ChatGPT can self-register and complete the OAuth 2.1 + PKCE flow.
 */
import { authorizationServerMetadata } from "@/lib/mcp/oauth/metadata";
import { isMcpOriginConfigured } from "@/lib/mcp/oauth/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request): Response {
  // Fail closed when no origin is pinned; never derive the issuer /
  // endpoint URLs from the attacker-influenceable Host header.
  if (!isMcpOriginConfigured()) {
    return Response.json(
      { error: "not_found" },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }
  return Response.json(authorizationServerMetadata(request.url), {
    // `private, no-store`: the document is host-derived, so a shared cache
    // keyed on path (ignoring Host) must never serve it cross-tenant.
    headers: { "Cache-Control": "private, no-store" },
  });
}
