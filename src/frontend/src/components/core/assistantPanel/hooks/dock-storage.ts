/**
 * localStorage primitives for the Assistant panel's docked layout.
 *
 * Docked, the panel sits beside the canvas and stays open while the user works
 * on it. Floating (the original layout), it hovers over the canvas and closes
 * on an outside click.
 *
 * The preference is tri-state on purpose: `null` means the user never chose,
 * which is when the deployment default (`assistant_dock_default`) applies.
 */

const DOCKED_KEY = "langflow-assistant-docked";
const DOCK_WIDTH_KEY = "langflow-assistant-panel-dock-width";

export const DOCK_DEFAULT_WIDTH = 480;
// Same floor as the floating panel: below it the composer's footer wraps.
export const DOCK_MIN_WIDTH = 456;
export const DOCK_MAX_WIDTH = 900;

export function readDockPreference(): boolean | null {
  try {
    const raw = localStorage.getItem(DOCKED_KEY);
    if (raw === "true") return true;
    if (raw === "false") return false;
    return null;
  } catch {
    return null;
  }
}

export function writeDockPreference(docked: boolean): void {
  try {
    localStorage.setItem(DOCKED_KEY, String(docked));
  } catch {
    // localStorage unavailable (private browsing) — the choice just won't
    // survive a reload.
  }
}

/** Half the viewport at most, so the canvas never loses more than half its room. */
export function clampDockWidth(width: number): number {
  const viewportCap =
    typeof window === "undefined"
      ? DOCK_MAX_WIDTH
      : Math.max(DOCK_MIN_WIDTH, Math.floor(window.innerWidth / 2));
  return Math.round(
    Math.min(
      Math.min(DOCK_MAX_WIDTH, viewportCap),
      Math.max(DOCK_MIN_WIDTH, width),
    ),
  );
}

export function readDockWidth(): number {
  try {
    const raw = Number.parseInt(localStorage.getItem(DOCK_WIDTH_KEY) ?? "", 10);
    return Number.isNaN(raw) ? DOCK_DEFAULT_WIDTH : clampDockWidth(raw);
  } catch {
    return DOCK_DEFAULT_WIDTH;
  }
}

export function writeDockWidth(width: number): void {
  try {
    localStorage.setItem(DOCK_WIDTH_KEY, String(clampDockWidth(width)));
  } catch {
    // see writeDockPreference
  }
}
