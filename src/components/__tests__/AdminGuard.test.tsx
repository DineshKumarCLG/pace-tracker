import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

let mockAuthState = {
  user: null as { role: string | null } | null,
};

vi.mock("@/stores/authStore", () => ({
  useAuthStore: (selector?: (s: typeof mockAuthState) => unknown) => {
    if (typeof selector === "function") return selector(mockAuthState);
    return mockAuthState;
  },
}));

import AdminGuard from "@/components/AdminGuard";

beforeEach(() => {
  mockAuthState = { user: null };
});

describe("AdminGuard", () => {
  it("renders children when user has admin role", () => {
    mockAuthState = { user: { role: "admin" } };
    render(
      <AdminGuard>
        <div data-testid="protected">Secret</div>
      </AdminGuard>,
    );
    expect(screen.getByTestId("protected")).toBeDefined();
    expect(screen.queryByText("Admin access required")).toBeNull();
  });

  it("renders children when user has CEO role", () => {
    mockAuthState = { user: { role: "CEO" } };
    render(
      <AdminGuard>
        <div data-testid="protected">Secret</div>
      </AdminGuard>,
    );
    expect(screen.getByTestId("protected")).toBeDefined();
  });

  it("shows denial message for non-admin role", () => {
    mockAuthState = { user: { role: "engineer" } };
    render(
      <AdminGuard>
        <div data-testid="protected">Secret</div>
      </AdminGuard>,
    );
    expect(screen.getByText("Admin access required")).toBeDefined();
    expect(screen.queryByTestId("protected")).toBeNull();
  });

  it("shows denial message when user is null", () => {
    mockAuthState = { user: null };
    render(
      <AdminGuard>
        <div data-testid="protected">Secret</div>
      </AdminGuard>,
    );
    expect(screen.getByText("Admin access required")).toBeDefined();
    expect(screen.queryByTestId("protected")).toBeNull();
  });

  it("shows denial message for founder (non-admin) role", () => {
    mockAuthState = { user: { role: "Co-founder, Engineering" } };
    render(
      <AdminGuard>
        <div data-testid="protected">Secret</div>
      </AdminGuard>,
    );
    expect(screen.getByText("Admin access required")).toBeDefined();
    expect(screen.queryByTestId("protected")).toBeNull();
  });
});
