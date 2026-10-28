# Esmeworld sync server

A small Cloudflare Worker + D1 database that lets every Esmeworld device (Mac app,
iPhone, browsers) keep a full local copy of `items` and `goals` and meet in one place.
One shared passphrase, per-row last-write-wins, nothing ever hard-deleted, free tier only.

The binding contract is [`docs/superpowers/specs/2026-10-28-sync-api.md`](../docs/superpowers/specs/2026-10-28-sync-api.md).
`BUILD-REPORT.md` explains the design decisions and what has not been verified.

## Endpoints

- `GET /v1/health` (no auth): `200 {"ok":true,"version":1}`.
  Use it to check the Worker is up.
- `POST /v1/sync` (Bearer token, JSON, at most 5 MiB and 2000 changes): uploads changed rows (last write wins
  per row) and returns rows changed elsewhere since the caller's `cursor`, 500 at a time (`hasMore`).
- `GET /v1/export` (Bearer token): `{"exportedAt":…,"items":[…],"goals":[…]}` with every current row's data.
  Used for the nightly backup on the Mac.

Errors are always `{"error":"<code>"}`. Every response carries `Cache-Control: no-store`.

## Layout

```
src/index.ts      router, auth pipeline, response headers
src/auth.ts       SHA-256 hex, constant-time compare, Bearer parsing
src/ratelimit.ts  failed-auth limits (per IP and global) in D1 table auth_failures
src/cors.ts       exact-origin allow list
src/http.ts       limits, JSON/error helpers, capped body reading
src/sync.ts       request validation, last-write-wins upserts, the paginated pull
src/export.ts     streamed export
shared/token.ts   passphrase -> token -> hash (WebCrypto only; reusable by the client)
tools/set-passphrase.mjs   sets the SYNC_TOKEN_HASH secret (hidden input)
migrations/0001_init.sql   D1 schema
```

## Tests

```sh
cd sync
npm ci
npm test            # vitest: Worker tests run in workerd/Miniflare with a real local D1
npm run typecheck   # tsc for the Worker code and for the Node-side code
```

Everything runs locally; no Cloudflare account is needed and nothing is contacted.

## Deploy steps (for later, with Esme present; the build agent never deploys)

Hard-won rules:

- **Never use the repo-root `wrangler.jsonc`.** It belongs to the legacy WhatsApp worker.
- Wrangler walks UP the directory tree to find a config when none is given, so a command run in
  the wrong place can silently target the legacy worker. **Always pass `--config` with the absolute
  path to `sync/wrangler.jsonc`**, and run wrangler from an empty directory.
- Use the wrangler installed in `sync/node_modules` (pinned version), not a bare `npx wrangler`
  from another directory (that would download an unpinned copy).

```sh
SYNC=/absolute/path/to/life-planner/sync      # adjust
WRANGLER="$SYNC/node_modules/.bin/wrangler"
CONFIG="$SYNC/wrangler.jsonc"
cd "$SYNC" && npm ci
cd "$(mktemp -d)"                              # an empty directory: nothing to pick up

"$WRANGLER" login                               # once, if not logged in

# 1. Create the database, then put the printed database_id into sync/wrangler.jsonc
#    (replacing the 00000000-… placeholder) and commit it (the id is not a secret).
"$WRANGLER" d1 create esmeworld-sync --config "$CONFIG"

# 2. Apply the schema to the real (remote) database.
"$WRANGLER" d1 migrations apply esmeworld-sync --remote --config "$CONFIG"

# 3. Deploy the Worker (it fails closed with 500 until the secret exists).
"$WRANGLER" deploy --config "$CONFIG"

# 4. Esme sets the passphrase. Hidden input, typed twice, at least 16 characters.
#    Only the derived hash reaches wrangler (via stdin); nothing is printed but "Secret set."
node "$SYNC/tools/set-passphrase.mjs"
#    (Optional rehearsal that touches nothing: node "$SYNC/tools/set-passphrase.mjs" --dry-run
#     prints only the hash length, 64.)

# 5. Verify.
curl -sS https://esmeworld-sync.<your-subdomain>.workers.dev/v1/health   # {"ok":true,"version":1}
```

To change the passphrase later, run step 4 again; every device then needs the new passphrase.
