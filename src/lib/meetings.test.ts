import { describe, it, expect } from "vitest";
import { createMeeting, validateMeetingTitle } from "@/lib/meetings";

// --- createMeeting ---

describe("createMeeting", () => {
  it("creates a meeting with correct fields", () => {
    const m = createMeeting("mtg-1", "brk-1", "sess-1", "Sprint Planning", "Alice, Bob");

    expect(m.id).toBe("mtg-1");
    expect(m.breakId).toBe("brk-1");
    expect(m.sessionId).toBe("sess-1");
    expect(m.title).toBe("Sprint Planning");
    expect(m.attendees).toBe("Alice, Bob");
    expect(m.createdAt).toBeGreaterThan(0);
  });

  it("allows null attendees", () => {
    const m = createMeeting("mtg-2", "brk-1", "sess-1", "Quick sync", null);
    expect(m.attendees).toBeNull();
  });

  it("trims whitespace from title", () => {
    const m = createMeeting("mtg-3", "brk-1", "sess-1", "  Standup  ", null);
    expect(m.title).toBe("Standup");
  });

  it("throws on empty title", () => {
    expect(() => createMeeting("mtg-4", "brk-1", "sess-1", "", null)).toThrow(
      "Meeting title is required and must be non-empty",
    );
  });

  it("throws on whitespace-only title", () => {
    expect(() => createMeeting("mtg-5", "brk-1", "sess-1", "   ", null)).toThrow(
      "Meeting title is required and must be non-empty",
    );
  });

  it("preserves breakId and sessionId linkage", () => {
    const m = createMeeting("mtg-6", "brk-42", "sess-99", "Design Review", null);
    expect(m.breakId).toBe("brk-42");
    expect(m.sessionId).toBe("sess-99");
  });
});

// --- validateMeetingTitle ---

describe("validateMeetingTitle", () => {
  it("returns true for non-empty title", () => {
    expect(validateMeetingTitle("Sprint Planning")).toBe(true);
  });

  it("returns true for single character", () => {
    expect(validateMeetingTitle("X")).toBe(true);
  });

  it("returns false for empty string", () => {
    expect(validateMeetingTitle("")).toBe(false);
  });

  it("returns false for whitespace-only string", () => {
    expect(validateMeetingTitle("   ")).toBe(false);
  });

  it("returns true for title with leading/trailing whitespace", () => {
    expect(validateMeetingTitle("  Meeting  ")).toBe(true);
  });
});
