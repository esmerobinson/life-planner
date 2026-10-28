// File-system safety for the transfer script: where it may write, and how.
import { existsSync, mkdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

/** The real path of `p`, even when it does not exist yet (the deepest existing parent is resolved). */
export function realResolve(p: string): string {
  const abs = resolve(p);
  const rest: string[] = [];
  let cur = abs;
  while (!existsSync(cur)) {
    const parent = dirname(cur);
    if (parent === cur) return abs;
    rest.unshift(cur.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)));
    cur = parent;
  }
  return join(realpathSync(cur), ...rest);
}

/** True when `child` is `parent` or lies inside it (compared by real path). */
export function isInside(child: string, parent: string): boolean {
  const c = realResolve(child);
  const p = realResolve(parent);
  return c === p || c.startsWith(p.endsWith(sep) ? p : p + sep);
}

/** The folder that holds `.git`, walking up from `from`; undefined if none. */
export function findRepoRoot(from: string): string | undefined {
  let cur = resolve(from);
  for (;;) {
    if (existsSync(join(cur, ".git"))) return cur;
    const parent = dirname(cur);
    if (parent === cur) return undefined;
    cur = parent;
  }
}

export const REFUSE_PROTECTED =
  "Refusing to write inside your notes vault or this code folder. Choose another folder with --out. Nothing was written.";
export const REFUSE_OVERWRITE =
  "Refusing to overwrite one of the input files. Choose another folder with --out. Nothing was written.";

/**
 * Throws (before anything is written) if any output would land inside a protected folder
 * or on top of an input file.
 */
export function checkOutputs(o: { outputs: string[]; inputs: string[]; protectedDirs: string[] }): void {
  for (const out of o.outputs) {
    if (o.protectedDirs.some((d) => isInside(out, d))) throw new Error(REFUSE_PROTECTED);
  }
  const inputs = new Set(o.inputs.map(realResolve));
  for (const out of o.outputs) {
    if (inputs.has(realResolve(out))) throw new Error(REFUSE_OVERWRITE);
  }
}

/**
 * Writes every file as a private (0600) temp file first, then renames them into place, so a
 * file is never briefly readable by others and a failure leaves no half-written output.
 */
export function writeAllPrivate(files: { path: string; text: string }[]): void {
  const temps: { tmp: string; path: string }[] = [];
  try {
    for (const f of files) {
      mkdirSync(dirname(f.path), { recursive: true, mode: 0o700 });
      const tmp = `${f.path}.tmp-${process.pid}`;
      writeFileSync(tmp, f.text, { mode: 0o600, flag: "wx" });
      temps.push({ tmp, path: f.path });
    }
    for (const t of temps) renameSync(t.tmp, t.path);
  } catch (e) {
    for (const t of temps) {
      try {
        unlinkSync(t.tmp);
      } catch {
        // already moved or never written
      }
    }
    throw e;
  }
}
