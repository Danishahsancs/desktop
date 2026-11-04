// lyrics for no-account mode. liner's own lyrics service is on its server, so this
// asks lrclib.net, a free public lyrics database, directly.
import type {
  LyricsCandidate,
  LyricsSearchResult,
  LyricsStreamEvent,
} from "../contracts";

const LRCLIB_GET = "https://lrclib.net/api/get";
const PROVIDER = "LRCLIB";
const SYNCED_QUALITY = 85;
const PLAIN_QUALITY = 50;

export interface LyricsHint {
  title: string;
  artist: string;
  durationMs?: number;
}

interface LrclibTrack {
  trackName?: string;
  artistName?: string;
  duration?: number;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

export function toLyricsCandidate(found: LrclibTrack): LyricsCandidate | null {
  const synced = found.syncedLyrics?.trim();
  const plain = found.plainLyrics?.trim();
  const content = synced || plain;
  if (!content) return null;
  const total = synced ? SYNCED_QUALITY : PLAIN_QUALITY;
  return {
    provider: PROVIDER,
    contentKind: synced ? "line_synced" : "plain",
    syncLevel: synced ? "line_level" : "plain",
    matchedTrack: {
      title: found.trackName,
      artists: found.artistName ? [found.artistName] : undefined,
      durationMs: found.duration ? found.duration * 1000 : undefined,
    },
    lyrics: { format: synced ? "lrc" : "plain", content },
    quality: { total, match: total, content: total, sync: total, source: total, reasons: [] },
  };
}

async function fetchCandidate(hint: LyricsHint, signal?: AbortSignal): Promise<LyricsCandidate | null> {
  const params = new URLSearchParams({ track_name: hint.title, artist_name: hint.artist });
  if (hint.durationMs && hint.durationMs > 0) {
    params.set("duration", String(Math.round(hint.durationMs / 1000)));
  }
  const response = await fetch(`${LRCLIB_GET}?${params}`, { signal });
  if (!response.ok) return null;
  return toLyricsCandidate((await response.json()) as LrclibTrack);
}

export async function searchLocalLyrics(hint: LyricsHint, signal?: AbortSignal): Promise<LyricsSearchResult | null> {
  const candidate = await fetchCandidate(hint, signal);
  return candidate ? { provider: PROVIDER, cached: false, candidate } : null;
}

export async function* streamLocalLyrics(hint: LyricsHint | undefined, signal?: AbortSignal): AsyncGenerator<LyricsStreamEvent> {
  const candidate =
    hint?.title.trim() && hint.artist.trim()
      ? await fetchCandidate(hint, signal).catch((err) => {
          if (signal?.aborted) throw err;
          return null;
        })
      : null;
  if (!candidate) {
    yield { type: "provider", provider: PROVIDER, status: "not_found" };
    yield { type: "done", cached: false, status: "not_found" };
    return;
  }
  yield {
    type: "provider",
    provider: PROVIDER,
    status: "found",
    syncLevel: candidate.syncLevel,
    candidate,
  };
  yield {
    type: "done",
    cached: false,
    best: { provider: PROVIDER, quality: candidate.quality.total, syncLevel: candidate.syncLevel },
  };
}
