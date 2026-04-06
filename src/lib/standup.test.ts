import { describe, it, expect } from "vitest";
import { shouldShowStandupPrompt, createStandupResponse } from "@/lib/standup";
import type { StandupResponse } from "@/types";

// --- Helpers ---

function makeResponse(
  userId: string,
  date: string,
  id = "sr-1",
): StandupResponse {
  return {
    id,
    userId,
    date,
    response: "Working on feature X",
    createdAt: 1700000000,
  };
}

// --- shouldShowStandupPrompt ---

describe("shouldShowStandupPrompt", () => {
  it("returns true when no response exists for the user on the date", () => {
    const responses: StandupResponse[] = [];
    expect(shouldShowStandupPrompt("user-1", "2025-07-10", responses)).toBe(true);
  });

  it("returns false when a response exists for the user on the date", () => {
    const responses = [makeResponse("user-1", "2025-07-10")];
    expect(shouldShowStandupPrompt("user-1", "2025-07-10", responses)).toBe(false);
  });

  it("returns true when responses exist for a different user on the same date", () => {
    const responses = [makeResponse("user-2", "2025-07-10")];
    expect(shouldShowStandupPrompt("user-1", "2025-07-10", responses)).toBe(true);
  });

  it("returns true when responses exist for the same user on a different date", () => {
    const responses = [makeResponse("user-1", "2025-07-09")];
    expect(shouldShowStandupPrompt("user-1", "2025-07-10", responses)).toBe(true);
  });

  it("returns false when multiple responses exist and one matches", () => {
    const responses = [
      makeResponse("user-2", "2025-07-10", "sr-1"),
      makeResponse("user-1", "2025-07-10", "sr-2"),
      makeResponse("user-1", "2025-07-09", "sr-3"),
    ];
    expect(shouldShowStandupPrompt("user-1", "2025-07-10", responses)).toBe(false);
  });
});

// --- createStandupResponse ---

describe("createStandupResponse", () => {
  it("creates a standup response with correct fields", () => {
    const r = createStandupResponse("sr-1", "user-1", "2025-07-10", "Building the dashboard");

    expect(r.id).toBe("sr-1");
    expect(r.userId).toBe("user-1");
    expect(r.date).toBe("2025-07-10");
    expect(r.response).toBe("Building the dashboard");
    expect(r.createdAt).toBeGreaterThan(0);
  });

  it("stores the exact response text provided", () => {
    const r = createStandupResponse("sr-2", "user-1", "2025-07-10", "  Fixing bugs  ");
    expect(r.response).toBe("  Fixing bugs  ");
  });
});
