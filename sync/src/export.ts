// GET /v1/export: every current row's `data`, split by table, streamed page by page so
// memory stays bounded. Pages are read with keyset pagination on the primary key; the
// export is therefore not a single snapshot if a sync lands mid-export (acceptable for
// a nightly single-user backup: every row appears exactly once, in some recent version).
// `data` is spliced in verbatim (it is stored as JSON text).

/** Rows per D1 query (large pages keep the number of queries per invocation low). */
export const EXPORT_PAGE_ROWS = 1000;
/** Data bytes per D1 query (a page always holds at least one row). */
export const EXPORT_PAGE_BYTES = 4 * 1024 * 1024;
const EXPORT_TABLES = ["items", "goals"] as const;

// Like the sync pull: rows past the byte budget come back with NULL data and end the page.
const PAGE_SQL = `
WITH page AS (
  SELECT id, data, length(CAST(data AS BLOB)) AS size FROM rows WHERE tbl = ?1 AND id > ?2 ORDER BY id LIMIT ?3
),
sized AS (
  SELECT *, SUM(size) OVER (ORDER BY id ROWS UNBOUNDED PRECEDING) AS running FROM page
)
SELECT id, CASE WHEN running <= ?4 OR running = size THEN data END AS data FROM sized ORDER BY id`;

export function exportResponse(db: D1Database, now: number, headers: Record<string, string>): Response {
  const encoder = new TextEncoder();
  let tableIndex = 0;
  let after = "";
  let firstInTable = true;
  let started = false;

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!started) {
        started = true;
        controller.enqueue(encoder.encode(`{"exportedAt":${now},"${EXPORT_TABLES[0]}":[`));
        return;
      }
      const table = EXPORT_TABLES[tableIndex];
      if (table === undefined) {
        controller.close();
        return;
      }
      const page = await db
        .prepare(PAGE_SQL)
        .bind(table, after, EXPORT_PAGE_ROWS, EXPORT_PAGE_BYTES)
        .all<{ id: string; data: string | null }>();
      const rows = page.results;
      const included: string[] = [];
      for (const row of rows) {
        if (row.data === null) break;
        included.push(row.data);
        after = row.id;
      }
      let chunk = "";
      if (included.length > 0) {
        chunk += (firstInTable ? "" : ",") + included.join(",");
        firstInTable = false;
      }
      const tableDone = included.length === rows.length && rows.length < EXPORT_PAGE_ROWS;
      if (tableDone) {
        // Close this table's array and open the next one (or end the object).
        tableIndex++;
        after = "";
        firstInTable = true;
        const next = EXPORT_TABLES[tableIndex];
        chunk += next === undefined ? "]}" : `],"${next}":[`;
      }
      controller.enqueue(encoder.encode(chunk));
    },
  });

  return new Response(body, { status: 200, headers: { "Content-Type": "application/json; charset=utf-8", ...headers } });
}
