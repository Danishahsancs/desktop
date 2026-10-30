import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { App as CapacitorApp } from "@capacitor/app";
import { api, toClientTrack } from "@/shared/api";
import { playerEngine } from "@/features/player";
import { isNativeApp } from "@/shared/platform";
import { parseDeeplink, type DeeplinkTarget } from "../../electron/deeplink";

// opens shared entities arriving via liner:// deeplinks. on desktop main
// pre-validates; on android the raw intent url is validated here with the same
// parser.
export default function DeeplinkHandler() {
  const navigate = useNavigate();

  useEffect(() => {
    const open = async (target: DeeplinkTarget) => {
      try {
        switch (target.type) {
          case "artist":
            navigate(`/artist?id=${encodeURIComponent(target.id)}`);
            break;
          case "album":
            navigate(`/collection?type=album&id=${encodeURIComponent(target.id)}`);
            break;
          case "playlist":
            navigate(`/collection?type=playlist&id=${encodeURIComponent(target.id)}`);
            break;
          case "track": {
            const track = toClientTrack(await api.getTrack(target.id));
            playerEngine.playTrack(track, [track], track.artists, track.coverUrl);
            navigate("/player");
            break;
          }
        }
      } catch {
        // unknown id or offline, stay where we are
      }
    };

    const offElectron = window.linerElectron?.onDeeplink((target) => void open(target));

    let offNative: (() => void) | undefined;
    let disposed = false;
    if (isNativeApp()) {
      void CapacitorApp.addListener("appUrlOpen", ({ url }) => {
        const target = parseDeeplink(url);
        if (target) void open(target);
      }).then((handle) => {
        if (disposed) void handle.remove();
        else offNative = () => void handle.remove();
      });
    }

    return () => {
      disposed = true;
      offElectron?.();
      offNative?.();
    };
  }, [navigate]);

  return null;
}
