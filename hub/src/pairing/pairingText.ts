// "Pair a device by QR code": the text a pairing code carries. Two versions, both read.
//
//   v1  esmeworld-pair:v1:<passphrase>
//   v2  esmeworld-pair:v2:<token>.<secret>.<address>          (2026-11-17, no passphrase)
//
// v1 carries the passphrase as it is (no trimming, no normalising: the sync token and the
// journal key normalise it themselves, exactly as when it is typed). A device can only show it
// while it has the passphrase in memory (typed in that page visit).
//
// v2 carries what a device that already syncs keeps anyway, so it can be shown at any time
// without typing: the sync TOKEN (32 bytes, the PBKDF2 of the passphrase the server checks),
// the journal SECRET S (32 bytes, the bits the journal key is made of; empty when this device
// has no copy of it) and the sync ADDRESS (empty for the usual one). Token and secret are
// base64url (43 characters each), so the whole text stays small enough for a QR code a phone
// reads off a screen. It never carries the passphrase, and nothing in it can be turned back into it.
//
// Either text is a secret: it is never stored, logged or put in a URL; it exists only in
// memory while the code is shown or just after it is scanned or pasted.

export const PAIRING_PREFIX = "esmeworld-pair:v1:";
export const PAIRING_V2_PREFIX = "esmeworld-pair:v2:";
/** Longest passphrase a pairing code may carry (security review: bounded work and QR size). */
export const MAX_PAIRING_PASSPHRASE = 1024;
/** Longest sync address a v2 code may carry (keeps the QR code readable). */
export const MAX_PAIRING_ADDRESS = 256;

const TOKEN_BYTES = 32;
const SECRET_BYTES = 32;

/** What a pairing code holds. */
export type PairingPayload =
  | { v: 1; passphrase: string }
  | {
      v: 2;
      /** The sync token, as stored (64 lowercase hex characters). */
      token: string;
      /** The journal secret S, or null when the showing device had none to give. */
      secret: Uint8Array | null;
      /** The sync address, or null for the usual one. */
      serverUrl: string | null;
    };

/** The text to put in the QR code for `passphrase`. */
export function pairingText(passphrase: string): string {
  return PAIRING_PREFIX + passphrase;
}

const b64url = (bytes: Uint8Array) => {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

function fromB64url(text: string, bytes: number): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length !== Math.ceil((bytes * 4) / 3)) return null;
  try {
    const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4));
    if (bin.length !== bytes) return null;
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

const hexToBytes = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));
const bytesToHex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

/**
 * The v2 text for a device that syncs: its token (hex, as stored), its copy of the journal
 * secret (or null) and its sync address (null: the usual one). Throws for a malformed token.
 */
export function pairingTextV2(p: { token: string; secret: Uint8Array | null; serverUrl: string | null }): string {
  if (!/^[0-9a-f]{64}$/.test(p.token)) throw new Error("not a sync token");
  if (p.secret && p.secret.length !== SECRET_BYTES) throw new Error("not a journal secret");
  return `${PAIRING_V2_PREFIX}${b64url(hexToBytes(p.token))}.${p.secret ? b64url(p.secret) : ""}.${p.serverUrl ?? ""}`;
}

/** Whitespace before the code and line breaks after it are dropped (a paste often carries them). */
const tidy = (text: string) => text.replace(/^\s+/, "").replace(/[\r\n]+$/, "");

/**
 * The passphrase from a scanned or pasted v1 pairing code, or null when it isn't one.
 * Spaces after the prefix are kept, since they may be part of the passphrase.
 */
export function parsePairingText(text: string): string | null {
  const t = tidy(text);
  if (!t.startsWith(PAIRING_PREFIX)) return null;
  const passphrase = t.slice(PAIRING_PREFIX.length);
  if (passphrase.length > MAX_PAIRING_PASSPHRASE) return null;
  return passphrase.length > 0 && passphrase.trim().length > 0 ? passphrase : null;
}

/** What a scanned or pasted pairing code (either version) holds, or null when it isn't one. */
export function parsePairing(text: string): PairingPayload | null {
  const passphrase = parsePairingText(text);
  if (passphrase !== null) return { v: 1, passphrase };
  const t = tidy(text);
  if (!t.startsWith(PAIRING_V2_PREFIX)) return null;
  const parts = t.slice(PAIRING_V2_PREFIX.length).split(".");
  if (parts.length < 3) return null;
  const [tok, sec] = parts as [string, string];
  const address = parts.slice(2).join("."); // an address has dots of its own
  const token = fromB64url(tok, TOKEN_BYTES);
  const secret = sec === "" ? null : fromB64url(sec, SECRET_BYTES);
  if (!token || (sec !== "" && !secret)) return null;
  if (address.length > MAX_PAIRING_ADDRESS || /\s/.test(address)) return null;
  return { v: 2, token: bytesToHex(token), secret, serverUrl: address === "" ? null : address };
}
