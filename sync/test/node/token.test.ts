import { createHash, pbkdf2Sync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { deriveToken, hashToken } from "../../shared/token.ts";

// Fixed vectors: PBKDF2-HMAC-SHA256, salt "esmeworld-sync-v1", 200000 iterations, 32 bytes,
// lowercase hex; hash = SHA-256 of the token's hex string. All passphrases are fake.
// If any parameter of the derivation changes, these assertions fail.
const VECTORS = [
  {
    passphrase: "test-passphrase-not-real",
    token: "c46c879c74e03f56bfd1fd6c133cc7548962cf2c20ec7b3dc45402c27f42f39e",
    hash: "428f0b314ff5d2f521073d705fb037e2bc63b3e54c72e14c811d69c861db9d98",
  },
  {
    passphrase: "correct horse battery staple (fake)",
    token: "689e6a76c8ef4d48f69da025fe22d352ec6a7128f88716500ea21c198031d31e",
    hash: "cc2eddf2eb6cc76181283a1d9280cb5ab08ccce6ed3f5ce3fbd661954f457864",
  },
  {
    passphrase: "pässwörd-ünïcode-fake-1234",
    token: "8c8e272d1002c10d0fd4106999c96f9624bdd5599df73c7a4c5047df2e3a19f5",
    hash: "bf8e81f891ce8d7ed6dc3c457c7a494dec4c616c4b7564b5b616afb1f13061a0",
  },
];

describe("shared/token", () => {
  for (const v of VECTORS) {
    it(`derives the fixed vector for ${JSON.stringify(v.passphrase)}`, async () => {
      const token = await deriveToken(v.passphrase);
      expect(token).toBe(v.token);
      expect(await hashToken(token)).toBe(v.hash);
    });

    it(`matches Node's built-in crypto for ${JSON.stringify(v.passphrase)}`, async () => {
      const nodeToken = pbkdf2Sync(v.passphrase, "esmeworld-sync-v1", 200_000, 32, "sha256").toString("hex");
      const nodeHash = createHash("sha256").update(nodeToken).digest("hex");
      expect(await deriveToken(v.passphrase)).toBe(nodeToken);
      expect(await hashToken(nodeToken)).toBe(nodeHash);
    });
  }

  it("produces 64 lowercase hex characters", async () => {
    const token = await deriveToken("another-fake-passphrase");
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hashToken matches a known SHA-256 value", async () => {
    // SHA-256("abc"), the FIPS 180-2 example.
    expect(await hashToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
