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

import FounderGuard from "@/components/FounderGuard";

beforeEach(() => {
  mockAuthState = { user: null };
});

describe("FounderGuard", () => {
  it("renders children when user has founder role", () => {
    mockAuthState = { user: { role: "Co-founder, Engineering" } };
    render(
      <FounderGuard>
        <div data-testid="protected">Secret</div>
      </FounderGuard>,
    );
    expect(screen.getByTestId("protected")).toBeDefined();
    expect(screen.queryByText("Founders only")).toBeNull();
  });

  it("renders children when user has CEO role", () => {
    mockAuthState = { user: { role: "CEO" } };
    render(
      <FounderGuard>
        <div data-testid="protected">Secret</div>
      </FounderGuard>,
    );
    expect(screen.getByTestId("protected")).toBeDefined();
  });

  it("shows denial message for non-founder role", () => {
    mockAuthState = { user: { role: "engineer" } };
    render(
      <FounderGuard>
        <div data-testid="protected">Secret</div>
      </FounderGuard>,
    );
    expect(screen.getByText("Founders only")).toBeDefined();
    expect(screen.queryByTestId("protected")).toBeNull();
  });

  it("shows denial message when user is null", () => {
    mockAuthState = { user: null };
    render(
      <FounderGuard>
        <div data-testid="protected">Secret</div>
      </FounderGuard>,
    );
    expect(screen.getByText("Founders only")).toBeDefined();
    expect(screen.queryByTestId("protected")).toBeNull();
  });

  it("shows denial message when role is null", () => {
    mockAuthState = { user: { role: null } };
    render(
      <FounderGuard>
        <div data-testid="protected">Secret</div>
      </FounderGuard>,
    );
    expect(screen.getByText("Founders only")).toBeDefined();
    expect(screen.queryByTestId("protected")).toBeNull();
  });
});
