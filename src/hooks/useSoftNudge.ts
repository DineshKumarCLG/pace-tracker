/**
 * Soft nudge hook — Tauri only.
 * Listens for soft_nudge events, sends OS notification, pauses after 5min timeout.
 */

import { useEffect, useRef } from "react";
import { useSessionStore } from "@/stores/sessionStore";
import { isTauri } from "@/lib/tauri";

export const NUDGE_TIMEOUT_MS = 5 * 60 * 1000;

export interface SoftNudgePayload {
  type: "soft_nudge";
  active_duration_secs: number;
  current_task: string;
}

export function buildNudgeMessage(currentTask: string): string {
  const task = currentTask.trim();
  return task ? `Still working on ${task}?` : "Still working?";
}

export function useSoftNudge(): void {
  const session = useSessionStore((s) => s.session);
  const nudgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isTauri() || !session) return;

    let unlisten: (() => void) | undefined;

    function clearNudgeTimer() {
      if (nudgeTimerRef.current !== null) {
        clearTimeout(nudgeTimerRef.current);
        nudgeTimerRef.current = null;
      }
    }
    function handleUserActivity() { clearNudgeTimer(); }

    import("@tauri-apps/api/event").then(({ listen }) => {
      listen<SoftNudgePayload>("soft_nudge", async (event) => {
        if (!useSessionStore.getState().session) return;
        const message = buildNudgeMessage(event.payload.current_task);

        try {
          const { sendNotification, isPermissionGranted, requestPermission } =
            await import("@tauri-apps/plugin-notification");
          let ok = await isPermissionGranted();
          if (!ok) ok = (await requestPermission()) === "granted";
          if (ok) sendNotification({ title: "PACE", body: message });
        } catch {}

        clearNudgeTimer();
        window.addEventListener("mousemove", handleUserActivity, { once: true });
        window.addEventListener("keydown", handleUserActivity, { once: true });

        nudgeTimerRef.current = setTimeout(() => {
          if (useSessionStore.getState().session) useSessionStore.getState().setPaused(true);
          window.removeEventListener("mousemove", handleUserActivity);
          window.removeEventListener("keydown", handleUserActivity);
        }, NUDGE_TIMEOUT_MS);
      }).then((fn) => { unlisten = fn; });
    });

    return () => {
      unlisten?.();
      clearNudgeTimer();
      window.removeEventListener("mousemove", handleUserActivity);
      window.removeEventListener("keydown", handleUserActivity);
    };
  }, [session]);
}
