import { useSyncExternalStore } from "react";

// keep in sync with the `compact` / `narrow` variants in src/app/globals.css
export const COMPACT_MEDIA_QUERY = "(max-width: 767.98px), (max-height: 499.98px)";
export const NARROW_MEDIA_QUERY = "(max-width: 767.98px) and (min-height: 500px)";

function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => typeof window !== "undefined" && !!window.matchMedia?.(query).matches,
    () => false,
  );
}

// phone-sized screen in either orientation; follows rotation and resizes
export function useIsCompact(): boolean {
  return useMediaQuery(COMPACT_MEDIA_QUERY);
}

// phone held upright (or any narrow window): no room for side-by-side panes
export function useIsNarrow(): boolean {
  return useMediaQuery(NARROW_MEDIA_QUERY);
}
