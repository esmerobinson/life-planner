// Sync token derivation, shared by the server tests and (later) the client app.
// Uses only WebCrypto (globalThis.crypto.subtle) so it runs unchanged in browsers,
// WKWebView, Cloudflare Workers and Node.
//
// Contract (docs/superpowers/specs/2026-10-28-sync-api.md):
//   token = hex(PBKDF2-HMAC-SHA256(passphrase, salt "esmeworld-sync-v1", 200000 iterations, 32 bytes))
//   SYNC_TOKEN_HASH = hex(SHA-256(token))   (SHA-256 of the token's lowercase hex string)
//
// The passphrase is encoded as UTF-8 exactly as given (no Unicode normalization).

export const TOKEN_SALT = "esmeworld-sync-v1";
export const TOKEN_ITERATIONS = 200_000;
export const TOKEN_BYTES = 32;

function toHex(buffer: ArrayBuffer): string {
  let out = "";
  for (const byte of new Uint8Array(buffer)) out += byte.toString(16).padStart(2, "0");
  return out;
}

export async function deriveToken(passphrase: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(passphrase), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(TOKEN_SALT), iterations: TOKEN_ITERATIONS },
    key,
    TOKEN_BYTES * 8,
  );
  return toHex(bits);
}

export async function hashToken(token: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
}
