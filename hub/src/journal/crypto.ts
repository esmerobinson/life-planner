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

/** The text the key fingerprint is an HMAC of. */
export const FINGERPRINT_INPUT = "esmeworld-journal-fp";

/** A journal key with its fingerprint (stored in clear on every row it seals). */
export interface JournalKey {
  key: CryptoKey;
  /**
   * The same derived bits as a non-extractable HMAC-SHA256 key (sign only): makes the
   * fingerprint and the opaque prompt keys in answer row ids.
   */
  mac: CryptoKey;
  /** First 8 bytes of HMAC-SHA256(key bits, "esmeworld-journal-fp"), as 16 hex characters. */
  fp: string;
}

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

/**
 * An opaque stand-in for a prompt id in a row id (so ids in clear don't say which question
 * was asked): the first 12 hex characters of HMAC-SHA256(key bits, promptId).
 */
export async function promptKey(jk: JournalKey, promptId: string): Promise<string> {
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", jk.mac, new TextEncoder().encode(promptId)));
  return hex(sig.subarray(0, 6));
}

async function pbkdf2Base(passphrase: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase.normalize("NFC")), "PBKDF2", false, [
    "deriveKey",
  ]);
}

const pbkdf2 = () => ({
  name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(JOURNAL_SALT), iterations: JOURNAL_ITERATIONS,
});

/** Derives the journal key from the sync passphrase. Non-extractable; encrypt/decrypt only. */
export async function deriveJournalKey(passphrase: string): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(pbkdf2(), await pbkdf2Base(passphrase), { name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/**
 * The journal key, its HMAC twin and its fingerprint. The HMAC key is the same derived bits
 * (derived again as a non-extractable HMAC key), so the fingerprint names the key without
 * revealing it; guessing a passphrase from it costs the full PBKDF2.
 */
export async function deriveJournalKeyAndFp(passphrase: string): Promise<JournalKey> {
  const base = await pbkdf2Base(passphrase);
  const key = await crypto.subtle.deriveKey(pbkdf2(), base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const mac = await crypto.subtle.deriveKey(pbkdf2(), base, { name: "HMAC", hash: "SHA-256", length: 256 }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", mac, new TextEncoder().encode(FINGERPRINT_INPUT)));
  return { key, mac, fp: hex(sig.subarray(0, 8)) };
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
export async function sealBytes(key: CryptoKey, bytes: Uint8Array, aad: string): Promise<Sealed> {
  // Always a fresh random IV: there is deliberately no way to pass one in.
  const nonce = crypto.getRandomValues(new Uint8Array(IV_BYTES));
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
