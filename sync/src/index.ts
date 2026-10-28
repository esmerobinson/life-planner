// Esmeworld sync Worker: router and request pipeline.
// Contract: docs/superpowers/specs/2026-10-28-sync-api.md
//
// Never logs request headers or bodies. Error bodies are always `{ "error": "<code>" }`.

import { configuredHash, presentsValidToken } from "./auth";
import { corsHeaders, preflightHeaders } from "./cors";
import type { Env } from "./env";
import { exportResponse } from "./export";
import { errorResponse, HttpError, json, jsonText, MAX_BODY_BYTES, readJsonBody } from "./http";
import { checkGlobalLimit, checkIpLimit, clientIp, recordFailure } from "./ratelimit";
import { DEFAULT_CHUNK_BYTES, runSync, validateSyncRequest } from "./sync";

export type { Env } from "./env";

/** Injectable dependencies (tests use a fixed clock and small chunks). */
export interface Deps {
  now: () => number;
  chunkBytes: number;
}

const DEFAULT_DEPS: Deps = { now: () => Date.now(), chunkBytes: DEFAULT_CHUNK_BYTES };

const ROUTES = new Map<string, "GET" | "POST">([
  ["/v1/health", "GET"],
  ["/v1/sync", "POST"],
  ["/v1/export", "GET"],
]);

export async function handle(request: Request, env: Env, overrides: Partial<Deps> = {}): Promise<Response> {
  const deps: Deps = { ...DEFAULT_DEPS, ...overrides };
  let response: Response;
  let preflight = false;
  try {
    const path = new URL(request.url).pathname;
    const method = ROUTES.get(path);
    if (!method) throw new HttpError(404, "not_found");
    if (request.method === "OPTIONS") {
      preflight = true;
      response = new Response(null, { status: 204, headers: preflightHeaders(request) });
    } else if (request.method !== method) {
      throw new HttpError(405, "method_not_allowed", { Allow: `${method}, OPTIONS` });
    } else {
      response = await route(path, request, env, deps);
    }
  } catch (error) {
    if (error instanceof HttpError) {
      response = errorResponse(error.status, error.code, error.headers);
    } else {
      const name = error instanceof Error ? error.name : "unknown";
      console.error("sync_worker_failure", name);
      response = errorResponse(500, "internal");
    }
  }
  return finalize(request, response, preflight);
}

async function route(path: string, request: Request, env: Env, deps: Deps): Promise<Response> {
  if (path === "/v1/health") return json(200, { ok: true, version: 1 });

  await authenticate(request, env, deps.now());

  if (path === "/v1/sync") {
    const body = await readJsonBody(request, MAX_BODY_BYTES);
    const syncRequest = validateSyncRequest(body, deps.now());
    return jsonText(200, await runSync(env.DB, syncRequest, { chunkBytes: deps.chunkBytes }));
  }
  return exportResponse(env.DB, deps.now(), {});
}

/**
 * Order matters: an IP over its failure limit gets 429 even with the correct token;
 * the global cap only applies to requests that do NOT present the correct token.
 * Attempts answered with 429 are not recorded (so the limits cannot be extended forever
 * and D1 writes stay bounded).
 */
async function authenticate(request: Request, env: Env, now: number): Promise<void> {
  const expected = configuredHash(env.SYNC_TOKEN_HASH);
  if (!expected) throw new HttpError(500, "server_misconfigured");

  const ip = clientIp(request);
  const ipLimit = await checkIpLimit(env.DB, ip, now);
  if (ipLimit.limited) throw new HttpError(429, "rate_limited", { "Retry-After": String(ipLimit.retryAfter) });

  if (await presentsValidToken(request, expected)) return;

  const globalLimit = await checkGlobalLimit(env.DB, now);
  if (globalLimit.limited) throw new HttpError(429, "rate_limited", { "Retry-After": String(globalLimit.retryAfter) });

  await recordFailure(env.DB, ip, now);
  throw new HttpError(401, "unauthorized", { "WWW-Authenticate": "Bearer" });
}

function finalize(request: Request, response: Response, preflight: boolean): Response {
  const headers = response.headers;
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.append("Vary", "Origin");
  if (!preflight) {
    for (const [name, value] of Object.entries(corsHeaders(request))) headers.set(name, value);
  }
  return response;
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, env);
  },
} satisfies ExportedHandler<Env>;
