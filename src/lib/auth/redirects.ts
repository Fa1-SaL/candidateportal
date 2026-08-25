const PRODUCTION_SITE_ORIGIN = "https://candidate.crossinghurdles.com";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function parseHttpOrigin(value: string | undefined) {
  if (!value) return null;

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function getAppOrigin(
  requestUrl: URL,
  configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL,
  environment = process.env.NODE_ENV,
) {
  if (environment === "production") return PRODUCTION_SITE_ORIGIN;

  const configuredOrigin = parseHttpOrigin(configuredSiteUrl);
  if (configuredOrigin) return configuredOrigin;

  if (LOCAL_HOSTS.has(requestUrl.hostname)) {
    return requestUrl.origin;
  }

  return PRODUCTION_SITE_ORIGIN;
}

export function getSafeRedirectPath(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";

  try {
    const base = new URL(PRODUCTION_SITE_ORIGIN);
    const redirect = new URL(value, base);
    if (redirect.origin !== base.origin) return "/";

    return `${redirect.pathname}${redirect.search}${redirect.hash}`;
  } catch {
    return "/";
  }
}

export const AUTH_VERIFICATION_ERROR_CODE = "verification_failed";
