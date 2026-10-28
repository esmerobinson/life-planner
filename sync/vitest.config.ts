import { createHash, pbkdf2Sync } from "node:crypto";
import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const here = fileURLToPath(new URL(".", import.meta.url));

// Obviously fake test credentials. The Worker under test only ever sees the hash.
const TEST_PASSPHRASE = "test-passphrase-not-real";
const TEST_TOKEN = pbkdf2Sync(TEST_PASSPHRASE, "esmeworld-sync-v1", 200_000, 32, "sha256").toString("hex");
const TEST_TOKEN_HASH = createHash("sha256").update(TEST_TOKEN).digest("hex");

export default defineConfig({
  test: {
    projects: [
      {
        // Runs inside workerd via Miniflare with a real local D1 (SQLite) database.
        plugins: [
          cloudflareTest(async () => ({
            wrangler: { configPath: `${here}wrangler.jsonc` },
            remoteBindings: false,
            miniflare: {
              bindings: {
                SYNC_TOKEN_HASH: TEST_TOKEN_HASH,
                TEST_TOKEN,
                TEST_MIGRATIONS: await readD1Migrations(`${here}migrations`),
              },
            },
          })),
        ],
        test: {
          name: "worker",
          include: ["test/worker/**/*.test.ts"],
          setupFiles: ["test/worker/setup.ts"],
        },
      },
      {
        test: {
          name: "node",
          environment: "node",
          include: ["test/node/**/*.test.ts"],
        },
      },
    ],
  },
});
