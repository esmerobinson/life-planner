// The v2 pairing code for THIS device (2026-11-17): made from what a device that syncs keeps
// anyway (its sync token, address and copy of the journal secret), so "Pair another device"
// needs no passphrase. Made only when asked (a tap), returned as text for the code on screen;
// never stored or logged. The secret's bytes are wiped once the text is made.

import type { HubDB } from "../data/db";
import { journalSecretForPairing } from "../journal/keyStore";
import { DEFAULT_SYNC_URL, getMeta } from "../sync/engine";
import { pairingTextV2 } from "./pairingText";

export interface DevicePairingCode {
  /** The pairing text (a secret: only for the code on screen). */
  text: string;
  /** Whether it carries the journal (false: sync only, the journal asks for the passphrase there). */
  journal: boolean;
}

/** The code for this device, or null when it has no sync token. */
export async function pairingCodeForDevice(db: HubDB): Promise<DevicePairingCode | null> {
  const token = await getMeta<string>(db, "token");
  if (typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token)) return null;
  const url = await getMeta<string>(db, "serverUrl");
  const serverUrl = typeof url === "string" && url !== "" && url !== DEFAULT_SYNC_URL ? url : null;
  const secret = (await journalSecretForPairing(db)) ?? null;
  try {
    return { text: pairingTextV2({ token, secret, serverUrl }), journal: secret !== null };
  } finally {
    secret?.fill(0);
  }
}
