// android media notification + lock screen controls.
// a webview never turns navigator.mediaSession into a system notification, so
// on native we mirror the player store into @capgo/capacitor-media-session.
// while something is playing or paused that plugin also keeps a `mediaPlayback`
// foreground service alive, which is what lets audio continue with the app in
// the background or the screen off.
import { MediaSession, type MediaSessionPlaybackState } from "@capgo/capacitor-media-session";
import type { Track } from "@/shared/types";
import { usePlayerStore, type PlayerStatus } from "../store/playerStore";

const POSITION_SYNC_MS = 5000;

// "loading" between tracks must stay "playing": dropping to "none" would stop
// the foreground service and let android freeze the app mid-transition
function toPlaybackState(status: PlayerStatus, hasTrack: boolean): MediaSessionPlaybackState {
  if (!hasTrack) return "none";
  if (status === "playing" || status === "loading") return "playing";
  if (status === "paused") return "paused";
  return "none";
}

function toMetadata(track: Track) {
  return {
    title: track.title,
    artist: track.artists,
    album: (track as { albumTitle?: string }).albumTitle || "Liner",
    artwork: track.coverUrl ? [{ src: track.coverUrl, sizes: "512x512", type: "image/jpeg" }] : [],
  };
}

let started = false;

export function initNativeMediaSession(): void {
  if (started) return;
  started = true;

  const dispatch = usePlayerStore.getState().dispatch;
  const handlers = {
    play: () => dispatch({ type: "RESUME_REQUESTED" }),
    pause: () => dispatch({ type: "PAUSE_REQUESTED" }),
    stop: () => dispatch({ type: "PAUSE_REQUESTED" }),
    previoustrack: () => dispatch({ type: "SKIP_PREVIOUS" }),
    nexttrack: () => dispatch({ type: "SKIP_NEXT" }),
  } as const;
  for (const [action, handler] of Object.entries(handlers)) {
    void MediaSession.setActionHandler({ action: action as keyof typeof handlers }, handler).catch(() => {});
  }
  void MediaSession.setActionHandler({ action: "seekto" }, (details) => {
    if (typeof details.seekTime === "number" && !Number.isNaN(details.seekTime)) {
      dispatch({ type: "SEEK_COMMITTED", positionMs: Math.round(details.seekTime * 1000) });
    }
  }).catch(() => {});

  let lastTrackId: string | null = null;
  let lastState: MediaSessionPlaybackState | null = null;
  let lastPositionSync = 0;
  let lastPositionMs = 0;

  const syncPosition = (positionMs: number, durationMs: number, playbackRate: number) => {
    if (!durationMs || durationMs <= 0) return;
    lastPositionSync = Date.now();
    void MediaSession.setPositionState({
      duration: durationMs / 1000,
      position: Math.min(positionMs, durationMs) / 1000,
      playbackRate: playbackRate || 1,
    }).catch(() => {});
  };

  const sync = () => {
    const s = usePlayerStore.getState();
    const track = s.currentTrack;

    if ((track?.id ?? null) !== lastTrackId) {
      lastTrackId = track?.id ?? null;
      if (track) void MediaSession.setMetadata(toMetadata(track)).catch(() => {});
    }

    const state = toPlaybackState(s.status, !!track);
    const stateChanged = state !== lastState;
    if (stateChanged) {
      lastState = state;
      void MediaSession.setPlaybackState({ playbackState: state }).catch(() => {});
    }

    // the notification extrapolates progress itself; resync on state changes,
    // seeks (position jumps) and every few seconds to absorb drift
    const jumped = Math.abs(s.positionMs - lastPositionMs) > 2500;
    lastPositionMs = s.positionMs;
    if (track && (stateChanged || jumped || Date.now() - lastPositionSync > POSITION_SYNC_MS)) {
      syncPosition(s.positionMs, s.durationMs, s.playbackRate);
    }
  };

  usePlayerStore.subscribe(sync);
  sync();
}
