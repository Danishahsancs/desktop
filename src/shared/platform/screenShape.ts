// screen shape for the phone layouts (see the variants in src/app/globals.css).
// "short" comes from the physical screen in its current orientation, not the
// page height: the on-screen keyboard shrinks the page, and judging by page
// height flipped upright phones into the landscape layout whenever it opened.
const SHORT_SCREEN_MAX = 500;
const NARROW_MAX_WIDTH = 768;

type Listener = () => void;
const listeners = new Set<Listener>();
let installed = false;

function screenHeight(): number {
  if (typeof window === "undefined") return Infinity;
  // android reports screen width/height for the current orientation
  return window.screen?.height || window.innerHeight;
}

export function isShortScreen(): boolean {
  return screenHeight() < SHORT_SCREEN_MAX;
}

export function isNarrowScreen(): boolean {
  return typeof window !== "undefined" && window.innerWidth < NARROW_MAX_WIDTH && !isShortScreen();
}

export function isCompactScreen(): boolean {
  return (typeof window !== "undefined" && window.innerWidth < NARROW_MAX_WIDTH) || isShortScreen();
}

function update(): void {
  document.documentElement.toggleAttribute("data-short", isShortScreen());
  listeners.forEach((l) => l());
}

export function installScreenShape(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  update();
  window.addEventListener("resize", update);
  window.screen?.orientation?.addEventListener?.("change", update);
}

export function subscribeScreenShape(listener: Listener): () => void {
  installScreenShape();
  listeners.add(listener);
  return () => listeners.delete(listener);
}
