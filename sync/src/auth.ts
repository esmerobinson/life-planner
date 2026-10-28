// Token checking. The server never sees the passphrase and never stores the token:
// it holds only SYNC_TOKEN_HASH = hex(SHA-256(token)) and compares hashes in constant time.

/** Longest Authorization token we bother hashing (real tokens are 64 hex chars). */
const MAX_TOKEN_LENGTH = 256;

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  let out = "";
  for (const byte of new Uint8Array(digest)) out += byte.toString(16).padStart(2, "0");
  return out;
}

/**
 * Compares two strings without an early exit, so the time taken does not reveal
 * how many leading characters match. A length mismatch is folded into the result
 * (both inputs here are fixed-length hashes, so length is not secret anyway).
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i++) {
    diff |= (a.charCodeAt(i) | 0) ^ (b.charCodeAt(i) | 0);
  }
  return diff === 0;
}

/** Extracts the token from `Bearer <token>`; null for anything else. */
export function parseBearer(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer ([\x21-\x7e]+)$/i.exec(header);
  if (!match) return null;
  const token = match[1]!;
  return token.length <= MAX_TOKEN_LENGTH ? token : null;
}

/** Normalises the configured secret; null when it is missing or not a SHA-256 hex digest. */
export function configuredHash(secret: string | undefined): string | null {
  if (typeof secret !== "string") return null;
  const hash = secret.trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(hash) ? hash : null;
}

/** True when the request presents the token whose hash is `expectedHash`. */
export async function presentsValidToken(request: Request, expectedHash: string): Promise<boolean> {
  const token = parseBearer(request.headers.get("Authorization"));
  // Hash something even when the header is missing, so both paths do the same work.
  const presentedHash = await sha256Hex(token ?? "");
  return token !== null && constantTimeEqual(presentedHash, expectedHash);
}
