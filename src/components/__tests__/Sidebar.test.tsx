import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  createRouter,
  createRootRoute,
  createRoute,
  RouterProvider,
  Outlet,
} from "@tanstack/react-router";
import { createMemoryHistory } from "@tanstack/history";
import Sidebar from "@/components/Sidebar";
import { useAuthStore } from "@/stores/authStore";

function buildRouter(initialPath = "/") {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const layoutRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: "layout",
    component: () => (
      <div>
        <Sidebar />
        <Outlet />
      </div>
    ),
  });
  const indexRoute = createRoute({
    getParentRoute: () => layoutRoute,
    path: "/",
    component: () => <div>Home</div>,
  });
  const routeTree = rootRoute.addChildren([
    layoutRoute.addChildren([indexRoute]),
  ]);
  const history = createMemoryHistory({ initialEntries: [initialPath] });
  return createRouter({ routeTree, history });
}

async function renderSidebar(role: string | null = null) {
  useAuthStore.setState({
    user: role
      ? { id: "u1", name: "Test", email: "t@t.com", role, avatarColor: "#000" }
      : null,
    isAuthenticated: !!role,
    isLoading: false,
  });
  const router = buildRouter("/");
  render(<RouterProvider router={router} />);
  // Wait for router to settle
  await screen.findByText("PACE");
}

beforeEach(() => {
  useAuthStore.setState({
    user: null,
    isAuthenticated: false,
    isLoading: false,
  });
});

describe("Sidebar Governance section", () => {
  it("shows Governance section for founder role", async () => {
    await renderSidebar("Co-founder, Engineering");
    expect(screen.getByText("Governance")).toBeDefined();
    expect(screen.getByRole("link", { name: /founder review/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /leaderboard/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /equity/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /startup health/i })).toBeDefined();
  });

  it("shows Governance section for CEO role", async () => {
    await renderSidebar("CEO");
    expect(screen.getByText("Governance")).toBeDefined();
    expect(screen.getByRole("link", { name: /founder review/i })).toBeDefined();
  });

  it("hides Governance section for non-founder role", async () => {
    await renderSidebar("engineer");
    expect(screen.queryByText("Governance")).toBeNull();
    expect(screen.queryByRole("link", { name: /founder review/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /leaderboard/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /equity/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /startup health/i })).toBeNull();
  });

  it("hides Governance section when user is null", async () => {
    await renderSidebar(null);
    expect(screen.queryByText("Governance")).toBeNull();
  });

  it("keeps all v1 and Team Ops items for founders", async () => {
    await renderSidebar("Co-founder");
    expect(screen.getByRole("link", { name: /today/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /team/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /tasks/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /dashboard/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /attendance/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /leave/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /requests/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /analytics/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /digest/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /settings/i })).toBeDefined();
  });

  it("does not show Monthly sidebar item", async () => {
    await renderSidebar("Co-founder");
    expect(screen.queryByRole("link", { name: /monthly/i })).toBeNull();
  });

  it("governance links point to correct routes", async () => {
    await renderSidebar("Co-founder, CEO");
    const founderReview = screen.getByRole("link", { name: /founder review/i });
    const leaderboard = screen.getByRole("link", { name: /leaderboard/i });
    const equity = screen.getByRole("link", { name: /equity/i });
    const startupHealth = screen.getByRole("link", { name: /startup health/i });
    expect(founderReview.getAttribute("href")).toBe("/founder-review");
    expect(leaderboard.getAttribute("href")).toBe("/leaderboard");
    expect(equity.getAttribute("href")).toBe("/equity");
    expect(startupHealth.getAttribute("href")).toBe("/startup-health");
  });
});
