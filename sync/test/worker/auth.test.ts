import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { constantTimeEqual, parseBearer, sha256Hex } from "../../src/auth";
import { bucketFor, GLOBAL_MAX_FAILURES, GLOBAL_WINDOW_MS, IP_MAX_FAILURES, IP_WINDOW_MS } from "../../src/ratelimit";
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

describe("bucketFor (rate-limit key)", () => {
  it("keeps IPv4 addresses as they are (canonical dotted quad)", () => {
    expect(bucketFor("203.0.113.7")).toBe("203.0.113.7");
    expect(bucketFor(" 203.0.113.7 ")).toBe("203.0.113.7");
  });

  it("keys IPv6 on the /64 (first four groups), whatever the spelling", () => {
    const key = bucketFor("2001:db8:1:2:3:4:5:6");
    expect(key).toBe("2001:db8:1:2::/64");
    for (const same of [
      "2001:db8:1:2::",
      "2001:db8:1:2::9",
      "2001:DB8:1:2:ffff::1",
      "2001:0db8:0001:0002:0000:0000:0000:0001",
      "2001:db8:1:2:0:0:1.2.3.4",
      "fe80::1%eth0".replace("fe80::1", "2001:db8:1:2::1"),
    ]) {
      expect(bucketFor(same), same).toBe(key);
    }
    expect(bucketFor("2001:db8:1:3::1")).not.toBe(key);
    expect(bucketFor("2001:db8::1")).toBe("2001:db8:0:0::/64");
  });

  it("handles the compressed forms :: and ::1", () => {
    expect(bucketFor("::")).toBe("0:0:0:0::/64");
    expect(bucketFor("::1")).toBe("0:0:0:0::/64");
    expect(bucketFor("1::")).toBe("1:0:0:0::/64");
  });

  it("treats IPv4-mapped IPv6 addresses as the IPv4 address", () => {
    expect(bucketFor("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(bucketFor("::FFFF:cb00:7107")).toBe("203.0.113.7");
    expect(bucketFor("0:0:0:0:0:ffff:203.0.113.7")).toBe("203.0.113.7");
  });

  it("puts missing or unparseable values in the shared 'unknown' bucket", () => {
    for (const bad of [null, undefined, "", "   ", "not-an-ip", "1.2.3", "1.2.3.256", "1:2:3", "1::2::3", "12345::", "1:2:3:4:5:6:7:8:9"]) {
      expect(bucketFor(bad), String(bad)).toBe("unknown");
    }
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

  /** Adds failures, 5 per bucket, until there are exactly 100 within the hour (global cap reached). */
  async function reachGlobalCap() {
    let count = (await failures()).length;
    for (let ip = 0; count < GLOBAL_MAX_FAILURES; ip++) {
      for (let i = 0; i < 5 && count < GLOBAL_MAX_FAILURES; i++, count++) {
        const response = await call("/v1/export", { token: WRONG, ip: `198.51.100.${ip}`, now: T0 + ip * 1000 + i });
        expect(response.status).toBe(401);
      }
    }
    expect(await failures()).toHaveLength(GLOBAL_MAX_FAILURES);
  }

  it("during a global lockout: wrong tokens are still recorded, the per-bucket limit drops to 1, correct tokens from clean buckets pass", async () => {
    await reachGlobalCap();
    const now = T0 + 60_000;

    // A fresh bucket's first wrong token is recorded and answered 429 (global cap).
    const firstWrong = await call("/v1/export", { token: WRONG, ip: "192.0.2.77", now });
    expect(firstWrong.status).toBe(429);
    expect(await errorOf(firstWrong)).toBe("rate_limited");
    expect(await failures()).toHaveLength(101);
    // The cap lifts when the 100th most recent failure (T0 + 1 ms) leaves the hour.
    expect(Number(firstWrong.headers.get("Retry-After"))).toBe(3541);

    // Its second attempt is over the lowered per-bucket limit (1): not recorded, 429.
    const secondWrong = await call("/v1/export", { token: WRONG, ip: "192.0.2.77", now: now + 1000 });
    expect(secondWrong.status).toBe(429);
    expect(secondWrong.headers.get("Retry-After")).toBe(String(900 - 1));
    expect(await failures()).toHaveLength(101);

    // No oracle: that bucket's correct token is also refused now.
    const bucketCorrect = await call("/v1/export", { ip: "192.0.2.77", now: now + 2000 });
    expect(bucketCorrect.status).toBe(429);

    // Missing tokens count the same way.
    const missing = await call("/v1/export", { token: null, ip: "192.0.2.78", now });
    expect(missing.status).toBe(429);
    expect(await failures()).toHaveLength(102);

    // A clean bucket with the correct token is not affected by the global cap.
    const cleanCorrect = await call("/v1/export", { ip: "192.0.2.79", now });
    expect(cleanCorrect.status).toBe(200);

    // After the hour the cap lifts.
    const later = await call("/v1/export", { token: WRONG, ip: "192.0.2.80", now: T0 + GLOBAL_WINDOW_MS + 120_000 });
    expect(later.status).toBe(401);
  });

  it("a bucket under 5 failures cannot keep guessing once the global cap is reached (no 429/200 oracle)", async () => {
    const attacker = "192.0.2.50";
    for (let i = 0; i < 2; i++) await call("/v1/export", { token: WRONG, ip: attacker, now: T0 - 1000 + i });
    await reachGlobalCap(); // 2 attacker failures + 98 others
    for (let i = 0; i < 10; i++) {
      const guess = await call("/v1/export", { token: `${WRONG.slice(0, 60)}${String(i).padStart(4, "0")}`, ip: attacker, now: T0 + 30_000 + i });
      expect(guess.status).toBe(429);
    }
    const attackerRows = (await failures()).filter((r) => r.ip === attacker);
    expect(attackerRows).toHaveLength(2); // nothing more recorded: the bucket is locked at limit 1
    const correct = await call("/v1/export", { ip: attacker, now: T0 + 31_000 });
    expect(correct.status).toBe(429);
  });

  it("concurrent wrong-token requests from one bucket record and allow at most five failures", async () => {
    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, i) => call("/v1/export", { token: WRONG, ip: IP_A, now: T0 + i })),
    );
    const statuses = responses.map((r) => r.status);
    expect(statuses.filter((s) => s === 401)).toHaveLength(5);
    expect(statuses.filter((s) => s === 429)).toHaveLength(15);
    expect((await failures()).filter((r) => r.ip === IP_A)).toHaveLength(5);
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

  it("groups IPv6 clients by /64: five failures across one /64 lock the whole /64, not its neighbours", async () => {
    for (let i = 1; i <= 5; i++) {
      const response = await call("/v1/export", { token: WRONG, ip: `2001:db8:1:2::${i}`, now: T0 + i });
      expect(response.status).toBe(401);
    }
    const sameSlash64 = await call("/v1/export", { ip: "2001:0DB8:0001:0002:ffff:eeee:dddd:cccc", now: T0 + 10 });
    expect(sameSlash64.status).toBe(429);
    const neighbour = await call("/v1/export", { ip: "2001:db8:1:3::1", now: T0 + 10 });
    expect(neighbour.status).toBe(200);
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
