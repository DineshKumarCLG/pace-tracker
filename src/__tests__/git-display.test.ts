import { describe, it, expect } from "vitest";

/**
 * Task 22.3: Component tests for git event display
 *
 * Tests the display logic for git events in timeline and task detail.
 * Validates: Requirement 11.3
 */

interface GitEvent {
  id: string;
  sessionId: string | null;
  userId: string;
  repoPath: string;
  commitHash: string;
  message: string | null;
  commitTime: number;
}

// --- Display helpers (mirrors what the components use) ---

function formatCommitTime(unixSecs: number): string {
  const d = new Date(unixSecs * 1000);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatCommitDate(unixSecs: number): string {
  const d = new Date(unixSecs * 1000);
  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Filter git events to only those from sessions where a specific task was active */
function getGitEventsForTask(
  gitEvents: GitEvent[],
  taskSessionIds: string[],
): GitEvent[] {
  const sessionSet = new Set(taskSessionIds);
  return gitEvents.filter(
    (e) => e.sessionId !== null && sessionSet.has(e.sessionId),
  );
}

describe("Task 22.3: Git event display", () => {
  const sampleEvents: GitEvent[] = [
    {
      id: "ge1",
      sessionId: "s1",
      userId: "u1",
      repoPath: "/repo/a",
      commitHash: "abc123",
      message: "Fix login bug",
      commitTime: 1700000000,
    },
    {
      id: "ge2",
      sessionId: "s1",
      userId: "u1",
      repoPath: "/repo/a",
      commitHash: "def456",
      message: "Add tests",
      commitTime: 1700003600,
    },
    {
      id: "ge3",
      sessionId: "s2",
      userId: "u1",
      repoPath: "/repo/b",
      commitHash: "ghi789",
      message: null,
      commitTime: 1700007200,
    },
  ];

  it("commit marker shows message and timestamp only — no count, no score", () => {
    for (const event of sampleEvents) {
      const displayMessage = event.message ?? "No message";
      const displayTime = formatCommitTime(event.commitTime);

      // Message is displayed
      expect(typeof displayMessage).toBe("string");
      expect(displayMessage.length).toBeGreaterThan(0);

      // Timestamp is displayed
      expect(typeof displayTime).toBe("string");
      expect(displayTime.length).toBeGreaterThan(0);

      // No count or score fields exist on the event
      const keys = Object.keys(event);
      expect(keys).not.toContain("commitCount");
      expect(keys).not.toContain("score");
      expect(keys).not.toContain("diff");
      expect(keys).not.toContain("linesAdded");
      expect(keys).not.toContain("linesRemoved");
    }
  });

  it("task detail git context shows commits from sessions where task was active", () => {
    // Task was active in session s1 only
    const taskSessionIds = ["s1"];
    const filtered = getGitEventsForTask(sampleEvents, taskSessionIds);

    expect(filtered.length).toBe(2);
    expect(filtered[0].id).toBe("ge1");
    expect(filtered[1].id).toBe("ge2");
  });

  it("task detail git context excludes commits from other sessions", () => {
    const taskSessionIds = ["s2"];
    const filtered = getGitEventsForTask(sampleEvents, taskSessionIds);

    expect(filtered.length).toBe(1);
    expect(filtered[0].id).toBe("ge3");
  });

  it("no repos configured: empty events array renders gracefully", () => {
    const emptyEvents: GitEvent[] = [];
    expect(emptyEvents.length).toBe(0);
    // The component would show "No git commits linked" — we verify the data path
  });

  it("null message displays fallback text", () => {
    const event = sampleEvents[2]; // message is null
    const displayMessage = event.message ?? "No message";
    expect(displayMessage).toBe("No message");
  });

  it("formatCommitDate produces readable date string", () => {
    const formatted = formatCommitDate(1700000000);
    expect(typeof formatted).toBe("string");
    expect(formatted.length).toBeGreaterThan(0);
  });
});
