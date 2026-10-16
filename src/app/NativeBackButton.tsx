import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { App as CapacitorApp } from "@capacitor/app";
import { isNativeApp } from "@/shared/platform";

// android hardware/gesture back: walk router history, and at the root send the
// app to the background instead of finishing the activity (keeps playback).
export default function NativeBackButton() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!isNativeApp()) return;
    let remove: (() => void) | undefined;
    let disposed = false;
    void CapacitorApp.addListener("backButton", ({ canGoBack }) => {
      // an open dialog/sheet handles back like Escape (close, or step back inside it)
      if (document.querySelector("[data-dialog-container]")) {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        return;
      }
      if (canGoBack) navigate(-1);
      else void CapacitorApp.minimizeApp();
    }).then((handle) => {
      if (disposed) void handle.remove();
      else remove = () => void handle.remove();
    });
    return () => {
      disposed = true;
      remove?.();
    };
  }, [navigate]);

  return null;
}
