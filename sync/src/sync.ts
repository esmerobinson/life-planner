// POST /v1/sync: validation, per-row last-write-wins, and the paginated pull.
//
// Everything that touches the database for one request runs as ONE D1 batch, which
// D1 executes as a single transaction: either every write and the pull happen, or
// nothing does.

import {
  HttpError,
  MAX_CHANGES,
  MAX_FUTURE_MS,
  MAX_ID_LENGTH,
  MAX_ROW_BYTES,
  utf8Length,
} from "./http";

/** Maximum rows returned per response. */
export const PAGE_SIZE = 500;
/**
 * Maximum total `data` bytes per response (a page always holds at least one row).
 * Keeps responses, and the Worker's memory, bounded even when rows are large.
 */
export const MAX_RESPONSE_DATA_BYTES = 4 * 1024 * 1024;
/** Maximum size of one JSON chunk bound as a single D1 parameter (D1 caps strings at 2 MB). */
export const DEFAULT_CHUNK_BYTES = 1_900_000;

const TABLES = new Set(["items", "goals"]);
const DEVICE_ID = /^[A-Za-z0-9_-]{8,64}$/;

export interface ValidChange {
  table: string;
  id: string;
  updatedAt: number;
  /** The change serialized for D1: {"t","i","u","d": JSON text of data}. */
  entry: string;
  entryBytes: number;
}

export interface SyncRequest {
  deviceId: string;
  cursor: number;
  changes: ValidChange[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validates a parsed request body. Throws HttpError(400) on the first problem; nothing is applied. */
export function validateSyncRequest(body: unknown, now: number): SyncRequest {
  if (!isPlainObject(body)) throw new HttpError(400, "bad_request");
  const { deviceId, cursor, changes } = body;
  if (typeof deviceId !== "string" || !DEVICE_ID.test(deviceId)) throw new HttpError(400, "bad_device_id");
  if (typeof cursor !== "number" || !Number.isSafeInteger(cursor) || cursor < 0) throw new HttpError(400, "bad_cursor");
  if (!Array.isArray(changes)) throw new HttpError(400, "bad_changes");
  if (changes.length > MAX_CHANGES) throw new HttpError(400, "too_many_changes");

  const latest = now + MAX_FUTURE_MS;
  const valid: ValidChange[] = [];
  for (const raw of changes as unknown[]) {
    if (!isPlainObject(raw)) throw new HttpError(400, "bad_change");
    const { table, id, updatedAt, data } = raw;
    if (typeof table !== "string" || !TABLES.has(table)) throw new HttpError(400, "bad_change");
    if (typeof id !== "string" || id.length === 0 || id.length > MAX_ID_LENGTH || !id.isWellFormed()) {
      throw new HttpError(400, "bad_change");
    }
    if (typeof updatedAt !== "number" || !Number.isSafeInteger(updatedAt) || updatedAt <= 0 || updatedAt > latest) {
      throw new HttpError(400, "bad_change");
    }
    if (!isPlainObject(data)) throw new HttpError(400, "bad_change");
    const entry = JSON.stringify({ t: table, i: id, u: updatedAt, d: JSON.stringify(data) });
    const entryBytes = utf8Length(entry);
    if (entryBytes > MAX_ROW_BYTES) throw new HttpError(400, "row_too_large");
    valid.push({ table, id, updatedAt, entry, entryBytes });
  }
  return { deviceId, cursor, changes: valid };
}

/** Groups serialized changes into JSON arrays of at most `maxBytes` (a lone oversize entry gets its own chunk). */
export function chunkEntries(changes: ValidChange[], maxBytes: number): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  let size = 2; // "[" + "]"
  for (const change of changes) {
    const added = change.entryBytes + (current.length > 0 ? 1 : 0);
    if (current.length > 0 && size + added > maxBytes) {
      chunks.push(`[${current.join(",")}]`);
      current = [];
      size = 2;
    }
    size += change.entryBytes + (current.length > 0 ? 1 : 0);
    current.push(change.entry);
  }
  if (current.length > 0) chunks.push(`[${current.join(",")}]`);
  return chunks;
}

// Upsert one chunk. Each candidate row gets seq = counter + 1 + its index in the chunk;
// it is written only if new, newer, or equally new from a greater deviceId. SQLite
// processes the rows in order, so duplicate ids inside one request resolve correctly.
// RETURNING yields one row per write actually made.
const UPSERT_SQL = `
INSERT INTO rows (tbl, id, updated_at, device_id, seq, data)
SELECT json_extract(c.value, '$.t'),
       json_extract(c.value, '$.i'),
       json_extract(c.value, '$.u'),
       ?2,
       (SELECT value FROM meta WHERE key = 'seq') + 1 + c.key,
       json_extract(c.value, '$.d')
FROM json_each(?1) AS c
WHERE true
ORDER BY c.key
ON CONFLICT (tbl, id) DO UPDATE SET
  updated_at = excluded.updated_at,
  device_id  = excluded.device_id,
  seq        = excluded.seq,
  data       = excluded.data
WHERE excluded.updated_at > rows.updated_at
   OR (excluded.updated_at = rows.updated_at AND excluded.device_id > rows.device_id)
RETURNING seq`;

// Advance the counter to the highest seq in use (unchanged when nothing was written,
// so an ignored replay leaves the database byte-for-byte identical).
const BUMP_COUNTER_SQL = `
UPDATE meta SET value = MAX(value, COALESCE((SELECT MAX(seq) FROM rows), 0)) WHERE key = 'seq'`;

// The pull. Exclusion: a row is hidden only if it belongs to the caller's deviceId AND
// this request carries exactly that version (same table, id and updatedAt), i.e. the
// row was written by this request (or by an identical earlier one being replayed).
// At most PAGE_SIZE + 1 candidates are read; `data` is withheld (NULL) for rows past the
// byte budget so they only signal "more remains".
const PULL_SQL = `
WITH ex AS MATERIALIZED (
  SELECT json_extract(value, '$[0]') AS tbl,
         json_extract(value, '$[1]') AS id,
         json_extract(value, '$[2]') AS u
  FROM json_each(?3)
),
cand AS (
  SELECT r.tbl, r.id, r.updated_at, r.seq, r.data, length(CAST(r.data AS BLOB)) AS size
  FROM rows AS r
  LEFT JOIN ex ON r.device_id = ?2 AND ex.tbl = r.tbl AND ex.id = r.id AND ex.u = r.updated_at
  WHERE r.seq > ?1 AND ex.tbl IS NULL
  ORDER BY r.seq
  LIMIT ?4
),
sized AS (
  SELECT *, SUM(size) OVER (ORDER BY seq ROWS UNBOUNDED PRECEDING) AS running FROM cand
)
SELECT tbl, id, updated_at, seq, CASE WHEN running <= ?5 OR running = size THEN data END AS data
FROM sized
ORDER BY seq`;

interface PulledRow {
  tbl: string;
  id: string;
  updated_at: number;
  seq: number;
  data: string | null;
}

export interface SyncOptions {
  chunkBytes: number;
}

/** Applies the changes and pulls, atomically. Returns the response body as JSON text. */
export async function runSync(db: D1Database, request: SyncRequest, options: SyncOptions): Promise<string> {
  const statements: D1PreparedStatement[] = [];
  for (const chunk of chunkEntries(request.changes, options.chunkBytes)) {
    statements.push(db.prepare(UPSERT_SQL).bind(chunk, request.deviceId));
    statements.push(db.prepare(BUMP_COUNTER_SQL));
  }
  const exclusions = JSON.stringify(request.changes.map((c) => [c.table, c.id, c.updatedAt]));
  statements.push(
    db.prepare(PULL_SQL).bind(request.cursor, request.deviceId, exclusions, PAGE_SIZE + 1, MAX_RESPONSE_DATA_BYTES),
  );

  const results = await db.batch(statements);

  let applied = 0;
  for (let i = 0; i < results.length - 1; i += 2) applied += results[i]!.results.length;
  const pulled = results.at(-1)!.results as unknown as PulledRow[];

  const included: PulledRow[] = [];
  for (const row of pulled) {
    if (included.length === PAGE_SIZE || row.data === null) break;
    included.push(row);
  }
  const hasMore = pulled.length > included.length;
  const cursor = included.length > 0 ? included.at(-1)!.seq : request.cursor;

  // `data` is spliced in verbatim (it is already JSON text), so it round-trips byte-for-byte.
  const changes = included
    .map((r) => `{"table":${JSON.stringify(r.tbl)},"id":${JSON.stringify(r.id)},"updatedAt":${r.updated_at},"data":${r.data}}`)
    .join(",");
  return `{"cursor":${cursor},"applied":${applied},"ignored":${request.changes.length - applied},"hasMore":${hasMore},"changes":[${changes}]}`;
}
