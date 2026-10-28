import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { constantTimeEqual, parseBearer, sha256Hex } from "../../src/auth";
import { GLOBAL_MAX_FAILURES, GLOBAL_WINDOW_MS, IP_MAX_FAILURES, IP_WINDOW_MS } from "../../src/ratelimit";
import { call, errorOf, T0 } from "./helpers";

const WRONG = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"; // fake
const IP_A = "203.0.113.10";
const IP_B = "203.0.113.20";

async function failures(): Promise<Array<Record<string, unknown>>> {
  return (await env.DB.prepare("SELECT * FROM auth_failures ORDER BY ts").all<Record<string, unknown>>()).results;
}

describe("constantTimeEqual", () => {
  it("is true for equal strings", () => {
    expect(constantTimeEqual("", "")).toBe(true);
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual(WRONG, WRONG)).toBe(true);
  });

  it("is false for unequal strings of equal length", () => {
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("abc", "xbc")).toBe(false);
    expect(constantTimeEqual(WRONG, WRONG.replace(/f$/, "e"))).toBe(false);
  });

  it("is false for strings of different lengths", () => {
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
    expect(constantTimeEqual("abcd", "abc")).toBe(false);
    expect(constantTimeEqual("", "a")).toBe(false);
    expect(constantTimeEqual("abc", "abc\u0000")).toBe(false);
  });
});

describe("sha256Hex / parseBearer", () => {
  it("hashes to lowercase hex", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("parses bearer tokens strictly", () => {
    expect(parseBearer(`Bearer ${WRONG}`)).toBe(WRONG);
    expect(parseBearer(`bearer ${WRONG}`)).toBe(WRONG);
    expect(parseBearer(null)).toBeNull();
    expect(parseBearer("")).toBeNull();
    expect(parseBearer("Bearer")).toBeNull();
    expect(parseBearer("Bearer ")).toBeNull();
    expect(parseBearer(`Basic ${WRONG}`)).toBeNull();
    expect(parseBearer(`Bearer ${WRONG} extra`)).toBeNull();
    expect(parseBearer(`Bearer ${"a".repeat(1000)}`)).toBeNull();
  });
});

describe("authentication", () => {
  it("accepts the correct token", async () => {
    const response = await call("/v1/export");
    expect(response.status).toBe(200);
  });

  it("401s a missing token and a wrong token with identical bodies and no echo", async () => {
    const missing = await call("/v1/export", { token: null, ip: IP_A });
    const wrong = await call("/v1/export", { token: WRONG, ip: IP_B });
    const malformed = await call("/v1/export", { authorization: `Token ${WRONG}`, ip: "203.0.113.30" });
    expect([missing.status, wrong.status, malformed.status]).toEqual([401, 401, 401]);
    const bodies = [await missing.text(), await wrong.text(), await malformed.text()];
    expect(bodies[0]).toBe('{"error":"unauthorized"}');
    expect(bodies[1]).toBe(bodies[0]);
    expect(bodies[2]).toBe(bodies[0]);
    expect(missing.headers.get("WWW-Authenticate")).toBe(wrong.headers.get("WWW-Authenticate"));
    for (const body of bodies) expect(body).not.toContain(WRONG);
  });

  it("requires auth on /v1/sync before looking at the body", async () => {
    const response = await call("/v1/sync", { method: "POST", token: null, rawBody: "{not json" });
    expect(response.status).toBe(401);
  });

  it("does not accept the stored hash itself as a token", async () => {
    const response = await call("/v1/export", { token: env.SYNC_TOKEN_HASH, ip: IP_A });
    expect(response.status).toBe(401);
  });

  it("tolerates surrounding whitespace / upper case in the configured secret", async () => {
    const response = await call("/v1/export", {
      envOverride: { SYNC_TOKEN_HASH: ` ${env.SYNC_TOKEN_HASH.toUpperCase()}\n` },
    });
    expect(response.status).toBe(200);
  });

  it("fails closed (500, no auth bypass) when the secret is missing or malformed", async () => {
    for (const SYNC_TOKEN_HASH of [undefined, "", "not-a-hash", env.SYNC_TOKEN_HASH.slice(1)]) {
      const response = await call("/v1/export", { envOverride: { SYNC_TOKEN_HASH } });
      expect(response.status).toBe(500);
      expect(await errorOf(response)).toBe("server_misconfigured");
    }
    expect(await failures()).toEqual([]);
  });
});

describe("rate limiting", () => {
  it("uses the contract's limits", () => {
    expect(IP_MAX_FAILURES).toBe(5);
    expect(IP_WINDOW_MS).toBe(15 * 60 * 1000);
    expect(GLOBAL_MAX_FAILURES).toBe(100);
    expect(GLOBAL_WINDOW_MS).toBe(60 * 60 * 1000);
  });

  it("locks an IP after five failures, even for the correct token; other IPs are fine; the window expires", async () => {
    for (let i = 0; i < 5; i++) {
      const response = await call("/v1/export", { token: WRONG, ip: IP_A, now: T0 + i * 1000 });
      expect(response.status).toBe(401);
    }
    const locked = await call("/v1/export", { ip: IP_A, now: T0 + 10_000 });
    expect(locked.status).toBe(429);
    expect(await errorOf(locked)).toBe("rate_limited");
    // The oldest of the five failures (at T0) leaves the 15-minute window at T0 + 900 s.
    expect(locked.headers.get("Retry-After")).toBe(String(900 - 10));

    const lockedWrong = await call("/v1/export", { token: WRONG, ip: IP_A, now: T0 + 11_000 });
    expect(lockedWrong.status).toBe(429);
    expect(await failures()).toHaveLength(5); // attempts while locked are not recorded

    const otherIp = await call("/v1/export", { ip: IP_B, now: T0 + 12_000 });
    expect(otherIp.status).toBe(200);

    const stillLocked = await call("/v1/export", { ip: IP_A, now: T0 + IP_WINDOW_MS - 1 });
    expect(stillLocked.status).toBe(429);
    expect(stillLocked.headers.get("Retry-After")).toBe("1");

    const unlocked = await call("/v1/export", { ip: IP_A, now: T0 + IP_WINDOW_MS + 1 });
    expect(unlocked.status).toBe(200);
  });

  it("four failures do not lock", async () => {
    for (let i = 0; i < 4; i++) await call("/v1/export", { token: WRONG, ip: IP_A, now: T0 + i });
    const response = await call("/v1/export", { ip: IP_A, now: T0 + 10 });
    expect(response.status).toBe(200);
  });

  it("missing Authorization headers count as failures", async () => {
    for (let i = 0; i < 5; i++) await call("/v1/export", { token: null, ip: IP_A, now: T0 + i });
    const response = await call("/v1/export", { ip: IP_A, now: T0 + 10 });
    expect(response.status).toBe(429);
  });

  it("applies the global cap to everyone except requests with the correct token", async () => {
    // 20 IPs x 5 failures = 100 failures within the hour, each IP at its own limit.
    for (let ip = 0; ip < 20; ip++) {
      for (let i = 0; i < 5; i++) {
        const response = await call("/v1/export", { token: WRONG, ip: `198.51.100.${ip}`, now: T0 + ip * 1000 + i });
        expect(response.status).toBe(401);
      }
    }
    expect(await failures()).toHaveLength(100);

    const freshWrong = await call("/v1/export", { token: WRONG, ip: "192.0.2.77", now: T0 + 60_000 });
    expect(freshWrong.status).toBe(429);
    expect(Number(freshWrong.headers.get("Retry-After"))).toBe(3600 - 60);
    const freshMissing = await call("/v1/export", { token: null, ip: "192.0.2.78", now: T0 + 60_000 });
    expect(freshMissing.status).toBe(429);
    expect(await failures()).toHaveLength(100); // capped attempts are not recorded

    const freshCorrect = await call("/v1/export", { ip: "192.0.2.79", now: T0 + 60_000 });
    expect(freshCorrect.status).toBe(200);

    // After the hour the cap lifts.
    const later = await call("/v1/export", { token: WRONG, ip: "192.0.2.80", now: T0 + GLOBAL_WINDOW_MS + 60_000 });
    expect(later.status).toBe(401);
  });

  it("prunes failures older than the longest window on write", async () => {
    await call("/v1/export", { token: WRONG, ip: IP_A, now: T0 });
    await call("/v1/export", { token: WRONG, ip: IP_B, now: T0 + GLOBAL_WINDOW_MS + 1 });
    const rows = await failures();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.ip).toBe(IP_B);
  });

  it("never stores the presented token (or its hash) when recording failures", async () => {
    const presented = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210"; // fake
    const presentedHash = await sha256Hex(presented);
    await call("/v1/export", { token: presented, ip: IP_A });
    await call("/v1/sync", { method: "POST", token: presented, ip: IP_A, body: { deviceId: "x", cursor: 0, changes: [] } });
    const rows = await failures();
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(Object.keys(row).sort()).toEqual(["ip", "ts"]);
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain(presented);
    expect(dump).not.toContain(presentedHash);
    expect(dump).not.toContain(presented.slice(0, 16));
  });

  it("falls back to a shared bucket when CF-Connecting-IP is absent", async () => {
    // Without the header every caller shares one bucket ("unknown"); it is still limited.
    for (let i = 0; i < 5; i++) {
      const response = await call("/v1/export", { token: WRONG, headers: {}, ip: "", now: T0 + i });
      expect(response.status).toBe(401);
    }
    const response = await call("/v1/export", { ip: "", now: T0 + 10 });
    expect(response.status).toBe(429);
  });
});
