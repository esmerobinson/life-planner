import { env } from "cloudflare:workers";
import { expect } from "vitest";
import type { Env } from "../../src/env";
import { handle, type Deps } from "../../src/index";

export const BASE = "https://sync.test";
export const T0 = 1_790_000_000_000; // a fixed "now" for tests (ms)
export const DEVICE_A = "device-aaaa";
export const DEVICE_B = "device-bbbb";
export const DEVICE_C = "device-cccc";

export interface CallOptions {
  method?: string;
  token?: string | null; // undefined = the valid test token; null = no Authorization header
  authorization?: string; // raw Authorization header (overrides token)
  body?: unknown; // JSON-encoded
  rawBody?: BodyInit; // sent as-is
  contentType?: string | null;
  ip?: string;
  origin?: string;
  headers?: Record<string, string>;
  now?: number;
  deps?: Partial<Deps>;
  envOverride?: Record<string, unknown>;
}

/** Calls the Worker's handler directly with the test env and an injected clock. */
export async function call(path: string, opts: CallOptions = {}): Promise<Response> {
  const headers = new Headers(opts.headers);
  if (opts.authorization !== undefined) headers.set("Authorization", opts.authorization);
  else if (opts.token !== null) headers.set("Authorization", `Bearer ${opts.token ?? env.TEST_TOKEN}`);
  headers.set("CF-Connecting-IP", opts.ip ?? "203.0.113.1");
  if (opts.origin) headers.set("Origin", opts.origin);
  let body: BodyInit | undefined;
  if (opts.rawBody !== undefined) body = opts.rawBody;
  else if (opts.body !== undefined) body = JSON.stringify(opts.body);
  if (body !== undefined && opts.contentType !== null) headers.set("Content-Type", opts.contentType ?? "application/json");
  const request = new Request(`${BASE}${path}`, { method: opts.method ?? (body === undefined ? "GET" : "POST"), headers, body });
  const workerEnv = (opts.envOverride ? { ...env, ...opts.envOverride } : env) as Env;
  const response = await handle(request, workerEnv, { now: () => opts.now ?? T0, ...opts.deps });
  assertUniversalHeaders(response);
  return response;
}

/** Invariants that hold for every single response. */
export function assertUniversalHeaders(response: Response): void {
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("Access-Control-Allow-Origin")).not.toBe("*");
  expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull();
}

export async function errorOf(response: Response): Promise<string> {
  const body = (await response.json()) as Record<string, unknown>;
  expect(Object.keys(body)).toEqual(["error"]);
  expect(typeof body.error).toBe("string");
  return body.error as string;
}

export interface Change {
  table: string;
  id: string;
  updatedAt: number;
  data: unknown;
}

export interface SyncBody {
  cursor: number;
  applied: number;
  ignored: number;
  hasMore: boolean;
  changes: Change[];
}

export function change(id: string, updatedAt: number, data: unknown = { title: id }, table = "items"): Change {
  return { table, id, updatedAt, data };
}

export async function sync(
  deviceId: string,
  cursor: number,
  changes: unknown[],
  opts: CallOptions = {},
): Promise<{ status: number; body: SyncBody; text: string }> {
  const response = await call("/v1/sync", { method: "POST", body: { deviceId, cursor, changes }, ...opts });
  const text = await response.text();
  return { status: response.status, body: response.status === 200 ? (JSON.parse(text) as SyncBody) : (undefined as never), text };
}

export async function syncOk(deviceId: string, cursor: number, changes: unknown[], opts: CallOptions = {}): Promise<SyncBody> {
  const result = await sync(deviceId, cursor, changes, opts);
  if (result.status !== 200) throw new Error(`sync failed: ${result.status} ${result.text}`);
  return result.body;
}

export interface StoredRow {
  tbl: string;
  id: string;
  updated_at: number;
  device_id: string;
  seq: number;
  data: string;
}

export async function storedRows(): Promise<StoredRow[]> {
  const result = await env.DB.prepare("SELECT tbl, id, updated_at, device_id, seq, data FROM rows ORDER BY tbl, id").all<StoredRow>();
  return result.results;
}

export async function seqCounter(): Promise<number> {
  const row = await env.DB.prepare("SELECT value FROM meta WHERE key = 'seq'").first<{ value: number }>();
  return row?.value ?? -1;
}

/** Pulls every row after `cursor` for `deviceId`, following `hasMore`. */
export async function pullAll(deviceId: string, cursor = 0, opts: CallOptions = {}): Promise<{ changes: Change[]; cursor: number; pages: SyncBody[] }> {
  const all: Change[] = [];
  const pages: SyncBody[] = [];
  for (let i = 0; i < 1000; i++) {
    const page = await syncOk(deviceId, cursor, [], opts);
    pages.push(page);
    all.push(...page.changes);
    cursor = page.cursor;
    if (!page.hasMore) return { changes: all, cursor, pages };
  }
  throw new Error("pullAll did not terminate");
}
