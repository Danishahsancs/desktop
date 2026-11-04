import { useEffect, useMemo } from "react";
import { CheckLine, DownloadLine } from "@mingcute/react";
import { useTranslation } from "@/languages";
import { isNativeApp } from "@/shared/platform";
import { Button, useToast } from "@/shared/ui";
import type { Track } from "@/shared/types";
import { useCachedTracksStore } from "../store/cachedTracksStore";
import {
  cacheableTracks,
  ESTIMATED_TRACK_BYTES,
  isOnCellular,
  refreshConnectionType,
  usePlaylistCacheStore,
} from "../store/playlistCacheStore";

// desktop has its own permanent downloads for liked songs
const isAvailable = () => isNativeApp() || import.meta.env.DEV;

function usePlaylistCacheProgress(playlistId: string, tracks: Track[]) {
  const pinnedIds = useCachedTracksStore((state) => state.pinnedIds);
  const loaded = useCachedTracksStore((state) => state.loaded);
  const load = useCachedTracksStore((state) => state.load);
  const job = usePlaylistCacheStore((state) =>
    state.jobs.find((current) => current.playlistId === playlistId),
  );

  useEffect(() => {
    if (!loaded && isAvailable()) void load();
  }, [loaded, load]);

  const eligible = useMemo(() => cacheableTracks(tracks), [tracks]);
  const saved = useMemo(
    () => eligible.filter((track) => pinnedIds.has(track.id)).length,
    [eligible, pinnedIds],
  );
  return { job, saved, total: eligible.length, eligible };
}

export function PlaylistCacheChip({
  playlistId,
  tracks,
  className,
}: {
  playlistId: string;
  tracks: Track[];
  className?: string;
}) {
  const { t } = useTranslation();
  const { job, saved, total } = usePlaylistCacheProgress(playlistId, tracks);

  if (!isAvailable() || (!job && saved === 0)) return null;
  return (
    <div className={className}>
      <DownloadLine size={13} className="text-text-secondary shrink-0" />
      <span>
        {job?.wait === "wifi"
          ? t("library.cached.waiting_wifi")
          : job?.wait === "connection"
            ? t("library.cached.waiting_connection")
            : t("library.cached.count", { saved, total })}
      </span>
    </div>
  );
}

export function PlaylistCacheButton({
  playlistId,
  title,
  tracks,
  className,
}: {
  playlistId: string;
  title: string;
  tracks: Track[];
  className?: string;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { job, saved, total, eligible } = usePlaylistCacheProgress(
    playlistId,
    tracks,
  );
  const start = usePlaylistCacheStore((state) => state.start);
  const cancel = usePlaylistCacheStore((state) => state.cancel);
  const lastResult = usePlaylistCacheStore((state) => state.lastResult);
  const clearResult = usePlaylistCacheStore((state) => state.clearResult);
  const complete = total > 0 && saved >= total;

  useEffect(() => {
    if (lastResult?.playlistId !== playlistId) return;
    clearResult();
    if (lastResult.failed > 0) {
      toast(
        t("library.cached.some_failed", { failed: lastResult.failed }),
        "error",
        { description: lastResult.title },
      );
    } else {
      toast(t("library.cached.playlist_cached"), "checkmark", {
        description: lastResult.title,
      });
    }
  }, [lastResult, playlistId, clearResult, toast, t]);

  if (!isAvailable() || total === 0) return null;

  const handleClick = async () => {
    if (job) {
      cancel(playlistId);
      toast(t("library.cached.stopped"), "info", {
        description: t("library.cached.stopped_desc"),
      });
      return;
    }
    if (complete) {
      toast(t("library.cached.already_cached"), "checkmark", {
        description: t("library.cached.already_cached_desc"),
      });
      return;
    }
    await refreshConnectionType();
    const onCellular = isOnCellular();
    if (onCellular) {
      const count = total - saved;
      const size = Math.round(
        (count * ESTIMATED_TRACK_BYTES) / (1024 * 1024),
      );
      if (!window.confirm(t("library.cached.cellular_confirm", { count, size })))
        return;
    }
    start(playlistId, title, eligible, onCellular);
  };

  return (
    <Button
      variant="secondary"
      onClick={() => void handleClick()}
      className={`${className ?? ""} ${job ? "!w-auto px-[14px] text-[13px] tabular-nums" : "!w-[52px] !p-0"}`}
      title={
        job
          ? t("library.cached.stop_caching")
          : t("library.cached.cache_playlist")
      }
    >
      {job ? (
        <span>
          {saved}/{total}
        </span>
      ) : complete ? (
        <CheckLine size={18} className="text-emerald-400" />
      ) : (
        <DownloadLine size={18} />
      )}
    </Button>
  );
}
