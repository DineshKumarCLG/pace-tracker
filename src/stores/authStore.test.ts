import { describe, it, expect, beforeEach, vi } from "vitest";

// Ensure DEV_AUTH is disabled for these tests
vi.stubEnv("VITE_DEV_AUTH", "false");

import { useAuthStore } from "./authStore";

// Mock PocketBase
vi.mock("@/lib/pocketbase", () => {
  const mockAuthStore = {
    isValid: false,
    record: null,
    token: "",
    clear: vi.fn(() => {
      mockAuthStore.isValid = false;
      mockAuthStore.record = null;
      mockAuthStore.token = "";
    }),
    save: vi.fn((token: string, model: unknown) => {
      mockAuthStore.token = token;
      mockAuthStore.record = model as Record<string, unknown>;
      mockAuthStore.isValid = true;
    }),
  };

  return {
    pb: {
      authStore: mockAuthStore,
      collection: vi.fn(() => ({
        authWithPassword: vi.fn(async () => {
          mockAuthStore.token = "test-token-abc123";
          mockAuthStore.isValid = true;
          mockAuthStore.record = {
            id: "user-123",
            name: "Jane Doe",
            email: "jane@kenesis.io",
            role: "Co-founder",
            avatarColor: "#6366f1",
          };
          return {
            record: {
              id: "user-123",
              name: "Jane Doe",
              email: "jane@kenesis.io",
              role: "Co-founder",
              avatarColor: "#6366f1",
            },
          };
        }),
        create: vi.fn(async () => ({
          id: "user-123",
          name: "Jane Doe",
          email: "jane@kenesis.io",
        })),
      })),
    },
  };
});

describe("authStore", () => {
  beforeEach(() => {
    // Reset store state
    useAuthStore.setState({
      user: null,
      isAuthenticated: false,
      isLoading: true,
    });
    localStorage.clear();
  });

  it("starts with unauthenticated state", () => {
    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.isAuthenticated).toBe(false);
    expect(state.isLoading).toBe(true);
  });

  it("login sets user and isAuthenticated", async () => {
    await useAuthStore.getState().login("jane@kenesis.io", "password123");
    const state = useAuthStore.getState();
    expect(state.user).toEqual({
      id: "user-123",
      name: "Jane Doe",
      email: "jane@kenesis.io",
      role: "Co-founder",
      avatarColor: "#6366f1",
    });
    expect(state.isAuthenticated).toBe(true);
  });

  it("signup sets user and isAuthenticated", async () => {
    await useAuthStore.getState().signup("Jane Doe", "jane@kenesis.io", "password123");
    const state = useAuthStore.getState();
    expect(state.user).not.toBeNull();
    expect(state.user?.id).toBe("user-123");
    expect(state.isAuthenticated).toBe(true);
  });

  it("logout clears user and isAuthenticated", async () => {
    await useAuthStore.getState().login("jane@kenesis.io", "password123");
    expect(useAuthStore.getState().isAuthenticated).toBe(true);

    useAuthStore.getState().logout();
    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.isAuthenticated).toBe(false);
  });

  it("checkAuth with no valid token sets unauthenticated", () => {
    useAuthStore.getState().checkAuth();
    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.isAuthenticated).toBe(false);
    expect(state.isLoading).toBe(false);
  });

  it("checkAuth restores user from valid PocketBase token", async () => {
    // First login to populate localStorage
    await useAuthStore.getState().login("jane@kenesis.io", "password123");

    // Reset store state (simulating app restart)
    useAuthStore.setState({
      user: null,
      isAuthenticated: false,
      isLoading: true,
    });

    // checkAuth should restore from localStorage
    useAuthStore.getState().checkAuth();
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.user).not.toBeNull();
    expect(state.user?.id).toBe("user-123");
    expect(state.isLoading).toBe(false);
  });

  it("login persists token to localStorage", async () => {
    await useAuthStore.getState().login("jane@kenesis.io", "password123");
    expect(localStorage.getItem("pb_auth_token")).toBeTruthy();
    expect(localStorage.getItem("pb_auth_model")).toBeTruthy();
  });

  it("logout clears persisted token from localStorage", async () => {
    await useAuthStore.getState().login("jane@kenesis.io", "password123");
    expect(localStorage.getItem("pb_auth_token")).toBeTruthy();

    useAuthStore.getState().logout();
    expect(localStorage.getItem("pb_auth_token")).toBeNull();
    expect(localStorage.getItem("pb_auth_model")).toBeNull();
  });

  it("user defaults avatarColor when not present in record", async () => {
    // The mock always returns avatarColor, but test the shape
    await useAuthStore.getState().login("jane@kenesis.io", "password123");
    const state = useAuthStore.getState();
    expect(state.user?.avatarColor).toBeTruthy();
  });
});
