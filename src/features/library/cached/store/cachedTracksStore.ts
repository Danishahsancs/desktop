import { create } from "zustand";
import { audioCache, linerDb } from "@/shared/storage";
import type { Track } from "@/shared/types";

export const CACHED_VISIBLE_ONLINE_KEY = "liner_cached_songs_online";

function readVisibleOnline(): boolean {
  try {
    return localStorage.getItem(CACHED_VISIBLE_ONLINE_KEY) !== "0";
  } catch {
    return true;
  }
}

export interface CachedTrack {
  track: Track;
  bytes: number;
  lastPlayedAt: number;
}

interface CachedTracksState {
  items: CachedTrack[];
  // songs saved by a playlist's cache button, which eviction leaves alone
  pinnedIds: ReadonlySet<string>;
  addPinned: (trackId: string) => void;
  loaded: boolean;
  loading: boolean;
  visibleOnline: boolean;
  setVisibleOnline: (visible: boolean) => void;
  load: () => Promise<void>;
  remove: (trackId: string) => Promise<void>;
}

async function readCachedTracks(): Promise<CachedTrack[]> {
  const entries = await linerDb.listAudioEntries();
  const items = await Promise.all(
    entries.map(async (entry): Promise<CachedTrack | null> => {
      const record = await linerDb.getTrack(entry.trackId);
      if (!record) return null;
      return {
        track: {
          id: record.id,
          title: record.title,
          artists: record.artists,
          coverUrl: record.coverUrl ?? "",
          durationMs: record.durationMs,
          playCount: 0,
          album:
            record.albumId && record.albumTitle
              ? { id: record.albumId, title: record.albumTitle }
              : undefined,
        },
        bytes: entry.byteSize,
        lastPlayedAt: entry.lastPlayedAt ?? entry.savedAt,
      };
    }),
  );
  return items
    .filter((item): item is CachedTrack => item !== null)
    .sort((a, b) => b.lastPlayedAt - a.lastPlayedAt);
}

export const useCachedTracksStore = create<CachedTracksState>((set, get) => ({
  items: [],
  pinnedIds: new Set<string>(),
  addPinned: (trackId) => {
    set({ pinnedIds: new Set(get().pinnedIds).add(trackId) });
  },
  loaded: false,
  loading: false,
  visibleOnline: readVisibleOnline(),
  setVisibleOnline: (visible) => {
    try {
      localStorage.setItem(CACHED_VISIBLE_ONLINE_KEY, visible ? "1" : "0");
    } catch {}
    set({ visibleOnline: visible });
  },
  load: async () => {
    if (get().loading) return;
    set({ loading: true });
    try {
      const [items, entries] = await Promise.all([
        readCachedTracks(),
        linerDb.listAudioEntries(),
      ]);
      set({
        items,
        pinnedIds: new Set(
          entries.filter((entry) => entry.pinned).map((entry) => entry.trackId),
        ),
        loaded: true,
      });
    } finally {
      set({ loading: false });
    }
  },
  remove: async (trackId) => {
    const pinnedIds = new Set(get().pinnedIds);
    pinnedIds.delete(trackId);
    set({
      items: get().items.filter((item) => item.track.id !== trackId),
      pinnedIds,
    });
    await audioCache.deleteAudio(trackId);
  },
}));
