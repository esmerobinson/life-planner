// CORS: exact-match allow list (plus single-label Pages preview subdomains). Never "*",
// never credentials. Requests without Origin (server-to-server) get no CORS headers.

const EXACT_ORIGINS = new Set([
  "https://life-hub-eoy.pages.dev",
  "esmeworld://app",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:4173",
]);

/** Preview deployments: https://<one lowercase DNS label>.life-hub-eoy.pages.dev */
const PREVIEW_ORIGIN = /^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.life-hub-eoy\.pages\.dev$/;

export const ALLOWED_METHODS = "GET, POST, OPTIONS";
export const ALLOWED_HEADERS = "Authorization, Content-Type";
export const PREFLIGHT_MAX_AGE = "600";

export function isAllowedOrigin(origin: string | null): origin is string {
  if (!origin) return false;
  return EXACT_ORIGINS.has(origin) || PREVIEW_ORIGIN.test(origin);
}

/** Headers for an actual (non-preflight) response. */
export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin");
  if (!isAllowedOrigin(origin)) return {};
  return { "Access-Control-Allow-Origin": origin, "Access-Control-Expose-Headers": "Retry-After" };
}

/** Headers for a preflight (OPTIONS) response. */
export function preflightHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin");
  if (!isAllowedOrigin(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": ALLOWED_METHODS,
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
    "Access-Control-Max-Age": PREFLIGHT_MAX_AGE,
  };
}
