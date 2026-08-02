import {
  createRouter,
  createRootRoute,
  createRoute,
  Outlet,
} from "@tanstack/react-router";
import { Menu, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import Sidebar from "@/components/Sidebar";
import AuthGuard from "@/components/AuthGuard";
import TodayScreen from "@/screens/Today";
import TeamScreen from "@/screens/Team";
import TasksScreen from "@/screens/Tasks";
import ReviewScreen from "@/screens/Review";
import SettingsScreen from "@/screens/Settings";
import LeaveScreen from "@/screens/Leave";
import RequestsScreen from "@/screens/Requests";
import AttendanceScreen from "@/screens/Attendance";
import DashboardScreen from "@/screens/Dashboard";
import AnalyticsScreen from "@/screens/Analytics";
import DigestScreen from "@/screens/Digest";
import OnboardingScreen from "@/screens/Onboarding";
import AuthScreen from "@/screens/Auth";
import FounderReviewScreen from "@/screens/FounderReview";
import LeaderboardScreen from "@/screens/Leaderboard";
import EquityScreen from "@/screens/Equity";
import StartupHealthScreen from "@/screens/StartupHealth";
import FounderGuard from "@/components/FounderGuard";

/* ── Root route ── */
const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

/* ── Layout with responsive sidebar, wrapped in auth guard ── */
const appLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app-layout",
  component: () => {
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const mobileNavButtonRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
      if (!mobileNavOpen) return;

      const handleEscape = (event: KeyboardEvent) => {
        if (event.key !== "Escape") return;
        setMobileNavOpen(false);
        mobileNavButtonRef.current?.focus();
      };

      document.addEventListener("keydown", handleEscape);
      return () => document.removeEventListener("keydown", handleEscape);
    }, [mobileNavOpen]);

    const closeMobileNav = () => {
      setMobileNavOpen(false);
      mobileNavButtonRef.current?.focus();
    };

    return (
      <AuthGuard>
        <div className="relative flex h-screen flex-col overflow-hidden bg-background text-foreground md:flex-row">
        {/* Single amber accent keeps the dashboard calm and legible. */}
        <div className="pointer-events-none fixed inset-0 z-0">
          <div className="absolute top-0 right-0 h-[500px] w-[500px] rounded-full bg-primary/[0.03] blur-[120px]" />
        </div>
        {/* Sidebar — hidden on small screens, visible on md+ */}
        <div className="hidden md:flex relative z-10">
          <Sidebar />
        </div>
        {/* Mobile navigation — replaces the desktop sidebar below the md breakpoint. */}
        <div className="relative z-30 flex h-14 shrink-0 items-center border-b border-sidebar-border bg-sidebar px-4 md:hidden">
          <button
            type="button"
            ref={mobileNavButtonRef}
            aria-label={mobileNavOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={mobileNavOpen}
            aria-controls="mobile-navigation"
            onClick={() => setMobileNavOpen((open) => !open)}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-sidebar-accent hover:text-foreground active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {mobileNavOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <div className="ml-3 flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-xs font-black text-primary-foreground">P</div>
            <span className="text-sm font-bold tracking-tight">PACE</span>
          </div>
        </div>
        {mobileNavOpen && (
          <div
            id="mobile-navigation"
            className="mobile-nav-scrim fixed inset-0 z-40 bg-black/50 md:hidden"
            role="dialog"
            aria-modal="true"
            aria-label="Mobile navigation"
            onClick={closeMobileNav}
          >
            <div
              className="mobile-nav-panel h-full w-[220px] shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <Sidebar onNavigate={closeMobileNav} />
            </div>
          </div>
        )}
        <main className="relative z-10 min-h-0 flex-1 overflow-hidden">
          <Outlet />
        </main>
        </div>
      </AuthGuard>
    );
  },
});

/* ── App routes (sidebar visible) ── */
const todayRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/",
  component: TodayScreen,
});

const teamRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/team",
  component: TeamScreen,
});

const tasksRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/tasks",
  component: TasksScreen,
});

const reviewRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/review",
  component: ReviewScreen,
});

const settingsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/settings",
  component: SettingsScreen,
});

const leaveRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/leave",
  component: LeaveScreen,
});

const requestsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/requests",
  component: RequestsScreen,
});

const attendanceRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/attendance",
  component: AttendanceScreen,
});

const dashboardRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/dashboard",
  component: DashboardScreen,
});

const analyticsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/analytics",
  component: AnalyticsScreen,
});

const digestRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/digest",
  component: DigestScreen,
});

/* ── Governance routes (founder-only, sidebar visible) ── */
const founderReviewRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/founder-review",
  component: () => (
    <FounderGuard>
      <FounderReviewScreen />
    </FounderGuard>
  ),
});

const leaderboardRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/leaderboard",
  component: () => (
    <FounderGuard>
      <LeaderboardScreen />
    </FounderGuard>
  ),
});

const equityRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/equity",
  component: () => (
    <FounderGuard>
      <EquityScreen />
    </FounderGuard>
  ),
});

const startupHealthRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/startup-health",
  component: () => (
    <FounderGuard>
      <StartupHealthScreen />
    </FounderGuard>
  ),
});

/* ── Auth (no sidebar — direct child of root) ── */
const authRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/auth",
  component: AuthScreen,
});

/* ── Onboarding (no sidebar — direct child of root) ── */
const onboardingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/onboarding",
  component: OnboardingScreen,
});

/* ── Route tree & router ── */
const routeTree = rootRoute.addChildren([
  appLayoutRoute.addChildren([
    todayRoute,
    teamRoute,
    tasksRoute,
    reviewRoute,
    settingsRoute,
    leaveRoute,
    requestsRoute,
    attendanceRoute,
    dashboardRoute,
    analyticsRoute,
    digestRoute,
    founderReviewRoute,
    leaderboardRoute,
    equityRoute,
    startupHealthRoute,
  ]),
  authRoute,
  onboardingRoute,
]);

export const router = createRouter({ routeTree });

/* ── Type registration for TanStack Router ── */
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
