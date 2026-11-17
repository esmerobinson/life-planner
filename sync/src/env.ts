export interface Env {
  DB: D1Database;
  SYNC_TOKEN_HASH?: string;
  /**
   * Due reminders (due/cron.ts). The bearer token for Due's server: a secret, set by Esme with
   * `wrangler secret put DUE_TOKEN`. Never in the repo, a log or a response. Unset: no reminders.
   */
  DUE_TOKEN?: string;
  /** Due's address, e.g. "https://host.example" (a secret, so local dev never reaches the real Due). */
  DUE_BASE_URL?: string;
}
