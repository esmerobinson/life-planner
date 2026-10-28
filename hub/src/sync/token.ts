// Sync token derivation. Copied from the sync server's sync/shared/token.ts so both
// halves derive the same token; the fixed test vectors in token.test.ts are the server's.
// Uses only WebCrypto (globalThis.crypto.subtle), so it runs in browsers, WKWebView and Node.
//
// Contract (docs/superpowers/specs/2026-10-28-sync-api.md, v1.1):
//   token = hex(PBKDF2-HMAC-SHA256(UTF-8(NFC(passphrase)), salt "esmeworld-sync-v1", 200000 iterations, 32 bytes))
//
// v1.1: the passphrase is normalized to NFC first, so the same passphrase typed on a
// keyboard that produces decomposed accents (e.g. "a" + combining diaeresis) still
// gives the same token.

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
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(passphrase.normalize("NFC")),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(TOKEN_SALT), iterations: TOKEN_ITERATIONS },
    key,
    TOKEN_BYTES * 8,
  );
  return toHex(bits);
}

/** SHA-256 of the token's hex string (what the server stores). Used only by tests here. */
export async function hashToken(token: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
}
