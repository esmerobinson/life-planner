import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { deriveToken, hashToken } from "../../shared/token";

// The same derivation must give the same answer inside the Workers runtime.
describe("shared/token in workerd", () => {
  it("derives the fixed vector", async () => {
    const token = await deriveToken("test-passphrase-not-real");
    expect(token).toBe("c46c879c74e03f56bfd1fd6c133cc7548962cf2c20ec7b3dc45402c27f42f39e");
    expect(await hashToken(token)).toBe("428f0b314ff5d2f521073d705fb037e2bc63b3e54c72e14c811d69c861db9d98");
  });

  it("agrees with the test bindings computed by Node in vitest.config.ts", async () => {
    expect(await hashToken(env.TEST_TOKEN)).toBe(env.SYNC_TOKEN_HASH);
  });
});
