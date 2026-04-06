import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  createRouter,
  createRootRoute,
  createRoute,
  RouterProvider,
  Outlet,
} from "@tanstack/react-router";
import { createMemoryHistory } from "@tanstack/history";
import Sidebar from "@/components/Sidebar";
import TodayScreen from "@/screens/Today";
import TeamScreen from "@/screens/Team";
import TasksScreen from "@/screens/Tasks";
import ReviewScreen from "@/screens/Review";
import SettingsScreen from "@/screens/Settings";
import OnboardingScreen from "@/screens/Onboarding";

/**
 * Builds a test router mirroring the real route tree from src/router.tsx,
 * using createMemoryHistory so tests don't touch the browser URL.
 */
function buildTestRouter(initialPath = "/") {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });

  const appLayoutRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: "app-layout",
    component: () => (
      <div className="flex h-screen overflow-hidden bg-background text-foreground">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    ),
  });

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

  const onboardingRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/onboarding",
    component: OnboardingScreen,
  });

  const routeTree = rootRoute.addChildren([
    appLayoutRoute.addChildren([
      todayRoute,
      teamRoute,
      tasksRoute,
      reviewRoute,
      settingsRoute,
    ]),
    onboardingRoute,
  ]);

  const history = createMemoryHistory({ initialEntries: [initialPath] });
  return createRouter({ routeTree, history });
}

async function renderAtRoute(path: string) {
  const router = buildTestRouter(path);
  const result = render(<RouterProvider router={router} />);
  // Wait for the router to settle
  await waitFor(() => {
    expect(router.state.status).toBe("idle");
  });
  return result;
}

/* ─── Route definitions resolve to correct screen components ─── */
describe("Route definitions", () => {
  it("renders TodayScreen at /", async () => {
    await renderAtRoute("/");
    // TodayScreen renders a greeting heading, not "Today"
    expect(await screen.findByText(/Good (morning|afternoon|evening)/)).toBeDefined();
  });

  it("renders TeamScreen at /team", async () => {
    await renderAtRoute("/team");
    expect(await screen.findByRole("heading", { name: "Team" })).toBeDefined();
  });

  it("renders TasksScreen at /tasks", async () => {
    await renderAtRoute("/tasks");
    expect(await screen.findByRole("heading", { name: "Tasks" })).toBeDefined();
  });

  it("renders ReviewScreen at /review", async () => {
    await renderAtRoute("/review");
    expect(
      await screen.findByRole("heading", { name: "Review" }),
    ).toBeDefined();
  });

  it("renders SettingsScreen at /settings", async () => {
    await renderAtRoute("/settings");
    expect(
      await screen.findByRole("heading", { name: "Settings" }),
    ).toBeDefined();
  });

  it("renders OnboardingScreen at /onboarding", async () => {
    await renderAtRoute("/onboarding");
    expect(
      await screen.findByRole("heading", { name: "Welcome to PACE" }),
    ).toBeDefined();
  });
});

/* ─── Sidebar navigation ─── */
describe("Sidebar navigation", () => {
  it("shows sidebar on app layout routes", async () => {
    await renderAtRoute("/");
    expect(screen.getByText("PACE")).toBeDefined();
  });

  it("does not show sidebar on onboarding route", async () => {
    await renderAtRoute("/onboarding");
    expect(screen.queryByText("PACE")).toBeNull();
  });

  it("navigates to /team when Team nav item is clicked", async () => {
    const user = userEvent.setup();
    await renderAtRoute("/");
    await user.click(screen.getByRole("link", { name: /team/i }));
    expect(await screen.findByRole("heading", { name: "Team" })).toBeDefined();
  });

  it("navigates to /tasks when Tasks nav item is clicked", async () => {
    const user = userEvent.setup();
    await renderAtRoute("/");
    await user.click(screen.getByRole("link", { name: /tasks/i }));
    expect(await screen.findByRole("heading", { name: "Tasks" })).toBeDefined();
  });

  it("navigates to /review when Review nav item is clicked", async () => {
    const user = userEvent.setup();
    await renderAtRoute("/");
    await user.click(screen.getByRole("link", { name: /review/i }));
    expect(await screen.findByRole("heading", { name: "Review" })).toBeDefined();
  });

  it("navigates to /settings when Settings nav item is clicked", async () => {
    const user = userEvent.setup();
    await renderAtRoute("/");
    await user.click(screen.getByRole("link", { name: /settings/i }));
    expect(await screen.findByRole("heading", { name: "Settings" })).toBeDefined();
  });

  it("navigates to / when Today nav item is clicked from another route", async () => {
    const user = userEvent.setup();
    await renderAtRoute("/team");
    await user.click(screen.getByRole("link", { name: /today/i }));
    // TodayScreen renders a greeting heading, not "Today"
    expect(await screen.findByText(/Good (morning|afternoon|evening)/)).toBeDefined();
  });
});

/* ─── Active state highlighting ─── */
describe("Sidebar active state", () => {
  it("highlights Today link with active style at /", async () => {
    await renderAtRoute("/");
    const todayLink = screen.getByRole("link", { name: /today/i });
    expect(todayLink.className).toContain("text-session-active-foreground");
  });

  it("highlights Team link with active style at /team", async () => {
    await renderAtRoute("/team");
    const teamLink = screen.getByRole("link", { name: /team/i });
    expect(teamLink.className).toContain("text-session-active-foreground");
  });

  it("highlights Tasks link with active style at /tasks", async () => {
    await renderAtRoute("/tasks");
    const tasksLink = screen.getByRole("link", { name: /tasks/i });
    expect(tasksLink.className).toContain("text-session-active-foreground");
  });

  it("highlights Review link with active style at /review", async () => {
    await renderAtRoute("/review");
    const reviewLink = screen.getByRole("link", { name: /review/i });
    expect(reviewLink.className).toContain("text-session-active-foreground");
  });

  it("highlights Settings link with active style at /settings", async () => {
    await renderAtRoute("/settings");
    const settingsLink = screen.getByRole("link", { name: /settings/i });
    expect(settingsLink.className).toContain("text-session-active-foreground");
  });

  it("does not highlight non-active links", async () => {
    await renderAtRoute("/team");
    const todayLink = screen.getByRole("link", { name: /today/i });
    expect(todayLink.className).toContain("text-sidebar-foreground");
    expect(todayLink.className).not.toContain("text-session-active-foreground");
  });
});

/* ─── Onboarding route (no sidebar layout) ─── */
describe("Onboarding route", () => {
  it("renders onboarding without sidebar", async () => {
    await renderAtRoute("/onboarding");
    expect(screen.getByText("Welcome to PACE")).toBeDefined();
    // Sidebar nav items should not be present
    expect(screen.queryByRole("link", { name: /today/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /team/i })).toBeNull();
  });

  it("onboarding route exists and is a direct child of root (no app layout)", async () => {
    await renderAtRoute("/onboarding");
    // The PACE logo from sidebar should not be present
    expect(screen.queryByText("PACE")).toBeNull();
    // But the onboarding content should render
    expect(screen.getByText("Welcome to PACE")).toBeDefined();
  });
});
