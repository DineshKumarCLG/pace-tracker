/**
 * Onboarding Screen — Unit tests
 *
 * Tests the multi-step onboarding flow: Welcome → Profile → Team → Project.
 * Mocks PocketBase and authStore to isolate UI behavior.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Mock PocketBase before importing the component
vi.mock("@/lib/pocketbase", () => ({
  pb: {
    collection: vi.fn(() => ({
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({ id: "team-1" }),
      getList: vi.fn().mockResolvedValue({ items: [{ id: "team-1" }] }),
    })),
  },
}));

// Mock TanStack Router
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({
    navigate: vi.fn(),
  }),
}));

// Mock authStore
const mockUser = {
  id: "user-1",
  name: "Jane Doe",
  email: "jane@kenesis.io",
  role: null,
  avatarColor: "#6e6af6",
};

vi.mock("@/stores/authStore", () => ({
  useAuthStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) =>
      selector({ user: mockUser }),
    {
      setState: vi.fn(),
      getState: vi.fn(() => ({ user: mockUser })),
      subscribe: vi.fn(),
      destroy: vi.fn(),
    },
  ),
}));

// Dynamic import after mocks
const { default: OnboardingScreen } = await import(
  "@/screens/Onboarding/index"
);

describe("OnboardingScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the Welcome step initially", () => {
    render(<OnboardingScreen />);
    expect(screen.getByText("Welcome to PACE")).toBeDefined();
    expect(screen.getByText("Track work, not people.")).toBeDefined();
    expect(screen.getByText("Get started")).toBeDefined();
  });

  it("advances to Profile step on 'Get started' click", () => {
    render(<OnboardingScreen />);
    fireEvent.click(screen.getByText("Get started"));
    expect(screen.getByText("Set up your profile")).toBeDefined();
    expect(
      screen.getByPlaceholderText("e.g. Co-founder, Engineering"),
    ).toBeDefined();
  });

  it("shows avatar color picker on Profile step", () => {
    render(<OnboardingScreen />);
    fireEvent.click(screen.getByText("Get started"));
    expect(screen.getByText("Avatar color")).toBeDefined();
    // Should show the user's initial in the avatar preview
    expect(screen.getByText("J")).toBeDefined();
  });

  it("shows validation error when role is empty on Profile step", async () => {
    render(<OnboardingScreen />);
    fireEvent.click(screen.getByText("Get started"));
    fireEvent.click(screen.getByText("Continue"));
    await waitFor(() => {
      expect(screen.getByText("Enter your role or title")).toBeDefined();
    });
  });

  it("advances to Team step after filling profile", async () => {
    render(<OnboardingScreen />);
    // Step 1 → 2
    fireEvent.click(screen.getByText("Get started"));
    // Fill role
    const roleInput = screen.getByPlaceholderText(
      "e.g. Co-founder, Engineering",
    );
    fireEvent.change(roleInput, { target: { value: "Co-founder" } });
    fireEvent.click(screen.getByText("Continue"));

    await waitFor(() => {
      expect(screen.getByText("Set up your team")).toBeDefined();
    });
  });

  it("shows Create team and Join team tabs on Team step", async () => {
    render(<OnboardingScreen />);
    fireEvent.click(screen.getByText("Get started"));
    const roleInput = screen.getByPlaceholderText(
      "e.g. Co-founder, Engineering",
    );
    fireEvent.change(roleInput, { target: { value: "Engineer" } });
    fireEvent.click(screen.getByText("Continue"));

    await waitFor(() => {
      expect(screen.getByText("Create team")).toBeDefined();
      expect(screen.getByText("Join team")).toBeDefined();
    });
  });

  it("shows team name field in Create mode", async () => {
    render(<OnboardingScreen />);
    fireEvent.click(screen.getByText("Get started"));
    fireEvent.change(
      screen.getByPlaceholderText("e.g. Co-founder, Engineering"),
      { target: { value: "CTO" } },
    );
    fireEvent.click(screen.getByText("Continue"));

    await waitFor(() => {
      expect(
        screen.getByPlaceholderText("e.g. Kenesis Labs"),
      ).toBeDefined();
    });
  });

  it("shows invite code field in Join mode", async () => {
    render(<OnboardingScreen />);
    fireEvent.click(screen.getByText("Get started"));
    fireEvent.change(
      screen.getByPlaceholderText("e.g. Co-founder, Engineering"),
      { target: { value: "CTO" } },
    );
    fireEvent.click(screen.getByText("Continue"));

    await waitFor(() => {
      fireEvent.click(screen.getByText("Join team"));
      expect(
        screen.getByPlaceholderText("Paste the 8-character code"),
      ).toBeDefined();
    });
  });
});
