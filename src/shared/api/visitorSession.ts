/**
 * Client-side YouTube visitorData session manager.
 * Fetches fresh, authentic visitorData directly from the client's residential IP
 * and caches it in-memory / session for up to 6 hours.
 */

interface VisitorSession {
  visitorData: string;
  expiresAt: number;
}

let cachedSession: VisitorSession | null = null;
let pendingFetch: Promise<string> | null = null;

const SESSION_TTL_MS = 5.5 * 60 * 60 * 1000; // 5.5 hours

// visitorData is a base64url protobuf: it always starts "Cg" (field 1), but the
// third character depends on the visitor id youtube hands out ("Cgt", "Cgs",
// "Cgv", ...), so matching a fixed "Cgt" prefix fails for some visitors.
const VISITOR_DATA_RE = /^Cg[A-Za-z0-9_-]{16,}(?:={0,2}|(?:%3D){0,2})$/;

function normalizeVisitorData(token: string): string {
  return token.replace(/%3D/gi, "=");
}

// sw.js_data is ")]}'"-prefixed json; take the first string shaped like a token
export function parseVisitorData(text: string): string | null {
  try {
    const stack: unknown[] = [JSON.parse(text.replace(/^\)\]\}'\s*/, ""))];
    while (stack.length) {
      const node = stack.shift();
      if (typeof node === "string" && VISITOR_DATA_RE.test(node)) return normalizeVisitorData(node);
      if (Array.isArray(node)) stack.push(...node);
      else if (node && typeof node === "object") stack.push(...Object.values(node));
    }
  } catch {
    // not json (format change): fall through to a plain scan
  }
  const match = text.match(/Cg[A-Za-z0-9_-]{20,}(?:(?:%3D){1,2}|={0,2})/);
  return match ? normalizeVisitorData(match[0]) : null;
}

export async function getClientVisitorData(): Promise<string> {
  const now = Date.now();
  if (cachedSession && cachedSession.expiresAt > now) {
    return cachedSession.visitorData;
  }

  if (pendingFetch) {
    return pendingFetch;
  }

  pendingFetch = (async () => {
    try {
      const res = await fetch("https://www.youtube.com/sw.js_data", {
        headers: {
          "user-agent":
            typeof navigator !== "undefined"
              ? navigator.userAgent
              : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });

      if (!res.ok) {
        throw new Error(`sw.js_data returned ${res.status}`);
      }

      const visitorData = parseVisitorData(await res.text());
      if (!visitorData) {
        throw new Error("Could not parse visitorData from sw.js_data");
      }

      cachedSession = {
        visitorData,
        expiresAt: Date.now() + SESSION_TTL_MS,
      };

      console.info(
        `%c[VisitorSession]%c Ready: ${visitorData.slice(0, 16)}... (valid 5.5h)`,
        "color: #10b981; font-weight: bold;",
        "color: inherit;",
      );

      return visitorData;
    } catch (err) {
      console.warn("[VisitorSession] Failed to fetch fresh visitorData:", err);
      // Fallback: if cached exists even if slightly expired, keep it
      if (cachedSession?.visitorData) {
        return cachedSession.visitorData;
      }
      return "";
    } finally {
      pendingFetch = null;
    }
  })();

  return pendingFetch;
}

/**
 * Eagerly warm up the client's visitorData on app launch in the background.
 */
export function initClientVisitorSession(): void {
  void getClientVisitorData().catch(() => {});
}
