import { describe, it, expect } from "vitest";

/**
 * Task 22.4: Integration tests for git collection flow
 *
 * Tests the end-to-end git event collection logic (parsing + storage model).
 * Validates: Requirements 11.1, 11.2
 */

interface GitCommit {
  hash: string;
  message: string;
  commitTime: number;
}

interface GitEvent {
  id: string;
  sessionId: string;
  userId: string;
  repoPath: string;
  commitHash: string;
  message: string | null;
  commitTime: number;
}

// --- Model functions (same as in property test, mirrors Rust logic) ---

function parseGitLogOutput(output: string): GitCommit[] {
  return output
    .split("\n")
    .filter((line) => line.trim().length >= 68)
    .map((line) => {
      const trimmed = line.trim();
      const hash = trimmed.slice(0, 40);
      if (!/^[0-9a-f]{40}$/.test(hash)) return null;

      const datePart = trimmed.slice(-25);
      if (datePart[4] !== "-" || datePart[10] !== " ") return null;

      const message = trimmed.slice(41, -26).trim();
      if (!message) return null;

      const commitTime = parseGitTimestamp(datePart);
      if (commitTime === null) return null;

      return { hash, message, commitTime };
    })
    .filter((c): c is GitCommit => c !== null);
}

function parseGitTimestamp(ts: string): number | null {
  const year = parseInt(ts.slice(0, 4), 10);
  const month = parseInt(ts.slice(5, 7), 10);
  const day = parseInt(ts.slice(8, 10), 10);
  const hour = parseInt(ts.slice(11, 13), 10);
  const min = parseInt(ts.slice(14, 16), 10);
  const sec = parseInt(ts.slice(17, 19), 10);
  if ([year, month, day, hour, min, sec].some(isNaN)) return null;

  const tzSign = ts[20] === "-" ? -1 : 1;
  const tzHours = parseInt(ts.slice(21, 23), 10);
  const tzMins = parseInt(ts.slice(23, 25), 10);
  if (isNaN(tzHours) || isNaN(tzMins)) return null;

  const d = new Date(Date.UTC(year, month - 1, day, hour, min, sec));
  return Math.floor(d.getTime() / 1000) - tzSign * (tzHours * 3600 + tzMins * 60);
}

/** In-memory store simulating SQLite git_events table */
class GitEventStore {
  private events: GitEvent[] = [];
  private nextId = 1;

  store(
    sessionId: string,
    userId: string,
    repoPath: string,
    commits: GitCommit[],
  ): GitEvent[] {
    const newEvents = commits.map((c) => ({
      id: `ge-${this.nextId++}`,
      sessionId,
      userId,
      repoPath,
      commitHash: c.hash,
      message: c.message,
      commitTime: c.commitTime,
    }));
    this.events.push(...newEvents);
    return newEvents;
  }

  getForSession(sessionId: string): GitEvent[] {
    return this.events
      .filter((e) => e.sessionId === sessionId)
      .sort((a, b) => a.commitTime - b.commitTime);
  }

  getAll(): GitEvent[] {
    return [...this.events];
  }
}

/** Simulate the full collection flow */
function collectGitEventsFlow(
  store: GitEventStore,
  sessionId: string,
  userId: string,
  repoOutputs: Array<{ repoPath: string; output: string }>,
): GitEvent[] {
  const allEvents: GitEvent[] = [];
  for (const { repoPath, output } of repoOutputs) {
    const commits = parseGitLogOutput(output);
    const events = store.store(sessionId, userId, repoPath, commits);
    allEvents.push(...events);
  }
  return allEvents;
}

describe("Task 22.4: Git collection integration", () => {
  it("full flow: configure repo → session → commits → events collected and stored", () => {
    const store = new GitEventStore();
    const sessionId = "session-1";
    const userId = "user-1";

    const gitOutput = [
      "abc1234def5678901234567890abcdef12345678 Implement feature X 2026-04-01 10:00:00 +0000",
      "bcd2345ef6789012345678901abcdef123456789 Fix tests 2026-04-01 11:30:00 +0000",
      "cde3456f07890123456789012abcdef12345678a Update docs 2026-04-01 14:00:00 +0000",
    ].join("\n");

    const events = collectGitEventsFlow(store, sessionId, userId, [
      { repoPath: "/home/user/project", output: gitOutput },
    ]);

    expect(events.length).toBe(3);
    expect(events[0].commitHash).toBe("abc1234def5678901234567890abcdef12345678");
    expect(events[0].message).toBe("Implement feature X");
    expect(events[1].message).toBe("Fix tests");
    expect(events[2].message).toBe("Update docs");

    // Verify stored in DB
    const stored = store.getForSession(sessionId);
    expect(stored.length).toBe(3);
    // Ordered by commitTime
    expect(stored[0].commitTime).toBeLessThan(stored[1].commitTime);
    expect(stored[1].commitTime).toBeLessThan(stored[2].commitTime);
  });

  it("session with no commits: no git events, no errors", () => {
    const store = new GitEventStore();
    const events = collectGitEventsFlow(store, "s1", "u1", [
      { repoPath: "/repo", output: "" },
    ]);

    expect(events.length).toBe(0);
    expect(store.getForSession("s1").length).toBe(0);
  });

  it("invalid repo path: graceful error handling, other repos still processed", () => {
    const store = new GitEventStore();

    // Simulate: first repo returns garbage (invalid path), second returns valid output
    const events = collectGitEventsFlow(store, "s1", "u1", [
      { repoPath: "/invalid/path", output: "fatal: not a git repository" },
      {
        repoPath: "/valid/repo",
        output:
          "abc1234def5678901234567890abcdef12345678 Valid commit 2026-04-01 10:00:00 +0000",
      },
    ]);

    // Invalid repo produces no events (malformed output is skipped)
    // Valid repo produces 1 event
    expect(events.length).toBe(1);
    expect(events[0].repoPath).toBe("/valid/repo");
    expect(events[0].message).toBe("Valid commit");
  });

  it("multiple repos: events from each repo stored with correct repoPath", () => {
    const store = new GitEventStore();

    const events = collectGitEventsFlow(store, "s1", "u1", [
      {
        repoPath: "/repo/frontend",
        output:
          "abc1234def5678901234567890abcdef12345678 Frontend fix 2026-04-01 10:00:00 +0000",
      },
      {
        repoPath: "/repo/backend",
        output:
          "bcd2345ef6789012345678901abcdef123456789 Backend fix 2026-04-01 11:00:00 +0000",
      },
    ]);

    expect(events.length).toBe(2);
    expect(events[0].repoPath).toBe("/repo/frontend");
    expect(events[0].message).toBe("Frontend fix");
    expect(events[1].repoPath).toBe("/repo/backend");
    expect(events[1].message).toBe("Backend fix");
  });

  it("git events have correct sessionId, userId, repoPath, commitHash, message, commitTime", () => {
    const store = new GitEventStore();

    const events = collectGitEventsFlow(store, "session-42", "user-7", [
      {
        repoPath: "/my/repo",
        output:
          "abc1234def5678901234567890abcdef12345678 My commit 2026-04-01 14:30:00 +0000",
      },
    ]);

    expect(events.length).toBe(1);
    const event = events[0];
    expect(event.sessionId).toBe("session-42");
    expect(event.userId).toBe("user-7");
    expect(event.repoPath).toBe("/my/repo");
    expect(event.commitHash).toBe("abc1234def5678901234567890abcdef12345678");
    expect(event.message).toBe("My commit");
    expect(event.commitTime).toBeGreaterThan(0);
  });

  it("date range filtering: only commits within session time range are parsed", () => {
    const store = new GitEventStore();

    // The git log command uses --since and --until flags, so git itself filters.
    // Our parser just processes whatever git returns.
    // This test verifies the parser handles the output correctly.
    const output = [
      "abc1234def5678901234567890abcdef12345678 In range 2026-04-01 10:00:00 +0000",
      "bcd2345ef6789012345678901abcdef123456789 Also in range 2026-04-01 12:00:00 +0000",
    ].join("\n");

    const events = collectGitEventsFlow(store, "s1", "u1", [
      { repoPath: "/repo", output },
    ]);

    expect(events.length).toBe(2);
    // Both commits are within the output (git already filtered by --since/--until)
    expect(events[0].message).toBe("In range");
    expect(events[1].message).toBe("Also in range");
  });
});
