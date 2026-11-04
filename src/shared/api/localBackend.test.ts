import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "./api";
import { getAuthSession, clearAuthSession } from "./auth-session";
import { enterLocalAccount, isLocalAccount, leaveLocalAccount } from "./localAccount";
import { handleLocalRequest, resetLocalBackendForTests } from "./localBackend";
import { toLyricsCandidate } from "./localLyrics";
import type { ApiTrack } from "../contracts";

const track = (id: string) =>
  ({
    id,
    title: `Song ${id}`,
    durationMs: 1000,
    cover: { url: `https://example.com/${id}.jpg` },
  }) as unknown as ApiTrack;

describe("no-account mode", () => {
  const fetchSpy = vi.fn(() => Promise.reject(new Error("no network in this mode")));

  beforeEach(() => {
    resetLocalBackendForTests();
    enterLocalAccount();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    leaveLocalAccount();
    vi.unstubAllGlobals();
    fetchSpy.mockClear();
  });

  it("is signed in without ever calling the server", async () => {
    expect(getAuthSession()?.user.id).toBe("local");
    await expect(api.getMe()).resolves.toMatchObject({ id: "local" });
    await api.listPlaylists();
    await api.listSavedCollections("albums");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("signing out leaves the mode", async () => {
    await clearAuthSession();
    expect(isLocalAccount()).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps likes newest first and removes them", async () => {
    await putLike("a");
    await putLike("b");
    const page = await api.listLikedTracks();
    expect(page.items.map((item) => item.track.id)).toEqual(["b", "a"]);
    await api.unlikeTrack("b");
    const after = await api.listLikedTracks();
    expect(after.items.map((item) => item.track.id)).toEqual(["a"]);
  });

  it("builds a playlist: add, reject duplicates, move, remove", async () => {
    const playlist = await api.createPlaylist({ title: "Mine" });
    const first = await api.addPlaylistTrack(playlist.id, "a", track("a"));
    const second = await api.addPlaylistTrack(playlist.id, "b", track("b"));

    await expect(api.addPlaylistTrack(playlist.id, "a", track("a"))).rejects.toMatchObject({ status: 409 });

    const moved = await api.movePlaylistItem(playlist.id, second.id, first.id, 1);
    expect(moved.items.map((item) => item.track.id)).toEqual(["b", "a"]);
    expect(moved.playlist.trackCount).toBe(2);
    expect(moved.playlist.coverUrls).toHaveLength(2);

    await api.removePlaylistItem(playlist.id, first.id);
    const read = await api.getUserPlaylist(playlist.id);
    expect(read.items.map((item) => item.track.id)).toEqual(["b"]);
    expect(read.items[0].position).toBe(1);

    await api.deletePlaylist(playlist.id);
    await expect(api.listPlaylists()).resolves.toEqual({ items: [] });
  });

  it("imports in bulk, counting duplicates as rejected", async () => {
    const playlist = await api.createPlaylist({ title: "Imported" });
    const result = await api.addPlaylistTrackSnapshots(playlist.id, [track("a"), track("a"), track("b")]);
    expect(result).toMatchObject({ added: 2, rejected: 1 });
  });

  it("readUserPlaylist reports a normal read", async () => {
    const playlist = await api.createPlaylist({ title: "Read" });
    await api.addPlaylistTrack(playlist.id, "a", track("a"));
    const read = await api.readUserPlaylist(playlist.id, { limit: 10 });
    expect(read).toMatchObject({ notModified: false, trackCount: 1, durationMs: 1000 });
  });

  it("saves collections with their snapshot", async () => {
    await api.saveCollection("albums", "alb1", { title: "Album" });
    const saved = await api.listSavedCollections("albums");
    expect(saved.items).toEqual([
      expect.objectContaining({ album: { title: "Album", id: "alb1" } }),
    ]);
    await api.removeCollection("albums", "alb1");
    await expect(api.listSavedCollections("albums")).resolves.toEqual({ items: [] });
  });

  it("records history from playback events", async () => {
    await api.recordPlaybackEvent({
      trackId: "a",
      trackSnapshot: track("a"),
      playedDurationMs: 500,
    } as never);
    const history = await api.getHistory();
    expect(history.items[0].track.id).toBe("a");
  });

  it("answers for its own profile, and 404s for anyone else", async () => {
    await expect(api.getUserProfile("this-device")).resolves.toMatchObject({ followersCount: 0 });
    await expect(api.getUserProfile("someone")).rejects.toBeInstanceOf(ApiError);
  });

  it("gives server-only features an empty answer or a 404, never a request", async () => {
    await expect(api.getServerRadio("a")).resolves.toEqual({ items: [] });
    await expect(api.getPlaylistImport("nope")).rejects.toBeInstanceOf(ApiError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// api.likeTrack looks the track up in the catalog first; this is the request it ends in
function putLike(id: string) {
  return handleLocalRequest(`/v1/me/library/tracks/${id}`, {
    method: "PUT",
    body: JSON.stringify({ track: track(id) }),
  });
}

describe("lrclib lyrics", () => {
  it("prefers synced lyrics", () => {
    const candidate = toLyricsCandidate({ syncedLyrics: "[00:01.00] hi", plainLyrics: "hi" });
    expect(candidate?.contentKind).toBe("line_synced");
    expect(candidate?.lyrics.format).toBe("lrc");
  });

  it("falls back to plain, and to nothing", () => {
    expect(toLyricsCandidate({ plainLyrics: "hi" })?.contentKind).toBe("plain");
    expect(toLyricsCandidate({ plainLyrics: " " })).toBeNull();
  });
});
