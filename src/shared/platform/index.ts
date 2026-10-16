// runtime platform detection + mobile (capacitor) equivalents for things the
// electron main process does on desktop. everything here is a no-op on desktop
// and in a plain browser tab, so call sites can use it unconditionally.
import { Capacitor } from "@capacitor/core";

// path served by capacitor's local server that proxies GETs through the native
// http stack (CapacitorHttp must be enabled in capacitor.config.ts)
const NATIVE_PROXY_PATH = "/_capacitor_http_interceptor_";

export function isElectron(): boolean {
  return typeof window !== "undefined" && typeof window.linerElectron !== "undefined";
}

// true inside the android (or ios) capacitor shell
export function isNativeApp(): boolean {
  return typeof window !== "undefined" && !isElectron() && Capacitor.isNativePlatform();
}

/**
 * Electron disables webSecurity and injects `access-control-allow-origin: *`
 * on every response, so `<audio crossorigin>`, WebGL cover textures and
 * Web Audio routing all work against third-party CDNs. A WebView enforces
 * CORS, so on native we route cross-origin media through capacitor's native
 * proxy, which makes it same-origin (Range requests are forwarded, so seeking
 * keeps working). Identity on desktop / web and for blob:/data:/relative urls.
 */
export function nativeMediaUrl(url: string): string {
  if (!url || !isNativeApp()) return url;
  if (!/^https?:\/\//i.test(url)) return url;
  if (url.startsWith(window.location.origin + "/")) return url;
  const proxied = new URL(NATIVE_PROXY_PATH, window.location.origin);
  proxied.searchParams.set("u", url);
  return proxied.toString();
}

// whether the renderer should run the wasm signer itself: always in the native
// shell, and on the vite dev server so a plain browser tab can still sign in
// (production web builds stay unsigned, electron signs in its main process)
export function shouldSignInRenderer(): boolean {
  return !isElectron() && (isNativeApp() || import.meta.env.DEV);
}
