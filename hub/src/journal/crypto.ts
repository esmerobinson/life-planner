// The journal's end-to-end encryption (journal brief §3). Only WebCrypto, so it runs in
// browsers, WKWebView and Node (tests).
//
//   key = PBKDF2-HMAC-SHA256(UTF-8(NFC(sync passphrase)), salt "esmeworld-journal-v1",
//         200,000 iterations) -> AES-GCM 256-bit, imported NON-extractable.
//
// The key never leaves WebCrypto: it is stored on the device as a CryptoKey object (IndexedDB
// can hold one) and can encrypt and decrypt but never be read out. The passphrase is never
// stored or logged. Each sealed value carries a fresh random 96-bit IV; the AES-GCM tag makes
// any change to the ciphertext (or to the row it is bound to, see `aad`) fail to open.

export const JOURNAL_SALT = "esmeworld-journal-v1";
export const JOURNAL_ITERATIONS = 200_000;
/** AES-GCM IV length in bytes (the recommended 96 bits). */
export const IV_BYTES = 12;

/** A sealed value as stored: base64 IV and base64 ciphertext (with the GCM tag). */
export interface Sealed {
  iv: string;
  ct: string;
}

/** Derives the journal key from the sync passphrase. Non-extractable; encrypt/decrypt only. */
export async function deriveJournalKey(passphrase: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const base = await crypto.subtle.importKey("raw", encoder.encode(passphrase.normalize("NFC")), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(JOURNAL_SALT), iterations: JOURNAL_ITERATIONS },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Base64 of bytes (no prefix). */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(binary);
}

/** Bytes from base64. Throws on text that is not base64. */
export function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

const utf8 = (s: string) => new TextEncoder().encode(s);

/**
 * Encrypts bytes. `aad` binds the ciphertext to where it is stored (e.g. the row id), so a
 * sealed value moved to another row does not open there.
 */
export async function sealBytes(key: CryptoKey, bytes: Uint8Array, aad: string, iv?: Uint8Array): Promise<Sealed> {
  const nonce = iv ?? crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce as BufferSource, additionalData: utf8(aad) as BufferSource },
    key,
    bytes as BufferSource,
  );
  return { iv: toBase64(nonce), ct: toBase64(new Uint8Array(ct)) };
}

/** Decrypts bytes. Throws when the key is wrong or anything was changed. */
export async function openBytes(key: CryptoKey, sealed: Sealed, aad: string): Promise<Uint8Array> {
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(sealed.iv) as BufferSource, additionalData: utf8(aad) as BufferSource },
    key,
    fromBase64(sealed.ct) as BufferSource,
  );
  return new Uint8Array(pt);
}

/** Encrypts a JSON value (the plaintext exists only in memory). */
export async function sealJson(key: CryptoKey, value: unknown, aad: string): Promise<Sealed> {
  return sealBytes(key, utf8(JSON.stringify(value)), aad);
}

/** Decrypts a JSON value. Throws when the key is wrong, anything was changed, or it is not JSON. */
export async function openJson<T = unknown>(key: CryptoKey, sealed: Sealed, aad: string): Promise<T> {
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await openBytes(key, sealed, aad))) as T;
}

/** What a journal row's ciphertext is bound to (its id, which carries its kind and day). */
export const journalAad = (id: string) => `journal|${id}`;
/** What a journal photo's ciphertext is bound to (its file id). */
export const fileAad = (id: string) => `file|${id}`;
