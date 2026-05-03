/**
 * OAuth pass-through helpers. LeanMCP does not validate tokens — that's the
 * upstream's job. We only:
 *
 *   1. forward the inbound `Authorization` header onto upstream HTTP calls
 *      when `auth: passthrough` is configured (handled in `UpstreamManager`),
 *   2. peek at the JWT payload (without verifying) to extract identity
 *      claims for audit logging.
 *
 * If you need true verification, run a downstream API gateway in front of
 * LeanMCP — that's already the recommended deployment pattern in the 2026
 * MCP roadmap.
 */

export interface IdentityClaims {
  sub?: string;
  iss?: string;
  aud?: string | string[];
  scope?: string;
  client_id?: string;
}

/**
 * Best-effort decode of a `Bearer <jwt>` header. Returns `undefined` for any
 * non-JWT or malformed token. Does NOT verify the signature.
 */
export function unsafeDecodeBearer(header: string | undefined): IdentityClaims | undefined {
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return undefined;
  const token = match[1]!;
  const parts = token.split(".");
  if (parts.length < 2) return undefined;
  try {
    const payload = JSON.parse(base64UrlDecode(parts[1]!)) as Record<string, unknown>;
    const claims: IdentityClaims = {};
    if (typeof payload.sub === "string") claims.sub = payload.sub;
    if (typeof payload.iss === "string") claims.iss = payload.iss;
    if (typeof payload.aud === "string" || Array.isArray(payload.aud)) {
      claims.aud = payload.aud as string | string[];
    }
    if (typeof payload.scope === "string") claims.scope = payload.scope;
    if (typeof payload.client_id === "string") claims.client_id = payload.client_id;
    return claims;
  } catch {
    return undefined;
  }
}

function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    Math.ceil(input.length / 4) * 4,
    "=",
  );
  return Buffer.from(padded, "base64").toString("utf8");
}
