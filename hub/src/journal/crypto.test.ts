import { describe, expect, it } from "vitest";
import {
  deriveJournalKey, deriveJournalKeyAndFp, deriveJournalSecret, deriveKeyWrapKey, fromBase64, generateDeviceWrapKey, journalKeyFromSecret,
  KEYWRAP_SALT, promptKey, IV_BYTES, JOURNAL_ITERATIONS, JOURNAL_SALT, openBytes, openJson, sealBytes, sealJson, toBase64,
} from "./crypto";

// Fixed vector, computed independently with Node's crypto module (not WebCrypto):
//   key = pbkdf2Sync("correct horse battery staple", "esmeworld-journal-v1", 200000, 32, "sha256")
//       = e409de515940ee228d66946d55446b90fae0c1923ca3ef4b4ecd586f643e2d12
//   AES-256-GCM, iv 000102030405060708090a0b, AAD "journal|morning:2026-10-28",
//   plaintext {"pretend":"words"} -> ct||tag below.
const VECTOR = {
  passphrase: "correct horse battery staple",
  iv: toBase64(Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])),
  ct: "b6IPWSsvdut/J8hCZ1JWablpK0CcUTMCoQ/EXZLjtTTPbj8=",
  aad: "journal|morning:2026-10-28",
};

describe("journal key derivation", () => {
  it("uses the brief's salt and iteration count", () => {
    expect(JOURNAL_SALT).toBe("esmeworld-journal-v1");
    expect(JOURNAL_ITERATIONS).toBe(200_000);
  });

  it("matches the fixed vector computed outside WebCrypto", async () => {
    const key = await deriveJournalKey(VECTOR.passphrase);
    expect(await openJson(key, { iv: VECTOR.iv, ct: VECTOR.ct }, VECTOR.aad)).toEqual({ pretend: "words" });
    // And the same IV gives the same bytes (a fixed IV only here, straight through WebCrypto).
    const again = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: fromBase64(VECTOR.iv) as BufferSource, additionalData: new TextEncoder().encode(VECTOR.aad) },
      key,
      new TextEncoder().encode('{"pretend":"words"}'),
    );
    expect(toBase64(new Uint8Array(again))).toBe(VECTOR.ct);
  });

  it("the fingerprint is the first 8 bytes of HMAC-SHA256(key bits, 'esmeworld-journal-fp') (vector from Node)", async () => {
    // node: createHmac("sha256", Buffer.from("e409de51…2d12", "hex")).update("esmeworld-journal-fp").digest("hex").slice(0, 16)
    const jk = await deriveJournalKeyAndFp(VECTOR.passphrase);
    expect(jk.fp).toBe("768feba679209ed9");
    expect(await openJson(jk.key, { iv: VECTOR.iv, ct: VECTOR.ct }, VECTOR.aad)).toEqual({ pretend: "words" });
    expect((await deriveJournalKeyAndFp("pretend other")).fp).not.toBe(jk.fp);
    expect(jk.key.extractable).toBe(false);
  });

  it("a prompt's opaque key is the first 12 hex of HMAC-SHA256(key bits, promptId) (vector from Node)", async () => {
    // node: createHmac("sha256", Buffer.from("e409de51…2d12", "hex")).update("M1").digest("hex").slice(0, 12)
    const jk = await deriveJournalKeyAndFp(VECTOR.passphrase);
    expect(await promptKey(jk, "M1")).toBe("bae6397a2f99");
    expect(await promptKey(jk, "M2")).not.toBe("bae6397a2f99");
    expect(await promptKey(await deriveJournalKeyAndFp("pretend other"), "M1")).not.toBe("bae6397a2f99");
    expect(jk.mac.extractable).toBe(false);
  });

  it("sealing never takes a caller's IV", () => {
    expect(sealBytes.length).toBe(3);
  });

  it("is an AES-GCM key that can never be exported", async () => {
    const key = await deriveJournalKey("pretend passphrase");
    expect(key.extractable).toBe(false);
    expect(key.algorithm).toMatchObject({ name: "AES-GCM", length: 256 });
    expect([...key.usages].sort()).toEqual(["decrypt", "encrypt"]);
    await expect(crypto.subtle.exportKey("raw", key)).rejects.toThrow();
  });

  it("normalizes the passphrase to NFC (decomposed accents give the same key)", async () => {
    const composed = await deriveJournalKey("café pretend");
    const decomposed = await deriveJournalKey("café pretend");
    const sealed = await sealJson(composed, { a: 1 }, "x");
    expect(await openJson(decomposed, sealed, "x")).toEqual({ a: 1 });
  });

  it("is a different key from the sync token's derivation (different salt)", async () => {
    const key = await deriveJournalKey(VECTOR.passphrase);
    const other = await deriveJournalKey(`${VECTOR.passphrase} `);
    await expect(openJson(other, { iv: VECTOR.iv, ct: VECTOR.ct }, VECTOR.aad)).rejects.toThrow();
    expect(await openJson(key, { iv: VECTOR.iv, ct: VECTOR.ct }, VECTOR.aad)).toBeTruthy();
  });
});

describe("sealing and opening", () => {
  it("round-trips JSON and bytes with a fresh 12-byte IV each time", async () => {
    const key = await deriveJournalKey("pretend passphrase");
    const a = await sealJson(key, { text: "Pretend morning words" }, "journal|morning:2026-10-01");
    const b = await sealJson(key, { text: "Pretend morning words" }, "journal|morning:2026-10-01");
    expect(fromBase64(a.iv)).toHaveLength(IV_BYTES);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
    expect(await openJson(key, a, "journal|morning:2026-10-01")).toEqual({ text: "Pretend morning words" });
    const bytes = Uint8Array.from([255, 216, 255, 0, 1, 2]);
    const s = await sealBytes(key, bytes, "file|p1");
    expect(await openBytes(key, s, "file|p1")).toEqual(bytes);
  });

  it("detects tampering: a changed ciphertext, IV or row binding never opens", async () => {
    const key = await deriveJournalKey("pretend passphrase");
    const sealed = await sealJson(key, { text: "Pretend" }, "journal|checkin:2026-10-02");
    const ct = fromBase64(sealed.ct);
    ct[0] ^= 1;
    await expect(openJson(key, { ...sealed, ct: toBase64(ct) }, "journal|checkin:2026-10-02")).rejects.toThrow();
    const iv = fromBase64(sealed.iv);
    iv[0] ^= 1;
    await expect(openJson(key, { ...sealed, iv: toBase64(iv) }, "journal|checkin:2026-10-02")).rejects.toThrow();
    // Moved to another day's row: refused.
    await expect(openJson(key, sealed, "journal|checkin:2026-10-03")).rejects.toThrow();
  });

  it("a wrong key never opens", async () => {
    const sealed = await sealJson(await deriveJournalKey("pretend one"), { text: "Pretend" }, "x");
    await expect(openJson(await deriveJournalKey("pretend two"), sealed, "x")).rejects.toThrow();
  });
});

// Journal re-key (bugs #3, #4; journal-rekey brief): the journal SECRET S (the same PBKDF2 bits
// the key is made from) and a passphrase's KEY-WRAP key (KEK), with its own salt.
describe("journal secret and key-wrap key", () => {
  // node: pbkdf2Sync("correct horse battery staple", "esmeworld-keywrap-v1", 200000, 32, "sha256")
  //     = 361f5752e0a909a9e34ef53641b9f76376c49d7f1152342bf0b7c65977cfac06
  //   fp: createHmac("sha256", <that>).update("esmeworld-keywrap-fp").digest("hex").slice(0, 16)
  //   AES-256-GCM, iv 000102030405060708090a0b, AAD "journal|keywrap:x", plaintext {"pretend":"wrap"}
  const WRAP_VECTOR = { fp: "4c208fea155f94ff", ct: "oELuLT094Zdzn4qBEIXlISSs5pThTjJ6JtraStihRCoohg==", aad: "journal|keywrap:x" };

  it("S is the journal key's own bits: a key made from S opens what the passphrase's key sealed, same fingerprint", async () => {
    const s = await deriveJournalSecret(VECTOR.passphrase);
    expect(s).toHaveLength(32);
    expect([...s].map((b) => b.toString(16).padStart(2, "0")).join("")).toBe(
      "e409de515940ee228d66946d55446b90fae0c1923ca3ef4b4ecd586f643e2d12",
    );
    const jk = await journalKeyFromSecret(s);
    expect(jk.fp).toBe("768feba679209ed9");
    expect(await openJson(jk.key, { iv: VECTOR.iv, ct: VECTOR.ct }, VECTOR.aad)).toEqual({ pretend: "words" });
    expect(await promptKey(jk, "M1")).toBe("bae6397a2f99");
    expect(jk.key.extractable).toBe(false);
    expect(jk.mac.extractable).toBe(false);
  });

  it("the KEK has its own salt and fingerprint (vector from Node), is never the journal key, and can't be exported", async () => {
    expect(KEYWRAP_SALT).toBe("esmeworld-keywrap-v1");
    const kek = await deriveKeyWrapKey(VECTOR.passphrase);
    expect(kek.fp).toBe(WRAP_VECTOR.fp);
    expect(await openJson(kek.key, { iv: VECTOR.iv, ct: WRAP_VECTOR.ct }, WRAP_VECTOR.aad)).toEqual({ pretend: "wrap" });
    expect(kek.key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("raw", kek.key)).rejects.toThrow();
    const jk = await deriveJournalKeyAndFp(VECTOR.passphrase);
    expect(kek.fp).not.toBe(jk.fp);
    await expect(openJson(jk.key, { iv: VECTOR.iv, ct: WRAP_VECTOR.ct }, WRAP_VECTOR.aad)).rejects.toThrow();
  });

  it("a device wrap key is a fresh non-extractable AES-GCM key", async () => {
    const a = await generateDeviceWrapKey();
    const b = await generateDeviceWrapKey();
    expect(a.extractable).toBe(false);
    const sealed = await sealBytes(a, Uint8Array.from([1, 2, 3]), "device-secret|x");
    expect(await openBytes(a, sealed, "device-secret|x")).toEqual(Uint8Array.from([1, 2, 3]));
    await expect(openBytes(b, sealed, "device-secret|x")).rejects.toThrow();
  });
});
