const RESERVED = new Set(["www", "app", "api", "localhost", "preview"]);

// Detects tenant slug from a subdomain (e.g. savona.ingastro.pl → "savona").
// The platform preview host (REACT_APP_BACKEND_URL) is never treated as a store.
export function detectStoreSlug() {
  const host = window.location.hostname;
  let appHost = "";
  try {
    appHost = new URL(process.env.REACT_APP_BACKEND_URL).hostname;
  } catch {
    appHost = "";
  }
  if (!host || host === appHost || host === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;
  const parts = host.split(".");
  if (parts.length < 3) return null;
  const first = parts[0].toLowerCase();
  if (RESERVED.has(first)) return null;
  if (appHost && host.endsWith("." + appHost.split(".").slice(1).join("."))) {
    // e.g. foo.preview.emergentagent.com – sibling preview hosts are not stores
    return null;
  }
  return first;
}

export const money = (v) => `${Number(v || 0).toFixed(2)} zł`;
