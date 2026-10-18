// electron's main process rewrites headers on youtube / googlevideo / apple music
// requests (see webRequest.onBeforeSendHeaders in electron/main.ts): it swaps the
// client's `x-liner-user-agent` into User-Agent and forces Origin/Referer to the
// service's own site. the innertube client relies on that to look like the
// device profile it claims. android has no main process, so on native we apply
// the same rewrite in front of fetch (capacitor's native http then sends these
// headers as-is).
import { isNativeApp } from "./index";

const USER_AGENT_OVERRIDE = "x-liner-user-agent";
const REWRITE_HOSTS = /(^|\.)(youtube\.com|googlevideo\.com)$|^(api|amp-api)\.music\.apple\.com$/;

// mirrors the origin choice in electron/main.ts
function originFor(url: URL): string {
  if (url.hostname.endsWith("music.apple.com")) return "https://music.apple.com";
  if (url.hostname === "www.youtube.com") return "https://www.youtube.com";
  return "https://music.youtube.com";
}

export function rewriteServiceHeaders(rawUrl: string, headers: Headers): Headers | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (!REWRITE_HOSTS.test(url.hostname)) return null;

  const out = new Headers();
  let userAgent: string | null = null;
  headers.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (lower === USER_AGENT_OVERRIDE) userAgent = value;
    else if (lower !== "origin" && lower !== "referer") out.set(name, value);
  });
  const origin = originFor(url);
  out.set("origin", origin);
  out.set("referer", `${origin}/`);
  if (userAgent) out.set("user-agent", userAgent);
  return out;
}

let installed = false;

export function installNativeRequestHeaderShim(): void {
  if (installed || typeof window === "undefined" || !isNativeApp()) return;
  installed = true;

  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const baseHeaders = init?.headers ?? (input instanceof Request ? input.headers : undefined);
    const rewritten = rewriteServiceHeaders(url, new Headers(baseHeaders));
    if (!rewritten) return nativeFetch(input, init);
    return nativeFetch(input, { ...init, headers: rewritten });
  };
}
