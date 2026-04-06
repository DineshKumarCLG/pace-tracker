/**
 * AuthGuard — Wraps authenticated app routes.
 *
 * - Not authenticated → redirect to /auth
 * - Authenticated but no team (not onboarded) → redirect to /onboarding
 * - Authenticated and onboarded → render children (app layout with sidebar)
 *
 * Task 0.5: No app feature accessible without authentication.
 */

import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuthStore } from "@/stores/authStore";
import { getUserTeam } from "@/lib/db";

type GuardState = "loading" | "authenticated" | "unauthenticated" | "needs-onboarding";

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, user } = useAuthStore();
  const navigate = useNavigate();
  const [guardState, setGuardState] = useState<GuardState>("loading");

  useEffect(() => {
    if (isLoading) {
      setGuardState("loading");
      return;
    }

    if (!isAuthenticated || !user) {
      setGuardState("unauthenticated");
      return;
    }

    // Check if user has a team (onboarding complete)
    let cancelled = false;
    async function checkTeam() {
      try {
        const team = await getUserTeam(user!.id);
        if (cancelled) return;
        if (team) {
          setGuardState("authenticated");
        } else {
          setGuardState("needs-onboarding");
        }
      } catch {
        // If team check fails (e.g. offline), allow access
        if (!cancelled) setGuardState("authenticated");
      }
    }
    checkTeam();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, isLoading, user]);

  useEffect(() => {
    if (guardState === "unauthenticated") {
      navigate({ to: "/auth" });
    } else if (guardState === "needs-onboarding") {
      navigate({ to: "/onboarding" });
    }
  }, [guardState, navigate]);

  if (guardState === "loading") {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-muted-foreground">
        <p className="text-sm">Loading…</p>
      </div>
    );
  }

  if (guardState !== "authenticated") {
    // Redirecting — render nothing while navigation happens
    return null;
  }

  return <>{children}</>;
}
