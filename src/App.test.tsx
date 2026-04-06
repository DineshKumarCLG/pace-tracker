import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  createRouter,
  createRootRoute,
  createRoute,
  RouterProvider,
  Outlet,
} from "@tanstack/react-router";

describe("App", () => {
  function renderWithRouter(initialPath = "/") {
    const rootRoute = createRootRoute({ component: () => <Outlet /> });
    const indexRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/",
      component: () => <h1>Today</h1>,
    });
    const routeTree = rootRoute.addChildren([indexRoute]);
    const router = createRouter({ routeTree, history: undefined });

    // Navigate to the desired path
    window.history.pushState({}, "", initialPath);

    return render(<RouterProvider router={router} />);
  }

  it("renders the Today screen at root path", async () => {
    renderWithRouter("/");
    expect(await screen.findByText("Today")).toBeDefined();
  });
});
