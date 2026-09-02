// Tracking parameters safe to remove before caching/dedup. Meaningful query
// parameters are preserved: removing arbitrary params can change page content.
const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "fbclid",
]);

// Normalizes a URL for deduplication and cache-keying: lowercase host, no
// fragment, no default port, tracking params stripped. Path case and non-tracking
// query params are preserved (both can be meaningful).
export function canonicalizeUrl(value: string): string {
  const url = new URL(value);
  url.hostname = url.hostname.toLowerCase();
  url.hash = "";
  if (
    (url.protocol === "http:" && url.port === "80") ||
    (url.protocol === "https:" && url.port === "443")
  ) {
    url.port = "";
  }
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) {
      url.searchParams.delete(key);
    }
  }
  return url.toString();
}

// Deduplicates URLs by canonical form, preserving first-occurrence order.
export function dedupeUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const url of urls) {
    const canonical = canonicalizeUrl(url);
    if (!seen.has(canonical)) {
      seen.add(canonical);
      result.push(canonical);
    }
  }
  return result;
}