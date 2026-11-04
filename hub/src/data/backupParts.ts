// A backup file in pieces, so it never has to be ONE string. A browser cannot make a string
// longer than about 536 million characters (Chrome/V8), and pictures are stored as base64
// text of up to ~1 MB each, so a hub with ~800 photos could not be backed up or restored.
// The file itself is unchanged: `backupParts` joined is exactly JSON.stringify(file, null, 2),
// and `readBackupJson` gives what JSON.parse would, so every app version reads every backup.

/** Two-space JSON (as JSON.stringify(value, null, 2)), with each top-level array row its own piece. */
export function backupParts(file: object): string[] {
  const parts: string[] = ["{"];
  let first = true;
  for (const [key, value] of Object.entries(file)) {
    const many = Array.isArray(value) && value.length > 0;
    const text = many ? "" : (JSON.stringify(value, null, 2) as string | undefined);
    if (text === undefined) continue; // left out, as JSON.stringify leaves it out
    parts.push(`${first ? "\n" : ",\n"}  ${JSON.stringify(key)}: `);
    first = false;
    if (many) {
      parts.push("[");
      (value as unknown[]).forEach((row, i) => {
        const one = (JSON.stringify(row, null, 2) as string | undefined) ?? "null";
        // A JSON text has no raw new lines inside strings, so this only moves lines in.
        parts.push(`${i > 0 ? "," : ""}\n    ${one.replace(/\n/g, "\n    ")}`);
      });
      parts.push("\n  ]");
    } else {
      parts.push(text.replace(/\n/g, "\n  "));
    }
  }
  parts.push(first ? "}" : "\n}");
  return parts;
}

/** The file is not JSON (or not a JSON object at its top). */
export class NotJsonError extends Error {}

const CHUNK_BYTES = 8 * 1024 * 1024;
const PLACEHOLDER = "\u0000rows:";

/**
 * Reads a JSON file whose top is an object, as JSON.parse would, without ever making the
 * whole text one string: each row of a top-level array is parsed on its own. Throws
 * NotJsonError when the text is not JSON; a read problem throws as the browser reports it.
 */
export async function readBackupJson(blob: Blob, chunkBytes = CHUNK_BYTES): Promise<unknown> {
  const decoder = new TextDecoder("utf-8");
  const reader = new JsonPieces();
  for (let at = 0; at < blob.size; at += chunkBytes) {
    const bytes = await readBytes(blob.slice(at, Math.min(at + chunkBytes, blob.size)));
    reader.push(decoder.decode(bytes, { stream: true }));
  }
  reader.push(decoder.decode());
  return reader.end();
}

function readBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error ?? new Error("read failed"));
    r.readAsArrayBuffer(blob);
  });
}

const parse = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    throw new NotJsonError("not JSON");
  }
};

/**
 * Splits the text as it arrives: everything outside the top-level arrays goes into `head`
 * (with a placeholder string where each array was), each top-level array row is parsed as
 * soon as it is complete. Strings are skipped quickly (a picture's data is one long string).
 */
class JsonPieces {
  private head = "";
  private row = "";
  private rows: unknown[][] = [];
  private current: unknown[] | null = null;
  private depth = 0;
  private inString = false;
  private escaped = false;
  private started = false;

  push(text: string): void {
    let from = 0; // start of the text not yet copied into head/row
    let i = 0;
    const n = text.length;
    while (i < n) {
      if (this.inString) {
        if (this.escaped) {
          this.escaped = false;
          i++;
          continue;
        }
        // Jump to the next quote or backslash.
        let q = text.indexOf('"', i);
        let b = text.indexOf("\\", i);
        if (q === -1) q = n;
        if (b === -1) b = n;
        if (b < q) {
          this.escaped = true;
          i = b + 1;
        } else {
          if (q < n) this.inString = false;
          i = q + 1;
        }
        continue;
      }
      const c = text[i]!;
      if (!this.started) {
        if (c === " " || c === "\n" || c === "\r" || c === "\t" || c === "﻿") {
          i++;
          continue;
        }
        if (c !== "{") throw new NotJsonError("not a JSON object");
        this.started = true;
      }
      if (c === '"') this.inString = true;
      else if (c === "{" || c === "[") {
        if (this.depth === 1 && c === "[") {
          // A top-level array: its rows are parsed one by one.
          this.head += text.slice(from, i) + JSON.stringify(PLACEHOLDER + this.rows.length);
          this.current = [];
          this.rows.push(this.current);
          from = i + 1;
        }
        this.depth++;
      } else if (c === "}" || c === "]") {
        if (this.current && this.depth === 2) {
          if (c !== "]") throw new NotJsonError("unbalanced");
          this.row += text.slice(from, i);
          if (this.row.trim() !== "" || this.current.length > 0) this.current.push(parse(this.row));
          this.row = "";
          this.current = null;
          from = i + 1;
        }
        this.depth--;
        if (this.depth < 0) throw new NotJsonError("unbalanced");
      } else if (c === "," && this.current && this.depth === 2) {
        this.row += text.slice(from, i);
        this.current.push(parse(this.row));
        this.row = "";
        from = i + 1;
      }
      i++;
    }
    if (this.current) this.row += text.slice(from);
    else this.head += text.slice(from);
  }

  end(): unknown {
    if (!this.started || this.inString || this.depth !== 0 || this.current) throw new NotJsonError("unfinished");
    const top = parse(this.head) as Record<string, unknown>;
    for (const key of Object.keys(top)) {
      const v = top[key];
      if (typeof v === "string" && v.startsWith(PLACEHOLDER)) top[key] = this.rows[Number(v.slice(PLACEHOLDER.length))];
    }
    return top;
  }
}
