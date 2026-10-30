import type { HubDB } from "../data/db";
import { deriveJournalKeyAndFp, journalAad, sealJson, type JournalKey } from "../journal/crypto";
import { JOURNAL_KEY_META, VERIFIER_ID } from "../journal/keyStore";

const cache = new Map<string, Promise<JournalKey>>();

/** The journal key for a (fake) passphrase, derived once per test file. */
export function keyFor(passphrase: string): Promise<JournalKey> {
  let k = cache.get(passphrase);
  if (!k) cache.set(passphrase, (k = deriveJournalKeyAndFp(passphrase)));
  return k;
}

/** The verifier row a confirmed key writes (for tests that set a device up by hand). */
export async function verifierRow(jk: JournalKey, date = "2026-10-01") {
  return { id: VERIFIER_ID, kind: "verifier" as const, date, fp: jk.fp, ...(await sealJson(jk.key, { v: 1, check: "esmeworld-journal-verifier-v1" }, journalAad(VERIFIER_ID))) };
}

/** Sets a device up as if this key had been confirmed there (key stored + verifier row). */
export async function confirmedDevice(db: HubDB, jk: JournalKey): Promise<void> {
  await db.syncMeta.put({ key: JOURNAL_KEY_META, value: { key: jk.key, mac: jk.mac, fp: jk.fp, id: crypto.randomUUID() } });
  if (!(await db.journal.get(VERIFIER_ID))) await db.journal.put(await verifierRow(jk));
}
