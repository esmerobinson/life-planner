import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../../src", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith(".ts") ? [path] : [];
  });
}

describe("no sensitive logging in sync/src", () => {
  const files = sourceFiles(SRC);

  it("finds the source files", () => {
    expect(files.length).toBeGreaterThan(3);
  });

  it("never calls console.log / info / debug / warn / trace / dir / table", () => {
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/console\s*\.\s*(log|info|debug|warn|trace|dir|table)\b/);
      expect(text, file).not.toMatch(/console\s*\[/);
    }
  });

  it("only logs fixed, non-sensitive values with console.error", () => {
    for (const file of files) {
      const lines = readFileSync(file, "utf8").split("\n");
      for (const line of lines.filter((l) => /console\s*\.\s*error/.test(l))) {
        expect(line, `${file}: ${line}`).not.toMatch(/authorization|request|headers|body|token|passphrase|secret|text|data|message|stack|\.\.\./i);
      }
    }
  });

  it("never logs the Authorization header", () => {
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/console[^;]*Authorization/is);
    }
  });
});
