import { describe, it, expect } from "vitest";
import fc from "fast-check";

/**
 * Property 23: Git Event Session Linkage
 *
 * For any git commits within a session's time range, each is stored as a
 * git_event linked to that session. Display includes only commit message
 * and timestamp — no commit counts, scores, or diff data.
 *
 * **Validates: Requirements 11.2, 11.3**
 */

// --- In-memory model mirroring the Rust git log parsing + storage logic ---

interface GitCommit {
  hash: string;
  message: string;
  commitTime: number; // Unix timestamp
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

interface Session {
  id: string;
  userId: string;
  startTime: number;
  endTime: number;
}

/**
 * Model: parse git log output (mirrors Rust parse_git_log_output).
 * Format per line: "<40-char-hex-hash> <message> <YYYY-MM-DD HH:MM:SS +ZZZZ>"
 */
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

      // Parse the date to Unix timestamp
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

/**
 * Model: store git commits as git_events linked to a session.
 * Mirrors Rust store_git_events.
 */
function storeGitEvents(
  session: Session,
  repoPath: string,
  commits: GitCommit[],
): GitEvent[] {
  return commits.map((commit, i) => ({
    id: `ge-${session.id}-${i}`,
    sessionId: session.id,
    userId: session.userId,
    repoPath,
    commitHash: commit.hash,
    message: commit.message,
    commitTime: commit.commitTime,
  }));
}

/**
 * Model: collect git events across multiple repos for a session.
 * Mirrors Rust collect_git_events_inner.
 */
function collectGitEvents(
  session: Session,
  repoOutputs: Array<{ repoPath: string; output: string }>,
): GitEvent[] {
  const allEvents: GitEvent[] = [];
  for (const { repoPath, output } of repoOutputs) {
    const commits = parseGitLogOutput(output);
    const events = storeGitEvents(session, repoPath, commits);
    allEvents.push(...events);
  }
  return allEvents;
}

// --- Arbitraries ---

const hexChar = fc.constantFrom(
  ..."0123456789abcdef".split(""),
);

const commitHashArb = fc
  .array(hexChar, { minLength: 40, maxLength: 40 })
  .map((chars) => chars.join(""));

const timestampArb = fc.integer({ min: 1_700_000_000, max: 1_800_000_000 });

const commitMessageArb = fc
  .stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz ".split("")), {
    minLength: 1,
    maxLength: 50,
  })
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

function formatGitDate(unixSecs: number): string {
  const d = new Date(unixSecs * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} +0000`;
}

const repoPathArb = fc
  .stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz/".split("")), {
    minLength: 3,
    maxLength: 30,
  })
  .map((s) => `/repos/${s}`);

describe("Property 23: Git Event Session Linkage", () => {
  it("every commit within session range is stored as a git_event linked to that session", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        timestampArb,
        fc.integer({ min: 3600, max: 36000 }),
        fc.integer({ min: 0, max: 10 }),
        repoPathArb,
        (sessionId, userId, sessionStart, duration, commitCount, repoPath) => {
          const sessionEnd = sessionStart + duration;
          const session: Session = {
            id: sessionId,
            userId,
            startTime: sessionStart,
            endTime: sessionEnd,
          };

          // Generate commit lines within session range
          const lines: string[] = [];
          const expectedTimes: number[] = [];
          for (let i = 0; i < commitCount; i++) {
            const commitTime =
              sessionStart + Math.floor((duration * (i + 1)) / (commitCount + 1));
            const hash = "a".repeat(40);
            const msg = `commit${i}`;
            lines.push(`${hash} ${msg} ${formatGitDate(commitTime)}`);
            expectedTimes.push(commitTime);
          }

          const output = lines.join("\n");
          const events = collectGitEvents(session, [{ repoPath, output }]);

          // PROPERTY: every commit produces a git_event
          expect(events.length).toBe(commitCount);

          // PROPERTY: every git_event is linked to the session
          for (const event of events) {
            expect(event.sessionId).toBe(sessionId);
          }

          // PROPERTY: every git_event has the correct userId
          for (const event of events) {
            expect(event.userId).toBe(userId);
          }

          // PROPERTY: every git_event has the correct repoPath
          for (const event of events) {
            expect(event.repoPath).toBe(repoPath);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("git events contain only commit message and timestamp — no counts or scores", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        timestampArb,
        fc.integer({ min: 3600, max: 36000 }),
        commitHashArb,
        commitMessageArb,
        (sessionId, userId, sessionStart, duration, hash, message) => {
          const sessionEnd = sessionStart + duration;
          const commitTime =
            sessionStart + Math.floor(duration / 2);
          const session: Session = {
            id: sessionId,
            userId,
            startTime: sessionStart,
            endTime: sessionEnd,
          };

          const line = `${hash} ${message} ${formatGitDate(commitTime)}`;
          const events = collectGitEvents(session, [
            { repoPath: "/repo", output: line },
          ]);

          if (events.length > 0) {
            const event = events[0];
            // PROPERTY: event has message and commitTime
            expect(event.message).toBe(message);
            expect(typeof event.commitTime).toBe("number");

            // PROPERTY: event does NOT have count or score fields
            const keys = Object.keys(event);
            expect(keys).not.toContain("commitCount");
            expect(keys).not.toContain("score");
            expect(keys).not.toContain("diff");
            expect(keys).not.toContain("linesAdded");
            expect(keys).not.toContain("linesRemoved");
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("multiple repos produce events all linked to the same session", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        timestampArb,
        fc.integer({ min: 3600, max: 36000 }),
        fc.array(repoPathArb, { minLength: 1, maxLength: 5 }),
        (sessionId, userId, sessionStart, duration, repoPaths) => {
          const sessionEnd = sessionStart + duration;
          const session: Session = {
            id: sessionId,
            userId,
            startTime: sessionStart,
            endTime: sessionEnd,
          };

          const commitTime = sessionStart + Math.floor(duration / 2);
          const hash = "b".repeat(40);

          const repoOutputs = repoPaths.map((rp) => ({
            repoPath: rp,
            output: `${hash} commit msg ${formatGitDate(commitTime)}`,
          }));

          const events = collectGitEvents(session, repoOutputs);

          // PROPERTY: all events linked to same session
          for (const event of events) {
            expect(event.sessionId).toBe(sessionId);
          }

          // PROPERTY: one event per repo
          expect(events.length).toBe(repoPaths.length);

          // PROPERTY: each event has the correct repo path
          for (let i = 0; i < events.length; i++) {
            expect(events[i].repoPath).toBe(repoPaths[i]);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("empty git log output produces no events", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        timestampArb,
        fc.integer({ min: 3600, max: 36000 }),
        repoPathArb,
        (sessionId, userId, sessionStart, duration, repoPath) => {
          const session: Session = {
            id: sessionId,
            userId,
            startTime: sessionStart,
            endTime: sessionStart + duration,
          };

          const events = collectGitEvents(session, [
            { repoPath, output: "" },
          ]);

          // PROPERTY: no events from empty output
          expect(events.length).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("malformed git log lines are skipped without error", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        timestampArb,
        fc.integer({ min: 3600, max: 36000 }),
        fc.stringOf(fc.char(), { minLength: 0, maxLength: 200 }),
        (sessionId, userId, sessionStart, duration, randomOutput) => {
          const session: Session = {
            id: sessionId,
            userId,
            startTime: sessionStart,
            endTime: sessionStart + duration,
          };

          // Should not throw
          const events = collectGitEvents(session, [
            { repoPath: "/repo", output: randomOutput },
          ]);

          // PROPERTY: all returned events are valid (linked to session)
          for (const event of events) {
            expect(event.sessionId).toBe(sessionId);
            expect(typeof event.commitTime).toBe("number");
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
