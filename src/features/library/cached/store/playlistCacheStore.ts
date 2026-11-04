import { Network } from "@capacitor/network";
import { create } from "zustand";
import { getAuthSession } from "@/shared/api";
import { isLocalTrackId } from "@/shared/media/local";
import { isSavedTrack } from "@/shared/media/saved";
import { isNativeApp } from "@/shared/platform";
import { audioCache, linerDb } from "@/shared/storage";
import type { Track } from "@/shared/types";
import {
  classifySaveFailure,
  fromNetwork,
} from "../../saved/engine/savedTrackFetcher";
import { useCachedTracksStore } from "./cachedTracksStore";

const JOBS_STORAGE_KEY = "liner_playlist_cache_jobs";
const CONCURRENCY = 2;
const MAX_ATTEMPTS = 3;
const TRACK_TIMEOUT_MS = 3 * 60_000;
const WAIT_POLL_MS = 5_000;
const THROTTLED_PAUSE_MS = 60_000;
// same cut-off as caching while playing: these are mixes, and they'd sit in memory
const MAX_TRACK_DURATION_MS = 20 * 60_000;
export const ESTIMATED_TRACK_BYTES = 4 * 1024 * 1024;

export type PlaylistCacheWait = "connection" | "wifi" | null;

export interface PlaylistCacheJob {
  playlistId: string;
  title: string;
  pending: Track[];
  failed: number;
  wait: PlaylistCacheWait;
  allowCellular: boolean;
}

export interface PlaylistCacheResult {
  playlistId: string;
  title: string;
  failed: number;
}

interface PlaylistCacheState {
  jobs: PlaylistCacheJob[];
  lastResult: PlaylistCacheResult | null;
  start: (
    playlistId: string,
    title: string,
    tracks: Track[],
    allowCellular: boolean,
  ) => void;
  cancel: (playlistId: string) => void;
  clearResult: () => void;
}

export function cacheableTracks(tracks: Track[]): Track[] {
  return tracks.filter(
    (track) =>
      !isLocalTrackId(track.id) &&
      !isSavedTrack(track.id) &&
      !(track.durationMs && track.durationMs > MAX_TRACK_DURATION_MS),
  );
}

let nativeConnectionType: string | null = null;

// the webview's navigator.connection just says "unknown" on android, so ask the system
export async function refreshConnectionType(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    nativeConnectionType = (await Network.getStatus()).connectionType;
  } catch {
    // keep the last answer
  }
}

export function isOnCellular(): boolean {
  if (nativeConnectionType) return nativeConnectionType === "cellular";
  const connection = (
    navigator as Navigator & { connection?: { type?: string } }
  ).connection;
  return connection?.type === "cellular";
}

function persistJobs(jobs: PlaylistCacheJob[]): void {
  try {
    if (jobs.length > 0)
      localStorage.setItem(JOBS_STORAGE_KEY, JSON.stringify(jobs));
    else localStorage.removeItem(JOBS_STORAGE_KEY);
  } catch {
    // storage full: this download just won't resume after a restart
  }
}

function readJobs(): PlaylistCacheJob[] {
  try {
    const stored = localStorage.getItem(JOBS_STORAGE_KEY);
    return stored ? (JSON.parse(stored) as PlaylistCacheJob[]) : [];
  } catch {
    return [];
  }
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

export const usePlaylistCacheStore = create<PlaylistCacheState>((set, get) => {
  const setJobs = (jobs: PlaylistCacheJob[]) => {
    persistJobs(jobs);
    set({ jobs });
  };
  const updateJob = (
    playlistId: string,
    change: (job: PlaylistCacheJob) => PlaylistCacheJob,
  ) => {
    setJobs(
      get().jobs.map((job) =>
        job.playlistId === playlistId ? change(job) : job,
      ),
    );
  };

  let active: { playlistId: string; controller: AbortController } | null = null;

  // holds a track back until the connection the job is allowed to use is there
  const waitForNetwork = async (job: PlaylistCacheJob, signal: AbortSignal) => {
    const blocker = (): PlaylistCacheWait => {
      if (!navigator.onLine) return "connection";
      return !job.allowCellular && isOnCellular() ? "wifi" : null;
    };
    while (blocker()) {
      updateJob(job.playlistId, (current) => ({
        ...current,
        wait: blocker(),
      }));
      await abortableDelay(WAIT_POLL_MS, signal);
    }
    if (get().jobs.find((j) => j.playlistId === job.playlistId)?.wait) {
      updateJob(job.playlistId, (current) => ({ ...current, wait: null }));
    }
  };

  const cacheTrack = async (
    track: Track,
    generation: number,
    signal: AbortSignal,
  ): Promise<boolean> => {
    if (await linerDb.pinAudio(track.id)) {
      await linerDb.putTrack(track);
      return true;
    }
    const fetched = await fromNetwork(
      track,
      AbortSignal.any([signal, AbortSignal.timeout(TRACK_TIMEOUT_MS)]),
    );
    const saved = await audioCache.saveAudioBlob(
      track.id,
      new Blob([fetched.audio as BlobPart], { type: fetched.mimeType }),
      fetched.mimeType,
      generation,
      true,
    );
    if (saved) await linerDb.putTrack(track);
    return saved;
  };

  const finishTrack = (playlistId: string, trackId: string, ok: boolean) => {
    if (ok) useCachedTracksStore.getState().addPinned(trackId);
    updateJob(playlistId, (job) => ({
      ...job,
      pending: job.pending.filter((track) => track.id !== trackId),
      failed: job.failed + (ok ? 0 : 1),
    }));
  };

  const runJob = async (job: PlaylistCacheJob, controller: AbortController) => {
    const { signal } = controller;
    const generation = audioCache.currentGeneration();
    const queue = [...job.pending];
    const attempts = new Map<string, number>();

    const worker = async () => {
      while (!signal.aborted) {
        const track = queue.shift();
        if (!track) return;
        try {
          await waitForNetwork(job, signal);
          // false means the cache was cleared underneath us: that's a stop, not a failure
          if (!(await cacheTrack(track, generation, signal))) {
            controller.abort();
            return;
          }
          finishTrack(job.playlistId, track.id, true);
        } catch (error) {
          if (signal.aborted) return;
          // android freezes a hidden app, which times its requests out: not the song's fault
          if (document.hidden) {
            queue.unshift(track);
            await abortableDelay(WAIT_POLL_MS, signal).catch(() => undefined);
            continue;
          }
          const { kind } = classifySaveFailure(error);
          if (kind === "offline") {
            queue.unshift(track);
            continue;
          }
          const tries = (attempts.get(track.id) ?? 0) + 1;
          attempts.set(track.id, tries);
          if (tries >= MAX_ATTEMPTS) {
            finishTrack(job.playlistId, track.id, false);
            continue;
          }
          queue.push(track);
          if (kind === "rate_limited" || kind === "blocked") {
            await abortableDelay(THROTTLED_PAUSE_MS, signal).catch(
              () => undefined,
            );
          }
        }
      }
    };

    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  };

  const pump = () => {
    if (active) return;
    const job = get().jobs[0];
    if (!job) return;
    const controller = new AbortController();
    active = { playlistId: job.playlistId, controller };
    void runJob(job, controller)
      .catch(() => undefined)
      .finally(() => {
        const cancelled = controller.signal.aborted;
        active = null;
        const finished = get().jobs.find(
          (current) => current.playlistId === job.playlistId,
        );
        setJobs(
          get().jobs.filter((current) => current.playlistId !== job.playlistId),
        );
        if (finished && !cancelled) {
          set({
            lastResult: {
              playlistId: finished.playlistId,
              title: finished.title,
              failed: finished.failed,
            },
          });
        }
        void useCachedTracksStore.getState().load();
        pump();
      });
  };

  return {
    jobs: [],
    lastResult: null,
    start: (playlistId, title, tracks, allowCellular) => {
      if (get().jobs.some((job) => job.playlistId === playlistId)) return;
      const { pinnedIds } = useCachedTracksStore.getState();
      const pending = cacheableTracks(tracks).filter(
        (track) => !pinnedIds.has(track.id),
      );
      if (pending.length === 0) return;
      setJobs([
        ...get().jobs,
        {
          playlistId,
          title,
          pending,
          failed: 0,
          wait: null,
          allowCellular,
        },
      ]);
      pump();
    },
    cancel: (playlistId) => {
      if (active?.playlistId === playlistId) {
        active.controller.abort();
        return;
      }
      setJobs(get().jobs.filter((job) => job.playlistId !== playlistId));
    },
    clearResult: () => set({ lastResult: null }),
  };
});

// picks up downloads the app was closed in the middle of
export function initPlaylistCache(): void {
  if (isNativeApp()) {
    void refreshConnectionType();
    void Network.addListener("networkStatusChange", (status) => {
      nativeConnectionType = status.connectionType;
    });
  }
  if (!getAuthSession()) return;
  const jobs = readJobs();
  if (jobs.length === 0) return;
  void useCachedTracksStore
    .getState()
    .load()
    .then(() => {
      const { start } = usePlaylistCacheStore.getState();
      for (const job of jobs) {
        start(job.playlistId, job.title, job.pending, job.allowCellular);
      }
    });
}
