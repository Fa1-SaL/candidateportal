const PRODUCTION_SITE_ORIGIN = "https://candidate.crossinghurdles.com";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const SENSITIVE_QUERY_KEYS = new Set(["token_hash", "token", "access_token", "refresh_token", "code", "type", "next", "error", "error_description"]);

function parseHttpOrigin(value: string | undefined, environment: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
    if (environment === "production" && (url.protocol !== "https:" || LOCAL_HOSTS.has(url.hostname))) return null;
    if (url.protocol !== "https:" && !(url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname))) return null;
    return url.origin;
  } catch { return null; }
}

export function getAppOrigin(
  requestUrl: URL,
  configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL,
  environment = process.env.NODE_ENV,
) {
  // A deployment-owned HTTPS origin supports staging. Never derive production
  // redirects from Host/X-Forwarded-Host or arbitrary request origins.
  const configuredOrigin = parseHttpOrigin(configuredSiteUrl, environment);
  if (configuredOrigin) return configuredOrigin;
  if (environment !== "production" && LOCAL_HOSTS.has(requestUrl.hostname) && ["http:", "https:"].includes(requestUrl.protocol)) return requestUrl.origin;
  return PRODUCTION_SITE_ORIGIN;
}

export function getSafeRedirectPath(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u0020]/.test(value)) return "/";
  try {
    const base = new URL(PRODUCTION_SITE_ORIGIN);
    const redirect = new URL(value, base);
    if (redirect.origin !== base.origin) return "/";
    for (const key of [...redirect.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) redirect.searchParams.delete(key);
    }
    // Fragments can contain implicit-flow credentials. Keep ordinary anchors only.
    const hash = /^#[a-zA-Z][a-zA-Z0-9_-]*$/.test(redirect.hash) ? redirect.hash : "";
    return redirect.pathname + redirect.search + hash;
  } catch { return "/"; }
}

export const AUTH_VERIFICATION_ERROR_CODE = "verification_failed";
export function containsAuthParameters(keys: string[]) {
  return keys.some(key => SENSITIVE_QUERY_KEYS.has(key.toLowerCase()));
}
