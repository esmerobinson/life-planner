import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { assertUniversalHeaders, call, DEVICE_A, errorOf } from "./helpers";

const ALLOWED_ORIGINS = [
  "https://life-hub-eoy.pages.dev",
  "https://abc123.life-hub-eoy.pages.dev",
  "https://feature-branch-1.life-hub-eoy.pages.dev",
  "esmeworld://app",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:4173",
];

const DISALLOWED_ORIGINS = [
  "https://evil.example",
  "http://life-hub-eoy.pages.dev",
  "https://life-hub-eoy.pages.dev.evil.example",
  "https://evil-life-hub-eoy.pages.dev",
  "https://a.b.life-hub-eoy.pages.dev",
  "https://.life-hub-eoy.pages.dev",
  "https://LIFE-HUB-EOY.PAGES.DEV",
  "https://life-hub-eoy.pages.dev:443",
  "https://life-hub-eoy.pages.dev/",
  "esmeworld://app.evil",
  "esmeworld://evil",
  "http://localhost:5173",
  "http://127.0.0.1:5174",
  "http://127.0.0.1",
  "null",
];

describe("GET /v1/health", () => {
  it("answers without auth", async () => {
    const response = await call("/v1/health", { token: null });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, version: 1 });
    expect(response.headers.get("Content-Type")).toMatch(/^application\/json/);
  });

  it("ignores a wrong token (no auth on health)", async () => {
    const response = await call("/v1/health", { token: "wrong-token-not-real" });
    expect(response.status).toBe(200);
  });
});

describe("routing", () => {
  it.each(["/", "/v1", "/v1/", "/v1/health/", "/v1/healthz", "/v2/health", "/v1/sync/extra", "/favicon.ico"])(
    "404s unknown path %s with the compact error shape",
    async (path) => {
      const response = await call(path, { token: null });
      expect(response.status).toBe(404);
      expect(await errorOf(response)).toBe("not_found");
    },
  );

  it.each([
    ["POST", "/v1/health", "GET, OPTIONS"],
    ["DELETE", "/v1/health", "GET, OPTIONS"],
    ["GET", "/v1/sync", "POST, OPTIONS"],
    ["PUT", "/v1/sync", "POST, OPTIONS"],
    ["POST", "/v1/export", "GET, OPTIONS"],
    ["PATCH", "/v1/export", "GET, OPTIONS"],
  ])("405s %s %s with Allow and the compact error shape", async (method, path, allow) => {
    const response = await call(path, { method, token: null });
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe(allow);
    expect(await errorOf(response)).toBe("method_not_allowed");
  });

  it("serves through the default export too (Worker entry point wiring)", async () => {
    const response = await SELF.fetch("https://sync.test/v1/health");
    assertUniversalHeaders(response);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, version: 1 });
  });

  it("default export enforces auth with the configured secret", async () => {
    const response = await SELF.fetch("https://sync.test/v1/export");
    assertUniversalHeaders(response);
    expect(response.status).toBe(401);
  });
});

describe("CORS", () => {
  it.each(ALLOWED_ORIGINS)("echoes the allowed origin %s on actual requests", async (origin) => {
    const response = await call("/v1/health", { origin });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    expect(response.headers.get("Vary")).toMatch(/Origin/);
    expect(response.headers.get("Access-Control-Expose-Headers")).toBe("Retry-After");
  });

  it.each(DISALLOWED_ORIGINS)("gives no CORS headers to %s", async (origin) => {
    const response = await call("/v1/health", { origin });
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(response.headers.get("Access-Control-Allow-Methods")).toBeNull();
  });

  it("works server-to-server without an Origin header (no CORS headers)", async () => {
    const response = await call("/v1/health");
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it.each(["/v1/sync", "/v1/export", "/v1/health"])("answers preflight on %s with 204 and max-age", async (path) => {
    const response = await call(path, {
      method: "OPTIONS",
      token: null,
      origin: "https://life-hub-eoy.pages.dev",
      headers: { "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization, content-type" },
    });
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://life-hub-eoy.pages.dev");
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET, POST, OPTIONS");
    expect(response.headers.get("Access-Control-Allow-Headers")).toBe("Authorization, Content-Type");
    expect(response.headers.get("Access-Control-Max-Age")).toBe("600");
  });

  it("answers preflight from a disallowed origin without CORS headers", async () => {
    const response = await call("/v1/sync", {
      method: "OPTIONS",
      token: null,
      origin: "https://evil.example",
      headers: { "Access-Control-Request-Method": "POST" },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(response.headers.get("Access-Control-Allow-Methods")).toBeNull();
  });

  it("preflight does not require or consume auth", async () => {
    for (let i = 0; i < 10; i++) {
      const response = await call("/v1/sync", { method: "OPTIONS", token: null, ip: "198.51.100.9" });
      expect(response.status).toBe(204);
    }
    const ok = await call("/v1/export", { ip: "198.51.100.9" });
    expect(ok.status).toBe(200);
  });

  it("adds CORS headers to error responses for allowed origins (so the app can read them)", async () => {
    const response = await call("/v1/export", { token: "wrong-token-not-real", origin: "esmeworld://app" });
    expect(response.status).toBe(401);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("esmeworld://app");
  });
});

describe("Cache-Control: no-store on every response", () => {
  it("covers each kind of response", async () => {
    const responses: Response[] = [
      await call("/v1/health"),
      await call("/nope"),
      await call("/v1/sync", { method: "GET" }),
      await call("/v1/sync", { method: "OPTIONS", origin: "esmeworld://app" }),
      await call("/v1/export"),
      await call("/v1/export", { token: "wrong-token-not-real", ip: "198.51.100.1" }),
      await call("/v1/sync", { method: "POST", rawBody: "{not json" }),
      await call("/v1/sync", { method: "POST", body: { deviceId: DEVICE_A, cursor: 0, changes: [] } }),
    ];
    for (const response of responses) {
      assertUniversalHeaders(response);
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    }
    expect(responses.map((r) => r.status)).toEqual([200, 404, 405, 204, 200, 401, 400, 200]);
  });
});
