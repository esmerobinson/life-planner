import { decodeQR } from "qr/decode.js";
import { MAX_PAIRING_PASSPHRASE, PAIRING_PREFIX, pairingText, parsePairingText } from "./pairingText";
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
