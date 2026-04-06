import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for AI response handling.
 *
 * Tests successful responses, malformed responses, empty responses,
 * and timeout scenarios for all AI endpoints.
 *
 * Validates: Requirements 16.3, 10.2, 10.3, 17.5
 */

// --- Mock PocketBase send ---

const mockSend = vi.fn();

vi.mock("@/lib/pocketbase", () => ({
  pb: {
    send: (...args: unknown[]) => mockSend(...args),
  },
}));

// Import after mock setup
import { generateWeeklyReview, parseTask } from "@/lib/ai";

beforeEach(() => {
  mockSend.mockReset();
});

describe("AI Response Handling", () => {
  describe("Weekly review response", () => {
    it("successful response: narrative returned", async () => {
      mockSend.mockResolvedValue({
        narrative: "This week you focused on the PACE App, closing 5 tasks.",
      });

      const result = await generateWeeklyReview("user-1", 1700000000);

      expect(result).toBe("This week you focused on the PACE App, closing 5 tasks.");
      expect(mockSend).toHaveBeenCalledWith("/api/generate-review", {
        method: "POST",
        body: { userId: "user-1", weekStart: 1700000000 },
      });
    });

    it("malformed AI response: returns null (graceful fallback)", async () => {
      mockSend.mockResolvedValue({ unexpected: "format" });

      const result = await generateWeeklyReview("user-1", 1700000000);

      // narrative field missing → returns null
      expect(result).toBeNull();
    });

    it("empty AI response: returns null without crash", async () => {
      mockSend.mockResolvedValue({ narrative: "" });

      const result = await generateWeeklyReview("user-1", 1700000000);

      // Empty string is falsy → returns null
      expect(result).toBeNull();
    });

    it("AI timeout / network error: returns null", async () => {
      mockSend.mockRejectedValue(new Error("Request timeout after 30s"));

      const result = await generateWeeklyReview("user-1", 1700000000);

      expect(result).toBeNull();
    });

    it("passes model preference when provided", async () => {
      mockSend.mockResolvedValue({ narrative: "Review text" });

      await generateWeeklyReview("user-1", 1700000000, "claude-sonnet");

      expect(mockSend).toHaveBeenCalledWith("/api/generate-review", {
        method: "POST",
        body: { userId: "user-1", weekStart: 1700000000, model: "claude-sonnet" },
      });
    });
  });

  describe("Task parse response", () => {
    it("successful parse: structured fields returned correctly", async () => {
      mockSend.mockResolvedValue({
        title: "Send demo to client",
        projectId: "proj-1",
        assigneeId: "user-2",
        priority: "high",
        dueDate: "2024-01-19",
      });

      const result = await parseTask(
        "remind arjun to send demo by friday high priority",
        [{ id: "proj-1", name: "PACE App" }],
        [{ id: "user-2", name: "Arjun" }],
      );

      expect(result.title).toBe("Send demo to client");
      expect(result.projectId).toBe("proj-1");
      expect(result.assigneeId).toBe("user-2");
      expect(result.priority).toBe("high");
      expect(result.dueDate).toBe("2024-01-19");
    });

    it("malformed AI response: raw text used as title", async () => {
      mockSend.mockResolvedValue({ garbage: "data" });

      const result = await parseTask("fix the login bug", [], []);

      // Falls back to raw text as title
      expect(result.title).toBe("fix the login bug");
      expect(result.projectId).toBeNull();
      expect(result.assigneeId).toBeNull();
      expect(result.priority).toBe("medium");
      expect(result.dueDate).toBeNull();
    });

    it("empty AI response: handled without crash", async () => {
      mockSend.mockResolvedValue({});

      const result = await parseTask("some task", [], []);

      expect(result.title).toBe("some task");
      expect(result.priority).toBe("medium");
    });

    it("AI timeout: graceful fallback with raw text as title", async () => {
      mockSend.mockRejectedValue(new Error("timeout"));

      const result = await parseTask("deploy the new version", [], []);

      expect(result.title).toBe("deploy the new version");
      expect(result.projectId).toBeNull();
      expect(result.assigneeId).toBeNull();
      expect(result.priority).toBe("medium");
      expect(result.dueDate).toBeNull();
    });

    it("partial response: missing fields filled with defaults", async () => {
      mockSend.mockResolvedValue({
        title: "Update docs",
        priority: "low",
        // projectId, assigneeId, dueDate missing
      });

      const result = await parseTask("update the docs", [], []);

      expect(result.title).toBe("Update docs");
      expect(result.priority).toBe("low");
      expect(result.projectId).toBeNull();
      expect(result.assigneeId).toBeNull();
      expect(result.dueDate).toBeNull();
    });
  });
});
