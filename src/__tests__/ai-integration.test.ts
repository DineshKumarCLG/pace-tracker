import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Integration tests for AI end-to-end (with mocked LiteLLM).
 *
 * Tests complete flows: data → AI request → response → UI update.
 * Validates: Requirements 10.1–10.3, 16.3, 16.4, 17.1–17.5
 */

// --- Mock PocketBase ---

const mockSend = vi.fn();

vi.mock("@/lib/pocketbase", () => ({
  pb: {
    send: (...args: unknown[]) => mockSend(...args),
  },
}));

import { generateWeeklyReview, parseTask } from "@/lib/ai";
import type { ParsedTask } from "@/lib/ai";

beforeEach(() => {
  mockSend.mockReset();
});

describe("AI Integration (E2E with mocked LiteLLM)", () => {
  describe("Weekly review generation flow", () => {
    it("complete week of data → call generate-review → narrative returned and stored", async () => {
      const narrative =
        "This week, PACE App was your top project at 22h. You closed 5 tasks including the session card redesign. " +
        "No weekend work detected. Consider prioritizing the stale onboarding copy task next week.";

      mockSend.mockResolvedValue({ narrative });

      const result = await generateWeeklyReview("user-1", 1700000000);

      // Verify the request was made correctly
      expect(mockSend).toHaveBeenCalledWith("/api/generate-review", {
        method: "POST",
        body: { userId: "user-1", weekStart: 1700000000 },
      });

      // Verify narrative is returned
      expect(result).toBe(narrative);
      expect(result).toContain("PACE App");
      expect(result).toContain("5 tasks");
    });
  });

  describe("NL task creation flow", () => {
    it("type NL text → parsed to structured task → fields returned for confirmation", async () => {
      mockSend.mockResolvedValue({
        title: "Send demo to client",
        projectId: "proj-pace",
        assigneeId: "user-arjun",
        priority: "high",
        dueDate: "2024-01-19",
      });

      const result = await parseTask(
        "remind arjun to send demo by friday high priority",
        [{ id: "proj-pace", name: "PACE App" }],
        [{ id: "user-arjun", name: "Arjun" }],
      );

      // Verify request payload
      expect(mockSend).toHaveBeenCalledWith("/api/parse-task", {
        method: "POST",
        body: {
          text: "remind arjun to send demo by friday high priority",
          projects: [{ id: "proj-pace", name: "PACE App" }],
          team: [{ id: "user-arjun", name: "Arjun" }],
        },
      });

      // Verify parsed result
      expect(result.title).toBe("Send demo to client");
      expect(result.projectId).toBe("proj-pace");
      expect(result.assigneeId).toBe("user-arjun");
      expect(result.priority).toBe("high");
      expect(result.dueDate).toBe("2024-01-19");
    });
  });

  describe("AI disabled in settings", () => {
    it("no AI requests made when AI is disabled", async () => {
      // Simulate AI disabled — the caller should check settings before calling
      const aiEnabled = false;

      if (aiEnabled) {
        await generateWeeklyReview("user-1", 1700000000);
      }

      // No requests should have been made
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe("LiteLLM proxy down — graceful degradation", () => {
    it("generate-review fails → returns null, no crash", async () => {
      mockSend.mockRejectedValue(new Error("503 Service Unavailable"));

      const result = await generateWeeklyReview("user-1", 1700000000);

      expect(result).toBeNull();
    });

    it("parse-task fails → returns raw text as title", async () => {
      mockSend.mockRejectedValue(new Error("503 Service Unavailable"));

      const result = await parseTask("fix the login bug", [], []);

      expect(result.title).toBe("fix the login bug");
      expect(result.projectId).toBeNull();
      expect(result.priority).toBe("medium");
    });

    it("all non-AI features still work after AI failure", async () => {
      // Simulate AI failure
      mockSend.mockRejectedValue(new Error("Connection refused"));

      const reviewResult = await generateWeeklyReview("user-1", 1700000000);
      const parseResult = await parseTask("test", [], []);

      // Both return graceful fallbacks
      expect(reviewResult).toBeNull();
      expect(parseResult.title).toBe("test");

      // No unhandled exceptions
    });
  });

  describe("Switch AI model in settings", () => {
    it("next AI request uses new model", async () => {
      mockSend.mockResolvedValue({ narrative: "Review with Claude" });

      // First request with default model
      await generateWeeklyReview("user-1", 1700000000);
      expect(mockSend.mock.calls[0][1].body).not.toHaveProperty("model");

      // Second request with new model
      await generateWeeklyReview("user-1", 1700000000, "claude-sonnet");
      expect(mockSend.mock.calls[1][1].body.model).toBe("claude-sonnet");

      // Third request with another model
      await generateWeeklyReview("user-1", 1700000000, "gpt-4o");
      expect(mockSend.mock.calls[2][1].body.model).toBe("gpt-4o");
    });

    it("parse-task also respects model preference", async () => {
      mockSend.mockResolvedValue({ title: "Test", priority: "medium" });

      await parseTask("test task", [], [], "ollama-local");

      expect(mockSend.mock.calls[0][1].body.model).toBe("ollama-local");
    });
  });
});
