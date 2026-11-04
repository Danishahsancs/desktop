// answers the liner api's routes from the device, in the same shapes, so screens and
// hooks don't need to know there is no server. see localAccount.ts for the mode.
import type {
  ApiTrack,
  ApiUserPlaylist,
  ApiUserPlaylistItem,
  PlaybackHistoryItem,
  RecordPlaybackEventRequest,
} from "../contracts";
import { ApiError } from "./api";
import { localUser, saveLocalUser } from "./localAccount";

const DB_NAME = "liner_local_account";
const STORE = "state";
const STATE_KEY = "library";
const HISTORY_LIMIT = 500;
const OWNER_ID = "local";

type CollectionType = "albums" | "artists" | "playlists";
const COLLECTION_FIELD: Record<CollectionType, string> = {
  albums: "album",
  artists: "artist",
  playlists: "playlist",
};

interface SavedCollection {
  id: string;
  value: Record<string, unknown>;
  savedAt: string;
}

interface LocalPlaylist {
  playlist: ApiUserPlaylist;
  items: ApiUserPlaylistItem[];
}

interface LocalState {
  likes: { track: ApiTrack; likedAt: string }[];
  playlists: LocalPlaylist[];
  saved: Record<CollectionType, SavedCollection[]>;
  history: PlaybackHistoryItem[];
}

function emptyState(): LocalState {
  return {
    likes: [],
    playlists: [],
    saved: { albums: [], artists: [], playlists: [] },
    history: [],
  };
}

// ---- persistence: one json document in its own database ----------------------

let statePromise: Promise<LocalState> | null = null;
let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
}

async function readState(): Promise<LocalState> {
  if (typeof indexedDB === "undefined") return emptyState();
  // this library exists nowhere else, so ask android not to evict it under pressure
  void navigator.storage?.persist?.().catch(() => undefined);
  const db = await openDb();
  const stored = await new Promise<Partial<LocalState> | undefined>((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).get(STATE_KEY);
    request.onsuccess = () => resolve(request.result as Partial<LocalState> | undefined);
    request.onerror = () => reject(request.error);
  });
  return { ...emptyState(), ...stored };
}

function loadState(): Promise<LocalState> {
  if (!statePromise) statePromise = readState();
  return statePromise;
}

async function persist(state: LocalState): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(state, STATE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function resetLocalBackendForTests(): void {
  statePromise = null;
}

// ---- helpers -----------------------------------------------------------------

function notFound(message = "Not available without an account"): ApiError {
  return new ApiError(404, message, "LOCAL_NOT_FOUND");
}

function newId(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

function page<T>(all: T[], query: URLSearchParams, fallbackLimit: number) {
  const limit = Number(query.get("limit")) || fallbackLimit;
  const start = Number(query.get("cursor")) || 0;
  const end = start + limit;
  return {
    items: all.slice(start, end),
    nextCursor: end < all.length ? String(end) : null,
  };
}

function bodyTrack(body: Record<string, unknown>): ApiTrack {
  const track = (body.track ?? body.trackSnapshot) as ApiTrack | undefined;
  if (!track?.id) throw new ApiError(400, "Track details are missing", "LOCAL_BAD_REQUEST");
  return track;
}

function trackCoverUrl(track: ApiTrack): string | undefined {
  const cover = track.cover as { url?: string } | string | undefined;
  return typeof cover === "string" ? cover : cover?.url;
}

// keeps the derived fields right after any change to a playlist's items
function touchPlaylist(entry: LocalPlaylist): void {
  entry.items.forEach((item, index) => {
    item.position = index + 1;
  });
  const covers = new Set<string>();
  for (const item of entry.items) {
    const url = trackCoverUrl(item.track);
    if (url) covers.add(url);
    if (covers.size === 4) break;
  }
  entry.playlist = {
    ...entry.playlist,
    trackCount: entry.items.length,
    coverUrls: [...covers],
    revision: entry.playlist.revision + 1,
    updatedAt: now(),
  };
}

function appendTrack(entry: LocalPlaylist, track: ApiTrack): ApiUserPlaylistItem {
  const item: ApiUserPlaylistItem = {
    id: newId(),
    track,
    position: entry.items.length + 1,
    addedAt: now(),
  };
  entry.items.push(item);
  return item;
}

function findPlaylist(state: LocalState, id: string): LocalPlaylist {
  const entry = state.playlists.find((candidate) => candidate.playlist.id === id);
  if (!entry) throw notFound("Playlist not found");
  return entry;
}

function recordEvent(state: LocalState, event: RecordPlaybackEventRequest): void {
  const track =
    event.trackSnapshot ??
    state.likes.find((like) => like.track.id === event.trackId)?.track;
  if (!track) return;
  state.history.unshift({
    id: newId(),
    playbackSessionId: event.playbackSessionId,
    listeningSessionId: event.listeningSessionId,
    track,
    playedDurationMs: event.playedDurationMs,
    completionRate: event.completionRate,
    completed: event.completed ?? false,
    skipped: event.skipped ?? false,
    loopCount: event.loopCount ?? 0,
    hasSeekBackward: event.hasSeekBackward ?? false,
    context: event.context,
    listenedAt: now(),
  });
  state.history.length = Math.min(state.history.length, HISTORY_LIMIT);
}

// ---- routes ------------------------------------------------------------------

async function handleLibrary(
  state: LocalState,
  method: string,
  parts: string[],
  query: URLSearchParams,
  body: Record<string, unknown>,
): Promise<unknown> {
  const [kind, id] = parts;

  if (kind === "tracks") {
    if (!id && method === "GET") return page(state.likes, query, 100);
    if (id && method === "PUT") {
      if (!state.likes.some((like) => like.track.id === id)) {
        state.likes.unshift({ track: bodyTrack(body), likedAt: now() });
        await persist(state);
      }
      return undefined;
    }
    if (id && method === "DELETE") {
      state.likes = state.likes.filter((like) => like.track.id !== id);
      await persist(state);
      return undefined;
    }
    throw notFound();
  }

  if (kind === "albums" || kind === "artists" || kind === "playlists") {
    const field = COLLECTION_FIELD[kind];
    if (!id && method === "GET") {
      return {
        items: state.saved[kind].map((saved) => ({
          [field]: saved.value,
          savedAt: saved.savedAt,
        })),
      };
    }
    if (id && method === "PUT") {
      state.saved[kind] = state.saved[kind].filter((saved) => saved.id !== id);
      state.saved[kind].unshift({
        id,
        value: { ...(body.snapshot as Record<string, unknown> | undefined), id },
        savedAt: now(),
      });
      await persist(state);
      return undefined;
    }
    if (id && method === "DELETE") {
      state.saved[kind] = state.saved[kind].filter((saved) => saved.id !== id);
      await persist(state);
      return undefined;
    }
  }
  throw notFound();
}

async function handlePlaylists(
  state: LocalState,
  method: string,
  parts: string[],
  body: Record<string, unknown>,
): Promise<unknown> {
  const [id, section, childId, action] = parts;

  if (!id) {
    if (method === "GET") {
      return { items: state.playlists.map((entry) => entry.playlist) };
    }
    if (method === "POST") {
      const user = localUser();
      const playlist: ApiUserPlaylist = {
        id: newId(),
        title: String(body.title ?? ""),
        description: body.description as string | undefined,
        isPublic: false,
        createdAt: now(),
        updatedAt: now(),
        revision: 1,
        trackCount: 0,
        coverUrls: [],
        ownerId: OWNER_ID,
        owner: { id: OWNER_ID, username: user.username, displayName: user.displayName },
      };
      state.playlists.unshift({ playlist, items: [] });
      await persist(state);
      return playlist;
    }
    throw notFound();
  }

  const entry = findPlaylist(state, id);

  if (!section) {
    if (method === "GET") {
      return {
        playlist: entry.playlist,
        items: entry.items,
        trackCount: entry.items.length,
        durationMs: entry.items.reduce((sum, item) => sum + (item.track.durationMs || 0), 0),
      };
    }
    if (method === "PATCH") {
      entry.playlist = { ...entry.playlist, ...body, updatedAt: now() } as ApiUserPlaylist;
      await persist(state);
      return entry.playlist;
    }
    if (method === "DELETE") {
      state.playlists = state.playlists.filter((candidate) => candidate !== entry);
      await persist(state);
      return undefined;
    }
    throw notFound();
  }

  if (section === "tracks" && method === "POST") {
    if (childId) {
      if (entry.items.some((item) => item.track.id === childId)) {
        throw new ApiError(409, "Track is already in this playlist", "LOCAL_DUPLICATE");
      }
      const item = appendTrack(entry, bodyTrack(body));
      touchPlaylist(entry);
      await persist(state);
      return item;
    }
    const tracks = (body.tracks as ApiTrack[] | undefined) ?? [];
    const present = new Set(entry.items.map((item) => item.track.id));
    const fresh = tracks.filter((track) => {
      if (present.has(track.id)) return false;
      present.add(track.id);
      return true;
    });
    const items = fresh.map((track) => appendTrack(entry, track));
    touchPlaylist(entry);
    await persist(state);
    return { items, added: items.length, rejected: tracks.length - items.length };
  }

  if (section === "items" && childId) {
    const index = entry.items.findIndex((item) => item.id === childId);
    if (index === -1) throw notFound("Playlist item not found");
    if (method === "DELETE" && !action) {
      entry.items.splice(index, 1);
      touchPlaylist(entry);
      await persist(state);
      return undefined;
    }
    if (method === "POST" && action === "move") {
      const [moved] = entry.items.splice(index, 1);
      const before = body.beforeItemId as string | null;
      const target = before ? entry.items.findIndex((item) => item.id === before) : -1;
      entry.items.splice(target === -1 ? entry.items.length : target, 0, moved);
      touchPlaylist(entry);
      await persist(state);
      return { playlist: entry.playlist, items: entry.items };
    }
  }
  throw notFound();
}

// there's only one user here, so a profile lookup is either this device or nobody
function handleUsers(
  state: LocalState,
  method: string,
  id: string | undefined,
  section: string | undefined,
  query: URLSearchParams,
): unknown {
  if (method !== "GET") throw notFound();
  if (id === "search") return [];
  const user = localUser();
  if (id !== user.id && id !== user.username) throw notFound("User not found");
  if (!section) {
    return {
      ...user,
      followersCount: 0,
      followingCount: 0,
      createdAt: state.playlists.at(-1)?.playlist.createdAt ?? now(),
    };
  }
  if (section === "playlists") return { items: state.playlists.map((entry) => entry.playlist) };
  if (section === "history") return page(state.history, query, 30);
  if (section === "followers" || section === "following") return [];
  throw notFound();
}

export async function handleLocalRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const [pathname, search] = path.split("?");
  const query = new URLSearchParams(search);
  const segments = pathname.split("/").filter(Boolean).slice(1).map(decodeURIComponent);
  const body = (typeof init?.body === "string" && init.body ? JSON.parse(init.body) : {}) as Record<string, unknown>;
  const state = await loadState();
  const [area, resource, ...rest] = segments;

  const answer = async (): Promise<unknown> => {
    if (area === "me") {
      if (!resource && method === "GET") return localUser();
      if (resource === "library") return handleLibrary(state, method, rest, query, body);
      if (resource === "playlists") return handlePlaylists(state, method, rest, body);
      if (resource === "history" && method === "GET") return page(state.history, query, 30);
      if (resource === "playback" && rest[0] === "events" && method === "POST") {
        recordEvent(state, body as unknown as RecordPlaybackEventRequest);
        await persist(state);
        return undefined;
      }
      if (resource === "recommendations") return { items: [], generatedAt: now() };
    }
    if (area === "users" && resource === "me" && method === "PATCH") {
      const updated = { ...localUser(), ...body };
      saveLocalUser(updated);
      return updated;
    }
    if (area === "users") return handleUsers(state, method, resource, rest[0], query);
    // community features need the server: empty, not an error, so home just skips them
    if (area === "explore") {
      if (resource === "most-saved") return { type: query.get("type") ?? "all", items: [] };
      return { window: query.get("window") ?? "all", generatedAt: now(), items: [] };
    }
    if (area === "leaderboards") {
      return { type: resource, targetId: rest[0] ?? "", period: query.get("period") ?? "all", entries: [], updatedAt: now() };
    }
    if (area === "tracks" && rest[0] === "radio") return { items: [] };
    throw notFound();
  };

  return (await answer()) as T;
}
