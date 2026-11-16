// Fixed Together ids (Together link brief §2). Every row copied to Together gets an id worked
// out from the Esmeworld id, so sending it again can never make a duplicate:
//
//   first 16 bytes of SHA-256("esmeworld-together-v1:" + kind + ":" + id + ":" + version)
//
// with the UUID version (8, "custom") and RFC variant bits set. A day of her challenge is
// `day` + "<challenge id>:<date>", version 1: one row per day, its note overwritten in place.
// (`habit` and `tally` ids are only worked out to clean up what an earlier build made.)

export const TOGETHER_ID_PREFIX = "esmeworld-together-v1";

/**
 * What a Together id is for: one day of her challenge (`challenge_days`), or, only to clean up
 * what an earlier build made, one of the two habits or a day's tally.
 */
export type TogetherIdKind = "day" | "habit" | "tally";

export async function togetherId(kind: TogetherIdKind, id: string, version: number): Promise<string> {
  const input = new TextEncoder().encode(`${TOGETHER_ID_PREFIX}:${kind}:${id}:${version}`);
  const b = new Uint8Array(await crypto.subtle.digest("SHA-256", input)).slice(0, 16);
  b[6] = (b[6]! & 0x0f) | 0x80;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
