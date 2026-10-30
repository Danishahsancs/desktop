import { useSyncExternalStore } from "react";
import {
  isCompactScreen,
  isNarrowScreen,
  isShortScreen,
  subscribeScreenShape,
} from "@/shared/platform/screenShape";

// same rules as the narrow / compact / short variants in src/app/globals.css

// phone-sized screen in either orientation; follows rotation and resizes
export function useIsCompact(): boolean {
  return useSyncExternalStore(subscribeScreenShape, isCompactScreen, () => false);
}

// phone held upright (or any narrow window): no room for side-by-side panes
export function useIsNarrow(): boolean {
  return useSyncExternalStore(subscribeScreenShape, isNarrowScreen, () => false);
}

// phone held sideways: too little height to stack cover, title and controls
export function useIsShort(): boolean {
  return useSyncExternalStore(subscribeScreenShape, isShortScreen, () => false);
}
