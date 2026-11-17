// Whether this device may take a v2 pairing code (review C1, M3; 2026-11-17).
//
// A v2 code carries a sync address and a journal secret, so unlike a v1 code (only the
// passphrase) it could move a device to another server or another journal. So:
// - A device that already syncs takes a code only for the address it already uses; otherwise
//   the code is refused and nothing changes.
// - Its journal secret must fit what the device already has (keyStore.pairingJournalCheck): the
//   same confirmed key, or nothing here it contradicts. A device with a working key keeps it.
// - A new device shows a non-default address in plain words and asks before using it.
// - A code's address must be https; plain http only to this machine, and only in a dev build,
//   when it is the address this device already uses, or the one she typed herself.

import type { HubDB } from "../data/db";
import { pairingJournalCheck } from "../journal/keyStore";
import { DEFAULT_SYNC_URL, getMeta, normaliseAddress } from "../sync/engine";
import type { PairingPayload } from "./pairingText";

export type CodeVerdict =
  | {
      ok: true;
      /** The address the code sets up (the usual one when it carries none). */
      serverUrl: string;
      /** This device already had a sync token. */
      configured: boolean;
      /** "same": the journal key here already; "new": may become a candidate; "none": no secret in the code. */
      journal: "same" | "new" | "none";
      /** A new device and an address other than this build's usual one: ask her first. */
      confirmAddress: boolean;
    }
  | { ok: false; why: "other-address" | "other-journal" | "bad-address"; serverUrl: string };

const LOCAL_HOSTS = ["127.0.0.1", "localhost"];

/** Review M3: https anywhere; http only to this machine, in a dev build or when she typed it. */
export function codeAddressAllowed(address: string, opts: { dev: boolean; typed?: string }): boolean {
  let u: URL;
  try {
    u = new URL(address);
  } catch {
    return false;
  }
  if (u.protocol === "https:") return true;
  if (u.protocol !== "http:" || !LOCAL_HOSTS.includes(u.hostname)) return false;
  return opts.dev || (opts.typed !== undefined && normaliseAddress(opts.typed) === normaliseAddress(address));
}

/** This build's usual address (what a code leaves out, and what needs no confirming). */
export const buildDefaultAddress = () => normaliseAddress(import.meta.env.VITE_SYNC_URL || DEFAULT_SYNC_URL);

/**
 * What to do with a v2 code on this device. `typed`: the address in the Sync page's field (she
 * typed or kept it there herself). Changes nothing.
 */
export async function checkPairingCode(
  db: HubDB,
  code: Extract<PairingPayload, { v: 2 }>,
  opts: { dev?: boolean; typed?: string } = {},
): Promise<CodeVerdict> {
  const serverUrl = normaliseAddress(code.serverUrl ?? DEFAULT_SYNC_URL);
  const token = await getMeta<string>(db, "token");
  const configured = typeof token === "string" && token !== "";
  const current = normaliseAddress((await getMeta<string>(db, "serverUrl")) ?? "");
  const dev = opts.dev ?? import.meta.env.DEV;
  const known = configured && current === serverUrl;
  if (!known && !codeAddressAllowed(serverUrl, { dev, typed: opts.typed })) return { ok: false, why: "bad-address", serverUrl };
  if (configured && current !== serverUrl) return { ok: false, why: "other-address", serverUrl };
  let journal: "same" | "new" | "none" = "none";
  if (code.secret) {
    const fit = await pairingJournalCheck(db, code.secret);
    if (fit === "other") return { ok: false, why: "other-journal", serverUrl };
    journal = fit;
  }
  return { ok: true, serverUrl, configured, journal, confirmAddress: !configured && serverUrl !== buildDefaultAddress() };
}
