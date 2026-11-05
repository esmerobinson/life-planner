/**
 * A new row id that sorts by when it was made: a UUID version 7 (48-bit milliseconds, then
 * random bits). Rows made on the same day (same createdAt) then keep the order they were
 * made in, on every device, instead of the order of random ids. Still a UUID, so every app
 * version reads it. Within one session ids never go backwards, even within one millisecond.
 */
let lastMs = 0;

export function newId(now = Date.now()): string {
  const ms = Math.max(Math.floor(now), lastMs + 1);
  lastMs = ms;
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  for (let i = 0; i < 6; i++) b[i] = Math.floor(ms / 2 ** (8 * (5 - i))) & 0xff;
  b[6] = 0x70 | (b[6]! & 0x0f); // version 7
  b[8] = 0x80 | (b[8]! & 0x3f); // RFC 9562 variant
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
