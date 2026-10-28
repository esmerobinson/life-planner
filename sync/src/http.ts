// HTTP helpers: limits, JSON responses, compact errors and capped body reading.

/** Maximum request body for POST /v1/sync (5 MiB). */
export const MAX_BODY_BYTES = 5 * 1024 * 1024;
/** Maximum number of changes in one sync request. */
export const MAX_CHANGES = 2000;
/** `updatedAt` may be at most this far ahead of the server clock. */
export const MAX_FUTURE_MS = 24 * 60 * 60 * 1000;
/** Maximum length of a row id (UTF-16 code units). */
export const MAX_ID_LENGTH = 128;
/**
 * Maximum size of one change as handed to D1: the UTF-8 bytes of
 * JSON.stringify({ t, i, u, d: JSON.stringify(data) }). Keeps every bound
 * parameter and every stored row well under D1's 2 MB string/row limit.
 */
export const MAX_ROW_BYTES = 1_000_000;

export type ErrorCode =
  | "bad_request"
  | "bad_json"
  | "bad_device_id"
  | "bad_cursor"
  | "bad_changes"
  | "bad_change"
  | "too_many_changes"
  | "row_too_large"
  | "unauthorized"
  | "not_found"
  | "method_not_allowed"
  | "payload_too_large"
  | "unsupported_media_type"
  | "rate_limited"
  | "server_misconfigured"
  | "internal";

/** Thrown by request parsing/validation; turned into `{ "error": code }` by the router. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    readonly headers: Record<string, string> = {},
  ) {
    super(code);
    this.name = "HttpError";
  }
}

export function jsonText(status: number, text: string, headers: Record<string, string> = {}): Response {
  return new Response(text, { status, headers: { "Content-Type": "application/json; charset=utf-8", ...headers } });
}

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return jsonText(status, JSON.stringify(body), headers);
}

export function errorResponse(status: number, code: ErrorCode, headers: Record<string, string> = {}): Response {
  return json(status, { error: code }, headers);
}

/** True when the Content-Type's media type is exactly application/json (parameters allowed). */
export function isJsonContentType(value: string | null): boolean {
  if (!value) return false;
  const mediaType = value.split(";", 1)[0]!.trim().toLowerCase();
  return mediaType === "application/json";
}

/** Reads and parses a JSON body, enforcing `maxBytes` even when Content-Length is absent or wrong. */
export async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  if (!isJsonContentType(request.headers.get("Content-Type"))) throw new HttpError(415, "unsupported_media_type");
  const declared = request.headers.get("Content-Length");
  if (declared !== null && Number(declared) > maxBytes) throw new HttpError(413, "payload_too_large");

  const bytes = new Uint8Array(await readCapped(request, maxBytes));
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw new HttpError(400, "bad_json");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpError(400, "bad_json");
  }
}

async function readCapped(request: Request, maxBytes: number): Promise<ArrayBuffer> {
  if (!request.body) return new ArrayBuffer(0);
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new HttpError(413, "payload_too_large");
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out.buffer;
}

const encoder = new TextEncoder();
export function utf8Length(text: string): number {
  return encoder.encode(text).byteLength;
}
