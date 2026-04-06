/**
 * Hook that listens for OS power events and auto-closes idle sessions.
 * Only activates inside the Tauri desktop app.
 */

import { useEffect } from "react";
import { useSessionStore } from "@/stores/sessionStore";
import { isTauri } from "@/lib/tauri";
import { endSession } from "@/lib/db";
import { nowUtc } from "@/lib/timestamp";

export const AUTO_CLOSE_IDLE_SECS = 7200;
export const IDLE_CHECK_INTERVAL_MS = 60_000;

export function shouldAutoClose(
  lastHeartbeat: number | null,
  now: number,
  thresholdSecs: number = AUTO_CLOSE_IDLE_SECS,
): boolean {
  if (lastHeartbeat == null) return false;
  return now - lastHeartbeat >= thresholdSecs;
}

export function useAutoSessionPause(): void {
  const session = useSessionStore((s) => s.session);
  const setPaused = useSessionStore((s) => s.setPaused);
  const clearSession = useSessionStore((s) => s.clearSession);

  // Power event listeners — Tauri only
  useEffect(() => {
    if (!isTauri()) return;
    let unPause: (() => void) | undefined;
    let unResume: (() => void) | undefined;

    import("@tauri-apps/api/event").then(({ listen }) => {
      listen("session_pause", () => {
        if (useSessionStore.getState().session) setPaused(true);
      }).then((fn) => { unPause = fn; });
      listen("session_resume", () => {
        if (useSessionStore.getState().session) setPaused(false);
      }).then((fn) => { unResume = fn; });
    });

    return () => { unPause?.(); unResume?.(); };
  }, [setPaused]);

  // Periodic idle auto-close — Tauri only
  useEffect(() => {
    if (!isTauri() || !session) return;
    const interval = setInterval(async () => {
      const current = useSessionStore.getState().session;
      if (!current) return;
      const now = nowUtc();
      if (shouldAutoClose(current.lastHeartbeat, now)) {
        try { await endSession(current.id, current.lastHeartbeat ?? now); clearSession(); } catch {}
      }
    }, IDLE_CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [session, clearSession]);
}
