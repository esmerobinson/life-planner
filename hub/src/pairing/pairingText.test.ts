import { decodeQR } from "qr/decode.js";
import {
  MAX_PAIRING_ADDRESS, MAX_PAIRING_PASSPHRASE, PAIRING_PREFIX, PAIRING_V2_PREFIX, pairingText, pairingTextV2, parsePairing,
  parsePairingText,
} from "./pairingText";
import { qrModules, qrPath } from "./qr";

// Fictional passphrases only.
const PASS = "fake-pairing-passphrase-for-tests";

/** Draws modules (quiet zone included) as RGBA pixels, 4px a module, as a camera would see. */
function pixels(modules: boolean[][], px = 4, quiet = 0) {
  const n = modules.length + quiet * 2;
  const width = n * px;
  const data = new Uint8ClampedArray(width * width * 4).fill(255);
  modules.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (!dark) return;
      for (let dy = 0; dy < px; dy++)
        for (let dx = 0; dx < px; dx++) {
          const i = (((y + quiet) * px + dy) * width + (x + quiet) * px + dx) * 4;
          data[i] = data[i + 1] = data[i + 2] = 0;
        }
    }),
  );
  return { width, height: width, data };
}

describe("pairing text", () => {
  it("is esmeworld-pair:v1: then the passphrase, exactly", () => {
    expect(PAIRING_PREFIX).toBe("esmeworld-pair:v1:");
    expect(pairingText(PASS)).toBe(`esmeworld-pair:v1:${PASS}`);
    expect(pairingText(" spaced pass ")).toBe("esmeworld-pair:v1: spaced pass ");
  });

  it("parses a pairing code back to the passphrase", () => {
    expect(parsePairingText(pairingText(PASS))).toBe(PASS);
    expect(parsePairingText(pairingText("fake:with:colons"))).toBe("fake:with:colons");
    expect(parsePairingText(pairingText("fake pässphrase ✓"))).toBe("fake pässphrase ✓");
  });

  it("drops whitespace before the code and line breaks after it; keeps spaces inside the passphrase", () => {
    expect(parsePairingText(`  \n${pairingText(PASS)}\r\n`)).toBe(PASS);
    expect(parsePairingText(`\t${pairingText("fake pass ")}\n`)).toBe("fake pass ");
  });

  it("refuses a passphrase over 1024 characters (a 3000-character code is refused, not decoded)", () => {
    expect(MAX_PAIRING_PASSPHRASE).toBe(1024);
    expect(parsePairingText(pairingText("p".repeat(1024)))).toBe("p".repeat(1024));
    expect(parsePairingText(pairingText("p".repeat(1025)))).toBeNull();
    expect(parsePairingText(pairingText("p".repeat(3000)))).toBeNull();
  });

  it("refuses anything that isn't a pairing code", () => {
    expect(parsePairingText("")).toBeNull();
    expect(parsePairingText(PASS)).toBeNull();
    expect(parsePairingText("esmeworld-pair:v1:")).toBeNull();
    expect(parsePairingText("esmeworld-pair:v1:   ")).toBeNull();
    expect(parsePairingText(`esmeworld-pair:v2:${PASS}`)).toBeNull();
    expect(parsePairingText(`ESMEWORLD-PAIR:V1:${PASS}`)).toBeNull();
    expect(parsePairingText(`https://example.test/?esmeworld-pair:v1:${PASS}`)).toBeNull();
  });
});

describe("pairing QR code", () => {
  it("decodes back to the exact pairing text (also with accents and emoji)", () => {
    for (const p of [PASS, "fake pässphrase ✓ 🌱", "x"]) {
      const text = pairingText(p);
      expect(decodeQR(pixels(qrModules(text)))).toBe(text);
    }
  });

  it("has the 4-module quiet zone, and draws one 1x1 square per dark module", () => {
    const m = qrModules(pairingText(PASS));
    const edge = [...m.slice(0, 4).flat(), ...m.slice(-4).flat(), ...m.flatMap((r) => [...r.slice(0, 4), ...r.slice(-4)])];
    expect(edge.some(Boolean)).toBe(false);
    expect(m[4]![4]).toBe(true); // the top-left finder starts right inside it
    const dark = m.flat().filter(Boolean).length;
    expect(qrPath(m).match(/M/g)).toHaveLength(dark);
  });
});

// ---- v2: no passphrase (2026-11-17) ------------------------------------------------------

const TOKEN = "0123456789abcdef".repeat(4); // 64 hex: a fictional sync token
const SECRET = new Uint8Array(32).map((_, i) => (i * 7 + 3) & 0xff); // fictional journal secret
const ADDRESS = "https://sync.example.test";

describe("pairing text v2 (no passphrase)", () => {
  it("is esmeworld-pair:v2:<token>.<secret>.<address>, base64url, compact", () => {
    expect(PAIRING_V2_PREFIX).toBe("esmeworld-pair:v2:");
    const text = pairingTextV2({ token: TOKEN, secret: SECRET, serverUrl: ADDRESS });
    expect(text).toMatch(/^esmeworld-pair:v2:[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}\.https:\/\/sync\.example\.test$/);
    // The usual address is left out; a code without the journal secret has an empty part.
    expect(pairingTextV2({ token: TOKEN, secret: null, serverUrl: null })).toMatch(/^esmeworld-pair:v2:[A-Za-z0-9_-]{43}\.\.$/);
  });

  it("parses back to the token, the secret and the address", () => {
    const p = parsePairing(pairingTextV2({ token: TOKEN, secret: SECRET, serverUrl: ADDRESS }));
    expect(p).toEqual({ v: 2, token: TOKEN, secret: SECRET, serverUrl: ADDRESS });
    expect(parsePairing(pairingTextV2({ token: TOKEN, secret: null, serverUrl: null }))).toEqual({
      v: 2, token: TOKEN, secret: null, serverUrl: null,
    });
    // A paste with whitespace around it.
    expect(parsePairing(`  ${pairingTextV2({ token: TOKEN, secret: SECRET, serverUrl: null })}\r\n`)).toMatchObject({ v: 2, token: TOKEN });
  });

  it("parsePairing still reads v1 codes, and parsePairingText still reads only v1", () => {
    expect(parsePairing(pairingText(PASS))).toEqual({ v: 1, passphrase: PASS });
    expect(parsePairingText(pairingTextV2({ token: TOKEN, secret: SECRET, serverUrl: null }))).toBeNull();
  });

  it("refuses a damaged or foreign v2 code", () => {
    const good = pairingTextV2({ token: TOKEN, secret: SECRET, serverUrl: ADDRESS });
    const [tok, sec] = good.slice(PAIRING_V2_PREFIX.length).split(".");
    for (const bad of [
      "esmeworld-pair:v2:",
      `esmeworld-pair:v2:${tok}`,
      `esmeworld-pair:v2:${tok}.${sec}`, // no address part
      `esmeworld-pair:v2:${tok!.slice(1)}.${sec}.`, // short token
      `esmeworld-pair:v2:${tok}.${sec!.slice(2)}.`, // short secret
      `esmeworld-pair:v2:${tok}.${sec}.${ADDRESS} x`, // a space in the address
      `esmeworld-pair:v2:${tok}+.${sec}.`,
      `esmeworld-pair:v2:${tok}.${sec}.${"h".repeat(MAX_PAIRING_ADDRESS + 1)}`,
      `esmeworld-pair:v3:${tok}.${sec}.`,
    ]) {
      expect(parsePairing(bad)).toBeNull();
    }
  });

  it("fits a small QR code: with the address it is at most version 9 (53 modules + quiet zone)", () => {
    const text = pairingTextV2({ token: TOKEN, secret: SECRET, serverUrl: "https://esmeworld-sync.esme-brain.workers.dev" });
    expect(text.length).toBeLessThanOrEqual(152);
    const m = qrModules(text);
    expect(m.length).toBeLessThanOrEqual(53 + 8);
    expect(decodeQR(pixels(m))).toBe(text);
  });
});
