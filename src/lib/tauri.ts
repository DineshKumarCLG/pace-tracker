/**
 * Tauri runtime detection.
 * Returns true when running inside the Tauri desktop app,
 * false when running in a regular browser (e.g. vite dev server).
 */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
