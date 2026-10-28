import type { D1Migration } from "cloudflare:test";

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      SYNC_TOKEN_HASH: string;
      TEST_TOKEN: string;
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
