export interface Env {
  DB: D1Database;
  SYNC_TOKEN_HASH?: string;
  /**
   * Due reminders (due/cron.ts). The bearer token for Due's server: a secret, set by Esme with
   * `wrangler secret put DUE_TOKEN`. Never in the repo, a log or a response. Unset: no reminders.
   */
  DUE_TOKEN?: string;
  /** Due's public address (a plain var in wrangler.jsonc), e.g. "https://host.example". */
  DUE_BASE_URL?: string;
}
