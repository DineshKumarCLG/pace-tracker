import { describe, it, expect } from "vitest";
import { createMoodCheck, handleMoodDismissal } from "@/lib/mood";

// --- createMoodCheck ---

describe("createMoodCheck", () => {
  it("creates a mood check with correct fields", () => {
    const m = createMoodCheck("mc-1", "user-1", "sess-1", 4, "focused");

    expect(m.id).toBe("mc-1");
    expect(m.userId).toBe("user-1");
    expect(m.sessionId).toBe("sess-1");
    expect(m.energy).toBe(4);
    expect(m.moodTag).toBe("focused");
    expect(m.createdAt).toBeGreaterThan(0);
  });

  it("allows null moodTag", () => {
    const m = createMoodCheck("mc-2", "user-1", "sess-1", 3, null);
    expect(m.moodTag).toBeNull();
  });

  it("accepts energy level 1 (minimum)", () => {
    const m = createMoodCheck("mc-3", "user-1", "sess-1", 1, null);
    expect(m.energy).toBe(1);
  });

  it("accepts energy level 5 (maximum)", () => {
    const m = createMoodCheck("mc-4", "user-1", "sess-1", 5, null);
    expect(m.energy).toBe(5);
  });

  it("throws on energy below 1", () => {
    expect(() => createMoodCheck("mc-5", "user-1", "sess-1", 0, null)).toThrow(
      "Energy must be an integer between 1 and 5",
    );
  });

  it("throws on energy above 5", () => {
    expect(() => createMoodCheck("mc-6", "user-1", "sess-1", 6, null)).toThrow(
      "Energy must be an integer between 1 and 5",
    );
  });

  it("throws on non-integer energy", () => {
    expect(() => createMoodCheck("mc-7", "user-1", "sess-1", 3.5, null)).toThrow(
      "Energy must be an integer between 1 and 5",
    );
  });
});

// --- handleMoodDismissal ---

describe("handleMoodDismissal", () => {
  it("returns null", () => {
    expect(handleMoodDismissal()).toBeNull();
  });

  it("returns null every time (no side effects)", () => {
    expect(handleMoodDismissal()).toBeNull();
    expect(handleMoodDismissal()).toBeNull();
    expect(handleMoodDismissal()).toBeNull();
  });
});
