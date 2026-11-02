/**
 * How long a Journal read may take before the page stops saying "Loading…" and offers
 * "Try again" instead (2026-11-02: in the Mac app a key read can wait on the macOS keychain,
 * or never answer, and the page must never stay blank). A late answer still shows.
 * An object so tests can shorten it.
 */
export const loadTimeout = { ms: 8000 };
