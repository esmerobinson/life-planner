// "Pair a device by QR code": the text a pairing code carries.
//
//   esmeworld-pair:v1:<passphrase>
//
// The passphrase goes in as it is (no trimming, no normalising: the sync token and the journal
// key normalise it themselves, exactly as when it is typed). This text is a secret: it is
// never stored, logged or put in a URL; it exists only in memory while the code is shown or
// just after it is scanned or pasted.

export const PAIRING_PREFIX = "esmeworld-pair:v1:";

/** The text to put in the QR code for `passphrase`. */
export function pairingText(passphrase: string): string {
  return PAIRING_PREFIX + passphrase;
}

/**
 * The passphrase from a scanned or pasted pairing code, or null when it isn't one.
 * Whitespace before the prefix and line breaks after the passphrase are dropped (a paste often
 * carries them); spaces after the prefix are kept, since they may be part of the passphrase.
 */
export function parsePairingText(text: string): string | null {
  const t = text.replace(/^\s+/, "").replace(/[\r\n]+$/, "");
  if (!t.startsWith(PAIRING_PREFIX)) return null;
  const passphrase = t.slice(PAIRING_PREFIX.length);
  return passphrase.length > 0 && passphrase.trim().length > 0 ? passphrase : null;
}
