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
export const MAX_RESPONSE_DATA_BYTES = 1024 * 1024;
/** Maximum size of one JSON chunk bound as a single D1 parameter (D1 caps strings at 2 MB). */
export const DEFAULT_CHUNK_BYTES = 1_900_000;

/**
 * The synced tables. "files": pictures on pages (base64 JPEG rows, kept under 1 MB by the
 * app). "journal": end-to-end encrypted journal entries (the server only ever sees `id`,
 * `kind`, `date`, `iv` and the ciphertext `ct`; it cannot read them).
 */
const TABLES = new Set(["items", "goals", "files", "journal"]);
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

// Returned winners, per chunk, run after ALL upserts of the request: for every (table, id)
// named in the chunk, the stored row plus whether it is exactly a version the chunk sent
// (same deviceId, updatedAt AND data). `data` is only returned when it is not.
const WINNERS_SQL = `
WITH c AS MATERIALIZED (
  SELECT json_extract(value, '$.t') AS tbl,
         json_extract(value, '$.i') AS id,
         json_extract(value, '$.u') AS u,
         json_extract(value, '$.d') AS d
  FROM json_each(?1)
),
k AS (
  SELECT r.tbl, r.id, r.updated_at, r.seq, r.data,
         MAX(r.device_id = ?2 AND c.u = r.updated_at AND c.d = r.data) AS matched
  FROM c JOIN rows AS r ON r.tbl = c.tbl AND r.id = c.id
  GROUP BY r.tbl, r.id
)
SELECT tbl, id, updated_at, seq, matched, CASE WHEN matched THEN NULL ELSE data END AS data FROM k`;

const CURRENT_SEQ_SQL = "SELECT value FROM meta WHERE key = 'seq'";

interface PulledRow {
  tbl: string;
  id: string;
  updated_at: number;
  seq: number;
  data: string | null;
}

interface WinnerRow extends PulledRow {
  matched: number;
}

export interface SyncOptions {
  chunkBytes: number;
}

function rowJson(r: PulledRow): string {
  // `data` is spliced in verbatim (it is already JSON text), so it round-trips byte-for-byte.
  return `{"table":${JSON.stringify(r.tbl)},"id":${JSON.stringify(r.id)},"updatedAt":${r.updated_at},"data":${r.data}}`;
}

/**
 * Applies the changes and pulls, atomically (one D1 batch). Returns the response body as JSON text.
 * Response `changes` = paged rows (seq > cursor, exclusion rule, at most PAGE_SIZE / the byte
 * budget) followed by "returned winners" (stored rows for this request's ids that are not
 * exactly a version this request sent), each (table, id) at most once.
 */
export async function runSync(db: D1Database, request: SyncRequest, options: SyncOptions): Promise<string> {
  const current = await db.prepare(CURRENT_SEQ_SQL).first<{ value: number }>();
  if (request.cursor > (current?.value ?? 0)) throw new HttpError(409, "cursor_ahead");

  const chunks = chunkEntries(request.changes, options.chunkBytes);
  const statements: D1PreparedStatement[] = [];
  for (const chunk of chunks) {
    statements.push(db.prepare(UPSERT_SQL).bind(chunk, request.deviceId));
    statements.push(db.prepare(BUMP_COUNTER_SQL));
  }
  for (const chunk of chunks) statements.push(db.prepare(WINNERS_SQL).bind(chunk, request.deviceId));
  const exclusions = JSON.stringify(request.changes.map((c) => [c.table, c.id, c.updatedAt]));
  statements.push(
    db.prepare(PULL_SQL).bind(request.cursor, request.deviceId, exclusions, PAGE_SIZE + 1, MAX_RESPONSE_DATA_BYTES),
  );
  statements.push(db.prepare(CURRENT_SEQ_SQL));

  const results = await db.batch(statements);

  let applied = 0;
  for (let i = 0; i < chunks.length; i++) applied += results[2 * i]!.results.length;
  const winnerResults = results.slice(2 * chunks.length, 3 * chunks.length);
  const pulled = results.at(-2)!.results as unknown as PulledRow[];
  const maxSeq = (results.at(-1)!.results[0] as { value: number } | undefined)?.value ?? 0;

  const paged: PulledRow[] = [];
  for (const row of pulled) {
    if (paged.length === PAGE_SIZE || row.data === null) break;
    paged.push(row);
  }
  const hasMore = pulled.length > paged.length;
  // Without more pages, every row up to maxSeq was either sent or is the caller's own version.
  const cursor = hasMore ? Math.max(request.cursor, paged.at(-1)?.seq ?? 0) : Math.max(request.cursor, maxSeq);

  const key = (r: { tbl: string; id: string }) => JSON.stringify([r.tbl, r.id]);
  const matched = new Set<string>();
  const candidates = new Map<string, PulledRow>();
  for (const result of winnerResults) {
    for (const row of result.results as unknown as WinnerRow[]) {
      if (row.matched) matched.add(key(row));
      else candidates.set(key(row), row);
    }
  }
  const pagedKeys = new Set(paged.map(key));
  const winners = [...candidates.entries()]
    .filter(([k]) => !matched.has(k) && !pagedKeys.has(k))
    .map(([, row]) => row)
    .sort((a, b) => a.seq - b.seq);

  const changes = [...paged, ...winners].map(rowJson).join(",");
  return `{"cursor":${cursor},"applied":${applied},"ignored":${request.changes.length - applied},"hasMore":${hasMore},"changes":[${changes}]}`;
}
