import { useEffect } from "react";
import { isNativeApp } from "@/shared/platform";

export function CoverSwRegistrar() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    // native shells skip the sw too: covers already go through the native proxy
    const skipServiceWorker =
      isNativeApp() ||
      window.location.protocol === "file:" ||
      typeof (window as any).linerElectron !== "undefined";

    if (skipServiceWorker) {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const reg of registrations) {
          void reg.unregister();
        }
      });
      return;
    }

    navigator.serviceWorker
      .register("/cover-sw.js", { scope: "/" })
      .catch(() => {
        // SW registration failure is non-fatal — images still load, just uncached.
      });
  }, []);

  return null;
}
