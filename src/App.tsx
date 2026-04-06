import { useEffect, useState, useCallback } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "@/router";
import { initializeDb, getActiveSession, isSessionStale } from "@/lib/db";
import { isTauri } from "@/lib/tauri";
import { useSessionStore } from "@/stores/sessionStore";
import { useAuthStore } from "@/stores/authStore";
import { useAutoSessionPause } from "@/hooks/useAutoSessionPause";
import { useSoftNudge } from "@/hooks/useSoftNudge";
import { useTheme } from "@/hooks/useTheme";
import CrashRecovery from "@/components/CrashRecovery";
import TaskSwitcher from "@/components/TaskSwitcher";
import type { Session } from "@/types";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
});

type LaunchState =
  | { status: "loading" }
  | { status: "recovery"; session: Session }
  | { status: "ready" };

function App() {
  const [launch, setLaunch] = useState<LaunchState>(
    isTauri() ? { status: "loading" } : { status: "ready" },
  );
  const [taskSwitcherOpen, setTaskSwitcherOpen] = useState(false);
  const setSession = useSessionStore((s) => s.setSession);
  const checkAuth = useAuthStore((s) => s.checkAuth);
  const authUser = useAuthStore((s) => s.user);

  useTheme();
  useAutoSessionPause();
  useSoftNudge();

  // Check auth state on app launch
  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const handleGlobalKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      setTaskSwitcherOpen((prev) => !prev);
    }
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [handleGlobalKeyDown]);

  // Tauri boot sequence — only runs inside the desktop app
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    async function boot() {
      try {
        await initializeDb();
        const active = await getActiveSession(authUser?.id ?? "default-user");
        if (cancelled) return;
        if (active) {
          if (isSessionStale(active)) {
            setLaunch({ status: "recovery", session: active });
          } else {
            setSession(active);
            setLaunch({ status: "ready" });
          }
        } else {
          setLaunch({ status: "ready" });
        }
      } catch {
        if (!cancelled) setLaunch({ status: "ready" });
      }
    }
    boot();
    return () => { cancelled = true; };
  }, [setSession]);

  if (launch.status === "loading") {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-muted-foreground">
        <p className="text-sm">Loading…</p>
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      {launch.status === "recovery" && (
        <CrashRecovery session={launch.session} onRecovered={() => setLaunch({ status: "ready" })} />
      )}
      <TaskSwitcher open={taskSwitcherOpen} onClose={() => setTaskSwitcherOpen(false)} />
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

export default App;
