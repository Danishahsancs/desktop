import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { audioCache, linerDb } from "@/shared/storage";
import type { Track } from "@/shared/types";
import { fromNetwork } from "../../saved/engine/savedTrackFetcher";
import { useCachedTracksStore } from "./cachedTracksStore";
import {
  cacheableTracks,
  initPlaylistCache,
  isOnCellular,
  usePlaylistCacheStore,
} from "./playlistCacheStore";

vi.mock("../../saved/engine/savedTrackFetcher", () => ({
  fromNetwork: vi.fn(),
  classifySaveFailure: () => ({ kind: "failed", reason: "nope" }),
}));

const track = (id: string, durationMs = 180_000): Track => ({
  id,
  title: `Song ${id}`,
  artists: "Artist",
  durationMs,
  coverUrl: "",
  playCount: 0,
});

const audioOf = (size = 16) => ({
  audio: new Uint8Array(size),
  mimeType: "audio/webm",
  source: "network" as const,
});

const settled = () =>
  vi.waitFor(() => {
    expect(usePlaylistCacheStore.getState().jobs).toEqual([]);
  });

const store = () => usePlaylistCacheStore.getState();

describe("playlist cache", () => {
  const ids = new Set<string>();
  const useId = (id: string) => {
    ids.add(id);
    return id;
  };

  beforeEach(() => {
    vi.mocked(fromNetwork).mockReset();
    vi.mocked(fromNetwork).mockResolvedValue(audioOf());
    // reads indexeddb, which jsdom doesn't have
    useCachedTracksStore.setState({
      pinnedIds: new Set(),
      loaded: true,
      load: async () => {},
    });
    usePlaylistCacheStore.setState({ jobs: [], lastResult: null });
    localStorage.clear();
  });

  afterEach(async () => {
    await settled();
    for (const id of ids) await audioCache.deleteAudio(id);
    ids.clear();
    vi.unstubAllGlobals();
  });

  it("downloads every song, pins it, and reports done", async () => {
    const tracks = ["a1", "a2", "a3"].map((id) => track(useId(id)));
    store().start("p1", "Mine", tracks, false);
    await settled();

    expect(fromNetwork).toHaveBeenCalledTimes(3);
    expect((await linerDb.getAudio("a2"))?.pinned).toBe(true);
    expect(await linerDb.getTrack("a2")).toMatchObject({ title: "Song a2" });
    expect([...useCachedTracksStore.getState().pinnedIds].sort()).toEqual([
      "a1",
      "a2",
      "a3",
    ]);
    expect(store().lastResult).toMatchObject({ playlistId: "p1", failed: 0 });
  });

  it("pins a song already cached by playing it, without downloading again", async () => {
    await audioCache.saveAudioBlob(useId("b1"), new Blob(["x"]), "audio/webm");
    expect((await linerDb.getAudio("b1"))?.pinned).toBeUndefined();

    store().start("p1", "Mine", [track("b1")], false);
    await settled();

    expect(fromNetwork).not.toHaveBeenCalled();
    expect((await linerDb.getAudio("b1"))?.pinned).toBe(true);
  });

  it("retries a failing song, then counts it and carries on", async () => {
    vi.mocked(fromNetwork).mockImplementation(async (t) => {
      if (t.id === "c1") throw new Error("nope");
      return audioOf();
    });
    store().start("p1", "Mine", [track(useId("c1")), track(useId("c2"))], false);
    await settled();

    expect(
      vi.mocked(fromNetwork).mock.calls.filter(([t]) => t.id === "c1"),
    ).toHaveLength(3);
    expect(await linerDb.hasAudio("c2")).toBe(true);
    expect(store().lastResult).toMatchObject({ failed: 1 });
  });

  it("stopping keeps finished songs and reports nothing", async () => {
    let release = () => {};
    vi.mocked(fromNetwork).mockImplementation(
      (t, signal) =>
        new Promise((resolve, reject) => {
          if (t.id === "d1" || t.id === "d2") return resolve(audioOf());
          release = () => reject(new Error("aborted"));
          signal.addEventListener("abort", release);
        }),
    );
    store().start(
      "p1",
      "Mine",
      ["d1", "d2", "d3", "d4"].map((id) => track(useId(id))),
      false,
    );
    await vi.waitFor(() => expect(store().jobs[0]?.pending.length).toBe(2));
    store().cancel("p1");
    await settled();

    expect(await linerDb.hasAudio("d1")).toBe(true);
    expect(await linerDb.hasAudio("d3")).toBe(false);
    expect(store().lastResult).toBeNull();
  });

  it("stops without writing if the cache is cleared mid-download", async () => {
    vi.mocked(fromNetwork).mockImplementation(async () => {
      audioCache.invalidate();
      return audioOf();
    });
    store().start("p1", "Mine", [track(useId("e1"))], false);
    await settled();

    expect(await linerDb.hasAudio("e1")).toBe(false);
    expect(store().lastResult).toBeNull();
  });

  it("runs one playlist at a time, in order", async () => {
    const order: string[] = [];
    vi.mocked(fromNetwork).mockImplementation(async (t) => {
      order.push(t.id);
      return audioOf();
    });
    store().start("p1", "One", [track(useId("f1"))], false);
    store().start("p2", "Two", [track(useId("f2"))], false);
    await settled();

    expect(order).toEqual(["f1", "f2"]);
  });

  it("resumes unfinished songs after a restart", async () => {
    localStorage.setItem(
      "liner_playlist_cache_jobs",
      JSON.stringify([
        {
          playlistId: "p1",
          title: "Mine",
          pending: [track(useId("g1"))],
          failed: 0,
          wait: null,
          allowCellular: false,
        },
      ]),
    );
    localStorage.setItem("liner_local_account", "1");
    initPlaylistCache();
    await vi.waitFor(() => expect(fromNetwork).toHaveBeenCalled());
    await settled();

    expect(await linerDb.hasAudio("g1")).toBe(true);
    expect(localStorage.getItem("liner_playlist_cache_jobs")).toBeNull();
  });

  it("waits for wi-fi when it wasn't allowed mobile data", async () => {
    vi.stubGlobal("navigator", {
      ...navigator,
      onLine: true,
      connection: { type: "cellular" },
    });
    expect(isOnCellular()).toBe(true);
    store().start("p1", "Mine", [track(useId("h1"))], false);
    await vi.waitFor(() => expect(store().jobs[0]?.wait).toBe("wifi"));
    expect(fromNetwork).not.toHaveBeenCalled();
    store().cancel("p1");
  });

  it("leaves out local songs and very long mixes", () => {
    expect(
      cacheableTracks([track("ok"), track("mix", 21 * 60_000)]).map((t) => t.id),
    ).toEqual(["ok"]);
  });
});

describe("pinned songs and the cache limit", () => {
  afterEach(async () => {
    for (const id of ["old", "pinned", "new"]) await audioCache.deleteAudio(id);
  });

  it("evicts only unpinned songs, and pinned ones don't use up the limit", async () => {
    const blob = (size: number) => new Blob([new Uint8Array(size)]);
    await linerDb.putAudio("pinned", blob(1000), "audio/webm", 1, true);
    await linerDb.putAudio("old", blob(400), "audio/webm", 2);
    await linerDb.putAudio("new", blob(400), "audio/webm", 3);

    // 1800 total but only 800 unpinned, so nothing has to go yet
    await audioCache.enforceCacheLimit(1000);
    expect(await linerDb.hasAudio("old")).toBe(true);

    await audioCache.enforceCacheLimit(500);
    expect(await linerDb.hasAudio("pinned")).toBe(true);
    expect(await linerDb.hasAudio("old")).toBe(false);
    expect(await linerDb.hasAudio("new")).toBe(true);
  });

  it("stays pinned when playing caches the song again", async () => {
    await linerDb.putAudio("pinned", new Blob(["a"]), "audio/webm", 1, true);
    await audioCache.saveAudioBlob("pinned", new Blob(["ab"]), "audio/webm");
    expect((await linerDb.getAudio("pinned"))?.pinned).toBe(true);
  });
});
