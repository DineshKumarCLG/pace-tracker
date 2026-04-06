/**
 * AuthGuard component tests.
 *
 * Verifies redirect behavior:
 * - Unauthenticated → /auth
 * - Authenticated, no team → /onboarding
 * - Authenticated + team → renders children
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import {
  createRouter,
  createRootRoute,
  createRoute,
  RouterProvider,
  Outlet,
} from "@tanstack/react-router";
import { createMemoryHistory } from "@tanstack/history";

// Mock getUserTeam from db
const mockGetUserTeam = vi.fn();
vi.mock("@/lib/db", () => ({
  getUserTeam: (...args: unknown[]) => mockGetUserTeam(...args),
}));

// Mock authStore — we control state via mockAuthState
let mockAuthState = {
  isAuthenticated: false,
  isLoading: false,
  user: null as { id: string; name: string; email: string; role: string | null; avatarColor: string } | null,
};

vi.mock("@/stores/authStore", () => ({
  useAuthStore: (selector?: (s: typeof mockAuthState) => unknown) => {
    if (typeof selector === "function") return selector(mockAuthState);
    return mockAuthState;
  },
}));

// Import AuthGuard after mocks are set up
import AuthGuard from "@/components/AuthGuard";

function buildGuardedRouter(initialPath = "/") {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });

  const guardedRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: "guarded",
    component: () => (
      <AuthGuard>
        <div data-testid="protected-content">Protected App</div>
      </AuthGuard>
    ),
  });

  const indexRoute = createRoute({
    getParentRoute: () => guardedRoute,
    path: "/",
    component: () => <div>Home</div>,
  });

  const authRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/auth",
    component: () => <div data-testid="auth-screen">Auth Screen</div>,
  });

  const onboardingRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/onboarding",
    component: () => <div data-testid="onboarding-screen">Onboarding Screen</div>,
  });

  const routeTree = rootRoute.addChildren([
    guardedRoute.addChildren([indexRoute]),
    authRoute,
    onboardingRoute,
  ]);

  const history = createMemoryHistory({ initialEntries: [initialPath] });
  return createRouter({ routeTree, history });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthState = {
    isAuthenticated: false,
    isLoading: false,
    user: null,
  };
});

describe("AuthGuard", () => {
  it("shows loading state while auth is being checked", async () => {
    mockAuthState = {
      isAuthenticated: false,
      isLoading: true,
      user: null,
    };

    const router = buildGuardedRouter("/");
    render(<RouterProvider router={router} />);

    await waitFor(() => {
      expect(router.state.status).toBe("idle");
    });

    expect(screen.getByText("Loading…")).toBeDefined();
    expect(screen.queryByTestId("protected-content")).toBeNull();
  });

  it("redirects to /auth when not authenticated", async () => {
    mockAuthState = {
      isAuthenticated: false,
      isLoading: false,
      user: null,
    };

    const router = buildGuardedRouter("/");
    render(<RouterProvider router={router} />);

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/auth");
    });

    expect(screen.getByTestId("auth-screen")).toBeDefined();
    expect(screen.queryByTestId("protected-content")).toBeNull();
  });

  it("redirects to /onboarding when authenticated but no team", async () => {
    mockAuthState = {
      isAuthenticated: true,
      isLoading: false,
      user: { id: "u1", name: "Test", email: "t@t.com", role: null, avatarColor: "#000" },
    };
    mockGetUserTeam.mockResolvedValue(null);

    const router = buildGuardedRouter("/");
    render(<RouterProvider router={router} />);

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/onboarding");
    });

    expect(screen.getByTestId("onboarding-screen")).toBeDefined();
    expect(screen.queryByTestId("protected-content")).toBeNull();
  });

  it("renders children when authenticated and has team", async () => {
    mockAuthState = {
      isAuthenticated: true,
      isLoading: false,
      user: { id: "u1", name: "Test", email: "t@t.com", role: null, avatarColor: "#000" },
    };
    mockGetUserTeam.mockResolvedValue({
      id: "team-1",
      name: "Kenesis",
      inviteCode: "ABC123",
      createdBy: "u1",
      createdAt: 1000,
    });

    const router = buildGuardedRouter("/");
    render(<RouterProvider router={router} />);

    await waitFor(() => {
      expect(screen.getByTestId("protected-content")).toBeDefined();
    });

    expect(router.state.location.pathname).toBe("/");
  });

  it("allows access when team check fails (offline fallback)", async () => {
    mockAuthState = {
      isAuthenticated: true,
      isLoading: false,
      user: { id: "u1", name: "Test", email: "t@t.com", role: null, avatarColor: "#000" },
    };
    mockGetUserTeam.mockRejectedValue(new Error("Network error"));

    const router = buildGuardedRouter("/");
    render(<RouterProvider router={router} />);

    await waitFor(() => {
      expect(screen.getByTestId("protected-content")).toBeDefined();
    });

    // Should stay on / and not redirect
    expect(router.state.location.pathname).toBe("/");
  });
});
