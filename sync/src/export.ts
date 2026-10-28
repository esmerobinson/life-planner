// GET /v1/export: every current row's `data`, split by table, streamed page by page so
// memory stays bounded. Pages are read with keyset pagination on the primary key; the
// export is therefore not a single snapshot if a sync lands mid-export (acceptable for
// a nightly single-user backup: every row appears exactly once, in some recent version).
// `data` is spliced in verbatim (it is stored as JSON text).

const EXPORT_PAGE_ROWS = 100;
const EXPORT_TABLES = ["items", "goals"] as const;

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
        .prepare("SELECT id, data FROM rows WHERE tbl = ?1 AND id > ?2 ORDER BY id LIMIT ?3")
        .bind(table, after, EXPORT_PAGE_ROWS)
        .all<{ id: string; data: string }>();
      let chunk = "";
      if (page.results.length > 0) {
        chunk += (firstInTable ? "" : ",") + page.results.map((r) => r.data).join(",");
        firstInTable = false;
        after = page.results.at(-1)!.id;
      }
      if (page.results.length < EXPORT_PAGE_ROWS) {
        // This table is finished: close its array and open the next one (or the object).
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
